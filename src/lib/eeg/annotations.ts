// Viewer annotations: the learner's or instructor's own marks on a recording.
// Isomorphic — shared by the viewer, the API route and the local-file store.

export type ViewerAnnotationKind =
  | "seizure" | "seizure_onset" | "artifact" | "state_change" | "medication" | "note";

export const ANNOTATION_KINDS: { id: ViewerAnnotationKind; label: string; color: string }[] = [
  { id: "seizure", label: "Seizure", color: "#e5484d" },
  { id: "seizure_onset", label: "Seizure onset", color: "#f76b15" },
  { id: "artifact", label: "Artifact", color: "#8e8e93" },
  { id: "state_change", label: "State change", color: "#3e63dd" },
  { id: "medication", label: "Medication", color: "#30a46c" },
  { id: "note", label: "Note", color: "#ab6400" },
];

export function annotationColor(kind: string): string {
  return ANNOTATION_KINDS.find((k) => k.id === kind)?.color ?? "#ab6400";
}

export interface ViewerAnnotation {
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

export interface ViewerAnnotationInput {
  onsetS: number;
  durationS: number;
  kind: ViewerAnnotationKind;
  label: string;
  note: string;
}

export function isAnnotationKind(v: unknown): v is ViewerAnnotationKind {
  return typeof v === "string" && ANNOTATION_KINDS.some((k) => k.id === v);
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
  return { value: { onsetS, durationS: dur, kind: o.kind, label, note } };
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}
