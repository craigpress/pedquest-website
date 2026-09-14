/**
 * Build step: regenerate src/data/publications.generated.ts from the Supabase
 * `publications` table.
 *
 * The publications page is a client component that renders a static module,
 * so this is how a row the PubMed scanner (or /admin) writes becomes a
 * deployed page. Runs as `prebuild`; the scanner also fires a Vercel deploy
 * hook when it persists new papers, so the site rebuilds itself.
 *
 *   npx tsx scripts/generate-publications.ts          # write the file
 *   npx tsx scripts/generate-publications.ts --check  # fail if it would change
 *
 * If Supabase is unreachable the committed file is left untouched and the
 * build continues — the committed snapshot is always a valid fallback.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { loadEnvLocal, supabaseCredentials } from "./_env";

const OUT = "src/data/publications.generated.ts";

loadEnvLocal();

type Row = {
  id: string;
  pmid: string | null;
  pmcid: string | null;
  doi: string | null;
  title: string;
  authors: string[] | null;
  member_author_ids: string[] | null;
  journal: string | null;
  year: number | null;
  month: number | null;
  abstract: string | null;
  pub_type: string | null;
  categories: string[] | null;
  keywords: string[] | null;
  is_member_paper: boolean | null;
  patient_population: string | null;
};

const PUB_TYPES = new Set(["article", "conference_abstract", "review", "case_report"]);

// The scanner stores PubMed's "journal-article"; the site's union type says "article".
function pubType(v: string | null): string {
  if (v && PUB_TYPES.has(v)) return v;
  return "article";
}

const j = (v: unknown) => JSON.stringify(v);

function render(rows: Row[]): string {
  const entries = rows.map((r) => {
    const lines = [
      `    id: ${j(r.id)},`,
      r.pmid ? `    pmid: ${j(String(r.pmid))},` : null,
      r.pmcid ? `    pmcid: ${j(r.pmcid)},` : null,
      r.doi ? `    doi: ${j(r.doi)},` : null,
      `    title: ${j(r.title)},`,
      `    authors: ${j(r.authors ?? [])},`,
      `    memberAuthorIds: ${j(r.member_author_ids ?? [])},`,
      `    journal: ${j(r.journal ?? "")},`,
      `    year: ${r.year ?? 0},`,
      r.month ? `    month: ${r.month},` : null,
      r.abstract ? `    abstract: ${j(r.abstract)},` : null,
      `    pubType: ${j(pubType(r.pub_type))},`,
      `    categories: ${j(r.categories ?? [])},`,
      `    keywords: ${j(r.keywords ?? [])},`,
      `    isMemberPaper: ${r.is_member_paper !== false},`,
      r.patient_population ? `    patientPopulation: ${j(r.patient_population)},` : null,
    ].filter(Boolean);
    return `  {\n${lines.join("\n")}\n  }`;
  });

  return [
    "// GENERATED FILE - DO NOT EDIT BY HAND.",
    "//",
    "// Produced by scripts/generate-publications.ts from the Supabase",
    "// `publications` table during `prebuild`. The PubMed scanner and /admin",
    "// write that table; hand edits here are overwritten on the next build.",
    "//",
    `// ${rows.length} publications.`,
    "",
    'import type { Publication } from "./publications";',
    "",
    "export const publications: Publication[] = [",
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
    console.warn(`[generate-publications] ${(e as Error).message} - keeping the committed file.`);
    return;
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from("publications")
    .select("*")
    .order("year", { ascending: false, nullsFirst: false })
    .order("month", { ascending: false, nullsFirst: false })
    .order("title", { ascending: true })
    .limit(5000);

  if (error) {
    console.warn(`[generate-publications] Supabase read failed (${error.message}) - keeping the committed file.`);
    return;
  }
  const rows = (data ?? []) as Row[];

  // A wipe or a bad filter must not silently empty the site.
  if (rows.length < 100) {
    throw new Error(`Refusing to generate: the table returned only ${rows.length} publications.`);
  }

  const next = render(rows);
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";

  if (next === current) {
    console.log(`[generate-publications] ${rows.length} publications - no change.`);
    return;
  }

  if (checkOnly) {
    console.error(`[generate-publications] ${OUT} is out of date (${rows.length} publications).`);
    process.exit(1);
  }

  writeFileSync(OUT, next, "utf8");
  console.log(`[generate-publications] wrote ${OUT} (${rows.length} publications).`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
