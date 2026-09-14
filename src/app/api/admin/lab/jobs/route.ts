import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireRole } from "@/lib/admin-auth";
import { draftSpecFromProse } from "@/lib/lab/draft";
import {
  buildJobOptions, LAB_JOB_COLUMNS, newRecordingId, parseSpecText, retentionExpiry,
  rowToJob, specHash,
} from "@/lib/lab/jobs";
import {
  buildSpecFromGuided, DURATION_MAX_MINUTES, DURATION_MIN_MINUTES, durationSecondsFromSpec,
  normalizeSpecInput, randomSeed, validateLabSpec,
} from "@/lib/lab/spec";
import {
  LAB_MMX_PRESETS, LAB_PERSYST_PANELS, SYNTHETIC_STAMP,
  type GuidedScenario, type LabFormat, type LabMode,
} from "@/lib/lab/types";

// Prose mode calls the LLM, so this route needs room. 300 s is the value the
// other LLM routes use (a revision that timed out at 60 s is what set it).
export const runtime = "nodejs";
export const maxDuration = 300;

// EEG Teaching Lab jobs. Editor or admin.
//
// POST  -> validate (and for prose mode, draft) a recording spec, then enqueue
//          an `export` row in public.eeg_lab_jobs. `dryRun: true` returns the
//          normalized spec and the validation without inserting anything.
// GET   -> the recent job list for the console.
//
// The page NEVER waits for a recording here. A 120-minute export runs about
// 20 s, Persyst processing takes minutes, and the last full render took 73
// minutes — none of that fits in a web request. This route enqueues; the
// worker exports; the page polls /jobs/[id].

