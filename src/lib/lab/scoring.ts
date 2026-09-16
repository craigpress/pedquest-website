// Scoring learner marks against a recording's answer key.
//
// Pure functions, no I/O — the results route feeds them the answer manifest
// (`<id>.answers.json`, realized events) and every learner's annotations; the
// class-results page renders what comes back.
//
// A "task" says what the learner was asked to mark and how to grade it. The
// same recording can carry several: a seizure task grades spans/points against
// the ictal events, a discharge task grades channel-tagged points against the
// key's discharges, a trend task grades points on a named trend row. All of
// them share one matching core: one-to-one assignment of marks to key events
// by best temporal overlap, then per-match timing and localization.
//
// Grading is lenient in time only as far as the view the learner marked on
// allows: a mark on the raw EEG must start within the task tolerance (10 s for
// seizures) of a key event; a mark on the trend strip gets a tolerance scaled
// to the seconds per pixel of the strip it was placed on (see `toleranceFor`).
// Localization is part of the task: a mark with no channel or region is "not
// stated" and scores 0 on localization, the same as a wrong side (Craig,
// 2026-09-16). Only a key event that itself has no region is left ungraded.

import {
  type AnnotationPane, type AnnotationRegion, type ViewerAnnotationKind,
  isAnnotationRegion, normaliseChannelLabel,
} from "@/lib/eeg/annotations";

// ── answer key ─────────────────────────────────────────────────────────────

export interface KeyEvent {
  kind: string;
  onsetS: number;
  offsetS: number;
  region: AnnotationRegion | null;
  channels: string[];
  label: string;
}

/** The realized-event manifest written by `eeg-render export`; unknown fields are ignored. */
export function parseAnswerKey(manifest: unknown): KeyEvent[] {
  const m = (typeof manifest === "object" && manifest !== null ? manifest : {}) as { events?: unknown[] };
  return (Array.isArray(m.events) ? m.events : [])
    .map((e) => e as Record<string, unknown>)
    .filter((e) => typeof e.onset_s === "number")
    .map((e) => {
      const onsetS = e.onset_s as number;
      const offsetS = typeof e.offset_s === "number" ? Math.max(onsetS, e.offset_s) : onsetS;
      const region = isAnnotationRegion(e.onset_region) ? e.onset_region : null;
      const channels = Array.isArray(e.channels)
        ? e.channels.map(normaliseChannelLabel).filter((c): c is string => c !== null)
        : [];
      const kind = typeof e.kind === "string" ? e.kind : "event";
      return { kind, onsetS, offsetS, region, channels, label: [kind, e.onset_region ?? e.artifact_kind ?? ""].filter(Boolean).join(" ") };
    })
    .sort((a, b) => a.onsetS - b.onsetS);
}

// ── learner marks ──────────────────────────────────────────────────────────

export interface LearnerMark {
  id: string;
  onsetS: number;
  durationS: number;
  kind: ViewerAnnotationKind | string;
  pane: AnnotationPane;
  trendRow: string | null;
  channels: string[];
  region: AnnotationRegion | null;
  /** seconds visible across the trend strip when a trend mark was placed; null on raw marks and on rows before 2026-09-16 */
  viewSpanS: number | null;
}

// ── tasks ──────────────────────────────────────────────────────────────────

export type MarkTaskType =
  /** mark the whole event; duration is graded */
  | "span"
  /** mark one instant (an onset); only latency is graded */
  | "point"
  /** an instant plus which channel(s) — "the sharp wave over C4" */
  | "channel_point"
  /** an instant on a named trend row — "the flame on the right spectrogram" */
  | "trend_point";

export interface MarkTask {
  id: string;
  title: string;
  type: MarkTaskType;
  /** learner kinds that count as an answer to this task */
  learnerKinds: string[];
  /** key kinds this task is graded against */
  keyKinds: string[];
  /** a RAW-pane mark starting within this many seconds of a key event (before or after) still counts as detecting it; trend marks widen this by view resolution (`toleranceFor`) */
  toleranceS: number;
  /** trend_point: the row the learner was told to use; null = any trend row */
  trendRow?: string | null;
}

