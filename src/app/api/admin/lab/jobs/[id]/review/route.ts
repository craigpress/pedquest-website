import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireRole, type AuthOk } from "@/lib/admin-auth";
import { reviseSpecFromFeedback } from "@/lib/lab/draft";
import {
  LAB_JOB_COLUMNS, buildJobOptions, newRecordingId, retentionExpiry, rowToJob, specHash,
} from "@/lib/lab/jobs";
import {
  LIBRARY_CASE_COLUMNS, caseRowToQuestion, suggestDescription, suggestTitle, summarizeSpec,
} from "@/lib/lab/library";
import { notifyAuthorOfDecision, notifyEditorsOfPendingRecordings } from "@/lib/lab/notify";
import { durationSecondsFromSpec } from "@/lib/lab/spec";
import { canEditRecording, canReviewRecording, canSeeRecording } from "@/lib/lab/visibility";
import {
  LAB_REVIEW_DECISIONS, SYNTHETIC_STAMP, type LabJob, type LabReview, type LabReviewDecision,
} from "@/lib/lab/types";

// `revise` calls the LLM (up to two rounds), so this route needs the same room
// as the other LLM routes.
export const runtime = "nodejs";
export const maxDuration = 300;

// Editorial review of one EEG Library recording. Editor or admin.
//
// GET  /api/admin/lab/jobs/<uuid>/review
//   -> { job, reviews, authorEmail, reviewerEmails, suggestion, can: { edit, submit, review, unpublish, revise } }
// POST /api/admin/lab/jobs/<uuid>/review  { action, ... }
//   save      { title, description }              author or admin
//   submit    { title?, description? }            author or admin (any editor for an AI recording)
//   withdraw                                      author or admin: pending_review → draft
//   review    { decision, notes }                 an editor who is not the author
//   unpublish                                     admin: published → draft
//   notify                                        nudge the editors about this recording
//   revise    { feedback? }                       any editor: the model edits the spec from the
//                                                 feedback (default: the latest changes-requested
//                                                 note) and a NEW export is queued as a draft of
//                                                 the requester, linked by parent_job_id. The
//                                                 original recording is not touched.
//
// The status transition is written by the database; the publish gate trigger
// (20260914_eeg_lab_review.sql) is the last word on whether a recording may
// be published, and its message is returned verbatim when it refuses.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TITLE_MAX = 160;
const DESCRIPTION_MAX = 2000;

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToReview(row: any): LabReview {
  return {
    id: String(row.id),
    reviewer: row.reviewer ?? null,
    reviewerEmail: row.reviewer_email ?? null,
    decision: row.decision as LabReviewDecision,
    notes: row.notes ?? null,
    createdAt: String(row.created_at),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function dbError(error: { code?: string; message: string }, fallback: string) {
  // The gate raises a plain-English sentence; surface it as a 400, not a 500.
  if (error.code === "P0001" || /Cannot publish this recording/i.test(error.message)) {
    return NextResponse.json({ error: error.message.replace(/^.*?ERROR:\s*/i, "") }, { status: 400 });
  }
  console.error("[EEG Lab review]", error.message);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

async function loadJob(id: string) {
  const supabase = createServerClient();
  if (!supabase) return { supabase: null, job: null as LabJob | null };
  const { data, error } = await supabase.from("eeg_lab_jobs").select(LAB_JOB_COLUMNS).eq("id", id).maybeSingle();
  if (error) console.error("[EEG Lab review] load failed:", error.message);
  return { supabase, job: data ? rowToJob(data) : null };
}

async function emailsFor(supabase: NonNullable<ReturnType<typeof createServerClient>>, ids: (string | null)[]) {
  const wanted = Array.from(new Set(ids.filter((v): v is string => !!v)));
  const out = new Map<string, string>();
  if (!wanted.length) return out;
  const { data } = await supabase.from("user_roles").select("user_id,email").in("user_id", wanted);
  for (const r of (data ?? []) as { user_id: string | null; email: string }[]) {
    if (r.user_id) out.set(r.user_id, r.email);
  }
  return out;
}

async function suggestionFor(supabase: NonNullable<ReturnType<typeof createServerClient>>, job: LabJob) {
  let question = null;
  if (job.qbankId) {
    const { data } = await supabase.from("eeg_cases").select(LIBRARY_CASE_COLUMNS).eq("qbank_id", job.qbankId).maybeSingle();
    question = data ? caseRowToQuestion(data as unknown as Record<string, unknown>) : null;
  }
  const summary = summarizeSpec(job.spec);
  return {
    question,
    summary,
    suggestion: {
      title: suggestTitle(summary, question, job.durationS),
      description: suggestDescription(summary, question, job.durationS),
    },
  };
}

function permissions(auth: AuthOk, job: LabJob) {
  const admin = auth.role === "admin";
  const edit = canEditRecording(auth, job) && (job.reviewStatus !== "published" || admin);
  return {
    edit,
    submit: canEditRecording(auth, job) && (job.reviewStatus === "draft" || job.reviewStatus === "archived"),
    withdraw: canEditRecording(auth, job) && job.reviewStatus === "pending_review",
    review: canReviewRecording(auth, job)
      && (job.reviewStatus === "pending_review" || (job.reviewStatus === "published" && job.grandfathered)),
    unpublish: admin && job.reviewStatus === "published",
    // Any editor who can see a finished recording may ask the model for a
    // revised copy; the copy is their own draft, so four-eyes is untouched.
    revise: job.stage === "export" && job.status === "done",
  };
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, "editor");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not a job id." }, { status: 400 });

  const { supabase, job } = await loadJob(id);
  if (!supabase) return NextResponse.json({ error: "The teaching lab is not configured." }, { status: 503 });
  if (!job || !canSeeRecording(auth, job)) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  const [{ data: reviewRows }, { question, summary, suggestion }] = await Promise.all([
    supabase.from("eeg_lab_reviews").select("id,reviewer,reviewer_email,decision,notes,created_at")
      .eq("job_id", id).order("created_at", { ascending: false }),
    suggestionFor(supabase, job),
  ]);
  const emails = await emailsFor(supabase, [job.authorId, job.reviewedBy]);

  return NextResponse.json({
    success: true,
    job,
    reviews: (reviewRows ?? []).map(rowToReview),
    authorEmail: job.authorId ? emails.get(job.authorId) ?? null : null,
    reviewerEmail: job.reviewedBy ? emails.get(job.reviewedBy) ?? null : null,
    /** the question-bank item this recording was made for, if any */
    question,
    /** what was authored into the spec (findings etc.) — editors only, this route is editor-gated */
    summary,
    suggestion,
    can: permissions(auth, job),
    viewerId: auth.userId,
    role: auth.role,
    stamp: SYNTHETIC_STAMP,
  }, { headers: { "Cache-Control": "no-store" } });
}

function cleanText(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t.length ? t.slice(0, max) : null;
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, "editor");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not a job id." }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!isObj(parsed)) throw new Error("not an object");
    body = parsed;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const action = String(body.action ?? "");

  const { supabase, job } = await loadJob(id);
  if (!supabase) return NextResponse.json({ error: "The teaching lab is not configured." }, { status: 503 });
  if (!job || !canSeeRecording(auth, job)) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (job.stage !== "export") {
    return NextResponse.json({ error: "Only the export stage of a recording is reviewed." }, { status: 400 });
  }
  const can = permissions(auth, job);

  const update = async (patch: Record<string, unknown>) => {
    const { data, error } = await supabase.from("eeg_lab_jobs").update(patch).eq("id", id).select(LAB_JOB_COLUMNS).single();
    return { job: data ? rowToJob(data) : null, error };
  };
  const origin = request.nextUrl.origin;

  // ---------------- save title / description ----------------
  if (action === "save") {
    if (!can.edit) return NextResponse.json({ error: "Only the author or an admin can edit this recording." }, { status: 403 });
    const title = cleanText(body.title, TITLE_MAX);
    const description = cleanText(body.description, DESCRIPTION_MAX);
    const patch: Record<string, unknown> = {};
    if (title !== undefined) patch.title = title;
    if (description !== undefined) patch.description = description;
    if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
    const { job: saved, error } = await update(patch);
    if (error) return dbError(error, "Could not save.");
    return NextResponse.json({ success: true, job: saved });
  }

  // ---------------- submit for review ----------------
  if (action === "submit") {
    if (!can.submit) {
      return NextResponse.json({
        error: job.reviewStatus === "pending_review" ? "This recording is already awaiting review."
          : job.reviewStatus === "published" ? "This recording is already published."
          : "Only the author or an admin can submit this recording.",
      }, { status: 403 });
    }
    if (job.status !== "done") {
      return NextResponse.json({ error: "The export has not finished yet — submit it once the job is done." }, { status: 400 });
    }
    // No title yet → the same suggestion the page offers; the reviewer still
    // reads and approves it, which is what "suggested" means here.
    const { suggestion } = await suggestionFor(supabase, job);
    const title = cleanText(body.title, TITLE_MAX) ?? job.title ?? suggestion.title;
    const description = cleanText(body.description, DESCRIPTION_MAX) ?? job.description ?? suggestion.description;
    if (!title) return NextResponse.json({ error: "Give the recording a title before submitting it." }, { status: 400 });
    const { job: saved, error } = await update({
      title, description, review_status: "pending_review", submitted_at: new Date().toISOString(),
    });
    if (error) return dbError(error, "Could not submit the recording.");
    const notified = await notifyEditorsOfPendingRecordings(supabase, [{
      jobId: id, recordingId: job.recordingId, title, qbankId: job.qbankId, authorEmail: auth.email,
    }], { origin, source: "submitted from the recording page" }).catch(() => 0);
    return NextResponse.json({ success: true, job: saved, notified });
  }

  // ---------------- withdraw ----------------
  if (action === "withdraw") {
    if (!can.withdraw) return NextResponse.json({ error: "Only a submitted recording can be withdrawn, by its author or an admin." }, { status: 403 });
    const { job: saved, error } = await update({ review_status: "draft" });
    if (error) return dbError(error, "Could not withdraw the recording.");
    return NextResponse.json({ success: true, job: saved });
  }

  // ---------------- review ----------------
  if (action === "review") {
    const decision = String(body.decision ?? "");
    if (!(LAB_REVIEW_DECISIONS as string[]).includes(decision)) {
      return NextResponse.json({ error: "Decision must be approved, changes_requested or rejected." }, { status: 400 });
    }
    const notes = cleanText(body.notes, DESCRIPTION_MAX) ?? null;
    if (decision !== "approved" && !notes) {
      return NextResponse.json({ error: "Say what needs to change — the note is what the author sees." }, { status: 400 });
    }
    if (!can.review) {
      if (job.authorId === auth.userId) {
        return NextResponse.json({ error: "You made this recording — another editor has to review it (four-eyes rule)." }, { status: 400 });
      }
      return NextResponse.json({ error: "This recording is not awaiting review." }, { status: 400 });
    }
    // The decision is recorded first so a gate refusal still leaves the trail.
    const { error: revErr } = await supabase.from("eeg_lab_reviews").insert({
      job_id: id, reviewer: auth.userId, reviewer_email: auth.email, decision, notes,
    });
    if (revErr) return dbError(revErr, "Could not record the review.");

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { reviewed_by: auth.userId, reviewed_at: now };
    if (decision === "approved") { patch.review_status = "published"; patch.grandfathered = false; }
    if (decision === "changes_requested") patch.review_status = "draft";
    if (decision === "rejected") patch.review_status = "archived";
    const { job: saved, error } = await update(patch);
    if (error) return dbError(error, "Could not update the recording's status.");

    if (job.authorId && job.authorId !== auth.userId) {
      const emails = await emailsFor(supabase, [job.authorId]);
      const to = emails.get(job.authorId);
      if (to) {
        await notifyAuthorOfDecision(to, {
          jobId: id, recordingId: job.recordingId, title: saved?.title ?? job.title ?? job.recordingId ?? id,
          decision: decision as LabReviewDecision, notes,
        }, { origin }).catch(() => undefined);
      }
    }
    return NextResponse.json({ success: true, job: saved, status: patch.review_status });
  }

  // ---------------- unpublish (admin) ----------------
  if (action === "unpublish") {
    if (!can.unpublish) return NextResponse.json({ error: "Only an admin can take a published recording out of the library." }, { status: 403 });
    const { job: saved, error } = await update({ review_status: "draft", published_at: null });
    if (error) return dbError(error, "Could not unpublish the recording.");
    return NextResponse.json({ success: true, job: saved });
  }

  // ---------------- notify (manual nudge) ----------------
  if (action === "notify") {
    if (job.reviewStatus !== "pending_review") {
      return NextResponse.json({ error: "Only a recording awaiting review can be sent to the editors." }, { status: 400 });
    }
    const emails = await emailsFor(supabase, [job.authorId]);
    const sent = await notifyEditorsOfPendingRecordings(supabase, [{
      jobId: id, recordingId: job.recordingId, title: job.title ?? job.recordingId ?? id, qbankId: job.qbankId,
      authorEmail: job.authorId ? emails.get(job.authorId) ?? null : null,
    }], { origin, source: `nudged by ${auth.email}` });
    return NextResponse.json({ success: true, notified: sent });
  }

  // ---------------- revise with AI ----------------
  if (action === "revise") {
    if (!can.revise) {
      return NextResponse.json({ error: "The export has to finish before the recording can be revised." }, { status: 400 });
    }
    let feedback = cleanText(body.feedback, 4000) ?? null;
    if (!feedback) {
      const { data: last } = await supabase.from("eeg_lab_reviews").select("notes")
        .eq("job_id", id).eq("decision", "changes_requested")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      feedback = ((last as { notes?: string | null } | null)?.notes ?? "").trim() || null;
    }
    if (!feedback) {
      return NextResponse.json({ error: "Say what should change — there is no changes-requested note to work from." }, { status: 400 });
    }

    const durationMin = Math.max(1, Math.round(job.durationS / 60));
    let draft;
    try {
      draft = await reviseSpecFromFeedback({
        spec: job.spec, feedback, title: job.title, durationMin,
        runPersyst: job.options.runPersyst,
        timeoutMs: Number(process.env.QBANK_LLM_TIMEOUT_MS ?? 120_000),
      });
    } catch (e) {
      const message = (e as Error).message;
      return NextResponse.json({
        error: /abort/i.test(message)
          ? "The model did not finish the revision in time — nothing was queued; try again or narrow the request."
          : `The revision failed: ${message}`,
      }, { status: 422 });
    }
    if (!draft.validation.ok) {
      return NextResponse.json({
        error: `The revised spec did not validate: ${draft.validation.errors.join("; ")}`,
        validation: draft.validation, spec: draft.spec, notes: draft.notes,
      }, { status: 422 });
    }

    const block = draft.spec;
    const durationS = durationSecondsFromSpec(block, durationMin);
    const stamp = new Date().toISOString().slice(0, 10);
    const lineage = `AI revision of ${job.recordingId ?? job.id} (${stamp}, ${draft.model}) from review feedback:\n${feedback}`;
    const description = [job.description, lineage].filter(Boolean).join("\n\n").slice(0, DESCRIPTION_MAX);
    const { data: inserted, error: insErr } = await supabase
      .from("eeg_lab_jobs")
      .insert({
        stage: "export",
        status: "pending",
        spec: block,
        duration_s: durationS,
        formats: job.formats,
        options: buildJobOptions({
          mode: "expert", includeAnswers: job.options.includeAnswers, runPersyst: job.options.runPersyst,
          mmxPreset: job.options.mmxPreset, panel: job.options.panel,
        }),
        recording_id: newRecordingId(),
        spec_hash: specHash(block),
        requested_by: `revision:${job.id}:${auth.userId}`,
        parent_job_id: job.id,
        author_id: auth.userId,
        source: "ai",
        review_status: "draft",
        qbank_id: job.qbankId,
        title: job.title,
        description,
        expires_at: retentionExpiry(),
      })
      .select(LAB_JOB_COLUMNS)
      .single();
    if (insErr || !inserted) return dbError(insErr ?? { message: "no row" }, "The spec was revised but the export could not be queued.");

    return NextResponse.json({
      success: true,
      job: rowToJob(inserted),
      revision: {
        parentJobId: job.id, model: draft.model, repaired: draft.repaired,
        notes: draft.notes, warnings: draft.validation.warnings, feedback,
      },
    }, { status: 201 });
  }

  return NextResponse.json({ error: `Unknown action "${action}".` }, { status: 400 });
}
