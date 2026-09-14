import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase";
import { requireRole } from "@/lib/admin-auth";
import { getEditorItem } from "@/lib/qbank-server";
import { notifyEditorsOfPendingItems } from "@/lib/qbank/notify";
import { specHash } from "@/lib/qbank/question";
import { describeProvider } from "@/lib/qbank/draft";
import { processRevisionJob, queueRevisionJob } from "@/lib/qbank/revise";
import {
  DIFFICULTIES, QBANK_BLOOMS, QBANK_DOMAINS, QBANK_POPULATIONS, QBANK_SETTINGS,
  type Region,
} from "@/lib/cases";

/* eslint-disable @typescript-eslint/no-explicit-any */

// The regenerate action makes an LLM call plus PubMed verification; give the
// function room. 60s is allowed on every Vercel plan; if it is killed the
// revision job stays queued and the weekly cron drains it.
export const runtime = "nodejs";
// A revision sends the whole item plus its evidence corpus to the model and
// waits for a full rewrite; 60 s was not enough and the call aborted mid-way
// (PQ-G-002 v5, 2026-09-11).
export const maxDuration = 300;

// One question-bank item. Editor or admin.
//
// GET  -> { item: { case, references, revisions, reviews, renderJob } }
// POST { action: "save" | "review" | "render" | "schedule" | "bank" | "delete" }
//
// Every status transition goes through the database, so the publish gate in
// migration 20260903_qbank.sql is the single authority on what may go live —
// its error text is passed straight back to the editor.

const ALLOWED_LICENSES = [
  "consortium", "cc0", "cc-by", "cc-by-sa", "cc-by-nc", "cc-by-nd",
  "public-domain", "ai-original", "synthetic-original", "dataset-derived",
];

/** Turn a Postgres error into something an editor can act on. */
function dbError(error: { message: string; code?: string }, fallback: string): NextResponse {
  // The publish-gate trigger raises check_violation with a written-for-humans
  // message ("Cannot set status to published: this item still needs …").
  if (error.code === "23514" || /Cannot set status to/i.test(error.message)) {
    return NextResponse.json({ error: error.message.replace(/^.*?ERROR:\s*/i, "") }, { status: 400 });
  }
  console.error(`[Qbank] ${fallback}:`, error.message);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, "editor");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const item = await getEditorItem(id);
  if (!item) return NextResponse.json({ error: "Item not found." }, { status: 404 });
  // The lab recordings made for this question, so the reviewer can sign the
  // full record off in the same sitting (see `alsoRecordings` in review).
  const recordings = await linkedRecordings(id);
  return NextResponse.json({ success: true, item: { ...item, recordings }, role: auth.role });
}

interface LinkedRecording {
  jobId: string; recordingId: string | null; title: string | null;
  status: string; reviewStatus: string; grandfathered: boolean; authorId: string | null;
}

async function linkedRecordings(caseId: string): Promise<LinkedRecording[]> {
  const supabase = createServerClient();
  if (!supabase) return [];
  const { data: c } = await supabase.from("eeg_cases").select("qbank_id").eq("id", caseId).maybeSingle();
  const qbankId = (c as { qbank_id?: string | null } | null)?.qbank_id;
  if (!qbankId) return [];
  const { data } = await supabase
    .from("eeg_lab_jobs")
    .select("id,recording_id,title,status,review_status,grandfathered,author_id")
    .eq("stage", "export").eq("qbank_id", qbankId)
    .order("created_at", { ascending: false });
  return ((data ?? []) as any[]).map((r) => ({
    jobId: String(r.id), recordingId: r.recording_id ?? null, title: r.title ?? null,
    status: String(r.status), reviewStatus: String(r.review_status ?? "draft"),
    grandfathered: r.grandfathered === true, authorId: r.author_id ?? null,
  }));
}