export const SEIZURE_TASK: MarkTask = {
  id: "seizure",
  title: "Mark every electrographic seizure (onset to offset)",
  type: "span",
  learnerKinds: ["seizure", "seizure_onset"],
  keyKinds: ["seizure", "seizure_cluster", "spasm", "spasm_cluster", "tonic_seizure"],
  toleranceS: 10,
};

export const DISCHARGE_TASK: MarkTask = {
  id: "discharge",
  title: "Mark each epileptiform discharge and the channel it is maximal in",
  type: "channel_point",
  learnerKinds: ["discharge"],
  keyKinds: ["discharge", "spike", "sharp_wave"],
  toleranceS: 2,
};

// ── time tolerance by view ─────────────────────────────────────────────────

/** How many strip pixels a careful click can be off by. */
export const TREND_CLICK_PX = 5;
/** Nominal plot width of the trend strip in CSS px (the strip is `container − gutter`; ~1200 on a laptop, more on an ultrawide, so this is a floor on precision). */
export const TREND_PLOT_PX = 1200;
/** A trend mark whose view span was not recorded (rows before 2026-09-16) is graded as if placed on this many seconds unless the recording length is known. */
export const TREND_FALLBACK_SPAN_S = 4 * 3600;

/**
 * Seconds a mark may be off and still detect a key event.
 *   raw pane   → the task tolerance (10 s for seizures, 2 s for discharges)
 *   trend pane → max(task tolerance, TREND_CLICK_PX × seconds-per-pixel of the view the mark was placed on)
 * With the default 1200 px strip: 10 min view 2.5 s (→ floor 10 s), 1 h 15 s, 2 h 30 s, 4 h 60 s, 8 h 120 s, a 24 h whole record 360 s.
 */
export function toleranceFor(task: MarkTask, mark: Pick<LearnerMark, "pane" | "viewSpanS">, durationS?: number | null): number {
  if (mark.pane !== "trend") return task.toleranceS;
  const span = mark.viewSpanS && mark.viewSpanS > 0 ? mark.viewSpanS : (durationS && durationS > 0 ? durationS : TREND_FALLBACK_SPAN_S);
  return Math.max(task.toleranceS, (span * TREND_CLICK_PX) / TREND_PLOT_PX);
}

// ── localization ───────────────────────────────────────────────────────────

/** Electrodes per head region (10–20 plus common extras). An electrode may sit in more than one region — F7 is frontal and anterior temporal. */
const REGION_ELECTRODES: Record<AnnotationRegion, string[]> = {
  left_frontal: ["Fp1", "F3", "F7", "AF3", "FC1", "FC5"],
  right_frontal: ["Fp2", "F4", "F8", "AF4", "FC2", "FC6"],
  left_temporal: ["F7", "T3", "T5", "T7", "P7", "T1", "FT9", "TP9"],
  right_temporal: ["F8", "T4", "T6", "T8", "P8", "T2", "FT10", "TP10"],
  left_central: ["C3", "FC1", "CP1", "FC5", "CP5"],
  right_central: ["C4", "FC2", "CP2", "FC6", "CP6"],
  left_occipital: ["O1", "P3", "PO3", "PO7"],
  right_occipital: ["O2", "P4", "PO4", "PO8"],
  midline: ["Fz", "Cz", "Pz", "Oz", "FCz", "CPz"],
  left_hemisphere: [], right_hemisphere: [], generalized: [],
};

const LEFT: AnnotationRegion[] = ["left_frontal", "left_temporal", "left_central", "left_occipital", "left_hemisphere"];
const RIGHT: AnnotationRegion[] = ["right_frontal", "right_temporal", "right_central", "right_occipital", "right_hemisphere"];

