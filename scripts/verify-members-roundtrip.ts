/**
 * Compare the generated members module against a reference copy of the old
 * hand-maintained members.ts, field by field, so the file -> Supabase ->
 * file round-trip can be proven lossless.
 *
 *   npx tsx scripts/verify-members-roundtrip.ts <path-to-old-members.ts>
 *
 * Kept in the repo because the same check is worth re-running after any future
 * bulk edit of the members table.
 */
import { members as generated } from "../src/data/members";

type Loose = Record<string, unknown>;

const FIELDS = [
  "id", "name", "title", "role", "institution", "department", "country", "city",
  "lat", "lng", "bio", "photoUrl", "orcidId", "interests", "email", "authEmail",
  "websiteUrl", "isLeadership", "leadershipRole", "sortOrder",
] as const;

/** Treat undefined, null and "" as the same absence; compare arrays by value. */
function same(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => (v === undefined || v === null || v === "" ? null : v);
  const x = norm(a), y = norm(b);
  if (Array.isArray(x) && Array.isArray(y)) return JSON.stringify(x) === JSON.stringify(y);
  return x === y;
}

async function main() {
  const refPath = process.argv[2];
  if (!refPath) throw new Error("Usage: verify-members-roundtrip.ts <path-to-old-members.ts>");

  const ref = (await import(refPath)) as { members: Loose[] };
  const before = ref.members;
  const after = generated as unknown as Loose[];

  console.log(`before: ${before.length}   after: ${after.length}`);

  const afterById = new Map(after.map((m) => [m.id as string, m]));
  let problems = 0;

  for (const b of before) {
    const a = afterById.get(b.id as string);
    if (!a) {
      console.log(`MISSING  ${b.id}`);
      problems++;
      continue;
    }
    for (const f of FIELDS) {
      if (!same(b[f], a[f])) {
        console.log(`DIFF     ${b.id}.${f}: ${JSON.stringify(b[f])} -> ${JSON.stringify(a[f])}`);
        problems++;
      }
    }
  }

  const extra = after.filter((a) => !before.some((b) => b.id === a.id));
  for (const e of extra) {
    console.log(`EXTRA    ${e.id}`);
    problems++;
  }

  console.log(problems === 0 ? "\nOK - round-trip is lossless." : `\n${problems} problem(s).`);
  process.exit(problems === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
