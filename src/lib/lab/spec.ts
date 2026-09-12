// Guided-form spec builder and the lab's spec validator.
//
// Isomorphic: /admin/eeg-lab imports the option lists and defaults, the API
// route imports the builder and the validator. No node: builtins here.
//
// The enums below mirror tools/eeg-render/eeg_render/schema.py exactly. That
// module is the authority — the worker runs `eeg-render validate` before it
// exports anything, and a spec that passes here can still be rejected there.
// The point of validating twice is that an editor finds out in the form instead
// of in a job that failed forty minutes later.

import {
  PERSYST_BASELINE_MIN_S,
  type GuidedEvent,
  type GuidedScenario,
  type LabArtifactKind,
  type LabAgeBand,
  type LabBackgroundType,
  type LabChannelSet,
  type LabMontage,
  type LabRegion,
  type LabSedationAgent,
  type LabSpread,
  type LabValidation,
} from "./types";

// ── enums, with editor-facing labels ───────────────────────────────────────

export const AGE_BANDS: { id: LabAgeBand; label: string }[] = [
  { id: "neonate", label: "Neonate" },
  { id: "infant", label: "Infant" },
  { id: "child", label: "Child" },
  { id: "adolescent", label: "Adolescent" },
];

export const CHANNEL_SETS: { id: LabChannelSet; label: string; hint: string }[] = [
  { id: "standard_19", label: "Standard 19 (10-20)", hint: "19 scalp electrodes" },
  { id: "neonatal_9", label: "Neonatal reduced (9)", hint: "9-electrode neonatal array" },
];

export const MONTAGES: { id: LabMontage; label: string }[] = [
  { id: "longitudinal_bipolar", label: "Longitudinal bipolar" },
  { id: "referential", label: "Referential" },
  { id: "average", label: "Average reference" },
  { id: "neonatal_reduced", label: "Neonatal reduced" },
];

export const BACKGROUND_TYPES: { id: LabBackgroundType; label: string }[] = [
  { id: "continuous", label: "Continuous" },
  { id: "discontinuous", label: "Discontinuous" },
  { id: "excessively_discontinuous", label: "Excessively discontinuous" },
  { id: "burst_suppression", label: "Burst suppression" },
  { id: "suppressed", label: "Suppressed" },
  { id: "low_voltage", label: "Low voltage" },
  { id: "trace_alternant", label: "Tracé alternant" },
];

export const REGIONS: LabRegion[] = [
  "left_temporal", "right_temporal", "left_frontal", "right_frontal",
  "left_central", "right_central", "left_occipital", "right_occipital",
  "left_hemisphere", "right_hemisphere", "generalized", "midline",
];

export const SPREADS: LabSpread[] = ["none", "hemispheric", "generalized", "contralateral"];

export const ARTIFACT_KINDS: LabArtifactKind[] = [
  "emg_chewing", "patting", "chest_pt", "ventilator", "ecmo_pump",
  "electrode_pop", "sixty_hz", "ecg", "movement", "sweat", "eye_blink",
];

export const SEDATION_AGENTS: LabSedationAgent[] = [
  "propofol", "midazolam", "pentobarbital", "dexmedetomidine", "ketamine",
];

export const EVENT_TYPE_LABELS: Record<GuidedEvent["type"], string> = {
  seizure: "Seizure",
  seizure_cluster: "Seizure cluster",
  sedation_change: "Sedation change",
  attenuation_transient: "Attenuation transient",
  artifact: "Artifact",
  state_change: "State change",
};

/** Every event type the renderer accepts — wider than the Guided form offers,
 *  because Expert mode may legitimately use the rest of the DSL. */
const ALL_EVENT_TYPES = [
  "seizure", "seizure_cluster", "status_epilepticus", "sedation_change",
  "attenuation_transient", "temperature_change", "stimulation", "artifact",
  "state_change", "rhythmic_pattern",
];

/**
 * The renderer's qeeg_panel schema floors duration_min at 30 and caps it at
 * 2880 (48 h). The lab keeps the same window so a stored spec stays valid
 * against `eeg-render validate`.
 */
export const DURATION_MIN_MINUTES = 30;
export const DURATION_MAX_MINUTES = 2880;

export const SAMPLE_RATES = [200, 256, 512];

// ── defaults ───────────────────────────────────────────────────────────────

