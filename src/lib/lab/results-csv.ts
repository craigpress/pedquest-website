// Class results as CSV: one row per learner per graded task, for a gradebook
// or spreadsheet. Pure; the results page builds it from the JSON it already has.

import type { LearnerScore, MarkTask } from "./scoring";

export interface CsvLearner {
  email: string;
  displayName: string | null;
  isInstructor: boolean;
  isTest: boolean;
  scores: Record<string, LearnerScore>;
}

const HEADER = [
  "learner", "email", "test_account", "task", "composite", "key_events", "marks", "detected", "sensitivity",
  "precision", "false_alarms", "median_onset_latency_s", "median_abs_latency_s", "median_duration_error_s",
  "loc_match", "loc_partial", "loc_miss", "loc_not_stated",
];

const num = (x: number | null, dp = 3) => (x === null ? "" : String(Number(x.toFixed(dp))));

export function csvCell(v: string): string {
  // leading = + - @ would run as a formula in a spreadsheet
  const s = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Instructors are left out, as in the class summary. */
export function resultsCsv(tasks: MarkTask[], learners: CsvLearner[]): string {
  const rows = [HEADER];
  for (const l of learners) {
    if (l.isInstructor) continue;
    for (const t of tasks) {
      const s = l.scores[t.id];
      if (!s) continue;
      rows.push([
        l.displayName ?? "", l.email, l.isTest ? "yes" : "no", t.id, num(s.composite, 0), String(s.keyCount),
        String(s.markCount), String(s.detected), num(s.sensitivity), num(s.precision), String(s.falseAlarms),
        num(s.medianOnsetLatencyS, 1), num(s.medianAbsLatencyS, 1), num(s.medianDurationErrorS, 1),
        String(s.localization.match), String(s.localization.partial), String(s.localization.miss),
        String(s.localization.not_stated),
      ]);
    }
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
