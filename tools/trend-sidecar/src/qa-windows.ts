import type { ViewerTrends } from "../../../src/lib/eeg/trends";

/** Keep background coverage and add the measured power extrema, at most five windows. */
export function qaWindows(trends: ViewerTrends, durationS: number) {
  const starts: { start: number; reason: string }[] = [];
  const add = (time: number, reason: string) => {
    const start = Math.max(0, Math.min(Math.max(0, durationS - 15), time));
    if (!starts.some((window) => Math.abs(window.start - start) < 7.5)) starts.push({ start, reason });
  };
  add(0, "start");
  let peak = -1, trough = -1;
  for (let i = 0; i < trends.filled; i++) {
    const power = trends.totalPower.left[i] + trends.totalPower.right[i];
    if (!Number.isFinite(power)) continue;
    if (peak < 0 || power > trends.totalPower.left[peak] + trends.totalPower.right[peak]) peak = i;
    if (trough < 0 || power < trends.totalPower.left[trough] + trends.totalPower.right[trough]) trough = i;
  }
  if (peak >= 0) add(trends.t[peak] - 7.5, "maximum bilateral total power");
  if (trough >= 0) add(trends.t[trough] - 7.5, "minimum bilateral total power");
  add(durationS * 0.5, "midpoint");
  add(durationS * 0.9, "near end");
  return starts.sort((a, b) => a.start - b.start);
}
