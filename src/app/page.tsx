import Link from "next/link";
import { publications } from "@/data/publications";
import { members, institutions, CONTINENT_BY_COUNTRY } from "@/data/members";
import RevealMain from "@/components/RevealMain";
import { HeroEEG } from "@/components/HeroEEG";
import { AnimatedCounter } from "@/components/AnimatedCounter";
import { PubYearChart } from "@/components/PubYearChart";

const memberCount = members.length;
const institutionCount = institutions.length;
const countryCount = new Set(members.map((m) => m.country)).size;

const recentPubs = [...publications]
  .sort((a, b) => b.year - a.year || (b.month ?? 0) - (a.month ?? 0))
  .slice(0, 5);

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

// Work produced by the consortium itself, kept separate from the members'
// individual output counted above so the site never presents a member's own
// paper as PedQuEST's. Citations verified against PubMed and the AES 2025
// program (2026-09-16); the abstract has no DOI, so it carries no link.
const CONSORTIUM_WORK: { tag: string; title: string; cite: string; href?: string }[] = [
  {
    tag: "Consortium abstract",
    title:
      "Development of a Multicenter EEG Research Consortium and Data Platform to Advance Pediatric Quantitative EEG Research",
    cite: "Press CA, Benedetti GM, … Wagenaar JB. American Epilepsy Society Annual Meeting; 2025 (poster 2.172).",
  },
  {
    tag: "qEEG evidence",
    title: "Predicting pediatric cardiac arrest outcomes using early quantitative EEG",
    cite: "Benedetti GM, … Press CA. Resuscitation. 2025;218:110838.",
    href: "https://doi.org/10.1016/j.resuscitation.2025.110838",
  },
  {
    tag: "qEEG methods",
    title:
      "Review of Noninvasive Neuromonitoring Modalities in Children II: EEG and Quantitative EEG",
    cite: "Benedetti GM, Guerriero RM, Press CA. Neurocrit Care. 2023;39(3):618–638.",
    href: "https://doi.org/10.1007/s12028-023-01686-5",
  },
  {
    tag: "qEEG practice",
    title:
      "The Spectrum of Quantitative EEG Utilization Across North America: A Cross-Sectional Survey",
    cite: "Benedetti GM, … Press CA. Pediatr Neurol. 2023;141:1–8.",
    href: "https://doi.org/10.1016/j.pediatrneurol.2022.12.016",
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
const continentCount = new Set(
  members.map((m) => CONTINENT_BY_COUNTRY[m.country] ?? m.country)
).size;
const intlContinents = [
  ...new Set(
    members
      .filter((m) => !NA_COUNTRIES.has(m.country))
      .map((m) => CONTINENT_BY_COUNTRY[m.country] ?? m.country)
  ),
];
const CONTINENT_WORDS: Record<number, string> = {
  2: "two", 3: "three", 4: "four", 5: "five", 6: "six",
};
const continentWord = CONTINENT_WORDS[continentCount] ?? String(continentCount);

export default function HomePage() {
  return (
    <RevealMain>
      {/* ── Hero Section — living-EEG monitor ── */}
      <section className="hero-section">
        <HeroEEG />
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
        <span className="montage-tag" aria-hidden="true">
          LIVE · 10–20 MONTAGE · 0–20 Hz
        </span>
      </section>

      {/* ── Impact ── */}
      <section className="home-section reveal">
        <div className="home-container">
          <div className="section-head">
            <span className="section-eyebrow">Consortium at a glance</span>
            <h2 className="section-h2">Membership and scientific contributions</h2>
            <p className="section-sub">
              The counts and the chart below reflect our members&apos; own
              peer-reviewed scholarship, indexed live from PubMed as members
              join and papers are published. Work produced by the PedQuEST
              consortium itself is listed separately below.
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
                <span className="chart-title">Members&apos; peer-reviewed output by year</span>
                <span className="chart-tag">{PUB_CHART_TO} partial</span>
              </div>
              <PubYearChart data={pubsByYear} />
              <div className="chart-axis">
                <span>&apos;{String(PUB_CHART_FROM).slice(2)}</span>
                <span>&apos;{String(PUB_CHART_TO).slice(2)}</span>
              </div>
            </div>
          </div>
          {/* Consortium's own contributions — distinct from members' individual output above */}
          <div style={{ marginTop: "2.75rem" }}>
            <span className="section-eyebrow">From the consortium</span>
            <p className="section-sub" style={{ marginTop: "0.35rem", marginBottom: "1.25rem" }}>
              Scholarship that describes PedQuEST and its qEEG methods, led by
              consortium members.
            </p>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.75rem" }}>
              {CONSORTIUM_WORK.map((w) => (
                <li
                  key={w.title}
                  style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: "1rem 1.15rem" }}
                >
                  <span style={{ display: "inline-block", fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--accent-primary)", marginBottom: "0.35rem" }}>
                    {w.tag}
                  </span>
                  {w.href ? (
                    <a href={w.href} target="_blank" rel="noopener noreferrer" style={{ display: "block", fontWeight: 600, color: "var(--text)", textDecoration: "none" }}>
                      {w.title}
                    </a>
                  ) : (
                    <span style={{ display: "block", fontWeight: 600, color: "var(--text)" }}>{w.title}</span>
                  )}
                  <span style={{ display: "block", marginTop: "0.3rem", fontSize: "0.85rem", color: "var(--text-secondary)" }}>
                    {w.cite}
                  </span>
                </li>
              ))}
            </ul>
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
              <span className="network-key">{intlContinents.join(" · ")}</span>
              <span className="network-num">{intlMemberCount} members</span>
              <p className="network-desc">
                Global partners bringing shared protocols to children&apos;s
                centers across {continentWord} continents.
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
            <Link href="/join/site" className="involve-card involve-card-accent">
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
        /* Shared section/card classes live in globals.css; below is hero-only. */

        /* ── Entrance animation ── */
        @keyframes fade-up {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* ── Hero — committed dark monitor ── */
        .hero-section {
          position: relative;
          min-height: 82vh;
          display: flex;
          align-items: center;
          overflow: hidden;
          isolation: isolate;
          padding: 5rem 2rem 4rem;
          background: #060d18;
          color: var(--text);
        }
        .hero-eeg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          z-index: 0;
          display: block;
        }
        /* scrim so the copy stays legible over the montage */
        .hero-section::after {
          content: "";
          position: absolute;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          background: radial-gradient(120% 90% at 18% 40%,
            rgba(6, 13, 24, 0.94) 0%,
            rgba(6, 13, 24, 0.72) 34%,
            rgba(6, 13, 24, 0.30) 62%,
            transparent 100%);
        }
        .montage-tag {
          position: absolute;
          right: 22px;
          bottom: 16px;
          z-index: 2;
          font-family: var(--mono-font);
          font-size: 11px;
          color: #5f7d88;
          letter-spacing: 0.06em;
        }
        @media (max-width: 640px) {
          .montage-tag { display: none; }
        }

        .hero-content {
          position: relative;
          z-index: 2;
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
        /* ── Responsive ── */
        @media (max-width: 600px) {
          .hero-section {
            min-height: 65vh;
            padding: 3rem 1.25rem 2rem;
          }
        }
      `}</style>
    </RevealMain>
  );
}
