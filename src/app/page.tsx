"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { publications } from "@/data/publications";
import { members, institutions, CONTINENT_BY_COUNTRY } from "@/data/members";
import { useScrollReveal } from "@/lib/useScrollReveal";
import { AnimatedCounter } from "@/components/AnimatedCounter";
import { PubYearChart } from "@/components/PubYearChart";

const memberCount = members.length;
const institutionCount = institutions.length;
const countryCount = new Set(members.map((m) => m.country)).size;

const recentPubs = [...publications]
  .sort((a, b) => b.year - a.year || (b.month ?? 0) - (a.month ?? 0))
  .slice(0, 5);

// ── Living-EEG hero: canvas 10-channel montage (ported from the approved
// homepage-v2 mockup). Each channel sums three sinusoids with deterministic
// per-channel parameters, plus intermittent spindle bursts; a warm "discharge"
// event periodically sweeps across the montage. Middle channels are emphasized.
// Honors prefers-reduced-motion (renders one static frame mid-event).
const EEG_CHANNELS = 10;
const EEG_GRID = "rgba(120,200,210,0.06)";
const EEG_TRACE = "rgba(78,225,210,"; // + alpha
const EEG_GLOW = "rgba(46,214,198,0.35)";
const EEG_WARM = "rgba(245,180,85,";

function HeroEEG() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const gens = Array.from({ length: EEG_CHANNELS }, (_, i) => ({
      a1: 8 + ((i * 37) % 9), f1: 0.8 + ((i * 13) % 5) * 0.25,
      a2: 2.5 + ((i * 7) % 4), f2: 5 + ((i * 11) % 9),
      a3: 1.2 + ((i * 5) % 3), f3: 14 + ((i * 17) % 12),
      ph: (i * 1.7) % 6.28, drift: 0.2 + ((i * 3) % 5) * 0.06,
    }));
    const ev = { active: false, pos: 0, next: 3.5 };
    let ctx: CanvasRenderingContext2D | null = null;
    let W = 0;
    let H = 0;
    let t = 0;
    let raf = 0;
    let last = 0;

    function fit() {
      if (!cv) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = cv.getBoundingClientRect();
      W = r.width;
      H = r.height;
      cv.width = W * dpr;
      cv.height = H * dpr;
      ctx = cv.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function chanVal(i: number, xt: number, tt: number) {
      const g = gens[i];
      let v =
        Math.sin(xt * g.f1 * 6.28 + tt * g.drift + g.ph) * g.a1 +
        Math.sin(xt * g.f2 * 6.28 + tt * 1.1 + g.ph * 1.3) * g.a2 +
        Math.sin(xt * g.f3 * 6.28 + tt * 1.7) * g.a3;
      // sleep-spindle-like intermittent burst
      const sp = Math.max(0, Math.sin(tt * 0.5 + i * 1.3) - 0.7);
      v += Math.sin(xt * 70 * 6.28 + tt * 3) * sp * 22;
      return v;
    }

    function draw() {
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      // faint EEG-paper grid
      ctx.strokeStyle = EEG_GRID;
      ctx.lineWidth = 1;
      for (let gx = 0; gx < W; gx += Math.max(34, W / 28)) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, H);
        ctx.stroke();
      }
      const top = H * 0.1;
      const span = H * 0.82;
      const gap = span / (EEG_CHANNELS - 1);
      const evX = ev.active ? ev.pos * W : -1;
      for (let i = 0; i < EEG_CHANNELS; i++) {
        const baseY = top + i * gap;
        const depth = i / (EEG_CHANNELS - 1);
        const front = 1 - Math.abs(depth - 0.5) * 1.3; // middle channels emphasized
        const alpha = 0.18 + Math.max(0, front) * 0.62;
        ctx.lineWidth = 0.8 + Math.max(0, front) * 1.1;
        ctx.beginPath();
        for (let px = 0; px <= W; px += 2) {
          const xt = px / W;
          const amp = (gap * 0.42) / 12;
          const val = chanVal(i, xt, t) * amp;
          let eBoost = 0;
          if (ev.active) {
            const d = Math.abs(px - evX) / (W * 0.12);
            if (d < 3) {
              const env = Math.exp(-d * d);
              eBoost = Math.sin(xt * 40 * 6.28 + t * 8) * env * gap * 0.9;
            }
          }
          const y = baseY + val - eBoost;
          if (px === 0) ctx.moveTo(px, y);
          else ctx.lineTo(px, y);
        }
        ctx.strokeStyle = EEG_TRACE + alpha.toFixed(3) + ")";
        ctx.shadowBlur = front > 0.5 ? 8 : 0;
        ctx.shadowColor = EEG_GLOW;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
      // warm sweep highlight over the discharge
      if (ev.active) {
        ctx.save();
        const x0 = evX - W * 0.14;
        const x1 = evX + W * 0.14;
        const grd = ctx.createLinearGradient(x0, 0, x1, 0);
        grd.addColorStop(0, EEG_WARM + "0)");
        grd.addColorStop(0.5, EEG_WARM + "0.5)");
        grd.addColorStop(1, EEG_WARM + "0)");
        ctx.strokeStyle = grd;
        ctx.lineWidth = 2;
        ctx.shadowBlur = 12;
        ctx.shadowColor = EEG_WARM + "0.5)";
        for (let i = 0; i < EEG_CHANNELS; i++) {
          const baseY = top + i * gap;
          const depth = i / (EEG_CHANNELS - 1);
          const front = 1 - Math.abs(depth - 0.5) * 1.3;
          ctx.beginPath();
          for (let px = Math.max(0, x0); px <= Math.min(W, x1); px += 2) {
            const xt = px / W;
            const d = Math.abs(px - evX) / (W * 0.12);
            const env = Math.exp(-d * d);
            const amp = (gap * 0.42) / 12;
            const y = baseY + chanVal(i, xt, t) * amp - Math.sin(xt * 40 * 6.28 + t * 8) * env * gap * 0.9;
            if (px === Math.max(0, x0)) ctx.moveTo(px, y);
            else ctx.lineTo(px, y);
          }
          ctx.globalAlpha = 0.35 + Math.max(0, front) * 0.5;
          ctx.stroke();
        }
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }

    function tick(dt: number) {
      t += dt;
      if (ev.active) {
        ev.pos += dt * 0.42;
        if (ev.pos > 1.15) {
          ev.active = false;
          ev.next = t + 4 + Math.sin(t) * 2 + 3;
        }
      } else if (t > ev.next) {
        ev.active = true;
        ev.pos = -0.15;
      }
    }

    function staticFrame() {
      ev.active = true;
      ev.pos = 0.62;
      t = 6.2;
      draw();
      ev.active = false;
    }

    function loop(ts: number) {
      const dt = Math.min(0.05, (ts - last) / 1000 || 0);
      last = ts;
      tick(dt);
      draw();
      raf = requestAnimationFrame(loop);
    }

    fit();
    const onResize = () => {
      fit();
      if (reduce) staticFrame();
    };
    window.addEventListener("resize", onResize);
    if (reduce) staticFrame();
    else raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      className="hero-eeg"
      role="img"
      aria-label="A live 10–20 montage electroencephalogram: ten channels of flowing brain-wave activity with an occasional discharge sweeping across the array."
    />
  );
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
  const mainRef = useScrollReveal();

  return (
    <main ref={mainRef}>
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
            <h2 className="section-h2">Evidence, not adjectives.</h2>
            <p className="section-sub">
              Every figure is computed from the live member and publication
              registry, and updates as members join and papers are indexed.
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
    </main>
  );
}
