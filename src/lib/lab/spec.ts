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
  type LabAcnsPattern,
  type LabAcnsPlus,
  type LabAcnsPrevalence,
  type LabDischargeMorphology,
  type LabGeneralizedSeizureType,
  type LabOnsetPattern,
  type LabProvocation,
  type LabSpecVersion,
  type LabStimulus,
  type GuidedScenario,
  type LabArtifactKind,
  type LabAgeBand,
  type LabBackgroundLevel,
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
  { id: "adult", label: "Adult" },
];

export const CHANNEL_SETS: { id: LabChannelSet; label: string; hint: string; v3?: true }[] = [
  { id: "standard_19", label: "Standard 19 (10-20)", hint: "19 scalp electrodes" },
  { id: "neonatal_9", label: "Neonatal reduced (9)", hint: "9-electrode neonatal array" },
  { id: "standard_19_t1t2", label: "Standard 19 + T1/T2 (v3)", hint: "10-20 plus the subtemporal pair", v3: true },
];

/** `v3`: renderer 0.5.0 only — the renderer rejects it below spec_version 3. Ids match src/lib/eeg/montage.ts. */
export const MONTAGES: { id: LabMontage; label: string; v3?: true }[] = [
  { id: "longitudinal_bipolar", label: "Longitudinal bipolar" },
  { id: "referential", label: "Referential" },
  { id: "average", label: "Average reference" },
  { id: "neonatal_reduced", label: "Neonatal reduced" },
  { id: "transverse_bipolar", label: "Transverse bipolar (v3)", v3: true },
  { id: "circumferential", label: "Circumferential / hatband (v3)", v3: true },
  { id: "grapefruit", label: "Grapefruit (v3)", v3: true },
  { id: "t1t2_bipolar", label: "Longitudinal with T1/T2 (v3)", v3: true },
  { id: "ipsilateral_ear", label: "Ipsilateral ear (v3)", v3: true },
  { id: "contralateral_ear", label: "Contralateral ear (v3)", v3: true },
  { id: "cz_reference", label: "Cz reference (v3)", v3: true },
  { id: "neonatal_average", label: "Neonatal average (v3)", v3: true },
  { id: "laplacian", label: "Laplacian (v3)", v3: true },
];

/** The viewer's montage synonyms the renderer resolves (spec.normalize); valid in pasted specs, v3 only. */
const V3_MONTAGE_ALIASES = ["hatband", "transverse", "longitudinal_t1t2", "hjorth"];
const V3_MONTAGE_IDS: string[] = [...MONTAGES.filter((m) => m.v3).map((m) => m.id), ...V3_MONTAGE_ALIASES];

export const SPEC_VERSIONS: { id: LabSpecVersion; label: string }[] = [
  { id: 1, label: "v1 — 0.3.x defaults (bank)" },
  { id: 2, label: "v2 — 0.4 defaults" },
  { id: 3, label: "v3 — 0.5.0 (ACNS, generalized, sleep staging)" },
];

/**
 * Highest spec_version the deployed render worker's eeg-render accepts. Raise
 * to 3 once renderer 0.5.0 is deployed to the moltbot workers; until then a v3
 * spec is accepted here but warned, because the worker's own validate rejects it.
 */
export const WORKER_MAX_SPEC_VERSION: LabSpecVersion = 3;

export const BACKGROUND_TYPES: { id: LabBackgroundType; label: string }[] = [
  { id: "continuous", label: "Continuous" },
  { id: "discontinuous", label: "Discontinuous" },
  { id: "excessively_discontinuous", label: "Excessively discontinuous" },
  { id: "burst_suppression", label: "Burst suppression" },
  { id: "suppressed", label: "Suppressed" },
  { id: "low_voltage", label: "Low voltage" },
  { id: "trace_alternant", label: "Tracé alternant" },
  { id: "hypsarrhythmia", label: "Hypsarrhythmia" },
];

