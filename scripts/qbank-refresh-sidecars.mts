// Push freshly rendered sidecars into the database.
//
// Renderer 0.3.2 moved the panel gutter (LEFT 0.128 -> 0.225) and the inter-panel
// gap, so EVERY panel rectangle shifted - not just the raw-EEG pages whose row
// spacing changed. That matters twice over:
//
//   * image_sidecar.panels drives the learner viewer's heat-map palette swap,
//     which recolours by rectangle. Stale rectangles recolour the wrong strip.
//   * correct_region for a point_to_feature item is DERIVED from panel
//     geometry. A stale region grades a correct click as wrong.
//
// So this refreshes all of them, and re-derives correct_region wherever the
// new sidecar carries an answer region.
//
//   npx tsx scripts/qbank-refresh-sidecars.mts           # dry run
//   npx tsx scripts/qbank-refresh-sidecars.mts --apply

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, supabaseCredentials } from "./_env";

loadEnvLocal();
const { url, key } = supabaseCredentials();
const sb = createClient(url, key, { auth: { persistSession: false } });
const apply = process.argv.includes("--apply");

const DIR = "public/images/qbank";
const EXPECTED = process.env.RENDERER_VERSION ?? "0.3.2";

interface Sidecar {
  id: string; kind: string; width: number; height: number;
  answer_region: unknown | null; renderer_version: string;
  panels: Record<string, unknown>[];
}

const sidecars = new Map<string, Sidecar>();
for (const f of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
  const s = JSON.parse(readFileSync(join(DIR, f), "utf8")) as Sidecar;
  sidecars.set(s.id, s);
}
const { data: cases, error } = await sb
  .from("eeg_cases").select("id,qbank_id,question_type,correct_region,image_width,image_height");
if (error) throw new Error(error.message);

// Examples without database rows are not part of this refresh.
const caseIds = new Set((cases ?? []).map((c) => c.qbank_id));
const stale = [...sidecars.values()].filter((s) => caseIds.has(s.id) && s.renderer_version !== EXPECTED);
if (stale.length) {
  console.error(`REFUSING: ${stale.length} sidecar(s) are not ${EXPECTED} (e.g. ${stale[0].id} = ${stale[0].renderer_version}).`);
  console.error("Re-render first, or the database would be pointed at geometry that does not match the PNGs.");
  process.exit(1);
}

let updated = 0, regions = 0, missing = 0;
for (const c of (cases ?? []) as Record<string, unknown>[]) {
  const qid = c.qbank_id as string | null;
  if (!qid) continue;
  const side = sidecars.get(qid);
  if (!side) { missing++; console.warn(`  no sidecar on disk for ${qid}`); continue; }

  const patch: Record<string, unknown> = {
    image_sidecar: side,
    image_width: side.width,
    image_height: side.height,
    updated_at: new Date().toISOString(),
  };
  // Only a point_to_feature item has a graded region, and only the renderer
  // may set it (STYLE_GUIDE: the writer never hand-draws one).
  if (c.question_type === "point_to_feature" && side.answer_region != null) {
    patch.correct_region = side.answer_region;
    regions++;
  }
  updated++;
  if (apply) {
    const { error: e } = await sb.from("eeg_cases").update(patch).eq("id", c.id as string);
    if (e) { console.error(`  FAIL ${qid}: ${e.message}`); process.exitCode = 1; }
  }
}

console.log(`sidecars on disk: ${sidecars.size}`);
console.log(`cases updated:    ${updated}   answer regions re-derived: ${regions}   missing sidecar: ${missing}`);
console.log(apply ? "APPLIED" : "dry run — pass --apply to write");
