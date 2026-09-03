"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { publications, publicationCategories } from "@/data/publications";
import { conferenceAbstracts, abstractCategories } from "@/data/abstracts";
import { educationResources } from "@/data/education";
import type { Publication } from "@/data/publications";
import type { ConferenceAbstract } from "@/data/abstracts";
import { useUser } from "@/lib/auth";
import { members, type Member } from "@/data/members";
import { supabase, getSupabase } from "@/lib/supabase";
import { MEMBER_NAME_MAP, MEMBER_DISPLAY_NAMES, matchMemberAuthors } from "@/lib/memberMatch";

const CVImporter = dynamic(() => import("./CVImporter"), {
  ssr: false,
  loading: () => <p style={{ color: "var(--text-secondary)", padding: "2rem" }}>Loading CV Importer...</p>,
});

type AdminTab = "dashboard" | "publication" | "abstract" | "cv-importer" | "members";

const TAB_TITLES: Record<AdminTab, string> = {
  dashboard: "Dashboard",
  publication: "Publications",
  abstract: "Conference abstracts",
  "cv-importer": "CV importer",
  members: "Members",
};

// Admin emails — only these users can access the admin page
const ADMIN_EMAILS = [
  "pressca@chop.edu",
  "craigpress@gmail.com",
  "gbenedet@med.umich.edu",
  "ajay.thomas@bcm.edu",
];



