// EEG Teaching Lab — the job contract shared by the page, the API routes and
// the export/Persyst workers.
//
// Isomorphic on purpose: /admin/eeg-lab is a client component and imports these
// constants, so nothing in this file may touch node: builtins or the database.
//
// The lab does not render pictures. It exports *recordings* — Persyst .lay/.dat
// or EDF+ — which a learner opens in a review station. Two facts from
// tools/eeg-render/eeg_render/cli.py drive the whole contract and are restated
// here because getting either wrong leaks the answer:
//
//   1. `eeg-render export --answers` writes the realized events into the .lay
//      and EDF+ ANNOTATION STREAM. That file is the instructor copy. A learner
//      copy is the same export without the flag.
//   2. The ground truth is a separate file, `<id>.answers.json` (the realized
//      manifest), suppressed by `--no-manifest`.
//
// So "include answer key" means "also produce the separate answers.json", never
// "annotate the recording". `embedAnswersInRecording` is pinned false in
// LabJobOptions for exactly that reason.

/** Stamped on every artifact, every job row, and the page itself. */
export const SYNTHETIC_STAMP = "SYNTHETIC — NOT A PATIENT RECORDING";

/** Rows are large. Enqueue sets expires_at this far out; a reaper prunes. */
export const LAB_RETENTION_DAYS = 30;

/** Signed-URL lifetime, seconds. Long enough to click, short enough to be
 *  useless if it ends up in a chat log or a browser history export. */
export const LAB_SIGNED_URL_TTL_S = 120;

/** The private bucket created by supabase/migrations/20260912_eeg_lab_jobs.sql. */
export const LAB_BUCKET = "eeg-lab";

// ── stages, statuses, modes ────────────────────────────────────────────────

export type LabStage = "export" | "persyst";
export type LabJobStatus = "pending" | "running" | "done" | "error" | "cancelled";
export type LabMode = "guided" | "prose" | "expert";

export const LAB_TERMINAL_STATUSES: LabJobStatus[] = ["done", "error", "cancelled"];
export function isLabTerminal(status: string): boolean {
  return (LAB_TERMINAL_STATUSES as string[]).includes(status);
}

// ── artifacts ──────────────────────────────────────────────────────────────

/** Output containers the exporter can write (`eeg-render export --format`). */
export type LabFormat = "lay" | "edf";
export const LAB_FORMATS: { id: LabFormat; label: string; hint: string }[] = [
  { id: "lay", label: ".lay / .dat", hint: "Persyst layout + interleaved binary. What PSCLI processes." },
  { id: "edf", label: "EDF+", hint: "Opens in EDFbrowser, Moonlight, Epicurrents — the portable copy." },
];

export type LabArtifact = "lay" | "dat" | "edf" | "trends" | "answers" | "trends_csv";

/**
 * Safe to hand a learner: signal only, no realized-event annotations. `trends`
 * is the viewer's precomputed qEEG sidecar (src/lib/eeg/trend-sidecar.ts) —
 * derived from the signal alone, it shows nothing the raw page does not.
 */
export const LEARNER_ARTIFACTS: LabArtifact[] = ["lay", "dat", "edf", "trends"];

/**
 * Instructor copies. `answers` is the realized-event manifest; `trends_csv` is
 * the Persyst export, whose seizure-probability column is the answer in another
 * costume. Both are editor-gated independently of the route's own auth.
 */
export const INSTRUCTOR_ARTIFACTS: LabArtifact[] = ["answers", "trends_csv"];

export const LAB_ARTIFACTS: LabArtifact[] = [...LEARNER_ARTIFACTS, ...INSTRUCTOR_ARTIFACTS];

export function isLabArtifact(value: string): value is LabArtifact {
  return (LAB_ARTIFACTS as string[]).includes(value);
}
export function isInstructorArtifact(artifact: LabArtifact): boolean {
  return INSTRUCTOR_ARTIFACTS.includes(artifact);
}

export const LAB_ARTIFACT_LABELS: Record<LabArtifact, string> = {
  lay: "Persyst .lay",
  dat: "Persyst .dat",
  edf: "EDF+",
  trends: "Trend sidecar",
  answers: "Answer key",
  trends_csv: "Trend CSV",
};

