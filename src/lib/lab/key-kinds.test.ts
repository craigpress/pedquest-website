import assert from "node:assert/strict";
import { test } from "node:test";
import { categoryOf, describeKeyRow, isIctalRow, overlayShows, pickDetail } from "./key-kinds";
import { DISCHARGE_TASK, SEIZURE_TASK, parseAnswerKey, scoreLearner, taskGradesKey, type LearnerMark } from "./scoring";
import { parseKeyEvent } from "./answer-overrides";

// Rows in the shape renderer 0.5.0 writes (eeg_render/export/manifest.py realized_events).
const row = (kind: string, onset: number, offset: number, extra: Record<string, unknown> = {}) => ({
  kind, onset_s: onset, offset_s: offset, onset_sample: onset * 200, offset_sample: offset * 200,
  clipped_at_start: false, clipped_at_end: false, label_type: "commanded", ...extra,
});

const V3_MANIFEST = {
  events: [
    row("sleep_stage", 0, 1800, { label: "N2", spindles: 34, k_complexes: 3, vertex_waves: 0, slow_waves: 0,
      sawtooth_trains: 0, rapid_eye_movements: 0, coma_pattern: null, sleep_architecture: "present" }),
    row("seizure", 600, 700, { onset_region: "left_mesial_temporal", onset_pattern: "rhythmic_theta",
      clinical_correlate: "none", spec_event_index: 0 }),
    row("rhythmic_pattern", 900, 960, { onset_region: "left_hemisphere", main_term: "LPDs", plus: "+F",
      acns_label: "LPDs+F", mean_hz: 1.8, periodic: true, evolution: "static",
      acns_classification: "IIC", classification_basis: "PDs averaging > 1 and <= 2.5 Hz over 10 s" }),
    row("rhythmic_pattern", 1200, 1230, { onset_region: "generalized", main_term: "GPDs", acns_label: "GPDs",
      mean_hz: 3.0, periodic: true, evolution: "static", acns_classification: "electrographic_seizure",
      classification_basis: "criterion A: discharges averaging > 2.5 Hz for >= 10 s" }),
    row("generalized_seizure", 1500, 1510, { seizure_type: "typical_absence", provocation: "hyperventilation",
      onset_region: "generalized", semiology: "behavioral arrest and staring" }),
    row("sporadic_discharge", 300, 300.2, { focus: "T3", morphology: "spike", aftergoing_slow: true, stage: "N2" }),
    row("rhythmic_pattern", 1600, 1603, { onset_region: "left_temporal", acns_label: "BIRDs", main_term: "BIRDs",
      acns_classification: "BIRDs_possible", mean_hz: 5 }),
  ],
};

const mark = (id: string, onsetS: number, durationS: number, patch: Partial<LearnerMark> = {}): LearnerMark => ({
  id, onsetS, durationS, kind: "seizure", pane: "raw", trendRow: null, channels: [], region: null, viewSpanS: null, ...patch,
});

test("an ACNS run classified as an electrographic seizure is ictal; IIC, BIRDs and RPP are not", () => {
  assert.equal(isIctalRow("rhythmic_pattern", { acns_classification: "electrographic_seizure" }), true);
  assert.equal(isIctalRow("rhythmic_pattern", { acns_classification: "IIC" }), false);
  assert.equal(isIctalRow("generalized_seizure"), true);
  assert.equal(isIctalRow("status_epilepticus"), true);
  assert.equal(categoryOf("rhythmic_pattern", { acns_classification: "IIC" }), "iic");
  assert.equal(categoryOf("rhythmic_pattern", { acns_classification: "BIRDs_possible" }), "iic");
  assert.equal(categoryOf("rhythmic_pattern", {}), "rpp");
  assert.equal(categoryOf("brd"), "iic");
  assert.equal(categoryOf("sleep_stage"), "state");
});

