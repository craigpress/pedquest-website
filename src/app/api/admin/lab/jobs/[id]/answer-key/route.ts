import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/admin-auth";
import { createServerClient } from "@/lib/supabase";
import { hasRole } from "@/lib/roles";
import { LAB_JOB_COLUMNS, rowToJob } from "@/lib/lab/jobs";
import { canSeeRecording } from "@/lib/lab/visibility";
import { loadAnswerKey } from "@/lib/lab/results-server";
import {
  ANSWER_KEY_READ_ROLE, ANSWER_KEY_WRITE_ROLE, canMutateAnswerKey, isCurrentAnswerGeneration,
  mapOverrideHistory, parseKeyEvent, type AnswerOverrideAction, type AnswerOverrideRow,
} from "@/lib/lab/answer-overrides";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(id: string) {
  const supabase = createServerClient();
  if (!supabase) return { supabase: null, job: null };
  const { data } = await supabase.from("eeg_lab_jobs").select(LAB_JOB_COLUMNS).eq("id", id).maybeSingle();
  return { supabase, job: data ? rowToJob(data) : null };
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ANSWER_KEY_READ_ROLE);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not a job id." }, { status: 400 });
  const { supabase, job } = await load(id);
  if (!supabase) return NextResponse.json({ error: "The teaching lab is not configured." }, { status: 503 });
  if (!job || !canSeeRecording(auth, job)) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  const answersPath = job.options.includeAnswers ? job.artifacts?.answers : undefined;
  if (!answersPath) return NextResponse.json({ error: "This recording has no answer key." }, { status: 404 });

  const [{ key, error }, historyResult] = await Promise.all([
    loadAnswerKey(job),
    hasRole(auth.role, "editor")
      ? supabase.from("eeg_lab_answer_overrides").select("*").eq("job_id", id)
          .order("created_at", { ascending: false }).order("id", { ascending: false })
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (error) return NextResponse.json({ error }, { status: 500 });
  if (historyResult.error) return NextResponse.json({ error: historyResult.error.message }, { status: 500 });
  return NextResponse.json({
    success: true,
    key,
    history: hasRole(auth.role, "editor")
      ? mapOverrideHistory((historyResult.data ?? []) as AnswerOverrideRow[], answersPath, job.answerGeneration)
      : undefined,
    canEdit: hasRole(auth.role, "editor"),
    originalArtifact: answersPath,
    generation: job.answerGeneration,
  }, { headers: { "Cache-Control": "no-store, private" } });
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ANSWER_KEY_WRITE_ROLE);
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Not a job id." }, { status: 400 });
  const { supabase, job } = await load(id);
  if (!supabase) return NextResponse.json({ error: "The teaching lab is not configured." }, { status: 503 });
  const visible = !!job && canSeeRecording(auth, job);
  if (!job || !visible) return NextResponse.json({ error: "Job not found." }, { status: 404 });
  if (!canMutateAnswerKey(auth.role, visible)) return NextResponse.json({ error: "Editor access required." }, { status: 403 });
  if (job.status !== "done") return NextResponse.json({ error: "The export must finish before its answer key can be edited." }, { status: 400 });
  const answersPath = job.options.includeAnswers ? job.artifacts?.answers : undefined;
  if (!answersPath) return NextResponse.json({ error: "This recording has no answer key." }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    const raw: unknown = await request.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error();
    body = raw as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const action = String(body.action ?? "") as AnswerOverrideAction;
  if (!["add", "update", "remove", "reset"].includes(action)) {
    return NextResponse.json({ error: "Action must be add, update, remove or reset." }, { status: 400 });
  }
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";
  if (!isCurrentAnswerGeneration(body.expectedGeneration, job.answerGeneration)) {
    return NextResponse.json({ error: "The answer key was re-rendered after this page loaded. Reload before editing the new key." }, { status: 409 });
  }
  const current = await loadAnswerKey(job);
  if (current.error) return NextResponse.json({ error: current.error }, { status: 500 });

  let eventId: string | null = null;
  let event: ReturnType<typeof parseKeyEvent> = null;
  if (action === "reset") {
    if (body.confirmReset !== true) return NextResponse.json({ error: "Confirm that re-rendering/resetting discards every active override." }, { status: 400 });
  } else {
    eventId = action === "add" ? `added:${crypto.randomUUID()}` : String(body.eventId ?? "");
    if (!eventId || (!eventId.startsWith("original:") && !eventId.startsWith("added:"))) {
      return NextResponse.json({ error: "Unknown answer-key event id." }, { status: 400 });
    }
    const existing = current.key.find((candidate) => candidate.id === eventId);
    if (action !== "add" && !existing) return NextResponse.json({ error: "That answer-key event no longer exists." }, { status: 409 });
    if (action === "add" || action === "update") {
      event = parseKeyEvent(body.event, eventId);
      if (!event || event.onsetS > job.durationS || event.offsetS > job.durationS + 1) {
        return NextResponse.json({ error: "The event times or fields are invalid for this recording." }, { status: 400 });
      }
    }
  }

  const { error } = await supabase.from("eeg_lab_answer_overrides").insert({
    job_id: id,
    event_id: eventId,
    action,
    event,
    note,
    base_answers_path: answersPath,
    base_generation: job.answerGeneration,
    edited_by: auth.userId,
    edited_by_email: auth.email,
  });
  if (error) {
    console.error("[EEG Lab answer key] insert failed:", error.message);
    return NextResponse.json({ error: "Could not save the answer-key change." }, { status: 500 });
  }
  const merged = await loadAnswerKey(job);
  if (merged.error) return NextResponse.json({ error: merged.error }, { status: 500 });
  return NextResponse.json({ success: true, key: merged.key }, { status: 201, headers: { "Cache-Control": "no-store, private" } });
}
