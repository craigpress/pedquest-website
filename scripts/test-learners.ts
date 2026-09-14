// Synthetic test cohort for the EEG Teaching Lab: ten fake learners and one
// fake teacher, all flagged `is_test`, plus a realistic spread of seizure
// marks on one published recording and one bank answer each.
//
//   npm run test-learners -- status   what exists
//   npm run test-learners -- seed     create/refresh everything (idempotent)
//   npm run test-learners -- reset    delete the accounts and every row they own
//
// Why these accounts exist: an admin can switch into any of them from
// /admin/users to see the learner or teacher experience; the class-results
// page has something to show; and `is_test` proves the statistics exclusion
// (the bank answers below are the rows that must NOT move a community stat).
//
// Emails end in `.invalid` (RFC 2606) so nothing can ever deliver to them.
// Every mark is derived from the recording's own answer key with a seeded
// PRNG, so re-seeding reproduces the same cohort.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnvLocal, supabaseCredentials } from "./_env";
import { signEeglabUrl, isEeglabPath } from "../src/lib/lab/eeglab-store";
import { parseAnswerKey, type KeyEvent } from "../src/lib/lab/scoring";

loadEnvLocal();

/** PQ-A-013 · focal-seizure sensitivity — 4 h, three ~45 s right frontal/central seizures, answer key retained. */
export const TEST_JOB_ID = "c49a74fc-464d-47f0-8b37-82ac950faf98";
const DOMAIN = "test.pedquest.invalid";

type Persona =
  | "careful"        // all seizures, tight timing, right-sided channels, raw pane
  | "trend_reader"   // all seizures but from the FFT: late onsets, long durations, no channels
  | "misses_one"     // skips the shortest seizure
  | "over_caller"    // all seizures plus two false alarms on artefact-looking stretches
  | "onset_only"     // instantaneous seizure_onset marks with a channel
  | "wrong_side"     // right timing, left-hemisphere channels
  | "late_one"       // one seizure, very late, plus a note
  | "artifact_only"; // marked artefact, never a seizure → 0 detected

interface TestUser { first: string; last: string; role: "member" | "teacher"; persona: Persona | null }

export const TEST_USERS: TestUser[] = [
  { first: "Priya", last: "Raman", role: "member", persona: "careful" },
  { first: "Marcus", last: "Delgado", role: "member", persona: "careful" },
  { first: "Hannah", last: "Okafor", role: "member", persona: "trend_reader" },
  { first: "Tomasz", last: "Wieczorek", role: "member", persona: "misses_one" },
  { first: "Aisha", last: "Bello", role: "member", persona: "misses_one" },
  { first: "Liam", last: "Fitzgerald", role: "member", persona: "over_caller" },
  { first: "Mei-Lin", last: "Chou", role: "member", persona: "onset_only" },
  { first: "Diego", last: "Fernández", role: "member", persona: "wrong_side" },
  { first: "Sofia", last: "Lindqvist", role: "member", persona: "late_one" },
  { first: "Kwame", last: "Asante", role: "member", persona: "artifact_only" },
  { first: "Eleanor", last: "Whitfield", role: "teacher", persona: null },
];

