// Pull the specific articles an editor NAMED in their prompt.
//
// The generator's evidence rule is that every number in a drafted item must
// appear in a retrieved abstract, and the reference guard rejects any PMID the
// model produces that was not retrieved.  That guard is right, but until now
// the only way an abstract got retrieved was a topic search - so an editor who
// wrote "use PMID 28555777" or "ground this on doi:10.1111/epi.16815" was
// asking for a paper the pipeline never fetched, and the draft was rejected
// for citing it.  (That is exactly how the FIRES prompt failed on 2026-09-11.)
//
// This module reads identifiers out of the prompt text and fetches those
// records directly, so a named paper becomes first-class evidence.

import { parseArticles, type RetrievedArticle } from "./retrieve";

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const IDCONV = "https://www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/";
const DELAY_MS = 400;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface CitedIds {
  pmids: string[];
  dois: string[];
  pmcids: string[];
}

/**
 * Identifiers an editor wrote in free text.
 *
 * Deliberately conservative: a bare 8-digit number is NOT treated as a PMID,
 * because prompts are full of years, durations and microvolt values. The
 * number has to be introduced by "PMID"/"pubmed", or be a real DOI/PMCID.
 */
export function parseCitedIds(text: string): CitedIds {
  const pmids = new Set<string>();
  const dois = new Set<string>();
  const pmcids = new Set<string>();

  // "PMID 12345678", "PMID: 12345678", "pmid=12345678", and lists after one label
  for (const m of text.matchAll(/\bpmids?\b[\s:=#]*((?:\d{7,8}[\s,;/&and]*)+)/gi)) {
    for (const n of m[1].matchAll(/\d{7,8}/g)) pmids.add(n[0]);
  }
  // pubmed.ncbi.nlm.nih.gov/12345678
  for (const m of text.matchAll(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{7,8})/gi)) pmids.add(m[1]);

  // DOIs - stop before trailing punctuation that is almost always prose
  for (const m of text.matchAll(/\b(10\.\d{4,9}\/[^\s"'<>,;)\]]+)/gi)) {
    dois.add(m[1].replace(/[.,;:)\]]+$/, ""));
  }
  for (const m of text.matchAll(/\bPMC(\d{6,8})\b/gi)) pmcids.add(`PMC${m[1]}`);

  return { pmids: [...pmids], dois: [...dois], pmcids: [...pmcids] };
}

export function hasCitedIds(ids: CitedIds): boolean {
  return ids.pmids.length + ids.dois.length + ids.pmcids.length > 0;
}

/** Map DOIs / PMCIDs onto PMIDs through the NCBI ID converter. */
async function toPmids(ids: string[]): Promise<{ pmids: string[]; unresolved: string[] }> {
  if (ids.length === 0) return { pmids: [], unresolved: [] };
  const url = `${IDCONV}?tool=pedquest&email=info%40pedquest.org&format=json&ids=${encodeURIComponent(ids.join(","))}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return { pmids: [], unresolved: ids };
    const json = (await res.json()) as { records?: { pmid?: string; doi?: string; pmcid?: string; status?: string }[] };
    const out: string[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const rec = (json.records ?? []).find(
        (r) => r.doi?.toLowerCase() === id.toLowerCase() || r.pmcid?.toLowerCase() === id.toLowerCase(),
      );
      // the converter returns pmid as a JSON number for some records, which
      // would not dedupe against the strings parsed out of the prompt
      if (rec?.pmid) out.push(String(rec.pmid));
      else missing.push(id);
    }
    return { pmids: out, unresolved: missing };
  } catch {
    return { pmids: [], unresolved: ids };
  }
}

/** efetch a specific list of PMIDs. Abstract length is NOT filtered here: the
 *  editor asked for this paper by name, so a short abstract still counts. */
export async function fetchByPmids(pmids: string[]): Promise<RetrievedArticle[]> {
  if (pmids.length === 0) return [];
  const res = await fetch(`${EUTILS}/efetch.fcgi?db=pubmed&retmode=xml&id=${pmids.join(",")}`);
  if (!res.ok) return [];
  return parseArticles(await res.text(), 0);
}

export interface CitedResult {
  articles: RetrievedArticle[];
  /** identifiers that were asked for but could not be fetched */
  unresolved: string[];
}

/**
 * Fetch every article the prompt named. Returns what resolved and what did
 * not, so the caller can tell the editor plainly rather than silently
 * dropping a paper they asked for.
 */
export async function fetchCitedArticles(text: string): Promise<CitedResult> {
  const ids = parseCitedIds(text);
  if (!hasCitedIds(ids)) return { articles: [], unresolved: [] };

  const converted = await toPmids([...ids.dois, ...ids.pmcids]);
  if (ids.dois.length || ids.pmcids.length) await sleep(DELAY_MS);

  const wanted = [...new Set([...ids.pmids, ...converted.pmids])];
  const articles = await fetchByPmids(wanted);
  const got = new Set(articles.map((a) => a.pmid));

  return {
    articles,
    unresolved: [...converted.unresolved, ...wanted.filter((p) => !got.has(p))],
  };
}
