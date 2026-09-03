/**
 * One-time reconciliation: make the Supabase `members` table the source of
 * truth, merging it with the two files that had drifted from it.
 *
 * The table held an abandoned 2026-03-25 seed (65 rows, never updated) while
 * src/data/members.ts became the working source (69 members). Rather than
 * delete the difference, every row gets a status:
 *
 *   active   <- src/data/members.ts          (what the site shows)
 *   archived <- src/data/archived-members.ts (retired 2026-04-05)
 *   review   <- in the old snapshot only     (parked for triage; these are
 *                still referenced by memberMatch.ts for publication tagging)
 *
 * After this, src/data/members.generated.ts is produced FROM the table by
 * scripts/generate-members.ts at build time.
 *
 *   npx tsx scripts/seed-members.ts --check   # report, write nothing
 *   npx tsx scripts/seed-members.ts           # apply
 *
 * Idempotent: upserts on id, so re-running is safe.
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, supabaseCredentials } from "./_env";
import { members } from "../src/data/members";
import { archivedMembers } from "../src/data/archived-members";

loadEnvLocal();
const { url, key } = supabaseCredentials();

const supabase = createClient(url, key, { auth: { persistSession: false } });
const checkOnly = process.argv.includes("--check");

type Loose = Record<string, unknown>;

/** Map a Member-shaped object to table columns. Archived entries omit some
 *  optional fields, so anything absent falls back rather than throwing. */
function toRow(m: Loose, status: string): Loose {
  return {
    id: m.id,
    name: m.name,
    title: m.title ?? "",
    role: m.role ?? null,
    institution: m.institution ?? "",
    department: m.department ?? null,
    country: m.country ?? "USA",
    city: m.city ?? "",
    lat: typeof m.lat === "number" ? m.lat : null,
    lng: typeof m.lng === "number" ? m.lng : null,
    bio: m.bio ?? "",
    photo_url: m.photoUrl ?? null,
    orcid_id: m.orcidId ?? null,
    interests: Array.isArray(m.interests) ? m.interests : [],
    email: m.email ?? null,
    auth_email: m.authEmail ?? null,
    website_url: m.websiteUrl ?? null,
    is_leadership: m.isLeadership === true,
    leadership_role: m.leadershipRole ?? null,
    sort_order: typeof m.sortOrder === "number" ? m.sortOrder : 999,
    status,
  };
}

async function main() {
  const activeRows = (members as unknown as Loose[]).map((m) => toRow(m, "active"));
  const archivedRows = (archivedMembers as unknown as Loose[]).map((m) => toRow(m, "archived"));

  const activeIds = new Set(activeRows.map((r) => r.id as string));
  const archivedIds = new Set(archivedRows.map((r) => r.id as string));

  const overlap = [...archivedIds].filter((id) => activeIds.has(id));
  if (overlap.length) {
    throw new Error(`Ids appear in BOTH the active and archived files: ${overlap.join(", ")}`);
  }

  const { data: existing, error: readErr } = await supabase.from("members").select("id, status");
  if (readErr) throw new Error(`Read failed: ${readErr.message}`);

  // Guard: once the reconciliation has run the TABLE is the source of truth and
  // these files are frozen snapshots. Re-running would silently undo later admin
  // edits - e.g. re-archiving someone who has since been restored.
  const alreadyReconciled = (existing ?? []).some((r) => r.status !== "active");
  if (alreadyReconciled && !process.argv.includes("--force") && !checkOnly) {
    throw new Error(
      "The members table already carries statuses, so it has been reconciled and is now the source of truth. " +
        "Re-running would overwrite admin edits from the stale files. Pass --force only if you really mean to."
    );
  }

  // In the old snapshot but in neither file - do not assume retired.
  const reviewIds = (existing ?? [])
    .map((r) => r.id as string)
    .filter((id) => !activeIds.has(id) && !archivedIds.has(id));

  console.log(`active   (members.ts)          : ${activeRows.length}`);
  console.log(`archived (archived-members.ts) : ${archivedRows.length}`);
  console.log(`review   (snapshot only)       : ${reviewIds.length}`);
  if (reviewIds.length) console.log(`  ${reviewIds.join(", ")}`);
  console.log(`table currently holds          : ${(existing ?? []).length}`);
  console.log(`table after apply              : ${activeIds.size + archivedIds.size + reviewIds.length}`);

  if (checkOnly) {
    console.log("\n--check: nothing written.");
    return;
  }

  for (const [label, rows] of [
    ["active", activeRows],
    ["archived", archivedRows],
  ] as const) {
    for (let i = 0; i < rows.length; i += 25) {
      const chunk = rows.slice(i, i + 25);
      const { error } = await supabase.from("members").upsert(chunk, { onConflict: "id" });
      if (error) throw new Error(`Upsert (${label}) failed at row ${i}: ${error.message}`);
    }
    console.log(`upserted ${rows.length} ${label}`);
  }

  if (reviewIds.length) {
    const { error } = await supabase.from("members").update({ status: "review" }).in("id", reviewIds);
    if (error) throw new Error(`Marking review rows failed: ${error.message}`);
    console.log(`marked ${reviewIds.length} review`);
  }

  const { data: final } = await supabase.from("members").select("status");
  const tally = (final ?? []).reduce<Record<string, number>>((acc, r) => {
    const s = r.status as string;
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});
  console.log("\ndone:", JSON.stringify(tally));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
