// Answer-key row taxonomy: which realized rows are ictal, how they group for
// the instructor overlay, and a one-line teaching description of each row.
//
// Isomorphic and pure. The vocabulary mirrors eeg_render/export/manifest.py
// (realized_events) and rpp_v3.classify of renderer 0.5.0 (spec_version 3);
// older manifests use a subset of the same kinds and simply carry fewer
// descriptors.

import type { AnnotationRegion } from "@/lib/eeg/annotations";

/** manifest.ICTAL_KINDS — the rows seizure burden counts, whatever their descriptors. */
export const ICTAL_KINDS = [
  "seizure", "seizure_cluster", "status_epilepticus", "spasm", "spasm_cluster", "tonic_seizure",
  "generalized_seizure",
] as const;

/** Rows a "mark each discharge" task is graded against (single spikes/sharps and generalized bursts). */
export const DISCHARGE_KINDS = ["discharge", "spike", "sharp_wave", "sporadic_discharge", "generalized_discharge"] as const;

export type KeyCategory =
  | "ictal" | "iic" | "rpp" | "interictal" | "normal" | "background" | "artifact" | "state" | "context";

export const KEY_CATEGORIES: { id: KeyCategory; label: string; color: string }[] = [
  { id: "ictal", label: "Seizure", color: "#e5484d" },
  { id: "iic", label: "Ictal–interictal continuum / BIRDs", color: "#f76b15" },
  { id: "rpp", label: "Rhythmic / periodic pattern", color: "#d6409f" },
  { id: "interictal", label: "Interictal discharge", color: "#8e4ec6" },
  { id: "normal", label: "Normal variant / graphoelement", color: "#30a46c" },
  { id: "background", label: "Background change", color: "#0090ff" },
  { id: "artifact", label: "Artifact", color: "#8e8e93" },
  { id: "state", label: "State / sleep stage", color: "#3e63dd" },
  { id: "context", label: "Clinical context", color: "#ab6400" },
];

export function categoryColor(category: KeyCategory): string {
  return KEY_CATEGORIES.find((c) => c.id === category)?.color ?? "#e5484d";
}

/** Scalar descriptors carried from a manifest row; everything else (sample indexes, arrays) is dropped. */
export type KeyDetail = Record<string, string | number | boolean>;

const DROP = new Set([
  "kind", "onset_s", "offset_s", "onset_sample", "offset_sample", "clipped_at_start", "clipped_at_end",
  "label_type", "channels",
]);
const MAX_DETAIL_KEYS = 48;
const MAX_DETAIL_STRING = 200;

