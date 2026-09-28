import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findOptionLetterRefs, letterRefProblems, remapOptionLetters, suspectLetterTokens,
} from "./option-letters";
import { questionToRows, shuffleOptions, type QbankQuestion } from "./question";

const SWAP = { A: "C", B: "A", C: "B", D: "E", E: "D" };
const remap = (s: string) => remapOptionLetters(s, SWAP).text;

test("remaps the answer and option phrase forms", () => {
  assert.equal(remap("The correct answer is A. It fits."), "The correct answer is C. It fits.");
  assert.equal(remap("The correct answer is A: the tracing is burst suppression."), "The correct answer is C: the tracing is burst suppression.");
  assert.equal(remap("The best answer is (B)."), "The best answer is (A).");
  assert.equal(remap("Answer: D"), "Answer: E");
  assert.equal(remap("Unlike option B, this is focal."), "Unlike option A, this is focal.");
  assert.equal(remap("Option (C) confuses the axes."), "Option (B) confuses the axes.");
  assert.equal(remap("Options A and D both describe artifact."), "Options C and E both describe artifact.");
  assert.equal(remap("choices B, C, and E are distractors"), "choices A, B, and D are distractors");
  assert.equal(remap("Wrong. (A) is right. B: no."), "Wrong. (C) is right. A: no.");
});

test("swaps are simultaneous, not chained", () => {
  assert.equal(remap("Options A and C differ."), "Options C and B differ.");
});

test("never touches letters that are not option references", () => {
  const untouched = [
    "A term neonate is cooled to 33.5 C.",
    "Grade A evidence supports type A behaviour.",
    "Electrodes C3, C4 and Cz; the ACNS 2021 terminology; 50 Hz notch.",
    "A seizure evolves. B-mode ultrasound was normal.",
    "The answer is a matter of montage.",
    "Several options exist for monitoring.",
    "Hepatitis B serology was negative.",
  ];
  for (const s of untouched) {
    assert.equal(remap(s), s, s);
    assert.equal(findOptionLetterRefs(s).length, 0, s);
  }
});

test("reports phrase-level changes", () => {
  const { changes } = remapOptionLetters("The correct answer is A. Option E is wrong.", SWAP);
  assert.deepEqual(changes, [
    { from: "answer is A", to: "answer is C" },
    { from: "Option E", to: "Option D" },
  ]);
  assert.deepEqual(remapOptionLetters("The correct answer is A.", { A: "A" }).changes, []);
});

test("letterRefProblems flags missing options and a wrong key", () => {
  const options = [
    { key: "A", correct: false }, { key: "B", correct: true }, { key: "C", correct: false },
  ];
  assert.deepEqual(letterRefProblems({ explanation: "The correct answer is B. Option C is close." }, options), []);
  const problems = letterRefProblems({ explanation: "The correct answer is A. Option E is wrong." }, options);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /keyed answer is B/);
  assert.match(problems[1], /option E, which does not exist/);
});

test("suspectLetterTokens surfaces bare letters outside recognised phrases", () => {
  assert.deepEqual(suspectLetterTokens("A term neonate at 33.5 C. The correct answer is A."), []);
  const s = suspectLetterTokens("Both C and E are wrong, unlike A.");
  assert.deepEqual(s.map((x) => x.letter), ["C", "E", "A"]);
});

function item(): QbankQuestion {
  return {
    id: "PQ-A-001",
    options: ["A", "B", "C", "D", "E"].map((key) => ({
      key, text: `text ${key}`, correct: key === "A", rationale: key === "B" ? "Option A is right, not B." : "",
    })),
    stem: { vignette: "A term neonate.", image_caption: "", lead_in: "Which is best?" },
    question_type: "multiple_choice",
    explanation: "The correct answer is A. Option B inverts the axis.",
    key_points: ["Unlike option C, the key reads the lower margin."],
    learning_objective: "Read an aEEG.",
    references: [],
    image: { kind: "aeeg", license: "synthetic-original", spec: { seed: 1 } },
    metadata: { source_method: "expert-authored" },
  } as unknown as QbankQuestion;
}

test("questionToRows letters match the displayed option order; content keeps authoring text", () => {
  const q = item();
  const rows = questionToRows(q);
  const displayed = shuffleOptions(q.id, q.options);
  const letterOf = (key: string) => String.fromCharCode(65 + displayed.findIndex((o) => o.key === key));
  const correctRow = rows.options.findIndex((o) => o.is_correct);
  assert.equal(String.fromCharCode(65 + correctRow), letterOf("A"));
  assert.equal(rows.case.explanation, `The correct answer is ${letterOf("A")}. Option ${letterOf("B")} inverts the axis.`);
  assert.deepEqual(rows.case.key_points, [`Unlike option ${letterOf("C")}, the key reads the lower margin.`]);
  assert.deepEqual(rows.case.teaching_points, rows.case.key_points);
  const bRow = rows.options.find((o) => o.label === "text B")!;
  assert.equal(bRow.option_explanation, `Option ${letterOf("A")} is right, not ${"B"}.`);
  assert.equal(rows.case.clinical_vignette, "A term neonate.");
  assert.equal((rows.case.content as QbankQuestion).explanation, q.explanation);
  // Deterministic: a re-import yields identical rows.
  assert.deepEqual(questionToRows(item()), rows);
});