// ── Persyst processing ─────────────────────────────────────────────────────

/**
 * MMX presets are referenced on the licensed processing host, never shipped —
 * redistribution rights for the stock presets are an open question
 * (docs/EEG_TEACHING_LAB_RESEARCH.md §9.5). These are names the worker resolves
 * locally.
 */
export const LAB_MMX_PRESETS = [
  "Trend Settings Version P15.mmx",
  "Trend Settings Version P14.mmx",
];

/** `PSCLI /ExportCSV /Panel=`. */
export const LAB_PERSYST_PANELS = [
  "VsBaseline Comprehensive",
  "Comprehensive",
  "Seizure Probability",
];

/**
 * Persyst's stock adult MMX starts its baseline auto-search at 270 s. A shorter
 * recording produces VsBaseline instruments that are silently all zero, exit
 * code 0, clean stderr (docs/PSCLI_PHASE0A_RESULTS.md). Anything under this is
 * warned about at enqueue rather than discovered in the CSV.
 */
export const PERSYST_BASELINE_MIN_S = 600;

// ── the job row ────────────────────────────────────────────────────────────

/**
 * `options` on the job row. Everything here is read by the worker; the two
 * fields with fixed values are policy, not preference.
 */
export interface LabJobOptions {
  mode: LabMode;
  mmxPreset: string | null;
  panel: string | null;
  /** Produce and retain the separate `<id>.answers.json`. Default false. */
  includeAnswers: boolean;
  /**
   * PINNED FALSE. The worker must never pass `eeg-render export --answers`:
   * that writes realized events into the .lay/EDF+ annotation stream, and a
   * learner scrolling the file would read the answer off the timeline. The
   * answer key is a separate download, gated separately.
   */
  embedAnswersInRecording: false;
  /**
   * PINNED "bedside_only". Annotations that survive into the learner file are
   * the ones the bedside team wrote ("Lorazepam 0.1 mg/kg"); realized events
   * are not annotations.
   */
  learnerAnnotations: "bedside_only";
  runPersyst: boolean;
  /** Emit a channel literally named EKG. Without it Persyst's heart-rate
   *  engine returns all zeros — ECG carried on the ear electrodes does not
   *  satisfy `AutoEKGChannels`. */
  ekgChannel: boolean;
  /** Written into the .lay [Patient] block and the EDF+ header by the worker. */
  subjectLabel: string;
  stamp: string;
}

export interface LabJobReport {
  clippedSamples?: number;
  peakUv?: number;
  channels?: number;
  sampleRate?: number;
  baseline?: { ok: boolean; reasons?: string[] };
  detections?: unknown;
  [key: string]: unknown;
}

