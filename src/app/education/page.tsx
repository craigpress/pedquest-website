"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { educationResources, type EducationResource } from "@/data/education";
import { useScrollReveal } from "@/lib/useScrollReveal";

function statusLabel(status: EducationResource["status"]): string {
  switch (status) {
    case "active":
      return "Available";
    case "in_progress":
      return "In development";
    case "planned":
      return "Planned";
    case "archived":
      return "Archived";
  }
}

const KIND_LABELS: Record<EducationResource["type"], string> = {
  curriculum: "Curriculum",
  module: "Modules",
  project: "Bedside",
  tool: "Tool",
  link: "Link",
};

const TYPE_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "curriculum", label: "Curriculum" },
  { value: "module", label: "Modules" },
  { value: "project", label: "Bedside" },
  { value: "tool", label: "Tools" },
];

const STEPS = [
  { n: "01", title: "Fundamentals", desc: "Core curriculum: signal, montage, and qEEG basics." },
  { n: "02", title: "Case-based practice", desc: "Real pediatric scenarios with expert interpretation." },
  { n: "03", title: "Bedside application", desc: "Decision-support for the PICU team in real time." },
  { n: "04", title: "Contribute data", desc: "Share waveforms securely via the data platform." },
];

// Teal gradient banner with three white EEG traces (from the education mockup).
function ResourceBanner({ seed }: { seed: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cvs = ref.current;
    if (!cvs) return;
    const draw = () => {
      const host = cvs.parentElement;
      if (!host) return;
      const d = Math.min(window.devicePixelRatio || 1, 2);
      const w = host.getBoundingClientRect().width || 520;
      const h = 96;
      cvs.width = w * d;
      cvs.height = h * d;
      const x = cvs.getContext("2d");
      if (!x) return;
      x.setTransform(d, 0, 0, d, 0, 0);
      const g = x.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, "#116b6f");
      g.addColorStop(1, "#2ed6c6");
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
      x.strokeStyle = "rgba(255,255,255,.5)";
      x.lineWidth = 1.3;
      for (let ch = 0; ch < 3; ch++) {
        x.globalAlpha = 0.35 + ch * 0.2;
        x.beginPath();
        const by = 28 + ch * 20;
        for (let i = 0; i <= w; i += 3) {
          const t = i / w;
          const y =
            by +
            Math.sin(t * 10 + seed + ch) * 6 +
            Math.sin(t * 26 + seed * 2) * 3 +
            (Math.abs(t - (((seed + ch) % 6) / 7)) < 0.04 ? 9 : 0);
          if (i === 0) x.moveTo(i, y);
          else x.lineTo(i, y);
        }
        x.stroke();
      }
      x.globalAlpha = 1;
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [seed]);
  return <canvas ref={ref} aria-hidden="true" />;
}

