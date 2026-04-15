const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

export function extractText(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : "";
}

export function extractAll(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const results: string[] = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

export function parseAuthors(xml: string): { authors: string[]; affiliations: string[] } {
  const authorListMatch = xml.match(/<AuthorList[^>]*>([\s\S]*?)<\/AuthorList>/i);
  if (!authorListMatch) return { authors: [], affiliations: [] };

  const authorBlocks = authorListMatch[1].match(/<Author[^>]*>[\s\S]*?<\/Author>/gi) || [];
  const authors: string[] = [];
  const affiliations: string[] = [];

  for (const block of authorBlocks) {
    const lastName = extractText(block, "LastName");
    const initials = extractText(block, "Initials");
    if (lastName && initials) {
      authors.push(`${lastName} ${initials}`);
    }
    const affiliation = extractText(block, "Affiliation");
    if (affiliation) {
      affiliations.push(affiliation);
    }
  }

  return { authors, affiliations };
}

export function parseMeshTerms(xml: string): string[] {
  const meshListMatch = xml.match(/<MeshHeadingList>([\s\S]*?)<\/MeshHeadingList>/i);
  if (!meshListMatch) return [];
  return extractAll(meshListMatch[1], "DescriptorName");
}

export function parseKeywords(xml: string): string[] {
  const keywordListMatch = xml.match(/<KeywordList[^>]*>([\s\S]*?)<\/KeywordList>/i);
  if (!keywordListMatch) return [];
  return extractAll(keywordListMatch[1], "Keyword");
}

export function parsePublicationType(xml: string): string[] {
  const pubTypeListMatch = xml.match(/<PublicationTypeList>([\s\S]*?)<\/PublicationTypeList>/i);
  if (!pubTypeListMatch) return [];
  return extractAll(pubTypeListMatch[1], "PublicationType");
}

export function parseArticleIds(xml: string): { doi?: string; pmid?: string; pmcid?: string } {
  const ids: { doi?: string; pmid?: string; pmcid?: string } = {};
  const idBlocks = xml.match(/<ArticleId IdType="[^"]*">[^<]*<\/ArticleId>/gi) || [];
  for (const block of idBlocks) {
    const typeMatch = block.match(/IdType="([^"]*)"/);
    const valueMatch = block.match(/>([^<]*)</);
    if (typeMatch && valueMatch) {
      const type = typeMatch[1];
      const value = valueMatch[1];
      if (type === "doi") ids.doi = value;
      if (type === "pubmed") ids.pmid = value;
      if (type === "pmc") ids.pmcid = value;
    }
  }
  if (!ids.doi) {
    const elocMatch = xml.match(/<ELocationID EIdType="doi"[^>]*>([^<]*)<\/ELocationID>/i);
    if (elocMatch) ids.doi = elocMatch[1];
  }
  return ids;
}

export interface PubMedArticle {
  pmid: string;
  title: string;
  authors: string[];
  affiliations: string[];
  journal: string;
  year: number;
  month?: number;
  abstract?: string;
  doi?: string;
  pmcid?: string;
  keywords: string[];
  meshTerms: string[];
  publicationTypes: string[];
}

function parseArticleXml(articleXml: string): PubMedArticle | null {
  const title = extractText(articleXml, "ArticleTitle").replace(/<[^>]*>/g, "");
  const { authors, affiliations } = parseAuthors(articleXml);
  const journal = extractText(articleXml, "Title");
  const abstractText = extractText(articleXml, "AbstractText").replace(/<[^>]*>/g, "");
  const meshTerms = parseMeshTerms(articleXml);
  const keywords = parseKeywords(articleXml);
  const pubTypes = parsePublicationType(articleXml);
  const articleIds = parseArticleIds(articleXml);

  const pubDateMatch = articleXml.match(/<PubDate>([\s\S]*?)<\/PubDate>/i);
  let year = 0;
  let month: number | undefined;
  if (pubDateMatch) {
    const yearStr = extractText(pubDateMatch[1], "Year");
    year = yearStr ? parseInt(yearStr, 10) : 0;
    const monthStr = extractText(pubDateMatch[1], "Month");
    if (monthStr) {
      const monthMap: Record<string, number> = {
        Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
        Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
      };
      month = monthMap[monthStr] || parseInt(monthStr, 10) || undefined;
    }
  }
  if (!year) {
    const medlineDateMatch = articleXml.match(/<MedlineDate>(\d{4})/);
    if (medlineDateMatch) year = parseInt(medlineDateMatch[1], 10);
  }
  if (!year) {
    const articleDateMatch = articleXml.match(/<ArticleDate[^>]*>[\s\S]*?<Year>(\d{4})<\/Year>/i);
    if (articleDateMatch) year = parseInt(articleDateMatch[1], 10);
  }

  if (!articleIds.pmid) {
    const pmidMatch = articleXml.match(/<PMID[^>]*>(\d+)<\/PMID>/i);
    if (pmidMatch) articleIds.pmid = pmidMatch[1];
  }

  if (!articleIds.pmid) return null;

  return {
    pmid: articleIds.pmid,
    title,
    authors,
    affiliations,
    journal,
    year,
    month,
    abstract: abstractText || undefined,
    doi: articleIds.doi,
    pmcid: articleIds.pmcid,
    keywords: keywords.length > 0 ? keywords : meshTerms,
    meshTerms,
    publicationTypes: pubTypes,
  };
}

export async function fetchArticleByPmid(pmid: string): Promise<PubMedArticle | null> {
  const fetchUrl = `${EUTILS_BASE}/efetch.fcgi?db=pubmed&id=${pmid}&rettype=xml&retmode=xml`;
  const res = await fetch(fetchUrl);
  const xml = await res.text();

  if (!xml.includes("<PubmedArticle>")) return null;

  const articleXml = xml.match(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/i)?.[1] || "";
  return parseArticleXml(articleXml);
}

export async function searchPubMedByAuthor(authorName: string, minDate?: string): Promise<string[]> {
  const maxDate = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
  const dateRange = minDate ? `&mindate=${minDate}&maxdate=${maxDate}&datetype=pdat` : "";
  const searchUrl = `${EUTILS_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(authorName)}[author]${dateRange}&retmax=50&retmode=xml`;
  const res = await fetch(searchUrl);
  const xml = await res.text();

  const ids: string[] = [];
  const idMatches = xml.matchAll(/<Id>(\d+)<\/Id>/g);
  for (const m of idMatches) {
    ids.push(m[1]);
  }
  return ids;
}
