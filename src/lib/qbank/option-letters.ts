// Option-letter references in learner-facing text.
//
// Writers author options in a fixed order (A = the key, usually) and refer to
// them by letter in the explanation ("The correct answer is A", "option C").
// questionToRows stores the options SHUFFLED (shuffleOptions, seeded by the
// item id), and the UI letters options by stored position, so an authoring
// letter left in the text names the wrong option on screen. This module finds
// the phrases that unambiguously denote an option and rewrites their letters
// to the displayed ones.
//
// Deliberately conservative: only letters inside an option-reference phrase
// are touched. "type A", "Grade A", "C3", "ACNS", an article "A" and a bare
// letter outside those phrases are never rewritten — suspectLetterTokens()
// surfaces the leftovers for a human instead.

export interface LetterRef {
  /** Offset of the letter in the text. */
  index: number;
  letter: string;
  /** The whole matched phrase, for reporting, and where it starts. */
  phrase: string;
  phraseStart: number;
  /** True when the phrase asserts this letter is the correct answer. */
  assertsCorrect: boolean;
}

const L = "[A-E]";
/** A letter token: not glued to a word, digit, hyphen or apostrophe. */
const END = "(?![A-Za-z0-9'\\-])";
const PAREN_LETTER = `\\(?${L}\\)?${END}`;
const LIST_SEP = "(?:\\s*,\\s*(?:and\\s+|or\\s+)?|\\s+(?:and|or)\\s+|\\s*/\\s*)";

// Each pattern's letters are all option references. `correct` marks the
// patterns that assert the key.
// No `i` flag anywhere: the letter class must stay upper-case, so the words
// spell their own capitalisation.
const PATTERNS: { re: RegExp; correct: boolean }[] = [
  // "The correct answer is A", "the best answer is (C)", "Answer: B"
  { re: new RegExp(`\\b[Aa]nswer(?:\\s+choice)?(?:\\s+(?:is|was|would\\s+be)\\s+|\\s*:\\s*)(?:option\\s+|choice\\s+)?${PAREN_LETTER}`, "g"), correct: true },
  // "option B", "Option (C)", "options A and D", "choices B, C, and E"
  { re: new RegExp(`\\b(?:[Oo]ptions?|[Cc]hoices?)\\s+${PAREN_LETTER}(?:${LIST_SEP}${PAREN_LETTER})*`, "g"), correct: false },
  // "(A) ..." or "A: ..." opening a sentence or line
  { re: new RegExp(`(?:^|(?<=[.!?]\\s{1,3})|(?<=\\n\\s*))(?:\\(${L}\\)|${L}:)(?=\\s)`, "g"), correct: false },
];

const LETTER_IN_PHRASE = new RegExp(`(?<![A-Za-z0-9'\\-])${L}${END}`, "g");

/** Every option-letter reference in `text`, in order. Overlapping phrases
 *  keep the first (earliest, then longest) match. */
export function findOptionLetterRefs(text: string): LetterRef[] {
  const spans: { start: number; end: number; correct: boolean }[] = [];
  for (const { re, correct } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      spans.push({ start: m.index, end: m.index + m[0].length, correct });
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const refs: LetterRef[] = [];
  let lastEnd = -1;
  for (const s of spans) {
    if (s.start < lastEnd) continue;
    lastEnd = s.end;
    const phrase = text.slice(s.start, s.end);
    // In the "answer is/option" patterns the leading words cannot hold a
    // standalone capital A-E, so every letter token in the phrase is an option.
    LETTER_IN_PHRASE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LETTER_IN_PHRASE.exec(phrase))) {
      refs.push({ index: s.start + m.index, letter: m[0], phrase, phraseStart: s.start, assertsCorrect: s.correct });
    }
  }
  return refs;
}

/** Rewrite every option reference through `map` (authoring -> displayed
 *  letter) in one pass, so swaps like A<->C cannot chain. Letters absent from
 *  the map are left alone (the validator reports them). */
