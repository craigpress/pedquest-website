"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { publications } from "@/data/publications";
import { members, institutions } from "@/data/members";
import { useScrollReveal } from "@/lib/useScrollReveal";
import { AnimatedCounter } from "@/components/AnimatedCounter";

const memberCount = members.length;
const institutionCount = institutions.length;
const countryCount = new Set(members.map((m) => m.country)).size;

const recentPubs = [...publications]
  .sort((a, b) => b.year - a.year || (b.month ?? 0) - (a.month ?? 0))
  .slice(0, 5);

// ── Living-EEG hero: deterministic wave lanes (SSR-stable, seamless loop) ──
// Paths span 2× width (0–2880) with a base period of 1440, so a -1440px
// translateX loops seamlessly. k = cycles per 1440 (density of the trace).
const HERO_WAVE_LANES = [
  { k: 3, amp: 30, y: 70, dur: 38, width: 1.7, op: 0.22 },
  { k: 5, amp: 20, y: 150, dur: 29, width: 1.3, op: 0.18 },
  { k: 8, amp: 14, y: 220, dur: 22, width: 1.1, op: 0.16 },
  { k: 4, amp: 26, y: 300, dur: 33, width: 1.5, op: 0.2 },
  { k: 11, amp: 10, y: 360, dur: 17, width: 1.0, op: 0.14 },
  { k: 6, amp: 18, y: 430, dur: 25, width: 1.2, op: 0.17 },
  { k: 9, amp: 13, y: 500, dur: 20, width: 1.0, op: 0.15 },
  { k: 4, amp: 24, y: 560, dur: 35, width: 1.4, op: 0.19 },
];

function heroWavePath({ k, amp, y }: { k: number; amp: number; y: number }) {
  const W = 2880;
  const step = 9;
  const freq = (2 * Math.PI * k) / 1440;
  let d = `M0 ${y}`;
  for (let x = step; x <= W; x += step) {
    const yy = y + Math.sin(x * freq) * amp + Math.sin(x * freq * 2 + k) * amp * 0.3;
    d += ` L${x} ${yy.toFixed(1)}`;
  }
  return d;
}

// ── Impact section data (computed from real registries) ──
const journalCount = new Set(
  publications.map((p) => p.journal).filter(Boolean)
).size;
const publicationCount = publications.length;
const since2021Count = publications.filter((p) => p.year >= 2021).length;

const IMPACT_STATS: { label: string; value: number; note: string }[] = [
  { label: "Members", value: memberCount, note: "Clinicians & scientists" },
  { label: "Institutions", value: institutionCount, note: "Children's centers" },
  { label: "Countries", value: countryCount, note: "Across the network" },
  { label: "Publications", value: publicationCount, note: "Peer-reviewed" },
  { label: "Journals", value: journalCount, note: "Distinct venues" },
  {
    label: "Since 2021",
    value: since2021Count,
    note: publicationCount
      ? `${Math.round((since2021Count / publicationCount) * 100)}% of output`
      : "",
  },
];

const PUB_CHART_FROM = 2015;
const PUB_CHART_TO = 2026;
const pubsByYear: { year: number; count: number }[] = (() => {
  const counts: Record<number, number> = {};
  for (const p of publications) if (p.year) counts[p.year] = (counts[p.year] || 0) + 1;
  const arr: { year: number; count: number }[] = [];
  for (let y = PUB_CHART_FROM; y <= PUB_CHART_TO; y++)
    arr.push({ year: y, count: counts[y] || 0 });
  return arr;
})();

// Regional member split for the network section
const NA_COUNTRIES = new Set(["USA", "United States", "US", "Canada"]);
const naMemberCount = members.filter((m) => NA_COUNTRIES.has(m.country)).length;
const intlMemberCount = memberCount - naMemberCount;

function PubYearChart({ data }: { data: { year: number; count: number }[] }) {
  const W = 520;
  const H = 150;
  const pad = 20;
  const max = Math.max(1, ...data.map((d) => d.count));
  const xs = (i: number) => pad + (i * (W - pad * 2)) / (data.length - 1 || 1);
  const ys = (c: number) => H - pad - (c / max) * (H - pad * 2);
  const line = data.map((d, i) => `${xs(i).toFixed(1)},${ys(d.count).toFixed(1)}`).join(" ");
  const area = `${pad},${H - pad} ${line} ${W - pad},${H - pad}`;
  const peak = data.reduce((a, b) => (b.count > a.count ? b : a), data[0]);
  return (
    <svg
      className="pub-chart"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Peer-reviewed publications per year"
    >
      <polygon points={area} fill="var(--accent)" opacity="0.09" />
      <polyline
        points={line}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {peak && (
        <circle cx={xs(data.indexOf(peak))} cy={ys(peak.count)} r="3.5" fill="var(--accent)" />
      )}
    </svg>
  );
}

