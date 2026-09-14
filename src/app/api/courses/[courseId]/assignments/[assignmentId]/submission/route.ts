import { NextRequest, NextResponse } from "next/server";
import { applySubmissionAction, requireCourse, UUID_RE } from "@/lib/courses/server";

export const runtime = "nodejs";

// Submission state for one student on one assignment.
//   POST { action: "open" | "submit" | "unsubmit" }         — the student, own row
//   POST { action: "return", email, feedback }              — a manager, on a student's row
// → { submission: SubmissionState }
// "open" is what the viewer sends when a student first loads an assigned
// recording; it turns "not started" into "in progress" even before a mark.

export async function POST(request: NextRequest, ctx: { params: Promise<{ courseId: string; assignmentId: string }> }) {
  const { courseId, assignmentId } = await ctx.params;
  if (!UUID_RE.test(assignmentId)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const gate = await requireCourse(request, courseId, "view");
  if (!gate.ok) return gate.response;
  let body: { action?: string; email?: string; feedback?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const out = await applySubmissionAction(gate, assignmentId, body);
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
  return NextResponse.json({ success: true, submission: out.submission }, { headers: { "Cache-Control": "no-store, private" } });
}
