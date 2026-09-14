/**
 * The EEG Library: every finished lab recording, described in words a reader
 * can search — what kind of record it is, the patient band, the background,
 * the findings that were authored into it — plus the question-bank item it
 * belongs to when there is one.
 *
 * Nothing here reads the recording itself. The description is derived from
 * the job's stored spec (the authored ground truth) and from the eeg_cases row
 * the job was made for. That keeps the library a metadata query, cheap enough
 * to run on every keystroke, and it never opens the instructor answer key.
 *
 * Pure functions only: the API route feeds rows in, the page renders what
 * comes out.
 */
import { isLabReviewStatus, type LabArtifact, type LabFormat, type LabReviewStatus, type LabSource } from "./types";

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
export function labelize(value: string): string {
  return value.replace(/_/g, " ");
}

/** One authored finding, flattened for display and search. */
export interface LibraryFinding {
  type: string;
  /** minutes from the start of the recording, when the event has a time */
  atMin: number | null;
  /** short qualifier: region, pattern, artifact kind, state, agent … */
  detail: string | null;
}

export interface LibrarySummary {
  kind: string;
  ageGroup: string | null;
  pmaWeeks: number | null;
  channels: string | null;
  montage: string | null;
  background: string | null;
  backgroundDetail: string | null;
  /** aEEG pattern (CNV, DNV, BS, CLV, FT) */
  aeegPattern: string | null;
  sleepWakeCycling: string | null;
  findings: LibraryFinding[];
  /** clinician bedside notes authored into the record */
  annotations: string[];
}

export interface LibraryQuestion {
  caseId: string;
  qbankId: string;
  title: string | null;
  domain: string | null;
  population: string | null;
  setting: string | null;
  difficulty: string | null;
  status: string | null;
  tags: string[];
  learningObjective: string | null;
  imageCaption: string | null;
  teachingPoints: string[];
}

export interface LibraryEntry {
  jobId: string;
  recordingId: string | null;
  createdAt: string;
  durationS: number;
  formats: LabFormat[];
  artifacts: Partial<Record<LabArtifact, string>>;
  rendererVersion: string | null;
  specHash: string | null;
  /** "bank" when the job was queued for a question, "adhoc" otherwise */
  source: "bank" | "adhoc";
  requestedBy: string | null;
  summary: LibrarySummary;
  question: LibraryQuestion | null;
  // editorial (migration 20260914_eeg_lab_review)
  /** authored title; null until the author accepts or edits the suggestion */
  title: string | null;
  description: string | null;
  reviewStatus: LabReviewStatus;
  /** "team" = an editor queued it; "ai" = the bank export script did */
  authorship: LabSource;
  authorId: string | null;
  /** editors only — the author's email, resolved by the route */
  authorEmail: string | null;
  /** published at migration time without a review */
  grandfathered: boolean;
  submittedAt: string | null;
  publishedAt: string | null;
  /** lower-cased haystack the search runs over */
  searchText: string;
}

// ── spec → summary ─────────────────────────────────────────────────────────

/** The event keys that carry a time, in the order the renderer prefers them. */
const TIME_KEYS = ["onset_min", "at_min", "start_min"] as const;
/** Keys worth surfacing as the finding's qualifier. */
const DETAIL_KEYS = [
  "onset_region", "pattern", "kind", "to", "agent", "direction", "side", "region",
] as const;

export function describeEvent(event: unknown): LibraryFinding | null {
  if (!isObj(event)) return null;
  const type = str(event.type);
  if (!type) return null;
  let atMin: number | null = null;
  for (const key of TIME_KEYS) {
    const v = num(event[key]);
    if (v !== null) { atMin = v; break; }
  }
  const parts: string[] = [];
  for (const key of DETAIL_KEYS) {
    const v = str(event[key]);
    if (v) parts.push(labelize(v));
  }
  // clusters carry their region inside the nested seizure block
  if (isObj(event.seizure)) {
    const r = str(event.seizure.onset_region);
    if (r && !parts.length) parts.push(labelize(r));
  }
  const spread = str(event.spread);
  if (spread && spread !== "none") parts.push(`spread ${labelize(spread)}`);
  const count = num(event.count);
  if (count !== null) parts.push(`×${count}`);
  const end = num(event.end_min);
  if (atMin !== null && end !== null && end > atMin) parts.push(`to ${Math.round(end)} min`);
  return { type, atMin, detail: parts.length ? parts.join(", ") : null };
}

