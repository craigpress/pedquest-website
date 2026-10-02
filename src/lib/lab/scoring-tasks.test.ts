import assert from "node:assert/strict";
import { test } from "node:test";
import { ANNOTATION_KINDS } from "@/lib/eeg/annotations";
import { KEY_CATEGORIES, categoryOf } from "./key-kinds";
import {
  ARTIFACT_TASK, BACKGROUND_TASK, MARK_TASKS, NORMAL_VARIANT_TASK, RHYTHMIC_PERIODIC_TASK, SEIZURE_TASK, STATE_TASK,
  gradedKeys, isGradedKind, markTaskById, parseAnswerKey, scoreLearner, summariseClass, type LearnerMark,
} from "./scoring";

const row = (kind: string, onset: number, offset: number, extra: Record<string, unknown> = {}) => ({
  kind, onset_s: onset, offset_s: offset, ...extra,
});

const KEY = parseAnswerKey({
  events: [
    // state timeline: the clinical state row and the stage row start together at 600 s and collapse into one transition
    row("state", 0, 600, { label: "awake" }),
    row("state", 600, 3600, { label: "asleep" }),
    row("sleep_stage", 0, 600, { label: "W" }),
    row("sleep_stage", 600, 1800, { label: "N2" }),
    row("sleep_stage", 1800, 3600, { label: "R" }),
    row("state_detail", 650, 900, { label: "quiet_sleep_high_voltage_slow" }),
    row("arousal", 2400, 2410),
    // rhythmic / periodic: one IIC, one interictal RPP, one BIRDs, one ESz (seizure task only)
    row("rhythmic_pattern", 900, 960, { onset_region: "left_hemisphere", acns_label: "LPDs+F", acns_classification: "IIC" }),
    row("rhythmic_pattern", 1300, 1400, { onset_region: "left_temporal", acns_label: "LRDA", acns_classification: "RPP_interictal" }),
    row("rhythmic_pattern", 1600, 1603, { onset_region: "right_temporal", acns_label: "BIRDs", acns_classification: "BIRDs_possible" }),
    row("rhythmic_pattern", 2000, 2030, { onset_region: "generalized", acns_label: "GPDs", acns_classification: "electrographic_seizure" }),
    // normal: a wicket run and photic driving are asked for; delta brushes and the pending arousal rhythm are not
    row("normal_variant", 1000, 1004, { variant: "wicket" }),
    row("activation_response", 3000, 3060, { variant: "photic_driving" }),
    row("delta_brush", 1010, 1011, { side: "left" }),
    row("arousal_pattern_pending_review", 2500, 2510, { variant: "frontal_arousal_rhythm" }),
    // background: a left-sided attenuation (localized by its side) and a CAPE cycle
    row("attenuation_transient", 1100, 1220, { side: "left", depth_pct: 60 }),
    row("cape_cycle", 3200, 3320, { depth: 0.4 }),
    // artifacts carry channels but no region
    row("artifact", 1700, 1720, { artifact_kind: "electrode_pop", channels: ["T4"] }),
    row("artifact", 2800, 2830, { artifact_kind: "emg_chewing" }),
  ],
});

const mark = (id: string, kind: string, onsetS: number, durationS: number, patch: Partial<LearnerMark> = {}): LearnerMark => ({
  id, onsetS, durationS, kind, pane: "raw", trendRow: null, channels: [], region: null, viewSpanS: null, ...patch,
});

const kindsOf = (task: typeof SEIZURE_TASK) => gradedKeys(task, KEY).map((k) => k.kind);

test("every gradable key category has a learner kind and a task; context, medication and note are ungraded", () => {
  const learnerKinds = new Set(ANNOTATION_KINDS.map((k) => k.id as string));
  for (const t of MARK_TASKS) for (const k of t.learnerKinds) assert.ok(learnerKinds.has(k), `${t.id}: ${k} is not a learner kind`);
  const covered = new Set(MARK_TASKS.flatMap((t) => t.keyCategories ?? []));
  covered.add("ictal").add("interictal"); // SEIZURE_TASK / DISCHARGE_TASK grade by kind
  for (const c of KEY_CATEGORIES) assert.equal(covered.has(c.id), c.id !== "context", c.id);
  assert.equal(isGradedKind("medication"), false);
  assert.equal(isGradedKind("note"), false);
  assert.equal(isGradedKind("rhythmic_periodic"), true);
  assert.equal(markTaskById("background_change"), BACKGROUND_TASK);
  assert.equal(markTaskById("nope"), null);
  for (const t of MARK_TASKS) assert.equal(scoreLearner(t, KEY, [mark("m", "medication", 905, 0), mark("n", "note", 1001, 0)]).markCount, 0);
});

test("a promoted learner mark lands in the category its task grades", () => {
  assert.equal(categoryOf("rhythmic_periodic"), "rpp");
  assert.equal(categoryOf("background_change"), "background");
  assert.equal(categoryOf("normal_variant"), "normal");
  assert.equal(categoryOf("state_change"), "state");
});