export function randomSeed(): number {
  return Math.floor(Math.random() * 2_000_000_000) + 1;
}

export function defaultEvolution() {
  return { startHz: 4, endHz: 1.5, amplitudeStartUv: 60, amplitudeEndUv: 150 };
}

export function defaultGuidedScenario(): GuidedScenario {
  return {
    ageBand: "child",
    channels: "standard_19",
    montage: "longitudinal_bipolar",
    // 200 Hz is what the proven Persyst runs used; it also halves the .dat.
    sampleRate: 200,
    durationMin: 120,
    seed: randomSeed(),
    background: {
      type: "continuous",
      dominantHz: 7,
      amplitudeUv: 40,
      slowFraction: 0.4,
      reactivity: "present",
      burstS: 2,
      ibiS: 8,
    },
    events: [],
    annotations: [],
  };
}

let eventCounter = 0;
function newId(): string {
  eventCounter += 1;
  return `e${Date.now().toString(36)}${eventCounter}`;
}

export function defaultEvent(type: GuidedEvent["type"], durationMin: number): GuidedEvent {
  const mid = Math.round(durationMin / 2);
  switch (type) {
    case "seizure":
      return {
        id: newId(), type, onsetMin: mid, durationS: 110,
        onsetRegion: "left_temporal", spread: "none", postictalAttenuationS: 60,
        evolution: defaultEvolution(),
      };
    case "seizure_cluster":
      return {
        id: newId(), type,
        startMin: Math.round(durationMin * 0.25), endMin: Math.round(durationMin * 0.8),
        intervalMin: 12, durationS: 60, durationEndS: 60,
        onsetRegion: "right_central", evolution: defaultEvolution(),
      };
    case "sedation_change":
      return {
        id: newId(), type, atMin: mid, direction: "increase", agent: "midazolam",
        suppressionRatioTargetPct: 60, betaBoost: true, rampMin: 10,
      };
    case "attenuation_transient":
      return {
        id: newId(), type, atMin: mid, durationMin: 8, side: "left",
        // depth > delta depth: a uniform loss scales numerator and denominator
        // alike and leaves every band ratio flat.
        depthPct: 55, deltaDepthPct: 15, rampMin: 0,
      };
    case "artifact":
      return {
        id: newId(), type, kind: "ventilator", atMin: mid, durationS: 180,
        side: "all", intensity: "medium",
      };
    case "state_change":
      return { id: newId(), type, atMin: mid, to: "sleep" };
  }
}

export function defaultAnnotation(durationMin: number) {
  return { id: newId(), atMin: Math.round(durationMin / 2), label: "" };
}

// ── builder ────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

function evolutionBlock(e: { startHz: number; endHz: number; amplitudeStartUv: number; amplitudeEndUv: number }): Json {
  return {
    start_hz: e.startHz, end_hz: e.endHz,
    amplitude_start_uv: e.amplitudeStartUv, amplitude_end_uv: e.amplitudeEndUv,
  };
}

function eventBlock(event: GuidedEvent): Json {
  switch (event.type) {
    case "seizure":
      return {
        type: "seizure",
        onset_min: event.onsetMin,
        duration_s: event.durationS,
        onset_region: event.onsetRegion,
        evolution: evolutionBlock(event.evolution),
        spread: event.spread,
        ...(event.postictalAttenuationS > 0
          ? { postictal_attenuation_s: event.postictalAttenuationS }
          : {}),
      };
    case "seizure_cluster":
      return {
        type: "seizure_cluster",
        start_min: event.startMin,
        end_min: event.endMin,
        interval_min: event.intervalMin,
        seizure: {
          duration_s: event.durationS,
          ...(event.durationEndS !== event.durationS ? { duration_end_s: event.durationEndS } : {}),
          onset_region: event.onsetRegion,
          evolution: evolutionBlock(event.evolution),
        },
      };
    case "sedation_change":
      return {
        type: "sedation_change",
        at_min: event.atMin,
        direction: event.direction,
        agent: event.agent,
        effect: {
          suppression_ratio_target_pct: event.suppressionRatioTargetPct,
          beta_boost: event.betaBoost,
          ramp_min: event.rampMin,
        },
      };
    case "attenuation_transient":
      return {
        type: "attenuation_transient",
        at_min: event.atMin,
        duration_min: event.durationMin,
        side: event.side,
        depth_pct: event.depthPct,
        delta_depth_pct: event.deltaDepthPct,
        ramp_min: event.rampMin,
      };
    case "artifact":
      return {
        type: "artifact",
        kind: event.kind,
        at_min: event.atMin,
        duration_s: event.durationS,
        side: event.side,
        intensity: event.intensity,
      };
    case "state_change":
      return { type: "state_change", at_min: event.atMin, to: event.to };
  }
}

