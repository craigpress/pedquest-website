"use client";

import { useState, useMemo, useEffect } from "react";
import { publications, publicationCategories } from "@/data/publications";
import type { Publication } from "@/data/publications";
import { conferenceAbstracts, abstractCategories } from "@/data/abstracts";
import { members } from "@/data/members";

type Tab = "articles" | "abstracts";
type Sort = "new" | "old" | "az";

function highlightMemberAuthors(authorList: string[], memberAuthorIds: string[]) {
  // Only highlight authors who are tagged as members on THIS paper
  const paperMemberLastNames = new Set(
    memberAuthorIds.map((id) => {
      const m = members.find((mem) => mem.id === id);
      return m ? m.name.split(" ").pop() : "";
    }).filter(Boolean)
  );

  return authorList.map((author, i) => {
    const lastName = author.split(" ")[0]?.replace(/,?$/, "");
    const isMember = paperMemberLastNames.has(lastName);
    return (
      <span key={i}>
        {i > 0 && ", "}
        {isMember ? (
          <strong style={{ color: "var(--accent)" }}>{author}</strong>
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

const pubTypeLabels: Record<Publication["pubType"], { label: string; cls: string }> = {
  article: { label: "Original", cls: "orig" },
  review: { label: "Review", cls: "guide" },
  case_report: { label: "Case report", cls: "warm" },
  conference_abstract: { label: "Abstract", cls: "guide" },
};

// ── Citation helpers ──
function formatCitation(p: Publication): string {
  return `${p.authors.join(", ")}. ${p.title}. ${p.journal}. ${p.year}.${p.doi ? ` doi:${p.doi}` : ""}`;
}

function toBibtex(p: Publication): string {
  const key = p.id.replace(/[^a-zA-Z0-9]/g, "");
  const fields = [
    `  title = {${p.title}}`,
    `  author = {${p.authors.join(" and ")}}`,
    `  journal = {${p.journal}}`,
    `  year = {${p.year}}`,
    p.doi ? `  doi = {${p.doi}}` : null,
    p.pmid ? `  pmid = {${p.pmid}}` : null,
  ].filter(Boolean);
  return `@article{${key},\n${fields.join(",\n")}\n}`;
}

// KPI stats — computed from the static registry (articles only, matching the record)
const articlePubs = publications.filter((p) => p.pubType !== "conference_abstract");
const kpiPubCount = articlePubs.length;
const kpiJournalCount = new Set(articlePubs.map((p) => p.journal).filter(Boolean)).size;
const kpiYearFrom = Math.min(...articlePubs.map((p) => p.year));
const kpiYearTo = Math.max(...articlePubs.map((p) => p.year));
const kpiSince2021 = articlePubs.filter((p) => p.year >= 2021).length;

export default function PublicationsPage() {
  const [tab, setTab] = useState<Tab>("articles");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("new");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [filterJournal, setFilterJournal] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterConference, setFilterConference] = useState("");
  const [memberOnly, setMemberOnly] = useState(false);
  const [filterPopulation, setFilterPopulation] = useState("");
  const [expandedAbstract, setExpandedAbstract] = useState<string | null>(null);
  const [localPubs, setLocalPubs] = useState<Publication[]>([]);
  const [toast, setToast] = useState("");

  // Load localStorage publications on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("pedquest-new-publications");
      if (stored) setLocalPubs(JSON.parse(stored));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 1900);
    return () => clearTimeout(t);
  }, [toast]);

  function resetFilters() {
    setFilterCategory("");
    setFilterYear("");
    setFilterJournal("");
    setFilterType("");
    setFilterConference("");
    setFilterPopulation("");
    setMemberOnly(false);
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text).then(
      () => setToast(`${label} copied to clipboard`),
      () => setToast("Copy failed")
    );
  }

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
    const list = conferenceAbstracts.filter((a) => {
      if (q && !a.title.toLowerCase().includes(q) && !a.authors.some((au) => au.toLowerCase().includes(q)) && !a.conference.toLowerCase().includes(q)) return false;
      if (filterCategory && !a.categories.includes(filterCategory)) return false;
      if (filterYear && a.year !== Number(filterYear)) return false;
      if (filterConference && a.conference !== filterConference) return false;
      return true;
    });
    if (sort === "az") return list.sort((a, b) => a.title.localeCompare(b.title));
    if (sort === "old") return list.sort((a, b) => a.year - b.year);
    return list.sort((a, b) => b.year - a.year);
  }, [tab, search, sort, filterCategory, filterYear, filterConference]);

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
    const list = tabPubs.filter((p) => {
      if (q && !p.title.toLowerCase().includes(q) && !p.authors.some((a) => a.toLowerCase().includes(q)) && !p.keywords.some((k) => k.toLowerCase().includes(q))) return false;
      if (filterCategory && !p.categories.includes(filterCategory)) return false;
      if (filterYear && p.year !== Number(filterYear)) return false;
      if (filterJournal && p.journal !== filterJournal) return false;
      if (filterType && p.pubType !== filterType) return false;
      if (memberOnly && !p.isMemberPaper) return false;
      if (filterPopulation && p.patientPopulation !== filterPopulation) return false;
      return true;
    });
    if (sort === "az") return list.sort((a, b) => a.title.localeCompare(b.title));
    if (sort === "old") return list.sort((a, b) => a.year - b.year || (a.month ?? 0) - (b.month ?? 0));
    return list.sort((a, b) => b.year - a.year || (b.month ?? 0) - (a.month ?? 0));
  }, [tabPubs, search, sort, filterCategory, filterYear, filterJournal, filterType, memberOnly, filterPopulation, tab]);

  // ── Facet data for the active tab ──
  const yearBars = useMemo(() => {
    const source: { year: number }[] = tab === "abstracts" ? conferenceAbstracts : tabPubs;
    if (!source.length) return [];
    const counts: Record<number, number> = {};
    for (const item of source) counts[item.year] = (counts[item.year] || 0) + 1;
    const from = Math.min(...source.map((s) => s.year));
    const to = Math.max(...source.map((s) => s.year));
    const bars: { year: number; count: number }[] = [];
    for (let y = from; y <= to; y++) bars.push({ year: y, count: counts[y] || 0 });
    return bars;
  }, [tab, tabPubs]);
  const maxYearCount = Math.max(1, ...yearBars.map((b) => b.count));

  const topicCounts = useMemo(() => {
    const cats = tab === "abstracts" ? abstractCategories : publicationCategories;
    const source = tab === "abstracts" ? conferenceAbstracts : tabPubs;
    return cats
      .map((c) => ({ label: c, count: source.filter((s) => s.categories.includes(c)).length }))
      .filter((c) => c.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [tab, tabPubs]);

  const journalCounts = useMemo(() => {
    if (tab === "abstracts") return [];
    const counts: Record<string, number> = {};
    for (const p of tabPubs) if (p.journal) counts[p.journal] = (counts[p.journal] || 0) + 1;
    return Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [tab, tabPubs]);

  const conferenceCounts = useMemo(() => {
    if (tab !== "abstracts") return [];
    const counts: Record<string, number> = {};
    for (const a of conferenceAbstracts) counts[a.conference] = (counts[a.conference] || 0) + 1;
    return Object.entries(counts)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [tab]);

  const typeCounts = useMemo(() => {
    if (tab === "abstracts") return [];
    const types: Publication["pubType"][] = ["article", "review", "case_report"];
    return types
      .map((t) => ({
        value: t,
        label: pubTypeLabels[t].label,
        count: tabPubs.filter((p) => p.pubType === t).length,
      }))
      .filter((t) => t.count > 0);
  }, [tab, tabPubs]);

  // ── Export filtered results as BibTeX ──
  function exportBibtex() {
    if (tab === "abstracts" || !filteredPubs.length) return;
    const bib = filteredPubs.map(toBibtex).join("\n\n") + "\n";
    const blob = new Blob([bib], { type: "application/x-bibtex" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pedquest-publications.bib";
    a.click();
    URL.revokeObjectURL(url);
    setToast(`${filteredPubs.length} entries exported (.bib)`);
  }

  const resultCount = tab === "abstracts" ? filteredAbstracts.length : filteredPubs.length;
  const totalCount = tab === "abstracts" ? conferenceAbstracts.length : tabPubs.length;

  const activeTags: { key: string; label: string; clear: () => void }[] = [];
  if (filterCategory) activeTags.push({ key: "cat", label: filterCategory, clear: () => setFilterCategory("") });
  if (filterYear) activeTags.push({ key: "year", label: filterYear, clear: () => setFilterYear("") });
  if (filterJournal) activeTags.push({ key: "journal", label: filterJournal, clear: () => setFilterJournal("") });
  if (filterType) activeTags.push({ key: "type", label: pubTypeLabels[filterType as Publication["pubType"]].label, clear: () => setFilterType("") });
  if (filterConference) activeTags.push({ key: "conf", label: filterConference, clear: () => setFilterConference("") });
  if (filterPopulation) activeTags.push({ key: "pop", label: filterPopulation, clear: () => setFilterPopulation("") });
  if (memberOnly) activeTags.push({ key: "member", label: "Member papers", clear: () => setMemberOnly(false) });

  return (
    <main>
      {/* ── Page head ── */}
      <div className="pubs-head">
        <div className="pubs-wrap">
          <span className="section-eyebrow">Research library</span>
          <h1 className="pubs-h1">The PedQuEST publication record</h1>
          <p className="pubs-sub">
            Every peer-reviewed paper from the consortium&apos;s members and the
            broader pediatric qEEG field — auto-refreshed from PubMed,
            filterable by topic, journal, and year, and exportable to your
            reference manager.
          </p>
          <div className="pubs-kpis">
            <span><b>{kpiPubCount}</b> publications</span>
            <span><b>{kpiJournalCount}</b> journals</span>
            <span><b>{kpiYearFrom}–{kpiYearTo}</b> span</span>
            <span><b>{kpiSince2021}</b> since 2021</span>
          </div>
          <div className="pubs-tabs" role="tablist" aria-label="Publication type">
            <button
              role="tab"
              aria-selected={tab === "articles"}
              className={`pubs-tab ${tab === "articles" ? "on" : ""}`}
              onClick={() => { setTab("articles"); resetFilters(); setSearch(""); }}
            >
              Peer-reviewed publications
            </button>
            <button
              role="tab"
              aria-selected={tab === "abstracts"}
              className={`pubs-tab ${tab === "abstracts" ? "on" : ""}`}
              onClick={() => { setTab("abstracts"); resetFilters(); setSearch(""); }}
            >
              Conference abstracts
            </button>
          </div>
        </div>
      </div>

      <div className="pubs-wrap pubs-layout">
        {/* ── Facets sidebar ── */}
        <aside className="pubs-facets" aria-label="Filters">
          <div className="facet">
            <h3>By year</h3>
            <div className="yearbars" role="group" aria-label="Filter by year">
              {yearBars.map((b) => (
                <button
                  key={b.year}
                  type="button"
                  className={`yb ${filterYear === String(b.year) ? "on" : ""}`}
                  style={{ height: `${Math.max(4, (b.count / maxYearCount) * 100)}%` }}
                  title={`${b.year}: ${b.count}`}
                  aria-label={`${b.year}: ${b.count} ${tab === "abstracts" ? "abstracts" : "publications"}`}
                  onClick={() => setFilterYear(filterYear === String(b.year) ? "" : String(b.year))}
                />
              ))}
            </div>
            {yearBars.length > 0 && (
              <div className="yearbars-x">
                <span>&apos;{String(yearBars[0].year).slice(2)}</span>
                <span>&apos;{String(yearBars[yearBars.length - 1].year).slice(2)}</span>
              </div>
            )}
          </div>

          <div className="facet">
            <h3>Topic</h3>
            <div className="facet-list">
              {topicCounts.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  className={`fbtn ${filterCategory === t.label ? "on" : ""}`}
                  onClick={() => setFilterCategory(filterCategory === t.label ? "" : t.label)}
                >
                  <span>{t.label}</span>
                  <span className="c">{t.count}</span>
                </button>
              ))}
            </div>
          </div>

          {tab === "articles" && journalCounts.length > 0 && (
            <div className="facet">
              <h3>Journal</h3>
              <div className="facet-list">
                {journalCounts.map((j) => (
                  <button
                    key={j.label}
                    type="button"
                    className={`fbtn ${filterJournal === j.label ? "on" : ""}`}
                    onClick={() => setFilterJournal(filterJournal === j.label ? "" : j.label)}
                  >
                    <span>{j.label}</span>
                    <span className="c">{j.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === "abstracts" && conferenceCounts.length > 0 && (
            <div className="facet">
              <h3>Conference</h3>
              <div className="facet-list">
                {conferenceCounts.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    className={`fbtn ${filterConference === c.label ? "on" : ""}`}
                    onClick={() => setFilterConference(filterConference === c.label ? "" : c.label)}
                  >
                    <span>{c.label}</span>
                    <span className="c">{c.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === "articles" && typeCounts.length > 0 && (
            <div className="facet">
              <h3>Type</h3>
              <div className="facet-list">
                {typeCounts.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    className={`fbtn ${filterType === t.value ? "on" : ""}`}
                    onClick={() => setFilterType(filterType === t.value ? "" : t.value)}
                  >
                    <span>{t.label}</span>
                    <span className="c">{t.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === "articles" && (
            <div className="facet">
              <h3>Scope</h3>
              <div className="facet-list">
                <button
                  type="button"
                  className={`fbtn ${memberOnly ? "on" : ""}`}
                  onClick={() => setMemberOnly(!memberOnly)}
                >
                  <span>Member papers only</span>
                  <span className="c">{tabPubs.filter((p) => p.isMemberPaper).length}</span>
                </button>
                {uniquePopulations.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`fbtn ${filterPopulation === p ? "on" : ""}`}
                    onClick={() => setFilterPopulation(filterPopulation === p ? "" : p)}
                  >
                    <span>{p}</span>
                    <span className="c">{tabPubs.filter((x) => x.patientPopulation === p).length}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* ── Results ── */}
        <section aria-label="Results">
          <div className="pubs-toolbar">
            <label className="pubs-search" htmlFor="pubs-q">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>
              <input
                id="pubs-q"
                type="search"
                placeholder={tab === "abstracts" ? "Search titles, authors, conferences…" : "Search titles, authors, keywords…"}
                aria-label={`Search ${tab === "abstracts" ? "abstracts" : "publications"}`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <select
              className="pubs-sort"
              aria-label="Sort results"
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
            >
              <option value="new">Newest first</option>
              <option value="old">Oldest first</option>
              <option value="az">Title A–Z</option>
            </select>
            {tab === "articles" && (
              <button className="pubs-export" onClick={exportBibtex} disabled={!filteredPubs.length}>
                Export ↧
              </button>
            )}
          </div>

          <div className="pubs-resbar">
            <span className="n">
              <b>{resultCount}</b> of {totalCount} shown
            </span>
            <div className="active-tags">
              {activeTags.map((t) => (
                <button key={t.key} type="button" className="atag" onClick={t.clear}>
                  {t.label} ✕
                </button>
              ))}
              {activeTags.length > 0 && (
                <button type="button" className="clear-tags" onClick={resetFilters}>
                  clear all
                </button>
              )}
            </div>
          </div>

          {resultCount === 0 ? (
            <div className="pubs-empty">
              No {tab === "abstracts" ? "abstracts" : "publications"} match these filters.
              <br />
              Try removing a filter or broadening your search.
            </div>
          ) : tab === "articles" ? (
            <div>
              {filteredPubs.map((pub) => (
                <article key={pub.id} className="pub">
                  <div className="pub-top">
                    <span className="pub-year">{pub.year}</span>
                    {pub.journal && <span className="jchip">{pub.journal}</span>}
                    <span className={`typechip ${pubTypeLabels[pub.pubType].cls}`}>
                      {pubTypeLabels[pub.pubType].label}
                    </span>
                    {localPubIds.has(pub.id) && <span className="typechip new">New</span>}
                    {pub.isMemberPaper && <span className="typechip orig">Member paper</span>}
                  </div>
                  <h3 className="pub-title-line">{pub.title}</h3>
                  <p className="pub-auth">{highlightMemberAuthors(pub.authors, pub.memberAuthorIds)}</p>
                  {pub.abstract && (
                    <div className="pub-abs">
                      <button
                        type="button"
                        className="pub-abs-toggle"
                        onClick={() => setExpandedAbstract(expandedAbstract === pub.id ? null : pub.id)}
                      >
                        {expandedAbstract === pub.id ? "Hide abstract" : "Show abstract"}
                      </button>
                      {expandedAbstract === pub.id && <p className="pub-abs-text">{pub.abstract}</p>}
                    </div>
                  )}
                  <div className="pub-foot">
                    <div className="pub-topics">
                      {pub.categories.map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          className="topic-pill"
                          onClick={() => setFilterCategory(filterCategory === cat ? "" : cat)}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                    <div className="pub-actions">
                      <button type="button" className="act" onClick={() => copy(formatCitation(pub), "Citation")}>
                        Cite
                      </button>
                      <button type="button" className="act" onClick={() => copy(toBibtex(pub), "BibTeX")}>
                        BibTeX
                      </button>
                      {pub.doi && (
                        <a className="act" href={`https://doi.org/${pub.doi}`} target="_blank" rel="noopener noreferrer">
                          DOI ↗
                        </a>
                      )}
                      {pub.pmid && (
                        <a className="act" href={`https://pubmed.ncbi.nlm.nih.gov/${pub.pmid}/`} target="_blank" rel="noopener noreferrer">
                          PubMed ↗
                        </a>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div>
              {filteredAbstracts.map((abs) => {
                const typeInfo = presentationTypeLabels[abs.presentationType];
                return (
                  <article key={abs.id} className="pub">
                    <div className="pub-top">
                      <span className="pub-year">{abs.year}</span>
                      <span className="jchip">{abs.conference}</span>
                      <span className="typechip" style={{ background: "var(--accent-soft)", color: typeInfo.color }}>
                        {typeInfo.label}
                      </span>
                      {abs.isMemberPaper && <span className="typechip orig">Member</span>}
                    </div>
                    <h3 className="pub-title-line">{abs.title}</h3>
                    <p className="pub-auth">{highlightMemberAuthors(abs.authors, abs.memberAuthorIds)}</p>
                    <p className="pub-meta-line">
                      {abs.date && <>{abs.date}</>}
                      {abs.location && <> · {abs.location}</>}
                    </p>
                    {abs.notes && <p className="pub-notes">{abs.notes}</p>}
                    <div className="pub-foot">
                      <div className="pub-topics">
                        {abs.categories.map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            className="topic-pill"
                            onClick={() => setFilterCategory(filterCategory === cat ? "" : cat)}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <div className={`pubs-toast ${toast ? "show" : ""}`} role="status" aria-live="polite">
        {toast}
      </div>

      <style>{`
        /* ── Publications page (page-specific; shared classes in globals.css) ── */
        .pubs-wrap { max-width: 1200px; margin: 0 auto; padding: 0 2rem; }
        .pubs-head {
          padding: clamp(3.5rem, 7vw, 5rem) 0 0;
          border-bottom: 1px solid var(--line);
          background: var(--surface);
        }
        .pubs-h1 {
          font-family: var(--heading-font);
          font-size: clamp(1.9rem, 4vw, 2.7rem);
          font-weight: 700; line-height: 1.1; letter-spacing: -0.02em;
          color: var(--ink); margin: 0.8rem 0 0.7rem; text-wrap: balance;
        }
        .pubs-sub { color: var(--ink-2); max-width: 60ch; line-height: 1.6; }
        .pubs-kpis {
          display: flex; gap: 1.6rem; margin-top: 1.25rem; flex-wrap: wrap;
          font-family: var(--mono-font); font-size: 0.82rem; color: var(--muted);
        }
        .pubs-kpis b { color: var(--ink); font-size: 0.95rem; }
        .pubs-tabs { display: flex; gap: 0.4rem; margin-top: 1.5rem; }
        .pubs-tab {
          font-family: var(--mono-font); font-size: 0.78rem; letter-spacing: 0.04em;
          padding: 0.6rem 1rem; cursor: pointer; color: var(--ink-2);
          background: transparent; border: none;
          border-bottom: 2px solid transparent;
        }
        .pubs-tab:hover { color: var(--ink); }
        .pubs-tab.on { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }

        .pubs-layout {
          display: grid; grid-template-columns: 262px 1fr; gap: 1.9rem;
          padding-top: 1.75rem; padding-bottom: 4.5rem; align-items: start;
        }
        .pubs-facets { position: sticky; top: 84px; display: flex; flex-direction: column; gap: 1.4rem; }
        .facet h3 {
          font-family: var(--mono-font); font-size: 0.72rem; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--muted); margin-bottom: 0.7rem; font-weight: 600;
        }
        .facet-list { display: flex; flex-direction: column; gap: 2px; }
        .fbtn {
          display: flex; justify-content: space-between; align-items: center; gap: 0.5rem;
          padding: 0.45rem 0.65rem; border-radius: 8px; width: 100%; text-align: left;
          background: transparent; border: 1px solid transparent; cursor: pointer;
          color: var(--ink-2); font-family: var(--body-font); font-size: 0.84rem; font-weight: 500;
        }
        .fbtn:hover { background: var(--surface-2); color: var(--ink); }
        .fbtn.on { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
        .fbtn .c {
          font-family: var(--mono-font); font-size: 0.72rem; color: var(--muted);
          font-variant-numeric: tabular-nums;
        }
        .fbtn.on .c { color: inherit; }
        .yearbars { display: flex; align-items: flex-end; gap: 2px; height: 52px; padding: 4px 2px 0; }
        .yearbars .yb {
          flex: 1; background: var(--accent); opacity: 0.35; border: none;
          border-radius: 2px 2px 0 0; min-height: 2px; cursor: pointer; transition: opacity 0.14s;
          padding: 0;
        }
        .yearbars .yb:hover, .yearbars .yb.on { opacity: 1; }
        .yearbars-x {
          display: flex; justify-content: space-between; font-family: var(--mono-font);
          font-size: 0.6rem; color: var(--muted); margin-top: 4px;
        }

        .pubs-toolbar { display: flex; gap: 0.75rem; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; }
        .pubs-search {
          flex: 1; min-width: 240px; display: flex; align-items: center; gap: 0.6rem;
          background: var(--surface); border: 1px solid var(--line); border-radius: 11px;
          padding: 0.7rem 0.95rem;
        }
        .pubs-search:focus-within { border-color: var(--accent); }
        .pubs-search input {
          flex: 1; border: none; background: transparent; outline: none;
          font-family: var(--body-font); font-size: 0.95rem; color: var(--ink);
        }
        .pubs-search input::placeholder { color: var(--muted); }
        .pubs-sort {
          font-family: var(--body-font); font-size: 0.88rem; background: var(--surface);
          color: var(--ink); border: 1px solid var(--line); border-radius: 10px;
          padding: 0.65rem 0.75rem; cursor: pointer;
        }
        .pubs-export {
          font-family: var(--mono-font); font-size: 0.8rem; color: var(--accent);
          background: var(--accent-soft); border: 1px solid transparent; border-radius: 10px;
          padding: 0.68rem 1rem; cursor: pointer;
        }
        .pubs-export:hover { border-color: var(--accent); }
        .pubs-export:disabled { opacity: 0.45; cursor: default; }

        .pubs-resbar {
          display: flex; justify-content: space-between; align-items: baseline;
          margin-bottom: 0.8rem; flex-wrap: wrap; gap: 0.5rem;
        }
        .pubs-resbar .n { font-family: var(--mono-font); font-size: 0.8rem; color: var(--muted); }
        .pubs-resbar .n b { color: var(--ink); }
        .active-tags { display: flex; gap: 0.45rem; flex-wrap: wrap; }
        .atag {
          font-family: var(--mono-font); font-size: 0.72rem; background: var(--accent-soft);
          color: var(--accent); border: none; border-radius: 16px; padding: 0.25rem 0.65rem;
          display: inline-flex; gap: 0.35rem; align-items: center; cursor: pointer;
        }
        .clear-tags {
          font-family: var(--mono-font); font-size: 0.75rem; color: var(--muted);
          cursor: pointer; text-decoration: underline; background: none; border: none;
        }

        .pub {
          background: var(--surface); border: 1px solid var(--line); border-radius: 13px;
          padding: 1.15rem 1.3rem; margin-bottom: 0.7rem; transition: border-color 0.15s;
        }
        .pub:hover { border-color: var(--accent); }
        .pub-top { display: flex; gap: 0.6rem; align-items: center; margin-bottom: 0.5rem; flex-wrap: wrap; }
        .pub-year {
          font-family: var(--mono-font); font-weight: 600; color: var(--accent);
          font-variant-numeric: tabular-nums;
        }
        .jchip {
          font-family: var(--mono-font); font-size: 0.72rem; padding: 3px 9px; border-radius: 6px;
          background: var(--surface-2); color: var(--ink-2); border: 1px solid var(--line);
        }
        .typechip {
          font-family: var(--mono-font); font-size: 0.66rem; letter-spacing: 0.05em;
          text-transform: uppercase; padding: 3px 8px; border-radius: 6px;
        }
        .typechip.orig { background: var(--accent-soft); color: var(--accent); }
        .typechip.guide { background: var(--surface-2); color: var(--ink-2); }
        .typechip.warm { background: rgba(240, 169, 74, 0.14); color: var(--warm); }
        .typechip.new { background: var(--good); color: #05201d; }
        .pub-title-line {
          font-family: var(--heading-font); font-size: 1.06rem; font-weight: 600;
          line-height: 1.35; color: var(--ink); margin-bottom: 0.5rem;
        }
        .pub-auth { font-size: 0.84rem; color: var(--muted); margin-bottom: 0.7rem; line-height: 1.5; }
        .pub-meta-line { font-family: var(--mono-font); font-size: 0.76rem; color: var(--muted); margin-bottom: 0.7rem; }
        .pub-notes { font-size: 0.8rem; color: var(--warm); font-weight: 600; margin-bottom: 0.7rem; }
        .pub-abs { margin-bottom: 0.7rem; }
        .pub-abs-toggle {
          background: none; border: none; color: var(--accent); cursor: pointer;
          font-family: var(--body-font); font-size: 0.8rem; padding: 0; font-weight: 600;
        }
        .pub-abs-text {
          margin-top: 0.5rem; font-size: 0.85rem; color: var(--ink-2); line-height: 1.7;
          border-left: 3px solid var(--accent); padding-left: 1rem;
        }
        .pub-foot { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
        .pub-topics { display: flex; gap: 0.35rem; flex-wrap: wrap; }
        .topic-pill {
          font-size: 0.72rem; color: var(--ink-2); background: var(--surface-2);
          border: 1px solid var(--line); border-radius: 14px; padding: 3px 10px; cursor: pointer;
          font-family: var(--body-font);
        }
        .topic-pill:hover { border-color: var(--accent); color: var(--accent); }
        .pub-actions { display: flex; gap: 0.35rem; }
        .act {
          font-family: var(--mono-font); font-size: 0.72rem; color: var(--muted);
          border: 1px solid var(--line); border-radius: 7px; padding: 5px 9px;
          cursor: pointer; background: var(--surface); text-decoration: none;
          display: inline-flex; align-items: center;
        }
        .act:hover { color: var(--accent); border-color: var(--accent); }

        .pubs-empty {
          text-align: center; padding: 3.75rem 1.25rem; color: var(--muted);
          font-family: var(--mono-font); font-size: 0.88rem; line-height: 1.8;
        }
        .pubs-toast {
          position: fixed; bottom: 1.5rem; left: 50%; transform: translate(-50%, 12px);
          background: var(--surface-2); color: var(--ink); border: 1px solid var(--line);
          border-radius: 10px; padding: 0.6rem 1.1rem; font-family: var(--mono-font);
          font-size: 0.8rem; opacity: 0; pointer-events: none;
          transition: opacity 0.2s, transform 0.2s; z-index: 60;
        }
        .pubs-toast.show { opacity: 1; transform: translate(-50%, 0); }

        @media (max-width: 900px) {
          .pubs-layout { grid-template-columns: 1fr; }
          .pubs-facets { position: static; }
        }
      `}</style>
    </main>
  );
}