function sideOf(r: AnnotationRegion | null): "left" | "right" | "midline" | "generalized" | null {
  if (!r) return null;
  if (LEFT.includes(r)) return "left";
  if (RIGHT.includes(r)) return "right";
  return r === "midline" ? "midline" : "generalized";
}

/** Electrodes named by a channel list; derivations ("C4-P4") contribute both ends. */
export function electrodesOf(channels: string[]): string[] {
  const out = new Set<string>();
  for (const c of channels) for (const e of c.split(/[-–]/)) {
    const n = e.trim();
    if (n) out.add(n.length <= 3 ? n[0].toUpperCase() + n.slice(1).toLowerCase().replace(/^fp/, "p") : n);
  }
  // the lowercase pass above turns "FP1" into "Fp1" but also "fp1" → "Fp1"; A1/A2/EKG pass through
  return [...out].map((e) => e.replace(/^Fp/i, "Fp"));
}

const norm = (e: string) => e.toLowerCase();

/** Regions a set of electrodes points at. */
export function regionsOfChannels(channels: string[]): AnnotationRegion[] {
  const els = electrodesOf(channels).map(norm);
  const hits: AnnotationRegion[] = [];
  for (const [region, list] of Object.entries(REGION_ELECTRODES) as [AnnotationRegion, string[]][]) {
    if (list.some((e) => els.includes(norm(e)))) hits.push(region);
  }
  return hits;
}

/** A trend row named `*_left` / `*_right` localizes to that hemisphere; other rows say nothing about side. */
export function regionOfTrendRow(row: string | null): AnnotationRegion | null {
  if (!row) return null;
  if (/_left$/.test(row)) return "left_hemisphere";
  if (/_right$/.test(row)) return "right_hemisphere";
  return null;
}

export type Localization = "match" | "partial" | "miss" | "not_stated" | "ungraded";

/**
 * What the learner said about WHERE, against the key's onset region.
 *   match       same region (or the learner's channels sit in it; or both generalized)
 *   partial     same hemisphere but a different lobe, or hemisphere-level vs a lobe, or a
 *               lateralized answer to a generalized key
 *   miss        wrong hemisphere, or lateralized vs midline
 *   not_stated  the learner gave no region, channel or sided trend row — scored like a miss
 *   ungraded    the key event itself has no region, so nothing can be graded
 */
export function gradeLocalization(mark: LearnerMark, key: KeyEvent): Localization {
  if (!key.region) return "ungraded";
  const stated: AnnotationRegion[] = [];
  if (mark.region) stated.push(mark.region);
  else {
    stated.push(...regionsOfChannels(mark.channels));
    const fromTrend = regionOfTrendRow(mark.trendRow);
    if (!stated.length && fromTrend) stated.push(fromTrend);
  }
  if (!stated.length) return "not_stated";
  if (stated.includes(key.region)) return "match";
  const keySide = sideOf(key.region);
  if (keySide === "generalized") return stated.includes("generalized") ? "match" : "partial";
  if (stated.includes("generalized")) return "partial";
  const sides = new Set(stated.map(sideOf));
  if (sides.has(keySide)) return "partial";
  return "miss";
}

// ── matching ───────────────────────────────────────────────────────────────

export interface MatchDetail {
  markId: string;
  keyIndex: number;
  /** mark onset minus key onset; negative = early */
  onsetLatencyS: number;
  /** mark duration minus key duration; null for a point mark on a span task */
  durationErrorS: number | null;
  /** intersection over union of the two spans; a point mark inside the key span scores its position, not 0 */
  overlap: number;
  localization: Localization;
  pane: AnnotationPane;
  /** the time tolerance this mark was graded with (`toleranceFor`) */
  toleranceS: number;
}

function overlapIoU(a0: number, a1: number, b0: number, b1: number): number {
  const inter = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const union = Math.max(a1, b1) - Math.min(a0, b0);
  return union > 0 ? inter / union : (a0 === b0 ? 1 : 0);
}

