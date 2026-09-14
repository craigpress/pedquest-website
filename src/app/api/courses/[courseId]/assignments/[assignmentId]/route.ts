import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getAssignmentForViewer, requireCourse, UUID_RE } from "@/lib/courses/server";

export const runtime = "nodejs";

// One assignment.
//   GET    → { assignment, my: SubmissionState, course: {id,title}, canManage }  (any member; the viewer header)
//   PATCH  → title / instructions / dueAt / published / sortOrder                 (managers)
//   DELETE → remove the assignment and its submissions                             (managers)

const NO_STORE = { headers: { "Cache-Control": "no-store, private" } };
type Params = { params: Promise<{ courseId: string; assignmentId: string }> };

export async function GET(request: NextRequest, ctx: Params) {
  const { courseId, assignmentId } = await ctx.params;
  if (!UUID_RE.test(assignmentId)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const gate = await requireCourse(request, courseId, "view");
  if (!gate.ok) return gate.response;
  const out = await getAssignmentForViewer(gate, assignmentId);
  if (!out) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ success: true, ...out, course: { id: gate.course.id, title: gate.course.title } }, NO_STORE);
}

export async function PATCH(request: NextRequest, ctx: Params) {
  const { courseId, assignmentId } = await ctx.params;
  if (!UUID_RE.test(assignmentId)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const gate = await requireCourse(request, courseId, "manage");
  if (!gate.ok) return gate.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string") patch.title = body.title.trim().slice(0, 200);
  if (typeof body.instructions === "string") patch.instructions = body.instructions.trim().slice(0, 4000);
  if (typeof body.published === "boolean") patch.published = body.published;
  if (typeof body.sortOrder === "number" && Number.isInteger(body.sortOrder)) patch.sort_order = body.sortOrder;
  if (body.taskId === "seizure" || body.taskId === "discharge") patch.task_id = body.taskId;
  if (body.dueAt === null || body.dueAt === "") patch.due_at = null;
  else if (typeof body.dueAt === "string") {
    if (!Number.isFinite(Date.parse(body.dueAt))) return NextResponse.json({ error: "dueAt is not a date." }, { status: 400 });
    patch.due_at = new Date(body.dueAt).toISOString();
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  const supabase = createServerClient()!;
  const { error } = await supabase.from("eeg_course_assignments").update(patch).eq("id", assignmentId).eq("course_id", courseId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const out = await getAssignmentForViewer(gate, assignmentId);
  if (!out) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ success: true, assignment: out.assignment }, NO_STORE);
}

export async function DELETE(request: NextRequest, ctx: Params) {
  const { courseId, assignmentId } = await ctx.params;
  if (!UUID_RE.test(assignmentId)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const gate = await requireCourse(request, courseId, "manage");
  if (!gate.ok) return gate.response;
  const supabase = createServerClient()!;
  const { error } = await supabase.from("eeg_course_assignments").delete().eq("id", assignmentId).eq("course_id", courseId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true }, NO_STORE);
}
