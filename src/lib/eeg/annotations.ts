// Viewer annotations: the learner's or instructor's own marks on a recording.
// Isomorphic — shared by the viewer, the API route and the local-file store.
//
// A mark has a TIME (onset + duration, duration 0 = instantaneous) and a
// TARGET: which pane it was made on, which trend row if any, which channels
// or derivations, and which head region the learner is naming. The target is
// what lets one recording carry different kinds of tasks — "mark the seizure"
// (span on the raw EEG or a trend), "mark the onset" (point), "find the sharp
// wave over C4" (point + channel), "point to the flame on the right FFT"
// (point on a trend row) — and what the scoring in `src/lib/lab/scoring.ts`
// compares against the answer key.

export type ViewerAnnotationKind =
  | "seizure" | "seizure_onset" | "discharge" | "artifact" | "state_change" | "medication" | "note";

export const ANNOTATION_KINDS: { id: ViewerAnnotationKind; label: string; color: string }[] = [
  { id: "seizure", label: "Seizure", color: "#e5484d" },
  { id: "seizure_onset", label: "Seizure onset", color: "#f76b15" },
  { id: "discharge", label: "Sharp / spike", color: "#c2298a" },
  { id: "artifact", label: "Artifact", color: "#8e8e93" },
  { id: "state_change", label: "State change", color: "#3e63dd" },
  { id: "medication", label: "Medication", color: "#30a46c" },
  { id: "note", label: "Note", color: "#ab6400" },
];

export function annotationColor(kind: string): string {
  return ANNOTATION_KINDS.find((k) => k.id === kind)?.color ?? "#ab6400";
}

/** Which pane the mark was placed on. */
export type AnnotationPane = "raw" | "trend";

/** Head regions a learner can name; mirrors `LabRegion` in `src/lib/lab/types.ts` (the answer key vocabulary). */
export const ANNOTATION_REGIONS = [
  "left_frontal", "right_frontal", "left_temporal", "right_temporal",
  "left_central", "right_central", "left_occipital", "right_occipital",
  "left_hemisphere", "right_hemisphere", "generalized", "midline",
] as const;
export type AnnotationRegion = (typeof ANNOTATION_REGIONS)[number];

export const REGION_LABELS: Record<AnnotationRegion, string> = {
  left_frontal: "Left frontal", right_frontal: "Right frontal",
  left_temporal: "Left temporal", right_temporal: "Right temporal",
  left_central: "Left central", right_central: "Right central",
  left_occipital: "Left occipital", right_occipital: "Right occipital",
  left_hemisphere: "Left hemisphere", right_hemisphere: "Right hemisphere",
  generalized: "Generalized", midline: "Midline",
};

export function isAnnotationRegion(v: unknown): v is AnnotationRegion {
  return typeof v === "string" && (ANNOTATION_REGIONS as readonly string[]).includes(v);
}

/** Where on the recording a mark points. */
export interface AnnotationTarget {
  pane: AnnotationPane;
  /** trend row id (e.g. "psd_right", "aeeg_left") when pane === "trend"; null on the raw EEG */
  trendRow: string | null;
  /** electrode or derivation labels the learner is pointing at, e.g. ["C4"] or ["C4-P4"]; empty = whole head / not stated */
  channels: string[];
  /** the head region the learner names; null = not stated */
  region: AnnotationRegion | null;
}

export const DEFAULT_TARGET: AnnotationTarget = { pane: "raw", trendRow: null, channels: [], region: null };

export interface ViewerAnnotation extends AnnotationTarget {
  id: string;
  onsetS: number;
  /** 0 = instantaneous mark */
  durationS: number;
  kind: ViewerAnnotationKind;
  label: string;
  note: string;
  /** who wrote it; null for local-file annotations */
  authorEmail: string | null;
  /** true when this row belongs to the signed-in viewer */
  mine: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ViewerAnnotationInput extends AnnotationTarget {
  onsetS: number;
  durationS: number;
  kind: ViewerAnnotationKind;
  label: string;
  note: string;
}

export function isAnnotationKind(v: unknown): v is ViewerAnnotationKind {
  return typeof v === "string" && ANNOTATION_KINDS.some((k) => k.id === v);
}

/** Normalise a channel/derivation label: trim, collapse spaces, cap length. Case is kept (Fp1 vs FP1 both occur in files). */
export function normaliseChannelLabel(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\s+/g, "");
  if (!s || s.length > 24) return null;
  return s;
}

/**
 * Validate the target part of a mark. Missing fields fall back to the raw-pane
 * default so older clients (and the local-file store) keep working.
 */
export function validateAnnotationTarget(o: Record<string, unknown>): { value?: AnnotationTarget; error?: string } {
  const pane: AnnotationPane = o.pane === "trend" ? "trend" : "raw";
  let trendRow: string | null = null;
  if (pane === "trend") {
    trendRow = typeof o.trendRow === "string" && /^[a-z_]{1,40}$/.test(o.trendRow) ? o.trendRow : null;
  }
  const rawChannels = Array.isArray(o.channels) ? o.channels : [];
  if (rawChannels.length > 32) return { error: "Too many channels on one mark." };
  const channels: string[] = [];
  for (const c of rawChannels) {
    const n = normaliseChannelLabel(c);
    if (n === null) return { error: "channels must be short electrode or derivation labels." };
    if (!channels.includes(n)) channels.push(n);
  }
  const region = o.region == null || o.region === "" ? null : o.region;
  if (region !== null && !isAnnotationRegion(region)) return { error: "region is not a known head region." };
  return { value: { pane, trendRow, channels, region } };
}

export function validateAnnotationInput(raw: unknown, durationS: number): { value?: ViewerAnnotationInput; error?: string } {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const onsetS = Number(o.onsetS);
  const dur = Number(o.durationS ?? 0);
  if (!Number.isFinite(onsetS) || onsetS < 0 || onsetS > durationS) return { error: "onsetS is outside the recording." };
  if (!Number.isFinite(dur) || dur < 0 || onsetS + dur > durationS + 1) return { error: "durationS is invalid." };
  if (!isAnnotationKind(o.kind)) return { error: "kind is not a known annotation kind." };
  const label = typeof o.label === "string" ? o.label.trim().slice(0, 120) : "";
  const note = typeof o.note === "string" ? o.note.trim().slice(0, 2000) : "";
  const target = validateAnnotationTarget(o);
  if (!target.value) return { error: target.error };
  return { value: { onsetS, durationS: dur, kind: o.kind, label, note, ...target.value } };
}

/** Short human label for a target, for list rows and tooltips: "C4 · raw", "FFT R", "right frontal". */
export function describeTarget(t: AnnotationTarget, trendLabel?: (row: string) => string): string {
  const parts: string[] = [];
  if (t.pane === "trend") parts.push(t.trendRow ? (trendLabel ? trendLabel(t.trendRow) : t.trendRow) : "trend");
  if (t.channels.length) parts.push(t.channels.join(", "));
  if (t.region) parts.push(REGION_LABELS[t.region].toLowerCase());
  return parts.join(" · ");
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}