/**
 * Guided form -> image block. Emits only keys the renderer's qeeg_panel schema
 * allows (`additionalProperties: false`), so the block validates unchanged.
 */
export function buildSpecFromGuided(g: GuidedScenario): Json {
  const background: Json = {
    type: g.background.type,
    dominant_hz: g.background.dominantHz,
    amplitude_uv: g.background.amplitudeUv,
    slow_fraction: g.background.slowFraction,
    reactivity: g.background.reactivity,
  };
  if (g.background.type === "burst_suppression") {
    background.burst_suppression = { burst_s: g.background.burstS, ibi_s: g.background.ibiS };
  }

  const annotations = g.annotations
    .filter((a) => a.label.trim().length > 0)
    .map((a) => ({ at_min: a.atMin, label: a.label.trim() }));

  const spec: Json = {
    seed: Math.trunc(g.seed),
    age_group: g.ageBand,
    sample_rate: Math.trunc(g.sampleRate),
    channels: g.channels,
    montage: g.montage,
    duration_min: g.durationMin,
    background,
    events: g.events.map(eventBlock),
  };
  if (annotations.length) spec.annotations = annotations;

  return {
    kind: "qeeg_panel",
    license: "synthetic-original",
    attribution: null,
    spec,
  };
}

// ── validation ─────────────────────────────────────────────────────────────

