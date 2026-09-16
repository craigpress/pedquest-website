// Class results for one lab recording, computed server-side: every learner's
// marks graded against the recording's answer key (src/lib/lab/scoring.ts).
//
// Shared by GET /api/admin/lab/jobs/[id]/results (the class-results page) and
// by the course detail (per-assignment scores, KPIs). The answer key never
// leaves the server unredacted for a learner — this module is the one place
// the key and the marks meet, and its callers gate on teacher+ (or on course
// management) before calling it.
//
// NEVER import from a "use client" module.

import { createServerClient } from "@/lib/supabase";
import { canSeeRecording } from "@/lib/lab/visibility";
import { LAB_JOB_COLUMNS, rowToJob } from "@/lib/lab/jobs";
import { LAB_BUCKET } from "@/lib/lab/types";
import { isEeglabPath, signEeglabUrl, eeglabConfigured } from "@/lib/lab/eeglab-store";
import { getRoleRowsByUserIds } from "@/lib/roles-server";
import { hasRole, type Role } from "@/lib/roles";
import { DEFAULT_TARGET, isAnnotationRegion } from "@/lib/eeg/annotations";
import {
  DISCHARGE_TASK, SEIZURE_TASK, parseAnswerKey, scoreLearner, summariseClass,
  type ClassSummary, type KeyEvent, type LearnerMark, type LearnerScore, type MarkTask,
} from "@/lib/lab/scoring";

type AnnotationRow = {
  id: string; user_id: string; user_email: string; onset_s: number; duration_s: number; kind: string;
  label: string; note: string; pane: string | null; trend_row: string | null; channels: string[] | null; region: string | null;
  view_span_s: number | null;
  created_at: string;
};

export interface ResultsLearner {
  userId: string;
  email: string;
  displayName: string | null;
  role: Role;
  isTest: boolean;
  isInstructor: boolean;
  marks: (LearnerMark & { label: string; note: string; createdAt: string })[];
  scores: Record<string, LearnerScore>;
}

export interface ResultsTask { task: MarkTask; summary: ClassSummary }

export interface JobResults {
  job: { id: string; title: string | null; durationS: number; recordingId: string | null; hasAnswerKey: boolean };
  keyError: string | null;
  key: KeyEvent[];
  tasks: ResultsTask[];
  learners: ResultsLearner[];
}

export type JobResultsOutcome = { ok: true; results: JobResults } | { ok: false; status: number; error: string };

// A rendered answer key is immutable for the life of its artifact path, so a
// warm function keeps parsed keys in memory: the course page grades every
// assignment on each load and would otherwise fetch the same three files from
// the recording store every time (~100 ms each). Short TTL so a re-rendered
// job under the same path is picked up within minutes.
const keyCache = new Map<string, { at: number; key: KeyEvent[] }>();
const KEY_TTL_MS = 10 * 60 * 1000;

/** Fetch and parse the recording's answer key; null with a reason when there is none or it cannot be read. */
export async function loadAnswerKey(job: ReturnType<typeof rowToJob>): Promise<{ key: KeyEvent[]; error: string | null }> {
  const answersPath = job.options.includeAnswers ? job.artifacts?.answers : undefined;
  if (!answersPath) return { key: [], error: "This recording has no answer key, so marks are listed but not graded." };
  const cacheId = `${job.id}|${answersPath}`;
  const hit = keyCache.get(cacheId);
  if (hit && Date.now() - hit.at < KEY_TTL_MS) return { key: hit.key, error: null };
  const out = await fetchAnswerKey(answersPath);
  if (!out.error) keyCache.set(cacheId, { at: Date.now(), key: out.key });
  return out;
}

async function fetchAnswerKey(answersPath: string): Promise<{ key: KeyEvent[]; error: string | null }> {
  try {
    let text: string;
    if (isEeglabPath(answersPath)) {
      if (!eeglabConfigured()) throw new Error("recording store not configured");
      const res = await fetch(signEeglabUrl(answersPath, 120), { cache: "no-store" });
      if (!res.ok) throw new Error(`answer key HTTP ${res.status}`);
      text = await res.text();
    } else {
      const supabase = createServerClient();
      if (!supabase) throw new Error("Supabase not configured");
      const { data, error } = await supabase.storage.from(LAB_BUCKET).download(answersPath);
      if (error || !data) throw new Error(error?.message ?? "download failed");
      text = await data.text();
    }
    return { key: parseAnswerKey(JSON.parse(text)), error: null };
  } catch (e) {
    return { key: [], error: `Could not load the answer key (${e instanceof Error ? e.message : "unknown error"}); marks are listed but not graded.` };
  }
}