/** Keep the scalar, JSON-safe descriptors of a row (bounded, so an override row cannot grow without limit). */
export function pickDetail(row: Record<string, unknown>): KeyDetail {
  const out: KeyDetail = {};
  let n = 0;
  for (const [k, v] of Object.entries(row)) {
    if (DROP.has(k) || !/^[a-z][a-z0-9_]{0,63}$/i.test(k)) continue;
    if (typeof v === "string") out[k] = v.slice(0, MAX_DETAIL_STRING);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    else continue;
    if (++n >= MAX_DETAIL_KEYS) break;
  }
  return out;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Ictal = counts as a seizure for the seizure task: a row of an ictal kind, or
 * an ACNS rhythmic/periodic run the renderer classified as an electrographic
 * seizure (criterion A/B, or a BIRD lasting >= 10 s).
 */
export function isIctalRow(kind: string, detail: KeyDetail = {}): boolean {
  return (ICTAL_KINDS as readonly string[]).includes(kind) || detail.acns_classification === "electrographic_seizure";
}

export function categoryOf(kind: string, detail: KeyDetail = {}): KeyCategory {
  if (isIctalRow(kind, detail)) return "ictal";
  const acns = str(detail.acns_classification);
  if (kind === "rhythmic_pattern") return acns === "IIC" || acns.startsWith("BIRDs") ? "iic" : "rpp";
  if (kind === "brd") return "iic";
  // learner kinds too, so a mark promoted into the key (or a hand-added row) grades like a rendered one
  if (kind === "rhythmic_periodic") return "rpp";
  if ((DISCHARGE_KINDS as readonly string[]).includes(kind)) return "interictal";
  if (["normal_variant", "activation_response", "arousal_pattern_pending_review", "delta_brush"].includes(kind)) return "normal";
  if (["attenuation_transient", "cape_cycle", "background_change"].includes(kind)) return "background";
  if (kind === "artifact") return "artifact";
  if (["sleep_stage", "arousal", "state", "state_detail", "state_change"].includes(kind)) return "state";
  return "context";
}

/** Overlay presets: what the instructor key shows on the traces and the trend strip. */
export type KeyOverlayFilter = "findings" | "ictal" | "all";
export const KEY_OVERLAY_FILTERS: { id: KeyOverlayFilter; label: string }[] = [
  { id: "findings", label: "Findings" },
  { id: "ictal", label: "Seizures only" },
  { id: "all", label: "Everything (incl. stages)" },
];

export function overlayShows(filter: KeyOverlayFilter, category: KeyCategory): boolean {
  if (filter === "all") return true;
  if (filter === "ictal") return category === "ictal";
  return category !== "state" && category !== "context";
}

// ── region vocabulary ──────────────────────────────────────────────────────

/**
 * Renderer 0.5.0 added mesial-temporal and parietal onsets; the learner region
 * vocabulary (and its DB check constraint) has neither. Grade them against the
 * nearest learner region: mesial temporal is anterior temporal (F7/F8 maximum),
 * and P3/P4 sit in the site's occipital (parieto-occipital) electrode group.
 */
const RENDERER_REGION_MAP: Record<string, AnnotationRegion> = {
  left_mesial_temporal: "left_temporal",
  right_mesial_temporal: "right_temporal",
  left_parietal: "left_occipital",
  right_parietal: "right_occipital",
};

export function gradedRegion(region: unknown, isKnown: (r: unknown) => r is AnnotationRegion): AnnotationRegion | null {
  if (isKnown(region)) return region;
  return typeof region === "string" ? RENDERER_REGION_MAP[region] ?? null : null;
}

// ── descriptions ───────────────────────────────────────────────────────────

const words = (v: unknown): string => str(v).replaceAll("_", " ");
const title = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
const hz = (v: unknown): string => (typeof v === "number" ? `${Number(v.toFixed(2))} Hz` : "");

const ONSET_PATTERN_LABELS: Record<string, string> = {
  lvfa: "low-voltage fast onset",
  rhythmic_theta: "rhythmic theta onset",
  electrodecrement: "electrodecremental onset",
  rhythmic_spikes: "rhythmic spike onset",
};

const ACNS_CLASS_LABELS: Record<string, string> = {
  electrographic_seizure: "ESz",
  IIC: "IIC",
  BIRDs_definite: "definite BIRDs",
  BIRDs_possible: "possible BIRDs",
  RPP_interictal: "interictal RPP",
};

const STAGE_LABELS: Record<string, string> = { W: "Wake", N1: "N1", N2: "N2", N3: "N3", R: "REM" };

function join(parts: (string | false | null | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" · ");
}

function plural(n: unknown, one: string, many = `${one}s`): string {
  return typeof n === "number" && n > 0 ? `${n} ${n === 1 ? one : many}` : "";
}

/**
 * One teaching line per key row — what an instructor would say pointing at it:
 * "LPDs+F · 1.8 Hz · IIC", "Generalized seizure · typical absence · provoked by
 * hyperventilation", "Sleep N2 · 34 spindles, 3 K-complexes".
 */
export function describeKeyRow(kind: string, detail: KeyDetail = {}): string {
  const region = words(detail.onset_region);
  switch (kind) {
    case "seizure": case "seizure_cluster": case "status_epilepticus": case "tonic_seizure": {
      const name = kind === "tonic_seizure" ? "Tonic seizure" : kind === "status_epilepticus" ? "Status epilepticus"
        : kind === "seizure_cluster" ? "Seizure (cluster)" : "Seizure";
      return join([
        name, title(region),
        ONSET_PATTERN_LABELS[str(detail.onset_pattern)],
        detail.neonatal_seizure_type ? `neonatal ${words(detail.neonatal_seizure_type)}` : "",
        detail.clinical_correlate && !["none", "unknown"].includes(str(detail.clinical_correlate))
          ? words(detail.clinical_correlate) : "",
      ]);
    }
    case "spasm": case "spasm_cluster":
      return join([
        "Epileptic spasm",
        detail.spasm_side && detail.spasm_side !== "both" ? `${words(detail.spasm_side)}-sided` : "",
        typeof detail.tonic_s === "number" ? `tonic ${detail.tonic_s} s` : "",
      ]);
    case "generalized_seizure":
      return join([
        "Generalized seizure", words(detail.seizure_type),
        detail.provocation && detail.provocation !== "none" ? `provoked by ${words(detail.provocation)}` : "",
      ]);
    case "rhythmic_pattern": {
      const main = str(detail.acns_label) || str(detail.main_term) || str(detail.pattern) || "Rhythmic pattern";
      return join([
        main,
        detail.acns_label || detail.main_term ? "" : title(region),
        hz(detail.mean_hz ?? detail.frequency_hz),
        detail.evolution === "evolving" ? "evolving" : detail.evolution === "fluctuating" ? "fluctuating" : "",
        detail.triphasic === true ? "triphasic" : "",
        ACNS_CLASS_LABELS[str(detail.acns_classification)],
      ]);
    }
    case "brd":
      return join(["Brief rhythmic discharge (BRD)", title(region)]);
    case "sporadic_discharge":
      return join([
        `Sporadic ${words(detail.morphology) || "discharge"}`,
        str(detail.focus),
        STAGE_LABELS[str(detail.stage)] ? `in ${STAGE_LABELS[str(detail.stage)]}` : "",
      ]);
    case "generalized_discharge":
      return join([
        `Generalized ${words(detail.pattern) || "discharge"}`, hz(detail.frequency_hz),
        STAGE_LABELS[str(detail.stage)] ? `in ${STAGE_LABELS[str(detail.stage)]}` : "",
      ]);
    case "normal_variant": case "activation_response": case "arousal_pattern_pending_review":
      return join([
        kind === "activation_response" ? "Activation response" : kind === "normal_variant" ? "Normal variant" : "Arousal pattern (pending review)",
        words(detail.variant),
      ]);
    case "delta_brush":
      return join(["Delta brush", words(detail.side), str(detail.state) ? `in ${words(detail.state)}` : ""]);
    case "artifact":
      return join(["Artifact", words(detail.artifact_kind), words(detail.intensity)]);
    case "sleep_stage": {
      const label = str(detail.label);
      const stage = STAGE_LABELS[label] ? (label === "W" ? "Wake" : `Sleep ${STAGE_LABELS[label]}`) : title(words(label));
      const counts = [
        plural(detail.spindles, "spindle"), plural(detail.vertex_waves, "vertex wave"),
        plural(detail.k_complexes, "K-complex", "K-complexes"), plural(detail.slow_waves, "slow wave"),
        plural(detail.sawtooth_trains, "sawtooth train"), plural(detail.rapid_eye_movements, "REM"),
      ].filter(Boolean).join(", ");
      return join([stage, counts, detail.sleep_architecture === "absent" ? "architecture absent" : ""]);
    }
    case "arousal": return "Arousal";
    case "state": case "state_detail": return join(["State", words(detail.label)]);
    case "state_change": return join(["State change", detail.to ? `to ${words(detail.to)}` : ""]);
    case "stimulation":
      return join(["Stimulation", words(detail.stimulus), words(detail.acns_reactivity || detail.response)]);
    case "attenuation_transient":
      return join(["Attenuation", words(detail.side), typeof detail.depth_pct === "number" ? `${Math.round(detail.depth_pct)} %` : ""]);
    case "cape_cycle": return "CAPE cycle";
    case "sedation": case "sedation_change":
      return join([kind === "sedation" ? "Sedation" : "Sedation change", words(detail.direction), words(detail.agent)]);
    case "annotation": return join(["Annotation", str(detail.label)]);
    default:
      return join([title(words(kind)), title(region)]);
  }
}
