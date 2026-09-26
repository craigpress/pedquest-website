import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANSWER_KEY_READ_ROLE, ANSWER_KEY_WRITE_ROLE, answerKeyCacheIdentity, applyAnswerOverrides,
  canMutateAnswerKey, isCurrentAnswerGeneration, parseKeyEvent, type AnswerOverrideRow,
} from "./answer-overrides";
import { parseAnswerKey, scoreLearner, SEIZURE_TASK, type LearnerMark } from "./scoring";
import { hasRole } from "../roles";

const path = "eeglab://LAB-DEMO/LAB-DEMO.answers.json";
const row = (patch: Partial<AnswerOverrideRow>): AnswerOverrideRow => ({
  id: crypto.randomUUID(), job_id: "job", event_id: null, action: "reset", event: null,
  note: "", base_answers_path: path, edited_by: "editor", edited_by_email: "editor@example.org",
  base_generation: "generation-one",
  created_at: new Date().toISOString(), ...patch,
});

test("original identity survives onset edits that reorder events", () => {
  const original = parseAnswerKey({ events: [
    { kind: "seizure", onset_s: 30, offset_s: 40, onset_region: "left_temporal" },
    { kind: "seizure", onset_s: 10, offset_s: 20, onset_region: "right_temporal" },
  ] });
  assert.deepEqual(original.map((e) => e.id), ["original:1", "original:0"]);
  const edited = { ...original[1], onsetS: 5, offsetS: 8 };
  const merged = applyAnswerOverrides(original, [row({ action: "update", event_id: edited.id, event: edited })], path, "generation-one");
  assert.deepEqual(merged.map((e) => [e.id, e.onsetS]), [["original:0", 5], ["original:1", 10]]);
});

test("add, update, remove and reset fold over immutable originals", () => {
  const original = parseAnswerKey({ events: [{ kind: "seizure", onset_s: 10, offset_s: 20 }] });
  const added = parseKeyEvent({ kind: "seizure", onsetS: 30, offsetS: 45, channels: ["C4-P4"] }, "added:one")!;
  const rows = [
    row({ action: "add", event_id: added.id, event: added }),
    row({ action: "update", event_id: "original:0", event: { ...original[0], onsetS: 12, offsetS: 22 } }),
    row({ action: "remove", event_id: added.id, event: null }),
  ];
  const merged = applyAnswerOverrides(original, rows, path, "generation-one");
  assert.deepEqual(merged.map((e) => [e.id, e.onsetS]), [["original:0", 12]]);
  assert.deepEqual(applyAnswerOverrides(original, [...rows, row({ action: "reset" })], path, "generation-one"), original);
  assert.deepEqual(original.map((e) => e.onsetS), [10]);
});

test("overrides are isolated by artifact identity", () => {
  const original = parseAnswerKey({ events: [{ kind: "seizure", onset_s: 10, offset_s: 20 }] });
  const rows = [row({ action: "remove", event_id: "original:0", base_answers_path: "eeglab://other/key.json" })];
  assert.deepEqual(applyAnswerOverrides(original, rows, path, "generation-one"), original);
  const priorGeneration = [row({ action: "remove", event_id: "original:0", base_generation: "generation-zero" })];
  assert.deepEqual(applyAnswerOverrides(original, priorGeneration, path, "generation-one"), original);
});

test("teacher reads do not imply editor mutation privileges", () => {
  assert.equal(ANSWER_KEY_READ_ROLE, "teacher");
  assert.equal(ANSWER_KEY_WRITE_ROLE, "editor");
  assert.equal(hasRole("member", ANSWER_KEY_WRITE_ROLE), false);
  assert.equal(canMutateAnswerKey("teacher", true), false);
  assert.equal(canMutateAnswerKey("editor", true), true);
  assert.equal(canMutateAnswerKey("editor", false), false);
});

test("malformed event times are rejected instead of becoming zero", () => {
  for (const onsetS of [null, false, "", "12", Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(parseKeyEvent({ kind: "seizure", onsetS, offsetS: 20 }, "added:x"), null);
  }
  assert.equal(parseKeyEvent({ kind: "seizure", onsetS: 12, offsetS: "20" }, "added:x"), null);
});

test("fresh override rows change the merge while the parsed original stays cached", () => {
  const cachedOriginal = parseAnswerKey({ events: [{ kind: "seizure", onset_s: 10, offset_s: 20 }] });
  assert.equal(applyAnswerOverrides(cachedOriginal, [], path, "generation-one")[0].onsetS, 10);
  const freshRows = [row({ action: "update", event_id: "original:0", event: { ...cachedOriginal[0], onsetS: 14, offsetS: 24 } })];
  assert.equal(applyAnswerOverrides(cachedOriginal, freshRows, path, "generation-one")[0].onsetS, 14);
  assert.equal(cachedOriginal[0].onsetS, 10);
});

test("same-path re-render rotates cache identity and rejects stale editor writes", () => {
  assert.notEqual(
    answerKeyCacheIdentity("job", path, "generation-one"),
    answerKeyCacheIdentity("job", path, "generation-two"),
  );
  assert.equal(isCurrentAnswerGeneration("generation-one", "generation-two"), false);
  assert.equal(isCurrentAnswerGeneration("generation-two", "generation-two"), true);
});

test("SEIZURE_TASK demo cohort scores are recomputed after an override", () => {
  const original = parseAnswerKey({ events: [
    { kind: "seizure", onset_s: 100, offset_s: 130, onset_region: "left_temporal" },
    { kind: "seizure", onset_s: 300, offset_s: 330, onset_region: "right_temporal" },
  ] });
  const mark = (id: string, onsetS: number, region: LearnerMark["region"]): LearnerMark => ({
    id, onsetS, durationS: 30, kind: "seizure", pane: "raw", trendRow: null,
    channels: [], region, viewSpanS: null,
  });
  const cohort = [
    [mark("learner-a-1", 100, "left_temporal"), mark("learner-a-2", 300, "right_temporal")],
    [mark("learner-b-1", 100, "left_temporal")],
  ];
  assert.deepEqual(cohort.map((marks) => scoreLearner(SEIZURE_TASK, original, marks).composite), [100, 83]);
  const moved = applyAnswerOverrides(original, [row({
    action: "update", event_id: "original:1", event: { ...original[1], onsetS: 360, offsetS: 390 },
  })], path, "generation-one");
  assert.deepEqual(cohort.map((marks) => scoreLearner(SEIZURE_TASK, moved, marks).composite), [75, 83]);
});