/** How well a mark fits a key event on [0,1]; 0 = does not count as detecting it. */
function fit(mark: LearnerMark, key: KeyEvent, task: MarkTask, tolS: number): number {
  const m0 = mark.onsetS, m1 = mark.onsetS + mark.durationS;
  const k0 = key.onsetS - tolS, k1 = key.offsetS + tolS;
  if (m1 < k0 || m0 > k1) return 0;
  if (mark.durationS > 0 && key.offsetS > key.onsetS) return Math.max(0.05, overlapIoU(m0, m1, key.onsetS, key.offsetS));
  // point mark (or point key): score by distance to the key onset, 1 at the onset → 0.05 at the tolerance edge
  const d = Math.abs(m0 - key.onsetS);
  const span = Math.max(tolS, key.offsetS - key.onsetS + tolS);
  return Math.max(0.05, 1 - d / span);
}

export interface LearnerScore {
  taskId: string;
  keyCount: number;
  markCount: number;
  detected: number;
  sensitivity: number | null;
  falseAlarms: number;
  precision: number | null;
  f1: number | null;
  medianOnsetLatencyS: number | null;
  medianAbsLatencyS: number | null;
  medianDurationErrorS: number | null;
  meanOverlap: number | null;
  localization: Record<Localization, number>;
  byPane: Record<AnnotationPane, number>;
  /** 0..100: 50 % detection quality (F1), 30 % timing, 20 % localization; null when there is nothing to grade */
  composite: number | null;
  matches: MatchDetail[];
  unmatchedMarkIds: string[];
  missedKeyIndexes: number[];
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Grade one learner's marks against the key for one task. */
export function scoreLearner(
  task: MarkTask, keyAll: KeyEvent[], marksAll: LearnerMark[],
  opts: { /** recording length; the fallback view span for legacy trend marks */ durationS?: number | null } = {},
): LearnerScore {
  const key = keyAll.filter((k) => task.keyKinds.includes(k.kind));
  let marks = marksAll.filter((m) => task.learnerKinds.includes(m.kind));
  if (task.type === "trend_point") marks = marks.filter((m) => m.pane === "trend" && (!task.trendRow || m.trendRow === task.trendRow));
  const tolOf = (m: LearnerMark) => toleranceFor(task, m, opts.durationS);

  // greedy one-to-one: best fits first
  const candidates: { mi: number; ki: number; f: number }[] = [];
  marks.forEach((m, mi) => key.forEach((k, ki) => { const f = fit(m, k, task, tolOf(m)); if (f > 0) candidates.push({ mi, ki, f }); }));
  candidates.sort((a, b) => b.f - a.f);
  const usedM = new Set<number>(), usedK = new Set<number>();
  const matches: MatchDetail[] = [];
  for (const c of candidates) {
    if (usedM.has(c.mi) || usedK.has(c.ki)) continue;
    usedM.add(c.mi); usedK.add(c.ki);
    const m = marks[c.mi], k = key[c.ki];
    const keyDur = k.offsetS - k.onsetS;
    matches.push({
      markId: m.id,
      keyIndex: keyAll.indexOf(k),
      onsetLatencyS: m.onsetS - k.onsetS,
      durationErrorS: task.type === "span" && m.durationS > 0 ? m.durationS - keyDur : null,
      overlap: m.durationS > 0 && keyDur > 0 ? overlapIoU(m.onsetS, m.onsetS + m.durationS, k.onsetS, k.offsetS) : c.f,
      localization: gradeLocalization(m, k),
      pane: m.pane,
      toleranceS: tolOf(m),
    });
  }
  matches.sort((a, b) => a.keyIndex - b.keyIndex);

  const detected = matches.length;
  const falseAlarms = marks.length - detected;
  const sensitivity = key.length ? detected / key.length : null;
  const precision = marks.length ? detected / marks.length : null;
  const f1 = sensitivity !== null && precision !== null && sensitivity + precision > 0
    ? (2 * sensitivity * precision) / (sensitivity + precision)
    : (key.length === 0 && marks.length === 0 ? null : 0);

  const localization: Record<Localization, number> = { match: 0, partial: 0, miss: 0, not_stated: 0, ungraded: 0 };
  const byPane: Record<AnnotationPane, number> = { raw: 0, trend: 0 };
  for (const m of matches) localization[m.localization]++;
  for (const m of marks) byPane[m.pane]++;

  const latencies = matches.map((m) => m.onsetLatencyS);
  // each match is judged against the tolerance of the view it was marked on
  const timing = matches.length
    ? matches.reduce((s, m) => s + Math.max(0, 1 - Math.abs(m.onsetLatencyS) / m.toleranceS), 0) / matches.length
    : null;
  // "not stated" is graded, and scores 0, like a wrong side; only key events without a region are left out
  const locGraded = localization.match + localization.partial + localization.miss + localization.not_stated;
  const locScore = locGraded ? (localization.match + 0.5 * localization.partial) / locGraded : null;

  let composite: number | null = null;
  if (f1 !== null) {
    // localization counts whenever a detected key event had a region to name; the 20 % otherwise folds into detection
    const parts: [number, number][] = [[f1, locScore === null ? 0.7 : 0.5], [timing ?? 0, 0.3]];
    if (locScore !== null) parts.push([locScore, 0.2]);
    composite = Math.round(100 * parts.reduce((s, [v, w]) => s + v * w, 0));
  }

  return {
    taskId: task.id,
    keyCount: key.length,
    markCount: marks.length,
    detected,
    sensitivity,
    falseAlarms,
    precision,
    f1,
    medianOnsetLatencyS: median(latencies),
    medianAbsLatencyS: median(latencies.map(Math.abs)),
    medianDurationErrorS: median(matches.map((m) => m.durationErrorS).filter((d): d is number => d !== null)),
    meanOverlap: matches.length ? matches.reduce((s, m) => s + m.overlap, 0) / matches.length : null,
    localization,
    byPane,
    composite,
    matches,
    unmatchedMarkIds: marks.filter((_, i) => !usedM.has(i)).map((m) => m.id),
    missedKeyIndexes: key.filter((_, i) => !usedK.has(i)).map((k) => keyAll.indexOf(k)),
  };
}

// ── class roll-up ──────────────────────────────────────────────────────────

export interface KeyEventSummary {
  keyIndex: number;
  event: KeyEvent;
  detectedBy: number;
  medianLatencyS: number | null;
  localizationMatches: number;
}

export interface ClassSummary {
  taskId: string;
  learners: number;
  keyCount: number;
  meanSensitivity: number | null;
  meanFalseAlarms: number | null;
  medianComposite: number | null;
  perKeyEvent: KeyEventSummary[];
}

export function summariseClass(task: MarkTask, keyAll: KeyEvent[], scores: LearnerScore[]): ClassSummary {
  const key = keyAll.map((k, i) => ({ k, i })).filter(({ k }) => task.keyKinds.includes(k.kind));
  const sens = scores.map((s) => s.sensitivity).filter((x): x is number => x !== null);
  const comps = scores.map((s) => s.composite).filter((x): x is number => x !== null);
  return {
    taskId: task.id,
    learners: scores.length,
    keyCount: key.length,
    meanSensitivity: sens.length ? sens.reduce((a, b) => a + b, 0) / sens.length : null,
    meanFalseAlarms: scores.length ? scores.reduce((a, s) => a + s.falseAlarms, 0) / scores.length : null,
    medianComposite: median(comps),
    perKeyEvent: key.map(({ k, i }) => {
      const hits = scores.flatMap((s) => s.matches.filter((m) => m.keyIndex === i));
      return {
        keyIndex: i,
        event: k,
        detectedBy: hits.length,
        medianLatencyS: median(hits.map((h) => h.onsetLatencyS)),
        localizationMatches: hits.filter((h) => h.localization === "match").length,
      };
    }),
  };
}