function isObj(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Accepts either a full image block (`{kind, license, spec}`) or a bare inner
 * spec, which is what an editor usually pastes. Returns the normalized block.
 */
export function normalizeSpecInput(value: unknown): Json | null {
  if (!isObj(value)) return null;
  if (isObj(value.spec)) {
    return {
      kind: typeof value.kind === "string" ? value.kind : "qeeg_panel",
      license: typeof value.license === "string" ? value.license : "synthetic-original",
      attribution: value.attribution ?? null,
      spec: value.spec,
    };
  }
  // A bare spec is recognised by the one key the renderer always requires.
  if ("seed" in value || "background" in value || "duration_min" in value) {
    return { kind: "qeeg_panel", license: "synthetic-original", attribution: null, spec: value };
  }
  return null;
}

/** Labels that would hand the learner the answer off the time axis. */
const GIVEAWAY_RE = /\b(seizure|ictal|status epilepticus|burst[- ]suppression|electrographic|onset|answer|ground truth)\b/i;

export interface ValidateOptions {
  runPersyst?: boolean;
  /** Authoritative duration in seconds — the spec's own duration_min, once
   *  resolved. Event times are checked against this. */
  durationS?: number;
  /** What the form's duration control asked for. Only used to tell the editor
   *  when a pasted spec silently overrides it. */
  requestedDurationMin?: number;
}

/**
 * Deterministic checks over a normalized image block. Errors block the enqueue;
 * warnings ride along on the job so the editor sees them next to the result.
 */
export function validateLabSpec(block: unknown, opts: ValidateOptions = {}): LabValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObj(block) || !isObj(block.spec)) {
    return { ok: false, errors: ["The spec must be an object with a `spec` block."], warnings };
  }
  const spec = block.spec;

  if (block.kind !== "qeeg_panel" && block.kind !== "eeg_page" && block.kind !== "aeeg") {
    errors.push(`kind "${String(block.kind)}" is not exportable as a recording — use qeeg_panel.`);
  }
  if (block.license === "dataset-derived" && !block.attribution) {
    errors.push("license is dataset-derived but attribution is empty.");
  }

  // seed — without an integer seed the export is not reproducible, which
  // defeats "the image and the file are the same recording".
  const seed = num(spec.seed);
  if (seed === null || !Number.isInteger(seed)) {
    errors.push("spec.seed must be an integer — the export would not be reproducible.");
  }

  const ageGroup = spec.age_group;
  if (typeof ageGroup !== "string" || !AGE_BANDS.some((a) => a.id === ageGroup)) {
    errors.push(`spec.age_group must be one of ${AGE_BANDS.map((a) => a.id).join(", ")}.`);
  }

  const sampleRate = num(spec.sample_rate);
  if (sampleRate !== null && (sampleRate < 100 || sampleRate > 1024)) {
    errors.push("spec.sample_rate must be between 100 and 1024 Hz.");
  }

  const channels = spec.channels;
  if (channels !== undefined
      && !["standard_19", "neonatal_9", "neonatal_reduced"].includes(String(channels))) {
    errors.push(`spec.channels "${String(channels)}" is not a known channel set.`);
  }
  const montage = spec.montage;
  if (montage !== undefined && !MONTAGES.some((m) => m.id === montage)) {
    errors.push(`spec.montage "${String(montage)}" is not a known montage.`);
  }

  // duration
  const durationMin = num(spec.duration_min);
  if (durationMin === null) {
    errors.push("spec.duration_min is required — it is the recording's length.");
  } else if (durationMin < DURATION_MIN_MINUTES || durationMin > DURATION_MAX_MINUTES) {
    errors.push(
      `spec.duration_min must be between ${DURATION_MIN_MINUTES} and ${DURATION_MAX_MINUTES} minutes.`,
    );
  }
  const durationS = opts.durationS ?? (durationMin !== null ? durationMin * 60 : 0);
  if (durationMin !== null && opts.requestedDurationMin != null
      && Math.abs(durationMin - opts.requestedDurationMin) > 0.5) {
    warnings.push(
      `spec.duration_min (${durationMin} min) overrides the duration control ` +
      `(${opts.requestedDurationMin} min) — the recording will be ${durationMin} minutes long.`,
    );
  }

  // background
  if (!isObj(spec.background)) {
    errors.push("spec.background is required.");
  } else {
    const bg = spec.background;
    if (typeof bg.type !== "string" || !BACKGROUND_TYPES.some((b) => b.id === bg.type)) {
      errors.push(`background.type "${String(bg.type)}" is not a known background.`);
    }
    const hz = num(bg.dominant_hz);
    if (hz === null) errors.push("background.dominant_hz is required.");
    else if (hz < 0.3 || hz > 20) errors.push("background.dominant_hz must be between 0.3 and 20.");
    const amp = num(bg.amplitude_uv);
    if (amp !== null && amp <= 0) errors.push("background.amplitude_uv must be greater than 0.");
    const slow = num(bg.slow_fraction);
    if (slow !== null && (slow < 0 || slow > 1)) {
      errors.push("background.slow_fraction must be between 0 and 1.");
    }
    if (bg.type === "burst_suppression" && !isObj(bg.burst_suppression)) {
      errors.push("background.type is burst_suppression but no burst_suppression block was given.");
    }
    if (isObj(bg.asymmetry) && !["left", "right"].includes(String(bg.asymmetry.side))) {
      errors.push("background.asymmetry.side must be left or right.");
    }
  }

  // events
  const events = Array.isArray(spec.events) ? spec.events : [];
  if (spec.events !== undefined && !Array.isArray(spec.events)) {
    errors.push("spec.events must be a list.");
  }
  if (events.length === 0) {
    warnings.push("No events — this is a background-only recording. Intended?");
  }
  events.forEach((raw, i) => {
    const where = `events[${i}]`;
    if (!isObj(raw)) { errors.push(`${where} is not an object.`); return; }
    const type = String(raw.type ?? "");
    if (!ALL_EVENT_TYPES.includes(type)) {
      errors.push(`${where}.type "${type}" is not a known event type.`);
      return;
    }
    const at = num(raw.onset_min) ?? num(raw.at_min) ?? num(raw.start_min);
    if (at === null) {
      errors.push(`${where} has no onset_min / at_min / start_min.`);
    } else if (at < 0) {
      errors.push(`${where} starts before the recording does.`);
    } else if (durationS > 0 && at * 60 >= durationS) {
      errors.push(`${where} starts at ${at} min, past the end of a ${Math.round(durationS / 60)} min recording.`);
    }

    const region = raw.onset_region ?? (isObj(raw.seizure) ? raw.seizure.onset_region : undefined);
    if (region !== undefined && !REGIONS.includes(region as LabRegion)) {
      errors.push(`${where}.onset_region "${String(region)}" is not a known region.`);
    }
    if (raw.spread !== undefined && !SPREADS.includes(raw.spread as LabSpread)) {
      errors.push(`${where}.spread "${String(raw.spread)}" is not a known spread.`);
    }

    if (type === "seizure_cluster") {
      const start = num(raw.start_min);
      const end = num(raw.end_min);
      const interval = num(raw.interval_min);
      if (start !== null && end !== null && end <= start) {
        errors.push(`${where}.end_min must be after start_min.`);
      }
      if (interval !== null && interval <= 0) {
        errors.push(`${where}.interval_min must be greater than 0.`);
      }
    }

    if (type === "artifact") {
      if (!ARTIFACT_KINDS.includes(raw.kind as LabArtifactKind)) {
        errors.push(`${where}.kind "${String(raw.kind)}" is not a known artifact.`);
      }
    }

    if (type === "sedation_change") {
      if (!SEDATION_AGENTS.includes(raw.agent as LabSedationAgent)) {
        errors.push(`${where}.agent "${String(raw.agent)}" is not a known agent.`);
      }
      if (raw.direction !== undefined && !["increase", "decrease"].includes(String(raw.direction))) {
        errors.push(`${where}.direction must be increase or decrease.`);
      }
    }

    if (type === "attenuation_transient") {
      const depth = num(raw.depth_pct);
      const deltaDepth = num(raw.delta_depth_pct);
      if (depth === null) {
        errors.push(`${where}.depth_pct is required.`);
      } else if (depth < 0 || depth > 100) {
        errors.push(`${where}.depth_pct must be between 0 and 100.`);
      }
      if (deltaDepth !== null && (deltaDepth < 0 || deltaDepth > 100)) {
        errors.push(`${where}.delta_depth_pct must be between 0 and 100.`);
      }
      if (depth !== null && (deltaDepth === null || deltaDepth >= depth)) {
        warnings.push(
          `${where}: delta is attenuated as much as everything else, so every band ratio ` +
          "stays flat. Set delta_depth_pct below depth_pct for an ischemic pattern.",
        );
      }
    }

    if (type === "state_change" && !["sleep", "wake", "arousal"].includes(String(raw.to))) {
      errors.push(`${where}.to must be sleep, wake or arousal.`);
    }
  });

  // annotations — these DO travel into the learner file, so they are the one
  // place a spec can leak the answer without anyone passing --answers.
  const annotations = Array.isArray(spec.annotations) ? spec.annotations : [];
  annotations.forEach((raw, i) => {
    if (!isObj(raw)) { errors.push(`annotations[${i}] is not an object.`); return; }
    const at = num(raw.at_min);
    const label = typeof raw.label === "string" ? raw.label : "";
    if (at === null) errors.push(`annotations[${i}].at_min is required.`);
    if (!label) errors.push(`annotations[${i}].label is required.`);
    if (label.length > 60) errors.push(`annotations[${i}].label is longer than 60 characters.`);
    if (GIVEAWAY_RE.test(label)) {
      warnings.push(
        `annotations[${i}] ("${label}") names the finding. Annotations are written into the ` +
        "LEARNER file — this one gives the case away on the time axis.",
      );
    }
  });

  // Persyst pre-flight — both of these are measured failure modes that exit 0.
  if (opts.runPersyst) {
    if (durationS > 0 && durationS < PERSYST_BASELINE_MIN_S) {
      warnings.push(
        `At ${Math.round(durationS / 60)} min this recording is shorter than the stock MMX ` +
        "baseline auto-search window, so every VsBaseline instrument comes back all zero " +
        "with exit code 0 — indistinguishable from 'signal equals baseline'.",
      );
    }
    if (channels === "neonatal_9" || channels === "neonatal_reduced") {
      warnings.push(
        "The neonatal 9-electrode set is a long way from what the stock adult MMX expects; " +
        "check the trend output rather than trusting exit code 0.",
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Recording length in seconds, from the block the worker will be handed. */
export function durationSecondsFromSpec(block: unknown, fallbackMin: number): number {
  if (isObj(block) && isObj(block.spec)) {
    const d = num(block.spec.duration_min);
    if (d !== null) return d * 60;
  }
  return fallbackMin * 60;
}

/** JSON with object keys sorted, so key order never changes the spec hash. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Json)
    .filter(([, child]) => child !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
    .join(",")}}`;
}
