import { NextRequest, NextResponse } from "next/server";

const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

function extractText(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : "";
}

function extractAll(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const results: string[] = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1].trim());
  }
  return results;
}

function parseAuthors(xml: string): { authors: string[]; affiliations: string[] } {
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

function parseMeshTerms(xml: string): string[] {
  const meshListMatch = xml.match(/<MeshHeadingList>([\s\S]*?)<\/MeshHeadingList>/i);
  if (!meshListMatch) return [];
  return extractAll(meshListMatch[1], "DescriptorName");
}

function parseKeywords(xml: string): string[] {
  const keywordListMatch = xml.match(/<KeywordList[^>]*>([\s\S]*?)<\/KeywordList>/i);
  if (!keywordListMatch) return [];
  return extractAll(keywordListMatch[1], "Keyword");
}

function parsePublicationType(xml: string): string[] {
  const pubTypeListMatch = xml.match(/<PublicationTypeList>([\s\S]*?)<\/PublicationTypeList>/i);
  if (!pubTypeListMatch) return [];
  return extractAll(pubTypeListMatch[1], "PublicationType");
}

function parseArticleIds(xml: string): { doi?: string; pmid?: string; pmcid?: string } {
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
  // Also check for ELocationID DOI
  if (!ids.doi) {
    const elocMatch = xml.match(/<ELocationID EIdType="doi"[^>]*>([^<]*)<\/ELocationID>/i);
    if (elocMatch) ids.doi = elocMatch[1];
  }
  return ids;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const pmid = searchParams.get("pmid");
  const doi = searchParams.get("doi");

  if (!pmid && !doi) {
    return NextResponse.json({ error: "Provide either pmid or doi parameter" }, { status: 400 });
  }

  try {
    let resolvedPmid = pmid;

    // If DOI provided, search for PMID first
    if (!resolvedPmid && doi) {
      const searchUrl = `${EUTILS_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(doi)}[doi]&retmode=xml`;
      const searchRes = await fetch(searchUrl);
      const searchXml = await searchRes.text();
      const idMatch = searchXml.match(/<Id>(\d+)<\/Id>/);
      if (!idMatch) {
        return NextResponse.json({ error: "No PubMed article found for this DOI" }, { status: 404 });
      }
      resolvedPmid = idMatch[1];
    }

    // Fetch article data
    const fetchUrl = `${EUTILS_BASE}/efetch.fcgi?db=pubmed&id=${resolvedPmid}&rettype=xml&retmode=xml`;
    const fetchRes = await fetch(fetchUrl);
    const xml = await fetchRes.text();

    if (!xml.includes("<PubmedArticle>")) {
      return NextResponse.json({ error: "Article not found" }, { status: 404 });
    }

    const articleXml = xml.match(/<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/i)?.[1] || "";

    // Parse fields
    const title = extractText(articleXml, "ArticleTitle").replace(/<[^>]*>/g, "");
    const { authors, affiliations } = parseAuthors(articleXml);
    const journal = extractText(articleXml, "Title");
    const abstractText = extractText(articleXml, "AbstractText").replace(/<[^>]*>/g, "");
    const meshTerms = parseMeshTerms(articleXml);
    const keywords = parseKeywords(articleXml);
    const pubTypes = parsePublicationType(articleXml);
    const articleIds = parseArticleIds(articleXml);

    // Parse year and month
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

    // If year is still 0, try MedlineDate or ArticleDate
    if (!year) {
      const medlineDateMatch = articleXml.match(/<MedlineDate>(\d{4})/);
      if (medlineDateMatch) year = parseInt(medlineDateMatch[1], 10);
    }
    if (!year) {
      const articleDateMatch = articleXml.match(/<ArticleDate[^>]*>[\s\S]*?<Year>(\d{4})<\/Year>/i);
      if (articleDateMatch) year = parseInt(articleDateMatch[1], 10);
    }

    // Also get PMID from MedlineCitation if not in ArticleIdList
    if (!articleIds.pmid) {
      const pmidMatch = articleXml.match(/<PMID[^>]*>(\d+)<\/PMID>/i);
      if (pmidMatch) articleIds.pmid = pmidMatch[1];
    }

    const result = {
      id: `pub-new-${Date.now()}`,
      pmid: articleIds.pmid || resolvedPmid || undefined,
      pmcid: articleIds.pmcid || undefined,
      doi: articleIds.doi || (doi || undefined),
      title,
      authors,
      affiliations,
      memberAuthorIds: [] as string[],
      journal,
      year,
      month,
      abstract: abstractText || undefined,
      pubType: "article" as const,
      categories: [] as string[],
      keywords: keywords.length > 0 ? keywords : meshTerms,
      meshTerms,
      publicationTypes: pubTypes,
      isMemberPaper: false,
      patientPopulation: undefined as string | undefined,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("PubMed API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch from PubMed" },
      { status: 500 }
    );
  }
}
