// Evidence retrieval for the question-bank generator.
//
// Every number a drafted item states has to appear in a real abstract
// (STYLE_GUIDE §2), so the pipeline retrieves first and drafts second: PubMed
// esearch narrows to pediatric/neonatal qEEG work for the topic, efetch pulls
// the abstracts, and only those abstracts are put in front of the model.
//
// No API key is required; NCBI asks for ≤ 3 requests/second without one, so
// calls are serialized with a delay.
const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const DELAY_MS = 400;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Domain-specific query scaffolding, so "asymmetry" does not return adult
 *  stroke trials and "aEEG" does not return sheep models. */
const DOMAIN_FILTERS: Record<string, string> = {
  foundations:
    '(quantitative EEG[tiab] OR "amplitude-integrated EEG"[tiab] OR spectrogram[tiab] OR "density spectral array"[tiab])',
  seizure_detection:
    '(seizure detection[tiab] OR "seizure identification"[tiab] OR "quantitative EEG"[tiab] OR "amplitude-integrated EEG"[tiab])',
  background_terminology:
    '("EEG background"[tiab] OR "burst suppression"[tiab] OR terminology[tiab] OR "amplitude-integrated EEG"[tiab])',
  clinical_prognosis:
    '(prognosis[tiab] OR outcome[tiab] OR "seizure burden"[tiab] OR mortality[tiab])',
  monitoring_practice:
    '("continuous EEG"[tiab] OR monitoring[tiab] OR guideline[tiab] OR consensus[tiab])',
  special_populations_pitfalls:
    '(artifact[tiab] OR sedation[tiab] OR hypothermia[tiab] OR ECMO[tiab] OR pitfall[tiab])',
};

const PEDIATRIC_FILTER =
  '(infant[mh] OR child[mh] OR adolescent[mh] OR neonat*[tiab] OR pediatric[tiab] OR paediatric[tiab] OR children[tiab])';

export interface RetrievedArticle {
  pmid: string;
  title: string;
  journal: string;
  year: number;
  firstAuthor: string;
  abstract: string;
}

export interface RetrievalResult {
  query: string;
  pmids: string[];
  articles: RetrievedArticle[];
  /** set when PubMed was unreachable or returned nothing usable */
  error?: string;
}

/** Words that carry no search signal in a learning-objective sentence. */
const TOPIC_STOP = new Set([
  "effects", "outcome", "outcomes", "timing", "assessment", "categories", "category",
  "study", "studies", "data", "review", "under", "with", "from", "their", "each",
  "into", "when", "what", "which", "using", "used", "type", "types", "and", "the",
  "create", "write", "question", "clinical", "concept", "learner", "level", "introductory",
  "intermediate", "advanced", "distinguishing", "distinguish", "appropriate", "original",
  "synthetic", "image", "emphasize", "avoid", "unsupported", "numeric", "thresholds",
]);

function topicTerms(topic: string): string[] {
  return topic
    .replace(/[^A-Za-z0-9\s/-]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 3 && !TOPIC_STOP.has(w.toLowerCase()));
}

/**
 * Three queries, narrowest first. A learning objective is a sentence, not a
 * search string: ANDing every word together reliably returns nothing, so the
 * broad forms are what actually retrieve most of the time.
 */
export function buildQueries(domain: string, topic: string): string[] {
  const domainFilter = DOMAIN_FILTERS[domain] ?? '("quantitative EEG"[tiab] OR electroencephalography[mh])';
  const terms = topicTerms(topic);
  const narrow = terms.slice(0, 3).map((w) => `${w}[tiab]`).join(" AND ");
  const broad = terms.slice(0, 8).map((w) => `${w}[tiab]`).join(" OR ");

  const queries: string[] = [];
  if (narrow) queries.push(`(${narrow}) AND ${domainFilter} AND ${PEDIATRIC_FILTER}`);
  if (broad) queries.push(`(${broad}) AND ${domainFilter} AND ${PEDIATRIC_FILTER}`);
  queries.push(`${domainFilter} AND ${PEDIATRIC_FILTER}`);
  return queries;
}