export const REGIONS: LabRegion[] = [
  "left_temporal", "right_temporal", "left_frontal", "right_frontal",
  "left_central", "right_central", "left_occipital", "right_occipital",
  "left_hemisphere", "right_hemisphere", "generalized", "midline",
  "left_mesial_temporal", "right_mesial_temporal", "left_parietal", "right_parietal",
];
/** Onset regions renderer 0.5.0 added; below spec_version 3 they get no region-specific onset. */
const V3_REGIONS: LabRegion[] = ["left_mesial_temporal", "right_mesial_temporal", "left_parietal", "right_parietal"];

export const SPREADS: LabSpread[] = ["none", "hemispheric", "generalized", "contralateral"];

export const ARTIFACT_KINDS: LabArtifactKind[] = [
  "emg_chewing", "patting", "chest_pt", "ventilator", "ecmo_pump",
  "electrode_pop", "sixty_hz", "ecg", "movement", "sweat", "eye_blink",
  "lateral_eye", "slow_roving_eye", "rem_eye_movements", "pulse", "glossokinetic",
];

/** `normal_variant` kinds (renderer AUTHORED_VARIANTS); `artifact` must not use them. */
const AUTHORED_VARIANTS = [
  "mu", "lambda", "wicket", "fourteen_and_six", "rmtd", "sreda", "midline_theta",
  "frontal_arousal_rhythm", "photic_driving", "hyperventilation_buildup",
];

export const SEDATION_AGENTS: LabSedationAgent[] = [
  "propofol", "midazolam", "pentobarbital", "dexmedetomidine", "ketamine", "remifentanil",
];

export const ONSET_PATTERNS: { id: LabOnsetPattern | ""; label: string }[] = [
  { id: "", label: "Renderer default" },
  { id: "auto", label: "By region (v3)" },
  { id: "lvfa", label: "Low-voltage fast (v3)" },
  { id: "rhythmic_theta", label: "Rhythmic theta, mesial temporal (v3)" },
  { id: "electrodecrement", label: "Electrodecrement, frontal (v3)" },
  { id: "rhythmic_spikes", label: "Rhythmic spikes (v3)" },
];

export const ACNS_PATTERNS: { id: LabAcnsPattern; label: string; periodic: boolean; region: LabRegion }[] = [
  { id: "LPDs", label: "LPDs (lateralized periodic discharges)", periodic: true, region: "left_hemisphere" },
  { id: "GPDs", label: "GPDs (generalized periodic discharges)", periodic: true, region: "generalized" },
  { id: "BIPDs", label: "BIPDs (bilateral independent PDs)", periodic: true, region: "generalized" },
  { id: "LRDA", label: "LRDA (lateralized rhythmic delta)", periodic: false, region: "left_temporal" },
  { id: "GRDA", label: "GRDA (generalized rhythmic delta)", periodic: false, region: "generalized" },
  { id: "BIRDs", label: "BIRDs (brief potentially ictal rhythmic discharges)", periodic: false, region: "left_temporal" },
  { id: "EDB", label: "Extreme delta brush", periodic: false, region: "generalized" },
  { id: "triphasic", label: "Triphasic GPDs", periodic: true, region: "generalized" },
  { id: "SIRPIDs", label: "SIRPIDs (stimulus-induced)", periodic: false, region: "generalized" },
];
export const ACNS_PLUS: LabAcnsPlus[] = ["", "+F", "+R", "+S", "+FR", "+FS"];
export const ACNS_PREVALENCE: LabAcnsPrevalence[] = ["", "continuous", "abundant", "frequent", "occasional", "rare"];

export const GENERALIZED_SEIZURE_TYPES: { id: LabGeneralizedSeizureType; label: string }[] = [
  { id: "typical_absence", label: "Typical absence (3 Hz spike-wave)" },
  { id: "atypical_absence", label: "Atypical absence (slow spike-wave)" },
  { id: "myoclonic", label: "Myoclonic" },
  { id: "myoclonic_atonic", label: "Myoclonic-atonic" },
  { id: "myoclonic_tonic", label: "Myoclonic-tonic" },
  { id: "tonic", label: "Tonic (paroxysmal fast)" },
  { id: "atonic", label: "Atonic" },
  { id: "gtc", label: "Generalized tonic-clonic" },
  { id: "eyelid_myoclonia", label: "Eyelid myoclonia" },
  { id: "photoparoxysmal", label: "Photoparoxysmal response" },
];
const GENERALIZED_DISCHARGE_PATTERNS = ["spike_wave", "polyspike_wave", "slow_spike_wave", "gpfa", "eses"];
/** generalized_seizure types whose length is `duration_s`; myoclonic types are trains of `count` jerks. */
export const DURATION_SEIZURE_TYPES: LabGeneralizedSeizureType[] = ["typical_absence", "atypical_absence", "tonic", "atonic"];
export const MYOCLONIC_TYPES: LabGeneralizedSeizureType[] = ["myoclonic", "myoclonic_atonic", "myoclonic_tonic"];