const STORAGE_KEY = "pedquest-new-publications";
const STORAGE_KEY_ABSTRACTS = "pedquest-new-abstracts";


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
  const [tab, setTab] = useState<AdminTab>("dashboard");

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
    city: string; country: string;
    bio: string; interests: string; email: string; orcidId: string; websiteUrl: string;
    photoUrl: string; cvFilename: string;
  } | null>(null);
  const [memberPhotoPreview, setMemberPhotoPreview] = useState<string | null>(null);
  const [memberSaving, setMemberSaving] = useState(false);
  const [memberSaved, setMemberSaved] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  // Members live in the Supabase `members` table; the site renders them from a
  // module regenerated from that table at build time. Saving here is durable
  // and shared - it reaches the site on the next publish.
  type AdminMemberRow = Member & { status: "active" | "archived" | "review" };
  const [dbMembers, setDbMembers] = useState<AdminMemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState<string | null>(null);
  const memberPhotoRef = useRef<HTMLInputElement>(null);
  const memberCvRef = useRef<HTMLInputElement>(null);

  // Load from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setSavedPubs(JSON.parse(stored));
      const storedAbs = localStorage.getItem(STORAGE_KEY_ABSTRACTS);
      if (storedAbs) setSavedAbstracts(JSON.parse(storedAbs));
    } catch { /* ignore */ }
  }, []);

  const authHeaders = useCallback(async (json = true) => {
    const sb = getSupabase();
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : null;
    return { ...(json ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }, []);

  const loadMembers = useCallback(async () => {
    setMembersLoading(true);
    setMemberError(null);
    try {
      const res = await fetch("/api/admin/members", { headers: await authHeaders() });
      const json = await res.json();
      if (res.ok && json.success) setDbMembers(json.members);
      else setMemberError(json.error || "Could not load members.");
    } catch {
      setMemberError("Network error loading members.");
    } finally {
      setMembersLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { void loadMembers(); }, [loadMembers]);

  /** POST to the members endpoint and refresh. Returns true on success. */
  const memberAction = useCallback(async (body: Record<string, unknown>): Promise<boolean> => {
    setMemberError(null);
    try {
      const res = await fetch("/api/admin/members", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setMemberError(json.error || "Save failed.");
        return false;
      }
      await loadMembers();
      return true;
    } catch {
      setMemberError("Network error saving member.");
      return false;
    }
  }, [authHeaders, loadMembers]);

  const publishSite = useCallback(async () => {
    setPublishing(true);
    setPublishMsg(null);
    try {
      const res = await fetch("/api/admin/publish", { method: "POST", headers: await authHeaders() });
      const json = await res.json();
      setPublishMsg(res.ok && json.success ? json.message : (json.error || "Publish failed."));
    } catch {
      setPublishMsg("Network error triggering the rebuild.");
    } finally {
      setPublishing(false);
    }
  }, [authHeaders]);

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

  const NAV_ITEMS: { key: AdminTab; label: string; icon: React.ReactNode }[] = [
    {
      key: "dashboard",
      label: "Dashboard",
      icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>,
    },
    {
      key: "publication",
      label: "Publications",
      icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 5h16v14H4zM8 9h8M8 13h8M8 17h5" /></svg>,
    },
    {
      key: "abstract",
      label: "Abstracts",
      icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 5h16v14H4zM4 8l8 5 8-5" /></svg>,
    },
    {
      key: "cv-importer",
      label: "CV importer",
      icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16" /></svg>,
    },
    {
      key: "members",
      label: "Members",
      icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="8" r="3.2" /><path d="M3 20a6 6 0 0 1 12 0M16 6.5a3 3 0 0 1 0 5.5M21 20a5.5 5.5 0 0 0-4-5.3" /></svg>,
    },
  ];
  const memberCount = dbMembers.filter((m) => m.status === "active").length || members.length;
  const draftCount = savedPubs.length + savedAbstracts.length;

  return (
    <main className="adm-app">
      {/* ── Sidebar ── */}
      <aside className="adm-side">
        <span className="adm-label">Content admin</span>
        <nav className="adm-nav" aria-label="Admin sections">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              className={tab === item.key ? "on" : ""}
              onClick={() => setTab(item.key)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
          <a href="/admin/cases">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 10 12 5 2 10l10 5 10-5ZM6 12v5c0 1 2.7 3 6 3s6-2 6-3v-5" /></svg>
            Education · Cases
          </a>
          <a href="/admin/events">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
            Events
          </a>
        </nav>
        <div className="adm-who">
          <span className="adm-av">{(user?.email ?? "?").slice(0, 2).toUpperCase()}</span>
          <div className="adm-who-txt">
            <span className="adm-who-email">{user?.email}</span>
            <span className="adm-who-role">admin</span>
          </div>
        </div>
      </aside>

      {/* ── Main column ── */}
      <div className="adm-main">
        <div className="adm-topbar">
          <h1>{TAB_TITLES[tab]}</h1>
          {draftCount > 0 && (
            <span className="adm-drafts">{draftCount} local draft{draftCount !== 1 ? "s" : ""} pending export</span>
          )}
        </div>
        <div className="adm-content">

      {tab === "dashboard" && (
        <>
          <div className="adm-banner" role="note">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ flex: "none", marginTop: 1 }}><path d="M12 2 4 6v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V6z" /><path d="m9 12 2 2 4-4" /></svg>
            <div>
              <b>Access &amp; safety.</b> This console is limited to the admin
              allowlist, and database writes are enforced by Row-Level Security
              on the server — the same rules apply even if the API is bypassed.
            </div>
          </div>
          <div className="adm-cards">
            <button className="adm-card" onClick={() => setTab("members")}>
              <span className="n">{memberCount}</span>
              <span className="l">Members</span>
            </button>
            <button className="adm-card" onClick={() => setTab("publication")}>
              <span className="n">{publications.length}</span>
              <span className="l">Publications · <b>auto-synced</b></span>
            </button>
            <button className="adm-card" onClick={() => setTab("abstract")}>
              <span className="n">{conferenceAbstracts.length}</span>
              <span className="l">Conference abstracts</span>
            </button>
            <a className="adm-card" href="/education">
              <span className="n">{educationResources.length}</span>
              <span className="l">Education resources</span>
            </a>
          </div>
          <div className="adm-scanrow">
            <span className="ic">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5" /></svg>
            </span>
            <div className="txt">
              <span className="t">PubMed publication scanner</span>
              <span className="s">
                Runs automatically on a schedule — new member papers import
                from PubMed by author; manual entries and edits are preserved
                across syncs.
              </span>
            </div>
            <a className="adm-mini" href="/publications">View library</a>
          </div>
        </>
      )}

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
              <div className="adm-form-row-3a">
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
              <div className="adm-form-row-3">
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

            <div className="adm-form-row-2a">
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

            <div className="adm-form-row-3">
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
          {/* Search bar and Add button */}
          <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <h2 style={{ fontSize: "1rem", fontFamily: "var(--heading-font)", margin: 0 }}>
                Member Management
              </h2>
              <button
                onClick={() => {
                  setEditingMember(null);
                  setAddingMember(true);
                  setMemberForm({
                    name: "", title: "", role: "", institution: "", department: "",
                    city: "", country: "USA",
                    bio: "", interests: "", email: "", orcidId: "", websiteUrl: "",
                    photoUrl: "", cvFilename: "",
                  });
                  setMemberPhotoPreview(null);
                  setMemberSaved(false);
                }}
                className="btn-primary"
                style={{ fontSize: "0.8rem", padding: "0.5rem 1rem" }}
              >
                + Add Member
              </button>
            </div>
            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "1rem", fontFamily: "var(--body-font)" }}>
              Add, edit, or archive members. Changes save to the database immediately; press Publish to rebuild the site with them.
            </p>
            <input
              type="text"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Search members by name, institution, or role..."
              style={inputStyle}
            />
            {memberError && (
              <p role="alert" style={{ marginTop: "0.75rem", color: "var(--accent-secondary)", fontSize: "0.85rem", fontFamily: "var(--body-font)" }}>
                {memberError}
              </p>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
              <span style={{ color: "var(--text-muted)", fontSize: "0.8rem", fontFamily: "var(--body-font)" }}>
                {membersLoading
                  ? "Loading members…"
                  : `${dbMembers.filter((m) => m.status === "active").length} active · ${dbMembers.filter((m) => m.status === "archived").length} archived · ${dbMembers.filter((m) => m.status === "review").length} needs review`}
              </span>
              <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "var(--text-secondary)", fontSize: "0.8rem", fontFamily: "var(--body-font)", cursor: "pointer" }}>
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                Show archived &amp; review
              </label>
              <button
                onClick={publishSite}
                disabled={publishing}
                className="btn-secondary"
                style={{ marginLeft: "auto", fontSize: "0.8rem", padding: "0.5rem 1.1rem", cursor: publishing ? "wait" : "pointer", opacity: publishing ? 0.7 : 1 }}
                title="Rebuild the live site from the database"
              >
                {publishing ? "Publishing…" : "Publish to site"}
              </button>
            </div>
            {publishMsg && (
              <p style={{ marginTop: "0.5rem", color: "var(--accent-primary)", fontSize: "0.8rem", fontFamily: "var(--body-font)" }}>
                {publishMsg}
              </p>
            )}
          </div>

          {(editingMember || addingMember) && memberForm ? (
            <div className="card" style={{ padding: "1.5rem", marginBottom: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
                <h2 style={{ fontSize: "1rem", fontFamily: "var(--heading-font)", margin: 0 }}>
                  {addingMember ? "Add New Member" : `Editing: ${editingMember!.name}`}
                </h2>
                <button
                  onClick={() => { setEditingMember(null); setAddingMember(false); setMemberForm(null); setMemberPhotoPreview(null); setMemberSaved(false); }}
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
                    <img src={memberPhotoPreview} alt={memberForm.name || "New member"} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <span style={{ color: "white", fontSize: "1.25rem", fontWeight: 700, fontFamily: "var(--heading-font)" }}>
                      {(memberForm.name || "?").split(" ").filter(Boolean).map(p => p[0]).join("").toUpperCase().slice(0, 2)}
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
                      if (!file) return;
                      const memberId = editingMember?.id || memberForm?.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "new";
                      const reader = new FileReader();
                      reader.onload = (ev) => setMemberPhotoPreview(ev.target?.result as string);
                      reader.readAsDataURL(file);
                      // Try Supabase upload
                      try {
                        const ext = file.name.split(".").pop();
                        const path = `photos/${memberId}.${ext}`;
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
                <div className="adm-form-row-2">
                  <div>
                    <label style={labelStyle}>Full Name</label>
                    <input type="text" value={memberForm.name} onChange={(e) => setMemberForm(f => f ? { ...f, name: e.target.value } : f)} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Title / Credentials</label>
                    <input type="text" value={memberForm.title} onChange={(e) => setMemberForm(f => f ? { ...f, title: e.target.value } : f)} style={inputStyle} placeholder="MD, PhD" />
                  </div>
                </div>

                <div className="adm-form-row-2">
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

                <div className="adm-form-row-2">
                  <div>
                    <label style={labelStyle}>Email</label>
                    <input type="email" value={memberForm.email} onChange={(e) => setMemberForm(f => f ? { ...f, email: e.target.value } : f)} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>ORCID ID</label>
                    <input type="text" value={memberForm.orcidId} onChange={(e) => setMemberForm(f => f ? { ...f, orcidId: e.target.value } : f)} style={inputStyle} placeholder="0000-0000-0000-0000" />
                  </div>
                </div>

                <div className="adm-form-row-2">
                  <div>
                    <label style={labelStyle}>City</label>
                    <input type="text" value={memberForm.city} onChange={(e) => setMemberForm(f => f ? { ...f, city: e.target.value } : f)} style={inputStyle} placeholder="Philadelphia, PA" />
                  </div>
                  <div>
                    <label style={labelStyle}>Country</label>
                    <input type="text" value={memberForm.country} onChange={(e) => setMemberForm(f => f ? { ...f, country: e.target.value } : f)} style={inputStyle} placeholder="USA" />
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
                        if (!file) return;
                        const memberId = editingMember?.id || memberForm?.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "new";
                        // Try Supabase upload
                        try {
                          const path = `cvs/${memberId}/${file.name}`;
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

                {/* Save / Delete / Cancel */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border)", flexWrap: "wrap" }}>
                  <button
                    onClick={async () => {
                      if (!memberForm) return;
                      if (!memberForm.name.trim()) { setMemberError("Name is required."); return; }
                      setMemberSaving(true);
                      const ok = await memberAction({
                        action: "save",
                        member: {
                          id: editingMember?.id,
                          name: memberForm.name,
                          title: memberForm.title,
                          role: memberForm.role,
                          institution: memberForm.institution,
                          department: memberForm.department,
                          city: memberForm.city,
                          country: memberForm.country,
                          bio: memberForm.bio,
                          interests: memberForm.interests.split(",").map((t) => t.trim()).filter(Boolean),
                          email: memberForm.email,
                          orcidId: memberForm.orcidId,
                          websiteUrl: memberForm.websiteUrl,
                          photoUrl: memberForm.photoUrl,
                          // Preserved rather than reset: this form doesn't expose them.
                          lat: editingMember?.lat,
                          lng: editingMember?.lng,
                          authEmail: editingMember?.authEmail,
                          isLeadership: editingMember?.isLeadership ?? false,
                          leadershipRole: editingMember?.leadershipRole,
                          sortOrder: editingMember?.sortOrder,
                          status: editingMember ? (editingMember as AdminMemberRow).status : "active",
                        },
                      });
                      setMemberSaving(false);
                      if (ok) {
                        setMemberSaved(true);
                        if (addingMember) {
                          setAddingMember(false);
                          setMemberForm(null);
                          setMemberPhotoPreview(null);
                        }
                      }
                    }}
                    disabled={memberSaving || (!addingMember && !memberForm?.name.trim())}
                    className="btn-primary"
                    style={{ fontSize: "0.85rem", padding: "0.6rem 1.5rem", cursor: memberSaving ? "wait" : "pointer", opacity: memberSaving ? 0.7 : 1 }}
                  >
                    {memberSaving ? "Saving..." : addingMember ? "Add Member" : "Save Changes"}
                  </button>
                  <button
                    onClick={() => { setEditingMember(null); setAddingMember(false); setMemberForm(null); setMemberPhotoPreview(null); setMemberSaved(false); }}
                    className="btn-secondary"
                    style={{ fontSize: "0.85rem", padding: "0.6rem 1.5rem" }}
                  >
                    Cancel
                  </button>
                  {/* Delete button — only for existing members, not while adding */}
                  {editingMember && !addingMember && (
                    <button
                      onClick={async () => {
                        if (!editingMember) return;
                        if (!confirm(`Archive ${editingMember.name}? They come off the site at the next publish, and the record is kept.`)) return;
                        const ok = await memberAction({ action: "archive", id: editingMember.id });
                        if (ok) {
                          setEditingMember(null);
                          setMemberForm(null);
                          setMemberPhotoPreview(null);
                          setMemberSaved(false);
                        }
                      }}
                      style={{
                        marginLeft: "auto", fontSize: "0.85rem", padding: "0.6rem 1.5rem",
                        borderRadius: 8, border: "1px solid #ef4444", background: "transparent",
                        color: "#ef4444", cursor: "pointer", fontWeight: 600, fontFamily: "var(--body-font)",
                      }}
                    >
                      Archive Member
                    </button>
                  )}
                  {memberSaved && (
                    <span style={{ color: "var(--accent-primary)", fontSize: "0.85rem", fontWeight: 600, fontFamily: "var(--body-font)" }}>
                      {addingMember ? "" : "Changes saved!"}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Member list */
            <div className="card" style={{ padding: "1.5rem" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {dbMembers
                  .filter((m) => (showArchived ? true : m.status === "active"))
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
                    const displayMember = m;
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
                            city: dm.city || "",
                            country: dm.country || "",
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
                        {m.status !== "active" && (
                          <span style={{
                            fontSize: "0.7rem", padding: "0.2rem 0.5rem", borderRadius: 4, flexShrink: 0,
                            fontFamily: "var(--body-font)",
                            background: m.status === "archived" ? "rgba(125,147,169,0.2)" : "rgba(240,169,74,0.2)",
                            color: m.status === "archived" ? "var(--text-muted)" : "var(--accent-secondary)",
                          }}>
                            {m.status === "archived" ? "archived" : "needs review"}
                          </span>
                        )}
                        <span style={{ color: "var(--text-secondary)", fontSize: "0.85rem", flexShrink: 0 }}>
                          Edit &rarr;
                        </span>
                      </div>
                    );
                  })}
                {dbMembers.filter((m) => (showArchived ? true : m.status === "active")).filter((m) => {
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
        </div>
      </div>

      <style>{`
        /* ── Admin shell (mockup sidebar layout; dark instrument tokens) ── */
        .adm-app {
          display: grid; grid-template-columns: 230px 1fr;
          max-width: 1320px; margin: 0 auto; min-height: calc(100vh - 88px);
          align-items: stretch;
        }
        .adm-side {
          display: flex; flex-direction: column; gap: 1rem;
          padding: 1.75rem 1rem 1.25rem; border-right: 1px solid var(--line);
        }
        .adm-label {
          font-family: var(--mono-font); font-size: 0.68rem; font-weight: 600;
          letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted);
          padding: 0 0.65rem;
        }
        .adm-nav { display: flex; flex-direction: column; gap: 2px; flex: 1; }
        .adm-nav button, .adm-nav a {
          display: flex; align-items: center; gap: 0.6rem; width: 100%;
          padding: 0.55rem 0.65rem; border-radius: 9px; text-align: left;
          font-family: var(--body-font); font-size: 0.88rem; font-weight: 500;
          color: var(--ink-2); background: transparent; border: none; cursor: pointer;
          text-decoration: none;
        }
        .adm-nav button:hover, .adm-nav a:hover { background: var(--surface-2); color: var(--ink); }
        .adm-nav button.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
        .adm-who {
          display: flex; align-items: center; gap: 0.6rem; padding: 0.75rem 0.65rem 0;
          border-top: 1px solid var(--line);
        }
        .adm-av {
          display: inline-flex; align-items: center; justify-content: center;
          width: 32px; height: 32px; border-radius: 50%; flex: none;
          background: var(--accent-soft); color: var(--accent);
          font-family: var(--mono-font); font-size: 0.72rem; font-weight: 700;
        }
        .adm-who-txt { display: flex; flex-direction: column; min-width: 0; }
        .adm-who-email {
          font-size: 0.78rem; color: var(--ink); overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap;
        }
        .adm-who-role {
          font-family: var(--mono-font); font-size: 0.64rem; letter-spacing: 0.08em;
          text-transform: uppercase; color: var(--muted);
        }

        .adm-main { min-width: 0; }
        .adm-topbar {
          display: flex; align-items: baseline; justify-content: space-between; gap: 1rem;
          padding: 1.6rem 2rem 1.1rem; border-bottom: 1px solid var(--line);
        }
        .adm-topbar h1 {
          font-family: var(--heading-font); font-size: 1.55rem; font-weight: 700;
          color: var(--ink);
        }
        .adm-drafts {
          font-family: var(--mono-font); font-size: 0.72rem; color: var(--warm);
        }
        .adm-content { padding: 1.6rem 2rem 3rem; }

        /* Form rows — collapse to a single column on phones */
        .adm-form-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
        .adm-form-row-2a { display: grid; grid-template-columns: 2fr 1fr; gap: 0.75rem; }
        .adm-form-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem; }
        .adm-form-row-3a { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 0.75rem; }
        @media (max-width: 640px) {
          .adm-form-row-2, .adm-form-row-2a, .adm-form-row-3, .adm-form-row-3a { grid-template-columns: 1fr; }
        }

        .adm-banner {
          display: flex; gap: 0.7rem; padding: 0.95rem 1.1rem; margin-bottom: 1.25rem;
          border: 1px solid var(--accent-soft); border-radius: 12px;
          background: color-mix(in srgb, var(--accent-soft) 55%, transparent);
          font-size: 0.88rem; line-height: 1.55; color: var(--ink-2);
        }
        .adm-banner b { color: var(--ink); }
        .adm-cards {
          display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.9rem;
          margin-bottom: 1.25rem;
        }
        .adm-card {
          display: flex; flex-direction: column; gap: 0.2rem; padding: 1.1rem 1.2rem;
          background: var(--surface); border: 1px solid var(--line); border-radius: 13px;
          cursor: pointer; text-align: left; text-decoration: none;
          transition: border-color 0.15s;
        }
        .adm-card:hover { border-color: var(--accent); }
        .adm-card .n {
          font-family: var(--heading-font); font-size: 1.7rem; font-weight: 700;
          color: var(--ink);
        }
        .adm-card .l {
          font-family: var(--mono-font); font-size: 0.68rem; letter-spacing: 0.06em;
          text-transform: uppercase; color: var(--muted);
        }
        .adm-card .l b { color: var(--accent); font-weight: 600; }
        .adm-scanrow {
          display: flex; align-items: center; gap: 0.9rem; padding: 1rem 1.2rem;
          background: var(--surface); border: 1px solid var(--line); border-radius: 13px;
        }
        .adm-scanrow .ic {
          display: inline-flex; align-items: center; justify-content: center;
          width: 40px; height: 40px; border-radius: 11px; flex: none;
          background: var(--accent-soft); color: var(--accent);
        }
        .adm-scanrow .txt { display: flex; flex-direction: column; gap: 0.15rem; flex: 1; }
        .adm-scanrow .t { font-weight: 600; font-size: 0.95rem; color: var(--ink); }
        .adm-scanrow .s { font-size: 0.82rem; color: var(--muted); line-height: 1.5; }
        .adm-mini {
          font-family: var(--mono-font); font-size: 0.75rem; color: var(--accent);
          border: 1px solid var(--line); border-radius: 8px; padding: 0.5rem 0.9rem;
          white-space: nowrap; text-decoration: none;
        }
        .adm-mini:hover { border-color: var(--accent); }

        @media (max-width: 900px) {
          .adm-app { grid-template-columns: 1fr; }
          .adm-side {
            flex-direction: row; align-items: center; flex-wrap: wrap;
            border-right: none; border-bottom: 1px solid var(--line);
            padding: 1rem 1.25rem;
          }
          .adm-nav { flex-direction: row; flex-wrap: wrap; }
          .adm-nav button, .adm-nav a { width: auto; }
          .adm-who { border-top: none; padding: 0; margin-left: auto; }
          .adm-label { display: none; }
          .adm-cards { grid-template-columns: repeat(2, 1fr); }
          .adm-topbar, .adm-content { padding-left: 1.25rem; padding-right: 1.25rem; }
        }
      `}</style>
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
