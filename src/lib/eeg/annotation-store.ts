"use client";

// Where a viewer's annotations live. Two backends behind one interface:
//   - LocalAnnotationStore: browser localStorage keyed by a file fingerprint,
//     for recordings opened from disk (nothing server-side to attach them to).
//   - RemoteAnnotationStore: /api/admin/lab/jobs/<id>/annotations, one row per
//     mark per user, so an instructor can read a learner's marks.
//
// Both carry the mark's target (pane / trend row / channels / region) with its
// time; the remote store round-trips it as JSON, the local one in localStorage.

import { DEFAULT_TARGET, type ViewerAnnotation, type ViewerAnnotationInput } from "./annotations";

export interface AnnotationStore {
  readonly label: string;
  list(): Promise<ViewerAnnotation[]>;
  create(input: ViewerAnnotationInput): Promise<ViewerAnnotation>;
  update(id: string, input: ViewerAnnotationInput): Promise<ViewerAnnotation>;
  remove(id: string): Promise<void>;
}

function nowIso() { return new Date().toISOString(); }

export class LocalAnnotationStore implements AnnotationStore {
  readonly label = "this browser";
  private readonly key: string;
  constructor(fingerprint: string) { this.key = `pq-lab-annotations:${fingerprint}`; }

  private load(): ViewerAnnotation[] {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return [];
      // rows stored before marks had a target: fill it in on the way out
      return (JSON.parse(raw) as ViewerAnnotation[]).map((r) => ({ ...DEFAULT_TARGET, ...r }));
    } catch { return []; }
  }
  private save(rows: ViewerAnnotation[]) {
    try { localStorage.setItem(this.key, JSON.stringify(rows)); } catch { /* quota or private mode */ }
  }
  async list() { return this.load(); }
  async create(input: ViewerAnnotationInput) {
    const row: ViewerAnnotation = {
      id: crypto.randomUUID(), ...input, authorEmail: null, mine: true, createdAt: nowIso(), updatedAt: nowIso(),
    };
    this.save([...this.load(), row]);
    return row;
  }
  async update(id: string, input: ViewerAnnotationInput) {
    const rows = this.load();
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) throw new Error("Annotation not found.");
    rows[i] = { ...rows[i], ...input, updatedAt: nowIso() };
    this.save(rows);
    return rows[i];
  }
  async remove(id: string) { this.save(this.load().filter((r) => r.id !== id)); }
}

export class RemoteAnnotationStore implements AnnotationStore {
  readonly label = "the teaching lab";
  constructor(
    private readonly jobId: string,
    private readonly headers: () => Promise<Record<string, string>>,
    /** teachers and up may ask for everyone's marks */
    private readonly includeOthers: boolean,
  ) {}

  private url(suffix = "") { return `/api/admin/lab/jobs/${this.jobId}/annotations${suffix}`; }

  private async call<T>(url: string, init: RequestInit): Promise<T> {
    const res = await fetch(url, { ...init, headers: { ...(await this.headers()), ...(init.headers ?? {}) } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status}).`);
    return json as T;
  }
  async list() {
    const q = this.includeOthers ? "?all=1" : "";
    const json = await this.call<{ annotations: ViewerAnnotation[] }>(this.url(q), { method: "GET" });
    return json.annotations;
  }
  async create(input: ViewerAnnotationInput) {
    const json = await this.call<{ annotation: ViewerAnnotation }>(this.url(), { method: "POST", body: JSON.stringify(input) });
    return json.annotation;
  }
  async update(id: string, input: ViewerAnnotationInput) {
    const json = await this.call<{ annotation: ViewerAnnotation }>(this.url(`/${id}`), { method: "PATCH", body: JSON.stringify(input) });
    return json.annotation;
  }
  async remove(id: string) {
    await this.call(this.url(`/${id}`), { method: "DELETE" });
  }
}