export const PROVOCATIONS: LabProvocation[] = ["none", "hyperventilation", "photic", "eye_closure", "sleep", "awakening"];
export const DISCHARGE_MORPHOLOGIES: LabDischargeMorphology[] = ["spike", "sharp_wave", "polyspike"];
export const DISCHARGE_FOCI = [
  "Fp1", "Fp2", "F7", "F3", "Fz", "F4", "F8", "T3", "C3", "Cz", "C4", "T4",
  "T5", "P3", "Pz", "P4", "T6", "O1", "O2",
];
export const STIMULI: LabStimulus[] = [
  "auditory", "light_tactile", "patient_care", "noxious", "suction", "sternal_rub",
  "nailbed_pressure", "nostril_tickle", "trapezius_squeeze", "other",
];

export const EVENT_TYPE_LABELS: Record<GuidedEvent["type"], string> = {
  seizure: "Seizure",
  seizure_cluster: "Seizure cluster",
  sedation_change: "Sedation change",
  attenuation_transient: "Attenuation transient",
  artifact: "Artifact",
  state_change: "State change",
  rhythmic_pattern: "ACNS pattern (v3)",
  generalized_seizure: "Generalized seizure (v3)",
  sporadic_discharges: "Sporadic discharges",
  stimulation: "Stimulation",
};

/** Every event type the renderer accepts — wider than the Guided form offers,
 *  because Expert mode may legitimately use the rest of the DSL. */
const ALL_EVENT_TYPES = [
  "seizure", "seizure_cluster", "status_epilepticus", "sedation_change",
  "attenuation_transient", "temperature_change", "stimulation", "artifact",
  "state_change", "rhythmic_pattern", "normal_variant", "spasm", "spasm_cluster",
  "tonic_seizure", "brd", "sporadic_discharges", "generalized_seizure", "generalized_discharges",
];
/** Event types the renderer refuses below spec_version 3 (spec.py raises SpecError). */
const V3_EVENT_TYPES = ["generalized_seizure", "generalized_discharges"];
/** Event types with no start time: they cover the whole record unless start_min / end_min narrow them. */
const UNTIMED_EVENT_TYPES = ["temperature_change", "sporadic_discharges", "generalized_discharges"];
/** rhythmic_pattern keys accepted but not synthesized below spec_version 3 (spec.rpp_warnings). */
const ACNS_V3_KEYS = ["sharpness", "stimulus_induced", "prevalence", "duration_category", "lag", "predominance"];

/**
 * The renderer's qeeg_panel schema floors duration_min at 30 and caps it at
 * 2880 (48 h). The lab keeps the same window so a stored spec stays valid
 * against `eeg-render validate`.
 */
export const DURATION_MIN_MINUTES = 30;
export const DURATION_MAX_MINUTES = 2880;

export const SAMPLE_RATES = [200, 256, 512];

// ── defaults ───────────────────────────────────────────────────────────────

/**
 * Background levels the renderer fills when they are left out: AGE_DEFAULTS in
 * tools/eeg-render/eeg_render/spec.py, plus its two special cases — a continuous
 * child background at spec_version 3 (CHILD_AMPLITUDE_UV_V3, the awake voltage a
 * reader measures on the bipolar page) and HYPSARRHYTHMIA_DEFAULTS. Suppressed,
 * low-voltage and burst-suppression backgrounds keep the age preset: the renderer
 * scales them down itself, so they stay physiologic. The guide's age table
 * (guide-content.ts) is tested against this.
 */
