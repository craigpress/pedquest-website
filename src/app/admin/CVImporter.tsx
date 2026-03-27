"use client";

import { useState, useCallback } from "react";
import type { Publication } from "@/data/publications";
import type { ConferenceAbstract } from "@/data/abstracts";

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

const MEMBER_NAME_MAP: Record<string, string[]> = {
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

function generateBio(cv: ParsedCV): string {
  const parts: string[] = [];

  // Opening: Name + specialty + institution
  const name = cv.name || "[Name]";
  const titleStr = cv.title || "physician-scientist";
  const institution = cv.institution || "[Institution]";
  parts.push(`${name} is ${/^[aeiou]/i.test(titleStr) ? "an" : "a"} ${titleStr} at ${institution}.`);

  // Training path
  const trainingParts: string[] = [];
  const md = cv.education.find(e => /^(MD|DO|MBBS|MBChB)$/.test(e.degree));
  const phd = cv.education.find(e => /^PhD$/.test(e.degree));
  if (md) {
    trainingParts.push(`medical degree from ${md.institution || "medical school"}`);
  }
  if (phd) {
    trainingParts.push(`PhD from ${phd.institution || "university"}`);
  }
  if (trainingParts.length > 0) {
    const pronoun = name.split(" ").length > 1 ? `Dr. ${name.split(" ").pop()}` : "They";
    parts.push(`${pronoun} received ${trainingParts.length > 1 ? trainingParts.join(" and ") : trainingParts[0]}.`);
  }

  // Research interests
  if (cv.interests.length > 0) {
    const interestStr = cv.interests.length > 3
      ? cv.interests.slice(0, 3).join(", ") + ", and more"
      : cv.interests.join(cv.interests.length === 2 ? " and " : ", ");
    const pronoun = name.split(" ").length > 1 ? `Dr. ${name.split(" ").pop()}` : "Their";
    parts.push(`${pronoun}'s research focuses on ${interestStr}.`);
  }

  // Grants/awards highlight
  if (cv.grants.length > 0 || cv.awards.length > 0) {
    const pronoun = name.split(" ").length > 1 ? `Dr. ${name.split(" ").pop()}` : "They";
    if (cv.grants.length > 0 && cv.awards.length > 0) {
      parts.push(`${pronoun} has been recognized with multiple awards and is supported by funded research grants.`);
    } else if (cv.grants.length > 0) {
      parts.push(`${pronoun}'s research is supported by funded grants.`);
    } else {
      parts.push(`${pronoun} has been recognized with multiple awards for their work.`);
    }
  }

  // Publication count
  if (cv.publications.length > 5) {
    const pronoun = name.split(" ").length > 1 ? `Dr. ${name.split(" ").pop()}` : "They";
    parts.push(`${pronoun} has authored over ${Math.floor(cv.publications.length / 5) * 5} peer-reviewed publications and is committed to advancing the understanding and treatment of pediatric neurological conditions.`);
  }

  return parts.join(" ");
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

const cardStyle: React.CSSProperties = {
  padding: "1.5rem",
  marginBottom: "1.5rem",
  borderRadius: "12px",
  border: "1px solid var(--border)",
  background: "var(--bg-card)",
};

const sectionHeadingStyle: React.CSSProperties = {
  fontSize: "1rem",
  fontFamily: "var(--heading-font)",
  marginBottom: "0.75rem",
  color: "var(--text)",
};

const badgeStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "0.15rem 0.5rem",
  borderRadius: "999px",
  fontSize: "0.7rem",
  fontWeight: 600,
  fontFamily: "var(--body-font)",
};

export default function CVImporter() {
  const [cvText, setCvText] = useState("");
  const [parsed, setParsed] = useState<ParsedCV | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [bio, setBio] = useState("");
  const [importedPubs, setImportedPubs] = useState(false);
  const [importedAbs, setImportedAbs] = useState(false);
  const [lookingUp, setLookingUp] = useState<Record<number, boolean>>({});

  const parseCV = useCallback(async () => {
    if (!cvText.trim()) {
      setError("Please paste CV text first");
      return;
    }
    setLoading(true);
    setError("");
    setParsed(null);
    setBio("");
    setImportedPubs(false);
    setImportedAbs(false);

    try {
      const res = await fetch("/api/parse-cv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cvText }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to parse CV");
        setLoading(false);
        return;
      }
      setParsed(data);
      setBio(generateBio(data));
    } catch (e) {
      setError("Network error parsing CV");
      console.error(e);
    }
    setLoading(false);
  }, [cvText]);

  const importPublications = useCallback(() => {
    if (!parsed) return;
    try {
      const existing: Publication[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      const newPubs: Publication[] = parsed.publications.map((p, i) => {
        const memberIds = matchMemberAuthors(p.authors);
        return {
          id: `pub-cv-${Date.now()}-${i}`,
          pmid: p.pmid || undefined,
          doi: p.doi || undefined,
          title: p.title,
          authors: p.authors,
          memberAuthorIds: memberIds,
          journal: p.journal || "",
          year: p.year || new Date().getFullYear(),
          pubType: "article" as const,
          categories: [],
          keywords: [],
          isMemberPaper: memberIds.length > 0,
        };
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing, ...newPubs]));
      setImportedPubs(true);
    } catch (e) {
      setError("Failed to import publications");
      console.error(e);
    }
  }, [parsed]);

  const importAbstracts = useCallback(() => {
    if (!parsed) return;
    try {
      const existing: ConferenceAbstract[] = JSON.parse(localStorage.getItem(STORAGE_KEY_ABSTRACTS) || "[]");
      const newAbs: ConferenceAbstract[] = parsed.abstracts.map((a, i) => {
        const memberIds = matchMemberAuthors(a.authors);
        return {
          id: `abs-cv-${Date.now()}-${i}`,
          title: a.title,
          authors: a.authors,
          conference: a.conference || "",
          presentationType: (a.presentationType as "poster" | "platform" | "oral" | "invited") || "poster",
          date: a.year ? String(a.year) : "",
          location: "",
          year: a.year || new Date().getFullYear(),
          memberAuthorIds: memberIds,
          isMemberPaper: memberIds.length > 0,
          categories: [],
        };
      });
      localStorage.setItem(STORAGE_KEY_ABSTRACTS, JSON.stringify([...existing, ...newAbs]));
      setImportedAbs(true);
    } catch (e) {
      setError("Failed to import abstracts");
      console.error(e);
    }
  }, [parsed]);

  const lookupPubMed = useCallback(async (index: number, title: string) => {
    setLookingUp(prev => ({ ...prev, [index]: true }));
    try {
      // Search PubMed by title
      const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&term=${encodeURIComponent(title)}`;
      const searchRes = await fetch(searchUrl);
      const searchData = await searchRes.json();
      const ids = searchData?.esearchresult?.idlist;
      if (ids && ids.length > 0) {
        const pmid = ids[0];
        // Open in new tab
        window.open(`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, "_blank");
      } else {
        // Open PubMed search
        window.open(`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(title)}`, "_blank");
      }
    } catch {
      // Fallback: open PubMed search
      window.open(`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(title)}`, "_blank");
    }
    setLookingUp(prev => ({ ...prev, [index]: false }));
  }, []);

  return (
    <div>
      {/* Input Area */}
      <div style={cardStyle}>
        <h2 style={sectionHeadingStyle}>Paste CV Text</h2>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.75rem", fontFamily: "var(--body-font)" }}>
          Copy and paste the full text of a CV below. The parser will attempt to extract publications, abstracts, education, and other structured data.
        </p>
        <textarea
          value={cvText}
          onChange={(e) => setCvText(e.target.value)}
          placeholder={`Paste CV text here...\n\nExample format:\n\nJohn Smith, MD, PhD\nAssistant Professor of Neurology\nChildren's Hospital of Philadelphia\n\nEDUCATION\nMD, Harvard Medical School, 2010\nPhD, Neuroscience, MIT, 2008\n\nPUBLICATIONS\n1. Smith J, Jones A, Brown B. Title of paper. Journal Name. 2023;45(2):123-130. PMID: 12345678\n\nABSTRACTS\n1. Smith J, et al. Poster title. Presented at AES Annual Meeting, 2023.`}
          style={{
            ...inputStyle,
            minHeight: "250px",
            resize: "vertical",
            fontFamily: "monospace",
            fontSize: "0.8rem",
            lineHeight: 1.5,
          }}
        />
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", alignItems: "center" }}>
          <button
            onClick={parseCV}
            disabled={loading || !cvText.trim()}
            className="btn-primary"
            style={{ fontSize: "0.85rem", padding: "0.6rem 1.5rem" }}
          >
            {loading ? "Parsing..." : "Parse CV"}
          </button>
          <button
            onClick={() => { setCvText(""); setParsed(null); setBio(""); setError(""); setImportedPubs(false); setImportedAbs(false); }}
            className="btn-secondary"
            style={{ fontSize: "0.85rem", padding: "0.6rem 1.25rem" }}
          >
            Clear
          </button>
          {cvText.trim() && (
            <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "var(--body-font)" }}>
              {cvText.split("\n").length} lines, {cvText.length.toLocaleString()} characters
            </span>
          )}
        </div>
        {error && (
          <p style={{ color: "#ef4444", fontSize: "0.85rem", marginTop: "0.5rem" }}>{error}</p>
        )}
      </div>

      {/* Results */}
      {parsed && (
        <>
          {/* Profile Data */}
          <div style={cardStyle}>
            <h2 style={sectionHeadingStyle}>Profile Data</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div>
                <label style={labelStyle}>Name</label>
                <p style={{ fontSize: "0.9rem", color: "var(--text)", fontFamily: "var(--body-font)" }}>
                  {parsed.name || <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Not detected</span>}
                </p>
              </div>
              <div>
                <label style={labelStyle}>Institution</label>
                <p style={{ fontSize: "0.9rem", color: "var(--text)", fontFamily: "var(--body-font)" }}>
                  {parsed.institution || <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Not detected</span>}
                </p>
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={labelStyle}>Title / Position</label>
                <p style={{ fontSize: "0.9rem", color: "var(--text)", fontFamily: "var(--body-font)" }}>
                  {parsed.title || <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>Not detected</span>}
                </p>
              </div>
            </div>

            {/* Education */}
            {parsed.education.length > 0 && (
              <div style={{ marginTop: "1rem" }}>
                <label style={labelStyle}>Education & Training</label>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  {parsed.education.map((e, i) => (
                    <div key={i} style={{
                      padding: "0.5rem 0.75rem", borderRadius: "8px",
                      background: "var(--bg)", border: "1px solid var(--border)",
                      fontSize: "0.85rem", fontFamily: "var(--body-font)",
                    }}>
                      <strong>{e.degree}</strong>
                      {e.institution && <> &mdash; {e.institution}</>}
                      {e.year && <span style={{ color: "var(--text-muted)", marginLeft: "0.5rem" }}>({e.year})</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Interests */}
            {parsed.interests.length > 0 && (
              <div style={{ marginTop: "1rem" }}>
                <label style={labelStyle}>Research Interests</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  {parsed.interests.map((interest, i) => (
                    <span key={i} style={{
                      ...badgeStyle,
                      background: "var(--accent-primary)",
                      color: "#fff",
                    }}>
                      {interest}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Summary stats */}
            <div style={{ marginTop: "1rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
              {[
                { label: "Publications", count: parsed.publications.length },
                { label: "Abstracts", count: parsed.abstracts.length },
                { label: "Grants", count: parsed.grants.length },
                { label: "Awards", count: parsed.awards.length },
                { label: "Sections Found", count: Object.keys(parsed.rawSections).length },
              ].map(({ label, count }) => (
                <div key={label} style={{
                  padding: "0.5rem 1rem", borderRadius: "8px",
                  background: "var(--bg)", border: "1px solid var(--border)",
                  textAlign: "center", minWidth: "80px",
                }}>
                  <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "var(--accent-primary)", fontFamily: "var(--heading-font)" }}>
                    {count}
                  </div>
                  <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontFamily: "var(--body-font)" }}>
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Bio Preview */}
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <h2 style={{ ...sectionHeadingStyle, marginBottom: 0 }}>Bio Preview</h2>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <button
                  onClick={() => setBio(generateBio(parsed))}
                  className="btn-secondary"
                  style={{ fontSize: "0.75rem", padding: "0.3rem 0.8rem" }}
                >
                  Regenerate Bio
                </button>
                <button
                  onClick={() => navigator.clipboard.writeText(bio)}
                  className="btn-primary"
                  style={{ fontSize: "0.75rem", padding: "0.3rem 0.8rem" }}
                >
                  Copy Bio
                </button>
              </div>
            </div>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              style={{
                ...inputStyle,
                minHeight: "100px",
                resize: "vertical",
                lineHeight: 1.6,
              }}
            />
          </div>

          {/* Publications Found */}
          {parsed.publications.length > 0 && (
            <div style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                <h2 style={{ ...sectionHeadingStyle, marginBottom: 0 }}>
                  Publications Found ({parsed.publications.length})
                </h2>
                <button
                  onClick={importPublications}
                  disabled={importedPubs}
                  className={importedPubs ? "btn-secondary" : "btn-primary"}
                  style={{ fontSize: "0.8rem", padding: "0.4rem 1rem" }}
                >
                  {importedPubs ? "Imported!" : "Import All to localStorage"}
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {parsed.publications.map((pub, i) => (
                  <div key={i} style={{
                    padding: "0.75rem", borderRadius: "8px",
                    background: "var(--bg)", border: "1px solid var(--border)",
                    display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem",
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.2rem", fontFamily: "var(--body-font)" }}>
                        {pub.title}
                      </p>
                      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "var(--body-font)" }}>
                        {pub.authors.length > 0 && <>{pub.authors.slice(0, 3).join(", ")}{pub.authors.length > 3 ? " et al." : ""} &mdash; </>}
                        {pub.journal && <em>{pub.journal}</em>}
                        {pub.year && ` (${pub.year})`}
                      </p>
                      <div style={{ display: "flex", gap: "0.3rem", marginTop: "0.3rem", flexWrap: "wrap" }}>
                        {pub.pmid && (
                          <span style={{ ...badgeStyle, background: "#059669", color: "#fff" }}>PMID: {pub.pmid}</span>
                        )}
                        {pub.doi && (
                          <span style={{ ...badgeStyle, background: "#2563eb", color: "#fff" }}>DOI</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => lookupPubMed(i, pub.title)}
                      disabled={lookingUp[i]}
                      className="btn-secondary"
                      style={{ fontSize: "0.7rem", padding: "0.3rem 0.6rem", whiteSpace: "nowrap", flexShrink: 0 }}
                    >
                      {lookingUp[i] ? "..." : "Look up on PubMed"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Abstracts Found */}
          {parsed.abstracts.length > 0 && (
            <div style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                <h2 style={{ ...sectionHeadingStyle, marginBottom: 0 }}>
                  Abstracts Found ({parsed.abstracts.length})
                </h2>
                <button
                  onClick={importAbstracts}
                  disabled={importedAbs}
                  className={importedAbs ? "btn-secondary" : "btn-primary"}
                  style={{ fontSize: "0.8rem", padding: "0.4rem 1rem" }}
                >
                  {importedAbs ? "Imported!" : "Import All to localStorage"}
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {parsed.abstracts.map((abs, i) => (
                  <div key={i} style={{
                    padding: "0.75rem", borderRadius: "8px",
                    background: "var(--bg)", border: "1px solid var(--border)",
                  }}>
                    <p style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.2rem", fontFamily: "var(--body-font)" }}>
                      {abs.title}
                    </p>
                    <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", fontFamily: "var(--body-font)" }}>
                      {abs.authors.length > 0 && <>{abs.authors.slice(0, 3).join(", ")}{abs.authors.length > 3 ? " et al." : ""} &mdash; </>}
                      {abs.conference && <em>{abs.conference}</em>}
                      {abs.year && ` (${abs.year})`}
                    </p>
                    {abs.presentationType && (
                      <span style={{ ...badgeStyle, background: "var(--accent-primary)", color: "#fff", marginTop: "0.3rem" }}>
                        {abs.presentationType}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Grants */}
          {parsed.grants.length > 0 && (
            <div style={cardStyle}>
              <h2 style={sectionHeadingStyle}>Grants ({parsed.grants.length})</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                {parsed.grants.map((grant, i) => (
                  <p key={i} style={{ fontSize: "0.8rem", color: "var(--text)", fontFamily: "var(--body-font)", padding: "0.4rem 0", borderBottom: "1px solid var(--border)" }}>
                    {grant}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Awards */}
          {parsed.awards.length > 0 && (
            <div style={cardStyle}>
              <h2 style={sectionHeadingStyle}>Awards ({parsed.awards.length})</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                {parsed.awards.map((award, i) => (
                  <p key={i} style={{ fontSize: "0.8rem", color: "var(--text)", fontFamily: "var(--body-font)", padding: "0.4rem 0", borderBottom: "1px solid var(--border)" }}>
                    {award}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Raw Sections Debug */}
          <details style={{ marginTop: "1rem" }}>
            <summary style={{
              fontSize: "0.8rem", color: "var(--text-muted)", cursor: "pointer",
              fontFamily: "var(--body-font)", padding: "0.5rem 0",
            }}>
              Debug: Raw Parsed Sections ({Object.keys(parsed.rawSections).length})
            </summary>
            <div style={{ ...cardStyle, marginTop: "0.5rem" }}>
              {Object.entries(parsed.rawSections).map(([name, content]) => (
                <div key={name} style={{ marginBottom: "1rem" }}>
                  <h3 style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--accent-primary)", fontFamily: "var(--heading-font)", marginBottom: "0.3rem" }}>
                    {name} ({content.length} lines)
                  </h3>
                  <pre style={{
                    fontSize: "0.7rem", color: "var(--text-muted)", fontFamily: "monospace",
                    background: "var(--bg)", padding: "0.5rem", borderRadius: "6px",
                    overflow: "auto", maxHeight: "150px", border: "1px solid var(--border)",
                    whiteSpace: "pre-wrap", wordBreak: "break-word",
                  }}>
                    {content.join("\n")}
                  </pre>
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
