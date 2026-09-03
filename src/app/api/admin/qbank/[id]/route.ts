import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireRole } from "@/lib/admin-auth";
import { getEditorItem } from "@/lib/qbank-server";
import { notifyEditorsOfPendingItems } from "@/lib/qbank/notify";
import { specHash } from "@/lib/qbank/question";
import {
  DIFFICULTIES, QBANK_BLOOMS, QBANK_DOMAINS, QBANK_POPULATIONS, QBANK_SETTINGS,
  type Region,
} from "@/lib/cases";

/* eslint-disable @typescript-eslint/no-explicit-any */

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
  return NextResponse.json({ success: true, item, role: auth.role });
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, "editor");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const supabase = createServerClient()!;

  let body: any;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const action = String(body.action || "save");

  const { data: current } = await supabase
    .from("eeg_cases").select("id,status,created_by,qbank_id,title,domain,spec").eq("id", id).maybeSingle();
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
    if (input.spec && typeof input.spec === "object") {
      patch.spec = input.spec;
      patch.spec_hash = specHash(input.spec);
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

    return NextResponse.json({ success: true });
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
    if (decision === "approved") patch.status = "approved";
    if (decision === "changes_requested") patch.status = "pending_review";
    if (decision === "rejected") patch.status = "archived";

    const { error } = await supabase.from("eeg_cases").update(patch).eq("id", id);
    if (error) return dbError(error, "Could not update the item's status.");
    return NextResponse.json({ success: true, status: patch.status });
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

  // ---------------- schedule as Case of the Day ----------------
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
