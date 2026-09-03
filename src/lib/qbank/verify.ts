// PMID verification via PubMed esummary.
//
// A reference is only marked `verified` when PubMed returns a record AND the
// citation's first author and year match it — a resolving PMID attached to the
// wrong citation is exactly the mistake the style guide is guarding against.
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const DELAY_MS = 400;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface PmidRecord {
  pmid: string;
  exists: boolean;
  title?: string;
  journal?: string;
  year?: number;
  firstAuthor?: string;
  error?: string;
}

/** One esummary lookup. Never throws — a network failure comes back as an error field. */
export async function verifyPmid(pmid: string): Promise<PmidRecord> {
  const clean = String(pmid).trim();
  if (!/^\d{6,9}$/.test(clean)) {
    return { pmid: clean, exists: false, error: "not a PMID (expected 6-9 digits)" };
  }
  try {
    const res = await fetch(`${EUTILS}/esummary.fcgi?db=pubmed&retmode=json&id=${clean}`);
    if (!res.ok) return { pmid: clean, exists: false, error: `esummary returned ${res.status}` };
    const json = (await res.json()) as {
      result?: Record<string, {
        uid?: string; title?: string; source?: string; pubdate?: string;
        authors?: { name?: string }[]; error?: string;
      }>;
    };
    const rec = json.result?.[clean];
    if (!rec || rec.error || !rec.uid) {
      return { pmid: clean, exists: false, error: rec?.error ?? "no record" };
    }
    return {
      pmid: clean,
      exists: true,
      title: rec.title,
      journal: rec.source,
      year: parseInt((rec.pubdate ?? "").slice(0, 4), 10) || undefined,
      firstAuthor: rec.authors?.[0]?.name,
    };
  } catch (e) {
    return { pmid: clean, exists: false, error: `PubMed unreachable: ${(e as Error).message}` };
  }
}

/** Serialized lookups, polite to NCBI's 3 req/s guidance. */
export async function verifyPmids(pmids: string[]): Promise<Map<string, PmidRecord>> {
  const out = new Map<string, PmidRecord>();
  for (const pmid of [...new Set(pmids.map(String))]) {
    if (out.size > 0) await sleep(DELAY_MS);
    out.set(pmid, await verifyPmid(pmid));
  }
  return out;
}

/**
 * Does the citation text agree with the PubMed record? Compares the first
 * author's surname and the year — enough to catch a transposed PMID without
 * being brittle about citation style.
 */
export function citationMatches(citation: string, record: PmidRecord): { ok: boolean; reason?: string } {
  if (!record.exists) return { ok: false, reason: record.error ?? "PMID does not resolve" };
  const text = citation.toLowerCase();
  const surname = (record.firstAuthor ?? "").split(/\s+/)[0]?.toLowerCase();
  if (surname && surname.length > 2 && !text.includes(surname)) {
    return { ok: false, reason: `citation does not name the first author (${record.firstAuthor})` };
  }
  if (record.year && !text.includes(String(record.year))) {
    return { ok: false, reason: `citation does not contain the publication year (${record.year})` };
  }
  return { ok: true };
}

/** A short, human-readable line for the editor console's verify button. */
export function describeRecord(record: PmidRecord): string {
  if (!record.exists) return `PMID ${record.pmid}: ${record.error ?? "not found"}`;
  return `PMID ${record.pmid}: ${record.firstAuthor ?? "?"} — ${record.title ?? "?"} (${record.journal ?? "?"} ${record.year ?? "?"})`;
}
