// Server-side helpers for the EEG Teaching Lab job rows.
//
// Not isomorphic — this imports node:crypto and js-yaml. The page must not
// import it; it takes its types from ./types and its builder from ./spec.

import { createHash, randomUUID } from "node:crypto";
import { load as loadYaml } from "js-yaml";
import { stableStringify } from "./spec";
import {
  INSTRUCTOR_ARTIFACTS,
  LAB_RETENTION_DAYS,
  SYNTHETIC_STAMP,
  isLabReviewStatus,
  type LabArtifact,
  type LabFormat,
  type LabJob,
  type LabJobOptions,
  type LabJobReport,
  type LabJobStatus,
  type LabMode,
  type LabStage,
} from "./types";

/** The columns every route selects. Kept in one place so the shapes agree. */
export const LAB_JOB_COLUMNS =
  "id,stage,status,spec,duration_s,formats,options,recording_id,spec_hash," +
  "renderer_version,artifacts,report,error,attempts,max_attempts,last_exit_code," +
  "requested_by,parent_job_id,expires_at,created_at,updated_at," +
  "review_status,author_id,source,qbank_id,title,description,grandfathered," +
  "submitted_at,reviewed_by,reviewed_at,published_at";

/**
 * sha256 over the spec with sorted keys, matching the renderer sidecar's
 * `"spec_hash": "sha256:…"` convention. Identity, not integrity: it is what
 * stops a stale artifact being served for a spec that has since changed.
 */
export function specHash(spec: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(spec), "utf8").digest("hex")}`;
}

/** Human-sortable, unique, and safe as a filename stem. */
export function newRecordingId(): string {
  const d = new Date();
  const day = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `LAB-${day}-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export function retentionExpiry(days = LAB_RETENTION_DAYS): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/**
 * Parse an Expert-mode textarea. YAML is a superset of JSON, so one loader
 * covers both; the error is returned rather than thrown so the route can hand
 * it to the editor verbatim.
 */
export function parseSpecText(text: string): { value?: unknown; error?: string } {
  const body = text.trim();
  if (!body) return { error: "Paste a spec first." };
  try {
    return { value: loadYaml(body) };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { error: `Could not parse the spec: ${message.split("\n")[0]}` };
  }
}

/**
 * Build the job's `options` blob.
 *
 * Two fields are policy and are not taken from the caller:
 *
 *   embedAnswersInRecording — pinned false. `eeg-render export --answers` puts
 *     the realized events into the .lay / EDF+ annotation stream. A learner
 *     scrolling that file reads the answer off the timeline, whatever the page
 *     did or did not show them. The key is a separate artifact, gated
 *     separately, and there is no request shape that can flip this.
 *
 *   learnerAnnotations — pinned "bedside_only". What the bedside team wrote
 *     ("Lorazepam 0.1 mg/kg") belongs in the case; realized events do not.
 */
export function buildJobOptions(input: {
  mode: LabMode;
  includeAnswers: boolean;
  runPersyst: boolean;
  mmxPreset?: string | null;
  panel?: string | null;
}): LabJobOptions {
  return {
    mode: input.mode,
    mmxPreset: input.runPersyst ? (input.mmxPreset ?? null) : null,
    panel: input.runPersyst ? (input.panel ?? null) : null,
    includeAnswers: input.includeAnswers,
    embedAnswersInRecording: false,
    learnerAnnotations: "bedside_only",
    runPersyst: input.runPersyst,
    // A row literally named EKG is what switches on Persyst's heart-rate
    // engine; ECG carried on A1/A2 does not satisfy AutoEKGChannels.
    ekgChannel: true,
    subjectLabel: SYNTHETIC_STAMP,
    stamp: SYNTHETIC_STAMP,
  };
}

// ── row mapping ────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function int(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readOptions(value: unknown): LabJobOptions {
  const o = (typeof value === "object" && value !== null ? value : {}) as Partial<LabJobOptions>;
  return {
    mode: (o.mode ?? "guided") as LabMode,
    mmxPreset: o.mmxPreset ?? null,
    panel: o.panel ?? null,
    includeAnswers: o.includeAnswers === true,
    // Never trust a stored value here: an older row, or one written by hand,
    // must still read as "the recording carries no ground truth".
    embedAnswersInRecording: false,
    learnerAnnotations: "bedside_only",
    runPersyst: o.runPersyst === true,
    ekgChannel: o.ekgChannel !== false,
    subjectLabel: o.subjectLabel ?? SYNTHETIC_STAMP,
    stamp: o.stamp ?? SYNTHETIC_STAMP,
  };
}

