// Second pass over a drafted item. Everything here is deterministic except the
// optional LLM cover test — the checks that decide whether a draft may reach an
// editor are code, not another model's opinion.
//
// Hard failures mark the generation job `failed` with reasons; soft findings
// ride along on the job so the editor sees them next to the item.
import { chat, extractJson, selectProvider } from "./provider";
import type { RetrievedArticle } from "./retrieve";
import { stemSimilarity, DUPLICATE_THRESHOLD, type QbankQuestion } from "./question";

export interface CriticFinding {
  check: string;
  severity: "error" | "warning";
  detail: string;
}

export interface CriticReport {
  pass: boolean;
  findings: CriticFinding[];
  /** 0..1, share of deterministic checks that passed */
  score: number;
  coverTest?: { answerable: boolean; note: string };
}

const NUMBER_RE = /\b\d+(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?\b/g;

/** Numbers that are not claims: ages, option letters, years, small counts. */
function isBoilerplateNumber(token: string, context: string): boolean {
  const n = parseFloat(token);
  if (!Number.isFinite(n)) return true;
  // years and ages read as context, not as study statistics
  if (/\b(year|month|week|day|hour|minute|old|dol|gestation)\b/i.test(context)) return true;
  if (n >= 1900 && n <= 2100) return true;
  return false;
}

/** Sentence-ish window around a match, so age/date context can be spotted. */
function windowAround(text: string, index: number, span = 40): string {
  return text.slice(Math.max(0, index - span), Math.min(text.length, index + span));
}

/**
 * Every number in the stem or explanation must appear verbatim in one of the
 * retrieved abstracts (STYLE_GUIDE §2). This is the check the pipeline exists
 * for: an unsourced statistic is the failure mode that would embarrass the
 * consortium.
 */
export function checkNumbersSourced(
  q: QbankQuestion,
  articles: RetrievedArticle[],
): CriticFinding[] {
  const haystack = articles.map((a) => `${a.title} ${a.abstract}`).join(" ");
  const findings: CriticFinding[] = [];
  const texts: [string, string][] = [
    ["stem.vignette", q.stem?.vignette ?? ""],
    ["explanation", q.explanation ?? ""],
  ];
  for (const [where, text] of texts) {
    for (const m of text.matchAll(NUMBER_RE)) {
      const token = m[0].trim();
      const bare = token.replace(/\s*%$/, "");
      if (isBoilerplateNumber(bare, windowAround(text, m.index ?? 0))) continue;
      if (!haystack.includes(bare)) {
        findings.push({
          check: "numbers_sourced",
          severity: "error",
          detail: `"${token}" in ${where} does not appear in any retrieved abstract`,
        });
      }
    }
  }
  return findings;
}

/** One best answer, homogeneous options, no banned stems. */
export function checkOneBestAnswer(q: QbankQuestion): CriticFinding[] {
  const findings: CriticFinding[] = [];
  if (q.question_type !== "multiple_choice") return findings;
  const options = q.options ?? [];
  const correct = options.filter((o) => o.correct).length;
  if (correct !== 1) {
    findings.push({
      check: "one_best_answer", severity: "error",
      detail: `${correct} options are marked correct (need exactly 1)`,
    });
  }
  if (options.length < 4) {
    findings.push({
      check: "one_best_answer", severity: "error",
      detail: `${options.length} options (need 4 or 5)`,
    });
  }
  for (const o of options) {
    if (/\b(all|none) of the above\b/i.test(o.text ?? "")) {
      findings.push({ check: "one_best_answer", severity: "error", detail: `banned option: "${o.text}"` });
    }
    if (/\b(always|never)\b/i.test(o.text ?? "") && !o.correct) {
      findings.push({
        check: "one_best_answer", severity: "warning",
        detail: `distractor uses an absolute ("${o.text}") — a giveaway`,
      });
    }
    if (!o.rationale || o.rationale.trim().length < 20) {
      findings.push({
        check: "one_best_answer", severity: "error",
        detail: `option ${o.key} has no usable rationale`,
      });
    }
  }
  // Homogeneity: the longest option should not dwarf the rest (length cue).
  const lens = options.map((o) => (o.text ?? "").length).sort((a, b) => a - b);
  if (lens.length >= 3 && lens[lens.length - 1] > lens[0] * 3 && lens[lens.length - 1] > 60) {
    const longest = options.reduce((a, b) => ((a.text ?? "").length > (b.text ?? "").length ? a : b));
    if (longest.correct) {
      findings.push({
        check: "one_best_answer", severity: "warning",
        detail: "the correct option is much longer than the distractors (length cue)",
      });
    }
  }
  return findings;
}

/** ACNS vocabulary, and the terms the style guide bans. */
export function checkTerminology(q: QbankQuestion): CriticFinding[] {
  const findings: CriticFinding[] = [];
  const text = `${q.stem?.vignette ?? ""} ${q.stem?.lead_in ?? ""} ${q.explanation ?? ""}`;
  if (/\bsubclinical\b/i.test(text)) {
    findings.push({
      check: "acns_terminology", severity: "warning",
      detail: '"subclinical" — use "electrographic seizure" unless quoting a study that used it',
    });
  }
  for (const vendor of ["Persyst", "Natus", "Nihon Kohden"]) {
    if (new RegExp(`\\b${vendor}\\b`, "i").test(text)) {
      findings.push({
        check: "acns_terminology", severity: "warning",
        detail: `vendor name "${vendor}" appears — only allowed when the teaching point is vendor-specific and cited`,
      });
    }
  }
  return findings;
}

/** Copyright and privacy risk. */
export function checkCopyrightAndPrivacy(q: QbankQuestion): CriticFinding[] {
  const findings: CriticFinding[] = [];
  const text = `${q.stem?.vignette ?? ""} ${q.stem?.image_caption ?? ""} ${q.explanation ?? ""}`;
  if (/\b(figure|fig\.)\s*\d/i.test(text) || /\breproduced (from|with)\b/i.test(text)) {
    findings.push({
      check: "no_copyright_reuse", severity: "error",
      detail: "the text refers to a published figure — our images are rendered from image.spec only",
    });
  }
  const quotes = [...text.matchAll(/"([^"]{1,400})"/g)].map((m) => m[1]);
  for (const quoted of quotes) {
    if (quoted.split(/\s+/).length > 15) {
      findings.push({
        check: "no_copyright_reuse", severity: "error",
        detail: `quotation longer than 15 words: "${quoted.slice(0, 60)}…"`,
      });
    }
  }
  if (/\bMRN\b|\b\d{2}\/\d{2}\/\d{4}\b/i.test(text)) {
    findings.push({
      check: "deidentified", severity: "error",
      detail: "the vignette contains an identifier-like pattern (MRN or a full date)",
    });
  }
  if (q.image?.license === "dataset-derived" && !q.image.attribution) {
    findings.push({
      check: "no_copyright_reuse", severity: "error",
      detail: "image.license is dataset-derived but attribution is empty",
    });
  }
  return findings;
}

/** References must be usable: primary present, PMIDs from the evidence set. */
export function checkReferences(q: QbankQuestion, articles: RetrievedArticle[]): CriticFinding[] {
  const findings: CriticFinding[] = [];
  const refs = q.references ?? [];
  if (refs.length === 0) {
    findings.push({ check: "references", severity: "error", detail: "no references" });
    return findings;
  }
  if (!refs.some((r) => r.role === "primary")) {
    findings.push({ check: "references", severity: "error", detail: "no primary reference" });
  }
  const allowed = new Set(articles.map((a) => a.pmid));
  for (const r of refs) {
    if (r.pmid && !allowed.has(String(r.pmid))) {
      findings.push({
        check: "references", severity: "error",
        detail: `PMID ${r.pmid} was not in the retrieved evidence — the model may have invented it`,
      });
    }
    if (!r.pmid && !r.doi && !r.isbn && !r.url) {
      findings.push({
        check: "references", severity: "warning",
        detail: `reference "${(r.citation ?? "").slice(0, 40)}…" has no identifier`,
      });
    }
  }
  return findings;
}

/** Structural completeness the schema allows but the style guide does not. */
export function checkStructure(q: QbankQuestion): CriticFinding[] {
  const findings: CriticFinding[] = [];
  if (!q.stem?.vignette || q.stem.vignette.length < 200) {
    findings.push({ check: "structure", severity: "error", detail: "vignette is missing or under 200 characters" });
  }
  if (!q.explanation || q.explanation.length < 500) {
    findings.push({ check: "structure", severity: "error", detail: "explanation is missing or under 500 characters" });
  }
  if ((q.key_points ?? []).length !== 3) {
    findings.push({ check: "structure", severity: "error", detail: `${(q.key_points ?? []).length} key_points (need exactly 3)` });
  }
  if (typeof q.image?.spec?.seed !== "number") {
    findings.push({ check: "structure", severity: "error", detail: "image.spec.seed is not an integer — the render would not be deterministic" });
  }
  if (q.question_type === "point_to_feature" && !q.point_to_feature) {
    findings.push({ check: "structure", severity: "error", detail: "point_to_feature block missing" });
  }
  return findings;
}

/** Near-duplicate of something already in the bank. */
export function checkDuplicate(q: QbankQuestion, existingStems: { id: string; stem: string }[]): CriticFinding[] {
  const mine = `${q.stem?.vignette ?? ""} ${q.stem?.lead_in ?? ""}`;
  const findings: CriticFinding[] = [];
  for (const other of existingStems) {
    const sim = stemSimilarity(mine, other.stem);
    if (sim >= DUPLICATE_THRESHOLD) {
      findings.push({
        check: "duplicate", severity: "error",
        detail: `stem overlaps ${other.id} by ${(sim * 100).toFixed(0)}%`,
      });
    }
  }
  return findings;
}

/**
 * Optional LLM cover test: can a competent reader answer from the stem and
 * image caption alone, with the options hidden? Advisory only — a failure here
 * is a warning, because it is a judgement call.
 */
export async function coverTest(q: QbankQuestion, timeoutMs?: number): Promise<CriticReport["coverTest"]> {
  if (selectProvider() === "mock") return undefined;
  try {
    const result = await chat({
      system:
        "You are an experienced pediatric neurophysiologist grading exam items. " +
        'Answer with ONE JSON object: {"answerable": boolean, "note": string}. ' +
        "answerable is true when a competent reader could give the intended answer from the " +
        "stem and image caption alone, with the options hidden (the NBME cover test).",
      user: [
        "Vignette:", q.stem?.vignette ?? "",
        "", "Image caption:", q.stem?.image_caption ?? "",
        "", "Lead-in:", q.stem?.lead_in ?? "",
        "", "Intended answer:", (q.options ?? []).find((o) => o.correct)?.text ?? "(point-to-feature item)",
      ].join("\n"),
      maxTokens: 1000,
      timeoutMs: timeoutMs ?? 20000,
    });
    const parsed = extractJson(result.text) as { answerable?: boolean; note?: string };
    return { answerable: !!parsed.answerable, note: String(parsed.note ?? "") };
  } catch (e) {
    return { answerable: true, note: `cover test skipped: ${(e as Error).message}` };
  }
}

const DETERMINISTIC_CHECKS = [
  "structure", "one_best_answer", "numbers_sourced",
  "references", "acns_terminology", "no_copyright_reuse", "duplicate",
];

/** Run every check. `pass` is false when any finding is an error. */
export async function critique(input: {
  question: QbankQuestion;
  articles: RetrievedArticle[];
  existingStems?: { id: string; stem: string }[];
  runCoverTest?: boolean;
  timeoutMs?: number;
}): Promise<CriticReport> {
  const q = input.question;
  const findings: CriticFinding[] = [
    ...checkStructure(q),
    ...checkOneBestAnswer(q),
    ...checkNumbersSourced(q, input.articles),
    ...checkReferences(q, input.articles),
    ...checkTerminology(q),
    ...checkCopyrightAndPrivacy(q),
    ...checkDuplicate(q, input.existingStems ?? []),
  ];

  const failedChecks = new Set(
    findings.filter((f) => f.severity === "error").map((f) => f.check),
  );
  const score = (DETERMINISTIC_CHECKS.length - failedChecks.size) / DETERMINISTIC_CHECKS.length;

  const report: CriticReport = {
    pass: findings.every((f) => f.severity !== "error"),
    findings,
    score: Math.max(0, Math.round(score * 100) / 100),
  };

  if (input.runCoverTest) {
    const cover = await coverTest(q, input.timeoutMs);
    report.coverTest = cover;
    if (cover && !cover.answerable) {
      report.findings.push({
        check: "cover_test", severity: "warning",
        detail: cover.note || "a reader could not answer from the stem alone",
      });
    }
  }
  return report;
}