const emailOf = (u: TestUser) =>
  `${u.first}.${u.last}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z.]/g, "") + `@${DOMAIN}`;
const nameOf = (u: TestUser) => `${u.first} ${u.last}`;

// One seeded stream for the whole cohort (mulberry32); the first outputs of a
// fresh seed are structured, so they are discarded.
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < 16; i++) next();
  return {
    uniform: (lo: number, hi: number) => lo + (hi - lo) * next(),
    pick: <T,>(xs: T[]) => xs[Math.floor(next() * xs.length)],
  };
}

const RIGHT_FRONTAL = ["Fp2-F4", "F4-C4", "Fp2-F8", "F8-T4"];
const RIGHT_CENTRAL = ["F4-C4", "C4-P4", "Cz-C4"];
const LEFT_MIRROR: Record<string, string> = { "Fp2-F4": "Fp1-F3", "F4-C4": "F3-C3", "Fp2-F8": "Fp1-F7", "F8-T4": "F7-T3", "C4-P4": "C3-P3", "Cz-C4": "Cz-C3" };

interface MarkRow {
  onset_s: number; duration_s: number; kind: string; label: string; note: string;
  pane: "raw" | "trend"; trend_row: string | null; channels: string[]; region: string | null;
}

function marksFor(persona: Persona, key: KeyEvent[], durationS: number, r: ReturnType<typeof rng>): MarkRow[] {
  const sz = key.filter((k) => k.kind === "seizure");
  const chans = (k: KeyEvent) => (k.region === "right_central" ? RIGHT_CENTRAL : RIGHT_FRONTAL);
  const span = (k: KeyEvent, dOn: number, dDur: number, extra: Partial<MarkRow> = {}): MarkRow => ({
    onset_s: Math.max(0, k.onsetS + dOn),
    duration_s: Math.max(5, k.offsetS - k.onsetS + dDur),
    kind: "seizure", label: "", note: "", pane: "raw", trend_row: null, channels: [], region: null, ...extra,
  });
  const clamp = (m: MarkRow) => ({ ...m, duration_s: Math.min(m.duration_s, durationS - m.onset_s) });
  const out: MarkRow[] = [];
  switch (persona) {
    case "careful":
      for (const k of sz) out.push(span(k, r.uniform(-4, 6), r.uniform(-8, 10), { channels: [r.pick(chans(k))], region: k.region }));
      break;
    case "trend_reader":
      for (const k of sz) out.push(span(k, r.uniform(12, 28), r.uniform(15, 40), { pane: "trend", trend_row: "psd_right", note: "flame on the right FFT" }));
      break;
    case "misses_one": {
      const shortest = [...sz].sort((a, b) => (a.offsetS - a.onsetS) - (b.offsetS - b.onsetS))[0];
      for (const k of sz) if (k !== shortest) out.push(span(k, r.uniform(-3, 10), r.uniform(-10, 15), { channels: [r.pick(chans(k))] }));
      break;
    }
    case "over_caller":
      for (const k of sz) out.push(span(k, r.uniform(-8, 4), r.uniform(0, 25), { channels: [r.pick(chans(k))], region: k.region }));
      // two confident false alarms well away from any seizure
      out.push({ onset_s: Math.round(durationS * 0.18), duration_s: 38, kind: "seizure", label: "", note: "rhythmic theta?", pane: "trend", trend_row: "psd_left", channels: [], region: "left_temporal" });
      out.push({ onset_s: Math.round(durationS * 0.62), duration_s: 52, kind: "seizure", label: "", note: "", pane: "raw", trend_row: null, channels: ["T3-T5"], region: null });
      break;
    case "onset_only":
      for (const k of sz) out.push({ ...span(k, r.uniform(-2, 5), 0), duration_s: 0, kind: "seizure_onset", channels: [k.region === "right_central" ? "C4" : "F4"], region: k.region });
      break;
    case "wrong_side":
      for (const k of sz) {
        const c = r.pick(chans(k));
        out.push(span(k, r.uniform(-3, 6), r.uniform(-5, 12), { channels: [LEFT_MIRROR[c] ?? c], region: k.region?.replace("right_", "left_") ?? null }));
      }
      break;
    case "late_one": {
      const k = sz[sz.length - 1];
      out.push(span(k, 24, 30, { note: "only noticed on the second pass" }));
      out.push({ onset_s: Math.round(durationS * 0.4), duration_s: 0, kind: "note", label: "baseline check", note: "asymmetry looks stable here", pane: "trend", trend_row: "asym", channels: [], region: null });
      break;
    }
    case "artifact_only":
      out.push({ onset_s: Math.round(durationS * 0.27), duration_s: 90, kind: "artifact", label: "", note: "movement", pane: "raw", trend_row: null, channels: [], region: null });
      out.push({ onset_s: Math.round(durationS * 0.71), duration_s: 45, kind: "artifact", label: "", note: "electrode pop", pane: "raw", trend_row: null, channels: ["P4"], region: null });
      break;
  }
  return out.map(clamp).map((m) => ({ ...m, onset_s: Math.round(m.onset_s * 10) / 10, duration_s: Math.round(m.duration_s * 10) / 10 }));
}

// ── supabase helpers ─────────────────────────────────────────────────────

async function findUserByEmail(sb: SupabaseClient, email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function loadKey(sb: SupabaseClient): Promise<{ key: KeyEvent[]; durationS: number; title: string }> {
  const { data: job, error } = await sb.from("eeg_lab_jobs").select("id,title,duration_s,artifacts,options").eq("id", TEST_JOB_ID).single();
  if (error || !job) throw new Error(`job ${TEST_JOB_ID} not found: ${error?.message}`);
  const path = (job.artifacts as Record<string, string>)?.answers;
  if (!path) throw new Error("job has no answer key artifact");
  let text: string;
  if (isEeglabPath(path)) {
    const res = await fetch(signEeglabUrl(path, 120));
    if (!res.ok) throw new Error(`answer key HTTP ${res.status}`);
    text = await res.text();
  } else {
    const { data, error: dl } = await sb.storage.from("eeg-lab").download(path);
    if (dl || !data) throw new Error(`answer key download: ${dl?.message}`);
    text = await data.text();
  }
  return { key: parseAnswerKey(JSON.parse(text)), durationS: Number(job.duration_s), title: job.title ?? TEST_JOB_ID };
}

async function bankAnswerTarget(sb: SupabaseClient): Promise<{ caseId: string; correct: string; wrong: string } | null> {
  const { data: cases } = await sb.from("eeg_cases").select("id").eq("in_bank", true).in("status", ["approved", "published"]).order("publish_date", { ascending: true }).limit(1);
  const caseId = cases?.[0]?.id;
  if (!caseId) return null;
  const { data: opts } = await sb.from("eeg_case_options").select("id,is_correct").eq("case_id", caseId);
  const correct = opts?.find((o) => o.is_correct)?.id, wrong = opts?.find((o) => !o.is_correct)?.id;
  return correct && wrong ? { caseId, correct, wrong } : null;
}

// ── demo course ──────────────────────────────────────────────────────────
// One course taught by the fake teacher with the ten learners enrolled and
// three published seizure recordings assigned. Submission states are spread so
// the course page has every colour: PQ-A-013 (past due) mostly turned in,
// two of them late, one returned with feedback; PQ-A-012 opened by two
// students; PQ-A-020 untouched.

export const COURSE_TITLE = "qEEG Seizure Detection — Fall 2026";
const DAY = 86400_000;
const COURSE_ASSIGNMENTS: { jobId: string; dueInDays: number; instructions: string }[] = [
  { jobId: TEST_JOB_ID, dueInDays: -5, instructions: "Mark every electrographic seizure from onset to offset. Tag the channel where each starts and name the region." },
  { jobId: "5288abb7-ae3a-4941-b305-1373f8e53264", dueInDays: 7, instructions: "Two generalized seizures. Mark onset to offset; note how the flame looks on both FFT rows." },
  { jobId: "a5c9791b-8680-4c49-b891-2843b4d83c0e", dueInDays: 21, instructions: "Eight hours with artefact. Mark seizures only — decide what is chest PT or movement and leave it unmarked." },
];
/** persona → state on PQ-A-013 (assignment 1) */
const A013_STATE: Record<Persona, "submitted" | "late" | "returned" | "in_progress"> = {
  careful: "submitted", trend_reader: "submitted", misses_one: "submitted", over_caller: "late",
  onset_only: "submitted", wrong_side: "late", late_one: "in_progress", artifact_only: "in_progress",
};

async function seedCourse(sb: SupabaseClient) {
  const teacher = TEST_USERS.find((u) => u.role === "teacher")!;
  const { data: roleRows } = await sb.from("user_roles").select("email,user_id").in("email", TEST_USERS.map(emailOf));
  const uid = new Map((roleRows ?? []).map((r) => [String(r.email), String(r.user_id)]));
  const ownerId = uid.get(emailOf(teacher));
  if (!ownerId) throw new Error("teacher account missing; run seed first");

  let { data: course } = await sb.from("eeg_courses").select("id").eq("owner_id", ownerId).eq("title", COURSE_TITLE).maybeSingle();
  if (!course) {
    const { data, error } = await sb.from("eeg_courses").insert({
      title: COURSE_TITLE, owner_id: ownerId, owner_email: emailOf(teacher),
      description: "Twelve weeks of qEEG seizure detection on synthetic long-term recordings. Mark the seizures, say where they start, then compare against the class.",
      starts_at: new Date(Date.now() - 30 * DAY).toISOString(), ends_at: new Date(Date.now() + 60 * DAY).toISOString(),
    }).select("id").single();
    if (error || !data) throw new Error(`course: ${error?.message}`);
    course = data;
  }
  const courseId = course.id as string;

  // roster: every learner as a student (existing rows untouched)
  const { data: existing } = await sb.from("eeg_course_members").select("email").eq("course_id", courseId);
  const have = new Set((existing ?? []).map((m) => String(m.email)));
  const rows = TEST_USERS.filter((u) => u.role === "member" && !have.has(emailOf(u)))
    .map((u) => ({ course_id: courseId, email: emailOf(u), user_id: uid.get(emailOf(u)) ?? null, role: "student", added_by: ownerId }));
  if (rows.length) { const { error } = await sb.from("eeg_course_members").insert(rows); if (error) throw new Error(`members: ${error.message}`); }

  // assignments, in order
  const { data: asgExisting } = await sb.from("eeg_course_assignments").select("id,job_id").eq("course_id", courseId);
  const asgByJob = new Map((asgExisting ?? []).map((a) => [String(a.job_id), String(a.id)]));
  for (const [i, a] of COURSE_ASSIGNMENTS.entries()) {
    if (asgByJob.has(a.jobId)) continue;
    const { data, error } = await sb.from("eeg_course_assignments").insert({
      course_id: courseId, job_id: a.jobId, instructions: a.instructions, task_id: "seizure",
      due_at: new Date(Date.now() + a.dueInDays * DAY).toISOString(), sort_order: i, created_by: ownerId,
    }).select("id").single();
    if (error || !data) throw new Error(`assignment ${a.jobId}: ${error?.message}`);
    asgByJob.set(a.jobId, data.id);
  }

  // submissions
  const a013 = asgByJob.get(TEST_JOB_ID)!, a012 = asgByJob.get(COURSE_ASSIGNMENTS[1].jobId)!;
  const due013 = Date.now() - 5 * DAY;
  const subs: Record<string, unknown>[] = [];
  for (const u of TEST_USERS) {
    if (!u.persona) continue;
    const userId = uid.get(emailOf(u)); if (!userId) continue;
    const state = A013_STATE[u.persona];
    const opened = new Date(due013 - 3 * DAY).toISOString();
    // every row carries every column: a multi-row upsert sends one shape, and missing keys arrive as NULLs
    const blank = { submitted_at: null, returned_at: null, feedback: "" };
    if (state === "in_progress") subs.push({ assignment_id: a013, user_id: userId, email: emailOf(u), status: "in_progress", opened_at: opened, ...blank });
    else {
      const submittedAt = new Date(state === "late" ? due013 + DAY : due013 - DAY).toISOString();
      const returned = u.persona === "careful" && u.first === "Priya";
      subs.push({
        assignment_id: a013, user_id: userId, email: emailOf(u), status: returned ? "returned" : "submitted", opened_at: opened, submitted_at: submittedAt,
        returned_at: returned ? new Date(due013 + 2 * DAY).toISOString() : null,
        feedback: returned ? "Clean work — all three caught, right-sided channels every time. Next: try the same read from the FFT rows alone." : "",
      });
    }
    if (u.persona === "careful") subs.push({ assignment_id: a012, user_id: userId, email: emailOf(u), status: "in_progress", opened_at: new Date(Date.now() - DAY).toISOString(), ...blank });
  }
  const { error: subErr } = await sb.from("eeg_course_submissions").upsert(subs, { onConflict: "assignment_id,user_id" });
  if (subErr) throw new Error(`submissions: ${subErr.message}`);
  console.log(`course "${COURSE_TITLE}" ${courseId}: ${TEST_USERS.length - 1} students, ${asgByJob.size} assignments, ${subs.length} submission rows`);
}

// ── commands ─────────────────────────────────────────────────────────────

async function status(sb: SupabaseClient) {
  const emails = TEST_USERS.map(emailOf);
  const { data: roles } = await sb.from("user_roles").select("email,role,is_test,display_name,user_id").in("email", emails);
  const ids = (roles ?? []).map((r) => r.user_id).filter(Boolean) as string[];
  const { count: marks } = await sb.from("eeg_lab_annotations").select("id", { count: "exact", head: true }).in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const { count: answers } = await sb.from("eeg_responses").select("id", { count: "exact", head: true }).in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  console.log(`test accounts: ${roles?.length ?? 0} of ${TEST_USERS.length} · marks: ${marks ?? 0} · bank answers: ${answers ?? 0}`);
  for (const r of roles ?? []) console.log(`  ${r.display_name ?? "?"} <${r.email}> ${r.role}${r.is_test ? "" : "  !! NOT FLAGGED is_test"}${r.user_id ? "" : "  (no auth user)"}`);
}

async function seed(sb: SupabaseClient) {
  const { key, durationS, title } = await loadKey(sb);
  const seizures = key.filter((k) => k.kind === "seizure");
  console.log(`recording: ${title} · ${Math.round(durationS / 60)} min · ${seizures.length} seizures in the key`);
  if (!seizures.length) throw new Error("the answer key has no seizures; pick another TEST_JOB_ID");
  const bank = await bankAnswerTarget(sb);
  if (!bank) console.warn("no approved bank item with a correct and a wrong option — skipping bank answers");

  const r = rng(20260915);
  let markTotal = 0;
  for (const u of TEST_USERS) {
    const email = emailOf(u);
    let user = await findUserByEmail(sb, email);
    if (!user) {
      const { data, error } = await sb.auth.admin.createUser({
        email, email_confirm: true,
        user_metadata: { full_name: nameOf(u), pedquest_test_account: true },
      });
      if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
      user = data.user;
    }
    const { error: roleErr } = await sb.from("user_roles").upsert(
      { email, user_id: user.id, role: u.role, is_test: true, display_name: nameOf(u) },
      { onConflict: "email" },
    );
    if (roleErr) throw new Error(`user_roles ${email}: ${roleErr.message}`);

    // marks: replace this account's marks on the test recording only
    await sb.from("eeg_lab_annotations").delete().eq("job_id", TEST_JOB_ID).eq("user_id", user.id);
    if (u.persona) {
      const rows = marksFor(u.persona, key, durationS, r).map((m) => ({ ...m, job_id: TEST_JOB_ID, user_id: user!.id, user_email: email }));
      if (rows.length) {
        const { error } = await sb.from("eeg_lab_annotations").insert(rows);
        if (error) throw new Error(`annotations ${email}: ${error.message}`);
      }
      markTotal += rows.length;
    }

    // one bank answer each (unique per user per case), so the stats exclusion has something to exclude
    if (bank && u.role === "member") {
      await sb.from("eeg_responses").delete().eq("case_id", bank.caseId).eq("user_id", user.id);
      const right = r.uniform(0, 1) < 0.6;
      const { error } = await sb.from("eeg_responses").insert({
        case_id: bank.caseId, user_id: user.id, member_email: email,
        selected_option_id: right ? bank.correct : bank.wrong, is_correct: right,
      });
      if (error) console.warn(`eeg_responses ${email}: ${error.message}`);
    }
    console.log(`  ${nameOf(u).padEnd(20)} ${u.role.padEnd(7)} ${u.persona ?? "-"}`);
  }
  console.log(`seeded ${TEST_USERS.length} accounts, ${markTotal} marks on ${TEST_JOB_ID}`);
  await seedCourse(sb);
}

async function reset(sb: SupabaseClient) {
  // the demo course first: members/assignments/submissions cascade from it
  const { data: courses } = await sb.from("eeg_courses").select("id").eq("title", COURSE_TITLE).eq("owner_email", emailOf(TEST_USERS.find((u) => u.role === "teacher")!));
  for (const c of courses ?? []) { await sb.from("eeg_courses").delete().eq("id", c.id); console.log(`  removed course ${c.id}`); }
  for (const u of TEST_USERS) {
    const email = emailOf(u);
    const user = await findUserByEmail(sb, email);
    if (user) {
      await sb.from("eeg_lab_annotations").delete().eq("user_id", user.id);
      await sb.from("eeg_responses").delete().eq("user_id", user.id);
      const { error } = await sb.auth.admin.deleteUser(user.id); // user_roles cascades on user_id
      if (error) console.warn(`deleteUser ${email}: ${error.message}`);
    }
    await sb.from("user_roles").delete().eq("email", email); // in case the row was never linked
    console.log(`  removed ${email}${user ? "" : " (no auth user)"}`);
  }
}

const cmd = process.argv[2] ?? "status";
const { url, key } = supabaseCredentials();
const sb = createClient(url, key, { auth: { persistSession: false } });
const run = { status, seed, reset }[cmd as "status" | "seed" | "reset"];
if (!run) { console.error("usage: test-learners status|seed|reset"); process.exit(2); }
run(sb).then(() => status(sb)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