export function remapOptionLetters(
  text: string,
  map: Record<string, string>,
): { text: string; changes: { from: string; to: string }[] } {
  const refs = findOptionLetterRefs(text);
  if (!refs.length) return { text, changes: [] };
  let out = "";
  let cursor = 0;
  let changed = false;
  for (const r of refs) {
    const to = map[r.letter] ?? r.letter;
    if (to !== r.letter) changed = true;
    out += text.slice(cursor, r.index) + to;
    cursor = r.index + 1;
  }
  out += text.slice(cursor);
  if (!changed) return { text, changes: [] };
  // Report whole phrases, old -> new, one per phrase occurrence.
  const changes: { from: string; to: string }[] = [];
  const starts = [...new Set(refs.map((r) => r.phraseStart))];
  for (const start of starts) {
    const phrase = refs.find((r) => r.phraseStart === start)!.phrase;
    const rewritten = phrase.replace(LETTER_IN_PHRASE, (l) => map[l] ?? l);
    if (rewritten !== phrase) changes.push({ from: phrase, to: rewritten });
  }
  return { text: out, changes };
}

/** Authoring key -> displayed letter, for options in authoring order and the
 *  same options in displayed order (object identity). */
export function displayLetterMap<T extends { key: string }>(authoring: T[], displayed: T[]): Record<string, string> {
  const map: Record<string, string> = {};
  authoring.forEach((o) => {
    const i = displayed.indexOf(o);
    if (i >= 0) map[o.key] = String.fromCharCode(65 + i);
  });
  return map;
}

/**
 * Problems with the option references in an item's learner-facing text
 * (authoring letters): a letter with no such option, or "the correct answer
 * is X" where X is not the keyed option. `fields` maps a field name to text.
 */
export function letterRefProblems(
  fields: Record<string, string | undefined>,
  options: { key: string; correct: boolean }[],
): string[] {
  const keys = new Set(options.map((o) => o.key));
  const correct = options.find((o) => o.correct)?.key;
  const problems: string[] = [];
  for (const [name, text] of Object.entries(fields)) {
    if (!text) continue;
    for (const r of findOptionLetterRefs(text)) {
      if (!keys.has(r.letter)) {
        problems.push(`${name}: "${r.phrase}" names option ${r.letter}, which does not exist`);
      } else if (r.assertsCorrect && correct && r.letter !== correct) {
        problems.push(`${name}: "${r.phrase}" but the keyed answer is ${correct}`);
      }
    }
  }
  return problems;
}

/** The learner-facing text fields of a question, by name. */
export function questionTextFields(q: {
  stem: { vignette: string; image_caption: string; lead_in: string };
  explanation: string;
  learning_objective: string;
  key_points: string[];
  options: { key: string; text: string; rationale: string }[];
  point_to_feature?: { instruction: string };
}): Record<string, string | undefined> {
  const fields: Record<string, string | undefined> = {
    vignette: q.stem?.vignette,
    image_caption: q.stem?.image_caption,
    lead_in: q.stem?.lead_in,
    explanation: q.explanation,
    learning_objective: q.learning_objective,
    instruction: q.point_to_feature?.instruction,
  };
  (q.key_points ?? []).forEach((k, i) => { fields[`key_points[${i}]`] = k; });
  (q.options ?? []).forEach((o) => {
    fields[`option ${o.key} text`] = o.text;
    fields[`option ${o.key} rationale`] = o.rationale;
  });
  return fields;
}

/**
 * Standalone capital B-E tokens (and an "A" that cannot be an article —
 * followed by punctuation or the end) that are NOT inside a recognised
 * option phrase. These might be option references the patterns missed; the
 * dry run lists them for a human to reword by content.
 */
export function suspectLetterTokens(text: string): { index: number; letter: string; context: string }[] {
  const covered = new Set(findOptionLetterRefs(text).map((r) => r.index));
  const out: { index: number; letter: string; context: string }[] = [];
  const re = /(?<![A-Za-z0-9'\-.])([A-E])(?![A-Za-z0-9'\-])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (covered.has(m.index)) continue;
    const letter = m[1];
    const after = text.slice(m.index + 1);
    if (letter === "A" && !/^\s*(?:[.,;:)]|$)/.test(after)) continue; // article
    // Units and grades written with a space: "33.5 C", "grade C".
    const before = text.slice(Math.max(0, m.index - 12), m.index);
    if (/\d\s*$/.test(before) || /\b(?:grade|type|class|level|group|vitamin|hepatitis)\s+$/i.test(before)) continue;
    out.push({ index: m.index, letter, context: text.slice(Math.max(0, m.index - 30), m.index + 30).replace(/\s+/g, " ") });
  }
  return out;
}
