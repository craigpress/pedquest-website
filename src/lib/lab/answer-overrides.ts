import { isAnnotationRegion, normaliseChannelLabel } from "@/lib/eeg/annotations";
import type { KeyEvent } from "@/lib/lab/scoring";
import { hasRole, type Role } from "@/lib/roles";

export type AnswerOverrideAction = "add" | "update" | "remove" | "reset";
export const ANSWER_KEY_READ_ROLE: Role = "teacher";
export const ANSWER_KEY_WRITE_ROLE: Role = "editor";

export function canMutateAnswerKey(role: Role, canSeeRecording: boolean): boolean {
  return canSeeRecording && hasRole(role, ANSWER_KEY_WRITE_ROLE);
}

export interface AnswerOverrideRow {
  id: string;
  job_id: string;
  event_id: string | null;
  action: AnswerOverrideAction;
  event: unknown;
  note: string;
  base_answers_path: string;
  base_generation: string;
  edited_by: string;
  edited_by_email: string;
  created_at: string;
}

export interface AnswerOverrideHistory {
  id: string;
  eventId: string | null;
  action: AnswerOverrideAction;
  event: KeyEvent | null;
  note: string;
  baseAnswersPath: string;
  baseGeneration: string;
  editedBy: string;
  editedByEmail: string;
  createdAt: string;
  activeArtifact: boolean;
}

export function answerKeyCacheIdentity(jobId: string, answersPath: string, generation: string): string {
  return `${jobId}|${answersPath}|${generation}`;
}

export function isCurrentAnswerGeneration(expected: unknown, current: string): boolean {
  return typeof expected === "string" && expected === current;
}

export function parseKeyEvent(raw: unknown, id: string): KeyEvent | null {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  if (typeof o.onsetS !== "number" || !Number.isFinite(o.onsetS)) return null;
  if (o.offsetS !== undefined && (typeof o.offsetS !== "number" || !Number.isFinite(o.offsetS))) return null;
  const onsetS = o.onsetS;
  const offsetS = o.offsetS ?? onsetS;
  if (onsetS < 0 || offsetS < onsetS) return null;
  const channels = Array.isArray(o.channels)
    ? o.channels.map(normaliseChannelLabel).filter((c): c is string => c !== null).slice(0, 32)
    : [];
  const kind = typeof o.kind === "string" && /^[a-z][a-z0-9_]{0,63}$/i.test(o.kind) ? o.kind : "event";
  const label = typeof o.label === "string" ? o.label.trim().slice(0, 160) : kind;
  return {
    id,
    kind,
    onsetS,
    offsetS,
    region: isAnnotationRegion(o.region) ? o.region : null,
    channels: [...new Set(channels)],
    label,
  };
}

export function applyAnswerOverrides(
  original: KeyEvent[], rows: AnswerOverrideRow[], answersPath: string, generation: string,
): KeyEvent[] {
  const events = new Map(original.map((event) => [event.id, { ...event, channels: [...event.channels] }]));
  for (const row of rows) {
    if (row.base_answers_path !== answersPath || row.base_generation !== generation) continue;
    if (row.action === "reset") {
      events.clear();
      for (const event of original) events.set(event.id, { ...event, channels: [...event.channels] });
      continue;
    }
    if (!row.event_id) continue;
    if (row.action === "remove") {
      events.delete(row.event_id);
      continue;
    }
    const event = parseKeyEvent(row.event, row.event_id);
    if (event) events.set(row.event_id, event);
  }
  return [...events.values()].sort((a, b) => a.onsetS - b.onsetS || a.id.localeCompare(b.id));
}

export function mapOverrideHistory(rows: AnswerOverrideRow[], answersPath: string, generation: string): AnswerOverrideHistory[] {
  return rows.map((row) => ({
    id: row.id,
    eventId: row.event_id,
    action: row.action,
    event: row.event_id ? parseKeyEvent(row.event, row.event_id) : null,
    note: row.note,
    baseAnswersPath: row.base_answers_path,
    baseGeneration: row.base_generation,
    editedBy: row.edited_by,
    editedByEmail: row.edited_by_email,
    createdAt: row.created_at,
    activeArtifact: row.base_answers_path === answersPath && row.base_generation === generation,
  }));
}