export const AGE_BACKGROUND_DEFAULTS: Record<LabAgeBand, { dominantHz: number; amplitudeUv: number; slowFraction: number }> = {
  neonate: { dominantHz: 1.5, amplitudeUv: 60, slowFraction: 0.8 },
  infant: { dominantHz: 5.5, amplitudeUv: 55, slowFraction: 0.55 },
  child: { dominantHz: 8, amplitudeUv: 45, slowFraction: 0.4 },
  adolescent: { dominantHz: 9.5, amplitudeUv: 35, slowFraction: 0.3 },
  adult: { dominantHz: 10, amplitudeUv: 30, slowFraction: 0.25 },
};
export const CHILD_AMPLITUDE_UV_V3 = 90;
const HYPSARRHYTHMIA_LEVELS = { dominantHz: 1.3, amplitudeUv: 280, slowFraction: 0.95 };
const BACKGROUND_LEVELS: LabBackgroundLevel[] = ["dominantHz", "amplitudeUv", "slowFraction"];

export function backgroundDefaults(age: LabAgeBand, type: LabBackgroundType, specVersion: LabSpecVersion) {
  if (type === "hypsarrhythmia") return { ...HYPSARRHYTHMIA_LEVELS };
  const d = { ...AGE_BACKGROUND_DEFAULTS[age] };
  if (specVersion >= 3 && age === "child" && type === "continuous") d.amplitudeUv = CHILD_AMPLITUDE_UV_V3;
  return d;
}

/** The spec_version the built spec will carry: the author's choice, raised to what the events need. */
export function effectiveSpecVersion(g: GuidedScenario): LabSpecVersion {
  return Math.max(g.specVersion ?? 1, requiredSpecVersion(g)) as LabSpecVersion;
}

/** Refill every background level the author has not edited from the current age / type / edition defaults. */
export function withBackgroundDefaults(g: GuidedScenario): GuidedScenario {
  const d = backgroundDefaults(g.ageBand, g.background.type, effectiveSpecVersion(g));
  const edited = g.background.edited ?? [];
  const next = { ...g.background };
  let changed = false;
  for (const k of BACKGROUND_LEVELS) {
    if (!edited.includes(k) && next[k] !== d[k]) { next[k] = d[k]; changed = true; }
  }
  return changed ? { ...g, background: next } : g;
}

/** Record an author's edit of one background level; it no longer follows the defaults. */
export function editBackgroundLevel(g: GuidedScenario, level: LabBackgroundLevel, value: number): GuidedScenario {
  const edited = g.background.edited ?? [];
  return {
    ...g,
    background: { ...g.background, [level]: value, edited: edited.includes(level) ? edited : [...edited, level] },
  };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2_000_000_000) + 1;
}

export function defaultEvolution() {
  return { startHz: 4, endHz: 1.5, amplitudeStartUv: 60, amplitudeEndUv: 150 };
}