test("the seizure task grades v3 ictal rows and leaves the IIC run alone", () => {
  const key = parseAnswerKey(V3_MANIFEST);
  const graded = key.filter((k) => taskGradesKey(SEIZURE_TASK, k)).map((k) => k.kind);
  assert.deepEqual(graded, ["seizure", "rhythmic_pattern", "generalized_seizure"]);
  const s = scoreLearner(SEIZURE_TASK, key, [mark("a", 1201, 28), mark("b", 1500, 10), mark("c", 905, 50)]);
  assert.equal(s.keyCount, 3);
  assert.equal(s.detected, 2);
  assert.equal(s.falseAlarms, 1, "marking the IIC LPDs as a seizure is a false alarm");
});

test("sporadic discharges are graded by the discharge task, localized from their focus electrode", () => {
  const key = parseAnswerKey(V3_MANIFEST);
  const spike = key.find((k) => k.kind === "sporadic_discharge")!;
  assert.deepEqual(spike.channels, ["T3"]);
  assert.equal(spike.region, "left_temporal");
  assert.ok(taskGradesKey(DISCHARGE_TASK, spike));
  const s = scoreLearner(DISCHARGE_TASK, key, [mark("d", 300.5, 0, { kind: "discharge", channels: ["T3-T5"] })]);
  assert.equal(s.detected, 1);
  assert.equal(s.matches[0].localization, "match");
});

test("a mesial temporal onset is graded against the learner's temporal region", () => {
  const key = parseAnswerKey(V3_MANIFEST);
  const sz = key.find((k) => k.kind === "seizure")!;
  assert.equal(sz.region, "left_temporal");
  const s = scoreLearner(SEIZURE_TASK, key, [mark("e", 601, 90, { region: "left_temporal" })]);
  assert.equal(s.matches.find((m) => m.markId === "e")?.localization, "match");
});

test("key rows carry a teaching description", () => {
  const key = parseAnswerKey(V3_MANIFEST);
  const label = (kind: string, i = 0) => key.filter((k) => k.kind === kind)[i].label;
  assert.equal(label("rhythmic_pattern"), "LPDs+F · 1.8 Hz · IIC");
  assert.equal(label("rhythmic_pattern", 1), "GPDs · 3 Hz · ESz");
  assert.equal(label("generalized_seizure"), "Generalized seizure · typical absence · provoked by hyperventilation");
  assert.equal(label("sleep_stage"), "Sleep N2 · 34 spindles, 3 K-complexes");
  assert.equal(label("seizure"), "Seizure · Left mesial temporal · rhythmic theta onset");
  assert.equal(label("sporadic_discharge"), "Sporadic spike · T3 · in N2");
  // a pre-v3 row with no descriptors still reads sensibly
  assert.equal(describeKeyRow("rhythmic_pattern", { onset_region: "left_temporal" }), "Rhythmic pattern · Left temporal");
});

test("detail keeps scalar descriptors only", () => {
  const d = pickDetail({ kind: "x", onset_s: 1, onset_sample: 200, acns_label: "LPDs", mean_hz: 1.8, periodic: true,
    induced_runs: [{ onset_s: 3 }], effect: { ramp_min: 1 }, coma_pattern: null });
  assert.deepEqual(d, { acns_label: "LPDs", mean_hz: 1.8, periodic: true });
});

test("an edited rendered row keeps the descriptors that make it ictal", () => {
  const event = parseKeyEvent({ kind: "rhythmic_pattern", onsetS: 1200, offsetS: 1240, label: "GPDs",
    detail: { acns_classification: "electrographic_seizure", nested: { no: 1 } } }, "original:3");
  assert.ok(event);
  assert.deepEqual(event.detail, { acns_classification: "electrographic_seizure" });
  assert.ok(taskGradesKey(SEIZURE_TASK, event));
  const plain = parseKeyEvent({ kind: "seizure", onsetS: 1, offsetS: 2 }, "added:x");
  assert.equal(plain?.detail, undefined);
});

test("the overlay presets hide stage and context rows by default", () => {
  assert.equal(overlayShows("findings", "state"), false);
  assert.equal(overlayShows("findings", "iic"), true);
  assert.equal(overlayShows("ictal", "iic"), false);
  assert.equal(overlayShows("all", "context"), true);
});
