import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireRole } from "@/lib/admin-auth";
import { validateAnnotationInput } from "@/lib/eeg/annotations";
import { ANNOTATION_COLUMNS, UUID_RE, rowToAnnotation } from "@/lib/lab/annotations-server";

export const runtime = "nodejs";

// PATCH / DELETE one annotation. Only its author may change it — an instructor
// reads a learner's marks, never edits them, so the comparison stays honest.
//
// PATCH replaces the whole mark, target columns (`pane`, `trend_row`,
// `channels`, `region`) included, so retargeting is an ordinary edit.

type Ctx = { params: Promise<{ id: string; annotationId: string }> };

async function own(request: NextRequest, ctx: Ctx) {
  const auth = await requireRole(request, "member");
  if (!auth.ok) return { error: auth.response };
  const { id, annotationId } = await ctx.params;
  if (!UUID_RE.test(id) || !UUID_RE.test(annotationId)) {
    return { error: NextResponse.json({ error: "Not an id." }, { status: 400 }) };
  }
  const supabase = createServerClient();
  if (!supabase) return { error: NextResponse.json({ error: "The teaching lab is not configured." }, { status: 503 }) };
  const { data } = await supabase
    .from("eeg_lab_annotations")
    .select("id,user_id,job_id")
    .eq("id", annotationId)
    .eq("job_id", id)
    .maybeSingle();
  if (!data) return { error: NextResponse.json({ error: "Annotation not found." }, { status: 404 }) };
  if ((data as { user_id: string }).user_id !== auth.userId) {
    return { error: NextResponse.json({ error: "Only the author can change this annotation." }, { status: 403 }) };
  }
  return { auth, supabase, id, annotationId };
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const r = await own(request, ctx);
  if ("error" in r) return r.error;
  const { data: job } = await r.supabase.from("eeg_lab_jobs").select("duration_s").eq("id", r.id).maybeSingle();
  const body = await request.json().catch(() => null);
  const parsed = validateAnnotationInput(body, (job as { duration_s: number } | null)?.duration_s ?? Infinity);
  if (!parsed.value) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;
  const { data, error } = await r.supabase
    .from("eeg_lab_annotations")
    .update({
      onset_s: v.onsetS, duration_s: v.durationS, kind: v.kind, label: v.label, note: v.note,
      pane: v.pane, trend_row: v.trendRow, channels: v.channels, region: v.region,
    })
    .eq("id", r.annotationId)
    .select(ANNOTATION_COLUMNS)
    .single();
  if (error || !data) {
    console.error("[EEG Lab] annotation update failed:", error?.message);
    return NextResponse.json({ error: "Could not update the annotation." }, { status: 500 });
  }
  return NextResponse.json({ success: true, annotation: rowToAnnotation(data, r.auth.userId) });
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const r = await own(request, ctx);
  if ("error" in r) return r.error;
  const { error } = await r.supabase.from("eeg_lab_annotations").delete().eq("id", r.annotationId);
  if (error) {
    console.error("[EEG Lab] annotation delete failed:", error.message);
    return NextResponse.json({ error: "Could not delete the annotation." }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
