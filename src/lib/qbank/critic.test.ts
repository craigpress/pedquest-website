import assert from "node:assert/strict";
import { test } from "node:test";
import { checkNumbersSourced } from "./critic";
import type { QbankQuestion } from "./question";

const articles = [{ pmid: "1", title: "t", abstract: "Seizures occurred in 48% of neonates." }] as never;

function item(explanation: string, spec: unknown = {}): QbankQuestion {
  return {
    stem: { vignette: "" },
    explanation,
    image: { spec },
  } as unknown as QbankQuestion;
}

test("a time into the recording is not a study statistic", () => {
  // The PQ-G-002 revision (2026-09-20) was rejected for "5.5" in "at 5.5 h".
  assert.deepEqual(checkNumbersSourced(item("The asymmetry normalises at 5.5 h."), articles), []);
  assert.deepEqual(checkNumbersSourced(item("A 9 Hz posterior rhythm at 40 µV."), articles), []);
});

test("numbers from the item's own image spec and the editor's feedback are sourced", () => {
  assert.deepEqual(
    checkNumbersSourced(item("The depth falls by 55 percent.", { events: [{ depth_pct: 55 }] }), articles),
    [],
  );
  assert.deepEqual(checkNumbersSourced(item("Look again at 6.2."), articles, ["please check 6.2"]), []);
});

test("an unsourced statistic is still rejected", () => {
  const findings = checkNumbersSourced(item("Seizures occurred in 62% of neonates."), articles);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, "numbers_sourced");
});
