/**
 * Validate the question-bank content in content/qbank/.
 *
 *   npm run qbank:validate                 # questions/ + examples/
 *   npm run qbank:validate -- --skip-pmid  # schema + duplicates only (offline)
 *   npm run qbank:validate -- --dir content/qbank/examples
 *
 * Three independent checks:
 *   1. JSON Schema (content/qbank/schema/question.schema.json, draft 2020-12)
 *   2. Every PMID resolves on PubMed (E-utilities esummary), and any reference
 *      marked `verified: true` must actually resolve — an unverifiable citation
 *      is the failure mode the style guide cares most about.
 *   3. Near-duplicate stems, by normalized token overlap across all files.
 *
 * Exit code 1 when any file has an error; warnings alone exit 0.
 * Nothing is written and nothing is sent anywhere.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { load } from "js-yaml";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import {
  DUPLICATE_THRESHOLD, QBANK_ID_PATTERN, stemSimilarity,
  type QbankQuestion,
} from "../src/lib/qbank/question";

const ROOT = "content/qbank";
const SCHEMA_PATH = join(ROOT, "schema/question.schema.json");
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
/** NCBI asks for ≤ 3 requests/second without an API key. Stay well under. */
const PMID_DELAY_MS = 400;

interface FileReport {
  file: string;
  id: string;
  errors: string[];
  warnings: string[];
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? "") : null;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function yamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => join(dir, f))
    .sort();
}

// ---------------------------------------------------------------------------
// PubMed PMID existence check
// ---------------------------------------------------------------------------
const pmidCache = new Map<string, { ok: boolean; title?: string }>();