function innerSpec(kind: string, spec: Json): Json {
  // a composite carries the recording under qeeg_panel; the page block is a view of it
  if (kind === "composite" && isObj(spec.qeeg_panel)) return spec.qeeg_panel;
  return spec;
}

export function summarizeSpec(block: unknown): LibrarySummary {
  const empty: LibrarySummary = {
    kind: "unknown", ageGroup: null, pmaWeeks: null, channels: null, montage: null,
    background: null, backgroundDetail: null, aeegPattern: null, sleepWakeCycling: null,
    findings: [], annotations: [],
  };
  if (!isObj(block)) return empty;
  const kind = str(block.kind) ?? "unknown";
  const raw = isObj(block.spec) ? block.spec : block;
  const spec = innerSpec(kind, raw);

  const channelsRaw = spec.channels;
  const channels = Array.isArray(channelsRaw)
    ? channelsRaw.filter((c): c is string => typeof c === "string").join(", ")
    : str(channelsRaw);

  const bg = isObj(spec.background) ? spec.background : null;
  const bgDetail: string[] = [];
  if (bg) {
    const hz = num(bg.dominant_hz);
    const uv = num(bg.amplitude_uv);
    if (hz !== null) bgDetail.push(`${hz} Hz`);
    if (uv !== null) bgDetail.push(`${uv} µV`);
    const react = str(bg.reactivity);
    if (react) bgDetail.push(`reactivity ${labelize(react)}`);
    if (isObj(bg.burst_suppression)) {
      const b = num(bg.burst_suppression.burst_s);
      const i = num(bg.burst_suppression.ibi_s);
      if (b !== null && i !== null) bgDetail.push(`bursts ${b} s / IBI ${i} s`);
    }
  }

  const events = Array.isArray(spec.events) ? spec.events : [];
  const findings = events.map(describeEvent).filter((f): f is LibraryFinding => f !== null);

  const annotations = Array.isArray(spec.annotations)
    ? spec.annotations.map((a) => (isObj(a) ? str(a.label) : null)).filter((s): s is string => !!s)
    : [];

  return {
    kind,
    ageGroup: str(spec.age_group),
    pmaWeeks: bg ? num(bg.pma_weeks) : null,
    channels,
    montage: str(spec.montage),
    background: bg ? str(bg.type) : null,
    backgroundDetail: bgDetail.length ? bgDetail.join(" · ") : null,
    aeegPattern: str(spec.pattern),
    sleepWakeCycling: str(spec.sleep_wake_cycling),
    findings,
    annotations,
  };
}

// ── rows → entries ─────────────────────────────────────────────────────────

/** The eeg_cases columns the library reads. */
export const LIBRARY_CASE_COLUMNS =
  "id,qbank_id,title,domain,population,setting,difficulty,status,tags," +
  "learning_objective,image_caption,teaching_points";

export function qbankIdOf(requestedBy: string | null): string | null {
  return requestedBy?.startsWith("qbank:") ? requestedBy.slice("qbank:".length) : null;
}

/** The bank link: the column since 20260914, the requested_by convention before it. */
export function qbankIdOfRow(row: Json): string | null {
  return str(row.qbank_id) ?? qbankIdOf(str(row.requested_by));
}

// ── suggested title / description ──────────────────────────────────────────
//
// Both are learner-visible once the recording is published, so neither may
// name what was authored into the record (background type, events, aEEG
// pattern): those are the answers. What they may say is what a learner needs
// to pick a recording — kind, age band, channels, montage, duration, and the
// question it was made for. The author edits before submitting; the reviewer
// sees the final text.

export function humanDuration(durationS: number): string {
  if (durationS >= 3600) {
    const h = durationS / 3600;
    return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
  }
  return `${Math.round(durationS / 60)} min`;
}

const KIND_TITLES: Record<string, string> = {
  aeeg: "aEEG recording",
  qeeg_panel: "qEEG trend recording",
  composite: "qEEG trend recording",
  raw_eeg: "raw EEG recording",
  raw_page: "raw EEG recording",
  page: "raw EEG recording",
};

function ageLabel(ageGroup: string | null, pmaWeeks: number | null): string | null {
  if (!ageGroup) return null;
  const base = labelize(ageGroup);
  return pmaWeeks !== null ? `${base} (${pmaWeeks} wk PMA)` : base;
}

