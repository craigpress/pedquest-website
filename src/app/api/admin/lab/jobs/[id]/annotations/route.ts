import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireRole } from "@/lib/admin-auth";
import { hasRole } from "@/lib/roles";
import { validateAnnotationInput } from "@/lib/eeg/annotations";
import { ANNOTATION_COLUMNS, UUID_RE, rowToAnnotation } from "@/lib/lab/annotations-server";

export const runtime = "nodejs";

// Viewer annotations on one lab recording.
//
// GET  /api/admin/lab/jobs/<uuid>/annotations         → the caller's own marks
// GET  /api/admin/lab/jobs/<uuid>/annotations?all=1   → everyone's (editors only)
// POST /api/admin/lab/jobs/<uuid>/annotations         → create one, owned by the caller
//
// Gated at editor today like everything under /api/admin. The per-user model
// is already in the data, so opening the viewer to members later is a change
// to the role argument here, not to the table.

async function loadJob(id: string) {
  const supabase = createServerClient();
  if (!supabase) return { supabase: null, job: null };
  const { data } = await supabase
    .from("eeg_lab_jobs")
    .select("id,duration_s,status")
    .eq("id", id)
    .maybeSingle();
  return { supabase, job: data as { id: string; duration_s: number; status: string } | null };
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, "editor");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not a job id." }, { status: 400 });

  const { supabase, job } = await loadJob(id);
  if (!supabase) return NextResponse.json({ error: "The teaching lab is not configured." }, { status: 503 });
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  const all = request.nextUrl.searchParams.get("all") === "1" && hasRole(auth.role, "editor");
  let q = supabase.from("eeg_lab_annotations").select(ANNOTATION_COLUMNS).eq("job_id", id).order("onset_s");
  if (!all) q = q.eq("user_id", auth.userId);
  const { data, error } = await q;
  if (error) {
    console.error("[EEG Lab] annotations list failed:", error.message);
    return NextResponse.json({ error: "Could not read annotations." }, { status: 500 });
  }
  return NextResponse.json(
    { success: true, annotations: (data ?? []).map((r) => rowToAnnotation(r, auth.userId)) },
    { headers: { "Cache-Control": "no-store, private" } },
  );
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, "editor");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not a job id." }, { status: 400 });

  const { supabase, job } = await loadJob(id);
  if (!supabase) return NextResponse.json({ error: "The teaching lab is not configured." }, { status: 503 });
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = validateAnnotationInput(body, job.duration_s);
  if (!parsed.value) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;

  const { data, error } = await supabase
    .from("eeg_lab_annotations")
    .insert({
      job_id: id, user_id: auth.userId, user_email: auth.email,
      onset_s: v.onsetS, duration_s: v.durationS, kind: v.kind, label: v.label, note: v.note,
    })
    .select(ANNOTATION_COLUMNS)
    .single();
  if (error || !data) {
    console.error("[EEG Lab] annotation insert failed:", error?.message);
    return NextResponse.json({ error: "Could not save the annotation." }, { status: 500 });
  }
  return NextResponse.json({ success: true, annotation: rowToAnnotation(data, auth.userId) }, { status: 201 });
}
