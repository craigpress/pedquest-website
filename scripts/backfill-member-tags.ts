// Backfill member_author_ids for existing Supabase rows using the shared matcher.
// Auto-discovered publications historically only carried a scalar member_id and
// left member_author_ids empty; manual rows can also be stale. This unions the
// detected members into member_author_ids (never removes an existing tag).
//
// Dry run:  npx tsx scripts/backfill-member-tags.ts
// Apply:    npx tsx scripts/backfill-member-tags.ts --apply
import { createClient } from "@supabase/supabase-js";
import * as path from "path";
import * as dotenv from "dotenv";
import { matchMemberAuthors } from "../src/lib/memberMatch";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const APPLY = process.argv.includes("--apply");

async function backfill(supabase: ReturnType<typeof createClient>, table: string) {
  const { data, error } = await supabase
    .from(table)
    .select("id, authors, member_author_ids");
  if (error) {
    console.error(`${table}: read failed - ${error.message}`);
    return;
  }
  const rows = data ?? [];
  let changed = 0;
  for (const row of rows as Array<{ id: string; authors: string[] | null; member_author_ids: string[] | null }>) {
    const authors = row.authors ?? [];
    const tagged = row.member_author_ids ?? [];
    const detected = matchMemberAuthors(authors);
    const added = detected.filter((d) => !tagged.includes(d));
    if (added.length === 0) continue;
    changed++;
    const union = [...tagged, ...added];
    console.log(`  [${row.id}] +[${added.join(", ")}]  (${tagged.length}->${union.length})`);
    if (APPLY) {
      const { error: upErr } = await supabase
        .from(table)
        .update({ member_author_ids: union } as never)
        .eq("id", row.id);
      if (upErr) console.error(`    update failed: ${upErr.message}`);
    }
  }
  console.log(`${table}: ${changed} row(s) ${APPLY ? "updated" : "would change"} of ${rows.length}\n`);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(url, key);
  console.log(APPLY ? "APPLYING changes\n" : "DRY RUN (pass --apply to write)\n");
  await backfill(supabase, "publications");
  await backfill(supabase, "abstracts");
}

main();
