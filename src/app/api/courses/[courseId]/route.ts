import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { COURSE_COLUMNS, getCourseDetail, requireCourse, type CourseRow } from "@/lib/courses/server";
import { hasRole } from "@/lib/roles";

export const runtime = "nodejs";

// One course.
//   GET    → CourseDetail (teacher or student shape, by membership)
//   PATCH  → title / description / status / dates (managers)
//   DELETE → the course and everything under it (owner or admin)

const NO_STORE = { headers: { "Cache-Control": "no-store, private" } };

export async function GET(request: NextRequest, ctx: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await ctx.params;
  const gate = await requireCourse(request, courseId, "view");
  if (!gate.ok) return gate.response;
  const course = await getCourseDetail(gate);
  return NextResponse.json({ success: true, course }, NO_STORE);
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await ctx.params;
  const gate = await requireCourse(request, courseId, "manage");
  if (!gate.ok) return gate.response;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }

  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string") {
    const t = body.title.trim().slice(0, 160);
    if (!t) return NextResponse.json({ error: "A course title is required." }, { status: 400 });
    patch.title = t;
  }
  if (typeof body.description === "string") patch.description = body.description.trim().slice(0, 4000);
  if (body.status !== undefined) {
    if (body.status !== "draft" && body.status !== "active" && body.status !== "archived") return NextResponse.json({ error: "status must be draft, active or archived." }, { status: 400 });
    patch.status = body.status;
  }
  for (const [k, col] of [["startsAt", "starts_at"], ["endsAt", "ends_at"]] as const) {
    if (body[k] === null || body[k] === "") patch[col] = null;
    else if (typeof body[k] === "string") {
      if (!Number.isFinite(Date.parse(body[k] as string))) return NextResponse.json({ error: `${k} is not a date.` }, { status: 400 });
      patch[col] = new Date(body[k] as string).toISOString();
    }
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update." }, { status: 400 });

  const supabase = createServerClient()!;
  const { data, error } = await supabase.from("eeg_courses").update(patch).eq("id", courseId).select(COURSE_COLUMNS).single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not update the course." }, { status: 500 });
  const c = data as CourseRow;
  const detail = await getCourseDetail({ ...gate, course: c });
  return NextResponse.json({ success: true, course: detail }, NO_STORE);
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await ctx.params;
  const gate = await requireCourse(request, courseId, "manage");
  if (!gate.ok) return gate.response;
  if (gate.viewerRole !== "owner" && !hasRole(gate.caller.role, "admin")) {
    return NextResponse.json({ error: "Only the course owner or an admin can delete a course." }, { status: 403 });
  }
  const supabase = createServerClient()!;
  const { error } = await supabase.from("eeg_courses").delete().eq("id", courseId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  console.info(`[courses] ${gate.caller.email} deleted course ${courseId} "${gate.course.title}"`);
  return NextResponse.json({ success: true }, NO_STORE);
}
