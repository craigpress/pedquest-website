import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireCourse, UUID_RE } from "@/lib/courses/server";
import { canSeeRecording } from "@/lib/lab/visibility";

export const runtime = "nodejs";

// Assign a recording to a course (managers).
//   POST { jobId, title?, instructions?, taskId?, dueAt? } → { assignment }
// The recording must be one the teacher can see (published, or theirs) — a
// student then reads it through the normal lab visibility as a member.

const DEFAULT_INSTRUCTIONS = "Mark every electrographic seizure from onset to offset and say which channels or region.";

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function POST(request: NextRequest, ctx: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await ctx.params;
  const gate = await requireCourse(request, courseId, "manage");
  if (!gate.ok) return gate.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  if (!UUID_RE.test(jobId)) return NextResponse.json({ error: "jobId is required." }, { status: 400 });

  const supabase = createServerClient()!;
  const { data: job } = await supabase.from("eeg_lab_jobs").select("id,title,duration_s,status,review_status,author_id").eq("id", jobId).maybeSingle();
  if (!job || job.status !== "done" || !canSeeRecording({ userId: gate.caller.userId, role: gate.caller.role }, { reviewStatus: job.review_status, authorId: job.author_id })) {
    return NextResponse.json({ error: "That recording is not available to assign." }, { status: 404 });
  }
  if (job.review_status !== "published") {
    return NextResponse.json({ error: "Only published recordings can be assigned — students cannot open the others." }, { status: 409 });
  }

  const { data: last } = await supabase.from("eeg_course_assignments").select("sort_order").eq("course_id", courseId).order("sort_order", { ascending: false }).limit(1);
  const dueAt = typeof body.dueAt === "string" && body.dueAt && Number.isFinite(Date.parse(body.dueAt)) ? new Date(body.dueAt).toISOString() : null;
  const { data, error } = await supabase
    .from("eeg_course_assignments")
    .insert({
      course_id: courseId,
      job_id: jobId,
      title: typeof body.title === "string" ? body.title.trim().slice(0, 200) : "",
      instructions: typeof body.instructions === "string" ? body.instructions.trim().slice(0, 4000) : DEFAULT_INSTRUCTIONS,
      task_id: body.taskId === "discharge" ? "discharge" : "seizure",
      due_at: dueAt,
      sort_order: ((last?.[0] as any)?.sort_order ?? -1) + 1,
      created_by: gate.caller.userId,
    })
    .select("id,course_id,job_id,title,instructions,task_id,due_at,sort_order,published,created_at")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not add the assignment." }, { status: 500 });
  const a = data as any;
  return NextResponse.json({
    success: true,
    assignment: {
      id: a.id, courseId: a.course_id, jobId: a.job_id, title: a.title || job.title || "Recording", instructions: a.instructions,
      taskId: a.task_id, dueAt: a.due_at, sortOrder: a.sort_order, published: a.published, createdAt: a.created_at,
      recordingTitle: job.title ?? null, durationS: Number(job.duration_s),
    },
  }, { status: 201, headers: { "Cache-Control": "no-store, private" } });
}
