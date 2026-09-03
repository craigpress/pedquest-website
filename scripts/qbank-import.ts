/**
 * Import content/qbank/questions/*.yaml into Supabase (`eeg_cases` +
 * eeg_case_options + eeg_case_references), keyed on `qbank_id`.
 *
 *   npm run qbank:import -- --dry-run     # print the plan, write nothing
 *   npm run qbank:import                  # apply
 *   npm run qbank:import -- --only PQ-A-007
 *   npm run qbank:import -- --dir content/qbank/examples
 *
 * Re-runnable. Rules:
 *   * new item                     -> inserted as `pending_review`
 *   * existing draft/pending/archived -> updated, status set to pending_review
 *   * existing approved/published  -> NEVER downgraded. The content is updated,
 *     `version` is bumped (which makes the DB trigger snapshot the superseded
 *     content into eeg_case_revisions) and a `changes_requested` review note
 *     "needs re-review" is filed so an editor sees it in the queue.
 *   * a reference that is not `verified: true` blocks the item — the publish
 *     gate needs one verified reference, so importing unverified ones would
 *     just produce items that cannot be approved.
 *
 * Requires migration 20260903_qbank.sql to have been applied.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { load } from "js-yaml";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, supabaseCredentials } from "./_env";
import {
  imagePathForId, questionToRows, specHash,
  type QbankQuestion,
} from "../src/lib/qbank/question";

const ROOT = "content/qbank";
const IMAGE_DIR = "public/images/qbank";

const DRY = process.argv.includes("--dry-run");
function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? "") : null;
}

interface Plan {
  id: string;
  action: "insert" | "update" | "update-locked" | "skip";
  reason: string;
  status: string;
  options: number;
  references: number;
  hasSidecar: boolean;
  specHash: string;
}

function yamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .map((f) => join(dir, f))
    .sort();
}

function readSidecar(id: string): unknown | null {
  const path = join(IMAGE_DIR, `${id}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.warn(`  ! ${id}: sidecar ${path} is not valid JSON (${(e as Error).message}) — ignoring`);
    return null;
  }
}

async function main() {
  loadEnvLocal();

  const dir = arg("dir") ?? join(ROOT, "questions");
  const only = arg("only");
  const files = yamlFiles(dir);
  if (files.length === 0) {
    console.log(`No YAML files in ${dir}. Nothing to import.`);
    return;
  }

  // ---- load + basic gate ----
  const questions: QbankQuestion[] = [];
  for (const file of files) {
    let doc: unknown;
    try {
      doc = load(readFileSync(file, "utf8"));
    } catch (e) {
      console.error(`SKIP ${basename(file)}: YAML parse failed — ${(e as Error).message}`);
      continue;
    }
    const q = doc as QbankQuestion;
    if (!q?.id) {
      console.error(`SKIP ${basename(file)}: no id`);
      continue;
    }
    if (only && q.id !== only) continue;
    questions.push(q);
  }
  if (questions.length === 0) {
    console.log("No questions selected.");
    return;
  }

  const { url, key } = supabaseCredentials();
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // ---- what already exists? ----
  const ids = questions.map((q) => q.id);
  const { data: existingRows, error: existingErr } = await supabase
    .from("eeg_cases")
    .select("id,qbank_id,status,version,spec_hash")
    .in("qbank_id", ids);
  if (existingErr) {
    // A dry run should still be usable before the migration lands — report the
    // plan as if every item were new rather than refusing to say anything.
    if (DRY) {
      console.warn(`NOTE: could not read existing cases (${existingErr.message}).`);
      console.warn("      Migration 20260903_qbank.sql has probably not been applied yet;");
      console.warn("      the plan below therefore treats every item as new.\n");
    } else {
      console.error("Could not read existing cases:", existingErr.message);
      console.error("Has migration 20260903_qbank.sql been applied?");
      process.exit(1);
    }
  }
  const existing = new Map<string, { id: string; status: string; version: number; spec_hash: string | null }>();
  for (const r of existingRows ?? []) {
    existing.set(r.qbank_id as string, {
      id: r.id as string,
      status: r.status as string,
      version: (r.version as number) ?? 1,
      spec_hash: (r.spec_hash as string) ?? null,
    });
  }

  const plans: Plan[] = [];
  // failures = something is wrong with the content or the write.
  // waiting  = the item is fine but not renderable yet; not an error.
  let failures = 0;
  let waiting = 0;

  for (const q of questions) {
    const sidecar = readSidecar(q.id);
    const rows = questionToRows(q, sidecar);
    const prev = existing.get(q.id);

    const unverified = (q.references ?? []).filter((r) => !r.verified).length;
    if (unverified > 0) {
      plans.push({
        id: q.id, action: "skip",
        reason: `${unverified} unverified reference(s) — run qbank:validate and verify PMIDs first`,
        status: prev?.status ?? "-", options: rows.options.length,
        references: rows.references.length, hasSidecar: !!sidecar, specHash: rows.case.spec_hash,
      });
      failures++;
      continue;
    }
    if (q.question_type === "point_to_feature" && !rows.case.correct_region) {
      plans.push({
        id: q.id, action: "skip",
        reason: "point_to_feature item has no answer region — render the image first (missing sidecar)",
        status: prev?.status ?? "-", options: rows.options.length,
        references: rows.references.length, hasSidecar: !!sidecar, specHash: rows.case.spec_hash,
      });
      waiting++;
      continue;
    }

    const locked = prev && (prev.status === "approved" || prev.status === "published");
    const targetStatus = !prev ? "pending_review" : locked ? prev.status : "pending_review";
    const plan: Plan = {
      id: q.id,
      action: !prev ? "insert" : locked ? "update-locked" : "update",
      reason: !prev
        ? "new item"
        : locked
          ? `already ${prev.status}: content updated, status kept, re-review requested`
          : `updating existing ${prev.status}`,
      status: targetStatus,
      options: rows.options.length,
      references: rows.references.length,
      hasSidecar: !!sidecar,
      specHash: rows.case.spec_hash,
    };
    plans.push(plan);

    if (DRY) continue;

    // ---- write ----
    const caseRow: Record<string, unknown> = {
      ...rows.case,
      status: targetStatus,
      image_url: imagePathForId(q.id),
      spec_hash: specHash(q.image.spec),
    };

    let caseId: string;
    if (!prev) {
      const { data, error } = await supabase
        .from("eeg_cases").insert(caseRow).select("id").single();
      if (error || !data) {
        console.error(`FAIL ${q.id}: insert — ${error?.message}`);
        failures++;
        continue;
      }
      caseId = data.id as string;
    } else {
      // Explicit version bump: the DB trigger snapshots the superseded content
      // into eeg_case_revisions whenever content-bearing columns change, and
      // honours a version we set ourselves.
      caseRow.version = Math.max(q.version, prev.version + 1);
      const { error } = await supabase.from("eeg_cases").update(caseRow).eq("id", prev.id);
      if (error) {
        console.error(`FAIL ${q.id}: update — ${error.message}`);
        failures++;
        continue;
      }
      caseId = prev.id;
    }

    // options + references are replaced wholesale — the YAML is the source of truth
    await supabase.from("eeg_case_options").delete().eq("case_id", caseId);
    if (rows.options.length) {
      const { error } = await supabase
        .from("eeg_case_options")
        .insert(rows.options.map((o) => ({ ...o, case_id: caseId })));
      if (error) { console.error(`FAIL ${q.id}: options — ${error.message}`); failures++; continue; }
    }

    await supabase.from("eeg_case_references").delete().eq("case_id", caseId);
    if (rows.references.length) {
      const { error } = await supabase
        .from("eeg_case_references")
        .insert(rows.references.map((r) => ({ ...r, case_id: caseId })));
      if (error) { console.error(`FAIL ${q.id}: references — ${error.message}`); failures++; continue; }
    }

    if (locked) {
      const { error } = await supabase.from("eeg_case_reviews").insert({
        case_id: caseId,
        reviewer_email: "qbank-import",
        decision: "changes_requested",
        notes: `needs re-review: content re-imported from ${basename(dir)}/${q.id}.yaml at version ${caseRow.version}.`,
      });
      if (error) console.warn(`  ! ${q.id}: could not file the re-review note — ${error.message}`);
    }

    console.log(`${plan.action === "insert" ? "+" : "~"} ${q.id} (${targetStatus})`);
  }

  // ---- report ----
  const w = Math.max(8, ...plans.map((p) => p.id.length));
  console.log("");
  console.log(`${"ID".padEnd(w)}  ${"ACTION".padEnd(14)}  ${"STATUS".padEnd(14)}  OPT  REF  IMG   SPEC      NOTE`);
  console.log("-".repeat(w + 80));
  for (const p of plans) {
    console.log(
      `${p.id.padEnd(w)}  ${p.action.padEnd(14)}  ${p.status.padEnd(14)}  ` +
      `${String(p.options).padStart(3)}  ${String(p.references).padStart(3)}  ` +
      `${(p.hasSidecar ? "yes" : "no ").padEnd(4)}  ${p.specHash}  ${p.reason}`,
    );
  }
  console.log("");
  console.log(
    `${plans.length} item(s): ${plans.filter((p) => p.action === "insert").length} new, ` +
    `${plans.filter((p) => p.action === "update").length} updated, ` +
    `${plans.filter((p) => p.action === "update-locked").length} live (re-review requested), ` +
    `${plans.filter((p) => p.action === "skip").length} skipped.`,
  );
  if (waiting) {
    console.log(`${waiting} of the skipped item(s) are only waiting on tools/eeg-render — not an error.`);
  }
  if (DRY) console.log("DRY RUN — nothing was written.");
  // process.exitCode, not process.exit(): forcing the process down while
  // supabase-js still holds a keep-alive socket trips a libuv assertion on
  // Windows and replaces the real exit code with an abort.
  if (failures) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
