// Row mapping for public.eeg_lab_annotations. Server-only.

import { DEFAULT_TARGET, isAnnotationRegion, type ViewerAnnotation, type ViewerAnnotationKind } from "@/lib/eeg/annotations";

export const ANNOTATION_COLUMNS =
  "id,job_id,user_id,user_email,onset_s,duration_s,kind,label,note,pane,trend_row,channels,region,created_at,updated_at";

export function rowToAnnotation(input: unknown, callerUserId: string): ViewerAnnotation {
  const r = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  return {
    id: String(r.id),
    onsetS: Number(r.onset_s) || 0,
    durationS: Number(r.duration_s) || 0,
    kind: String(r.kind) as ViewerAnnotationKind,
    // rows written before the target columns existed read back as the raw pane
    pane: r.pane === "trend" ? "trend" : DEFAULT_TARGET.pane,
    trendRow: typeof r.trend_row === "string" && r.trend_row ? r.trend_row : DEFAULT_TARGET.trendRow,
    channels: Array.isArray(r.channels) ? r.channels.filter((c): c is string => typeof c === "string") : DEFAULT_TARGET.channels,
    region: isAnnotationRegion(r.region) ? r.region : DEFAULT_TARGET.region,
    label: typeof r.label === "string" ? r.label : "",
    note: typeof r.note === "string" ? r.note : "",
    authorEmail: typeof r.user_email === "string" ? r.user_email : null,
    mine: r.user_id === callerUserId,
    createdAt: typeof r.created_at === "string" ? r.created_at : new Date(0).toISOString(),
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : new Date(0).toISOString(),
  };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
