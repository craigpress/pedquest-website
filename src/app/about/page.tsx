import { Metadata } from "next";
import Link from "next/link";
import { members, institutions, type Member } from "@/data/members";
import { publications } from "@/data/publications";
import { PubYearChart } from "@/components/PubYearChart";
import MemberAvatar from "@/components/MemberAvatar";
import RevealMain from "@/components/RevealMain";

export const metadata: Metadata = {
  title: "About PedQuEST — Mission, Leadership & Research Platform",
  description:
    "Learn about PedQuEST's mission to advance quantitative EEG for pediatric critical care, our leadership team, multicenter research platform, and how to get involved.",
};

const FOUNDED = 2021;

// ── Stats (computed from the live registries) ──
const memberCount = members.length;
const institutionCount = institutions.length;
const countryCount = new Set(members.map((m) => m.country)).size;
const publicationCount = publications.length;

const CONTINENT_BY_COUNTRY: Record<string, string> = {
  USA: "North America",
  "United States": "North America",
  Canada: "North America",
  Netherlands: "Europe",
  Australia: "Oceania",
  "South Korea": "Asia",
};
const continentCount = new Set(
  members.map((m) => CONTINENT_BY_COUNTRY[m.country] ?? m.country)
).size;

// ── Publication output, full year range ──
const pubYears = publications.map((p) => p.year).filter(Boolean);
const CHART_FROM = Math.min(...pubYears);
const CHART_TO = Math.max(...pubYears);
const pubsByYear: { year: number; count: number }[] = (() => {
  const counts: Record<number, number> = {};
  for (const p of publications) if (p.year) counts[p.year] = (counts[p.year] || 0) + 1;
  const arr: { year: number; count: number }[] = [];
  for (let y = CHART_FROM; y <= CHART_TO; y++) arr.push({ year: y, count: counts[y] || 0 });
  return arr;
})();
const since2021Count = publications.filter((p) => p.year >= FOUNDED).length;

// ── Leadership, grouped by role ──
const LEADERSHIP_GROUPS: { key: Member["leadershipRole"]; label: string }[] = [
  { key: "co_director", label: "Co-Directors" },
  { key: "scientific_committee", label: "Scientific Committee" },
  { key: "senior_advisor", label: "Senior Scientific Advisors" },
  { key: "education_lead", label: "Education" },
];
const leaders = members
  .filter((m) => m.isLeadership)
  .sort((a, b) => a.sortOrder - b.sortOrder);
const coDirectorCount = leaders.filter((m) => m.leadershipRole === "co_director").length;
const sciCommitteeCount = leaders.filter(
  (m) => m.leadershipRole === "scientific_committee"
).length;

const STATS_ROWS: { label: string; value: string }[] = [
  { label: "Founded", value: String(FOUNDED) },
  { label: "Member investigators", value: String(memberCount) },
  { label: "Institutions", value: String(institutionCount) },
  { label: "Countries", value: `${countryCount} · ${continentCount} continents` },
  { label: "Peer-reviewed papers", value: String(publicationCount) },
  { label: "Governance", value: `${coDirectorCount} Co-Directors` },
  { label: "Scientific committee", value: `${sciCommitteeCount} members` },
];

