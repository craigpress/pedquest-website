import assert from "node:assert/strict";
import { test } from "node:test";
import { hemisphereChannels } from "./montage";
import { createTrendEngine, TREND_ENGINE_VERSION } from "./trends";
import { decodeTrends, encodeTrends } from "./trend-sidecar";

// Technical channel labels only; all signal samples below are synthetic.
const clinicalLabels = [
  "C3-Ref", "C4-Ref", "O1-Ref", "O2-Ref", "A1-Ref", "A2-Ref", "Cz-Ref",
  "F3-Ref", "F4-Ref", "F7-Ref", "F8-Ref", "Fz-Ref", "Fp1-Ref", "Fp2-Ref",
  "Nasion-Ref", "P3-Ref", "P4-Ref", "Pz-Ref", "T3-Ref", "T4-Ref", "T5-Ref",
  "T6-Ref", "LOC-Ref", "ROC-Ref", "EMG1-Ref", "EMG2-Ref", "EKGL", "EKGR-Ref",
  "T1-Ref", "T2-Ref", "RAT1-Ref", "RAT2-Ref", "RESP-Ref", "ABD-Ref", "FLOW-Ref",
  "SNORE-Ref", "DIF5-Ref", "DIF6-Ref", "POS-Ref", "DC2-Ref", "DC3-Ref", "DC4-Ref",
  "DC5-Ref", "DC6-Ref", "DC7-Ref", "DC8-Ref", "DC9-Ref", "DC10-Ref", "OSAT-Ref",
  "PR-Ref", "Event",
];
const left = [0, 2, 7, 9, 12, 15, 18, 20, 28];
const right = [1, 3, 8, 10, 13, 16, 19, 21, 29];
const fs = 256;
const duration = 12;
const sine = (hz: number, amplitude: number) => Float32Array.from(
  { length: fs * duration }, (_, i) => amplitude * Math.sin(2 * Math.PI * hz * i / fs),
);

test("clinical Persyst map selects only lateral scalp electrodes for trends", () => {
  assert.deepEqual(hemisphereChannels(clinicalLabels), { left, right });
});

test("hemisphere selection preserves extended scalp names, aliases and EEG prefixes", () => {
  assert.deepEqual(hemisphereChannels([
    "EEG Fp1-Ref", "EEG fp2-Ref", "T7", "T8", "P7", "P8", "FT9", "FT10",
    "AF3", "AF4", "FC1", "FC2", "CP5", "CP6", "TP9", "TP10", "PO7", "PO8",
    "Fz", "Cz", "Pz", "A1", "M2", "Ch1", "EMG1", "DC2", "RAT1", "DIF6",
  ]), {
    left: [0, 2, 4, 6, 8, 10, 12, 14, 16],
    right: [1, 3, 5, 7, 9, 11, 13, 15, 17],
  });
});

test("FFT recovers known frequencies and calibrated integrated power", () => {
  const engine = createTrendEngine(duration, fs, ["C3", "C4"]);
  engine.process(0, [sine(10, 10), sine(6, 20)]);
  const tr = engine.trends;
  assert.equal(tr.filled, tr.nT);
  for (const [side, hz, power] of [["left", 10, 50], ["right", 6, 200]] as const) {
    for (let e = 0; e < tr.nT; e++) {
      const spectrum = tr.psd[side].subarray(e * tr.freqs.length, (e + 1) * tr.freqs.length);
      assert.equal(tr.freqs[spectrum.indexOf(Math.max(...spectrum))], hz);
      assert.ok(Math.abs(tr.totalPower[side][e] - power) < 0.001);
    }
  }
});

test("noisy auxiliary inputs cannot change scalp spectra or derived trends", () => {
  let seed = 42;
  const rows = clinicalLabels.map((_, ch) => {
    if (left.includes(ch)) return sine(10, 10 + ch);
    if (right.includes(ch)) return sine(6, 20 + ch);
    return Float32Array.from({ length: fs * duration }, () => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return (seed / 4294967296 - 0.5) * 2000;
    });
  });
  const indices = [...left, ...right].sort((a, b) => a - b);
  const clean = createTrendEngine(duration, fs, indices.map((i) => clinicalLabels[i]));
  const clinical = createTrendEngine(duration, fs, clinicalLabels);
  clean.process(0, indices.map((i) => rows[i]));
  clinical.process(0, rows);
  assert.deepEqual(clinical.trends, clean.trends);
});

test("old channel-selection sidecars are rejected; current trends round-trip", () => {
  assert.equal(TREND_ENGINE_VERSION, 3);
  const engine = createTrendEngine(duration, fs, ["C3", "C4"]);
  engine.process(0, [sine(10, 10), sine(6, 20)]);
  const buf = encodeTrends(engine.trends, { durationS: duration, sampleRate: fs, channels: 2 });
  assert.deepEqual(decodeTrends(buf, { durationS: duration }), engine.trends);
  const len = new DataView(buf).getUint32(4, true);
  const bytes = new Uint8Array(buf, 8, len);
  const header = new TextDecoder().decode(bytes).replace('"engineVersion":3', '"engineVersion":2');
  bytes.set(new TextEncoder().encode(header));
  assert.equal(decodeTrends(buf, { durationS: duration }), null);
});
