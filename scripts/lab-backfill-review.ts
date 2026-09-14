/**
 * One-off after migration 20260914_eeg_lab_review: give every export job
 * without a title the same suggested title + description the recording page
 * offers an author (src/lib/lab/library.ts suggestTitle / suggestDescription).
 *
 *   npm run lab:backfill-review -- --dry-run   # print what would be written
 *   npm run lab:backfill-review                # write titles where missing
 *   npm run lab:backfill-review -- --force     # overwrite existing titles too
 *
 * Idempotent: rows that already carry a title are skipped unless --force.
 * Learner-visible text, so the suggestion never names the authored findings.
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, supabaseCredentials } from "./_env";
import {
  LIBRARY_CASE_COLUMNS, caseRowToQuestion, qbankIdOfRow, suggestDescription, suggestTitle, summarizeSpec,
  type LibraryQuestion,
} from "../src/lib/lab/library";

const DRY = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

async function main() {
  loadEnvLocal();
  const { url, key } = supabaseCredentials();
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: rows, error } = await supabase
    .from("eeg_lab_jobs")
    .select("id,recording_id,spec,duration_s,requested_by,qbank_id,title,description")
    .eq("stage", "export")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`list failed: ${error.message}`);

  const jobs = (rows ?? []) as Record<string, unknown>[];
  const qbankIds = Array.from(new Set(jobs.map(qbankIdOfRow).filter((v): v is string => !!v)));
  const cases = new Map<string, LibraryQuestion>();
  if (qbankIds.length) {
    const { data, error: cErr } = await supabase.from("eeg_cases").select(LIBRARY_CASE_COLUMNS).in("qbank_id", qbankIds);
    if (cErr) throw new Error(`case lookup failed: ${cErr.message}`);
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const q = caseRowToQuestion(row);
      if (q) cases.set(q.qbankId, q);
    }
  }

  let written = 0, skipped = 0;
  for (const row of jobs) {
    if (row.title && !FORCE) { skipped++; continue; }
    const qbankId = qbankIdOfRow(row);
    const question = qbankId ? cases.get(qbankId) ?? null : null;
    const summary = summarizeSpec(row.spec);
    const durationS = typeof row.duration_s === "number" ? row.duration_s : 0;
    const title = suggestTitle(summary, question, durationS);
    const description = suggestDescription(summary, question, durationS);
    console.log(`${String(row.recording_id ?? row.id).padEnd(24)} ${title}`);
    if (DRY) continue;
    const { error: uErr } = await supabase.from("eeg_lab_jobs").update({ title, description }).eq("id", row.id);
    if (uErr) throw new Error(`${row.recording_id}: update failed: ${uErr.message}`);
    written++;
  }
  console.log(`\n${DRY ? "would write" : "wrote"} ${DRY ? jobs.length - skipped : written}, skipped ${skipped} (already titled)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