/** camelCase view of a public.eeg_lab_jobs row, as the API returns it. */
export interface LabJob {
  id: string;
  stage: LabStage;
  status: LabJobStatus;
  spec: unknown;
  durationS: number;
  formats: LabFormat[];
  options: LabJobOptions;
  recordingId: string | null;
  specHash: string | null;
  rendererVersion: string | null;
  /** artifact -> storage path inside the private `eeg-lab` bucket */
  artifacts: Partial<Record<LabArtifact, string>> | null;
  report: LabJobReport | null;
  error: string | null;
  attempts: number;
  maxAttempts: number;
  lastExitCode: number | null;
  requestedBy: string | null;
  parentJobId: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── request / response shapes ──────────────────────────────────────────────

export interface LabValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface LabJobRequest {
  mode: LabMode;
  /** guided mode */
  guided?: GuidedScenario;
  /** prose mode */
  prose?: string;
  /** expert mode: YAML or JSON, parsed server-side */
  specText?: string;
  formats?: LabFormat[];
  durationMin?: number;
  runPersyst?: boolean;
  includeAnswers?: boolean;
  mmxPreset?: string | null;
  panel?: string | null;
  seed?: number;
  /** Validate (and, for prose, draft) without inserting a job row. */
  dryRun?: boolean;
}

export interface LabDryRunResponse {
  success: boolean;
  dryRun: true;
  spec: unknown;
  specText: string;
  durationS: number;
  validation: LabValidation;
  draft?: { provider: string; model: string; notes: string[]; repaired: boolean };
  stamp: string;
}

export interface LabEnqueueResponse {
  success: true;
  job: LabJob;
  validation: LabValidation;
  stamp: string;
}

// ── guided-mode scenario ───────────────────────────────────────────────────
//
// The shape the Guided form produces. spec.ts turns it into an image block.

export type LabAgeBand = "neonate" | "infant" | "child" | "adolescent";
export type LabChannelSet = "standard_19" | "neonatal_9";
export type LabMontage = "longitudinal_bipolar" | "referential" | "average" | "neonatal_reduced";

export type LabBackgroundType =
  | "continuous" | "discontinuous" | "burst_suppression" | "suppressed"
  | "low_voltage" | "excessively_discontinuous" | "trace_alternant";

export type LabRegion =
  | "left_temporal" | "right_temporal" | "left_frontal" | "right_frontal"
  | "left_central" | "right_central" | "left_occipital" | "right_occipital"
  | "left_hemisphere" | "right_hemisphere" | "generalized" | "midline";

export type LabSpread = "none" | "hemispheric" | "generalized" | "contralateral";

export type LabArtifactKind =
  | "emg_chewing" | "patting" | "chest_pt" | "ventilator" | "ecmo_pump"
  | "electrode_pop" | "sixty_hz" | "ecg" | "movement" | "sweat" | "eye_blink";

export type LabSedationAgent =
  | "propofol" | "midazolam" | "pentobarbital" | "dexmedetomidine" | "ketamine";

export type LabEventType =
  | "seizure" | "seizure_cluster" | "sedation_change"
  | "attenuation_transient" | "artifact" | "state_change";

export interface LabEvolution {
  startHz: number;
  endHz: number;
  amplitudeStartUv: number;
  amplitudeEndUv: number;
}

export type GuidedEvent =
  | {
      id: string;
      type: "seizure";
      onsetMin: number;
      durationS: number;
      onsetRegion: LabRegion;
      spread: LabSpread;
      postictalAttenuationS: number;
      evolution: LabEvolution;
    }
  | {
      id: string;
      type: "seizure_cluster";
      startMin: number;
      endMin: number;
      intervalMin: number;
      durationS: number;
      /** Last run's length; runs interpolate from durationS so a cluster can
       *  escalate, or settle after treatment. Equal to durationS = uniform. */
      durationEndS: number;
      onsetRegion: LabRegion;
      evolution: LabEvolution;
    }
  | {
      id: string;
      type: "sedation_change";
      atMin: number;
      direction: "increase" | "decrease";
      agent: LabSedationAgent;
      suppressionRatioTargetPct: number;
      betaBoost: boolean;
      rampMin: number;
    }
  | {
      id: string;
      type: "attenuation_transient";
      atMin: number;
      durationMin: number;
      side: "both" | "left" | "right";
      depthPct: number;
      /** Lower than depthPct = frequency-selective loss (ischemia spares
       *  delta), which is what makes a band ratio move at all. */
      deltaDepthPct: number;
      rampMin: number;
    }
  | {
      id: string;
      type: "artifact";
      kind: LabArtifactKind;
      atMin: number;
      durationS: number;
      side: "all" | "left" | "right";
      intensity: "low" | "medium" | "high";
    }
  | {
      id: string;
      type: "state_change";
      atMin: number;
      to: "sleep" | "wake" | "arousal";
    };

export interface GuidedAnnotation {
  id: string;
  atMin: number;
  label: string;
}

export interface GuidedScenario {
  ageBand: LabAgeBand;
  channels: LabChannelSet;
  montage: LabMontage;
  sampleRate: number;
  durationMin: number;
  seed: number;
  background: {
    type: LabBackgroundType;
    dominantHz: number;
    amplitudeUv: number;
    slowFraction: number;
    reactivity: "present" | "absent";
    burstS: number;
    ibiS: number;
  };
  events: GuidedEvent[];
  annotations: GuidedAnnotation[];
}
