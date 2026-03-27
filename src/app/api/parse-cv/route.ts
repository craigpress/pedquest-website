import { NextRequest, NextResponse } from "next/server";

interface CVSection {
  name: string;
  content: string[];
}

interface EducationEntry {
  degree: string;
  institution: string;
  year: string;
  field?: string;
}

interface PublicationEntry {
  title: string;
  authors: string[];
  journal?: string;
  year?: number;
  pmid?: string;
  doi?: string;
}

interface AbstractEntry {
  title: string;
  authors: string[];
  conference?: string;
  year?: number;
  presentationType?: string;
}

interface ParsedCV {
  name: string;
  title: string;
  institution: string;
  education: EducationEntry[];
  publications: PublicationEntry[];
  abstracts: AbstractEntry[];
  grants: string[];
  awards: string[];
  interests: string[];
  appointments: string[];
  rawSections: Record<string, string[]>;
}

const SECTION_PATTERNS: Record<string, RegExp> = {
  education: /^(education|academic\s+training|degrees?)\s*$/i,
  training: /^(training|postgraduate\s+training|residency|fellowship|post-?doctoral)\s*$/i,
  appointments: /^(appointments?|academic\s+appointments?|positions?|employment|professional\s+experience|faculty\s+appointments?)\s*$/i,
  publications: /^(publications?|peer[- ]reviewed\s+(publications?|articles?|papers?)|journal\s+articles?|manuscripts?|original\s+(research|articles?))\s*$/i,
  abstracts: /^(abstracts?|conference\s+abstracts?|posters?|presentations?|conference\s+presentations?|meeting\s+abstracts?|abstracts?\s*[\/&]\s*posters?)\s*$/i,
  grants: /^(grants?|funding|research\s+(funding|support|grants?)|extramural\s+funding|sponsored\s+research)\s*$/i,
  awards: /^(awards?|honors?|recognition|awards?\s*[\/&]\s*honors?)\s*$/i,
  interests: /^(interests?|research\s+interests?|areas?\s+of\s+(interest|focus|expertise)|clinical\s+interests?)\s*$/i,
};

function identifySections(lines: string[]): CVSection[] {
  const sections: CVSection[] = [];
  let currentSection: CVSection = { name: "header", content: [] };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check if this line is a section header
    let matched = false;
    for (const [sectionName, pattern] of Object.entries(SECTION_PATTERNS)) {
      // Check the trimmed line, also handle lines ending with ":"
      const cleanLine = trimmed.replace(/:$/, "").trim();
      if (pattern.test(cleanLine)) {
        if (currentSection.content.length > 0 || currentSection.name !== "header") {
          sections.push(currentSection);
        }
        currentSection = { name: sectionName, content: [] };
        matched = true;
        break;
      }
    }

    // Also detect ALL-CAPS section headers (common in CVs)
    if (!matched && trimmed.length > 3 && trimmed.length < 60 && trimmed === trimmed.toUpperCase() && /^[A-Z\s\/&,\-]+$/.test(trimmed)) {
      const cleanLine = trimmed.replace(/:$/, "").trim();
      for (const [sectionName, pattern] of Object.entries(SECTION_PATTERNS)) {
        if (pattern.test(cleanLine.charAt(0) + cleanLine.slice(1).toLowerCase())) {
          if (currentSection.content.length > 0 || currentSection.name !== "header") {
            sections.push(currentSection);
          }
          currentSection = { name: sectionName, content: [] };
          matched = true;
          break;
        }
      }
      // If all-caps but doesn't match known sections, still treat as section header
      if (!matched) {
        if (currentSection.content.length > 0 || currentSection.name !== "header") {
          sections.push(currentSection);
        }
        currentSection = { name: cleanLine.toLowerCase(), content: [] };
        matched = true;
      }
    }

    if (!matched) {
      currentSection.content.push(trimmed);
    }
  }

  if (currentSection.content.length > 0) {
    sections.push(currentSection);
  }

  return sections;
}

function extractName(headerContent: string[]): string {
  // The name is usually the first non-empty line
  for (const line of headerContent) {
    const cleaned = line.replace(/,?\s*(MD|DO|PhD|MPH|MS|MBA|FAAP|FAAN|FCCM|FACNS|FANA)\b/gi, "").trim();
    if (cleaned.length > 2 && cleaned.length < 80 && !cleaned.includes("@") && !/^\d/.test(cleaned)) {
      return cleaned;
    }
  }
  return "";
}

function extractTitle(headerContent: string[]): string {
  const titlePatterns = [
    /(?:professor|assistant\s+professor|associate\s+professor|instructor|lecturer|director|chief|chair)/i,
    /(?:attending|physician|scientist|investigator|fellow|resident)/i,
  ];
  for (const line of headerContent) {
    for (const pattern of titlePatterns) {
      if (pattern.test(line)) return line;
    }
  }
  return "";
}

