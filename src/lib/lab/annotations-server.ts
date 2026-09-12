// Row mapping for public.eeg_lab_annotations. Server-only.

import type { ViewerAnnotation, ViewerAnnotationKind } from "@/lib/eeg/annotations";

export const ANNOTATION_COLUMNS =
  "id,job_id,user_id,user_email,onset_s,duration_s,kind,label,note,created_at,updated_at";

export function rowToAnnotation(input: unknown, callerUserId: string): ViewerAnnotation {
  const r = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  return {
    id: String(r.id),
    onsetS: Number(r.onset_s) || 0,
    durationS: Number(r.duration_s) || 0,
    kind: String(r.kind) as ViewerAnnotationKind,
    label: typeof r.label === "string" ? r.label : "",
    note: typeof r.note === "string" ? r.note : "",
    authorEmail: typeof r.user_email === "string" ? r.user_email : null,
    mine: r.user_id === callerUserId,
    createdAt: typeof r.created_at === "string" ? r.created_at : new Date(0).toISOString(),
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : new Date(0).toISOString(),
  };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
