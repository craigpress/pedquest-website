/**
 * One-off repair (2026-09-14): the scanner used to take the LAST
 * <ArticleId IdType="pubmed"> in the PubMed record, which for any paper with
 * a reference list is the last CITED paper's PMID. 18 of 46 auto-discovered
 * rows were keyed on a wrong PMID (and DOI/PMCID). This script re-resolves
 * each scanner row by title, verifies the fetched title matches, and updates
 * id/pmid/doi/pmcid in place, plus the matching publication_update_log rows
 * so the dedup set keys on the real PMID.
 *
 *   npx tsx scripts/fix-scanner-pmids.ts            # dry run
 *   npx tsx scripts/fix-scanner-pmids.ts --apply
 */
import { createClient } from "@supabase/supabase-js";
import { fetchArticleByPmid } from "../src/lib/pubmed";
import { loadEnvLocal, supabaseCredentials } from "./_env";

loadEnvLocal();
const apply = process.argv.includes("--apply");
const E = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/<[^>]*>/g, "").replace(/[^a-z0-9]+/g, " ").trim();

async function esearch(term: string): Promise<string[]> {
  const res = await fetch(`${E}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(term)}&retmax=5&retmode=xml`);
  const xml = await res.text();
  return [...xml.matchAll(/<Id>(\d+)<\/Id>/g)].map((m) => m[1]);
}

// Full title first; long titles with subtitles miss, so fall back to the first
// five words plus the first author's surname.
async function searchByTitle(title: string, firstAuthor?: string): Promise<string[]> {
  const words = title.replace(/[^\w\s-]/g, " ").split(/\s+/).filter(Boolean);
  const ids = await esearch(`${words.join(" ")}[Title]`);
  if (ids.length > 0 || !firstAuthor) return ids;
  await sleep(400);
  return esearch(`${words.slice(0, 5).join(" ")}[Title] AND ${firstAuthor.split(" ")[0]}[Author]`);
}

async function main() {
  const { url, key } = supabaseCredentials();
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from("publications")
    .select("id,pmid,doi,pmcid,title,authors")
    .not("discovered_at", "is", null)
    .order("discovered_at");
  if (error) throw new Error(error.message);
  const { data: allRows } = await supabase.from("publications").select("id,pmid");
  const pmidOwner = new Map((allRows ?? []).map((r) => [String(r.pmid), r.id]));

  let ok = 0, fixed = 0, unresolved = 0;
  for (const row of data ?? []) {
    await sleep(400);
    const stored = await fetchArticleByPmid(String(row.pmid));
    if (stored && norm(stored.title) === norm(row.title)) { ok++; continue; }

    await sleep(400);
    const candidates = await searchByTitle(row.title, (row.authors as string[] | null)?.[0]);
    let article = null;
    for (const c of candidates) {
      await sleep(400);
      const a = await fetchArticleByPmid(c);
      if (a && norm(a.title) === norm(row.title)) { article = a; break; }
    }
    if (!article) {
      unresolved++;
      console.log(`UNRESOLVED ${row.id}: ${row.title.slice(0, 70)}`);
      continue;
    }

    const owner = pmidOwner.get(article.pmid);
    if (owner && owner !== row.id) {
      // The real paper is already in the table under its correct PMID: this row is a duplicate.
      console.log(`DUPLICATE ${row.id} -> real PMID ${article.pmid} already stored as ${owner}; deleting`);
      if (apply) {
        const { error: delErr } = await supabase.from("publications").delete().eq("id", row.id);
        if (delErr) throw new Error(delErr.message);
      }
      fixed++;
      continue;
    }

    console.log(`FIX ${row.id}: pmid ${row.pmid} -> ${article.pmid}, doi ${row.doi ?? "-"} -> ${article.doi ?? "-"} | ${row.title.slice(0, 60)}`);
    if (apply) {
      const { error: upErr } = await supabase
        .from("publications")
        .update({ id: `auto-${article.pmid}`, pmid: article.pmid, doi: article.doi ?? null, pmcid: article.pmcid ?? null })
        .eq("id", row.id);
      if (upErr) throw new Error(`${row.id}: ${upErr.message}`);
      const { error: logErr } = await supabase
        .from("publication_update_log")
        .update({ pmid: article.pmid })
        .eq("pmid", String(row.pmid))
        .eq("action", "auto_discovered");
      if (logErr) throw new Error(`log ${row.id}: ${logErr.message}`);
    }
    fixed++;
  }
  console.log(`\n${apply ? "applied" : "dry run"}: ${ok} correct, ${fixed} fixed, ${unresolved} unresolved`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