function extractInstitution(headerContent: string[]): string {
  const instPatterns = [
    /(?:university|hospital|medical\s+center|children's|college|school\s+of\s+medicine|institute)/i,
  ];
  for (const line of headerContent) {
    for (const pattern of instPatterns) {
      if (pattern.test(line)) return line;
    }
  }
  return "";
}

function parseEducation(content: string[]): EducationEntry[] {
  const entries: EducationEntry[] = [];
  const degreePattern = /\b(MD|DO|PhD|MPH|MS|MBA|BS|BA|BSc|MSc|MBBS|MBChB)\b/;
  const yearPattern = /\b(19|20)\d{2}\b/;

  let currentEntry: Partial<EducationEntry> = {};

  for (const line of content) {
    const degreeMatch = line.match(degreePattern);
    const yearMatch = line.match(yearPattern);

    if (degreeMatch) {
      if (currentEntry.degree) {
        entries.push({
          degree: currentEntry.degree || "",
          institution: currentEntry.institution || "",
          year: currentEntry.year || "",
          field: currentEntry.field,
        });
      }
      currentEntry = {
        degree: degreeMatch[0],
        institution: line.replace(degreePattern, "").replace(yearPattern, "").replace(/[,\-\s]+$/, "").replace(/^[,\-\s]+/, "").trim(),
        year: yearMatch?.[0] || "",
      };
    } else if (currentEntry.degree && !currentEntry.institution) {
      currentEntry.institution = line.replace(yearPattern, "").trim();
      if (yearMatch) currentEntry.year = yearMatch[0];
    }
  }

  if (currentEntry.degree) {
    entries.push({
      degree: currentEntry.degree || "",
      institution: currentEntry.institution || "",
      year: currentEntry.year || "",
      field: currentEntry.field,
    });
  }

  return entries;
}

function parsePublications(content: string[]): PublicationEntry[] {
  const entries: PublicationEntry[] = [];
  const pmidPattern = /PMID:\s*(\d+)/i;
  const doiPattern = /(?:doi:\s*|https?:\/\/doi\.org\/)(10\.\S+)/i;
  const yearPattern = /\b(19|20)\d{2}\b/;

  // Join lines and split by numbered entries or double-newlines
  const fullText = content.join("\n");
  // Try to split by numbered entries (1. 2. 3. etc)
  const numberedSplit = fullText.split(/\n\s*\d+[\.\)]\s+/);
  // Also try splitting by bullet points
  const bulletSplit = fullText.split(/\n\s*[-*]\s+/);

  const chunks = numberedSplit.length > 2 ? numberedSplit : bulletSplit.length > 2 ? bulletSplit : [fullText];

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed || trimmed.length < 20) continue;

    const pmidMatch = trimmed.match(pmidPattern);
    const doiMatch = trimmed.match(doiPattern);
    const yearMatch = trimmed.match(yearPattern);

    // Try to extract title - usually in quotes or after authors
    let title = "";
    let authors: string[] = [];

    // Look for quoted title
    const quotedTitle = trimmed.match(/"([^"]+)"|"([^"]+)"/);
    if (quotedTitle) {
      title = quotedTitle[1] || quotedTitle[2];
    } else {
      // Try to find title by splitting on period after author list
      const parts = trimmed.split(/\.\s+/);
      if (parts.length >= 2) {
        // Authors are usually first, then title
        const potentialAuthors = parts[0];
        if (potentialAuthors.includes(",") && potentialAuthors.length < 500) {
          authors = potentialAuthors.split(/,\s*/).map(a => a.trim()).filter(a => a.length > 1);
          title = parts[1];
        } else {
          title = parts[0];
        }
      } else {
        title = trimmed.substring(0, 200);
      }
    }

    // Extract journal - usually italicized or after the title
    let journal = "";
    const journalMatch = trimmed.match(/(?:In:\s*|Published in:\s*)([^.]+)/i);
    if (journalMatch) {
      journal = journalMatch[1].trim();
    }

    if (title.length > 10) {
      entries.push({
        title: title.replace(/\.$/, "").trim(),
        authors,
        journal: journal || undefined,
        year: yearMatch ? parseInt(yearMatch[0]) : undefined,
        pmid: pmidMatch?.[1],
        doi: doiMatch?.[1],
      });
    }
  }

  return entries;
}

