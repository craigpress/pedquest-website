import assert from "node:assert/strict";
import { test } from "node:test";
import { csvCell, resultsCsv } from "./results-csv";
import { SEIZURE_TASK, parseAnswerKey, scoreLearner } from "./scoring";

const KEY = parseAnswerKey({ events: [{ kind: "seizure", onset_s: 100, offset_s: 160, onset_region: "left_temporal" }] });
const score = scoreLearner(SEIZURE_TASK, KEY, [{
  id: "m1", onsetS: 104, durationS: 50, kind: "seizure", pane: "raw", trendRow: null, channels: [], region: "left_temporal", viewSpanS: null,
}]);

test("one row per learner and task, instructors left out", () => {
  const csv = resultsCsv([SEIZURE_TASK], [
    { email: "a@x.org", displayName: "Lee, A", isInstructor: false, isTest: false, scores: { seizure: score } },
    { email: "t@x.org", displayName: "Teacher", isInstructor: true, isTest: false, scores: { seizure: score } },
  ]);
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("learner,email,test_account,task,composite"));
  assert.ok(lines[1].startsWith('"Lee, A",a@x.org,no,seizure,'));
  assert.ok(lines[1].includes(",1,1,1,1,1,0,4,4,"), lines[1]);
});

test("cells that would run as spreadsheet formulas are neutralised", () => {
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
});
