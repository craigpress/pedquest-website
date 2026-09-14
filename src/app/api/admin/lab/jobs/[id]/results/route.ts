import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/admin-auth";
import { computeJobResults } from "@/lib/lab/results-server";
import { canManageCourse, requireCourse, identitiesByEmail } from "@/lib/courses/server";
import { createServerClient } from "@/lib/supabase";
import type { SubmissionState } from "@/lib/courses/types";

export const runtime = "nodejs";

// Class results for one lab recording: every learner's marks graded against
// the answer key (src/lib/lab/results-server.ts). Teachers and up.
//
// GET /api/admin/lab/jobs/<uuid>/results[?course=<uuid>]
//
// With `course`, the caller must manage that course and the learners are
// restricted to its roster; each learner then also carries the course
// submission state for the assignment that uses this recording.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { headers: { "Cache-Control": "no-store" } };

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const courseId = request.nextUrl.searchParams.get("course");

  if (!courseId) {
    const auth = await requireRole(request, "teacher");
    if (!auth.ok) return auth.response;
    const out = await computeJobResults(id, { userId: auth.userId, role: auth.role });
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ success: true, ...out.results, course: null }, NO_STORE);
  }

  // course scope: managers of that course, even a member-role instructor who is not a site teacher
  const gate = await requireCourse(request, courseId, "manage");
  if (!gate.ok) return gate.response;
  if (!canManageCourse(gate.viewerRole)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const students = gate.members.filter((m) => m.role === "student");
  const ids = await identitiesByEmail(students.map((s) => s.email));
  const userIds = students.map((s) => s.user_id ?? ids.get(s.email)?.userId ?? null).filter((x): x is string => !!x);
  const out = await computeJobResults(id, { userId: gate.caller.userId, role: gate.caller.role }, { onlyUserIds: new Set(userIds) });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });

  // submission state per learner for the assignment(s) on this recording in this course
  const supabase = createServerClient()!;
  const { data: asg } = await supabase.from("eeg_course_assignments").select("id,due_at").eq("course_id", courseId).eq("job_id", id);
  const asgIds = (asg ?? []).map((a: any) => a.id as string);
  const dueAt = (asg ?? [])[0]?.due_at ?? null;
  const { data: subs } = asgIds.length
    ? await supabase.from("eeg_course_submissions").select("user_id,status,opened_at,submitted_at,returned_at,feedback").in("assignment_id", asgIds)
    : { data: [] as any[] };
  const submissions: Record<string, Partial<SubmissionState>> = {};
  for (const s of (subs ?? []) as any[]) {
    submissions[s.user_id] = {
      status: s.status, openedAt: s.opened_at, submittedAt: s.submitted_at, returnedAt: s.returned_at, feedback: s.feedback ?? "",
      late: Boolean(s.submitted_at && dueAt && Date.parse(s.submitted_at) > Date.parse(dueAt)),
    };
  }
  // roster students with no marks still belong in a course view
  const seen = new Set(out.results.learners.map((l) => l.userId));
  const missing = students
    .map((s) => ({ s, uid: s.user_id ?? ids.get(s.email)?.userId ?? null }))
    .filter(({ uid }) => uid && !seen.has(uid))
    .map(({ s, uid }) => ({
      userId: uid!, email: s.email, displayName: ids.get(s.email)?.displayName ?? null, role: "member" as const,
      isTest: ids.get(s.email)?.isTest ?? false, isInstructor: false, marks: [], scores: {},
    }));

  return NextResponse.json({
    success: true,
    ...out.results,
    learners: [...out.results.learners, ...missing],
    course: { id: gate.course.id, title: gate.course.title, assignmentId: asgIds[0] ?? null, dueAt, submissions },
  }, NO_STORE);
}