function parseAbstracts(content: string[]): AbstractEntry[] {
  const entries: AbstractEntry[] = [];
  const yearPattern = /\b(19|20)\d{2}\b/;
  const conferencePatterns = [
    /(?:AES|AAN|CNS|ACNS|PAS|SPR|ANA|ESPR|ICNA|EPNS|SNO|CHILD NEUROLOGY SOCIETY|AMERICAN EPILEPSY SOCIETY|NEUROCRITICAL CARE SOCIETY|AMERICAN ACADEMY OF NEUROLOGY)/i,
    /(?:annual\s+meeting|conference|congress|symposium|convention)/i,
  ];
  const typePatterns: Record<string, RegExp> = {
    poster: /\bposter\b/i,
    platform: /\bplatform\b/i,
    oral: /\boral\b/i,
    invited: /\binvited\b/i,
  };

  const fullText = content.join("\n");
  const numberedSplit = fullText.split(/\n\s*\d+[\.\)]\s+/);
  const bulletSplit = fullText.split(/\n\s*[-*]\s+/);
  const chunks = numberedSplit.length > 2 ? numberedSplit : bulletSplit.length > 2 ? bulletSplit : [fullText];

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed || trimmed.length < 15) continue;

    const yearMatch = trimmed.match(yearPattern);
    let conference = "";
    for (const pattern of conferencePatterns) {
      const match = trimmed.match(pattern);
      if (match) {
        // Get surrounding context for conference name
        const idx = trimmed.indexOf(match[0]);
        const start = Math.max(0, trimmed.lastIndexOf(".", idx - 1) + 1);
        const end = trimmed.indexOf(".", idx + match[0].length);
        conference = trimmed.substring(start, end > 0 ? end : undefined).trim();
        break;
      }
    }

    let presentationType = "";
    for (const [type, pattern] of Object.entries(typePatterns)) {
      if (pattern.test(trimmed)) {
        presentationType = type;
        break;
      }
    }

    // Extract title and authors similar to publications
    const parts = trimmed.split(/\.\s+/);
    let title = "";
    let authors: string[] = [];

    if (parts.length >= 2) {
      const potentialAuthors = parts[0];
      if (potentialAuthors.includes(",") && potentialAuthors.length < 500) {
        authors = potentialAuthors.split(/,\s*/).map(a => a.trim()).filter(a => a.length > 1);
        title = parts[1];
      } else {
        title = parts[0];
      }
    } else {
      title = trimmed.substring(0, 200);
    }

    if (title.length > 10) {
      entries.push({
        title: title.replace(/\.$/, "").trim(),
        authors,
        conference: conference || undefined,
        year: yearMatch ? parseInt(yearMatch[0]) : undefined,
        presentationType: presentationType || undefined,
      });
    }
  }

  return entries;
}

function extractInterests(content: string[]): string[] {
  const interests: string[] = [];
  for (const line of content) {
    // Split by commas or semicolons
    const items = line.split(/[,;]/).map(s => s.trim()).filter(s => s.length > 2 && s.length < 100);
    interests.push(...items);
  }
  return interests;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text } = body;

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "CV text is required" }, { status: 400 });
    }

    const lines = text.split("\n");
    const sections = identifySections(lines);

    const rawSections: Record<string, string[]> = {};
    for (const section of sections) {
      rawSections[section.name] = section.content;
    }

    const headerSection = sections.find(s => s.name === "header");
    const headerContent = headerSection?.content || lines.slice(0, 10);

    const name = extractName(headerContent);
    const title = extractTitle(headerContent);
    const institution = extractInstitution(headerContent);

    const educationSection = sections.find(s => s.name === "education");
    const trainingSection = sections.find(s => s.name === "training");
    const educationContent = [
      ...(educationSection?.content || []),
      ...(trainingSection?.content || []),
    ];
    const education = parseEducation(educationContent);

    const pubSection = sections.find(s => s.name === "publications");
    const publications = pubSection ? parsePublications(pubSection.content) : [];

    const absSection = sections.find(s => s.name === "abstracts");
    const abstracts = absSection ? parseAbstracts(absSection.content) : [];

    const grantSection = sections.find(s => s.name === "grants");
    const grants = grantSection?.content || [];

    const awardSection = sections.find(s => s.name === "awards");
    const awards = awardSection?.content || [];

    const interestSection = sections.find(s => s.name === "interests");
    const interests = interestSection ? extractInterests(interestSection.content) : [];

    const appointmentSection = sections.find(s => s.name === "appointments");
    const appointments = appointmentSection?.content || [];

    const parsed: ParsedCV = {
      name,
      title,
      institution,
      education,
      publications,
      abstracts,
      grants,
      awards,
      interests,
      appointments,
      rawSections,
    };

    return NextResponse.json(parsed);
  } catch (error) {
    console.error("CV parse error:", error);
    return NextResponse.json({ error: "Failed to parse CV text" }, { status: 500 });
  }
}