export function suggestTitle(s: LibrarySummary, q: LibraryQuestion | null, durationS: number): string {
  if (q?.title) return q.qbankId ? `${q.qbankId} · ${q.title}` : q.title;
  const kind = KIND_TITLES[s.kind] ?? `${labelize(s.kind)} recording`;
  const age = s.ageGroup ? labelize(s.ageGroup) : null;
  const head = age ? `${age.charAt(0).toUpperCase()}${age.slice(1)} ${kind}` : `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
  return `${head}, ${humanDuration(durationS)}`;
}

export function suggestDescription(s: LibrarySummary, q: LibraryQuestion | null, durationS: number): string {
  const kind = KIND_TITLES[s.kind] ?? `${labelize(s.kind)} recording`;
  const bits: string[] = [];
  const age = ageLabel(s.ageGroup, s.pmaWeeks);
  bits.push(`Synthetic ${humanDuration(durationS)} ${age ? `${age} ` : ""}${kind}`);
  const tech: string[] = [];
  if (s.channels) {
    const n = s.channels.split(",").length;
    tech.push(n > 1 ? `${n} channels` : s.channels);
  }
  if (s.montage) tech.push(`${labelize(s.montage)} montage`);
  const first = tech.length ? `${bits[0]} (${tech.join(", ")}).` : `${bits[0]}.`;
  const out = [first];
  if (q) {
    const facets = [q.domain && labelize(q.domain), q.population && labelize(q.population), q.difficulty && labelize(q.difficulty)]
      .filter((x): x is string => !!x);
    out.push(`Recorded for question-bank item ${q.qbankId}${facets.length ? ` (${facets.join(", ")})` : ""}.`);
  }
  out.push("Open it in the browser viewer or download it for a review station. Not a patient recording.");
  return out.join(" ");
}

function strings(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((s): s is string => typeof s === "string");
  if (typeof v === "string") {
    // teaching_points is sometimes stored as one newline-separated text
    return v.split(/\n+/).map((s) => s.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
  }
  return [];
}

export function caseRowToQuestion(row: Json): LibraryQuestion | null {
  const caseId = str(row.id);
  const qbankId = str(row.qbank_id);
  if (!caseId || !qbankId) return null;
  return {
    caseId,
    qbankId,
    title: str(row.title),
    domain: str(row.domain),
    population: str(row.population),
    setting: str(row.setting),
    difficulty: str(row.difficulty),
    status: str(row.status),
    tags: strings(row.tags),
    learningObjective: str(row.learning_objective),
    imageCaption: str(row.image_caption),
    teachingPoints: strings(row.teaching_points),
  };
}

export function buildSearchText(entry: Omit<LibraryEntry, "searchText">): string {
  const s = entry.summary;
  const q = entry.question;
  const bits: (string | null | undefined)[] = [
    entry.recordingId, entry.jobId, entry.requestedBy, entry.rendererVersion, entry.source,
    entry.title, entry.description, entry.reviewStatus, labelize(entry.reviewStatus),
    entry.authorship === "ai" ? "ai generated" : null, entry.authorEmail,
    entry.grandfathered ? "legacy unreviewed" : null,
    s.kind, labelize(s.kind), s.ageGroup, s.channels, s.montage,
    s.background, s.background && labelize(s.background), s.backgroundDetail,
    s.aeegPattern, s.sleepWakeCycling,
    s.pmaWeeks !== null ? `${s.pmaWeeks} weeks pma` : null,
    ...s.findings.flatMap((f) => [f.type, labelize(f.type), f.detail]),
    ...s.annotations,
    q?.qbankId, q?.title, q?.domain, q?.population, q?.setting, q?.difficulty, q?.status,
    ...(q?.tags ?? []), q?.learningObjective, q?.imageCaption, ...(q?.teachingPoints ?? []),
  ];
  return bits.filter((b): b is string => !!b).join(" \n ").toLowerCase();
}

export function rowToEntry(
  row: Json,
  cases: Map<string, LibraryQuestion>,
  authors: Map<string, string> = new Map(),
): LibraryEntry {
  const requestedBy = str(row.requested_by);
  const qbankId = qbankIdOfRow(row);
  const question = qbankId ? cases.get(qbankId) ?? null : null;
  const authorId = str(row.author_id);
  const base: Omit<LibraryEntry, "searchText"> = {
    title: str(row.title),
    description: str(row.description),
    reviewStatus: isLabReviewStatus(row.review_status) ? row.review_status : "draft",
    authorship: row.source === "ai" ? "ai" : "team",
    authorId,
    authorEmail: authorId ? authors.get(authorId) ?? null : null,
    grandfathered: row.grandfathered === true,
    submittedAt: str(row.submitted_at),
    publishedAt: str(row.published_at),
    jobId: String(row.id),
    recordingId: str(row.recording_id),
    createdAt: str(row.created_at) ?? new Date(0).toISOString(),
    durationS: num(row.duration_s) ?? 0,
    formats: Array.isArray(row.formats) ? (row.formats as LabFormat[]) : [],
    artifacts: isObj(row.artifacts) ? (row.artifacts as Partial<Record<LabArtifact, string>>) : {},
    rendererVersion: str(row.renderer_version),
    specHash: str(row.spec_hash),
    source: qbankId ? "bank" : "adhoc",
    requestedBy,
    summary: summarizeSpec(row.spec),
    question,
  };
  return { ...base, searchText: buildSearchText(base) };
}

/**
 * The learner view of an entry. Everything that names what was authored into
 * the recording — events with their region and minute, the background type
 * and its numbers, the aEEG pattern, bedside notes, and the question's
 * objective / caption / teaching points — is the answer to the question the
 * recording was made for, so a non-editor never receives it. What stays is
 * enough to find and open the recording: kind, age band, montage, duration,
 * and the question's id, title, domain, difficulty and setting.
 */
export function redactForLearner(entry: LibraryEntry): LibraryEntry {
  const s = entry.summary;
  const q = entry.question;
  const base: Omit<LibraryEntry, "searchText"> = {
    ...entry,
    authorEmail: null,
    summary: {
      ...s,
      background: null,
      backgroundDetail: null,
      aeegPattern: null,
      sleepWakeCycling: null,
      findings: [],
      annotations: [],
    },
    question: q ? { ...q, learningObjective: null, imageCaption: null, teachingPoints: [] } : null,
  };
  return { ...base, searchText: buildSearchText(base) };
}

/** The title a card shows: the authored one, else the same suggestion the author was offered. */
export function displayTitle(entry: LibraryEntry): string {
  return entry.title ?? suggestTitle(entry.summary, entry.question, entry.durationS);
}

// ── query ──────────────────────────────────────────────────────────────────

export interface LibraryQuery {
  q: string;
  kind: string | null;
  age: string | null;
  background: string | null;
  event: string | null;
  domain: string | null;
  source: "bank" | "adhoc" | null;
  /** editorial filter; "legacy" = published without a review (grandfathered) */
  review: LabReviewStatus | "legacy" | "mine" | null;
  /** the caller, for review = "mine" */
  viewerId?: string | null;
}

/** Every whitespace-separated term must appear somewhere in the entry. */
export function matches(entry: LibraryEntry, query: LibraryQuery): boolean {
  if (query.review === "legacy") {
    if (!entry.grandfathered) return false;
  } else if (query.review === "mine") {
    if (!query.viewerId || entry.authorId !== query.viewerId) return false;
  } else if (query.review && entry.reviewStatus !== query.review) {
    return false;
  }
  if (query.kind && entry.summary.kind !== query.kind) return false;
  if (query.age && entry.summary.ageGroup !== query.age) return false;
  if (query.background && entry.summary.background !== query.background) return false;
  if (query.event && !entry.summary.findings.some((f) => f.type === query.event)) return false;
  if (query.domain && entry.question?.domain !== query.domain) return false;
  if (query.source && entry.source !== query.source) return false;
  const terms = query.q.toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((t) => entry.searchText.includes(t));
}

export interface LibraryFacets {
  kind: Record<string, number>;
  age: Record<string, number>;
  background: Record<string, number>;
  event: Record<string, number>;
  domain: Record<string, number>;
  source: Record<string, number>;
  /** review_status counts plus "legacy" (grandfathered) and "mine" (the caller's) */
  review: Record<string, number>;
}

/** Counts over the FULL library, so a filter never hides its own alternatives. */
export function facets(entries: LibraryEntry[], viewerId: string | null = null): LibraryFacets {
  const out: LibraryFacets = { kind: {}, age: {}, background: {}, event: {}, domain: {}, source: {}, review: {} };
  const bump = (bucket: Record<string, number>, key: string | null) => {
    if (key) bucket[key] = (bucket[key] ?? 0) + 1;
  };
  for (const e of entries) {
    bump(out.review, e.reviewStatus);
    if (e.grandfathered) bump(out.review, "legacy");
    if (viewerId && e.authorId === viewerId) bump(out.review, "mine");
    bump(out.kind, e.summary.kind);
    bump(out.age, e.summary.ageGroup);
    bump(out.background, e.summary.background);
    for (const t of new Set(e.summary.findings.map((f) => f.type))) bump(out.event, t);
    bump(out.domain, e.question?.domain ?? null);
    bump(out.source, e.source);
  }
  return out;
}
