import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { mapCase, caseImagePublishBlock, type Region } from "@/lib/cases";

/* eslint-disable @typescript-eslint/no-explicit-any */

// GET: list every case (all statuses) with a response count. Admin only.
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const supabase = createServerClient()!;

  const { data: cases, error } = await supabase
    .from("eeg_cases").select("*").order("publish_date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Failed to load cases." }, { status: 500 });

  const ids = (cases ?? []).map((c: any) => c.id);
  const optionsByCase: Record<string, any[]> = {};
  const countByCase: Record<string, number> = {};
  if (ids.length) {
    const { data: opts } = await supabase.from("eeg_case_options").select("*").in("case_id", ids).order("sort_order");
    for (const o of opts ?? []) (optionsByCase[o.case_id] ||= []).push(o);
    const { data: resp } = await supabase.from("eeg_responses").select("case_id").in("case_id", ids);
    for (const r of resp ?? []) countByCase[r.case_id] = (countByCase[r.case_id] || 0) + 1;
  }
  const result = (cases ?? []).map((c: any) => ({
    ...mapCase(c, optionsByCase[c.id] ?? []),
    responseCount: countByCase[c.id] ?? 0,
  }));
  return NextResponse.json({ success: true, cases: result });
}

// POST: create/update/publish/approve/archive/delete. Admin only.
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const supabase = createServerClient()!;

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const action = String(body.action || "save");

  // lifecycle transitions
  if (["publish", "approve", "archive", "delete"].includes(action)) {
    const id = String(body.id || "");
    if (!id) return NextResponse.json({ error: "Missing case id." }, { status: 400 });
    if (action === "delete") {
      const { error } = await supabase.from("eeg_cases").delete().eq("id", id);
      if (error) return NextResponse.json({ error: "Delete failed." }, { status: 500 });
      return NextResponse.json({ success: true });
    }
    const patch: any = { reviewed_by: auth.userId };
    if (action === "approve") patch.status = "approved";
    if (action === "archive") patch.status = "archived";
    if (action === "publish") {
      // Enforce the image sourcing/licensing gate before anything goes live.
      const { data: row } = await supabase
        .from("eeg_cases")
        .select("image_url,image_license,image_attribution")
        .eq("id", id)
        .single();
      const missing = caseImagePublishBlock({
        imageUrl: row?.image_url ?? "",
        imageLicense: row?.image_license ?? null,
        imageAttribution: row?.image_attribution ?? null,
      });
      if (missing) {
        return NextResponse.json({ error: `Cannot publish: this case needs ${missing}.` }, { status: 400 });
      }
      patch.status = "published";
      patch.publish_date = body.publishDate || new Date().toISOString().slice(0, 10);
    }
    const { error } = await supabase.from("eeg_cases").update(patch).eq("id", id);
    if (error) return NextResponse.json({ error: "Update failed." }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  // save (create or update) with options
  const input = body.case as any;
  if (!input || !input.title || !input.questionPrompt) {
    return NextResponse.json({ error: "Title and question prompt are required." }, { status: 400 });
  }
  const row: any = {
    title: String(input.title).slice(0, 300),
    clinical_vignette: input.clinicalVignette ?? null,
    image_url: input.imageUrl ?? "",
    image_license: input.imageLicense ?? null,
    image_attribution: input.imageAttribution ?? null,
    image_source_url: input.imageSourceUrl ?? null,
    question_type: input.questionType === "point_to_feature" ? "point_to_feature" : "multiple_choice",
    question_prompt: String(input.questionPrompt).slice(0, 500),
    explanation: input.explanation ?? null,
    teaching_points: Array.isArray(input.teachingPoints) ? input.teachingPoints : [],
    correct_region: (input.correctRegion as Region) ?? null,
    region_tolerance: input.regionTolerance ?? null,
    difficulty: input.difficulty ?? "intermediate",
    tags: Array.isArray(input.tags) ? input.tags : [],
    source: input.source === "ai" ? "ai" : "team",
    ai_source_url: input.aiSourceUrl ?? null,
    ai_model: input.aiModel ?? null,
    status: input.status ?? "draft",
    publish_date: input.publishDate ?? null,
  };

  let caseId = String(input.id || "");
  if (caseId) {
    const { error } = await supabase.from("eeg_cases").update(row).eq("id", caseId);
    if (error) return NextResponse.json({ error: "Save failed." }, { status: 500 });
  } else {
    row.created_by = auth.userId;
    const { data, error } = await supabase.from("eeg_cases").insert(row).select("id").single();
    if (error || !data) return NextResponse.json({ error: "Create failed." }, { status: 500 });
    caseId = data.id;
  }

  // replace options for multiple-choice
  if (row.question_type === "multiple_choice" && Array.isArray(input.options)) {
    await supabase.from("eeg_case_options").delete().eq("case_id", caseId);
    const rows = input.options
      .filter((o: any) => o && String(o.label || "").trim())
      .map((o: any, i: number) => ({
        case_id: caseId,
        label: String(o.label).slice(0, 300),
        is_correct: !!o.isCorrect,
        option_explanation: o.optionExplanation ?? null,
        sort_order: i,
      }));
    if (rows.length) {
      const { error } = await supabase.from("eeg_case_options").insert(rows);
      if (error) return NextResponse.json({ error: "Saving options failed." }, { status: 500 });
    }
  }

  return NextResponse.json({ success: true, id: caseId });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
