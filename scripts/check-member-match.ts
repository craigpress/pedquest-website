/**
 * Keep src/lib/memberMatch.ts in step with the members table.
 *
 * MEMBER_NAME_MAP drives publication author-tagging (the PubMed scanner and the
 * CV importer). It is a hand-maintained duplicate of member identity, so it
 * drifts: entries survive for people who have been archived, and the scanner
 * keeps attributing new papers to them. A stale id fails silently - the author
 * just doesn't get highlighted - which is why the drift went unnoticed.
 *
 *   npx tsx scripts/check-member-match.ts         # report, exit 1 on drift
 *   npx tsx scripts/check-member-match.ts --fix   # remove archived entries
 *
 * Three categories are reported:
 *   archived - maps to a member with status 'archived'; --fix removes it
 *   unknown  - maps to an id absent from the table entirely; NEVER auto-removed,
 *              because that may be someone who belongs on the site
 *   unmapped - active member with no mapping; the scanner can never tag them
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { loadEnvLocal, supabaseCredentials } from "./_env";

const FILE = "src/lib/memberMatch.ts";

loadEnvLocal();

/** Ids declared as top-level keys inside a named object literal. */
function idsIn(source: string, constName: string): string[] {
  const start = source.indexOf(constName);
  if (start === -1) throw new Error(`${constName} not found in ${FILE}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  const block = source.slice(open, end);
  return [...block.matchAll(/^\s{2}"([a-z0-9-]+)":/gm)].map((m) => m[1]);
}

/** Drop whole entries for the given ids, including any comment-only lines left
 *  dangling above a removed block. Entries are single-line in this file. */
function removeEntries(source: string, ids: Set<string>): { out: string; removed: number } {
  const lines = source.split("\n");
  const kept: string[] = [];
  let removed = 0;
  for (const line of lines) {
    const m = line.match(/^\s{2}"([a-z0-9-]+)":/);
    if (m && ids.has(m[1])) { removed++; continue; }
    kept.push(line);
  }
  return { out: kept.join("\n"), removed };
}

async function main() {
  const fix = process.argv.includes("--fix");
  const { url, key } = supabaseCredentials();
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data, error } = await supabase.from("members").select("id, status");
  if (error) throw new Error(`Supabase read failed: ${error.message}`);

  const active = new Set((data ?? []).filter((r) => r.status === "active").map((r) => r.id as string));
  const archived = new Set((data ?? []).filter((r) => r.status !== "active").map((r) => r.id as string));

  const src = readFileSync(FILE, "utf8");
  const mapIds = idsIn(src, "MEMBER_NAME_MAP");
  const dispIds = idsIn(src, "MEMBER_DISPLAY_NAMES");
  const allMapped = new Set([...mapIds, ...dispIds]);

  const staleArchived = [...allMapped].filter((id) => archived.has(id)).sort();
  const unknown = [...allMapped].filter((id) => !active.has(id) && !archived.has(id)).sort();
  const unmapped = [...active].filter((id) => !allMapped.has(id)).sort();

  console.log(`members table : ${active.size} active, ${archived.size} archived`);
  console.log(`memberMatch   : ${mapIds.length} name-map, ${dispIds.length} display-name entries\n`);
  console.log(`archived (safe to remove) : ${staleArchived.length}`);
  if (staleArchived.length) console.log(`  ${staleArchived.join(", ")}`);
  console.log(`unknown  (needs a human)  : ${unknown.length}`);
  if (unknown.length) console.log(`  ${unknown.join(", ")}`);
  console.log(`unmapped (never tagged)   : ${unmapped.length}`);
  if (unmapped.length) console.log(`  ${unmapped.join(", ")}`);

  if (!fix) {
    if (staleArchived.length || unknown.length || unmapped.length) {
      console.log("\nDrift found. Re-run with --fix to remove the archived entries.");
      process.exit(1);
    }
    console.log("\nIn step with the members table.");
    return;
  }

  if (!staleArchived.length) {
    console.log("\nNothing to remove.");
    return;
  }

  const { out, removed } = removeEntries(src, new Set(staleArchived));
  writeFileSync(FILE, out, "utf8");
  console.log(`\nRemoved ${removed} lines for ${staleArchived.length} archived members.`);
  if (unknown.length) {
    console.log(`Left ${unknown.length} unknown id(s) alone - decide those by hand: ${unknown.join(", ")}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
