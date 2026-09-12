/**
 * Enqueue one EEG Teaching Lab export job per question-bank item, so every
 * bank recording is on the homelab store and opens in /admin/eeg-lab/viewer.
 *
 *   npm run qbank:lab-export -- --dry-run      # print the plan, write nothing
 *   npm run qbank:lab-export                   # enqueue what is missing
 *   npm run qbank:lab-export -- --only PQ-A-012
 *   npm run qbank:lab-export -- --formats edf  # default: lay,edf
 *
 * Idempotent: an item whose current spec (same spec_hash) already has a
 * pending / running / done export job tagged `qbank:<id>` is skipped, so a
 * re-run after render-all only queues items whose spec or renderer changed.
 * The export worker on the render host (tools/eeg-render/lab_worker.py) does
 * the work and records artifacts as eeglab://<recording_id>/<file>.
 *
 * Policy (src/lib/lab/types.ts): the learner copy never carries answers;
 * `includeAnswers: true` writes the SEPARATE instructor key, editor-gated.
 * Bank recordings are the teaching library, so `expires_at` is null (no
 * 30-day retention prune), unlike ad-hoc lab jobs.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { load } from "js-yaml";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, supabaseCredentials } from "./_env";
import { buildJobOptions, newRecordingId, specHash } from "../src/lib/lab/jobs";
import { normalizeSpecInput } from "../src/lib/lab/spec";
import type { LabFormat } from "../src/lib/lab/types";

const ROOT = "content/qbank/questions";
const DRY = process.argv.includes("--dry-run");
function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? "") : null;
}
const ONLY = arg("only");
const FORMATS = ((arg("formats") ?? "lay,edf").split(",").map((s) => s.trim()).filter(Boolean)) as LabFormat[];
for (const f of FORMATS) {
  if (f !== "lay" && f !== "edf") throw new Error(`unknown format ${f}`);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Mirrors tools/eeg-render/eeg_render/cli.py::_spec_duration_s on the RAW spec. */
function durationSeconds(kind: string, spec: Record<string, unknown>): number {
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  if (kind === "aeeg") return num(spec.duration_h, 6) * 3600;
  if (kind === "composite") {
    const panel = isObj(spec.qeeg_panel) ? spec.qeeg_panel : {};
    return num(panel.duration_min, 240) * 60;
  }
  if (kind === "eeg_page" && spec.duration_min == null) {
    return num(spec.at_min, 0) * 60 + num(spec.window_s, 15) + 60;
  }
  return num(spec.duration_min, 240) * 60;
}

interface Plan {
  id: string; kind: string; durationS: number; hash: string;
  action: "enqueue" | "skip-existing" | "skip-no-image";
  existing?: string;
}

async function main(): Promise<void> {
  loadEnvLocal();
  const { url, key } = supabaseCredentials();
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const files = readdirSync(ROOT).filter((f) => f.endsWith(".yaml")).sort();
  const plans: Plan[] = [];
  for (const file of files) {
    const doc = load(readFileSync(join(ROOT, file), "utf8")) as Record<string, unknown>;
    const id = String(doc.id ?? basename(file, ".yaml"));
    if (ONLY && id !== ONLY) continue;
    const image = doc.image;
    if (!isObj(image) || !isObj(image.spec)) {
      plans.push({ id, kind: "-", durationS: 0, hash: "", action: "skip-no-image" });
      continue;
    }
    const block = normalizeSpecInput(image);
    if (!block || !isObj(block) || !isObj(block.spec)) {
      plans.push({ id, kind: String(image.kind ?? "?"), durationS: 0, hash: "", action: "skip-no-image" });
      continue;
    }
    const kind = String(image.kind);
    const durationS = durationSeconds(kind, block.spec as Record<string, unknown>);
    const hash = specHash(block);
    const { data: existing, error } = await supabase
      .from("eeg_lab_jobs")
      .select("id,status,recording_id,spec_hash")
      .eq("requested_by", `qbank:${id}`)
      .eq("stage", "export")
      .eq("spec_hash", hash)
      .in("status", ["pending", "running", "done"])
      .limit(1);
    if (error) throw new Error(`${id}: lookup failed: ${error.message}`);
    if (existing && existing.length) {
      plans.push({ id, kind, durationS, hash, action: "skip-existing", existing: `${existing[0].recording_id} (${existing[0].status})` });
      continue;
    }
    plans.push({ id, kind, durationS, hash, action: "enqueue" });
    if (DRY) continue;
    const { error: insErr } = await supabase.from("eeg_lab_jobs").insert({
      stage: "export",
      status: "pending",
      spec: block,
      duration_s: durationS,
      formats: FORMATS,
      options: buildJobOptions({ mode: "expert", includeAnswers: true, runPersyst: false }),
      recording_id: newRecordingId(),
      spec_hash: hash,
      requested_by: `qbank:${id}`,
      expires_at: null,
    });
    if (insErr) throw new Error(`${id}: enqueue failed: ${insErr.message}`);
  }

  const counts = plans.reduce<Record<string, number>>((acc, p) => ((acc[p.action] = (acc[p.action] ?? 0) + 1), acc), {});
  for (const p of plans) {
    const dur = p.durationS ? `${(p.durationS / 3600).toFixed(1)} h` : "";
    console.log(`${p.id.padEnd(10)} ${p.kind.padEnd(11)} ${dur.padStart(7)}  ${p.action}${p.existing ? `  ${p.existing}` : ""}`);
  }
  const totalH = plans.filter((p) => p.action === "enqueue").reduce((s, p) => s + p.durationS, 0) / 3600;
  console.log(`\n${DRY ? "DRY RUN — " : ""}${JSON.stringify(counts)}; ${totalH.toFixed(0)} recording-hours to export as ${FORMATS.join("+")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
