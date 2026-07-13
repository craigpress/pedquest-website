"use client";

import { useState, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { members, institutions } from "@/data/members";
import MemberAvatar from "@/components/MemberAvatar";

const MemberMap = dynamic(() => import("@/components/MemberMap"), {
  ssr: false,
  loading: () => (
    <div className="skeleton" style={{ height: "450px", width: "100%", borderRadius: "16px" }} />
  ),
});

export default function MembersPage() {
  const [search, setSearch] = useState("");
  const [filterInstitution, setFilterInstitution] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [mapExpanded, setMapExpanded] = useState(false);
  const toggleMap = useCallback(() => setMapExpanded((v) => !v), []);

  const uniqueInstitutions = useMemo(
    () => [...new Set(members.map((m) => m.institution))].sort(),
    []
  );
  const uniqueCountries = useMemo(
    () => [...new Set(members.map((m) => m.country))].sort(),
    []
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return members
      .filter((m) => {
        if (q && !m.name.toLowerCase().includes(q) && !m.institution.toLowerCase().includes(q) && !m.interests.some((i) => i.toLowerCase().includes(q))) return false;
        if (filterInstitution && m.institution !== filterInstitution) return false;
        if (filterCountry && m.country !== filterCountry) return false;
        return true;
      })
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [search, filterInstitution, filterCountry]);

  return (
    <main>
      {/* ── Hero ── */}
      <section className="mem-hero">
        <div className="home-container">
          <span className="section-eyebrow">The network</span>
          <h1 className="mem-hero-h1">The people reading the signals.</h1>
          <p className="mem-hero-sub">
            PedQuEST spans {members.length} investigators at{" "}
            {institutions.length} institutions across {uniqueCountries.length}{" "}
            countries — researchers and clinicians advancing pediatric
            quantitative EEG science together.
          </p>
        </div>
      </section>

      <div className="home-container mem-body">
        {/* ── Search / filter bar ── */}
        <div className="mem-toolbar">
          <label className="mem-search" htmlFor="mem-q">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>
            <input
              id="mem-q"
              type="search"
              placeholder="Search members, institutions, interests…"
              aria-label="Search members"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            className="mem-select"
            aria-label="Filter by institution"
            value={filterInstitution}
            onChange={(e) => setFilterInstitution(e.target.value)}
          >
            <option value="">All institutions</option>
            {uniqueInstitutions.map((inst) => (
              <option key={inst} value={inst}>{inst}</option>
            ))}
          </select>
          <select
            className="mem-select"
            aria-label="Filter by country"
            value={filterCountry}
            onChange={(e) => setFilterCountry(e.target.value)}
          >
            <option value="">All countries</option>
            {uniqueCountries.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {/* ── Collapsible map ── */}
        <section className="mem-map-section">
          <button
            onClick={toggleMap}
            className={`mem-map-toggle ${mapExpanded ? "open" : ""}`}
            aria-expanded={mapExpanded}
          >
            <span className="mem-map-label">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
                <line x1="8" y1="2" x2="8" y2="18" />
                <line x1="16" y1="6" x2="16" y2="22" />
              </svg>
              <span>
                {mapExpanded ? "Hide member map" : "Explore the member map"}
                <span className="mem-map-meta">
                  {institutions.length} institutions · {uniqueCountries.length} countries
                </span>
              </span>
            </span>
            <svg
              width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={{
                transform: mapExpanded ? "rotate(180deg)" : "rotate(0deg)",
                transition: "transform 0.3s ease",
                flexShrink: 0,
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <div
            className="mem-map-panel"
            style={{ maxHeight: mapExpanded ? "500px" : "0" }}
          >
            {mapExpanded && <MemberMap />}
          </div>
        </section>

        {/* ── Member grid ── */}
        <section>
          <div className="mem-count">
            <b>{filtered.length}</b> of {members.length} members
          </div>
          {filtered.length === 0 ? (
            <p className="mem-empty">No members match your search or filters.</p>
          ) : (
            <div className="mem-grid">
              {filtered.map((member) => (
                <Link key={member.id} href={`/members/${member.id}`} className="mem-card">
                  <MemberAvatar name={member.name} size="lg" photoUrl={member.photoUrl} />
                  <h3 className="mem-name">
                    {member.name}, {member.title}
                  </h3>
                  {member.role && <span className="mem-role">{member.role}</span>}
                  <p className="mem-inst">{member.institution}</p>
                  <div className="mem-tags">
                    {member.interests.slice(0, 3).map((interest) => (
                      <span key={interest} className="mem-tag">{interest}</span>
                    ))}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <style>{`
        /* ── Members page (page-specific; shared classes in globals.css) ── */
        .mem-hero {
          padding: clamp(5rem, 10vw, 8rem) 2rem clamp(2.5rem, 5vw, 4rem);
          background: var(--bg);
        }
        .mem-hero-h1 {
          font-family: var(--heading-font);
          font-size: clamp(2.2rem, 4.6vw, 3.5rem);
          font-weight: 700; line-height: 1.08; letter-spacing: -0.02em;
          color: var(--ink); margin: 0.9rem 0 0; max-width: 20ch; text-wrap: balance;
        }
        .mem-hero-sub {
          margin-top: 1.25rem; font-size: 1.1rem; line-height: 1.65;
          color: var(--ink-2); max-width: 58ch;
        }
        .mem-body { padding: 0 2rem 4.5rem; }

        .mem-toolbar { display: flex; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
        .mem-search {
          flex: 1 1 260px; display: flex; align-items: center; gap: 0.6rem;
          background: var(--surface); border: 1px solid var(--line); border-radius: 11px;
          padding: 0.7rem 0.95rem;
        }
        .mem-search:focus-within { border-color: var(--accent); }
        .mem-search input {
          flex: 1; border: none; background: transparent; outline: none;
          font-family: var(--body-font); font-size: 0.95rem; color: var(--ink);
        }
        .mem-search input::placeholder { color: var(--muted); }
        .mem-select {
          flex: 0 1 auto; font-family: var(--body-font); font-size: 0.88rem;
          background: var(--surface); color: var(--ink); border: 1px solid var(--line);
          border-radius: 10px; padding: 0.65rem 0.75rem; cursor: pointer; max-width: 260px;
        }

        .mem-map-section { margin-bottom: 2rem; }
        .mem-map-toggle {
          width: 100%; display: flex; align-items: center; justify-content: space-between;
          gap: 1rem; padding: 1rem 1.4rem; cursor: pointer;
          font-family: var(--body-font); font-size: 0.95rem; font-weight: 600;
          border: 1px solid transparent; border-radius: 16px;
          background: linear-gradient(150deg, var(--accent), #1aa596); color: #05201d;
          transition: border-radius 0.3s ease;
        }
        .mem-map-toggle.open {
          border-radius: 16px 16px 0 0;
          background: var(--surface); color: var(--ink); border-color: var(--line);
        }
        .mem-map-label { display: flex; align-items: center; gap: 0.65rem; text-align: left; }
        .mem-map-meta {
          display: block; font-family: var(--mono-font); font-size: 0.72rem;
          font-weight: 400; letter-spacing: 0.06em; text-transform: uppercase;
          opacity: 0.75; margin-top: 0.15rem;
        }
        .mem-map-panel {
          overflow: hidden; transition: max-height 0.45s ease-in-out;
          border-radius: 0 0 16px 16px;
        }

        .mem-count {
          font-family: var(--mono-font); font-size: 0.8rem; color: var(--muted);
          margin-bottom: 1rem;
        }
        .mem-count b { color: var(--ink); }
        .mem-empty { color: var(--muted); text-align: center; padding: 3rem 0; font-family: var(--mono-font); font-size: 0.88rem; }
        .mem-grid {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 1.25rem;
        }
        .mem-card {
          display: block; padding: 1.5rem; background: var(--surface);
          border: 1px solid var(--line); border-radius: 16px; text-decoration: none;
          transition: border-color 0.15s, transform 0.15s; height: 100%;
        }
        .mem-card:hover { border-color: var(--accent); transform: translateY(-3px); }
        .mem-card > :first-child { margin-bottom: 1rem; }
        .mem-name {
          font-family: var(--heading-font); font-size: 1.05rem; font-weight: 600;
          color: var(--ink); line-height: 1.3; margin-bottom: 0.35rem;
        }
        .mem-role {
          display: block; font-family: var(--mono-font); font-size: 0.68rem;
          letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent);
          margin-bottom: 0.35rem;
        }
        .mem-inst { font-size: 0.85rem; color: var(--ink-2); margin-bottom: 0.8rem; }
        .mem-tags { display: flex; flex-wrap: wrap; gap: 0.35rem; }
        .mem-tag {
          font-family: var(--mono-font); font-size: 0.66rem; letter-spacing: 0.04em;
          text-transform: uppercase; color: var(--accent); background: var(--accent-soft);
          border-radius: 999px; padding: 0.2rem 0.6rem;
        }
      `}</style>
    </main>
  );
}