const MODES: LabMode[] = ["guided", "prose", "expert"];
const FORMATS: LabFormat[] = ["lay", "edf"];

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFormats(value: unknown): LabFormat[] | null {
  if (value === undefined) return ["lay"];
  if (!Array.isArray(value)) return null;
  const picked = value.filter((f): f is LabFormat => FORMATS.includes(f as LabFormat));
  if (picked.length !== value.length) return null;
  return picked.length ? Array.from(new Set(picked)) : null;
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, "editor");
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!isObj(parsed)) throw new Error("not an object");
    body = parsed;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const mode = String(body.mode ?? "") as LabMode;
  if (!MODES.includes(mode)) {
    return NextResponse.json({ error: "Choose guided, prose or expert mode." }, { status: 400 });
  }

  const formats = readFormats(body.formats);
  if (!formats) {
    return NextResponse.json({ error: "Choose at least one output format (.lay/.dat or EDF+)." }, { status: 400 });
  }

  const durationMin = Number(body.durationMin ?? 120);
  if (!Number.isFinite(durationMin) || durationMin < DURATION_MIN_MINUTES || durationMin > DURATION_MAX_MINUTES) {
    return NextResponse.json({
      error: `Duration must be between ${DURATION_MIN_MINUTES} and ${DURATION_MAX_MINUTES} minutes.`,
    }, { status: 400 });
  }

  const runPersyst = body.runPersyst === true;
  const includeAnswers = body.includeAnswers === true;
  const dryRun = body.dryRun === true;
  const seed = Number.isInteger(body.seed) ? Number(body.seed) : randomSeed();

  const mmxPreset = body.mmxPreset == null ? LAB_MMX_PRESETS[0] : String(body.mmxPreset);
  const panel = body.panel == null ? LAB_PERSYST_PANELS[0] : String(body.panel);
  if (runPersyst && !LAB_MMX_PRESETS.includes(mmxPreset)) {
    return NextResponse.json({ error: "Unknown MMX preset." }, { status: 400 });
  }
  if (runPersyst && !LAB_PERSYST_PANELS.includes(panel)) {
    return NextResponse.json({ error: "Unknown Persyst export panel." }, { status: 400 });
  }

  // ── the spec ─────────────────────────────────────────────────────────────
  let block: unknown = null;
  let draft: { provider: string; model: string; notes: string[]; repaired: boolean } | undefined;

  if (mode === "guided") {
    if (!isObj(body.guided) || !Array.isArray((body.guided as Record<string, unknown>).events)) {
      return NextResponse.json({ error: "The guided scenario is missing or malformed." }, { status: 400 });
    }
    try {
      block = buildSpecFromGuided({
        ...(body.guided as unknown as GuidedScenario),
        durationMin,
        seed,
      });
    } catch (cause) {
      return NextResponse.json({
        error: `The guided scenario could not be assembled: ${(cause as Error).message}`,
      }, { status: 400 });
    }
  } else if (mode === "expert") {
    const parsed = parseSpecText(String(body.specText ?? ""));
    if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
    block = normalizeSpecInput(parsed.value);
    if (!block) {
      return NextResponse.json({
        error: "That is not a spec — expected an image block with a `spec:` mapping, or the bare spec itself.",
      }, { status: 400 });
    }
  } else {
    const prose = String(body.prose ?? "").trim();
    if (prose.length < 20) {
      return NextResponse.json({ error: "Describe the recording in at least 20 characters." }, { status: 400 });
    }
    if (prose.length > 4000) {
      return NextResponse.json({ error: "Keep the description to 4,000 characters or fewer." }, { status: 400 });
    }
    try {
      const result = await draftSpecFromProse({ prose, durationMin, seed, runPersyst, timeoutMs: 120_000 });
      block = result.spec;
      draft = {
        provider: result.provider, model: result.model,
        notes: result.notes, repaired: result.repaired,
      };
    } catch (cause) {
      return NextResponse.json({
        error: cause instanceof Error ? cause.message : "Drafting the spec failed.",
      }, { status: 422 });
    }
  }

  const durationS = durationSecondsFromSpec(block, durationMin);
  const validation = validateLabSpec(block, {
    runPersyst, durationS, requestedDurationMin: durationMin,
  });

  if (dryRun) {
    return NextResponse.json({
      success: validation.ok,
      dryRun: true,
      spec: block,
      specText: JSON.stringify(block, null, 2),
      durationS,
      validation,
      ...(draft ? { draft } : {}),
      stamp: SYNTHETIC_STAMP,
    });
  }

  if (!validation.ok) {
    return NextResponse.json({
      error: "The spec did not validate.", validation, spec: block, stamp: SYNTHETIC_STAMP,
    }, { status: 400 });
  }

  // ── enqueue ──────────────────────────────────────────────────────────────
  const supabase = createServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "The teaching lab is not configured." }, { status: 503 });
  }

  const { data, error } = await supabase
    .from("eeg_lab_jobs")
    .insert({
      stage: "export",
      status: "pending",
      spec: block,
      duration_s: durationS,
      formats,
      options: buildJobOptions({ mode, includeAnswers, runPersyst, mmxPreset, panel }),
      recording_id: newRecordingId(),
      spec_hash: specHash(block),
      requested_by: auth.userId,
      author_id: auth.userId,
      source: "team",
      review_status: "draft",
      expires_at: retentionExpiry(),
    })
    .select(LAB_JOB_COLUMNS)
    .single();

  if (error || !data) {
    console.error("[EEG Lab] enqueue failed:", error?.message);
    return NextResponse.json({ error: "Could not queue the export job." }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    job: rowToJob(data),
    validation,
    ...(draft ? { draft } : {}),
    stamp: SYNTHETIC_STAMP,
  }, { status: 201 });
}

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, "editor");
  if (!auth.ok) return auth.response;

  const supabase = createServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "The teaching lab is not configured." }, { status: 503 });
  }

  const limitParam = Number(request.nextUrl.searchParams.get("limit") ?? 30);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(1, limitParam), 100) : 30;
  const mine = request.nextUrl.searchParams.get("mine") === "1";

  let query = supabase
    .from("eeg_lab_jobs")
    .select(LAB_JOB_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (mine) query = query.eq("author_id", auth.userId);
  // Editors see published recordings, everything submitted for review and their
  // own; admins see all (src/lib/lab/visibility.ts). Follow-on stages inherit
  // their parent's author, so they follow it here.
  if (auth.role !== "admin") {
    query = query.or(
      `review_status.eq.published,review_status.eq.pending_review,author_id.eq.${auth.userId},author_id.is.null`,
    );
  }

  const { data, error } = await query;
  if (error) {
    console.error("[EEG Lab] list failed:", error.message);
    return NextResponse.json({ error: "Could not load the job list." }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    jobs: (data ?? []).map((row) => rowToJob(row)),
    stamp: SYNTHETIC_STAMP,
  });
}