test("rhythmic/periodic task: IIC, interictal RPP and BIRDs, never the run classified as a seizure", () => {
  assert.deepEqual(kindsOf(RHYTHMIC_PERIODIC_TASK), ["rhythmic_pattern", "rhythmic_pattern", "rhythmic_pattern"]);
  assert.ok(!gradedKeys(RHYTHMIC_PERIODIC_TASK, KEY).some((k) => k.onsetS === 2000));
  const s = scoreLearner(RHYTHMIC_PERIODIC_TASK, KEY, [
    mark("lpd", "rhythmic_periodic", 902, 55, { region: "left_hemisphere" }),
    mark("lrda", "rhythmic_periodic", 1305, 90, { region: "right_temporal" }),
    mark("gpd", "rhythmic_periodic", 2001, 28, { region: "generalized" }),
  ]);
  assert.equal(s.keyCount, 3);
  assert.equal(s.detected, 2);
  assert.equal(s.falseAlarms, 1, "calling the ESz GPDs a non-ictal pattern is a false alarm here");
  assert.deepEqual(s.missedKeyIndexes.map((i) => KEY[i].onsetS), [1600]);
  assert.equal(s.matches.find((m) => m.markId === "lpd")?.localization, "match");
  assert.equal(s.matches.find((m) => m.markId === "lrda")?.localization, "miss");
  assert.ok(s.medianDurationErrorS !== null, "a span task grades duration");
});

test("normal-variant task: a point anywhere in the run detects it; delta brushes and the pending rhythm are not asked for", () => {
  assert.deepEqual(kindsOf(NORMAL_VARIANT_TASK), ["normal_variant", "activation_response"]);
  const s = scoreLearner(NORMAL_VARIANT_TASK, KEY, [
    mark("w", "normal_variant", 1002, 0),
    mark("brush", "normal_variant", 1010.5, 0),
    mark("far", "normal_variant", 1500, 0),
  ]);
  assert.equal(s.detected, 1);
  assert.equal(s.falseAlarms, 2);
  assert.equal(s.matches[0].localization, "ungraded");
  assert.equal(s.medianDurationErrorS, null, "a point task does not grade duration");
});

test("background task: an attenuation localizes by its side; not stated scores like a miss", () => {
  assert.deepEqual(kindsOf(BACKGROUND_TASK), ["attenuation_transient", "cape_cycle"]);
  assert.equal(KEY.find((k) => k.kind === "attenuation_transient")?.region, "left_hemisphere");
  const loc = (patch: Partial<LearnerMark>) =>
    scoreLearner(BACKGROUND_TASK, KEY, [mark("a", "background_change", 1110, 100, patch)]).matches[0]?.localization;
  assert.equal(loc({ region: "left_hemisphere" }), "match");
  assert.equal(loc({ region: "left_temporal" }), "partial");
  assert.equal(loc({ channels: ["C4"] }), "miss");
  assert.equal(loc({}), "not_stated");
  // 30 s tolerance: an attenuation marked 25 s early still counts; the CAPE cycle has no side to grade
  const s = scoreLearner(BACKGROUND_TASK, KEY, [mark("e", "background_change", 1075, 140, { region: "left_hemisphere" }), mark("c", "background_change", 3210, 100)]);
  assert.equal(s.detected, 2);
  assert.equal(s.matches.find((m) => m.markId === "c")?.localization, "ungraded");
});

test("artifact task: spans graded, a rhythmic pattern marked as artifact is a false alarm, localization ungraded", () => {
  assert.deepEqual(kindsOf(ARTIFACT_TASK), ["artifact", "artifact"]);
  const s = scoreLearner(ARTIFACT_TASK, KEY, [
    mark("pop", "artifact", 1702, 15, { channels: ["T4"] }),
    mark("lpd", "artifact", 905, 50),
  ]);
  assert.equal(s.keyCount, 2);
  assert.equal(s.detected, 1);
  assert.equal(s.falseAlarms, 1);
  assert.equal(s.localization.ungraded, 1);
  // F1 0.5 × 70 % (no region to name: the 20 % folds into detection) + timing (1 − 2/5) × 30 %
  assert.equal(s.composite, 53);
});

test("state task: transitions graded at their onset, record start and coincident rows collapsed, state_detail excluded", () => {
  const graded = gradedKeys(STATE_TASK, KEY);
  assert.deepEqual(graded.map((k) => k.onsetS), [600, 1800, 2400]);
  const s = scoreLearner(STATE_TASK, KEY, [
    mark("sleep", "state_change", 610, 0),
    mark("rem", "state_change", 1790, 0),
    mark("mid", "state_change", 1200, 0),
  ]);
  assert.equal(s.keyCount, 3);
  assert.equal(s.detected, 2);
  assert.equal(s.falseAlarms, 1, "a mark in the middle of a stage is not a transition");
  assert.deepEqual(s.matches.map((m) => m.onsetLatencyS), [10, -10]);
  // the trend strip widens the tolerance: a 4 h strip allows 60 s
  const t = scoreLearner(STATE_TASK, KEY, [mark("tr", "state_change", 1850, 0, { pane: "trend", viewSpanS: 4 * 3600 })]);
  assert.equal(t.detected, 1);
  const summary = summariseClass(STATE_TASK, KEY, [s, t]);
  assert.equal(summary.keyCount, 3);
  assert.deepEqual(summary.perKeyEvent.map((k) => k.detectedBy), [1, 2, 0]);
});

test("the seizure task is unchanged by the new categories", () => {
  assert.deepEqual(kindsOf(SEIZURE_TASK), ["rhythmic_pattern"]);
  const s = scoreLearner(SEIZURE_TASK, KEY, [mark("sz", "seizure", 2001, 28, { region: "generalized" }), mark("x", "rhythmic_periodic", 2001, 28)]);
  assert.equal(s.markCount, 1);
  assert.equal(s.detected, 1);
});
