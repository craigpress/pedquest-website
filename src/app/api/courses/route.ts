import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireRole } from "@/lib/admin-auth";
import { COURSE_COLUMNS, listCoursesFor, type CourseRow } from "@/lib/courses/server";

export const runtime = "nodejs";

// Courses.
//   GET  /api/courses  → { teaching: CourseSummary[], enrolled: CourseSummary[] } for the caller
//   POST /api/courses  → create one (teacher+); the creator owns it
// Membership rules live in src/lib/courses/server.ts.

const NO_STORE = { headers: { "Cache-Control": "no-store, private" } };

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, "member");
  if (!auth.ok) return auth.response;
  const lists = await listCoursesFor({ userId: auth.userId, email: auth.email.toLowerCase(), role: auth.role });
  return NextResponse.json({ success: true, ...lists }, NO_STORE);
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, "teacher");
  if (!auth.ok) return auth.response;
  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  let body: { title?: unknown; description?: unknown; startsAt?: unknown; endsAt?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 160) : "";
  if (!title) return NextResponse.json({ error: "A course title is required." }, { status: 400 });
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 4000) : "";
  const date = (v: unknown) => (typeof v === "string" && v && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);

  const { data, error } = await supabase
    .from("eeg_courses")
    .insert({ title, description, owner_id: auth.userId, owner_email: auth.email.toLowerCase(), starts_at: date(body.startsAt), ends_at: date(body.endsAt) })
    .select(COURSE_COLUMNS)
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Could not create the course." }, { status: 500 });
  const c = data as CourseRow;
  return NextResponse.json({
    success: true,
    course: {
      id: c.id, title: c.title, description: c.description, status: c.status, ownerId: c.owner_id, ownerEmail: c.owner_email,
      ownerName: auth.displayName ?? null, startsAt: c.starts_at, endsAt: c.ends_at, createdAt: c.created_at,
      studentCount: 0, assignmentCount: 0, myRole: "owner", progress: null, completion: null,
    },
  }, { status: 201, ...NO_STORE });
}
