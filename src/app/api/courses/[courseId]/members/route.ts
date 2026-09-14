import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getCourseDetail, identitiesByEmail, requireCourse } from "@/lib/courses/server";
import { isValidEmail } from "@/lib/validation";

export const runtime = "nodejs";

// Roster (managers only).
//   POST   { emails: string[], role?: "student" | "instructor" } → add; existing rows are left alone
//   DELETE ?email=<email>                                          → remove one member
// Both answer with the fresh roster so the page can redraw without a second call.

const NO_STORE = { headers: { "Cache-Control": "no-store, private" } };

async function rosterOf(gate: Awaited<ReturnType<typeof requireCourse>>) {
  if (!gate.ok) return [];
  const supabase = createServerClient()!;
  const { data } = await supabase.from("eeg_course_members").select("id,course_id,email,user_id,role,added_at").eq("course_id", gate.course.id);
  const detail = await getCourseDetail({ ...gate, members: (data ?? []) as typeof gate.members });
  return detail.canManage ? detail.roster : [];
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await ctx.params;
  const gate = await requireCourse(request, courseId, "manage");
  if (!gate.ok) return gate.response;
  let body: { emails?: unknown; role?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const role = body.role === "instructor" ? "instructor" : "student";
  const emails = [...new Set((Array.isArray(body.emails) ? body.emails : []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
  if (!emails.length) return NextResponse.json({ error: "Give at least one email." }, { status: 400 });
  const bad = emails.filter((e) => !isValidEmail(e));
  if (bad.length) return NextResponse.json({ error: `Not an email: ${bad.slice(0, 3).join(", ")}` }, { status: 400 });
  if (emails.length > 200) return NextResponse.json({ error: "At most 200 emails per request." }, { status: 400 });

  const existing = new Set(gate.members.map((m) => m.email));
  const fresh = emails.filter((e) => !existing.has(e));
  if (fresh.length) {
    const ids = await identitiesByEmail(fresh);
    const supabase = createServerClient()!;
    const { error } = await supabase.from("eeg_course_members").insert(
      fresh.map((email) => ({ course_id: courseId, email, user_id: ids.get(email)?.userId ?? null, role, added_by: gate.caller.userId })),
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ success: true, added: fresh.length, roster: await rosterOf(gate) }, NO_STORE);
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await ctx.params;
  const gate = await requireCourse(request, courseId, "manage");
  if (!gate.ok) return gate.response;
  const email = (request.nextUrl.searchParams.get("email") ?? "").trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "email is required." }, { status: 400 });
  const supabase = createServerClient()!;
  // marks stay (they belong to the learner on the recording); only the enrolment and the submissions go
  const asg = await supabase.from("eeg_course_assignments").select("id").eq("course_id", courseId);
  const member = gate.members.find((m) => m.email === email);
  if (member?.user_id && asg.data?.length) {
    await supabase.from("eeg_course_submissions").delete().eq("user_id", member.user_id).in("assignment_id", asg.data.map((a) => a.id));
  }
  const { error } = await supabase.from("eeg_course_members").delete().eq("course_id", courseId).eq("email", email);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, roster: await rosterOf(gate) }, NO_STORE);
}