export default function HomePage() {
  const mainRef = useScrollReveal();
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <main ref={mainRef}>
      {/* ── Hero Section — living-EEG ── */}
      <section className="hero-section">
        <div className="hero-bg" aria-hidden="true" />
        {/* Living EEG wave field — parallax + fade on scroll */}
        <div
          className="hero-waves"
          aria-hidden="true"
          style={{
            transform: `translateY(${scrollY * 0.2}px)`,
            opacity: Math.max(0.25, 1 - scrollY / 700),
          }}>
          <svg viewBox="0 0 1440 600" preserveAspectRatio="xMidYMid slice">
            {HERO_WAVE_LANES.map((lane, i) => (
              <path
                key={i}
                className="hero-wave"
                d={heroWavePath(lane)}
                fill="none"
                strokeWidth={lane.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  opacity: lane.op,
                  animationDuration: `${lane.dur}s`,
                }}
              />
            ))}
          </svg>
        </div>
        <div className="hero-content">
          <div className="hero-copy">
            <span className="hero-eyebrow">
              Pediatric Quantitative EEG · Strategic Taskforce
            </span>
            <h1 className="hero-heading">
              Turn continuous EEG into{" "}
              <span className="hero-accent">answers</span> at the bedside of
              every critically ill child.
            </h1>
            <p className="hero-subtitle">
              PedQuEST is an international consortium of pediatric neurologists,
              neurophysiologists, and data scientists building the evidence,
              methods, and shared standards for quantitative EEG in pediatric
              critical care.
            </p>
            <div className="hero-ctas">
              <Link href="/about" className="btn-primary">
                Explore our work
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 8h10M9 4l4 4-4 4" />
                </svg>
              </Link>
              <Link href="/join" className="btn-secondary">
                Join the consortium
              </Link>
            </div>
            <p className="hero-clarifier">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
              </svg>
              A research, education &amp; collaboration platform — not a source
              of medical advice.
            </p>
          </div>
        </div>
      </section>

      {/* ── Impact ── */}
      <section className="home-section reveal">
        <div className="home-container">
          <div className="section-head">
            <span className="section-eyebrow">Consortium at a glance</span>
            <h2 className="section-h2">Evidence, not adjectives.</h2>
            <p className="section-sub">
              Every figure is computed from the live member and publication
              registry — the same numbers our sites cite in grant applications.
            </p>
          </div>
          <div className="impact-grid">
            <div className="impact-stats">
              {IMPACT_STATS.map((s) => (
                <div className="stat-card" key={s.label}>
                  <span className="stat-num">
                    <AnimatedCounter target={s.value} />
                  </span>
                  <span className="stat-key">{s.label}</span>
                  <span className="stat-note">{s.note}</span>
                </div>
              ))}
            </div>
            <div className="impact-chart">
              <div className="chart-head">
                <span className="chart-title">Peer-reviewed output by year</span>
                <span className="chart-tag">{PUB_CHART_TO} partial</span>
              </div>
              <PubYearChart data={pubsByYear} />
              <div className="chart-axis">
                <span>&apos;{String(PUB_CHART_FROM).slice(2)}</span>
                <span>&apos;{String(PUB_CHART_TO).slice(2)}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── What we do ── */}
      <section className="home-section reveal">
        <div className="home-container">
          <div className="section-head">
            <span className="section-eyebrow">What we do</span>
            <h2 className="section-h2">One signal, three shared jobs.</h2>
            <p className="section-sub">
              qEEG only changes outcomes if it is measured the same way,
              interpreted with evidence, and taught widely. PedQuEST works all
              three at once.
            </p>
          </div>
          <div className="work-grid">
            <Link href="/about" className="work-card">
              <span className="work-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h4l3-8 4 16 3-8h4" /></svg>
              </span>
              <h3 className="work-title">Multicenter monitoring</h3>
              <p className="work-desc">
                Harmonized qEEG capture across neuro-ICUs and PICUs, so a
                recording in Toronto means the same thing as one in
                Philadelphia.
              </p>
              <span className="work-tags">{institutionCount} sites · shared protocol</span>
            </Link>
            <Link href="/publications" className="work-card">
              <span className="work-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3h6M10 3v5L5.2 17A2 2 0 007 20h10a2 2 0 001.8-3L14 8V3" /></svg>
              </span>
              <h3 className="work-title">Methods &amp; standards</h3>
              <p className="work-desc">
                Reproducible feature definitions, open benchmarks, and
                validation studies that turn qEEG from expert intuition into
                measurable science.
              </p>
              <span className="work-tags">Open definitions · benchmarking</span>
            </Link>
            <Link href="/education" className="work-card">
              <span className="work-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4L2 9l10 5 10-5-10-5zM4 11v5c0 1.5 3.6 3 8 3s8-1.5 8-3v-5" /></svg>
              </span>
              <h3 className="work-title">Education &amp; training</h3>
              <p className="work-desc">
                Case libraries, curricula, and fellowships that build qEEG
                literacy for the next generation of pediatric neurocritical care
                clinicians.
              </p>
              <span className="work-tags">Curriculum · case library</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Research library ── */}
      <section className="home-section reveal">
        <div className="home-container">
          <div className="section-head">
            <span className="section-eyebrow">Research library</span>
            <h2 className="section-h2">
              A searchable, citable record of the field.
            </h2>
            <p className="section-sub">
              {publicationCount} publications, auto-refreshed from PubMed and
              exportable to your reference manager — from foundational papers to
              this year&apos;s work.
            </p>
          </div>
          <div className="pub-list">
            {recentPubs.map((pub) => (
              <article className="pub-row" key={pub.id}>
                <span className="pub-row-year">{pub.year}</span>
                <div className="pub-row-body">
                  <h3 className="pub-row-title">{pub.title}</h3>
                  <div className="pub-row-tags">
                    {pub.journal && (
                      <span className="pub-pill pub-pill-journal">{pub.journal}</span>
                    )}
                    {(pub.categories ?? []).slice(0, 2).map((c) => (
                      <span className="pub-pill" key={c}>
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
                <Link href="/publications" className="pub-row-cite">
                  Cite
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 3h8v8M13 3L3 13" />
                  </svg>
                </Link>
              </article>
            ))}
          </div>
          <div className="section-cta">
            <Link href="/publications" className="btn-primary">
              Browse the full library
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </Link>
            <Link href="/publications" className="btn-secondary">
              Explore by topic
            </Link>
          </div>
        </div>
      </section>

      {/* ── The network (members) ── */}
      <section className="home-section reveal">
        <div className="home-container">
          <div className="section-head">
            <span className="section-eyebrow">The network</span>
            <h2 className="section-h2">
              {institutionCount} institutions. {countryCount} countries. One
              shared question.
            </h2>
            <p className="section-sub">
              PedQuEST connects the children&apos;s hospitals doing frontline
              pediatric neuromonitoring.
            </p>
          </div>
          <div className="network-grid">
            <div className="network-card">
              <span className="network-key">North America</span>
              <span className="network-num">{naMemberCount} members</span>
              <p className="network-desc">
                Across the US and Canada — from CHOP and Boston Children&apos;s
                to SickKids and Seattle.
              </p>
            </div>
            <div className="network-card">
              <span className="network-key">Europe · Oceania · Asia</span>
              <span className="network-num">{intlMemberCount} members</span>
              <p className="network-desc">
                Global partners bringing shared protocols to children&apos;s
                centers across four continents.
              </p>
            </div>
            <Link href="/members" className="network-card network-card-accent">
              <span className="network-key">Explore</span>
              <span className="network-num">The member map</span>
              <p className="network-desc">
                See every site as an interactive geographic map and
                collaboration network.
              </p>
              <span className="network-link">
                Open the network
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 8h10M9 4l4 4-4 4" />
                </svg>
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Get involved ── */}
      <section className="home-section reveal">
        <div className="home-container">
          <div className="section-head">
            <span className="section-eyebrow">Get involved</span>
            <h2 className="section-h2">Three ways to work with PedQuEST.</h2>
          </div>
          <div className="involve-grid">
            <Link href="/join" className="involve-card involve-card-accent">
              <span className="involve-key">For sites</span>
              <h3 className="involve-title">Join as a member site</h3>
              <p className="involve-desc">
                Contribute qEEG data, adopt the shared protocol, and co-author
                multicenter studies with the field&apos;s leading centers.
              </p>
              <span className="involve-cta">Start your application →</span>
            </Link>
            <Link href="/contact" className="involve-card">
              <span className="involve-key">For researchers</span>
              <h3 className="involve-title">Collaborate on a study</h3>
              <p className="involve-desc">
                Propose an analysis, request access to harmonized cohorts, or
                bring your methods to a consortium-scale dataset.
              </p>
              <span className="involve-link">Propose a project →</span>
            </Link>
            <Link href="/publications" className="involve-card">
              <span className="involve-key">For everyone</span>
              <h3 className="involve-title">Cite &amp; follow the work</h3>
              <p className="involve-desc">
                Use the publication library, cite PedQuEST in your protocols,
                and follow new evidence as it&apos;s indexed each week.
              </p>
              <span className="involve-link">Get the citation →</span>
            </Link>
          </div>
        </div>
      </section>

      <style>{`
        /* ── Homepage redesign sections (dark instrument palette) ── */
        .home-section { padding: clamp(3.5rem, 7vw, 6rem) 2rem; background: var(--bg); }
        .home-container { max-width: 1200px; margin: 0 auto; }
        .section-head { max-width: 640px; margin-bottom: 2.75rem; }
        .section-eyebrow {
          font-family: var(--mono-font); font-size: 0.76rem; font-weight: 600;
          letter-spacing: 0.16em; text-transform: uppercase; color: var(--accent);
        }
        .section-h2 {
          font-family: var(--heading-font); font-size: clamp(1.9rem, 3.6vw, 2.9rem);
          font-weight: 700; line-height: 1.08; letter-spacing: -0.02em;
          color: var(--ink); margin: 0.9rem 0 0; text-wrap: balance;
        }
        .section-sub {
          margin-top: 1rem; font-size: 1.05rem; line-height: 1.6;
          color: var(--ink-2); max-width: 52ch;
        }
        .section-cta { display: flex; flex-wrap: wrap; gap: 1rem; margin-top: 2rem; }

        /* Impact */
        .impact-grid {
          display: grid; grid-template-columns: 1.1fr 1fr; gap: 1.5rem; align-items: start;
        }
        .impact-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
        .stat-card {
          display: flex; flex-direction: column; gap: 0.1rem; padding: 1.25rem;
          background: var(--surface); border: 1px solid var(--line);
          border-radius: 14px; min-height: 130px;
        }
        .stat-num {
          font-family: var(--heading-font); font-size: 2rem; font-weight: 700;
          color: var(--ink); letter-spacing: -0.02em;
        }
        .stat-key {
          font-family: var(--mono-font); font-size: 0.72rem; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--muted); margin-top: 0.15rem;
        }
        .stat-note { font-size: 0.82rem; color: var(--ink-2); margin-top: 0.5rem; }
        .impact-chart {
          padding: 1.5rem; background: var(--surface);
          border: 1px solid var(--line); border-radius: 14px;
        }
        .chart-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 1rem; }
        .chart-title { font-size: 0.95rem; color: var(--ink); font-weight: 600; }
        .chart-tag {
          font-family: var(--mono-font); font-size: 0.7rem; text-transform: uppercase;
          letter-spacing: 0.08em; color: var(--muted);
        }
        .pub-chart { width: 100%; height: 160px; display: block; }
        .chart-axis {
          display: flex; justify-content: space-between; font-family: var(--mono-font);
          font-size: 0.7rem; color: var(--muted); margin-top: 0.4rem;
        }

        /* What we do */
        .work-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.25rem; }
        .work-card {
          display: block; padding: 1.75rem; background: var(--surface);
          border: 1px solid var(--line); border-radius: 16px; text-decoration: none;
          transition: border-color 0.15s, transform 0.15s;
        }
        .work-card:hover { border-color: var(--accent); transform: translateY(-3px); }
        .work-icon {
          display: inline-flex; align-items: center; justify-content: center;
          width: 40px; height: 40px; border-radius: 11px;
          background: var(--accent-soft); color: var(--accent); margin-bottom: 1rem;
        }
        .work-title {
          font-family: var(--heading-font); font-size: 1.2rem; font-weight: 600;
          color: var(--ink); margin-bottom: 0.6rem;
        }
        .work-desc { font-size: 0.94rem; line-height: 1.6; color: var(--ink-2); }
        .work-tags {
          display: block; margin-top: 1.1rem; font-family: var(--mono-font);
          font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted);
        }

        /* Research library */
        .pub-list { border-top: 1px solid var(--line); }
        .pub-row {
          display: grid; grid-template-columns: 4rem 1fr auto; gap: 1.25rem;
          align-items: center; padding: 1.25rem 0; border-bottom: 1px solid var(--line);
        }
        .pub-row-year { font-family: var(--mono-font); font-size: 0.9rem; font-weight: 600; color: var(--accent); }
        .pub-row-title { font-size: 1rem; font-weight: 600; color: var(--ink); line-height: 1.4; }
        .pub-row-tags { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.55rem; }
        .pub-pill {
          font-family: var(--mono-font); font-size: 0.68rem; letter-spacing: 0.04em;
          text-transform: uppercase; color: var(--ink-2); background: var(--surface-2);
          border: 1px solid var(--line); border-radius: 999px; padding: 0.2rem 0.6rem;
        }
        .pub-pill-journal { color: var(--accent); border-color: var(--accent-soft); }
        .pub-row-cite {
          display: inline-flex; align-items: center; gap: 0.35rem; font-family: var(--mono-font);
          font-size: 0.78rem; color: var(--ink-2); text-decoration: none; white-space: nowrap;
        }
        .pub-row-cite:hover { color: var(--accent); }

        /* Network + Get involved */
        .network-grid, .involve-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.25rem; }
        .network-card, .involve-card {
          display: flex; flex-direction: column; padding: 1.75rem; background: var(--surface);
          border: 1px solid var(--line); border-radius: 16px; text-decoration: none; min-height: 200px;
        }
        .network-key, .involve-key {
          font-family: var(--mono-font); font-size: 0.72rem; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--muted);
        }
        .network-num {
          display: block; font-family: var(--heading-font); font-size: 1.5rem;
          font-weight: 700; color: var(--ink); margin: 0.5rem 0 0.7rem;
        }
        .involve-title {
          font-family: var(--heading-font); font-size: 1.2rem; font-weight: 600;
          color: var(--ink); margin: 0.5rem 0 0.6rem;
        }
        .network-desc, .involve-desc { font-size: 0.92rem; line-height: 1.55; color: var(--ink-2); flex: 1; }
        .network-link, .involve-cta, .involve-link {
          display: inline-flex; align-items: center; gap: 0.4rem; margin-top: 1rem;
          font-size: 0.85rem; font-weight: 600; color: var(--accent);
        }
        .network-card-accent, .involve-card-accent {
          background: linear-gradient(150deg, var(--accent), #1aa596); border-color: transparent;
        }
        .network-card-accent .network-key, .network-card-accent .network-num,
        .network-card-accent .network-desc, .network-card-accent .network-link,
        .involve-card-accent .involve-key, .involve-card-accent .involve-title,
        .involve-card-accent .involve-desc, .involve-card-accent .involve-cta { color: #05201d; }

        @media (max-width: 900px) {
          .impact-grid { grid-template-columns: 1fr; }
          .work-grid, .network-grid, .involve-grid { grid-template-columns: 1fr; }
        }
        @media (max-width: 560px) {
          .impact-stats { grid-template-columns: repeat(2, 1fr); }
          .pub-row { grid-template-columns: 3rem 1fr; }
          .pub-row-cite { grid-column: 2; justify-self: start; }
        }

        /* ── Entrance animations ── */
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scale-in {
          from { opacity: 0; transform: scale(0.92); }
          to { opacity: 1; transform: scale(1); }
        }

        /* ── Hero ── */
        .hero-section {
          position: relative;
          min-height: 82vh;
          display: flex;
          align-items: center;
          overflow: hidden;
          padding: 5rem 2rem 4rem;
          background: var(--bg);
          color: var(--text);
        }
        @keyframes gradient-drift {
          0%   { background-position: 0% 50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .hero-bg {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse 80% 60% at 15% 30%, color-mix(in srgb, var(--accent-primary) 10%, transparent) 0%, transparent 60%),
            radial-gradient(ellipse 60% 50% at 85% 25%, color-mix(in srgb, var(--accent-tertiary) 8%, transparent) 0%, transparent 55%),
            radial-gradient(ellipse 70% 50% at 50% 70%, color-mix(in srgb, var(--accent-secondary) 8%, transparent) 0%, transparent 50%);
          background-size: 200% 200%;
          animation: gradient-drift 20s ease infinite;
          z-index: 0;
        }

        /* ── Spectrogram ── */
        .spectrogram-container {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 0;
          opacity: 0.12;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .spectrogram-band {
          flex: 1;
          background-size: 400px 100%;
          animation: spectrogram-flow 20s linear infinite;
        }
        .band-delta {
          background: repeating-linear-gradient(90deg,
            #1e3a8a 0px, #2563eb 8px, #1e40af 16px, #3b82f6 24px, #1d4ed8 32px,
            #2563eb 40px, #1e3a8a 48px, #3b82f6 56px, #1e40af 64px, #2563eb 72px,
            #1d4ed8 80px, #1e3a8a 88px, #2563eb 96px, transparent 100px,
            #1e3a8a 108px, #3b82f6 116px, #1e40af 124px, #2563eb 132px, #1d4ed8 140px);
          opacity: 0.9;
          animation-duration: 25s;
        }
        .band-theta {
          background: repeating-linear-gradient(90deg,
            #0d9488 0px, #14b8a6 6px, #0f766e 12px, #2dd4bf 18px, #0d9488 24px,
            #14b8a6 30px, transparent 36px, #0f766e 42px, #2dd4bf 48px, #0d9488 54px,
            #14b8a6 60px, #0f766e 66px, #2dd4bf 72px, transparent 78px);
          opacity: 0.8;
          animation-duration: 18s;
        }
        .band-alpha {
          background: repeating-linear-gradient(90deg,
            #16a34a 0px, #22c55e 5px, #15803d 10px, #4ade80 15px, #16a34a 20px,
            transparent 25px, #22c55e 30px, #15803d 35px, #4ade80 40px, #16a34a 45px,
            #22c55e 50px, transparent 55px, #15803d 60px, #4ade80 65px);
          opacity: 0.7;
          animation-duration: 15s;
        }
        .band-beta {
          background: repeating-linear-gradient(90deg,
            #dc2626 0px, #f87171 4px, #b91c1c 8px, #fca5a5 12px, #dc2626 16px,
            transparent 20px, #ef4444 24px, #b91c1c 28px, #f87171 32px, transparent 36px,
            #dc2626 40px, #ef4444 44px, #fca5a5 48px, #b91c1c 52px);
          opacity: 0.6;
          animation-duration: 12s;
        }
        .band-gamma {
          background: repeating-linear-gradient(90deg,
            #9333ea 0px, #a855f7 3px, #7e22ce 6px, #c084fc 9px, #9333ea 12px,
            transparent 15px, #a855f7 18px, transparent 21px, #7e22ce 24px, #c084fc 27px,
            #9333ea 30px, #a855f7 33px, transparent 36px);
          opacity: 0.5;
          animation-duration: 10s;
        }
        @keyframes spectrogram-flow {
          0% { background-position: 0 0; }
          100% { background-position: 400px 0; }
        }
        /* ── Living-EEG wave field ── */
        .hero-waves {
          position: absolute;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          will-change: transform, opacity;
        }
        .hero-waves svg {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
        }
        .hero-wave {
          stroke: var(--accent);
          animation-name: hero-wave-scroll;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        @keyframes hero-wave-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-1440px); }
        }

        .hero-content {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 1200px;
          margin: 0 auto;
          text-align: left;
        }
        .hero-copy {
          max-width: 760px;
        }
        .hero-eyebrow {
          display: inline-block;
          font-size: 0.8rem;
          font-weight: 700;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--accent-primary);
          margin-bottom: 1.4rem;
          animation: fade-up 0.7s ease-out both;
        }
        .hero-heading {
          font-family: var(--heading-font);
          font-size: clamp(2.4rem, 5.4vw, 4.1rem);
          font-weight: 800;
          line-height: 1.05;
          color: var(--text);
          margin-bottom: 1.5rem;
          letter-spacing: -0.03em;
          max-width: 16ch;
          text-wrap: balance;
          animation: fade-up 0.7s ease-out 0.08s both;
        }
        .hero-accent {
          color: var(--accent-primary);
        }
        .hero-subtitle {
          font-size: 1.15rem;
          color: var(--text-secondary);
          line-height: 1.7;
          max-width: 48ch;
          margin: 0 0 2.25rem;
          animation: fade-up 0.7s ease-out 0.16s both;
        }
        .hero-ctas {
          display: flex;
          gap: 1rem;
          justify-content: flex-start;
          flex-wrap: wrap;
          animation: fade-up 0.7s ease-out 0.24s both;
        }
        .hero-clarifier {
          display: flex;
          align-items: flex-start;
          gap: 0.55rem;
          margin-top: 1.9rem;
          font-size: 0.85rem;
          color: var(--text-muted);
          max-width: 46ch;
          animation: fade-up 0.7s ease-out 0.32s both;
        }
        .hero-clarifier svg {
          flex: none;
          margin-top: 2px;
          color: var(--accent-tertiary);
        }
        @media (prefers-reduced-motion: reduce) {
          .hero-wave { animation: none; }
        }

        /* ── Stats Bar ── */
        .stats-bar {
          padding: 0 2rem;
          margin-top: -2rem;
          position: relative;
          z-index: 2;
        }
        .stats-container {
          max-width: 700px;
          margin: 0 auto;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 3rem;
          padding: 2rem 3rem;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 16px;
          box-shadow: var(--shadow-lg);
          animation: scale-in 0.6s ease-out 0.45s both;
        }
        .stat-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.25rem;
        }
        .stat-number {
          font-family: var(--heading-font);
          font-size: 2.75rem;
          font-weight: 800;
          background: linear-gradient(135deg, var(--accent-primary), var(--accent-tertiary));
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          line-height: 1;
        }
        .stat-label {
          font-size: 0.85rem;
          color: var(--text-secondary);
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .stat-divider {
          width: 1px;
          height: 48px;
          background: var(--border-strong);
        }

        /* ── EEG Waveform ── */
        .eeg-wave-container {
          position: absolute;
          bottom: 10%;
          left: 0;
          right: 0;
          height: 140px;
          z-index: 0;
          opacity: 0.2;
          overflow: hidden;
        }
        .eeg-wave {
          width: 200%;
          height: 100%;
        }
        .eeg-trace-1 {
          stroke: #3b82f6;
          animation: eeg-scroll 12s linear infinite;
        }
        .eeg-trace-2 {
          stroke: #ef4444;
          opacity: 0.6;
          animation: eeg-scroll 16s linear infinite;
        }
        .eeg-trace-3 {
          stroke: #10b981;
          opacity: 0.5;
          animation: eeg-scroll 20s linear infinite;
        }
        @keyframes eeg-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }

        /* ── Features ── */
        .features-section {
          padding: 4rem 2rem;
          max-width: 1100px;
          margin: 0 auto;
        }
        .features-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1.5rem;
        }
        .feature-card {
          padding: 2.25rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
          text-decoration: none;
          color: var(--text);
          cursor: pointer;
          animation: fade-up 0.6s ease-out both;
          transition: all 0.25s ease;
        }
        .feature-card:nth-child(1) { animation-delay: 0.1s; }
        .feature-card:nth-child(2) { animation-delay: 0.2s; }
        .feature-card:nth-child(3) { animation-delay: 0.3s; }
        .feature-card:hover {
          color: var(--text);
          transform: translateY(-4px);
        }
        .feature-icon {
          width: 52px;
          height: 52px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .research-icon {
          background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
          color: var(--accent-primary);
        }
        .education-icon {
          background: color-mix(in srgb, var(--accent-tertiary) 12%, transparent);
          color: var(--accent-tertiary);
        }
        .publications-icon {
          background: color-mix(in srgb, var(--accent-secondary) 15%, transparent);
          color: var(--accent-secondary);
        }
        .feature-title {
          font-family: var(--heading-font);
          font-size: 1.35rem;
          font-weight: 700;
        }
        .feature-description {
          font-size: 0.95rem;
          color: var(--text-secondary);
          line-height: 1.6;
          flex: 1;
        }
        .feature-link {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.9rem;
          font-weight: 600;
          color: var(--accent-primary);
          margin-top: 0.5rem;
          transition: gap 0.15s ease;
        }
        .feature-card:hover .feature-link {
          gap: 0.6rem;
        }

        /* ── Publications Preview ── */
        .publications-section {
          padding: 4rem 2rem;
          background: var(--bg-card);
          border-top: 1px solid var(--border);
          border-bottom: 1px solid var(--border);
        }
        .publications-container {
          max-width: 1100px;
          margin: 0 auto;
        }
        .publications-header {
          margin-bottom: 3rem;
        }
        /* Featured research layout */
        .featured-research-grid {
          display: grid;
          grid-template-columns: 1.4fr 1fr;
          gap: 1.25rem;
          align-items: start;
        }
        .featured-pub-card {
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .featured-pub-wave {
          position: relative;
          height: 100px;
          background: linear-gradient(135deg, color-mix(in srgb, var(--accent-primary) 8%, var(--bg-card)) 0%, color-mix(in srgb, var(--accent-secondary) 6%, var(--bg-card)) 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          border-bottom: 1px solid var(--border);
        }
        .featured-badge {
          position: absolute;
          top: 12px;
          left: 14px;
          font-size: 0.65rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--bg);
          background: var(--accent-primary);
          padding: 0.2rem 0.6rem;
          border-radius: 4px;
        }
        .featured-pub-body {
          padding: 1.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          flex: 1;
        }
        .featured-pub-title {
          font-family: var(--heading-font);
          font-size: 1.25rem;
          font-weight: 700;
          line-height: 1.35;
          color: var(--text);
        }
        .featured-pub-abstract {
          font-size: 0.88rem;
          color: var(--text-secondary);
          line-height: 1.65;
        }
        .sidebar-pubs {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
        }
        .sidebar-pub-card {
          padding: 1.5rem;
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
        }
        .pub-card {
          padding: 1.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .pub-meta {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .pub-journal {
          color: var(--accent-primary);
          font-weight: 600;
        }
        .pub-year {
          color: var(--text-muted);
        }
        .pub-title {
          font-family: var(--heading-font);
          font-size: 1.05rem;
          font-weight: 600;
          line-height: 1.4;
          color: var(--text);
        }
        .pub-authors {
          font-size: 0.85rem;
          color: var(--text-secondary);
        }
        .publications-cta {
          margin-top: 2.5rem;
          text-align: center;
        }

        /* ── PERF Acknowledgment ── */
        .perf-section {
          padding: 4rem 2rem;
        }
        .perf-container {
          max-width: 700px;
          margin: 0 auto;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.75rem;
        }
        .perf-label {
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--text-muted);
          font-weight: 600;
        }
        .perf-name {
          font-family: var(--heading-font);
          font-size: 1.35rem;
          font-weight: 700;
          color: var(--text);
        }
        .perf-link {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          font-size: 0.9rem;
          font-weight: 600;
          color: var(--accent-primary);
          margin-top: 0.5rem;
        }

        /* ── Join CTA ── */
        .join-section {
          padding: 5rem 2rem;
          background:
            radial-gradient(ellipse 70% 50% at 50% 50%, color-mix(in srgb, var(--accent-primary) 8%, transparent) 0%, transparent 70%);
          border-top: 1px solid var(--border);
        }
        .join-container {
          max-width: 640px;
          margin: 0 auto;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1.25rem;
        }
        .join-heading {
          font-family: var(--heading-font);
          font-size: 2rem;
          font-weight: 700;
          color: var(--text);
        }
        .join-description {
          font-size: 1.05rem;
          color: var(--text-secondary);
          line-height: 1.7;
          margin-bottom: 0.5rem;
        }

        /* ── Responsive ── */
        @media (max-width: 900px) {
          .features-grid {
            grid-template-columns: 1fr;
            max-width: 500px;
            margin: 0 auto;
          }
          .featured-research-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 600px) {
          .hero-section {
            min-height: 65vh;
            padding: 3rem 1.25rem 2rem;
          }
          .stats-bar {
            padding: 0 1.25rem;
            margin-top: -1.5rem;
          }
          .stats-container {
            gap: 1rem;
            padding: 1.25rem 1rem;
          }
          .stat-number {
            font-size: 2rem;
          }
          .stat-divider {
            height: 36px;
          }
        }
        @media (max-width: 480px) {
          .stats-container {
            gap: 0;
            padding: 1.25rem 0.75rem;
            justify-content: space-around;
          }
          .stat-divider {
            display: none;
          }
          .features-section {
            padding: 4rem 1.25rem;
          }
          .publications-section {
            padding: 3.5rem 1.25rem;
          }
          .join-section {
            padding: 4rem 1.25rem;
          }
        }
      `}</style>
    </main>
  );
}
