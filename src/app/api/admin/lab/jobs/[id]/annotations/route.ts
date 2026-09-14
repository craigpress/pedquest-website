import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireRole } from "@/lib/admin-auth";
import { hasRole, type Role } from "@/lib/roles";
import { canSeeRecording } from "@/lib/lab/visibility";
import { validateAnnotationInput } from "@/lib/eeg/annotations";
import { ANNOTATION_COLUMNS, UUID_RE, rowToAnnotation } from "@/lib/lab/annotations-server";

export const runtime = "nodejs";

// Viewer annotations on one lab recording.
//
// GET  /api/admin/lab/jobs/<uuid>/annotations         → the caller's own marks
// GET  /api/admin/lab/jobs/<uuid>/annotations?all=1   → everyone's (teachers and up)
// POST /api/admin/lab/jobs/<uuid>/annotations         → create one, owned by the caller
//
// Open to any signed-in member since 2026-09-13 (the viewer is a learner
// tool); marks are per user, and `all=1` needs `teacher` — seeing the class's
// marks is a teaching act, not an editing one.
//
// A mark carries its target alongside its time: `pane`, `trend_row`,
// `channels`, `region` (migration 20260915_teacher_role_test_users_annotation_targets).

type JobRow = { id: string; duration_s: number; status: string; review_status: string; author_id: string | null };

/** The job, or null when it does not exist OR the caller may not see it (same 404 either way). */
async function loadJob(id: string, viewer: { userId: string; role: Role }) {
  const supabase = createServerClient();
  if (!supabase) return { supabase: null, job: null };
  const { data } = await supabase
    .from("eeg_lab_jobs")
    .select("id,duration_s,status,review_status,author_id")
    .eq("id", id)
    .maybeSingle();
  const row = data as JobRow | null;
  const visible = row && canSeeRecording(viewer, { reviewStatus: row.review_status, authorId: row.author_id });
  return { supabase, job: visible ? row : null };
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, "member");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not a job id." }, { status: 400 });

  const { supabase, job } = await loadJob(id, auth);
  if (!supabase) return NextResponse.json({ error: "The teaching lab is not configured." }, { status: 503 });
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  const all = request.nextUrl.searchParams.get("all") === "1" && hasRole(auth.role, "teacher");
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
  const auth = await requireRole(request, "member");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not a job id." }, { status: 400 });

  const { supabase, job } = await loadJob(id, auth);
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
      pane: v.pane, trend_row: v.trendRow, channels: v.channels, region: v.region,
    })
    .select(ANNOTATION_COLUMNS)
    .single();
  if (error || !data) {
    console.error("[EEG Lab] annotation insert failed:", error?.message);
    return NextResponse.json({ error: "Could not save the annotation." }, { status: 500 });
  }
  return NextResponse.json({ success: true, annotation: rowToAnnotation(data, auth.userId) }, { status: 201 });
}
