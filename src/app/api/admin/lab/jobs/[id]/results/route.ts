import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireRole } from "@/lib/admin-auth";
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

export const runtime = "nodejs";

// Class results for one lab recording: every learner's marks graded against
// the answer key. Teachers and up.
//
// GET /api/admin/lab/jobs/<uuid>/results
//
// The answer key never leaves the server unredacted for a learner — this
// route is the one place the key and the marks meet, and it is gated on the
// same role as the key download. Marks by instructors (teacher+) are returned
// too, flagged by role, so a teacher can see their own reference marks beside
// the class without them counting in the class summary.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AnnotationRow = {
  id: string; user_id: string; user_email: string; onset_s: number; duration_s: number; kind: string;
  label: string; note: string; pane: string | null; trend_row: string | null; channels: string[] | null; region: string | null;
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

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, "teacher");
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const { data: jobRow } = await supabase.from("eeg_lab_jobs").select(LAB_JOB_COLUMNS).eq("id", id).maybeSingle();
  if (!jobRow) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const job = rowToJob(jobRow);
  const raw = jobRow as unknown as { review_status: string; author_id: string | null; title: string | null };
  if (!canSeeRecording({ userId: auth.userId, role: auth.role }, { reviewStatus: raw.review_status, authorId: raw.author_id })) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  // ── answer key ──
  let key: KeyEvent[] = [];
  let keyError: string | null = null;
  const answersPath = job.options.includeAnswers ? job.artifacts?.answers : undefined;
  if (!answersPath) keyError = "This recording has no answer key, so marks are listed but not graded.";
  else {
    try {
      let text: string;
      if (isEeglabPath(answersPath)) {
        if (!eeglabConfigured()) throw new Error("recording store not configured");
        const res = await fetch(signEeglabUrl(answersPath, 120), { cache: "no-store" });
        if (!res.ok) throw new Error(`answer key HTTP ${res.status}`);
        text = await res.text();
      } else {
        const { data, error } = await supabase.storage.from(LAB_BUCKET).download(answersPath);
        if (error || !data) throw new Error(error?.message ?? "download failed");
        text = await data.text();
      }
      key = parseAnswerKey(JSON.parse(text));
    } catch (e) {
      keyError = `Could not load the answer key (${e instanceof Error ? e.message : "unknown error"}); marks are listed but not graded.`;
    }
  }

  // ── marks ──
  const { data: annRows, error: annErr } = await supabase
    .from("eeg_lab_annotations")
    .select("id,user_id,user_email,onset_s,duration_s,kind,label,note,pane,trend_row,channels,region,created_at")
    .eq("job_id", id)
    .order("onset_s");
  if (annErr) return NextResponse.json({ error: annErr.message }, { status: 500 });
  const rows = (annRows ?? []) as AnnotationRow[];

  const byUser = new Map<string, AnnotationRow[]>();
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
  const roleRows = await getRoleRowsByUserIds([...byUser.keys()]);

  // Tasks that apply: seizures always (that is what these recordings are for);
  // discharges only when the key or a learner mentions them.
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
      label: r.label ?? "",
      note: r.note ?? "",
      createdAt: r.created_at,
    }));
    const scores: Record<string, LearnerScore> = {};
    for (const t of tasks) scores[t.id] = scoreLearner(t, key, marks);
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

  return NextResponse.json({
    success: true,
    job: { id: job.id, title: raw.title, durationS: job.durationS, recordingId: job.recordingId, hasAnswerKey: key.length > 0 },
    keyError,
    key,
    tasks: taskResults,
    learners,
  }, { headers: { "Cache-Control": "no-store" } });
}
