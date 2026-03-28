"use client";

import { useState, useMemo, useEffect } from "react";
import { publications, publicationCategories } from "@/data/publications";
import type { Publication } from "@/data/publications";
import { conferenceAbstracts, abstractCategories } from "@/data/abstracts";
import { members } from "@/data/members";

type Tab = "articles" | "abstracts";

// Build a set of member last names for bolding
const memberLastNames = new Set(members.map((m) => m.name.split(" ").pop()!));
const memberNameSet = new Set(members.map((m) => m.name));

function highlightMemberAuthors(authorList: string[], memberAuthorIds: string[]) {
  // Build set of member last names for this paper
  const paperMemberNames = new Set(
    memberAuthorIds.map((id) => {
      const m = members.find((mem) => mem.id === id);
      return m ? m.name.split(" ").pop() : "";
    })
  );

  return authorList.map((author, i) => {
    const lastName = author.split(" ")[0]?.replace(/,?$/, "");
    const isMember = paperMemberNames.has(lastName) || memberLastNames.has(lastName.replace(",", ""));
    return (
      <span key={i}>
        {i > 0 && ", "}
        {isMember ? (
          <strong style={{ color: "var(--accent-primary)" }}>{author}</strong>
        ) : (
          author
        )}
      </span>
    );
  });
}

const presentationTypeLabels: Record<string, { label: string; color: string }> = {
  poster: { label: "Poster", color: "var(--accent-primary)" },
  platform: { label: "Platform", color: "#10b981" },
  oral: { label: "Oral", color: "#f59e0b" },
  invited: { label: "Invited", color: "#8b5cf6" },
};

