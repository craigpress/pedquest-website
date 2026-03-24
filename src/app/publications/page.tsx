"use client";

import { useState, useMemo } from "react";
import { publications, publicationCategories } from "@/data/publications";
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

export default function PublicationsPage() {
  const [tab, setTab] = useState<Tab>("articles");
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [filterJournal, setFilterJournal] = useState("");
  const [expandedAbstract, setExpandedAbstract] = useState<string | null>(null);

  const tabPubs = useMemo(() => {
    if (tab === "abstracts") return publications.filter((p) => p.pubType === "conference_abstract");
    return publications.filter((p) => p.pubType !== "conference_abstract");
  }, [tab]);

  const uniqueYears = useMemo(
    () => [...new Set(tabPubs.map((p) => p.year))].sort((a, b) => b - a),
    [tabPubs]
  );
  const uniqueJournals = useMemo(
    () => [...new Set(tabPubs.map((p) => p.journal))].sort(),
    [tabPubs]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return tabPubs
      .filter((p) => {
        if (q && !p.title.toLowerCase().includes(q) && !p.authors.some((a) => a.toLowerCase().includes(q)) && !p.keywords.some((k) => k.toLowerCase().includes(q))) return false;
        if (filterCategory && !p.categories.includes(filterCategory)) return false;
        if (filterYear && p.year !== Number(filterYear)) return false;
        if (filterJournal && p.journal !== filterJournal) return false;
        return true;
      })
      .sort((a, b) => b.year - a.year);
  }, [tabPubs, search, filterCategory, filterYear, filterJournal]);

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
          onClick={() => { setTab("articles"); setFilterCategory(""); setFilterYear(""); setFilterJournal(""); }}
          className={tab === "articles" ? "btn-primary" : "btn-secondary"}
          style={{ fontSize: "0.85rem", padding: "0.5rem 1.25rem" }}
        >
          Peer-Reviewed Publications
        </button>
        <button
          onClick={() => { setTab("abstracts"); setFilterCategory(""); setFilterYear(""); setFilterJournal(""); }}
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
          placeholder="Search by title, author, or keyword..."
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
          {publicationCategories.map((cat) => (
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
      </div>

      {/* Results count */}
      <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "1rem" }}>
        Showing {filtered.length} publication{filtered.length !== 1 ? "s" : ""}
      </p>

      {/* Publication List */}
      {filtered.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "4rem 2rem",
            color: "var(--text-secondary)",
          }}
        >
          <p style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>No publications match your filters.</p>
          <p style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>
            Try adjusting your search terms or clearing some filters.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {filtered.map((pub) => (
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
                {pub.isMemberPaper && (
                  <span className="badge badge-member" style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
                    Member Paper
                  </span>
                )}
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
      )}
    </main>
  );
}
