"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { publicationCategories } from "@/data/publications";
import { abstractCategories } from "@/data/abstracts";
import type { Publication } from "@/data/publications";
import type { ConferenceAbstract } from "@/data/abstracts";
import { useUser } from "@/lib/auth";
import { members, type Member } from "@/data/members";
import { supabase } from "@/lib/supabase";

const CVImporter = dynamic(() => import("./CVImporter"), {
  ssr: false,
  loading: () => <p style={{ color: "var(--text-secondary)", padding: "2rem" }}>Loading CV Importer...</p>,
});

type AdminTab = "publication" | "abstract" | "cv-importer" | "members";

// Admin emails — only these users can access the admin page
const ADMIN_EMAILS = [
  "pressca@chop.edu",
  "gbenedet@med.umich.edu",
  "ajay.thomas@bcm.edu",
];

const MEMBER_NAME_MAP: Record<string, string[]> = {
  // Leadership
  "craig-press": ["Press CA", "Press C"],
  "giulia-benedetti": ["Benedetti GM", "Benedetti G"],
  "dana-harrar": ["Harrar DB", "Harrar D"],
  "nicholas-abend": ["Abend NS"],
  "raquel-farias-moeller": ["Farias-Moeller R"],
  "ajay-thomas": ["Thomas AX"],
  "anuj-jayakar": ["Jayakar A"],
  "rishi-ganesan": ["Ganesan SL"],
  "joost-wagenaar": ["Wagenaar JB", "Wagenaar J"],
  "cecil-hahn": ["Hahn CD"],
  "james-riviello": ["Riviello JJ"],
  "laura-caligiuri": ["Caligiuri L"],
  "adam-ostendorf": ["Ostendorf AP"],
  "brian-appavu": ["Appavu B"],
  "matthew-kirschen": ["Kirschen MP"],
  "arnold-sansevere": ["Sansevere AJ"],
  "tobias-loddenkemper": ["Loddenkemper T"],
  "kerri-larovere": ["LaRovere KL"],
  "conall-francoeur": ["Francoeur C"],
  // Members
  "riley-kessler": ["Kessler R"],
  "mark-wainwright": ["Wainwright M", "Wainwright MS"],
  "agnes-kielian": ["Kielian A"],
  "chelsey-ortman": ["Ortman C"],
  "christopher-ruzas": ["Ruzas C"],
  "caroline-conley": ["Conley CR", "Conley C"],
  "daniel-davila-williams": ["Davila-Williams D", "Williams DD"],
  "dennis-leung": ["Leung D", "Leung DS"],
  "grace-gombolay": ["Gombolay G", "Gombolay GY"],
  "jessica-rogerson": ["Rogerson J"],
  "juan-ruzas-navarro": ["Ruzas-Navarro J", "Navarro JR"],
  "kara-hildebrandt": ["Hildebrandt K"],
  "katherine-knapp": ["Knapp K"],
  "korosh-talebian": ["Talebian K"],
  "lisa-ortiz-bautista": ["Ortiz-Bautista L"],
  "meena-garg": ["Garg M"],
  "michelle-mignard": ["Mignard M"],
  "mona-jacobson": ["Jacobson M"],
  "nathan-reynolds": ["Reynolds N"],
  "natasha-shukla": ["Shukla N"],
  "rachel-skelton": ["Skelton R"],
  "ross-zafonte": ["Zafonte R"],
  "samuel-lapalme-remis": ["Lapalme-Remis S"],
  "sarah-becker": ["Becker S"],
  "saul-flores": ["Flores S"],
  "sophia-bhalla": ["Bhalla S"],
  "stuart-friess": ["Friess S", "Friess SH"],
  "tracy-glauser": ["Glauser T", "Glauser TA"],
  "troy-loepke": ["Loepke T", "Loepke AW"],
  "xiaonan-meng": ["Meng X"],
  "jennifer-pineda-soto": ["Pineda-Soto J", "Soto JP"],
  "joy-goldstein": ["Goldstein J", "Goldstein JL"],
  "julie-wilson": ["Wilson J", "Wilson JL"],
  "courtney-wusthoff": ["Wusthoff C", "Wusthoff CJ"],
  "zachary-threlkeld": ["Threlkeld Z", "Threlkeld ZD"],
  "robert-fisher": ["Fisher R", "Fisher RS"],
  "hannah-glass": ["Glass H", "Glass HC"],
  "sarah-pinto": ["Pinto S"],
  "tiffani-mcdonough": ["McDonough T", "McDonough TL"],
  "mark-scher": ["Scher M", "Scher MS"],
  "lidia-moura": ["Moura LM", "Moura L"],
  "lisa-rath": ["Rath L"],
  "hunmin-kim": ["Kim H"],
  "kapil-arya": ["Arya K", "Arya KN"],
  "kevin-chapman": ["Chapman K", "Chapman KE"],
  "lindsey-gudeman": ["Gudeman L"],
  "mark-fitzgerald": ["Fitzgerald M", "Fitzgerald MP"],
  "michael-wolf": ["Wolf M", "Wolf MJ"],
  "amanda-sandoval-karamian": ["Sandoval Karamian A", "Sandoval-Karamian A", "Karamian AS"],
  "jennifer-keene": ["Keene JC", "Keene J"],
};

const MEMBER_DISPLAY_NAMES: Record<string, string> = {
  // Leadership
  "craig-press": "Craig A. Press",
  "giulia-benedetti": "Giulia M. Benedetti",
  "dana-harrar": "Dana B. Harrar",
  "nicholas-abend": "Nicholas S. Abend",
  "raquel-farias-moeller": "Raquel Farias-Moeller",
  "ajay-thomas": "Ajay X. Thomas",
  "anuj-jayakar": "Anuj Jayakar",
  "rishi-ganesan": "Rishi Ganesan",
  "joost-wagenaar": "Joost B. Wagenaar",
  "cecil-hahn": "Cecil D. Hahn",
  "james-riviello": "James J. Riviello",
  "laura-caligiuri": "Laura Caligiuri",
  "adam-ostendorf": "Adam P. Ostendorf",
  "brian-appavu": "Brian Appavu",
  "matthew-kirschen": "Matthew P. Kirschen",
  "arnold-sansevere": "Arnold J. Sansevere",
  "tobias-loddenkemper": "Tobias Loddenkemper",
  "kerri-larovere": "Kerri L. LaRovere",
  "conall-francoeur": "Conall Francoeur",
  // Members
  "riley-kessler": "Riley Kessler",
  "mark-wainwright": "Mark Wainwright",
  "agnes-kielian": "Agnes Kielian",
  "chelsey-ortman": "Chelsey Ortman",
  "christopher-ruzas": "Christopher Ruzas",
  "caroline-conley": "Caroline R Conley",
  "daniel-davila-williams": "Daniel Davila Williams",
  "dennis-leung": "Dennis Leung",
  "grace-gombolay": "Grace Gombolay",
  "jessica-rogerson": "Jessica Rogerson",
  "juan-ruzas-navarro": "Juan Ruzas Navarro",
  "kara-hildebrandt": "Kara Hildebrandt",
  "katherine-knapp": "Katherine Knapp",
  "korosh-talebian": "Korosh Talebian",
  "lisa-ortiz-bautista": "Lisa Ortiz-Bautista",
  "meena-garg": "Meena Garg",
  "michelle-mignard": "Michelle Mignard",
  "mona-jacobson": "Mona Jacobson",
  "nathan-reynolds": "Nathan Reynolds",
  "natasha-shukla": "Natasha Shukla",
  "rachel-skelton": "Rachel Skelton",
  "ross-zafonte": "Ross Zafonte",
  "samuel-lapalme-remis": "Samuel Lapalme-Remis",
  "sarah-becker": "Sarah Becker",
  "saul-flores": "Saul Flores",
  "sophia-bhalla": "Sophia Bhalla",
  "stuart-friess": "Stuart Friess",
  "tracy-glauser": "Tracy Glauser",
  "troy-loepke": "Troy Loepke",
  "xiaonan-meng": "Xiaonan Meng",
  "jennifer-pineda-soto": "Jennifer Pineda Soto",
  "joy-goldstein": "Joy Goldstein",
  "julie-wilson": "Julie Wilson",
  "courtney-wusthoff": "Courtney Wusthoff",
  "zachary-threlkeld": "Zachary Threlkeld",
  "robert-fisher": "Robert Fisher",
  "hannah-glass": "Hannah Glass",
  "sarah-pinto": "Sarah Pinto",
  "tiffani-mcdonough": "Tiffani McDonough",
  "mark-scher": "Mark Scher",
  "lidia-moura": "Lidia MVR Moura",
  "lisa-rath": "Lisa Rath",
  "hunmin-kim": "Hunmin Kim",
  "kapil-arya": "Kapil Arya",
  "kevin-chapman": "Kevin Chapman",
  "lindsey-gudeman": "Lindsey Gudeman",
  "mark-fitzgerald": "Mark Fitzgerald",
  "michael-wolf": "Michael Wolf",
  "amanda-sandoval-karamian": "Amanda Sandoval Karamian",
  "jennifer-keene": "Jennifer C. Keene",
};