/**
 * Takes `unknown` rather than a row type on purpose: a supabase-js select
 * without generated table types widens to a union that includes an error
 * shape, and casting at every call site is how a parse error becomes a job.
 */
export function rowToJob(input: unknown): LabJob {
  const row: Row = (typeof input === "object" && input !== null ? input : {}) as Row;
  const artifacts = (typeof row.artifacts === "object" && row.artifacts !== null
    ? row.artifacts
    : null) as Partial<Record<LabArtifact, string>> | null;
  return {
    id: String(row.id),
    stage: (str(row.stage) ?? "export") as LabStage,
    status: (str(row.status) ?? "pending") as LabJobStatus,
    spec: row.spec ?? null,
    durationS: int(row.duration_s) ?? 0,
    formats: (Array.isArray(row.formats) ? row.formats : ["lay"]) as LabFormat[],
    options: readOptions(row.options),
    recordingId: str(row.recording_id),
    specHash: str(row.spec_hash),
    rendererVersion: str(row.renderer_version),
    artifacts,
    report: (typeof row.report === "object" && row.report !== null
      ? row.report
      : null) as LabJobReport | null,
    error: str(row.error),
    attempts: int(row.attempts) ?? 0,
    maxAttempts: int(row.max_attempts) ?? 5,
    lastExitCode: int(row.last_exit_code),
    requestedBy: str(row.requested_by),
    parentJobId: str(row.parent_job_id),
    expiresAt: str(row.expires_at),
    createdAt: str(row.created_at) ?? new Date(0).toISOString(),
    updatedAt: str(row.updated_at) ?? new Date(0).toISOString(),
    reviewStatus: (isLabReviewStatus(row.review_status) ? row.review_status : "draft"),
    authorId: str(row.author_id),
    source: row.source === "ai" ? "ai" : "team",
    qbankId: str(row.qbank_id),
    title: str(row.title),
    description: str(row.description),
    grandfathered: row.grandfathered === true,
    submittedAt: str(row.submitted_at),
    reviewedBy: str(row.reviewed_by),
    reviewedAt: str(row.reviewed_at),
    publishedAt: str(row.published_at),
  };
}

// ── artifact access policy ─────────────────────────────────────────────────

export type ArtifactDecision =
  | { ok: true; path: string; instructorCopy: boolean }
  | { ok: false; status: number; reason: string };

/**
 * Decide whether this artifact may be handed out, given the job and the
 * caller's role.
 *
 * `callerIsInstructor` (teacher, editor or admin) is passed in rather than
 * inferred so the check stands on its own: if the route's own gate is ever
 * relaxed to serve learners, the answer key still refuses.
 */
export function resolveArtifact(
  job: LabJob,
  artifact: LabArtifact,
  callerIsInstructor: boolean,
): ArtifactDecision {
  const instructorCopy = INSTRUCTOR_ARTIFACTS.includes(artifact);

  if (instructorCopy && !callerIsInstructor) {
    return {
      ok: false, status: 403,
      reason: "The answer key is the instructor copy. Teacher access is required.",
    };
  }
  if (artifact === "answers" && !job.options.includeAnswers) {
    return {
      ok: false, status: 404,
      reason: "This job was run without an answer key, so none exists.",
    };
  }
  if (job.status !== "done") {
    return {
      ok: false, status: 409,
      reason: `The job is ${job.status}; nothing has been written yet.`,
    };
  }
  const path = job.artifacts?.[artifact];
  if (!path) {
    return {
      ok: false, status: 404,
      reason: `This job produced no ${artifact} artifact.`,
    };
  }
  if (job.expiresAt && Date.parse(job.expiresAt) < Date.now()) {
    return {
      ok: false, status: 410,
      reason: "This recording has passed its retention date and has been removed.",
    };
  }
  return { ok: true, path, instructorCopy };
}