/**
 * Grade every learner's marks on one recording.
 *
 * `viewer` must already be teacher+ (or a course manager): it is used only for
 * the recording-visibility check. `onlyUserIds` restricts the learners to a
 * roster (course view); instructors' marks are still returned, flagged, and
 * never counted in the class summary.
 */
export async function computeJobResults(
  jobId: string,
  viewer: { userId: string; role: Role },
  opts: { onlyUserIds?: Set<string> } = {},
): Promise<JobResultsOutcome> {
  const supabase = createServerClient();
  if (!supabase) return { ok: false, status: 503, error: "Supabase is not configured." };

  const { data: jobRow } = await supabase.from("eeg_lab_jobs").select(LAB_JOB_COLUMNS).eq("id", jobId).maybeSingle();
  if (!jobRow) return { ok: false, status: 404, error: "Not found." };
  const job = rowToJob(jobRow);
  const raw = jobRow as unknown as { review_status: string; author_id: string | null; title: string | null };
  if (!canSeeRecording(viewer, { reviewStatus: raw.review_status, authorId: raw.author_id })) {
    return { ok: false, status: 404, error: "Not found." };
  }

  const { key, error: keyError } = await loadAnswerKey(job);

  let q = supabase
    .from("eeg_lab_annotations")
    .select("id,user_id,user_email,onset_s,duration_s,kind,label,note,pane,trend_row,channels,region,view_span_s,created_at")
    .eq("job_id", jobId)
    .order("onset_s");
  if (opts.onlyUserIds) {
    if (opts.onlyUserIds.size === 0) q = q.in("user_id", ["00000000-0000-0000-0000-000000000000"]);
    else q = q.in("user_id", [...opts.onlyUserIds]);
  }
  const { data: annRows, error: annErr } = await q;
  if (annErr) return { ok: false, status: 500, error: annErr.message };
  const rows = (annRows ?? []) as AnnotationRow[];

  const byUser = new Map<string, AnnotationRow[]>();
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  const roleRows = await getRoleRowsByUserIds([...byUser.keys()]);

  // seizures always (that is what these recordings are for); discharges only when the key or a learner has them
  const tasks: MarkTask[] = [SEIZURE_TASK];
  if (key.some((k) => DISCHARGE_TASK.keyKinds.includes(k.kind)) || rows.some((r) => r.kind === "discharge")) tasks.push(DISCHARGE_TASK);

  const learners: ResultsLearner[] = [...byUser.entries()].map(([userId, list]) => {
    const roleRow = roleRows.get(userId);
    const role: Role = roleRow?.role ?? "member";
    const marks = list.map((r) => ({
      id: r.id,
      onsetS: Number(r.onset_s),
      durationS: Number(r.duration_s ?? 0),
      kind: r.kind,
      pane: r.pane === "trend" ? "trend" as const : "raw" as const,
      trendRow: r.trend_row ?? DEFAULT_TARGET.trendRow,
      channels: Array.isArray(r.channels) ? r.channels : [],
      region: isAnnotationRegion(r.region) ? r.region : null,
      viewSpanS: typeof r.view_span_s === "number" && r.view_span_s > 0 ? r.view_span_s : null,
      label: r.label ?? "",
      note: r.note ?? "",
      createdAt: r.created_at,
    }));
    const scores: Record<string, LearnerScore> = {};
    for (const t of tasks) scores[t.id] = scoreLearner(t, key, marks, { durationS: job.durationS });
    return {
      userId,
      email: list[0].user_email,
      displayName: roleRow?.displayName ?? null,
      role,
      isTest: roleRow?.isTest ?? false,
      isInstructor: hasRole(role, "teacher"),
      marks,
      scores,
    };
  }).sort((a, b) => (a.displayName ?? a.email).localeCompare(b.displayName ?? b.email));

  const classLearners = learners.filter((l) => !l.isInstructor);
  const taskResults: ResultsTask[] = tasks.map((t) => ({
    task: t,
    summary: summariseClass(t, key, classLearners.map((l) => l.scores[t.id])),
  }));

  return {
    ok: true,
    results: {
      job: { id: job.id, title: raw.title, durationS: job.durationS, recordingId: job.recordingId, hasAnswerKey: key.length > 0 },
      keyError,
      key,
      tasks: taskResults,
      learners,
    },
  };
}