export function defaultGuidedScenario(): GuidedScenario {
  return {
    // New forms start at edition 3 (renderer 0.5.0, WORKER_MAX_SPEC_VERSION 3). A scenario without specVersion
    // (older clients, saved requests) still builds as before: omitted = the renderer's version 1.
    specVersion: 3,
    ageBand: "child",
    channels: "standard_19",
    montage: "longitudinal_bipolar",
    // 200 Hz is what the proven Persyst runs used; it also halves the .dat.
    sampleRate: 200,
    durationMin: 120,
    seed: randomSeed(),
    background: {
      type: "continuous",
      ...backgroundDefaults("child", "continuous", 3),
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
    case "rhythmic_pattern":
      return {
        id: newId(), type, onsetMin: mid, durationMin: 20, pattern: "LPDs", onsetRegion: "left_hemisphere",
        frequencyHz: 1.5, amplitudeUv: 80, plus: "", prevalence: "", evolving: false,
      };
    case "generalized_seizure":
      return { id: newId(), type, onsetMin: mid, seizureType: "typical_absence", provocation: "none", durationS: 10, count: 1 };
    case "sporadic_discharges":
      return { id: newId(), type, focus: "T3", ratePerH: 60, morphology: "spike", aftergoingSlow: true, sleepActivation: 1 };
    case "stimulation":
      return { id: newId(), type, atMin: mid, stimulus: "noxious" };
  }
}

/** Lowest spec_version the Guided scenario's choices need (the renderer rejects or ignores them below it). */
export function requiredSpecVersion(g: GuidedScenario): LabSpecVersion {
  const v3 =
    MONTAGES.some((m) => m.v3 && m.id === g.montage)
    || g.channels === "standard_19_t1t2"
    || g.events.some((e) =>
      e.type === "rhythmic_pattern" || e.type === "generalized_seizure"
      || (e.type === "seizure" && !!e.onsetPattern)
      || (e.type === "sporadic_discharges" && e.sleepActivation !== 1)
      || ((e.type === "seizure" || e.type === "seizure_cluster") && V3_REGIONS.includes(e.onsetRegion)));
  return v3 ? 3 : 1;
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
        ...(event.onsetPattern ? { onset_pattern: event.onsetPattern } : {}),
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
    case "rhythmic_pattern": {
      const def = ACNS_PATTERNS.find((p) => p.id === event.pattern);
      return {
        type: "rhythmic_pattern",
        onset_min: event.onsetMin,
        duration_min: event.durationMin,
        pattern: event.pattern,
        onset_region: event.onsetRegion,
        periodic: def?.periodic ?? false,
        frequency_hz: event.frequencyHz,
        amplitude_uv: event.amplitudeUv,
        ...(event.plus ? { plus_modifier: event.plus } : {}),
        ...(event.prevalence ? { prevalence: event.prevalence } : {}),
        // the renderer reads evolution from the modifier ("evolving"), ACNS criterion B
        ...(event.evolving ? { modifier: "evolving" } : {}),
      };
    }
    case "generalized_seizure":
      return {
        type: "generalized_seizure",
        onset_min: event.onsetMin,
        seizure_type: event.seizureType,
        provocation: event.provocation,
        ...(DURATION_SEIZURE_TYPES.includes(event.seizureType) ? { duration_s: event.durationS } : {}),
        ...(MYOCLONIC_TYPES.includes(event.seizureType) ? { count: Math.max(1, Math.trunc(event.count)) } : {}),
      };
    case "sporadic_discharges":
      return {
        type: "sporadic_discharges",
        focus: event.focus,
        rate_per_h: event.ratePerH,
        morphology: event.morphology,
        aftergoing_slow: event.aftergoingSlow,
        ...(event.sleepActivation !== 1 ? { sleep_activation: event.sleepActivation } : {}),
      };
    case "stimulation":
      return { type: "stimulation", at_min: event.atMin, stimulus: event.stimulus };
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
    slow_fraction: g.background.slowFraction,
    reactivity: g.background.reactivity,
  };
  // An unedited amplitude is left to the renderer, which fills the same default and, on a default child
  // background, scales its event defaults (sporadic discharges, variants) to it; an authored value would not.
  if ((g.background.edited ?? []).includes("amplitudeUv")
      || g.background.amplitudeUv !== backgroundDefaults(g.ageBand, g.background.type, effectiveSpecVersion(g)).amplitudeUv) {
    background.amplitude_uv = g.background.amplitudeUv;
  }
  if (g.background.type === "burst_suppression") {
    background.burst_suppression = { burst_s: g.background.burstS, ibi_s: g.background.ibiS };
  }

  const annotations = g.annotations
    .filter((a) => a.label.trim().length > 0)
    .map((a) => ({ at_min: a.atMin, label: a.label.trim() }));

  // Omitted = the renderer's version 1 (what every guided recording used before spec_version was offered).
  const specVersion = effectiveSpecVersion(g);
  const spec: Json = {
    ...(g.specVersion !== undefined || specVersion > 1 ? { spec_version: specVersion } : {}),
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

/** (+F, +R, +S) from an ACNS plus string — rpp_v3.parse_plus. */
function parsePlus(plus: unknown): [boolean, boolean, boolean] {
  const p = String(plus ?? "").toLowerCase().replaceAll(" ", "");
  const f = p.includes("+f") || p.includes("fast");
  const r = p.includes("+r") || p.replace("+f", "f").includes("fr") || p.includes("rhythm");
  const s = p.includes("+s") || p.replace("+f", "f").includes("fs") || p.includes("sharp");
  return [f, r, s];
}

/** ACNS 2021 consistency of a rhythmic_pattern — the advisories spec.rpp_warnings prints, as editor warnings. */
function validateAcns(
  raw: Json, where: string, version: number, events: unknown[], warnings: string[],
  ignoredBelowV3: (what: string) => void,
): void {
  const pat = String(raw.pattern ?? "").toUpperCase();
  const modifier = String(raw.modifier ?? "").toLowerCase();
  const [, hasR, hasS] = parsePlus(raw.plus_modifier);
  const triphasic = pat === "TRIPHASIC" || modifier.includes("triphasic");
  const periodic = raw.periodic === true || (raw.periodic === undefined && pat === "TRIPHASIC");
  if (version < 3) {
    const used = ACNS_V3_KEYS.filter((k) => raw[k] !== undefined && raw[k] !== null && raw[k] !== false && raw[k] !== "");
    if (hasR) used.push("+R");
    if (modifier.includes("evolv")) used.push("evolving");
    if (triphasic) used.push("triphasic");
    if (["BIRDS", "SIRPIDS", "EDB"].includes(pat)) used.push(String(raw.pattern));
    if (used.length) ignoredBelowV3(`${where}: ${used.join(", ")}`);
    return;
  }
  if (typeof raw.sharpness === "string" && !["spiky", "sharp", "sharply_contoured", "blunt"].includes(raw.sharpness)) {
    warnings.push(`${where}.sharpness "${raw.sharpness}" is not an ACNS category (spiky, sharp, sharply_contoured, blunt).`);
  }
  if (hasR && !periodic) warnings.push(`${where}: +R applies to PDs only (ACNS 2021); ignored on RDA.`);
  if (hasS && periodic) warnings.push(`${where}: +S applies to RDA only (ACNS 2021); on PDs it renders as sharpness "spiky".`);
  if (triphasic && raw.periodic === false) warnings.push(`${where}: triphasic morphology applies to PDs, not RDA; ignored.`);
  if (pat === "BIRDS") {
    const f = num(raw.frequency_hz);
    const d = num(raw.run_duration_s);
    if (f !== null && f <= 4) warnings.push(`${where}: BIRDs are > 4 Hz (ACNS 2021); the run is raised to 4.3 Hz.`);
    if (d !== null && d >= 10) warnings.push(`${where}: BIRDs last < 10 s; run_duration_s is capped at 9.5 s.`);
  }
  const stimulusInduced = raw.stimulus_induced === true || pat === "SIRPIDS"
    || modifier.includes("stimulus") || modifier.split("-")[0].trim() === "si";
  if (stimulusInduced && !events.some((e) => isObj(e) && e.type === "stimulation")) {
    warnings.push(`${where}: stimulus-induced without a stimulation event, so no runs are scheduled.`);
  }
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

  // spec_version picks the renderer's defaults for every omitted key; 3 unlocks the 0.5.0 feature set.
  let version = 1;
  if (spec.spec_version !== undefined) {
    const v = num(spec.spec_version);
    if (v === null || !Number.isInteger(v) || v < 1 || v > 3) {
      errors.push("spec.spec_version must be 1, 2 or 3.");
    } else {
      version = v;
      if (v > WORKER_MAX_SPEC_VERSION) {
        warnings.push(
          `spec_version ${v} needs eeg-render 0.5.0 on the render worker; the deployed worker accepts up to ` +
          `${WORKER_MAX_SPEC_VERSION} and will reject this job until the renderer is deployed.`,
        );
      }
    }
  }
  const needsV3 = (what: string) => errors.push(`${what} needs spec_version 3 (set "spec_version": 3).`);
  const ignoredBelowV3 = (what: string) => warnings.push(`${what} is accepted but not synthesized below spec_version 3.`);
  if (version < 3 && isObj(spec.style)) {
    for (const key of ["spindle_topography", "k_complex_spindle_delay_s"]) {
      if (spec.style[key] !== undefined) ignoredBelowV3(`style.${key}`);
    }
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
      && !["standard_19", "neonatal_9", "neonatal_reduced", "standard_19_t1t2"].includes(String(channels))) {
    errors.push(`spec.channels "${String(channels)}" is not a known channel set.`);
  } else if (channels === "standard_19_t1t2" && version < 3) {
    needsV3("channels standard_19_t1t2");
  }
  const montage = spec.montage;
  if (montage !== undefined && !MONTAGES.some((m) => m.id === montage) && !V3_MONTAGE_ALIASES.includes(String(montage))) {
    errors.push(`spec.montage "${String(montage)}" is not a known montage.`);
  } else if (V3_MONTAGE_IDS.includes(String(montage)) && version < 3) {
    needsV3(`montage ${String(montage)}`);
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
    if (version < 3) {
      for (const key of ["sleep_staging", "sleep_architecture", "coma_pattern"]) {
        if (bg[key] !== undefined) ignoredBelowV3(`background.${key}`);
      }
      if (isObj(bg.variants) && isObj(bg.variants.posts) && bg.variants.posts.interval_s !== undefined) {
        ignoredBelowV3("background.variants.posts.interval_s");
      }
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
    if (V3_EVENT_TYPES.includes(type) && version < 3) needsV3(`${where}.type ${type}`);
    const at = num(raw.onset_min) ?? num(raw.at_min) ?? num(raw.start_min);
    if (at === null) {
      if (!UNTIMED_EVENT_TYPES.includes(type)) errors.push(`${where} has no onset_min / at_min / start_min.`);
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
    if (version < 3 && V3_REGIONS.includes(region as LabRegion)) {
      warnings.push(`${where}.onset_region ${String(region)} gets its region-specific onset only at spec_version 3.`);
    }
    const onsetPattern = raw.onset_pattern ?? (isObj(raw.seizure) ? raw.seizure.onset_pattern : undefined);
    if (onsetPattern !== undefined && version < 3) ignoredBelowV3(`${where}.onset_pattern`);

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
        errors.push(
          AUTHORED_VARIANTS.includes(String(raw.kind))
            ? `${where}.kind "${String(raw.kind)}" is a normal variant — use type normal_variant.`
            : `${where}.kind "${String(raw.kind)}" is not a known artifact.`,
        );
      }
    }

    if (type === "normal_variant" && !AUTHORED_VARIANTS.includes(String(raw.kind))) {
      errors.push(`${where}.kind "${String(raw.kind)}" is not an authored normal variant (${AUTHORED_VARIANTS.join(", ")}).`);
    }
    if (type === "normal_variant" && version < 3 && raw.train_duration_s !== undefined) {
      ignoredBelowV3(`${where}.train_duration_s`);
    }

    if (type === "generalized_seizure" && raw.seizure_type !== undefined
        && !GENERALIZED_SEIZURE_TYPES.some((t) => t.id === raw.seizure_type)) {
      errors.push(`${where}.seizure_type "${String(raw.seizure_type)}" is not a known generalized seizure type.`);
    }
    if (type === "generalized_discharges" && raw.pattern !== undefined
        && !GENERALIZED_DISCHARGE_PATTERNS.includes(String(raw.pattern))) {
      errors.push(`${where}.pattern must be one of ${GENERALIZED_DISCHARGE_PATTERNS.join(", ")}.`);
    }

    if (type === "sporadic_discharges") {
      if (version < 3 && raw.centrotemporal_triphasic !== undefined) {
        ignoredBelowV3(`${where}.centrotemporal_triphasic`);
      }
      if (Array.isArray(raw.foci) && Array.isArray(raw.focus_weights) && raw.foci.length !== raw.focus_weights.length) {
        errors.push(`${where}.focus_weights must match foci in length.`);
      }
      if (version < 3 && ["sleep_activation", "state_rates", "foci"].some((k) => raw[k] !== undefined)) {
        ignoredBelowV3(`${where}: sleep_activation / state_rates / foci`);
      }
    }

    if (type === "rhythmic_pattern") validateAcns(raw, where, version, events, warnings, ignoredBelowV3);

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

    if (type === "state_change" && raw.to !== undefined && !["sleep", "wake", "arousal", "rem"].includes(String(raw.to))) {
      errors.push(`${where}.to must be sleep, wake, arousal or rem.`);
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