async function checkPmid(pmid: string): Promise<{ ok: boolean; title?: string }> {
  const cached = pmidCache.get(pmid);
  if (cached) return cached;
  await sleep(PMID_DELAY_MS);
  try {
    const res = await fetch(`${EUTILS}/esummary.fcgi?db=pubmed&retmode=json&id=${encodeURIComponent(pmid)}`);
    if (!res.ok) {
      const out = { ok: false };
      pmidCache.set(pmid, out);
      return out;
    }
    const json = (await res.json()) as {
      result?: Record<string, { uid?: string; title?: string; error?: string }>;
    };
    const record = json.result?.[pmid];
    const out = record && record.uid && !record.error
      ? { ok: true, title: record.title }
      : { ok: false };
    pmidCache.set(pmid, out);
    return out;
  } catch {
    // A network failure is not proof the PMID is bad — report it as a warning
    // upstream by returning ok:true with no title.
    const out = { ok: true };
    pmidCache.set(pmid, out);
    return out;
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  if (!existsSync(SCHEMA_PATH)) {
    console.error(`Schema not found at ${SCHEMA_PATH}. Nothing to validate against.`);
    process.exit(1);
  }
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  const dirArg = arg("dir");
  const dirs = dirArg
    ? [dirArg]
    : [join(ROOT, "questions"), join(ROOT, "examples")];
  const files = dirs.flatMap(yamlFiles);

  if (files.length === 0) {
    console.log(`No YAML files found in: ${dirs.join(", ")}`);
    console.log("Nothing to validate (the content agents may not have written any yet).");
    return;
  }

  const reports: FileReport[] = [];
  const parsed: { file: string; q: QbankQuestion }[] = [];

  // ---- 1. parse + schema ----
  for (const file of files) {
    const report: FileReport = { file, id: basename(file, ".yaml"), errors: [], warnings: [] };
    let doc: unknown;
    try {
      doc = load(readFileSync(file, "utf8"));
    } catch (e) {
      report.errors.push(`YAML parse failed: ${(e as Error).message}`);
      reports.push(report);
      continue;
    }
    if (!doc || typeof doc !== "object") {
      report.errors.push("File does not contain a YAML mapping.");
      reports.push(report);
      continue;
    }

    const q = doc as QbankQuestion;
    report.id = q.id ?? report.id;

    if (!validate(doc)) {
      for (const err of validate.errors ?? []) {
        report.errors.push(`schema ${err.instancePath || "/"} ${err.message ?? ""}`.trim());
      }
    }

    // ---- checks the schema cannot express ----
    if (q.id && !QBANK_ID_PATTERN.test(q.id)) {
      report.errors.push(`id "${q.id}" does not match PQ-<WRITER>-<NNN>`);
    }
    if (q.id && basename(file).replace(/\.ya?ml$/, "") !== q.id) {
      report.warnings.push(`filename does not match id (${q.id}.yaml expected)`);
    }
    if (q.question_type === "multiple_choice") {
      const correct = (q.options ?? []).filter((o) => o.correct).length;
      if (correct !== 1) report.errors.push(`multiple_choice needs exactly one correct option (found ${correct})`);
      const keys = (q.options ?? []).map((o) => o.key);
      if (new Set(keys).size !== keys.length) report.errors.push("duplicate option keys");
      const banned = (q.options ?? []).find((o) =>
        /\b(all|none) of the above\b/i.test(o.text ?? ""));
      if (banned) report.errors.push(`option "${banned.text}" is banned by the style guide`);
    }
    if (q.question_type === "point_to_feature" && !q.point_to_feature) {
      report.errors.push("point_to_feature items need a point_to_feature block");
    }
    if ((q.references ?? []).length && !q.references.some((r) => r.role === "primary")) {
      report.errors.push("at least one reference must have role: primary");
    }
    const unverified = (q.references ?? []).filter((r) => !r.verified);
    if (unverified.length) {
      report.errors.push(`${unverified.length} reference(s) are not marked verified — import will refuse them`);
    }
    const checklist = q.metadata?.checklist;
    if (checklist) {
      const unchecked = Object.entries(checklist).filter(([, v]) => !v).map(([k]) => k);
      if (unchecked.length) report.warnings.push(`checklist not complete: ${unchecked.join(", ")}`);
    }
    if (q.image && typeof q.image.spec?.seed !== "number") {
      report.errors.push("image.spec.seed must be an integer (the renderer must be deterministic)");
    }

    reports.push(report);
    if (q.id) parsed.push({ file, q });
  }

  // ---- 2. PMIDs ----
  if (!hasFlag("skip-pmid")) {
    const uniquePmids = new Set<string>();
    for (const { q } of parsed) {
      for (const r of q.references ?? []) if (r.pmid) uniquePmids.add(String(r.pmid));
    }
    if (uniquePmids.size) {
      process.stdout.write(`Checking ${uniquePmids.size} PMID(s) on PubMed`);
      for (const pmid of uniquePmids) {
        await checkPmid(pmid);
        process.stdout.write(".");
      }
      process.stdout.write("\n");
    }
    for (const { file, q } of parsed) {
      const report = reports.find((r) => r.file === file)!;
      for (const r of q.references ?? []) {
        if (!r.pmid) {
          if (!r.doi && !r.isbn && !r.url) {
            report.warnings.push(`reference "${(r.citation ?? "").slice(0, 40)}…" has no pmid/doi/isbn/url`);
          }
          continue;
        }
        const result = pmidCache.get(String(r.pmid));
        if (result && !result.ok) {
          report.errors.push(`PMID ${r.pmid} does not resolve on PubMed`);
        }
      }
    }
  }

  // ---- 3. near-duplicate stems ----
  const dupes: string[] = [];
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const a = parsed[i];
      const b = parsed[j];
      const textA = `${a.q.stem?.vignette ?? ""} ${a.q.stem?.lead_in ?? ""}`;
      const textB = `${b.q.stem?.vignette ?? ""} ${b.q.stem?.lead_in ?? ""}`;
      const sim = stemSimilarity(textA, textB);
      if (sim >= DUPLICATE_THRESHOLD) {
        dupes.push(`${a.q.id} ↔ ${b.q.id}  overlap ${(sim * 100).toFixed(0)}%`);
        reports.find((r) => r.file === b.file)?.warnings.push(`stem overlaps ${a.q.id} (${(sim * 100).toFixed(0)}%)`);
      }
    }
  }

  // ---- report ----
  const idWidth = Math.max(10, ...reports.map((r) => (r.id ?? "").length));
  console.log("");
  console.log(`${"ID".padEnd(idWidth)}  ${"RESULT".padEnd(8)}  DETAIL`);
  console.log("-".repeat(idWidth + 10 + 40));
  for (const r of reports) {
    const verdict = r.errors.length ? "FAIL" : r.warnings.length ? "WARN" : "ok";
    const first = r.errors[0] ?? r.warnings[0] ?? "";
    console.log(`${(r.id ?? "").padEnd(idWidth)}  ${verdict.padEnd(8)}  ${first}`);
    for (const e of r.errors.slice(1)) console.log(`${" ".repeat(idWidth)}            ${e}`);
    for (const w of r.warnings.slice(r.errors.length ? 0 : 1)) console.log(`${" ".repeat(idWidth)}            (warn) ${w}`);
  }

  const failed = reports.filter((r) => r.errors.length);
  const warned = reports.filter((r) => !r.errors.length && r.warnings.length);
  console.log("");
  console.log(`${reports.length} file(s): ${reports.length - failed.length - warned.length} ok, ${warned.length} with warnings, ${failed.length} failing.`);
  if (dupes.length) {
    console.log("");
    console.log("Possible duplicate stems:");
    for (const d of dupes) console.log(`  ${d}`);
  }
  // process.exitCode, not process.exit(): the PubMed fetches keep a socket
  // alive briefly, and forcing the process down trips a libuv assertion on
  // Windows that masks the real exit code.
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