/** The narrowest query, kept for callers that just want to show the search. */
export function buildQuery(domain: string, topic: string): string {
  return buildQueries(domain, topic)[0];
}

function xmlText(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1].replace(/<[^>]*>/g, "").trim() : "";
}

function parseArticle(xml: string): RetrievedArticle | null {
  const pmid = xml.match(/<PMID[^>]*>(\d+)<\/PMID>/i)?.[1];
  if (!pmid) return null;
  // AbstractText can be split into labelled sections; concatenate them.
  const parts = [...xml.matchAll(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/gi)]
    .map((m) => m[1].replace(/<[^>]*>/g, "").trim())
    .filter(Boolean);
  const lastName = xmlText(xml.match(/<Author[^>]*>[\s\S]*?<\/Author>/i)?.[0] ?? "", "LastName");
  const initials = xmlText(xml.match(/<Author[^>]*>[\s\S]*?<\/Author>/i)?.[0] ?? "", "Initials");
  const yearStr = xml.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/i)?.[1]
    ?? xml.match(/<MedlineDate>(\d{4})/)?.[1]
    ?? "0";
  return {
    pmid,
    title: xmlText(xml, "ArticleTitle"),
    journal: xmlText(xml, "Title"),
    year: parseInt(yearStr, 10) || 0,
    firstAuthor: [lastName, initials].filter(Boolean).join(" "),
    abstract: parts.join(" "),
  };
}

/**
 * esearch + efetch for one (domain, topic). `retmax` caps how many abstracts
 * reach the model — more context is not better here, it dilutes the numbers we
 * want the item anchored to.
 */
export async function retrieveEvidence(
  domain: string,
  topic: string,
  retmax = 6,
): Promise<RetrievalResult> {
  const queries = buildQueries(domain, topic);
  let lastError = "no PubMed hits";
  let lastQuery = queries[0];

  for (const query of queries) {
    lastQuery = query;
    try {
      const searchUrl =
        `${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&sort=relevance&retmax=${retmax}` +
        `&term=${encodeURIComponent(query)}`;
      const searchRes = await fetch(searchUrl);
      if (!searchRes.ok) { lastError = `esearch returned ${searchRes.status}`; continue; }
      const searchJson = (await searchRes.json()) as { esearchresult?: { idlist?: string[] } };
      const pmids = searchJson.esearchresult?.idlist ?? [];
      if (pmids.length === 0) { lastError = "no PubMed hits for this query"; await sleep(DELAY_MS); continue; }

      await sleep(DELAY_MS);
      const fetchUrl = `${EUTILS}/efetch.fcgi?db=pubmed&retmode=xml&id=${pmids.join(",")}`;
      const fetchRes = await fetch(fetchUrl);
      if (!fetchRes.ok) { lastError = `efetch returned ${fetchRes.status}`; continue; }
      const xml = await fetchRes.text();

      const articles = [...xml.matchAll(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/gi)]
        .map((m) => parseArticle(m[1]))
        .filter((a): a is RetrievedArticle => !!a && a.abstract.length > 200);

      if (articles.length === 0) { lastError = "hits had no usable abstracts"; continue; }
      return { query, pmids, articles };
    } catch (e) {
      return { query, pmids: [], articles: [], error: `PubMed unreachable: ${(e as Error).message}` };
    }
  }
  return { query: lastQuery, pmids: [], articles: [], error: lastError };
}

/** Compact abstract block for the draft prompt. */
export function formatEvidence(articles: RetrievedArticle[]): string {
  return articles
    .map(
      (a, i) =>
        `[${i + 1}] PMID ${a.pmid} — ${a.firstAuthor}, ${a.journal} ${a.year}\n` +
        `Title: ${a.title}\nAbstract: ${a.abstract}`,
    )
    .join("\n\n");
}

/** Vancouver-ish citation string for a reference row. */
export function citationFor(a: RetrievedArticle): string {
  return `${a.firstAuthor}${a.firstAuthor ? ", et al. " : ""}${a.title} ${a.journal}. ${a.year}. PMID: ${a.pmid}`.trim();
}
