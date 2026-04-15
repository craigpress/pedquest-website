import { NextRequest, NextResponse } from "next/server";
import {
  extractText,
  parseAuthors,
  parseMeshTerms,
  parseKeywords,
  parsePublicationType,
  parseArticleIds,
} from "@/lib/pubmed";

const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

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
