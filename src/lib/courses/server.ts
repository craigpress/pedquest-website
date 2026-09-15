// Courses — server-only data access and derivations. Service-role client;
// membership is checked here in code because the tables have RLS with no
// policies (migration 20260915_eeg_courses.sql). NEVER import from a
// "use client" module.
//
// One rule decides everything: a caller MANAGES a course when they own it,
// are enrolled as an instructor, are a site admin, or are an editor and the
// course is a demo (owned by a test account); a caller VIEWS a course when
// they manage it or are enrolled as a student. Students are matched by
// email (enrolment can precede the first sign-in); user_id is backfilled on
// the way through so marks and submissions can be joined.

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireRole, type AuthOk } from "@/lib/admin-auth";
import { hasRole, type Role } from "@/lib/roles";
import { computeJobResults } from "@/lib/lab/results-server";
import {
  isDone, type AssignmentStats, type CourseAssignment, type CourseDetail, type CourseKpis, type CourseMemberRole,
  type CourseStatus, type CourseSummary, type CourseViewerRole, type RosterEntry, type StudentStats, type SubmissionState,
  type SubmissionStatus,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CourseRow {
  id: string; title: string; description: string; status: CourseStatus; owner_id: string; owner_email: string;
  starts_at: string | null; ends_at: string | null; created_at: string;
}
export interface MemberRow {
  id: string; course_id: string; email: string; user_id: string | null; role: CourseMemberRole; added_at: string;
}
interface AssignmentRow {
  id: string; course_id: string; job_id: string; title: string; instructions: string; task_id: string; due_at: string | null;
  sort_order: number; published: boolean; created_at: string;
}
interface SubmissionRow {
  id: string; assignment_id: string; user_id: string; email: string; status: "in_progress" | "submitted" | "returned";
  opened_at: string | null; submitted_at: string | null; returned_at: string | null; feedback: string; updated_at: string;
}

export const COURSE_COLUMNS = "id,title,description,status,owner_id,owner_email,starts_at,ends_at,created_at";
const MEMBER_COLUMNS = "id,course_id,email,user_id,role,added_at";
const ASSIGNMENT_COLUMNS = "id,course_id,job_id,title,instructions,task_id,due_at,sort_order,published,created_at";
const SUBMISSION_COLUMNS = "id,assignment_id,user_id,email,status,opened_at,submitted_at,returned_at,feedback,updated_at";
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Caller = { userId: string; email: string; role: Role };

// ── access ────────────────────────────────────────────────────────────────

export function viewerRoleFor(course: CourseRow, members: MemberRow[], caller: Caller, ownerIsTest = false): CourseViewerRole | null {
  if (hasRole(caller.role, "admin")) return "admin";
  if (course.owner_id === caller.userId) return "owner";
  const me = members.find((m) => m.email === caller.email.toLowerCase());
  if (me?.role === "instructor") return "instructor";
  // demo classes: every editor can run them so they can show the feature
  if (ownerIsTest && hasRole(caller.role, "editor")) return "instructor";
  if (me?.role === "student") return "student";
  return null;
}

export const canManageCourse = (r: CourseViewerRole | null) => r === "owner" || r === "instructor" || r === "admin";

export type CourseGate =
  | { ok: true; auth: AuthOk; caller: Caller; course: CourseRow; members: MemberRow[]; viewerRole: CourseViewerRole }
  | { ok: false; response: NextResponse };

/** Authenticate, load the course and its roster, and check the caller may view (or manage) it. 404 either way when they may not. */
export async function requireCourse(request: NextRequest, courseId: string, need: "view" | "manage"): Promise<CourseGate> {
  const auth = await requireRole(request, "member");
  if (!auth.ok) return auth;
  if (!UUID_RE.test(courseId)) return { ok: false, response: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  const supabase = createServerClient();
  if (!supabase) return { ok: false, response: NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }) };
  const [{ data: course }, { data: members }] = await Promise.all([
    supabase.from("eeg_courses").select(COURSE_COLUMNS).eq("id", courseId).maybeSingle(),
    supabase.from("eeg_course_members").select(MEMBER_COLUMNS).eq("course_id", courseId),
  ]);
  if (!course) return { ok: false, response: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  const caller: Caller = { userId: auth.userId, email: auth.email.toLowerCase(), role: auth.role };
  const roster = (members ?? []) as MemberRow[];
  const ownerEmail = (course as CourseRow).owner_email.toLowerCase();
  const ownerIsTest = (await identitiesByEmail([ownerEmail])).get(ownerEmail)?.isTest ?? false;
  const viewerRole = viewerRoleFor(course as CourseRow, roster, caller, ownerIsTest);
  if (!viewerRole || (need === "manage" && !canManageCourse(viewerRole))) {
    return { ok: false, response: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  }
  await backfillMemberUserId(roster, caller);
  return { ok: true, auth, caller, course: course as CourseRow, members: roster, viewerRole };
}

/** A student enrolled by email before their first sign-in gets their user_id linked the first time they show up. */
async function backfillMemberUserId(members: MemberRow[], caller: Caller) {
  const supabase = createServerClient();
  if (!supabase) return;
  const mine = members.filter((m) => m.email === caller.email && !m.user_id);
  if (!mine.length) return;
  await supabase.from("eeg_course_members").update({ user_id: caller.userId }).in("id", mine.map((m) => m.id));
  for (const m of mine) m.user_id = caller.userId;
}

// ── names ─────────────────────────────────────────────────────────────────

interface Identity { email: string; userId: string | null; displayName: string | null; isTest: boolean }

/** user_roles rows for a set of emails: names, test flags, and user ids for members enrolled before sign-in. */
export async function identitiesByEmail(emails: string[]): Promise<Map<string, Identity>> {
  const out = new Map<string, Identity>();
  const supabase = createServerClient();
  const lower = [...new Set(emails.map((e) => e.toLowerCase()))];
  if (!supabase || !lower.length) return out;
  const { data } = await supabase.from("user_roles").select("email,user_id,display_name,is_test").in("email", lower);
  for (const r of (data ?? []) as any[]) {
    out.set(String(r.email), { email: String(r.email), userId: r.user_id ?? null, displayName: r.display_name ?? null, isTest: Boolean(r.is_test) });
  }
  return out;
}

// ── mapping ───────────────────────────────────────────────────────────────

function toSummary(
  c: CourseRow,
  members: MemberRow[],
  identities: Map<string, Identity>,
  extra: Pick<CourseSummary, "studentCount" | "assignmentCount" | "myRole" | "progress" | "completion">,
): CourseSummary {
  const ownerEmail = c.owner_email.toLowerCase();
  const owner = identities.get(ownerEmail);
  const teachers = [
    { email: ownerEmail, displayName: owner?.displayName ?? null },
    ...members.filter((m) => m.role === "instructor" && m.email !== ownerEmail)
      .map((m) => ({ email: m.email, displayName: identities.get(m.email)?.displayName ?? null })),
  ];
  return {
    id: c.id, title: c.title, description: c.description, status: c.status, ownerId: c.owner_id, ownerEmail: c.owner_email,
    ownerName: owner?.displayName ?? null, teachers, isDemo: owner?.isTest ?? false,
    startsAt: c.starts_at, endsAt: c.ends_at, createdAt: c.created_at, ...extra,
  };
}

function toAssignment(a: AssignmentRow, job: { title: string | null; duration_s: number } | undefined): CourseAssignment {
  return {
    id: a.id, courseId: a.course_id, jobId: a.job_id, title: a.title || job?.title || "Recording", instructions: a.instructions,
    taskId: a.task_id, dueAt: a.due_at, sortOrder: a.sort_order, published: a.published, createdAt: a.created_at,
    recordingTitle: job?.title ?? null, durationS: Number(job?.duration_s ?? 0),
  };
}

const EMPTY_STATE: SubmissionState = {
  status: "not_started", markCount: 0, openedAt: null, submittedAt: null, returnedAt: null, feedback: "", late: false,
  score: null, sensitivity: null, falseAlarms: null, medianLatencyS: null,
};

function stateFrom(sub: SubmissionRow | undefined, markCount: number, dueAt: string | null): SubmissionState {
  if (!sub) return { ...EMPTY_STATE, markCount, status: markCount > 0 ? "in_progress" : "not_started" };
  const status: SubmissionStatus = sub.status;
  const late = Boolean(sub.submitted_at && dueAt && Date.parse(sub.submitted_at) > Date.parse(dueAt));
  return {
    ...EMPTY_STATE, status, markCount, openedAt: sub.opened_at, submittedAt: sub.submitted_at, returnedAt: sub.returned_at,
    feedback: sub.feedback ?? "", late,
  };
}

// ── listing ───────────────────────────────────────────────────────────────

async function loadJobsFor(jobIds: string[]): Promise<Map<string, { title: string | null; duration_s: number }>> {
  const out = new Map<string, { title: string | null; duration_s: number }>();
  const supabase = createServerClient();
  if (!supabase || !jobIds.length) return out;
  const { data } = await supabase.from("eeg_lab_jobs").select("id,title,duration_s").in("id", [...new Set(jobIds)]);
  for (const j of (data ?? []) as any[]) out.set(j.id, { title: j.title ?? null, duration_s: Number(j.duration_s) });
  return out;
}

/** Courses the caller teaches (owner / instructor / every course for admins) and courses they are enrolled in as a student. */
export async function listCoursesFor(caller: Caller): Promise<{ teaching: CourseSummary[]; enrolled: CourseSummary[] }> {
  const supabase = createServerClient();
  if (!supabase) return { teaching: [], enrolled: [] };

  const { data: myMemberships } = await supabase.from("eeg_course_members").select(MEMBER_COLUMNS).eq("email", caller.email);
  const mine = (myMemberships ?? []) as MemberRow[];
  await backfillMemberUserId(mine, caller);

  let courseQuery = supabase.from("eeg_courses").select(COURSE_COLUMNS).order("created_at", { ascending: false });
  const memberCourseIds = mine.map((m) => m.course_id);
  if (!hasRole(caller.role, "admin")) {
    const clauses = [`owner_id.eq.${caller.userId}`];
    if (memberCourseIds.length) clauses.push(`id.in.(${memberCourseIds.join(",")})`);
    if (hasRole(caller.role, "editor")) {
      // demo classes are the ones test accounts own
      const { data: testUsers } = await supabase.from("user_roles").select("user_id").eq("is_test", true).not("user_id", "is", null);
      const testIds = ((testUsers ?? []) as { user_id: string }[]).map((u) => u.user_id);
      if (testIds.length) clauses.push(`owner_id.in.(${testIds.join(",")})`);
    }
    courseQuery = courseQuery.or(clauses.join(","));
  }
  const { data: courseRows } = await courseQuery;
  const courses = (courseRows ?? []) as CourseRow[];
  if (!courses.length) return { teaching: [], enrolled: [] };
  const ids = courses.map((c) => c.id);

  const [{ data: allMembers }, { data: assignments }] = await Promise.all([
    supabase.from("eeg_course_members").select(MEMBER_COLUMNS).in("course_id", ids),
    supabase.from("eeg_course_assignments").select("id,course_id,published").in("course_id", ids).eq("published", true),
  ]);
  const members = (allMembers ?? []) as MemberRow[];
  const identities = await identitiesByEmail([
    ...courses.map((c) => c.owner_email),
    ...members.filter((m) => m.role === "instructor").map((m) => m.email),
  ]);
  const asg = (assignments ?? []) as { id: string; course_id: string }[];
  const { data: subs } = asg.length
    ? await supabase.from("eeg_course_submissions").select("assignment_id,user_id,email,status").in("assignment_id", asg.map((a) => a.id))
    : { data: [] as any[] };
  const doneSubs = ((subs ?? []) as any[]).filter((s) => isDone(s.status));

  const teaching: CourseSummary[] = [];
  const enrolled: CourseSummary[] = [];
  for (const c of courses) {
    const roster = members.filter((m) => m.course_id === c.id);
    const students = roster.filter((m) => m.role === "student");
    const cAsg = asg.filter((a) => a.course_id === c.id);
    const asgIds = new Set(cAsg.map((a) => a.id));
    const studentEmails = new Set(students.map((s) => s.email));
    const cDone = doneSubs.filter((s) => asgIds.has(s.assignment_id) && studentEmails.has(String(s.email).toLowerCase()));
    const viewerRole = viewerRoleFor(c, roster, caller, identities.get(c.owner_email.toLowerCase())?.isTest ?? false);
    if (!viewerRole) continue;
    const base = { studentCount: students.length, assignmentCount: cAsg.length, myRole: viewerRole };
    if (canManageCourse(viewerRole)) {
      const cells = students.length * cAsg.length;
      teaching.push(toSummary(c, roster, identities, { ...base, progress: null, completion: cells ? cDone.length / cells : null }));
    }
    if (viewerRole === "student") {
      const myDone = cDone.filter((s) => String(s.email).toLowerCase() === caller.email).length;
      enrolled.push(toSummary(c, roster, identities, { ...base, progress: { done: myDone, total: cAsg.length }, completion: null }));
    }
  }
  return { teaching, enrolled };
}

// ── detail ────────────────────────────────────────────────────────────────

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export async function getCourseDetail(gate: Extract<CourseGate, { ok: true }>): Promise<CourseDetail> {
  const { course, members, caller, viewerRole } = gate;
  const supabase = createServerClient()!;
  const manage = canManageCourse(viewerRole);

  const [{ data: asgRows }, identities] = await Promise.all([
    supabase.from("eeg_course_assignments").select(ASSIGNMENT_COLUMNS).eq("course_id", course.id).order("sort_order").order("created_at"),
    identitiesByEmail([...members.map((m) => m.email), course.owner_email]),
  ]);
  let assignmentsAll = (asgRows ?? []) as AssignmentRow[];
  if (!manage) assignmentsAll = assignmentsAll.filter((a) => a.published);
  const jobs = await loadJobsFor(assignmentsAll.map((a) => a.job_id));
  const assignments = assignmentsAll.map((a) => toAssignment(a, jobs.get(a.job_id)));

  const students = members.filter((m) => m.role === "student");
  const instructors = members.filter((m) => m.role === "instructor");
  // user ids: the membership row when linked, else user_roles (signed in but never opened a course)
  const userIdOf = (m: MemberRow) => m.user_id ?? identities.get(m.email)?.userId ?? null;
  const studentIds = students.map(userIdOf).filter((x): x is string => !!x);
  const idToEmail = new Map(students.map((m) => [userIdOf(m), m.email] as const).filter(([id]) => id) as [string, string][]);

  const asgIds = assignmentsAll.map((a) => a.id);
  const jobIds = [...new Set(assignmentsAll.map((a) => a.job_id))];
  const relevantIds = manage ? studentIds : [caller.userId];
  const [{ data: subRows }, { data: annRows }] = await Promise.all([
    asgIds.length ? supabase.from("eeg_course_submissions").select(SUBMISSION_COLUMNS).in("assignment_id", asgIds) : { data: [] as any[] },
    jobIds.length && relevantIds.length
      ? supabase.from("eeg_lab_annotations").select("job_id,user_id,updated_at").in("job_id", jobIds).in("user_id", relevantIds)
      : { data: [] as any[] },
  ]);
  const subs = (subRows ?? []) as SubmissionRow[];
  const marks = (annRows ?? []) as { job_id: string; user_id: string; updated_at: string }[];
  const markCount = (jobId: string, userId: string | null) => (userId ? marks.filter((m) => m.job_id === jobId && m.user_id === userId).length : 0);
  const lastMark = (userId: string | null) => {
    const ts = userId ? marks.filter((m) => m.user_id === userId).map((m) => Date.parse(m.updated_at)) : [];
    return ts.length ? new Date(Math.max(...ts)).toISOString() : null;
  };
  const subFor = (assignmentId: string, userId: string | null) => (userId ? subs.find((s) => s.assignment_id === assignmentId && s.user_id === userId) : undefined);

  const published = assignments.filter((a) => a.published);

  // ── student view ──
  if (!manage) {
    const my = published.map((a) => {
      const st = stateFrom(subFor(a.id, caller.userId), markCount(a.jobId, caller.userId), a.dueAt);
      return { ...a, my: st };
    });
    const done = my.filter((a) => isDone(a.my.status)).length;
    return {
      ...toSummary(course, members, identities, { studentCount: students.length, assignmentCount: published.length, myRole: viewerRole, progress: { done, total: published.length }, completion: null }),
      canManage: false,
      assignments: my,
    };
  }

  // ── teacher view: grade every published assignment for the roster ──
  const scoresByAssignment = new Map<string, Map<string, { score: number | null; sensitivity: number | null; falseAlarms: number | null; medianLatencyS: number | null }>>();
  await Promise.all(published.map(async (a) => {
    const m = new Map<string, { score: number | null; sensitivity: number | null; falseAlarms: number | null; medianLatencyS: number | null }>();
    scoresByAssignment.set(a.id, m);
    if (!studentIds.length) return;
    const out = await computeJobResults(a.jobId, { userId: caller.userId, role: caller.role }, { onlyUserIds: new Set(studentIds) });
    if (!out.ok || !out.results.job.hasAnswerKey) return;
    for (const l of out.results.learners) {
      const s = l.scores[a.taskId] ?? l.scores.seizure;
      if (!s) continue;
      m.set(l.userId, { score: s.composite, sensitivity: s.sensitivity, falseAlarms: s.falseAlarms, medianLatencyS: s.medianOnsetLatencyS });
    }
  }));

  const matrix: Record<string, Record<string, SubmissionState>> = {};
  for (const a of assignments) {
    matrix[a.id] = {};
    for (const s of students) {
      const uid = userIdOf(s);
      const st = stateFrom(subFor(a.id, uid), markCount(a.jobId, uid), a.dueAt);
      const g = uid ? scoresByAssignment.get(a.id)?.get(uid) : undefined;
      matrix[a.id][s.email] = g ? { ...st, ...g } : st;
    }
  }

  const roster: RosterEntry[] = [...students, ...instructors].map((m) => ({
    email: m.email, displayName: identities.get(m.email)?.displayName ?? null, userId: userIdOf(m), role: m.role,
    addedAt: m.added_at, isTest: identities.get(m.email)?.isTest ?? false,
  }));

  const cellsOf = (a: CourseAssignment) => students.map((s) => matrix[a.id][s.email]);
  const perAssignment: AssignmentStats[] = published.map((a) => {
    const cells = cellsOf(a);
    const scored = cells.filter((c) => c.score !== null);
    return {
      assignmentId: a.id,
      notStarted: cells.filter((c) => c.status === "not_started").length,
      inProgress: cells.filter((c) => c.status === "in_progress").length,
      submitted: cells.filter((c) => c.status === "submitted").length,
      returned: cells.filter((c) => c.status === "returned").length,
      late: cells.filter((c) => c.late).length,
      meanScore: mean(scored.map((c) => c.score!)),
      meanSensitivity: mean(cells.filter((c) => c.sensitivity !== null).map((c) => c.sensitivity!)),
    };
  });
  const perStudent: StudentStats[] = students.map((s) => {
    const cells = published.map((a) => matrix[a.id][s.email]);
    const scored = cells.filter((c) => c.score !== null);
    const activity = [lastMark(userIdOf(s)), ...cells.map((c) => c.submittedAt)].filter((x): x is string => !!x).map(Date.parse);
    return {
      email: s.email, displayName: identities.get(s.email)?.displayName ?? null, userId: userIdOf(s), isTest: identities.get(s.email)?.isTest ?? false,
      done: cells.filter((c) => isDone(c.status)).length, total: published.length,
      meanScore: mean(scored.map((c) => c.score!)),
      lastActivityAt: activity.length ? new Date(Math.max(...activity)).toISOString() : null,
    };
  });

  const allCells = published.flatMap(cellsOf);
  const turnedIn = allCells.filter((c) => isDone(c.status));
  const withDue = published.flatMap((a) => (a.dueAt ? cellsOf(a).filter((c) => isDone(c.status)) : []));
  const kpis: CourseKpis = {
    students: students.length,
    assignments: published.length,
    cells: allCells.length,
    notStarted: allCells.filter((c) => c.status === "not_started").length,
    inProgress: allCells.filter((c) => c.status === "in_progress").length,
    submitted: allCells.filter((c) => c.status === "submitted").length,
    returned: allCells.filter((c) => c.status === "returned").length,
    completion: allCells.length ? turnedIn.length / allCells.length : null,
    onTime: withDue.length ? withDue.filter((c) => !c.late).length / withDue.length : null,
    meanScore: mean(allCells.filter((c) => c.score !== null).map((c) => c.score!)),
    meanSensitivity: mean(allCells.filter((c) => c.sensitivity !== null).map((c) => c.sensitivity!)),
    meanFalseAlarms: mean(allCells.filter((c) => c.falseAlarms !== null).map((c) => c.falseAlarms!)),
    medianLatencyS: median(allCells.filter((c) => c.medianLatencyS !== null).map((c) => c.medianLatencyS!)),
  };

  return {
    ...toSummary(course, members, identities, { studentCount: students.length, assignmentCount: published.length, myRole: viewerRole, progress: null, completion: kpis.completion }),
    canManage: true,
    roster,
    assignments,
    matrix,
    kpis,
    perAssignment,
    perStudent,
  };
}

/** One assignment with the caller's own state (viewer header) — any course member. */
export async function getAssignmentForViewer(gate: Extract<CourseGate, { ok: true }>, assignmentId: string) {
  const supabase = createServerClient()!;
  const { data: a } = await supabase.from("eeg_course_assignments").select(ASSIGNMENT_COLUMNS).eq("id", assignmentId).eq("course_id", gate.course.id).maybeSingle();
  if (!a) return null;
  const row = a as AssignmentRow;
  const manage = canManageCourse(gate.viewerRole);
  if (!row.published && !manage) return null;
  const jobs = await loadJobsFor([row.job_id]);
  const [{ data: sub }, { count }] = await Promise.all([
    supabase.from("eeg_course_submissions").select(SUBMISSION_COLUMNS).eq("assignment_id", row.id).eq("user_id", gate.caller.userId).maybeSingle(),
    supabase.from("eeg_lab_annotations").select("id", { count: "exact", head: true }).eq("job_id", row.job_id).eq("user_id", gate.caller.userId),
  ]);
  return {
    assignment: toAssignment(row, jobs.get(row.job_id)),
    my: stateFrom((sub ?? undefined) as SubmissionRow | undefined, count ?? 0, row.due_at),
    canManage: manage,
  };
}

/** Submission transitions. Students act on their own row; managers return with feedback. */
export async function applySubmissionAction(
  gate: Extract<CourseGate, { ok: true }>,
  assignmentId: string,
  body: { action?: string; email?: string; feedback?: string },
): Promise<{ ok: true; submission: SubmissionState } | { ok: false; status: number; error: string }> {
  const supabase = createServerClient()!;
  const { data: a } = await supabase.from("eeg_course_assignments").select(ASSIGNMENT_COLUMNS).eq("id", assignmentId).eq("course_id", gate.course.id).maybeSingle();
  if (!a) return { ok: false, status: 404, error: "Assignment not found." };
  const row = a as AssignmentRow;
  const manage = canManageCourse(gate.viewerRole);
  const now = new Date().toISOString();

  let userId = gate.caller.userId, email = gate.caller.email;
  const action = String(body.action ?? "");
  if (action === "return") {
    if (!manage) return { ok: false, status: 403, error: "Only the course's teachers can return work." };
    email = String(body.email ?? "").toLowerCase();
    const member = gate.members.find((m) => m.email === email && m.role === "student");
    if (!member) return { ok: false, status: 404, error: "That student is not on the roster." };
    const uid = member.user_id ?? (await identitiesByEmail([email])).get(email)?.userId ?? null;
    if (!uid) return { ok: false, status: 409, error: "That student has never signed in, so there is nothing to return." };
    userId = uid;
  } else if (gate.viewerRole !== "student" && !manage) {
    return { ok: false, status: 403, error: "Not enrolled." };
  }

  const { data: existing } = await supabase.from("eeg_course_submissions").select(SUBMISSION_COLUMNS).eq("assignment_id", row.id).eq("user_id", userId).maybeSingle();
  const cur = (existing ?? null) as SubmissionRow | null;
  let patch: Partial<SubmissionRow> & { assignment_id: string; user_id: string; email: string };
  switch (action) {
    case "open":
      if (cur) return finish(cur);
      patch = { assignment_id: row.id, user_id: userId, email, status: "in_progress", opened_at: now };
      break;
    case "submit":
      patch = { assignment_id: row.id, user_id: userId, email, status: "submitted", submitted_at: now, opened_at: cur?.opened_at ?? now };
      break;
    case "unsubmit":
      patch = { assignment_id: row.id, user_id: userId, email, status: "in_progress", submitted_at: null, opened_at: cur?.opened_at ?? now };
      break;
    case "return":
      if (!cur) return { ok: false, status: 409, error: "The student has not opened this recording yet." };
      patch = { assignment_id: row.id, user_id: userId, email, status: "returned", returned_at: now, feedback: String(body.feedback ?? "").slice(0, 4000) };
      break;
    default:
      return { ok: false, status: 400, error: "action must be open, submit, unsubmit or return." };
  }
  const { data: saved, error } = await supabase
    .from("eeg_course_submissions")
    .upsert(patch, { onConflict: "assignment_id,user_id" })
    .select(SUBMISSION_COLUMNS)
    .single();
  if (error || !saved) return { ok: false, status: 500, error: error?.message ?? "Could not save." };
  return finish(saved as SubmissionRow);

  async function finish(sub: SubmissionRow) {
    const { count } = await supabase.from("eeg_lab_annotations").select("id", { count: "exact", head: true }).eq("job_id", row.job_id).eq("user_id", sub.user_id);
    return { ok: true as const, submission: stateFrom(sub, count ?? 0, row.due_at) };
  }
}