export default function AboutPage() {
  return (
    <RevealMain>
      {/* ── Hero ── */}
      <section className="about-hero">
        <div className="home-container">
          <span className="section-eyebrow">About the consortium</span>
          <h1 className="about-hero-h1">
            A shared answer to a question no single center can answer alone.
          </h1>
          <p className="about-hero-sub">
            Quantitative EEG can reveal the injured pediatric brain in real time
            — but only if it&apos;s measured, validated, and taught the same way
            everywhere. PedQuEST exists to make that happen.
          </p>
        </div>
      </section>

      {/* ── Who we are + stats panel ── */}
      <section className="home-section reveal">
        <div className="home-container">
          <div className="about-intro-grid">
            <div className="about-intro-copy">
              <p className="about-lede">
                PedQuEST — the Pediatric Quantitative EEG Strategic Taskforce —
                is an international collaborative advancing EEG-based brain
                monitoring for critically ill children.
              </p>
              <p>
                Continuous EEG is already at the bedside of children in
                intensive care units around the world, but the quantitative
                signals it produces are interpreted differently at every
                center. PedQuEST brings the field&apos;s clinicians and
                scientists together to harmonize how those signals are
                captured, define the features that matter, and validate them
                against outcomes across many sites at once.
              </p>
              <p>
                Founded in {FOUNDED}, the consortium now spans {memberCount}{" "}
                investigators at {institutionCount} institutions across{" "}
                {countryCount} countries — pooling data, methods, and teaching
                so that a qEEG trend means the same thing in every unit, and
                every child benefits from the same quality of brain monitoring.
              </p>
            </div>
            <aside className="about-stats-panel" aria-label="Consortium at a glance">
              <span className="about-stats-title">Consortium at a glance</span>
              {STATS_ROWS.map((r) => (
                <div className="about-stats-row" key={r.label}>
                  <span className="about-stats-label">{r.label}</span>
                  <span className="about-stats-value">{r.value}</span>
                </div>
              ))}
            </aside>
          </div>
        </div>
      </section>

      {/* ── Field timeline ── */}
      <section className="home-section reveal">
        <div className="home-container">
          <div className="section-head">
            <span className="section-eyebrow">How we got here</span>
            <h2 className="section-h2">A field reaching critical mass.</h2>
            <p className="section-sub">
              Pediatric qEEG research has accelerated sharply — {since2021Count}{" "}
              of the field&apos;s {publicationCount} peer-reviewed papers have
              been published since PedQuEST was founded in {FOUNDED}.
            </p>
          </div>
          <div className="impact-chart">
            <div className="chart-head">
              <span className="chart-title">Peer-reviewed output by year</span>
              <span className="chart-tag">
                {CHART_FROM}–{CHART_TO} · {CHART_TO} partial
              </span>
            </div>
            <PubYearChart data={pubsByYear} />
            <div className="chart-axis">
              <span>{CHART_FROM}</span>
              <span>{FOUNDED} · founded</span>
              <span>{CHART_TO}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Leadership ── */}
      <section className="home-section reveal">
        <div className="home-container">
          <div className="section-head">
            <span className="section-eyebrow">Leadership</span>
            <h2 className="section-h2">
              Led by the clinicians doing the work.
            </h2>
            <p className="section-sub">
              PedQuEST is governed by its co-directors with a scientific
              committee and senior advisors drawn from member institutions.
            </p>
          </div>
          {LEADERSHIP_GROUPS.map((group) => {
            const groupMembers = leaders.filter((m) => m.leadershipRole === group.key);
            if (groupMembers.length === 0) return null;
            return (
              <div className="lead-group" key={group.key}>
                <span className="lead-group-label">{group.label}</span>
                <div className="lead-grid">
                  {groupMembers.map((m) => (
                    <article className="lead-card" key={m.id}>
                      <MemberAvatar name={m.name} size="lg" photoUrl={m.photoUrl} />
                      <div className="lead-card-body">
                        <h3 className="lead-name">{m.name}</h3>
                        <span className="lead-role">{m.role}</span>
                        <span className="lead-inst">
                          {m.title} · {m.institution}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="section-cta">
            <Link href="/members" className="btn-primary">
              Meet all {memberCount} members
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </Link>
            <Link href="/join" className="btn-secondary">
              Join the consortium
            </Link>
          </div>
        </div>
      </section>

      {/* ── Partners ── */}
      <section className="home-section reveal">
        <div className="home-container">
          <div className="about-perf-card">
            <span className="about-perf-label">Founding supporter</span>
            <h2 className="about-perf-name">
              Pediatric Epilepsy Research Foundation (PERF)
            </h2>
            <p className="about-perf-desc">
              PERF provides critical funding for PedQuEST&apos;s research
              infrastructure, pilot studies, and educational initiatives,
              enabling the consortium to advance qEEG science for children
              worldwide.
            </p>
            <a
              href="https://www.pediatricepilepsyresearchfoundation.org"
              target="_blank"
              rel="noopener noreferrer"
              className="about-perf-link"
            >
              Visit PERF
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 3h8v8M13 3L3 13" />
              </svg>
            </a>
          </div>
        </div>
      </section>

      <style>{`
        /* ── About page (page-specific; shared classes in globals.css) ── */
        .about-hero {
          padding: clamp(5rem, 10vw, 8rem) 2rem clamp(2.5rem, 5vw, 4rem);
          background: var(--bg);
        }
        .about-hero-h1 {
          font-family: var(--heading-font);
          font-size: clamp(2.2rem, 4.6vw, 3.5rem);
          font-weight: 700;
          line-height: 1.08;
          letter-spacing: -0.02em;
          color: var(--ink);
          margin: 0.9rem 0 0;
          max-width: 20ch;
          text-wrap: balance;
        }
        .about-hero-sub {
          margin-top: 1.25rem;
          font-size: 1.1rem;
          line-height: 1.65;
          color: var(--ink-2);
          max-width: 58ch;
        }

        /* Intro + stats panel */
        .about-intro-grid {
          display: grid;
          grid-template-columns: 1.4fr 1fr;
          gap: 2.5rem;
          align-items: start;
        }
        .about-lede {
          font-family: var(--heading-font);
          font-size: 1.35rem;
          font-weight: 600;
          line-height: 1.4;
          color: var(--ink);
          margin-bottom: 1.25rem;
        }
        .about-intro-copy p:not(.about-lede) {
          font-size: 1rem;
          line-height: 1.7;
          color: var(--ink-2);
          margin-bottom: 1.1rem;
          max-width: 62ch;
        }
        .about-stats-panel {
          padding: 1.5rem 1.75rem;
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 16px;
        }
        .about-stats-title {
          display: block;
          font-family: var(--mono-font);
          font-size: 0.72rem;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--accent);
          padding-bottom: 0.9rem;
          border-bottom: 1px solid var(--line);
        }
        .about-stats-row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 1rem;
          padding: 0.8rem 0;
          border-bottom: 1px solid var(--line);
        }
        .about-stats-row:last-child { border-bottom: none; padding-bottom: 0; }
        .about-stats-label {
          font-family: var(--mono-font);
          font-size: 0.72rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .about-stats-value {
          font-family: var(--heading-font);
          font-size: 1.05rem;
          font-weight: 700;
          color: var(--ink);
          text-align: right;
          white-space: nowrap;
        }

        /* Leadership */
        .lead-group { margin-bottom: 2.25rem; }
        .lead-group:last-of-type { margin-bottom: 0; }
        .lead-group-label {
          display: block;
          font-family: var(--mono-font);
          font-size: 0.72rem;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--muted);
          margin-bottom: 1rem;
        }
        .lead-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(310px, 1fr));
          gap: 1.25rem;
        }
        .lead-card {
          display: flex;
          gap: 1rem;
          align-items: flex-start;
          padding: 1.4rem;
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 16px;
        }
        .lead-card-body { display: flex; flex-direction: column; min-width: 0; }
        .lead-name {
          font-family: var(--heading-font);
          font-size: 1.1rem;
          font-weight: 600;
          color: var(--ink);
          line-height: 1.25;
        }
        .lead-role {
          font-family: var(--mono-font);
          font-size: 0.7rem;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--accent);
          margin-top: 0.35rem;
        }
        .lead-inst {
          font-size: 0.85rem;
          line-height: 1.45;
          color: var(--ink-2);
          margin-top: 0.45rem;
        }

        /* Partners */
        .about-perf-card {
          padding: 2.25rem;
          background: var(--surface);
          border: 1px solid var(--line);
          border-radius: 16px;
          max-width: 720px;
        }
        .about-perf-label {
          font-family: var(--mono-font);
          font-size: 0.72rem;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--accent);
        }
        .about-perf-name {
          font-family: var(--heading-font);
          font-size: 1.4rem;
          font-weight: 700;
          color: var(--ink);
          margin: 0.7rem 0 0.6rem;
          text-wrap: balance;
        }
        .about-perf-desc {
          font-size: 0.95rem;
          line-height: 1.65;
          color: var(--ink-2);
          max-width: 58ch;
        }
        .about-perf-link {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          margin-top: 1.2rem;
          font-size: 0.88rem;
          font-weight: 600;
          color: var(--accent);
        }

        @media (max-width: 900px) {
          .about-intro-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </RevealMain>
  );
}
