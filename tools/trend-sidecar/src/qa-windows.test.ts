import { test } from "node:test";
import assert from "node:assert/strict";
import { allocTrends } from "../../../src/lib/eeg/trends";
import { qaWindows } from "./qa-windows";

test("captures an off-grid power peak and trough within the bounded evidence budget", () => {
  const trends = allocTrends(300, 128, ["C3", "C4"]);
  trends.filled = trends.nT;
  trends.totalPower.left.fill(10);
  trends.totalPower.right.fill(10);
  trends.totalPower.left[90] = 1000;
  trends.totalPower.right[210] = -5;
  const windows = qaWindows(trends, 300);
  assert.ok(windows.some(w => w.start <= 90.5 && w.start + 15 >= 90.5));
  assert.ok(windows.some(w => w.start <= 210.5 && w.start + 15 >= 210.5));
  assert.ok(windows.length <= 5);
  assert.ok(windows.every(w => w.start >= 0 && w.start + 15 <= 300));
});

test("short or flat recordings do not multiply identical windows", () => {
  const trends = allocTrends(5, 128, ["C3", "C4"]);
  trends.filled = trends.nT;
  assert.deepEqual(qaWindows(trends, 5), [{start: 0, reason: "start"}]);
});