export default function EducationPage() {
  const mainRef = useScrollReveal();
  const [activeType, setActiveType] = useState("all");

  const filtered =
    activeType === "all"
      ? educationResources
      : educationResources.filter((r) => r.type === activeType);

  return (
    <main ref={mainRef}>
      {/* ── Hero + learning path ── */}
      <section className="edu-hero">
        <div className="home-container">
          <span className="section-eyebrow">Education &amp; training</span>
          <h1 className="edu-hero-h1">
            Learn to read the pediatric brain — the same way, everywhere.
          </h1>
          <p className="edu-hero-sub">
            A standardized path from qEEG fundamentals to bedside
            decision-making, built by the consortium so a trainee in one center
            learns the same standard as every other.
          </p>
          <div className="edu-path" role="list" aria-label="Learning path">
            {STEPS.map((s) => (
              <div className="edu-step" role="listitem" key={s.n}>
                <span className="edu-step-n">Step {s.n}</span>
                <h4 className="edu-step-title">{s.title}</h4>
                <p className="edu-step-desc">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Case of the Day ── */}
      <section className="home-section reveal" style={{ paddingBottom: 0 }}>
        <div className="home-container">
          <Link href="/education/case-of-the-day" className="edu-cotd">
            <div>
              <span className="edu-cotd-key">New · Daily</span>
              <h2 className="edu-cotd-title">qEEG Case of the Day</h2>
              <p className="edu-cotd-desc">
                Test your read on a new EEG/qEEG image each day — with community
                stats and expert explanations.
              </p>
            </div>
            <span className="edu-cotd-cta">
              Today&apos;s case
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </span>
          </Link>

          <Link href="/education/question-bank" className="edu-qbank">
            <div>
              <span className="edu-qbank-key">Self-assessment</span>
              <h2 className="edu-qbank-title">qEEG question bank</h2>
              <p className="edu-qbank-desc">
                Peer-reviewed one-best-answer items on synthetic qEEG trend figures, with
                per-option rationales, cited evidence, and progress tracked by domain.
              </p>
            </div>
            <span className="edu-qbank-cta">
              Browse questions
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </span>
          </Link>
        </div>
      </section>

      {/* ── Resource library ── */}
      <section className="home-section reveal">
        <div className="home-container">
          <div className="section-head">
            <span className="section-eyebrow">Resource library</span>
            <h2 className="section-h2">What&apos;s available.</h2>
            <p className="section-sub">
              Curricula, interactive modules, and shared tools — open to
              members, with fundamentals free to all.
            </p>
          </div>

          <div className="edu-filters" role="group" aria-label="Filter resources">
            {TYPE_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setActiveType(f.value)}
                className={`edu-ft ${activeType === f.value ? "on" : ""}`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="edu-grid">
            {[...filtered]
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((r, i) => (
                <article className="edu-rc" key={r.id}>
                  <div className="edu-rc-banner">
                    <ResourceBanner seed={(r.title.length % 9) + i} />
                  </div>
                  <div className="edu-rc-body">
                    <span className={`edu-kind ${r.type === "tool" ? "tool" : ""}`}>
                      {KIND_LABELS[r.type]}
                    </span>
                    <h3 className="edu-rc-title">{r.title}</h3>
                    <p className="edu-rc-desc">{r.description}</p>
                    <div className="edu-rc-meta">
                      {r.audience.map((a) => (
                        <span key={a}>{a}</span>
                      ))}
                      {r.topics.slice(0, 3).map((t) => (
                        <span key={t}>{t}</span>
                      ))}
                    </div>
                    <div className="edu-rc-foot">
                      <span className={`edu-status ${r.status !== "active" ? "soon" : ""}`}>
                        <span className="d" />
                        {statusLabel(r.status)}
                      </span>
                      {r.url ? (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="edu-rc-link"
                        >
                          Visit platform
                          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 3h8v8M13 3L3 13" />
                          </svg>
                        </a>
                      ) : (
                        <span className="edu-rc-lead">Led by {r.leadership}</span>
                      )}
                    </div>
                  </div>
                </article>
              ))}
          </div>

          {filtered.length === 0 && (
            <p className="edu-empty">No resources of this type yet.</p>
          )}
        </div>
      </section>

      {/* ── Who it's for ── */}
      <section className="home-section reveal" style={{ paddingTop: 0 }}>
        <div className="home-container">
          <div className="section-head">
            <span className="section-eyebrow">Access</span>
            <h2 className="section-h2">Who it&apos;s for.</h2>
          </div>
          <div className="edu-access">
            <div className="edu-acard">
              <h3>Trainees &amp; fellows</h3>
              <p>
                Work the full path at your own pace, build pattern recognition
                with daily cases, and bring standardized qEEG skills back to
                your unit.
              </p>
              <Link href="/education/case-of-the-day" className="btn-primary">
                Start with today&apos;s case
              </Link>
            </div>
            <div className="edu-acard">
              <h3>Member centers</h3>
              <p>
                Adopt the curriculum locally, access the case library and
                bedside decision-support modules, and connect to the Pennsieve
                data platform.
              </p>
              <Link href="/join" className="btn-secondary">
                Request center access
              </Link>
            </div>
          </div>
        </div>
      </section>

      <style>{`
        /* ── Education page (page-specific; shared classes in globals.css) ── */
        .edu-hero {
          padding: clamp(5rem, 10vw, 7.5rem) 2rem clamp(2rem, 4vw, 3rem);
          background: var(--bg);
        }
        .edu-hero-h1 {
          font-family: var(--heading-font);
          font-size: clamp(2rem, 4.6vw, 3.2rem);
          font-weight: 700; line-height: 1.08; letter-spacing: -0.02em;
          color: var(--ink); margin: 0.9rem 0 0; max-width: 20ch; text-wrap: balance;
        }
        .edu-hero-sub {
          margin-top: 1.1rem; font-size: clamp(1.05rem, 2vw, 1.2rem); line-height: 1.65;
          color: var(--ink-2); max-width: 58ch;
        }

        /* Learning path strip (inside hero) */
        .edu-path {
          display: flex; flex-wrap: wrap; gap: 0; margin-top: 2.1rem;
          border: 1px solid var(--line); border-radius: 14px; overflow: hidden;
          background: var(--surface);
        }
        .edu-step {
          flex: 1; min-width: 180px; padding: 1.1rem 1.25rem;
          border-right: 1px solid var(--line);
        }
        .edu-step:last-child { border-right: none; }
        .edu-step-n {
          font-family: var(--mono-font); font-size: 0.7rem; font-weight: 600;
          letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent);
        }
        .edu-step-title {
          font-family: var(--heading-font); font-size: 1rem; font-weight: 600;
          color: var(--ink); margin: 0.4rem 0 0.25rem;
        }
        .edu-step-desc { font-size: 0.82rem; line-height: 1.5; color: var(--muted); }

        /* Case of the Day — the one accent card */
        .edu-cotd {
          display: flex; justify-content: space-between; align-items: center;
          gap: 1.5rem; flex-wrap: wrap; padding: 1.9rem 2rem; border-radius: 16px;
          background: linear-gradient(150deg, var(--accent), #1aa596);
          text-decoration: none;
        }
        .edu-cotd-key {
          font-family: var(--mono-font); font-size: 0.72rem; font-weight: 600;
          letter-spacing: 0.14em; text-transform: uppercase; color: #05201d;
        }
        .edu-cotd-title {
          font-family: var(--heading-font); font-size: 1.5rem; font-weight: 700;
          color: #05201d; margin: 0.35rem 0;
        }
        .edu-cotd-desc { font-size: 0.95rem; line-height: 1.55; color: #0a3a34; max-width: 52ch; }
        .edu-cotd-cta {
          display: inline-flex; align-items: center; gap: 0.5rem; white-space: nowrap;
          padding: 0.7rem 1.4rem; border-radius: 10px; background: #05201d;
          color: var(--accent-strong); font-weight: 600; font-size: 0.9rem;
        }

        /* Question bank — plain surface card (the accent card above is the only one) */
        .edu-qbank {
          display: flex; justify-content: space-between; align-items: center;
          gap: 1.5rem; flex-wrap: wrap; padding: 1.75rem 2rem; border-radius: 16px;
          margin-top: 1.15rem; background: var(--surface); border: 1px solid var(--line);
          text-decoration: none; transition: border-color 0.15s ease;
        }
        .edu-qbank:hover { border-color: var(--accent); }
        .edu-qbank-key {
          font-family: var(--mono-font); font-size: 0.72rem; font-weight: 600;
          letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent);
        }
        .edu-qbank-title {
          font-family: var(--heading-font); font-size: 1.4rem; font-weight: 700;
          color: var(--ink); margin: 0.35rem 0;
        }
        .edu-qbank-desc { font-size: 0.93rem; line-height: 1.55; color: var(--ink-2); max-width: 52ch; }
        .edu-qbank-cta {
          display: inline-flex; align-items: center; gap: 0.5rem; white-space: nowrap;
          font-family: var(--mono-font); font-size: 0.85rem; font-weight: 600; color: var(--accent);
        }

        /* Type filters */
        .edu-filters { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.5rem; }
        .edu-ft {
          font-family: var(--body-font); font-size: 0.82rem; font-weight: 600;
          padding: 0.5rem 0.95rem; border-radius: 20px; cursor: pointer;
          border: 1px solid var(--line); background: var(--surface); color: var(--ink-2);
          transition: all 0.15s;
        }
        .edu-ft:hover { color: var(--ink); border-color: var(--accent); }
        .edu-ft.on { background: var(--accent); color: #05201d; border-color: transparent; }

        /* Resource cards */
        .edu-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1.15rem; }
        .edu-rc {
          background: var(--surface); border: 1px solid var(--line); border-radius: 16px;
          overflow: hidden; display: flex; flex-direction: column; transition: border-color 0.16s;
        }
        .edu-rc:hover { border-color: var(--accent); }
        .edu-rc-banner { height: 96px; position: relative; overflow: hidden; background: var(--surface-2); }
        .edu-rc-banner canvas { position: absolute; inset: 0; }
        .edu-rc-body { padding: 1.25rem 1.4rem 1.4rem; display: flex; flex-direction: column; flex: 1; }
        .edu-kind {
          font-family: var(--mono-font); font-size: 0.66rem; letter-spacing: 0.06em;
          text-transform: uppercase; padding: 3px 9px; border-radius: 6px;
          background: var(--accent-soft); color: var(--accent);
          width: max-content; margin-bottom: 0.75rem;
        }
        .edu-kind.tool { background: rgba(240, 169, 74, 0.14); color: var(--warm); }
        .edu-rc-title {
          font-family: var(--heading-font); font-size: 1.18rem; font-weight: 600;
          color: var(--ink); margin-bottom: 0.5rem; line-height: 1.3;
        }
        .edu-rc-desc { font-size: 0.92rem; line-height: 1.6; color: var(--ink-2); flex: 1; }
        .edu-rc-meta {
          display: flex; gap: 0.85rem; margin: 0.9rem 0 1rem; flex-wrap: wrap;
          font-family: var(--mono-font); font-size: 0.7rem; color: var(--muted);
          text-transform: capitalize;
        }
        .edu-rc-foot { display: flex; justify-content: space-between; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
        .edu-status {
          font-family: var(--mono-font); font-size: 0.7rem;
          display: inline-flex; align-items: center; gap: 6px; color: var(--good);
        }
        .edu-status .d { width: 7px; height: 7px; border-radius: 50%; background: var(--good); }
        .edu-status.soon { color: var(--warm); }
        .edu-status.soon .d { background: var(--warm); }
        .edu-rc-lead { font-family: var(--mono-font); font-size: 0.7rem; color: var(--muted); }
        .edu-rc-link {
          display: inline-flex; align-items: center; gap: 0.35rem;
          font-size: 0.82rem; font-weight: 600; color: var(--accent);
        }
        .edu-empty {
          text-align: center; color: var(--muted); padding: 3rem 0;
          font-family: var(--mono-font); font-size: 0.88rem;
        }

        /* Access */
        .edu-access { display: grid; grid-template-columns: 1fr 1fr; gap: 1.15rem; }
        .edu-acard {
          border: 1px solid var(--line); border-radius: 14px; padding: 1.5rem;
          background: var(--surface);
        }
        .edu-acard h3 {
          font-family: var(--heading-font); font-size: 1.1rem; font-weight: 600;
          color: var(--ink); margin-bottom: 0.5rem;
        }
        .edu-acard p { color: var(--ink-2); font-size: 0.95rem; line-height: 1.6; margin-bottom: 1rem; }

        @media (max-width: 860px) {
          .edu-grid, .edu-access { grid-template-columns: 1fr; }
        }
      `}</style>
    </main>
  );
}
