import { NextRequest, NextResponse } from "next/server";

const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

// Conference name → journals that publish their supplement abstracts
const CONFERENCE_JOURNAL_MAP: Record<string, string[]> = {
  "american epilepsy society": ["Epilepsia", "Epilepsy Currents"],
  "aes annual": ["Epilepsia", "Epilepsy Currents"],
  "child neurology society": ["Annals of Neurology", "Journal of Child Neurology"],
  "cns annual": ["Annals of Neurology", "Journal of Child Neurology"],
  "pediatric academic societies": ["Pediatrics"],
  "pas annual": ["Pediatrics"],
  "society of critical care medicine": ["Critical Care Medicine", "Pediatric Critical Care Medicine"],
  "sccm annual": ["Critical Care Medicine", "Pediatric Critical Care Medicine"],
  "neurocritical care society": ["Neurocritical Care"],
  "ncs annual": ["Neurocritical Care"],
  "society for neuroscience": ["Journal of Neuroscience"],
  "sfn annual": ["Journal of Neuroscience"],
  "international epilepsy congress": ["Epilepsia"],
  "american academy of neurology": ["Neurology"],
  "aan annual": ["Neurology"],
  "european congress of epileptology": ["Epilepsia"],
};

function getConferenceJournals(conference: string): string[] {
  const lc = conference.toLowerCase();
  for (const [key, journals] of Object.entries(CONFERENCE_JOURNAL_MAP)) {
    if (lc.includes(key)) return journals;
  }
  return [];
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const title = searchParams.get("title");
  const conference = searchParams.get("conference") || "";
  const year = searchParams.get("year") || "";

  if (!title?.trim()) {
    return NextResponse.json({ error: "title parameter required" }, { status: 400 });
  }

  const cleanTitle = title.trim();
  const encodedTitle = encodeURIComponent(cleanTitle);
  const quotedTitle = encodeURIComponent(`"${cleanTitle}"`);

  // External search links — generated without fetching (Google/Scholar don't have a public API)
  const links: { label: string; url: string; description: string }[] = [
    {
      label: "PubMed",
      url: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodedTitle}`,
      description: "Search PubMed — may find supplement journal version",
    },
    {
      label: "Google Scholar",
      url: `https://scholar.google.com/scholar?q=${quotedTitle}`,
      description: "Search Google Scholar for citations and full text",
    },
    {
      label: "Google",
      url: `https://www.google.com/search?q=${quotedTitle}+abstract+poster`,
      description: "General web search — may find conference archive or PDF",
    },
    {
      label: "Semantic Scholar",
      url: `https://www.semanticscholar.org/search?q=${encodedTitle}&sort=Relevance`,
      description: "AI-powered academic search with citation data",
    },
    {
      label: "Europe PMC",
      url: `https://europepmc.org/search?query=${encodedTitle}`,
      description: "European PubMed Central — broader coverage than PubMed",
    },
  ];

  // Add conference-specific PubMed search if we recognize the conference
  if (conference) {
    const journals = getConferenceJournals(conference);
    if (journals.length > 0) {
      const journalClause = journals
        .map((j) => `"${j}"[Journal]`)
        .join(" OR ");
      links.unshift({
        label: `PubMed (${conference} journals)`,
        url: `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(
          `${cleanTitle}[Title] AND (${journals.map((j) => `"${j}"[Journal]`).join(" OR ")})`
        )}`,
        description: `Search specifically in ${journals.join(", ")} where ${conference} abstracts are often published`,
      });
      // Suppress unused variable warning
      void journalClause;
    }

    // BioMed Central / Springer supplement search
    links.push({
      label: "BioMed Central",
      url: `https://www.biomedcentral.com/search?query=${encodedTitle}`,
      description: "May find open-access supplement issues",
    });
  }

  // Actually search PubMed — some conference abstracts ARE indexed (supplement journal issues)
  let pubmedResults: { pmid: string; title: string; journal: string; year: string }[] = [];

  try {
    let term = `"${cleanTitle}"[Title]`;
    if (year) term += ` AND ${year}[PDAT]`;
    if (conference) {
      const journals = getConferenceJournals(conference);
      if (journals.length > 0) {
        term += ` AND (${journals.map((j) => `"${j}"[Journal]`).join(" OR ")})`;
      }
    }

    const searchUrl = `${EUTILS_BASE}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(term)}&retmax=5&retmode=json`;
    const res = await fetch(searchUrl, { signal: AbortSignal.timeout(6000) });

    if (res.ok) {
      const data = await res.json();
      const ids: string[] = data?.esearchresult?.idlist ?? [];

      if (ids.length > 0) {
        const summaryUrl = `${EUTILS_BASE}/esummary.fcgi?db=pubmed&id=${ids.join(",")}&retmode=json`;
        const summaryRes = await fetch(summaryUrl, { signal: AbortSignal.timeout(6000) });

        if (summaryRes.ok) {
          const summaryData = await summaryRes.json();
          const result = summaryData?.result ?? {};
          pubmedResults = ids
            .filter((id) => result[id])
            .map((id) => ({
              pmid: id,
              title: result[id].title ?? "",
              journal: result[id].source ?? "",
              year: result[id].pubdate?.slice(0, 4) ?? "",
            }));
        } else {
          pubmedResults = ids.map((id) => ({ pmid: id, title: "", journal: "", year: "" }));
        }
      }
    }
  } catch {
    // PubMed unreachable — links still returned
  }

  return NextResponse.json({
    found: pubmedResults.length > 0,
    pubmed_results: pubmedResults,
    links,
  });
}
