/**
 * Build step: regenerate src/data/members.generated.ts from the Supabase
 * `members` table (status = 'active').
 *
 * The site renders members from a static module because six of the ten
 * consumers are client components. Supabase is the source of truth; this
 * script is how an admin edit becomes a deployed page. Runs as `prebuild`,
 * so every Vercel deploy picks up whatever the table currently holds.
 *
 *   npx tsx scripts/generate-members.ts          # write the file
 *   npx tsx scripts/generate-members.ts --check  # fail if it would change
 *
 * If Supabase is unreachable the existing committed file is left untouched
 * and the build continues — a deploy must not fail because the database
 * blinked, and the committed snapshot is always a valid fallback.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadEnvLocal, supabaseCredentials } from "./_env";

const OUT = "src/data/members.generated.ts";

loadEnvLocal();

type Row = {
  id: string;
  name: string;
  title: string | null;
  role: string | null;
  institution: string | null;
  department: string | null;
  country: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  bio: string | null;
  photo_url: string | null;
  orcid_id: string | null;
  interests: string[] | null;
  email: string | null;
  auth_email: string | null;
  website_url: string | null;
  is_leadership: boolean | null;
  leadership_role: string | null;
  sort_order: number | null;
};

const j = (v: unknown) => JSON.stringify(v);

function render(rows: Row[]): string {
  const entries = rows.map((r) => {
    const lines = [
      `    id: ${j(r.id)},`,
      `    name: ${j(r.name)},`,
      `    title: ${j(r.title ?? "")},`,
      r.role ? `    role: ${j(r.role)},` : null,
      `    institution: ${j(r.institution ?? "")},`,
      r.department ? `    department: ${j(r.department)},` : null,
      `    country: ${j(r.country ?? "USA")},`,
      `    city: ${j(r.city ?? "")},`,
      `    lat: ${r.lat ?? 0},`,
      `    lng: ${r.lng ?? 0},`,
      `    bio: ${j(r.bio ?? "")},`,
      r.photo_url ? `    photoUrl: ${j(r.photo_url)},` : null,
      r.orcid_id ? `    orcidId: ${j(r.orcid_id)},` : null,
      `    interests: ${j(r.interests ?? [])},`,
      r.email ? `    email: ${j(r.email)},` : null,
      r.auth_email ? `    authEmail: ${j(r.auth_email)},` : null,
      r.website_url ? `    websiteUrl: ${j(r.website_url)},` : null,
      `    isLeadership: ${r.is_leadership === true},`,
      r.leadership_role ? `    leadershipRole: ${j(r.leadership_role)},` : null,
      `    sortOrder: ${r.sort_order ?? 999},`,
    ].filter(Boolean);
    return `  {\n${lines.join("\n")}\n  }`;
  });

  return [
    "// GENERATED FILE - DO NOT EDIT BY HAND.",
    "//",
    "// Produced by scripts/generate-members.ts from the Supabase `members`",
    "// table (status = 'active') during `prebuild`. To change a member, edit",
    "// them in /admin and redeploy; hand edits here are overwritten.",
    "//",
    `// ${rows.length} active members.`,
    "",
    'import type { Member } from "./member-types";',
    "",
    "export const members: Member[] = [",
    entries.join(",\n"),
    "];",
    "",
  ].join("\n");
}

async function main() {
  const checkOnly = process.argv.includes("--check");

  let url: string, key: string;
  try {
    ({ url, key } = supabaseCredentials());
  } catch (e) {
    console.warn(`[generate-members] ${(e as Error).message} - keeping the committed file.`);
    return;
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from("members")
    .select("*")
    .eq("status", "active")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    console.warn(`[generate-members] Supabase read failed (${error.message}) - keeping the committed file.`);
    return;
  }
  const rows = (data ?? []) as Row[];

  // A wipe or a bad filter must not silently empty the site.
  if (rows.length === 0) {
    throw new Error("Refusing to generate: the table returned 0 active members.");
  }

  const next = render(rows);
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";

  if (next === current) {
    console.log(`[generate-members] ${rows.length} active members - no change.`);
    return;
  }

  if (checkOnly) {
    console.error(`[generate-members] ${OUT} is out of date (${rows.length} active members).`);
    process.exit(1);
  }

  writeFileSync(OUT, next, "utf8");
  console.log(`[generate-members] wrote ${OUT} (${rows.length} active members).`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