const STORAGE_KEY = "pedquest-new-publications";
const STORAGE_KEY_ABSTRACTS = "pedquest-new-abstracts";

function matchMemberAuthors(authors: string[]): string[] {
  const matched: string[] = [];
  for (const [memberId, nameVariants] of Object.entries(MEMBER_NAME_MAP)) {
    for (const author of authors) {
      const authorNorm = author.trim();
      if (nameVariants.some((v) => authorNorm === v || authorNorm.startsWith(v))) {
        if (!matched.includes(memberId)) matched.push(memberId);
        break;
      }
    }
  }
  return matched;
}

// Parse a pasted medical citation into structured fields.
// Handles Vancouver/NLM format: "Smith J, Jones AB. Title. Journal. 2025;vol:pages. doi:xxx. PMID: xxx."
// Also handles semicolon-separated "Last, First; Last, First" author formats.
function parseCitationString(text: string): {
  authors: string[];
  title: string;
  journal: string;
  year: number | undefined;
  doi: string;
  pmid: string;
} {
  const clean = text.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();

  const pmidMatch = clean.match(/PMID[:\s]+(\d{5,9})/i);
  const pmid = pmidMatch?.[1] ?? "";

  const doiMatch = clean.match(/(?:doi[:\s]+|https?:\/\/doi\.org\/)(10\.[^\s,;]+)/i);
  const doi = doiMatch?.[1]?.replace(/[.,;]+$/, "") ?? "";

  const yearMatch = clean.match(/\b(19[5-9]\d|20[0-4]\d)\b/);
  const year = yearMatch ? parseInt(yearMatch[1]) : undefined;

  let authors: string[] = [];
  let title = "";
  let journal = "";

  // Split on ". " that precedes a capital letter — separates "Authors. Title. Journal."
  const segments = clean.split(/\. (?=[A-Z])/);

  if (segments.length >= 2) {
    const seg0 = segments[0].trim();

    // Detect "Last, First; Last, First" format
    const isSemicolonFormat = /^[A-Z][a-z\-]+,\s+[A-Z]/.test(seg0) && seg0.includes(";");
    // Detect "LastName AB, LastName CD" format (Vancouver)
    const isVancouver = /^[A-Z][a-záàéèíìóòúùñ\-]+\s+[A-Z]{1,4}(?:,\s*[A-Z][a-záàéèíìóòúùñ \-]+\s+[A-Z]{1,4})*(?:,?\s*et al\.?)?$/.test(seg0);

    if (isSemicolonFormat) {
      authors = seg0.split(/;\s*/).map((s) => {
        const m = s.trim().match(/^([A-Z][a-z\-]+),\s+([A-Z])[a-z]*\s*([A-Z])?/);
        return m ? `${m[1]} ${m[2]}${m[3] ?? ""}` : s.trim();
      }).filter(Boolean);
      title = segments[1];
      journal = segments[2]?.split(/\s*[\d;(]/)[0]?.trim() ?? "";
    } else if (isVancouver) {
      authors = seg0
        .replace(/,?\s*et al\.?/, "")
        .split(/,\s*/)
        .map((s) => s.trim())
        .filter(Boolean);
      title = segments[1];
      journal = segments[2]?.split(/\s*[\d;(]/)[0]?.trim() ?? "";
    } else {
      // Fallback: treat first segment as title if it looks long
      title = seg0.length > 30 ? seg0 : segments[1] ?? "";
    }
  }

  return { authors, title, journal, year, doi, pmid };
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.6rem 0.8rem",
  borderRadius: "8px",
  border: "1px solid var(--border-strong)",
  background: "var(--bg-card)",
  color: "var(--text)",
  fontFamily: "var(--body-font)",
  fontSize: "0.9rem",
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.8rem",
  fontWeight: 600,
  color: "var(--text-secondary)",
  marginBottom: "0.3rem",
  fontFamily: "var(--body-font)",
};

function generatePublicationCode(pub: Publication): string {
  const lines = [
    `  {`,
    `    id: "${pub.id}",`,
  ];
  if (pub.pmid) lines.push(`    pmid: "${pub.pmid}",`);
  if (pub.pmcid) lines.push(`    pmcid: "${pub.pmcid}",`);
  if (pub.doi) lines.push(`    doi: "${pub.doi}",`);
  lines.push(`    title: ${JSON.stringify(pub.title)},`);
  lines.push(`    authors: ${JSON.stringify(pub.authors)},`);
  lines.push(`    memberAuthorIds: ${JSON.stringify(pub.memberAuthorIds)},`);
  lines.push(`    journal: ${JSON.stringify(pub.journal)},`);
  lines.push(`    year: ${pub.year},`);
  if (pub.month) lines.push(`    month: ${pub.month},`);
  if (pub.abstract) lines.push(`    abstract: ${JSON.stringify(pub.abstract)},`);
  lines.push(`    pubType: "${pub.pubType}",`);
  lines.push(`    categories: ${JSON.stringify(pub.categories)},`);
  lines.push(`    keywords: ${JSON.stringify(pub.keywords)},`);
  lines.push(`    isMemberPaper: ${pub.isMemberPaper},`);
  if (pub.patientPopulation) lines.push(`    patientPopulation: "${pub.patientPopulation}",`);
  lines.push(`  },`);
  return lines.join("\n");
}

function generateAbstractCode(abs: ConferenceAbstract): string {
  const lines = [
    `  {`,
    `    id: "${abs.id}",`,
    `    title: ${JSON.stringify(abs.title)},`,
    `    authors: ${JSON.stringify(abs.authors)},`,
    `    conference: ${JSON.stringify(abs.conference)},`,
    `    presentationType: "${abs.presentationType}",`,
    `    date: "${abs.date}",`,
    `    location: ${JSON.stringify(abs.location)},`,
    `    year: ${abs.year},`,
    `    memberAuthorIds: ${JSON.stringify(abs.memberAuthorIds)},`,
    `    isMemberPaper: ${abs.isMemberPaper},`,
    `    categories: ${JSON.stringify(abs.categories)},`,
  ];
  if (abs.notes) lines.push(`    notes: ${JSON.stringify(abs.notes)},`);
  lines.push(`  },`);
  return lines.join("\n");
}

function AdminPageInner() {
  const { user, loading: authLoading } = useUser();
  const [tab, setTab] = useState<AdminTab>("publication");

  // ALL hooks must be called before any early returns (Rules of Hooks)
  // Publication form state
  const [title, setTitle] = useState("");
  const [authors, setAuthors] = useState<string[]>([]);
  const [authorInput, setAuthorInput] = useState("");
  const [journal, setJournal] = useState("");
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [month, setMonth] = useState<number | undefined>();
  const [doi, setDoi] = useState("");
  const [pmid, setPmid] = useState("");
  const [pmcid, setPmcid] = useState("");
  const [abstract, setAbstract] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [patientPopulation, setPatientPopulation] = useState("");
  const [memberAuthorIds, setMemberAuthorIds] = useState<string[]>([]);
  const [isMemberPaper, setIsMemberPaper] = useState(false);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState("");

  // Abstract form state
  const [absTitle, setAbsTitle] = useState("");
  const [absAuthors, setAbsAuthors] = useState<string[]>([]);
  const [absAuthorInput, setAbsAuthorInput] = useState("");
  const [absConference, setAbsConference] = useState("");
  const [absPresentationType, setAbsPresentationType] = useState<"poster" | "platform" | "oral" | "invited">("poster");
  const [absDate, setAbsDate] = useState("");
  const [absLocation, setAbsLocation] = useState("");
  const [absYear, setAbsYear] = useState<number>(new Date().getFullYear());
  const [absCategories, setAbsCategories] = useState<string[]>([]);
  const [absMemberAuthorIds, setAbsMemberAuthorIds] = useState<string[]>([]);
  const [absIsMemberPaper, setAbsIsMemberPaper] = useState(false);
  const [absNotes, setAbsNotes] = useState("");
  // Abstract online link search
  const [absLinkLoading, setAbsLinkLoading] = useState(false);
  const [absLinkResults, setAbsLinkResults] = useState<null | {
    found: boolean;
    pubmed_results: { pmid: string; title: string; journal: string; year: string }[];
    links: { label: string; url: string; description: string }[];
  }>(null);
  // Citation paste parsers
  const [citationPaste, setCitationPaste] = useState("");
  const [absCitationPaste, setAbsCitationPaste] = useState("");

  // Lookup state
  const [lookupValue, setLookupValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Saved items
  const [savedPubs, setSavedPubs] = useState<Publication[]>([]);
  const [savedAbstracts, setSavedAbstracts] = useState<ConferenceAbstract[]>([]);
  const [showCode, setShowCode] = useState(false);
  const [codeContent, setCodeContent] = useState("");

  // Member management state
  const [memberSearch, setMemberSearch] = useState("");
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [memberForm, setMemberForm] = useState<{
    name: string; title: string; role: string; institution: string; department: string;
    bio: string; interests: string; email: string; orcidId: string; websiteUrl: string;
    photoUrl: string; cvFilename: string;
  } | null>(null);
  const [memberPhotoPreview, setMemberPhotoPreview] = useState<string | null>(null);
  const [memberSaving, setMemberSaving] = useState(false);
  const [memberSaved, setMemberSaved] = useState(false);
  // TODO: Supabase integration will persist member edits. For now, edits update display via localStorage.
  const [memberOverrides, setMemberOverrides] = useState<Record<string, Partial<Member>>>({});
  const memberPhotoRef = useRef<HTMLInputElement>(null);
  const memberCvRef = useRef<HTMLInputElement>(null);

  // Load from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setSavedPubs(JSON.parse(stored));
      const storedAbs = localStorage.getItem(STORAGE_KEY_ABSTRACTS);
      if (storedAbs) setSavedAbstracts(JSON.parse(storedAbs));
      // Load member overrides
      const storedOverrides = localStorage.getItem("pedquest-admin-member-overrides");
      if (storedOverrides) setMemberOverrides(JSON.parse(storedOverrides));
    } catch { /* ignore */ }
  }, []);

  const savePubs = useCallback((pubs: Publication[]) => {
    setSavedPubs(pubs);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pubs));
  }, []);

  const saveAbstracts = useCallback((abs: ConferenceAbstract[]) => {
    setSavedAbstracts(abs);
    localStorage.setItem(STORAGE_KEY_ABSTRACTS, JSON.stringify(abs));
  }, []);

  // Auth gate — only admin emails can access
  const isAdmin = user?.email && ADMIN_EMAILS.includes(user.email.toLowerCase());

  if (authLoading) {
    return (
      <main style={{ maxWidth: 900, margin: "0 auto", padding: "4rem 1.5rem", textAlign: "center" }}>
        <p style={{ color: "var(--text-secondary)" }}>Loading...</p>
      </main>
    );
  }

  if (!user || !isAdmin) {
    return (
      <main style={{ maxWidth: 600, margin: "0 auto", padding: "4rem 1.5rem", textAlign: "center" }}>
        <h1 style={{ fontFamily: "var(--heading-font)", fontSize: "1.8rem", marginBottom: "1rem" }}>Admin Access Required</h1>
        <p style={{ color: "var(--text-secondary)", marginBottom: "2rem" }}>
          This page is restricted to PedQuEST administrators.
          {!user && " Please log in first."}
          {user && !isAdmin && (
            <> Your account ({user.email}) does not have admin privileges. Contact an administrator.</>
          )}
        </p>
        {!user && (
          <a href="/login" style={{
            display: "inline-block", padding: "0.75rem 2rem", borderRadius: "8px",
            background: "var(--accent-primary)", color: "white", textDecoration: "none",
            fontWeight: 600, fontFamily: "var(--body-font)",
          }}>Log In</a>
        )}
      </main>
    );
  }

  // PubMed fetch
  const fetchPubMed = async () => {
    const val = lookupValue.trim();
    if (!val) return;
    setLoading(true);
    setError("");
    try {
      const isDoiLike = val.includes("/") || val.startsWith("10.");
      const param = isDoiLike ? `doi=${encodeURIComponent(val)}` : `pmid=${encodeURIComponent(val)}`;
      const res = await fetch(`/api/pubmed?${param}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to fetch");
        setLoading(false);
        return;
      }
      // Fill form
      setTitle(data.title || "");
      setAuthors(data.authors || []);
      setJournal(data.journal || "");
      setYear(data.year || new Date().getFullYear());
      setMonth(data.month || undefined);
      setDoi(data.doi || "");
      setPmid(data.pmid || "");
      setPmcid(data.pmcid || "");
      setAbstract(data.abstract || "");
      setKeywords(data.keywords || []);

      // Auto-match members
      const matched = matchMemberAuthors(data.authors || []);
      setMemberAuthorIds(matched);
      setIsMemberPaper(matched.length > 0);
    } catch (e) {
      setError("Network error fetching from PubMed");
      console.error(e);
    }
    setLoading(false);
  };

  const clearForm = () => {
    setTitle(""); setAuthors([]); setAuthorInput(""); setJournal("");
    setYear(new Date().getFullYear()); setMonth(undefined);
    setDoi(""); setPmid(""); setPmcid(""); setAbstract("");
    setCategories([]); setPatientPopulation(""); setMemberAuthorIds([]);
    setIsMemberPaper(false); setKeywords([]); setKeywordInput("");
    setLookupValue(""); setError("");
  };

  const clearAbstractForm = () => {
    setAbsTitle(""); setAbsAuthors([]); setAbsAuthorInput(""); setAbsConference("");
    setAbsPresentationType("poster"); setAbsDate(""); setAbsLocation("");
    setAbsYear(new Date().getFullYear()); setAbsCategories([]);
    setAbsMemberAuthorIds([]); setAbsIsMemberPaper(false);
    setAbsNotes(""); setAbsLinkResults(null); setAbsCitationPaste("");
  };

  // Parse a pasted citation and pre-fill the publication form.
  // If a PMID or DOI is detected, also sets lookupValue so the user can
  // click "Fetch from PubMed" to get the full record.
  const parsePubCitation = () => {
    if (!citationPaste.trim()) return;
    const parsed = parseCitationString(citationPaste);
    if (parsed.authors.length > 0) {
      setAuthors(parsed.authors);
      const matched = matchMemberAuthors(parsed.authors);
      setMemberAuthorIds(matched);
      setIsMemberPaper(matched.length > 0);
    }
    if (parsed.title) setTitle(parsed.title);
    if (parsed.journal) setJournal(parsed.journal);
    if (parsed.year) setYear(parsed.year);
    if (parsed.doi) setDoi(parsed.doi);
    if (parsed.pmid) setPmid(parsed.pmid);
    // If PMID or DOI found, pre-fill the lookup box for one-click PubMed fetch
    if (parsed.pmid) setLookupValue(parsed.pmid);
    else if (parsed.doi) setLookupValue(parsed.doi);
    setCitationPaste("");
  };

  // Parse a pasted author/citation string and pre-fill the abstract form.
  const parseAbsCitation = () => {
    if (!absCitationPaste.trim()) return;
    const parsed = parseCitationString(absCitationPaste);
    if (parsed.authors.length > 0) {
      setAbsAuthors(parsed.authors);
      const matched = matchMemberAuthors(parsed.authors);
      setAbsMemberAuthorIds(matched);
      setAbsIsMemberPaper(matched.length > 0);
    }
    if (parsed.title && !absTitle) setAbsTitle(parsed.title);
    if (parsed.year) setAbsYear(parsed.year);
    setAbsCitationPaste("");
  };

  // Search for an abstract online via PubMed + generated links.
  const searchAbstractOnline = async () => {
    if (!absTitle.trim()) return;
    setAbsLinkLoading(true);
    setAbsLinkResults(null);
    try {
      const params = new URLSearchParams({ title: absTitle.trim() });
      if (absConference) params.set("conference", absConference);
      if (absYear) params.set("year", String(absYear));
      const res = await fetch(`/api/abstract-search?${params}`);
      if (res.ok) {
        setAbsLinkResults(await res.json());
      }
    } catch {
      /* silently fail — links still available */
    }
    setAbsLinkLoading(false);
  };

  const savePublication = () => {
    if (!title.trim()) { setError("Title is required"); return; }
    const pub: Publication = {
      id: `pub-new-${Date.now()}`,
      pmid: pmid || undefined,
      pmcid: pmcid || undefined,
      doi: doi || undefined,
      title: title.trim(),
      authors,
      memberAuthorIds,
      journal: journal.trim(),
      year,
      month,
      abstract: abstract || undefined,
      pubType: "article",
      categories,
      keywords,
      isMemberPaper,
      patientPopulation: patientPopulation || undefined,
    };
    const updated = [...savedPubs, pub];
    savePubs(updated);
    clearForm();
  };

  const saveAbstract = () => {
    if (!absTitle.trim()) { setError("Title is required"); return; }
    const abs: ConferenceAbstract = {
      id: `abs-new-${Date.now()}`,
      title: absTitle.trim(),
      authors: absAuthors,
      conference: absConference.trim(),
      presentationType: absPresentationType,
      date: absDate,
      location: absLocation,
      year: absYear,
      memberAuthorIds: absMemberAuthorIds,
      isMemberPaper: absIsMemberPaper,
      categories: absCategories,
      notes: absNotes || undefined,
    };
    const updated = [...savedAbstracts, abs];
    saveAbstracts(updated);
    clearAbstractForm();
  };

  const deletePub = (id: string) => savePubs(savedPubs.filter((p) => p.id !== id));
  const deleteAbstract = (id: string) => saveAbstracts(savedAbstracts.filter((a) => a.id !== id));

  const showGeneratedCode = (code: string) => {
    setCodeContent(code);
    setShowCode(true);
  };

  const exportAllPubs = () => {
    const code = savedPubs.map(generatePublicationCode).join("\n");
    showGeneratedCode(code);
  };

  const exportAllAbstracts = () => {
    const code = savedAbstracts.map(generateAbstractCode).join("\n");
    showGeneratedCode(code);
  };

  const addAuthor = () => {
    const v = authorInput.trim();
    if (v && !authors.includes(v)) {
      const newAuthors = [...authors, v];
      setAuthors(newAuthors);
      setAuthorInput("");
      const matched = matchMemberAuthors(newAuthors);
      setMemberAuthorIds(matched);
      setIsMemberPaper(matched.length > 0);
    }
  };

  const removeAuthor = (idx: number) => {
    const newAuthors = authors.filter((_, i) => i !== idx);
    setAuthors(newAuthors);
    const matched = matchMemberAuthors(newAuthors);
    setMemberAuthorIds(matched);
    setIsMemberPaper(matched.length > 0);
  };

  const addKeyword = () => {
    const v = keywordInput.trim();
    if (v && !keywords.includes(v)) {
      setKeywords([...keywords, v]);
      setKeywordInput("");
    }
  };

  const addAbsAuthor = () => {
    const v = absAuthorInput.trim();
    if (v && !absAuthors.includes(v)) {
      const newAuthors = [...absAuthors, v];
      setAbsAuthors(newAuthors);
      setAbsAuthorInput("");
      const matched = matchMemberAuthors(newAuthors);
      setAbsMemberAuthorIds(matched);
      setAbsIsMemberPaper(matched.length > 0);
    }
  };

  const removeAbsAuthor = (idx: number) => {
    const newAuthors = absAuthors.filter((_, i) => i !== idx);
    setAbsAuthors(newAuthors);
    const matched = matchMemberAuthors(newAuthors);
    setAbsMemberAuthorIds(matched);
    setAbsIsMemberPaper(matched.length > 0);
  };

  const toggleCategory = (cat: string, list: string[], setter: (v: string[]) => void) => {
    setter(list.includes(cat) ? list.filter((c) => c !== cat) : [...list, cat]);
  };

  const toggleMember = (id: string) => {
    if (tab === "publication") {
      const updated = memberAuthorIds.includes(id)
        ? memberAuthorIds.filter((m) => m !== id)
        : [...memberAuthorIds, id];
      setMemberAuthorIds(updated);
      setIsMemberPaper(updated.length > 0);
    } else {
      const updated = absMemberAuthorIds.includes(id)
        ? absMemberAuthorIds.filter((m) => m !== id)
        : [...absMemberAuthorIds, id];
      setAbsMemberAuthorIds(updated);
      setAbsIsMemberPaper(updated.length > 0);
    }
  };

  return (
    <main style={{ maxWidth: "900px", margin: "0 auto", padding: "3rem 1.5rem" }}>
      <header style={{ marginBottom: "2rem" }}>
        <h1 className="section-heading">Admin - Publication Manager</h1>
        <p className="section-subheading">
          Add publications with PubMed autofill. Data is saved to localStorage.
        </p>
      </header>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
        <button
          onClick={() => setTab("publication")}
          className={tab === "publication" ? "btn-primary" : "btn-secondary"}
          style={{ fontSize: "0.85rem", padding: "0.5rem 1.25rem" }}
        >
          Add Publication
        </button>
        <button
          onClick={() => setTab("abstract")}
          className={tab === "abstract" ? "btn-primary" : "btn-secondary"}
          style={{ fontSize: "0.85rem", padding: "0.5rem 1.25rem" }}
        >
          Add Conference Abstract
        </button>
        <button
          onClick={() => setTab("cv-importer")}
          className={tab === "cv-importer" ? "btn-primary" : "btn-secondary"}
          style={{ fontSize: "0.85rem", padding: "0.5rem 1.25rem" }}
        >
          CV Importer
        </button>
        <button
          onClick={() => setTab("members")}
          className={tab === "members" ? "btn-primary" : "btn-secondary"}
          style={{ fontSize: "0.85rem", padding: "0.5rem 1.25rem" }}
        >
          Member Management
        </button>
      </div>

      {tab === "publication" && (
        <>
          {/* PubMed Lookup */}
          <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
            <h2 style={{ fontSize: "1rem", fontFamily: "var(--heading-font)", marginBottom: "0.75rem" }}>
              PubMed Lookup
            </h2>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>PMID or DOI</label>
                <input
                  type="text"
                  value={lookupValue}
                  onChange={(e) => setLookupValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && fetchPubMed()}
                  placeholder="e.g. 41005642 or 10.1016/j.resuscitation.2025.110838"
                  style={inputStyle}
                />
              </div>
              <button
                onClick={fetchPubMed}
                disabled={loading}
                className="btn-primary"
                style={{ padding: "0.6rem 1.25rem", fontSize: "0.85rem", whiteSpace: "nowrap" }}
              >
                {loading ? "Fetching..." : "Fetch from PubMed"}
              </button>
            </div>
            {error && (
              <p style={{ color: "#ef4444", fontSize: "0.85rem", marginTop: "0.5rem" }}>{error}</p>
            )}
          </div>

          {/* Publication Form */}
          <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
            <h2 style={{ fontSize: "1rem", fontFamily: "var(--heading-font)", marginBottom: "1rem" }}>
              Publication Details
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {/* Title */}
              <div>
                <label style={labelStyle}>Title</label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
              </div>

              {/* Authors */}
              <div>
                <label style={labelStyle}>Authors (LastName Initials format)</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.4rem" }}>
                  {authors.map((a, i) => (
                    <span
                      key={i}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.3rem",
                        padding: "0.25rem 0.6rem",
                        borderRadius: "999px",
                        background: "var(--border)",
                        color: "var(--text)",
                        fontSize: "0.8rem",
                        fontFamily: "var(--body-font)",
                      }}
                    >
                      {a}
                      <button
                        onClick={() => removeAuthor(i)}
                        style={{
                          background: "none", border: "none", color: "var(--text-muted)",
                          cursor: "pointer", fontSize: "0.9rem", padding: "0 0.1rem", lineHeight: 1,
                        }}
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  <input
                    type="text"
                    value={authorInput}
                    onChange={(e) => setAuthorInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addAuthor())}
                    placeholder="Press CA"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button onClick={addAuthor} className="btn-secondary" style={{ fontSize: "0.8rem", padding: "0.4rem 0.8rem" }}>
                    Add
                  </button>
                </div>
              </div>

              {/* Journal + Year + Month */}
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "0.75rem" }}>
                <div>
                  <label style={labelStyle}>Journal</label>
                  <input type="text" value={journal} onChange={(e) => setJournal(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Year</label>
                  <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Month</label>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={month || ""}
                    onChange={(e) => setMonth(e.target.value ? Number(e.target.value) : undefined)}
                    style={inputStyle}
                    placeholder="1-12"
                  />
                </div>
              </div>

              {/* IDs */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
                <div>
                  <label style={labelStyle}>DOI</label>
                  <input type="text" value={doi} onChange={(e) => setDoi(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>PMID</label>
                  <input type="text" value={pmid} onChange={(e) => setPmid(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>PMCID</label>
                  <input type="text" value={pmcid} onChange={(e) => setPmcid(e.target.value)} style={inputStyle} />
                </div>
              </div>

              {/* Abstract */}
              <div>
                <label style={labelStyle}>Abstract</label>
                <textarea
                  value={abstract}
                  onChange={(e) => setAbstract(e.target.value)}
                  rows={5}
                  style={{ ...inputStyle, resize: "vertical" }}
                />
              </div>

              {/* Keywords */}
              <div>
                <label style={labelStyle}>Keywords</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.4rem" }}>
                  {keywords.map((k, i) => (
                    <span
                      key={i}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.3rem",
                        padding: "0.25rem 0.6rem",
                        borderRadius: "999px",
                        background: "var(--border)",
                        color: "var(--text)",
                        fontSize: "0.75rem",
                        fontFamily: "var(--body-font)",
                      }}
                    >
                      {k}
                      <button
                        onClick={() => setKeywords(keywords.filter((_, j) => j !== i))}
                        style={{
                          background: "none", border: "none", color: "var(--text-muted)",
                          cursor: "pointer", fontSize: "0.85rem", padding: "0 0.1rem", lineHeight: 1,
                        }}
                      >
                        x
                      </button>
                    </span>
                  ))}
                </div>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  <input
                    type="text"
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addKeyword())}
                    placeholder="Add keyword"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button onClick={addKeyword} className="btn-secondary" style={{ fontSize: "0.8rem", padding: "0.4rem 0.8rem" }}>
                    Add
                  </button>
                </div>
              </div>

              {/* Categories */}
              <div>
                <label style={labelStyle}>Categories</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  {publicationCategories.map((cat) => (
                    <label
                      key={cat}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.25rem",
                        padding: "0.2rem 0.6rem",
                        borderRadius: "6px",
                        border: `1px solid ${categories.includes(cat) ? "var(--accent-primary)" : "var(--border)"}`,
                        background: categories.includes(cat) ? "var(--accent-primary)" : "transparent",
                        color: categories.includes(cat) ? "#fff" : "var(--text-secondary)",
                        fontSize: "0.75rem",
                        cursor: "pointer",
                        fontFamily: "var(--body-font)",
                        transition: "all 0.15s",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={categories.includes(cat)}
                        onChange={() => toggleCategory(cat, categories, setCategories)}
                        style={{ display: "none" }}
                      />
                      {cat}
                    </label>
                  ))}
                </div>
              </div>

              {/* Patient Population */}
              <div>
                <label style={labelStyle}>Patient Population</label>
                <select
                  value={patientPopulation}
                  onChange={(e) => setPatientPopulation(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">-- Select --</option>
                  <option value="Pediatric">Pediatric</option>
                  <option value="Neonatal">Neonatal</option>
                  <option value="Adult">Adult</option>
                </select>
              </div>

              {/* Member Authors */}
              <div>
                <label style={labelStyle}>Member Authors</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  {Object.entries(MEMBER_DISPLAY_NAMES).map(([id, name]) => (
                    <label
                      key={id}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.25rem",
                        padding: "0.2rem 0.6rem",
                        borderRadius: "6px",
                        border: `1px solid ${memberAuthorIds.includes(id) ? "var(--accent-primary)" : "var(--border)"}`,
                        background: memberAuthorIds.includes(id) ? "var(--accent-primary)" : "transparent",
                        color: memberAuthorIds.includes(id) ? "#fff" : "var(--text-secondary)",
                        fontSize: "0.75rem",
                        cursor: "pointer",
                        fontFamily: "var(--body-font)",
                        transition: "all 0.15s",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={memberAuthorIds.includes(id)}
                        onChange={() => toggleMember(id)}
                        style={{ display: "none" }}
                      />
                      {name}
                    </label>
                  ))}
                </div>
              </div>

              {/* Is Member Paper */}
              <div>
                <label style={{ ...labelStyle, display: "inline-flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={isMemberPaper}
                    onChange={(e) => setIsMemberPaper(e.target.checked)}
                  />
                  Is Member Paper
                </label>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <button onClick={savePublication} className="btn-primary" style={{ fontSize: "0.85rem", padding: "0.6rem 1.5rem" }}>
                  Save Publication
                </button>
                <button
                  onClick={() => {
                    if (!title.trim()) { setError("Title is required to generate code"); return; }
                    const pub: Publication = {
                      id: `pub-new-${Date.now()}`, pmid: pmid || undefined, pmcid: pmcid || undefined,
                      doi: doi || undefined, title: title.trim(), authors, memberAuthorIds,
                      journal: journal.trim(), year, month, abstract: abstract || undefined,
                      pubType: "article", categories, keywords, isMemberPaper,
                      patientPopulation: patientPopulation || undefined,
                    };
                    showGeneratedCode(generatePublicationCode(pub));
                  }}
                  className="btn-secondary"
                  style={{ fontSize: "0.85rem", padding: "0.6rem 1.5rem" }}
                >
                  Generate Code
                </button>
                <button onClick={clearForm} className="btn-secondary" style={{ fontSize: "0.85rem", padding: "0.6rem 1.5rem" }}>
                  Clear Form
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "abstract" && (
        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <h2 style={{ fontSize: "1rem", fontFamily: "var(--heading-font)", marginBottom: "1rem" }}>
            Conference Abstract Details
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label style={labelStyle}>Title</label>
              <input type="text" value={absTitle} onChange={(e) => setAbsTitle(e.target.value)} style={inputStyle} />
            </div>

            {/* Authors */}
            <div>
              <label style={labelStyle}>Authors</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.4rem" }}>
                {absAuthors.map((a, i) => (
                  <span key={i} style={{
                    display: "inline-flex", alignItems: "center", gap: "0.3rem",
                    padding: "0.25rem 0.6rem", borderRadius: "999px", background: "var(--border)",
                    color: "var(--text)", fontSize: "0.8rem", fontFamily: "var(--body-font)",
                  }}>
                    {a}
                    <button onClick={() => removeAbsAuthor(i)} style={{
                      background: "none", border: "none", color: "var(--text-muted)",
                      cursor: "pointer", fontSize: "0.9rem", padding: "0 0.1rem", lineHeight: 1,
                    }}>x</button>
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <input
                  type="text" value={absAuthorInput}
                  onChange={(e) => setAbsAuthorInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addAbsAuthor())}
                  placeholder="Press CA" style={{ ...inputStyle, flex: 1 }}
                />
                <button onClick={addAbsAuthor} className="btn-secondary" style={{ fontSize: "0.8rem", padding: "0.4rem 0.8rem" }}>Add</button>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "0.75rem" }}>
              <div>
                <label style={labelStyle}>Conference Name</label>
                <input type="text" value={absConference} onChange={(e) => setAbsConference(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Presentation Type</label>
                <select value={absPresentationType} onChange={(e) => setAbsPresentationType(e.target.value as "poster" | "platform" | "oral" | "invited")} style={inputStyle}>
                  <option value="poster">Poster</option>
                  <option value="platform">Platform</option>
                  <option value="oral">Oral</option>
                  <option value="invited">Invited</option>
                </select>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
              <div>
                <label style={labelStyle}>Date</label>
                <input type="text" value={absDate} onChange={(e) => setAbsDate(e.target.value)} placeholder="November 2025" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Location</label>
                <input type="text" value={absLocation} onChange={(e) => setAbsLocation(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Year</label>
                <input type="number" value={absYear} onChange={(e) => setAbsYear(Number(e.target.value))} style={inputStyle} />
              </div>
            </div>

            {/* Categories */}
            <div>
              <label style={labelStyle}>Categories</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                {abstractCategories.map((cat) => (
                  <label key={cat} style={{
                    display: "inline-flex", alignItems: "center", gap: "0.25rem",
                    padding: "0.2rem 0.6rem", borderRadius: "6px",
                    border: `1px solid ${absCategories.includes(cat) ? "var(--accent-primary)" : "var(--border)"}`,
                    background: absCategories.includes(cat) ? "var(--accent-primary)" : "transparent",
                    color: absCategories.includes(cat) ? "#fff" : "var(--text-secondary)",
                    fontSize: "0.75rem", cursor: "pointer", fontFamily: "var(--body-font)", transition: "all 0.15s",
                  }}>
                    <input type="checkbox" checked={absCategories.includes(cat)} onChange={() => toggleCategory(cat, absCategories, setAbsCategories)} style={{ display: "none" }} />
                    {cat}
                  </label>
                ))}
              </div>
            </div>

            {/* Member Authors */}
            <div>
              <label style={labelStyle}>Member Authors</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                {Object.entries(MEMBER_DISPLAY_NAMES).map(([id, name]) => (
                  <label key={id} style={{
                    display: "inline-flex", alignItems: "center", gap: "0.25rem",
                    padding: "0.2rem 0.6rem", borderRadius: "6px",
                    border: `1px solid ${absMemberAuthorIds.includes(id) ? "var(--accent-primary)" : "var(--border)"}`,
                    background: absMemberAuthorIds.includes(id) ? "var(--accent-primary)" : "transparent",
                    color: absMemberAuthorIds.includes(id) ? "#fff" : "var(--text-secondary)",
                    fontSize: "0.75rem", cursor: "pointer", fontFamily: "var(--body-font)", transition: "all 0.15s",
                  }}>
                    <input type="checkbox" checked={absMemberAuthorIds.includes(id)} onChange={() => toggleMember(id)} style={{ display: "none" }} />
                    {name}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label style={{ ...labelStyle, display: "inline-flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input type="checkbox" checked={absIsMemberPaper} onChange={(e) => setAbsIsMemberPaper(e.target.checked)} />
                Is Member Paper
              </label>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button onClick={saveAbstract} className="btn-primary" style={{ fontSize: "0.85rem", padding: "0.6rem 1.5rem" }}>
                Save Abstract
              </button>
              <button
                onClick={() => {
                  if (!absTitle.trim()) { setError("Title is required"); return; }
                  const abs: ConferenceAbstract = {
                    id: `abs-new-${Date.now()}`, title: absTitle.trim(), authors: absAuthors,
                    conference: absConference.trim(), presentationType: absPresentationType,
                    date: absDate, location: absLocation, year: absYear,
                    memberAuthorIds: absMemberAuthorIds, isMemberPaper: absIsMemberPaper, categories: absCategories,
                  };
                  showGeneratedCode(generateAbstractCode(abs));
                }}
                className="btn-secondary" style={{ fontSize: "0.85rem", padding: "0.6rem 1.5rem" }}
              >
                Generate Code
              </button>
              <button onClick={clearAbstractForm} className="btn-secondary" style={{ fontSize: "0.85rem", padding: "0.6rem 1.5rem" }}>
                Clear Form
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === "cv-importer" && <CVImporter />}

      {/* Code Modal */}
      {showCode && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex",
            alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "2rem",
          }}
          onClick={() => setShowCode(false)}
        >
          <div
            className="card"
            style={{ maxWidth: 700, width: "100%", maxHeight: "80vh", overflow: "auto", padding: "1.5rem" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ fontFamily: "var(--heading-font)", fontSize: "1rem" }}>Generated TypeScript Code</h3>
              <button
                onClick={() => { navigator.clipboard.writeText(codeContent); }}
                className="btn-primary"
                style={{ fontSize: "0.8rem", padding: "0.4rem 1rem" }}
              >
                Copy to Clipboard
              </button>
            </div>
            <pre style={{
              background: "var(--bg)", padding: "1rem", borderRadius: "8px", fontSize: "0.8rem",
              overflow: "auto", fontFamily: "monospace", color: "var(--text)", lineHeight: 1.5,
              border: "1px solid var(--border)",
            }}>
              {codeContent}
            </pre>
            <button onClick={() => setShowCode(false)} className="btn-secondary"
              style={{ marginTop: "1rem", fontSize: "0.85rem", padding: "0.5rem 1.25rem" }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Saved Publications */}
      {savedPubs.length > 0 && (
        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h2 style={{ fontSize: "1rem", fontFamily: "var(--heading-font)" }}>
              Saved Publications ({savedPubs.length})
            </h2>
            <button onClick={exportAllPubs} className="btn-secondary" style={{ fontSize: "0.8rem", padding: "0.4rem 1rem" }}>
              Export All as TypeScript
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {savedPubs.map((pub) => (
              <div
                key={pub.id}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem",
                  padding: "0.75rem", borderRadius: "8px", background: "var(--bg)", border: "1px solid var(--border)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.2rem" }}>{pub.title}</p>
                  <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    <em>{pub.journal}</em> ({pub.year})
                  </p>
                </div>
                <div style={{ display: "flex", gap: "0.3rem", flexShrink: 0 }}>
                  <button
                    onClick={() => showGeneratedCode(generatePublicationCode(pub))}
                    className="btn-secondary"
                    style={{ fontSize: "0.7rem", padding: "0.3rem 0.6rem" }}
                  >
                    Code
                  </button>
                  <button
                    onClick={() => deletePub(pub.id)}
                    style={{
                      background: "none", border: "1px solid #ef4444", color: "#ef4444",
                      borderRadius: "6px", fontSize: "0.7rem", padding: "0.3rem 0.6rem", cursor: "pointer",
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Saved Abstracts */}
      {savedAbstracts.length > 0 && (
        <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h2 style={{ fontSize: "1rem", fontFamily: "var(--heading-font)" }}>
              Saved Abstracts ({savedAbstracts.length})
            </h2>
            <button onClick={exportAllAbstracts} className="btn-secondary" style={{ fontSize: "0.8rem", padding: "0.4rem 1rem" }}>
              Export All as TypeScript
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {savedAbstracts.map((abs) => (
              <div
                key={abs.id}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem",
                  padding: "0.75rem", borderRadius: "8px", background: "var(--bg)", border: "1px solid var(--border)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.2rem" }}>{abs.title}</p>
                  <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                    <em>{abs.conference}</em> ({abs.year})
                  </p>
                </div>
                <div style={{ display: "flex", gap: "0.3rem", flexShrink: 0 }}>
                  <button
                    onClick={() => showGeneratedCode(generateAbstractCode(abs))}
                    className="btn-secondary"
                    style={{ fontSize: "0.7rem", padding: "0.3rem 0.6rem" }}
                  >
                    Code
                  </button>
                  <button
                    onClick={() => deleteAbstract(abs.id)}
                    style={{
                      background: "none", border: "1px solid #ef4444", color: "#ef4444",
                      borderRadius: "6px", fontSize: "0.7rem", padding: "0.3rem 0.6rem", cursor: "pointer",
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* ─── Member Management Tab ─────────────────────────────────────── */}
      {tab === "members" && (
        <div>
          {/* Search bar */}
          <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
            <h2 style={{ fontSize: "1rem", fontFamily: "var(--heading-font)", marginBottom: "0.75rem" }}>
              Member Management
            </h2>
            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "1rem", fontFamily: "var(--body-font)" }}>
              Edit any member&apos;s profile, upload photos, and manage CVs. Changes are saved to localStorage.
            </p>
            <input
              type="text"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Search members by name, institution, or role..."
              style={inputStyle}
            />
          </div>

          {/* Member list or edit form */}
          {editingMember && memberForm ? (
            <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
                <h2 style={{ fontSize: "1rem", fontFamily: "var(--heading-font)", margin: 0 }}>
                  Editing: {editingMember.name}
                </h2>
                <button
                  onClick={() => { setEditingMember(null); setMemberForm(null); setMemberPhotoPreview(null); setMemberSaved(false); }}
                  className="btn-secondary"
                  style={{ fontSize: "0.8rem", padding: "0.4rem 1rem" }}
                >
                  Back to List
                </button>
              </div>

              {/* Photo section */}
              <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", marginBottom: "1.5rem" }}>
                <div
                  style={{
                    width: 72, height: 72, borderRadius: "50%", overflow: "hidden",
                    background: "var(--accent-primary)", display: "flex", alignItems: "center",
                    justifyContent: "center", flexShrink: 0, border: "3px solid var(--border)",
                  }}
                >
                  {memberPhotoPreview ? (
                    <img src={memberPhotoPreview} alt={editingMember.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <span style={{ color: "white", fontSize: "1.25rem", fontWeight: 700, fontFamily: "var(--heading-font)" }}>
                      {editingMember.name.split(" ").filter(Boolean).map(p => p[0]).join("").toUpperCase().slice(0, 2)}
                    </span>
                  )}
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => memberPhotoRef.current?.click()}
                    style={{
                      padding: "0.4rem 0.85rem", borderRadius: 6, border: "1px solid var(--border)",
                      background: "var(--bg)", color: "var(--accent-primary)", fontSize: "0.8rem",
                      fontWeight: 600, cursor: "pointer", fontFamily: "var(--body-font)",
                    }}
                  >
                    Upload Photo
                  </button>
                  <input
                    ref={memberPhotoRef}
                    type="file"
                    accept="image/*"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file || !editingMember) return;
                      const reader = new FileReader();
                      reader.onload = (ev) => setMemberPhotoPreview(ev.target?.result as string);
                      reader.readAsDataURL(file);
                      // Try Supabase upload
                      try {
                        const ext = file.name.split(".").pop();
                        const path = `photos/${editingMember.id}.${ext}`;
                        const { error } = await supabase.storage.from("member-files").upload(path, file, { upsert: true });
                        if (!error) {
                          const { data: urlData } = supabase.storage.from("member-files").getPublicUrl(path);
                          setMemberForm(f => f ? { ...f, photoUrl: urlData.publicUrl } : f);
                          return;
                        }
                      } catch { /* Supabase not available */ }
                      // Fallback: store as data URL reference
                      setMemberForm(f => f ? { ...f, photoUrl: `[uploaded:${file.name}]` } : f);
                    }}
                    style={{ display: "none" }}
                  />
                  <span style={{ marginLeft: 8, fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                    {memberForm.photoUrl ? "Photo set" : "No photo"}
                  </span>
                </div>
              </div>

              {/* Edit fields */}
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div>
                    <label style={labelStyle}>Full Name</label>
                    <input type="text" value={memberForm.name} onChange={(e) => setMemberForm(f => f ? { ...f, name: e.target.value } : f)} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Title / Credentials</label>
                    <input type="text" value={memberForm.title} onChange={(e) => setMemberForm(f => f ? { ...f, title: e.target.value } : f)} style={inputStyle} placeholder="MD, PhD" />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div>
                    <label style={labelStyle}>Role</label>
                    <input type="text" value={memberForm.role} onChange={(e) => setMemberForm(f => f ? { ...f, role: e.target.value } : f)} style={inputStyle} placeholder="e.g. Co-Director, Member" />
                  </div>
                  <div>
                    <label style={labelStyle}>Institution</label>
                    <input type="text" value={memberForm.institution} onChange={(e) => setMemberForm(f => f ? { ...f, institution: e.target.value } : f)} style={inputStyle} />
                  </div>
                </div>

                <div>
                  <label style={labelStyle}>Department</label>
                  <input type="text" value={memberForm.department} onChange={(e) => setMemberForm(f => f ? { ...f, department: e.target.value } : f)} style={inputStyle} />
                </div>

                <div>
                  <label style={labelStyle}>Bio ({memberForm.bio.length} / 2000 characters)</label>
                  <textarea
                    value={memberForm.bio}
                    onChange={(e) => { if (e.target.value.length <= 2000) setMemberForm(f => f ? { ...f, bio: e.target.value } : f); }}
                    rows={5}
                    placeholder="Research and clinical background..."
                    style={{ ...inputStyle, resize: "vertical", minHeight: 120 }}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Research Interests (comma-separated)</label>
                  <input
                    type="text"
                    value={memberForm.interests}
                    onChange={(e) => setMemberForm(f => f ? { ...f, interests: e.target.value } : f)}
                    style={inputStyle}
                    placeholder="EEG monitoring, Status epilepticus, Neuroprognostication"
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div>
                    <label style={labelStyle}>Email</label>
                    <input type="email" value={memberForm.email} onChange={(e) => setMemberForm(f => f ? { ...f, email: e.target.value } : f)} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>ORCID ID</label>
                    <input type="text" value={memberForm.orcidId} onChange={(e) => setMemberForm(f => f ? { ...f, orcidId: e.target.value } : f)} style={inputStyle} placeholder="0000-0000-0000-0000" />
                  </div>
                </div>

                <div>
                  <label style={labelStyle}>Website URL</label>
                  <input type="url" value={memberForm.websiteUrl} onChange={(e) => setMemberForm(f => f ? { ...f, websiteUrl: e.target.value } : f)} style={inputStyle} placeholder="https://..." />
                </div>

                {/* CV Upload */}
                <div>
                  <label style={labelStyle}>Curriculum Vitae</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <button
                      type="button"
                      onClick={() => memberCvRef.current?.click()}
                      style={{
                        padding: "0.4rem 0.85rem", borderRadius: 6, border: "1px solid var(--border)",
                        background: "var(--bg)", color: "var(--accent-primary)", fontSize: "0.8rem",
                        fontWeight: 600, cursor: "pointer", fontFamily: "var(--body-font)",
                      }}
                    >
                      Upload CV
                    </button>
                    <input
                      ref={memberCvRef}
                      type="file"
                      accept=".pdf,.docx,.doc"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file || !editingMember) return;
                        // Try Supabase upload
                        try {
                          const path = `cvs/${editingMember.id}/${file.name}`;
                          const { error } = await supabase.storage.from("member-files").upload(path, file, { upsert: true });
                          if (!error) {
                            setMemberForm(f => f ? { ...f, cvFilename: file.name } : f);
                            return;
                          }
                        } catch { /* Supabase not available */ }
                        setMemberForm(f => f ? { ...f, cvFilename: file.name } : f);
                      }}
                      style={{ display: "none" }}
                    />
                    {memberForm.cvFilename && (
                      <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem", fontFamily: "var(--body-font)" }}>
                        {memberForm.cvFilename}
                      </span>
                    )}
                  </div>
                </div>

                {/* Save / Cancel */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border)" }}>
                  <button
                    onClick={() => {
                      if (!editingMember || !memberForm) return;
                      setMemberSaving(true);
                      // TODO: Supabase integration will persist these changes to the database.
                      // For now, store overrides in localStorage so they survive page reloads.
                      const overrides: Partial<Member> = {
                        name: memberForm.name,
                        title: memberForm.title,
                        role: memberForm.role,
                        institution: memberForm.institution,
                        department: memberForm.department,
                        bio: memberForm.bio,
                        interests: memberForm.interests.split(",").map(s => s.trim()).filter(Boolean),
                        email: memberForm.email,
                        orcidId: memberForm.orcidId,
                        websiteUrl: memberForm.websiteUrl,
                        photoUrl: memberForm.photoUrl,
                      };
                      const updated = { ...memberOverrides, [editingMember.id]: overrides };
                      setMemberOverrides(updated);
                      try {
                        localStorage.setItem("pedquest-admin-member-overrides", JSON.stringify(updated));
                        if (memberForm.cvFilename) {
                          localStorage.setItem(`pedquest_cv_${editingMember.id}`, memberForm.cvFilename);
                        }
                      } catch { /* ignore */ }
                      setMemberSaving(false);
                      setMemberSaved(true);
                    }}
                    disabled={memberSaving}
                    className="btn-primary"
                    style={{ fontSize: "0.85rem", padding: "0.6rem 1.5rem", cursor: memberSaving ? "wait" : "pointer", opacity: memberSaving ? 0.7 : 1 }}
                  >
                    {memberSaving ? "Saving..." : "Save Changes"}
                  </button>
                  <button
                    onClick={() => { setEditingMember(null); setMemberForm(null); setMemberPhotoPreview(null); setMemberSaved(false); }}
                    className="btn-secondary"
                    style={{ fontSize: "0.85rem", padding: "0.6rem 1.5rem" }}
                  >
                    Cancel
                  </button>
                  {memberSaved && (
                    <span style={{ color: "var(--accent-primary)", fontSize: "0.85rem", fontWeight: 600, fontFamily: "var(--body-font)" }}>
                      Changes saved!
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Member list */
            <div className="card" style={{ padding: "1.5rem" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {members
                  .filter((m) => {
                    if (!memberSearch.trim()) return true;
                    const q = memberSearch.toLowerCase();
                    return (
                      m.name.toLowerCase().includes(q) ||
                      m.institution.toLowerCase().includes(q) ||
                      (m.role && m.role.toLowerCase().includes(q)) ||
                      (m.department && m.department.toLowerCase().includes(q))
                    );
                  })
                  .map((m) => {
                    const overridden = memberOverrides[m.id];
                    const displayMember = overridden ? { ...m, ...overridden } : m;
                    return (
                      <div
                        key={m.id}
                        onClick={() => {
                          setEditingMember(m);
                          const dm = displayMember;
                          setMemberForm({
                            name: dm.name,
                            title: dm.title || "",
                            role: dm.role || "",
                            institution: dm.institution,
                            department: dm.department || "",
                            bio: dm.bio || "",
                            interests: (dm.interests || []).join(", "),
                            email: dm.email || "",
                            orcidId: dm.orcidId || "",
                            websiteUrl: dm.websiteUrl || "",
                            photoUrl: dm.photoUrl || "",
                            cvFilename: "",
                          });
                          setMemberPhotoPreview(dm.photoUrl || null);
                          setMemberSaved(false);
                          // Load CV filename from localStorage
                          try {
                            const storedCv = localStorage.getItem(`pedquest_cv_${m.id}`);
                            if (storedCv) setMemberForm(f => f ? { ...f, cvFilename: storedCv } : f);
                          } catch { /* ignore */ }
                        }}
                        style={{
                          display: "flex", alignItems: "center", gap: "1rem",
                          padding: "0.75rem 1rem", borderRadius: 8, border: "1px solid var(--border)",
                          cursor: "pointer", transition: "all 0.15s", background: "var(--bg-card)",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent-primary)"; e.currentTarget.style.background = "var(--bg-card-hover, var(--bg))"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-card)"; }}
                      >
                        {/* Avatar */}
                        <div style={{
                          width: 40, height: 40, borderRadius: "50%", overflow: "hidden",
                          background: "var(--accent-primary)", display: "flex", alignItems: "center",
                          justifyContent: "center", flexShrink: 0,
                        }}>
                          {displayMember.photoUrl ? (
                            <img src={displayMember.photoUrl} alt={displayMember.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            <span style={{ color: "white", fontSize: "0.75rem", fontWeight: 700, fontFamily: "var(--heading-font)" }}>
                              {displayMember.name.split(" ").filter(Boolean).map(p => p[0]).join("").toUpperCase().slice(0, 2)}
                            </span>
                          )}
                        </div>
                        {/* Info */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text)", fontFamily: "var(--body-font)" }}>
                            {displayMember.name}
                            {displayMember.title && <span style={{ fontWeight: 400, color: "var(--text-secondary)" }}>, {displayMember.title}</span>}
                          </div>
                          <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", fontFamily: "var(--body-font)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {displayMember.institution}
                            {displayMember.department && ` — ${displayMember.department}`}
                          </div>
                        </div>
                        {/* Edit indicator */}
                        {overridden && (
                          <span style={{ fontSize: "0.7rem", padding: "0.2rem 0.5rem", borderRadius: 4, background: "var(--accent-primary)", color: "white", fontFamily: "var(--body-font)", flexShrink: 0 }}>
                            edited
                          </span>
                        )}
                        <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem", flexShrink: 0 }}>
                          Edit &rarr;
                        </span>
                      </div>
                    );
                  })}
                {members.filter((m) => {
                  if (!memberSearch.trim()) return true;
                  const q = memberSearch.toLowerCase();
                  return m.name.toLowerCase().includes(q) || m.institution.toLowerCase().includes(q) || (m.role && m.role.toLowerCase().includes(q)) || (m.department && m.department.toLowerCase().includes(q));
                }).length === 0 && (
                  <p style={{ textAlign: "center", color: "var(--text-secondary)", padding: "2rem", fontSize: "0.9rem" }}>
                    No members match your search.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

// Error boundary wrapper
import { Component, type ReactNode, type ErrorInfo } from "react";

class AdminErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Admin page error:", error, info); }
  render() {
    if (this.state.error) {
      return (
        <main style={{ maxWidth: 600, margin: "0 auto", padding: "4rem 1.5rem", textAlign: "center" }}>
          <h1 style={{ fontFamily: "var(--heading-font)", fontSize: "1.8rem", marginBottom: "1rem" }}>Something went wrong</h1>
          <p style={{ color: "var(--text-secondary)", marginBottom: "1rem" }}>{this.state.error.message}</p>
          <button onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            style={{ padding: "0.75rem 2rem", borderRadius: 8, background: "var(--accent-primary)", color: "white", border: "none", cursor: "pointer", fontWeight: 600 }}>
            Reload
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

export default function AdminPage() {
  return <AdminErrorBoundary><AdminPageInner /></AdminErrorBoundary>;
}