/**
 * Approve the recordings the reviewer ticked along with the question. Each one
 * goes through the same gate as the recording page: it must belong to this
 * question, the export must be done, and the reviewer must not be its author.
 * The trigger in 20260914_eeg_lab_review.sql has the last word.
 */
async function approveLinkedRecordings(
  supabase: NonNullable<ReturnType<typeof createServerClient>>,
  caseId: string, jobIds: string[], reviewer: { userId: string; email: string }, notes: string | null,
): Promise<{ published: string[]; failed: { jobId: string; error: string }[] }> {
  const out = { published: [] as string[], failed: [] as { jobId: string; error: string }[] };
  if (!jobIds.length) return out;
  const linked = await linkedRecordings(caseId);
  const byId = new Map(linked.map((r) => [r.jobId, r]));
  for (const jobId of jobIds) {
    const r = byId.get(jobId);
    if (!r) { out.failed.push({ jobId, error: "not a recording of this question" }); continue; }
    if (r.status !== "done") { out.failed.push({ jobId, error: "the export has not finished" }); continue; }
    if (r.reviewStatus === "published" && !r.grandfathered) { out.published.push(jobId); continue; }
    if (r.reviewStatus === "archived") { out.failed.push({ jobId, error: "archived — reopen it on the recording page" }); continue; }
    if (r.authorId && r.authorId === reviewer.userId) { out.failed.push({ jobId, error: "you made this recording (four-eyes rule)" }); continue; }
    const { error: revErr } = await supabase.from("eeg_lab_reviews").insert({
      job_id: jobId, reviewer: reviewer.userId, reviewer_email: reviewer.email, decision: "approved",
      notes: notes ? `Reviewed with the question. ${notes}` : "Reviewed with the question.",
    });
    if (revErr) { out.failed.push({ jobId, error: revErr.message }); continue; }
    const now = new Date().toISOString();
    const { error } = await supabase.from("eeg_lab_jobs").update({
      review_status: "published", grandfathered: false, reviewed_by: reviewer.userId, reviewed_at: now,
      submitted_at: r.reviewStatus === "draft" ? now : undefined,
    }).eq("id", jobId);
    if (error) { out.failed.push({ jobId, error: error.message.replace(/^.*?ERROR:\s*/i, "") }); continue; }
    out.published.push(jobId);
  }
  return out;
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, "editor");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const supabase = createServerClient()!;
  // the bank page's facet counts are a cached render (revalidate = 300); a status change must show up at once
  revalidatePath("/education/question-bank");

  let body: any;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const action = String(body.action || "save");

  const { data: current } = await supabase
    .from("eeg_cases").select("id,status,created_by,qbank_id,title,domain,spec,source").eq("id", id).maybeSingle();
  if (!current) return NextResponse.json({ error: "Item not found." }, { status: 404 });

  // ---------------- save ----------------
  if (action === "save") {
    const input = body.item ?? {};
    const patch: Record<string, unknown> = {};

    const text = (key: string, column: string, max = 4000) => {
      if (typeof input[key] === "string") patch[column] = input[key].slice(0, max) || null;
    };
    text("title", "title", 300);
    text("vignette", "clinical_vignette");
    text("leadIn", "lead_in", 400);
    text("imageCaption", "image_caption", 800);
    text("questionPrompt", "question_prompt", 800);
    text("explanation", "explanation", 6000);
    text("learningObjective", "learning_objective", 400);
    text("imageAttribution", "image_attribution", 500);
    text("imageSourceUrl", "image_source_url", 800);

    if (typeof input.domain === "string" && QBANK_DOMAINS.includes(input.domain)) patch.domain = input.domain;
    if (typeof input.population === "string" && QBANK_POPULATIONS.includes(input.population)) patch.population = input.population;
    if (typeof input.setting === "string" && QBANK_SETTINGS.includes(input.setting)) patch.setting = input.setting;
    if (typeof input.bloom === "string" && QBANK_BLOOMS.includes(input.bloom)) patch.bloom = input.bloom;
    if (typeof input.difficulty === "string" && DIFFICULTIES.includes(input.difficulty)) patch.difficulty = input.difficulty;
    if (typeof input.imageLicense === "string" && ALLOWED_LICENSES.includes(input.imageLicense)) patch.image_license = input.imageLicense;
    else if (input.imageLicense === "" || input.imageLicense === null) patch.image_license = null;
    if (Array.isArray(input.keyPoints)) {
      const points = input.keyPoints.map((k: unknown) => String(k).slice(0, 300)).filter(Boolean);
      patch.key_points = points;
      // The reveal UI renders teaching_points; keep the two in step.
      patch.teaching_points = points;
    }
    if (Array.isArray(input.tags)) patch.tags = input.tags.map((t: unknown) => String(t).slice(0, 60)).filter(Boolean);
    const oldSpecHash = current.spec ? specHash(current.spec) : null;
    let specChanged = false;
    if (input.spec && typeof input.spec === "object") {
      patch.spec = input.spec;
      patch.spec_hash = specHash(input.spec);
      specChanged = patch.spec_hash !== oldSpecHash;
    }
    if (input.correctRegion !== undefined) patch.correct_region = (input.correctRegion as Region) ?? null;
    if (typeof input.regionTolerance === "number") patch.region_tolerance = input.regionTolerance;

    if (Object.keys(patch).length) {
      const { error } = await supabase.from("eeg_cases").update(patch).eq("id", id);
      if (error) return dbError(error, "Save failed.");
    }

    // options: replaced wholesale when supplied
    if (Array.isArray(input.options)) {
      const rows = input.options
        .filter((o: any) => o && String(o.label ?? "").trim())
        .map((o: any, i: number) => ({
          case_id: id,
          label: String(o.label).slice(0, 400),
          is_correct: !!o.isCorrect,
          option_explanation: o.optionExplanation ? String(o.optionExplanation).slice(0, 1000) : null,
          sort_order: i,
        }));
      const correct = rows.filter((r: any) => r.is_correct).length;
      if (rows.length && correct !== 1) {
        return NextResponse.json({ error: "Exactly one option must be marked correct." }, { status: 400 });
      }
      await supabase.from("eeg_case_options").delete().eq("case_id", id);
      if (rows.length) {
        const { error } = await supabase.from("eeg_case_options").insert(rows);
        if (error) return dbError(error, "Saving options failed.");
      }
    }

    // references: replaced wholesale when supplied
    if (Array.isArray(input.references)) {
      const rows = input.references
        .filter((r: any) => r && (String(r.citation ?? "").trim() || r.pmid))
        .map((r: any, i: number) => ({
          case_id: id,
          pmid: r.pmid ? String(r.pmid).replace(/\D/g, "").slice(0, 9) || null : null,
          doi: r.doi ? String(r.doi).slice(0, 200) : null,
          url: r.url ? String(r.url).slice(0, 500) : null,
          citation: String(r.citation ?? "").slice(0, 500),
          role: r.role === "primary" ? "primary" : "supporting",
          verified: !!r.verified,
          verified_by: r.verifiedBy ? String(r.verifiedBy).slice(0, 200) : null,
          open_access: r.openAccess ? String(r.openAccess).slice(0, 20) : null,
          member_author: !!r.memberAuthor,
          sort_order: i,
        }));
      await supabase.from("eeg_case_references").delete().eq("case_id", id);
      if (rows.length) {
        const { error } = await supabase.from("eeg_case_references").insert(rows);
        if (error) return dbError(error, "Saving references failed.");
      }
    }

    // A changed image spec means the picture is now stale. Enqueue a render so
    // the editor does not have to remember a second button — the Python worker
    // (or a manual re-render) picks it up and updates image_url + sidecar.
    let renderJobId: string | null = null;
    if (specChanged) {
      const { data: rj } = await supabase
        .from("eeg_case_render_jobs")
        .insert({ case_id: id, spec: patch.spec, status: "pending" })
        .select("id").single();
      renderJobId = (rj as any)?.id ?? null;
    }

    return NextResponse.json({ success: true, renderJobId });
  }

  // ---------------- review ----------------
  if (action === "review") {
    const decision = String(body.decision || "");
    if (!["approved", "changes_requested", "rejected"].includes(decision)) {
      return NextResponse.json({ error: "Decision must be approved, changes_requested or rejected." }, { status: 400 });
    }
    const notes = body.notes ? String(body.notes).slice(0, 4000) : null;

    // Four-eyes is enforced by the DB trigger too; refusing here gives the
    // editor a clearer message than a constraint violation would.
    if (decision === "approved" && current.created_by && current.created_by === auth.userId) {
      return NextResponse.json(
        { error: "You cannot approve an item you created. Another editor has to sign it off." },
        { status: 400 },
      );
    }

    const { error: reviewErr } = await supabase.from("eeg_case_reviews").insert({
      case_id: id,
      reviewer: auth.userId,
      reviewer_email: auth.email,
      decision,
      notes,
    });
    if (reviewErr) return dbError(reviewErr, "Could not record the review.");

    const patch: Record<string, unknown> = { reviewed_by: auth.userId };
    // Approval is what puts an item in front of learners (as a bank item);
    // scheduling as Case of the Day is a separate, later step. Make sure an
    // approved item is actually in the bank, otherwise it would stall unseen.
    if (decision === "approved") { patch.status = "approved"; patch.in_bank = true; }
    if (decision === "changes_requested") patch.status = "pending_review";
    if (decision === "rejected") patch.status = "archived";

    const { error } = await supabase.from("eeg_cases").update(patch).eq("id", id);
    if (error) return dbError(error, "Could not update the item's status.");

    // "I also reviewed the full EEG recording" — publish the ticked lab
    // recordings of this question in the same act. Only on approval.
    let recordings: Awaited<ReturnType<typeof approveLinkedRecordings>> | null = null;
    if (decision === "approved" && Array.isArray(body.alsoRecordings) && body.alsoRecordings.length) {
      const ids = (body.alsoRecordings as unknown[]).filter((v): v is string => typeof v === "string");
      recordings = await approveLinkedRecordings(supabase, id, ids, { userId: auth.userId, email: auth.email }, notes);
    }

    // For an AI-generated item, "request changes" queues an automatic revision:
    // the feedback is fed back to the model, the item is re-critiqued and
    // re-rendered, and it returns to the review queue as a new version. The
    // queue is drained inline below (best effort) and by the weekly cron, so it
    // happens whether or not anyone presses "Revise with AI".
    let regeneration: Record<string, unknown> | null = null;
    if (decision === "changes_requested" && current.source === "ai") {
      const jobId = await queueRevisionJob(supabase, {
        caseId: id,
        feedback: notes ?? "",
        title: current.title,
        model: describeProvider().model,
      });
      regeneration = { queued: !!jobId, jobId };
    }

    return NextResponse.json({ success: true, status: patch.status, regeneration, recordings });
  }

  // ---------------- regenerate (AI item: revise from feedback) ----------------
  // Runs a queued revision inline: revise → critic → write new version →
  // enqueue render. Called by the editor console right after a changes_requested
  // review on an AI item, or from the "Revise with AI" button as a retry.
  if (action === "regenerate") {
    // Team-written items can be revised by the model too: the reviser EDITS
    // the stored item rather than redrafting it, and where there is no
    // retrieval corpus the numbers-sourced and references checks are skipped
    // with the human editor as the backstop (see lib/qbank/revise.ts).
    // processRevisionJob reports an item with no stored content snapshot.
    // Prefer an explicit jobId, else the newest pending/failed revision job,
    // else create one from the supplied feedback or the latest review notes.
    let jobId: string | null = typeof body.jobId === "string" ? body.jobId : null;
    if (!jobId) {
      const { data: existing } = await supabase
        .from("eeg_case_generation_jobs")
        .select("id")
        .eq("case_id", id).eq("mode", "revision").in("status", ["pending", "failed"])
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      jobId = (existing as any)?.id ?? null;
    }
    if (!jobId) {
      let feedback = typeof body.feedback === "string" ? body.feedback : "";
      if (!feedback) {
        const { data: lastReview } = await supabase
          .from("eeg_case_reviews")
          .select("notes")
          .eq("case_id", id).eq("decision", "changes_requested")
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        feedback = (lastReview as any)?.notes ?? "";
      }
      jobId = await queueRevisionJob(supabase, {
        caseId: id, feedback, title: current.title, model: describeProvider().model,
      });
    }
    if (!jobId) return NextResponse.json({ error: "Could not queue the revision." }, { status: 500 });

    const outcome = await processRevisionJob(supabase, jobId, {
      timeoutMs: Number(process.env.QBANK_LLM_TIMEOUT_MS ?? 240_000),
    });
    if (!outcome.ok) {
      return NextResponse.json(
        { error: outcome.error ?? "The revision failed.", jobId, critic: outcome.critic ?? null },
        { status: 422 },
      );
    }
    return NextResponse.json({
      success: true, jobId, renderJobId: outcome.renderJobId ?? null, critic: outcome.critic ?? null,
    });
  }

  // ---------------- re-render ----------------
  if (action === "render") {
    const spec = body.spec && typeof body.spec === "object" ? body.spec : current.spec;
    if (!spec) {
      return NextResponse.json({ error: "This item has no image spec to render." }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("eeg_case_render_jobs")
      .insert({ case_id: id, spec, status: "pending" })
      .select("id")
      .single();
    if (error || !data) return dbError(error ?? { message: "unknown" }, "Could not queue the render.");
    // Keep spec_hash in step so the queue shows the item as re-rendered.
    await supabase.from("eeg_cases").update({ spec, spec_hash: specHash(spec) }).eq("id", id);
    return NextResponse.json({ success: true, jobId: data.id });
  }

  // ---------------- schedule as Case of the Day (status=published) ----------------
  if (action === "schedule") {
    const publishDate = typeof body.publishDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.publishDate)
      ? body.publishDate
      : new Date().toISOString().slice(0, 10);
    const { error } = await supabase
      .from("eeg_cases")
      .update({ status: "published", publish_date: publishDate })
      .eq("id", id);
    if (error) return dbError(error, "Could not publish the item.");
    return NextResponse.json({ success: true, publishDate });
  }

  // ---------------- include/exclude from the bank ----------------
  if (action === "bank") {
    const { error } = await supabase.from("eeg_cases").update({ in_bank: !!body.inBank }).eq("id", id);
    if (error) return dbError(error, "Could not change bank membership.");
    return NextResponse.json({ success: true });
  }

  // ---------------- notify (manual nudge) ----------------
  if (action === "notify") {
    const sent = await notifyEditorsOfPendingItems(
      supabase,
      [{
        qbankId: current.qbank_id ?? id,
        title: current.title,
        domain: current.domain ?? null,
        caseId: id,
        caseStatus: current.status,
      }],
      { origin: request.nextUrl.origin, source: `manual nudge by ${auth.email}` },
    );
    return NextResponse.json({ success: true, recipients: sent });
  }

  // ---------------- delete (admins only) ----------------
  if (action === "delete") {
    if (auth.role !== "admin") {
      return NextResponse.json({ error: "Only an admin can delete an item." }, { status: 403 });
    }
    const { error } = await supabase.from("eeg_cases").delete().eq("id", id);
    if (error) return dbError(error, "Delete failed.");
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: `Unknown action "${action}".` }, { status: 400 });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