export default function PublicationsPage() {
  const [tab, setTab] = useState<Tab>("articles");
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [filterJournal, setFilterJournal] = useState("");
  const [filterConference, setFilterConference] = useState("");
  const [memberOnly, setMemberOnly] = useState(false);
  const [filterPopulation, setFilterPopulation] = useState("");
  const [expandedAbstract, setExpandedAbstract] = useState<string | null>(null);
  const [localPubs, setLocalPubs] = useState<Publication[]>([]);

  // Load localStorage publications on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("pedquest-new-publications");
      if (stored) setLocalPubs(JSON.parse(stored));
    } catch { /* ignore */ }
  }, []);

  // Merge static + localStorage publications, dedupe by id
  const allPublications = useMemo(() => {
    const staticIds = new Set(publications.map((p) => p.id));
    const newPubs = localPubs.filter((p) => !staticIds.has(p.id));
    return [...publications, ...newPubs];
  }, [localPubs]);

  // Set of localStorage IDs for "New" badge
  const localPubIds = useMemo(() => new Set(localPubs.map((p) => p.id)), [localPubs]);

  // Publications tab data
  const tabPubs = useMemo(() => {
    if (tab === "abstracts") return [];
    return allPublications.filter((p) => p.pubType !== "conference_abstract");
  }, [tab, allPublications]);

  // Abstracts tab data
  const filteredAbstracts = useMemo(() => {
    if (tab !== "abstracts") return [];
    const q = search.toLowerCase();
    return conferenceAbstracts
      .filter((a) => {
        if (q && !a.title.toLowerCase().includes(q) && !a.authors.some((au) => au.toLowerCase().includes(q)) && !a.conference.toLowerCase().includes(q)) return false;
        if (filterCategory && !a.categories.includes(filterCategory)) return false;
        if (filterYear && a.year !== Number(filterYear)) return false;
        if (filterConference && a.conference !== filterConference) return false;
        return true;
      })
      .sort((a, b) => b.year - a.year);
  }, [tab, search, filterCategory, filterYear, filterConference]);

  const uniqueYears = useMemo(() => {
    if (tab === "abstracts") {
      return [...new Set(conferenceAbstracts.map((a) => a.year))].sort((a, b) => b - a);
    }
    return [...new Set(tabPubs.map((p) => p.year))].sort((a, b) => b - a);
  }, [tab, tabPubs]);

  const uniqueJournals = useMemo(
    () => [...new Set(tabPubs.map((p) => p.journal))].sort(),
    [tabPubs]
  );

  const uniqueConferences = useMemo(
    () => [...new Set(conferenceAbstracts.map((a) => a.conference))].sort(),
    []
  );

  const uniquePopulations = useMemo(
    () => [...new Set(tabPubs.map((p) => p.patientPopulation).filter(Boolean))].sort() as string[],
    [tabPubs]
  );

  const filteredPubs = useMemo(() => {
    if (tab === "abstracts") return [];
    const q = search.toLowerCase();
    return tabPubs
      .filter((p) => {
        if (q && !p.title.toLowerCase().includes(q) && !p.authors.some((a) => a.toLowerCase().includes(q)) && !p.keywords.some((k) => k.toLowerCase().includes(q))) return false;
        if (filterCategory && !p.categories.includes(filterCategory)) return false;
        if (filterYear && p.year !== Number(filterYear)) return false;
        if (filterJournal && p.journal !== filterJournal) return false;
        if (memberOnly && !p.isMemberPaper) return false;
        if (filterPopulation && p.patientPopulation !== filterPopulation) return false;
        return true;
      })
      .sort((a, b) => b.year - a.year || (b.month ?? 0) - (a.month ?? 0));
  }, [tabPubs, search, filterCategory, filterYear, filterJournal, memberOnly, filterPopulation, tab]);

  const activeCategories = tab === "abstracts" ? abstractCategories : publicationCategories;
  const resultCount = tab === "abstracts" ? filteredAbstracts.length : filteredPubs.length;
  const resultLabel = tab === "abstracts" ? "abstract" : "publication";

  return (
    <main style={{ maxWidth: "900px", margin: "0 auto", padding: "3rem 1.5rem" }}>
      {/* Header */}
      <header style={{ marginBottom: "2rem" }}>
        <h1 className="section-heading">Publications</h1>
        <p className="section-subheading">
          Research output from PedQuEST members and the broader pediatric qEEG community.
        </p>
      </header>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
        <button
          onClick={() => { setTab("articles"); setFilterCategory(""); setFilterYear(""); setFilterJournal(""); setFilterConference(""); setSearch(""); }}
          className={tab === "articles" ? "btn-primary" : "btn-secondary"}
          style={{ fontSize: "0.85rem", padding: "0.5rem 1.25rem" }}
        >
          Peer-Reviewed Publications
        </button>
        <button
          onClick={() => { setTab("abstracts"); setFilterCategory(""); setFilterYear(""); setFilterJournal(""); setFilterConference(""); setSearch(""); }}
          className={tab === "abstracts" ? "btn-primary" : "btn-secondary"}
          style={{ fontSize: "0.85rem", padding: "0.5rem 1.25rem" }}
        >
          Conference Abstracts
        </button>
      </div>

      {/* Search & Filters */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "2rem" }}>
        <input
          type="text"
          placeholder={tab === "abstracts" ? "Search by title, author, or conference..." : "Search by title, author, or keyword..."}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: "1 1 280px",
            padding: "0.6rem 1rem",
            borderRadius: "8px",
            border: "1px solid var(--border-strong)",
            background: "var(--bg-card)",
            color: "var(--text)",
            fontFamily: "var(--body-font)",
            fontSize: "0.9rem",
            outline: "none",
          }}
        />
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          style={{
            flex: "0 1 200px",
            padding: "0.6rem 1rem",
            borderRadius: "8px",
            border: "1px solid var(--border-strong)",
            background: "var(--bg-card)",
            color: "var(--text)",
            fontFamily: "var(--body-font)",
            fontSize: "0.9rem",
          }}
        >
          <option value="">All Categories</option>
          {activeCategories.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
        <select
          value={filterYear}
          onChange={(e) => setFilterYear(e.target.value)}
          style={{
            flex: "0 1 120px",
            padding: "0.6rem 1rem",
            borderRadius: "8px",
            border: "1px solid var(--border-strong)",
            background: "var(--bg-card)",
            color: "var(--text)",
            fontFamily: "var(--body-font)",
            fontSize: "0.9rem",
          }}
        >
          <option value="">All Years</option>
          {uniqueYears.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        {tab === "articles" ? (
          <select
            value={filterJournal}
            onChange={(e) => setFilterJournal(e.target.value)}
            style={{
              flex: "0 1 220px",
              padding: "0.6rem 1rem",
              borderRadius: "8px",
              border: "1px solid var(--border-strong)",
              background: "var(--bg-card)",
              color: "var(--text)",
              fontFamily: "var(--body-font)",
              fontSize: "0.9rem",
            }}
          >
            <option value="">All Journals</option>
            {uniqueJournals.map((j) => (
              <option key={j} value={j}>{j}</option>
            ))}
          </select>
        ) : (
          <select
            value={filterConference}
            onChange={(e) => setFilterConference(e.target.value)}
            style={{
              flex: "0 1 220px",
              padding: "0.6rem 1rem",
              borderRadius: "8px",
              border: "1px solid var(--border-strong)",
              background: "var(--bg-card)",
              color: "var(--text)",
              fontFamily: "var(--body-font)",
              fontSize: "0.9rem",
            }}
          >
            <option value="">All Conferences</option>
            {uniqueConferences.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
      </div>

      {/* Advanced filters row — articles tab only */}
      {tab === "articles" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem", alignItems: "center" }}>
          <button
            onClick={() => setMemberOnly(!memberOnly)}
            style={{
              padding: "0.45rem 0.9rem",
              borderRadius: 999,
              border: "1.5px solid",
              borderColor: memberOnly ? "var(--accent-primary)" : "var(--border-strong)",
              background: memberOnly ? "color-mix(in srgb, var(--accent-primary) 12%, transparent)" : "transparent",
              color: memberOnly ? "var(--accent-primary)" : "var(--text-secondary)",
              fontSize: "0.82rem",
              fontWeight: 500,
              fontFamily: "var(--body-font)",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            {memberOnly ? "✓ " : ""}Member Papers Only
          </button>
          {uniquePopulations.length > 0 && (
            <select
              value={filterPopulation}
              onChange={(e) => setFilterPopulation(e.target.value)}
              style={{
                padding: "0.45rem 0.9rem",
                borderRadius: "8px",
                border: "1px solid var(--border-strong)",
                background: "var(--bg-card)",
                color: "var(--text)",
                fontFamily: "var(--body-font)",
                fontSize: "0.82rem",
              }}
            >
              <option value="">All Populations</option>
              {uniquePopulations.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Results count */}
      <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
        Showing {resultCount} {resultLabel}{resultCount !== 1 ? "s" : ""}
      </p>

      {/* No results */}
      {resultCount === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "4rem 2rem",
            color: "var(--text-secondary)",
          }}
        >
          <p style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>No {resultLabel}s match your filters.</p>
          <p style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
            Try adjusting your search terms or clearing some filters.
          </p>
        </div>
      ) : tab === "articles" ? (
        /* Publication List */
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {filteredPubs.map((pub) => (
            <article key={pub.id} className="card" style={{ padding: "1.5rem" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", justifyContent: "space-between" }}>
                <h3
                  style={{
                    fontSize: "1rem",
                    fontFamily: "var(--heading-font)",
                    lineHeight: 1.4,
                    marginBottom: "0.5rem",
                    flex: 1,
                  }}
                >
                  {pub.title}
                </h3>
                <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
                  {localPubIds.has(pub.id) && (
                    <span className="badge" style={{ whiteSpace: "nowrap", background: "#10b981", color: "#fff", fontSize: "0.7rem" }}>
                      New
                    </span>
                  )}
                  {pub.isMemberPaper && (
                    <span className="badge badge-member" style={{ whiteSpace: "nowrap" }}>
                      Member Paper
                    </span>
                  )}
                </div>
              </div>

              {/* Authors */}
              <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "0.5rem", lineHeight: 1.5 }}>
                {highlightMemberAuthors(pub.authors, pub.memberAuthorIds)}
              </p>

              {/* Journal + year + DOI */}
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                <em>{pub.journal}</em> ({pub.year})
                {pub.doi && (
                  <>
                    {" "}&middot;{" "}
                    <a
                      href={`https://doi.org/${pub.doi}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--accent-primary)" }}
                    >
                      DOI &rarr;
                    </a>
                  </>
                )}
                {pub.pmid && (
                  <>
                    {" "}&middot;{" "}
                    <a
                      href={`https://pubmed.ncbi.nlm.nih.gov/${pub.pmid}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "var(--accent-primary)" }}
                    >
                      PubMed
                    </a>
                  </>
                )}
              </p>

              {/* Categories */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: pub.abstract ? "0.75rem" : "0" }}>
                {pub.categories.map((cat) => (
                  <span
                    key={cat}
                    className="badge"
                    style={{
                      background: "var(--border)",
                      color: "var(--text-secondary)",
                      fontSize: "0.7rem",
                    }}
                  >
                    {cat}
                  </span>
                ))}
              </div>

              {/* Expandable abstract */}
              {pub.abstract && (
                <div>
                  <button
                    onClick={() => setExpandedAbstract(expandedAbstract === pub.id ? null : pub.id)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--accent-primary)",
                      cursor: "pointer",
                      fontFamily: "var(--body-font)",
                      fontSize: "0.8rem",
                      padding: 0,
                      fontWeight: 600,
                    }}
                  >
                    {expandedAbstract === pub.id ? "Hide Abstract" : "Show Abstract"}
                  </button>
                  {expandedAbstract === pub.id && (
                    <p
                      style={{
                        marginTop: "0.5rem",
                        fontSize: "0.85rem",
                        color: "var(--text-secondary)",
                        lineHeight: 1.7,
                        borderLeft: "3px solid var(--accent-primary)",
                        paddingLeft: "1rem",
                      }}
                    >
                      {pub.abstract}
                    </p>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      ) : (
        /* Conference Abstracts List */
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {filteredAbstracts.map((abs) => {
            const typeInfo = presentationTypeLabels[abs.presentationType];
            return (
              <article key={abs.id} className="card" style={{ padding: "1.5rem" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", justifyContent: "space-between" }}>
                  <h3
                    style={{
                      fontSize: "1rem",
                      fontFamily: "var(--heading-font)",
                      lineHeight: 1.4,
                      marginBottom: "0.5rem",
                      flex: 1,
                    }}
                  >
                    {abs.title}
                  </h3>
                  <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
                    <span
                      className="badge"
                      style={{
                        background: typeInfo.color,
                        color: "#fff",
                        fontSize: "0.7rem",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {typeInfo.label}
                    </span>
                    {abs.isMemberPaper && (
                      <span className="badge badge-member" style={{ whiteSpace: "nowrap" }}>
                        Member
                      </span>
                    )}
                  </div>
                </div>

                {/* Authors */}
                <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "0.5rem", lineHeight: 1.5 }}>
                  {highlightMemberAuthors(abs.authors, abs.memberAuthorIds)}
                </p>

                {/* Conference + date + location */}
                <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                  <em>{abs.conference}</em>
                  {abs.date && <> &middot; {abs.date}</>}
                  {abs.location && <> &middot; {abs.location}</>}
                </p>

                {/* Notes */}
                {abs.notes && (
                  <p style={{ fontSize: "0.8rem", color: "#f59e0b", fontWeight: 600, marginBottom: "0.5rem" }}>
                    {abs.notes}
                  </p>
                )}

                {/* Categories */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                  {abs.categories.map((cat) => (
                    <span
                      key={cat}
                      className="badge"
                      style={{
                        background: "var(--border)",
                        color: "var(--text-secondary)",
                        fontSize: "0.7rem",
                      }}
                    >
                      {cat}
                    </span>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
