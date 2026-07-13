"use client";

import { useState } from "react";
import Link from "next/link";
import { educationResources, type EducationResource } from "@/data/education";
import { useScrollReveal } from "@/lib/useScrollReveal";

const audienceFilters = ["All", "Trainees", "Technicians", "Intensivists", "Neurology"];

function statusColor(status: EducationResource["status"]): string {
  switch (status) {
    case "active":
      return "var(--good)";
    case "in_progress":
      return "var(--warm)";
    case "planned":
    case "archived":
    default:
      return "var(--muted)";
  }
}

function statusLabel(status: EducationResource["status"]): string {
  switch (status) {
    case "active":
      return "Active";
    case "in_progress":
      return "In Progress";
    case "planned":
      return "Planned";
    case "archived":
      return "Archived";
  }
}

const STEPS = [
  {
    n: "01",
    title: "Fundamentals",
    desc: "qEEG signal basics, montages, and trend interpretation — the shared vocabulary every unit starts from.",
  },
  {
    n: "02",
    title: "Case-based practice",
    desc: "Daily cases and curated libraries that build pattern recognition against expert reads.",
  },
  {
    n: "03",
    title: "Bedside application",
    desc: "Decision-support teaching that connects qEEG trends to real actions in the ICU.",
  },
  {
    n: "04",
    title: "Contribute data",
    desc: "Graduate from consumer to contributor — add your center's recordings to the shared platform.",
  },
];

export default function EducationPage() {
  const mainRef = useScrollReveal();
  const [activeFilter, setActiveFilter] = useState("All");

  const filtered =
    activeFilter === "All"
      ? educationResources
      : educationResources.filter((r) =>
          r.audience.includes(activeFilter.toLowerCase())
        );

  const pennsieve = educationResources.find((r) => r.id === "edu-4");

  return (
    <main ref={mainRef}>
      {/* ── Hero ── */}
      <section className="edu-hero">
        <div className="home-container">
          <span className="section-eyebrow">Education &amp; training</span>
          <h1 className="edu-hero-h1">
            Learn to read the pediatric brain — the same way, everywhere.
          </h1>
          <p className="edu-hero-sub">
            PedQuEST&apos;s education initiative is building a standardized qEEG
            curriculum so training is consistent and high-quality across every
            consortium center — from bedside decision-support tools to
            comprehensive case-based modules.
          </p>
        </div>
      </section>

      {/* ── The pathway ── */}
      <section className="home-section reveal">
        <div className="home-container">
          <div className="section-head">
            <span className="section-eyebrow">The pathway</span>
            <h2 className="section-h2">Four steps from novice to contributor.</h2>
          </div>
          <div className="edu-steps">
            {STEPS.map((s) => (
              <div className="edu-step" key={s.n}>
                <span className="edu-step-n">Step {s.n}</span>
                <h3 className="edu-step-title">{s.title}</h3>
                <p className="edu-step-desc">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Case of the Day ── */}
      <section className="home-section reveal" style={{ paddingTop: 0 }}>
        <div className="home-container">
          <Link href="/education/case-of-the-day" className="edu-cotd">
            <div className="edu-cotd-body">
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
        </div>
      </section>

      {/* ── Resource library ── */}
      <section className="home-section reveal" style={{ paddingTop: 0 }}>
        <div className="home-container">
          <div className="section-head">
            <span className="section-eyebrow">Resource library</span>
            <h2 className="section-h2">What&apos;s available.</h2>
            <p className="section-sub">
              Projects and platforms from the education working group — filter
              by who you are.
            </p>
          </div>

          <div className="edu-filters">
            {audienceFilters.map((filter) => (
              <button
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={`edu-filter ${activeFilter === filter ? "on" : ""}`}
              >
                {filter}
              </button>
            ))}
          </div>

          <div className="edu-grid">
            {[...filtered]
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((resource) => (
                <article key={resource.id} className="edu-card">
                  <div className="edu-card-top">
                    <h3 className="edu-card-title">{resource.title}</h3>
                    <span
                      className="edu-status"
                      style={{ color: statusColor(resource.status) }}
                    >
                      {statusLabel(resource.status)}
                    </span>
                  </div>
                  <p className="edu-card-desc">{resource.description}</p>
                  <span className="edu-card-lead">Led by {resource.leadership}</span>
                  <div className="edu-card-tags">
                    {resource.audience.map((a) => (
                      <span key={a} className="edu-tag edu-tag-aud">{a}</span>
                    ))}
                    {resource.topics.map((t) => (
                      <span key={t} className="edu-tag">{t}</span>
                    ))}
                  </div>
                  {resource.url && (
                    <a
                      href={resource.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="edu-card-link"
                    >
                      Visit platform
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 3h8v8M13 3L3 13" />
                      </svg>
                    </a>
                  )}
                </article>
              ))}
          </div>

          {filtered.length === 0 && (
            <p className="edu-empty">
              No resources match the selected audience filter.
            </p>
          )}
        </div>
      </section>

      {/* ── Pennsieve ── */}
      {pennsieve && (
        <section className="home-section reveal" style={{ paddingTop: 0 }}>
          <div className="home-container">
            <div className="edu-pennsieve">
              <span className="section-eyebrow">Research infrastructure</span>
              <h2 className="edu-pennsieve-title">Pennsieve Data Platform</h2>
              <p className="edu-pennsieve-desc">
                Our consortium uses the Pennsieve platform for secure,
                cloud-based EEG waveform data sharing aligned with clinical
                data. Built in collaboration with the Wagenaar Lab at the
                University of Pennsylvania, Pennsieve provides the research
                infrastructure underpinning our multi-center studies.
              </p>
              <a
                href="https://pennsieve.io"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary"
                style={{ alignSelf: "flex-start" }}
              >
                Explore Pennsieve
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 8h10M9 4l4 4-4 4" />
                </svg>
              </a>
            </div>
          </div>
        </section>
      )}

      <style>{`
        /* ── Education page (page-specific; shared classes in globals.css) ── */
        .edu-hero {
          padding: clamp(5rem, 10vw, 8rem) 2rem clamp(2.5rem, 5vw, 4rem);
          background: var(--bg);
        }
        .edu-hero-h1 {
          font-family: var(--heading-font);
          font-size: clamp(2.2rem, 4.6vw, 3.5rem);
          font-weight: 700; line-height: 1.08; letter-spacing: -0.02em;
          color: var(--ink); margin: 0.9rem 0 0; max-width: 22ch; text-wrap: balance;
        }
        .edu-hero-sub {
          margin-top: 1.25rem; font-size: 1.1rem; line-height: 1.65;
          color: var(--ink-2); max-width: 58ch;
        }

        /* Steps */
        .edu-steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.25rem; }
        .edu-step {
          padding: 1.6rem; background: var(--surface);
          border: 1px solid var(--line); border-radius: 16px;
        }
        .edu-step-n {
          font-family: var(--mono-font); font-size: 0.72rem; font-weight: 600;
          letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent);
        }
        .edu-step-title {
          font-family: var(--heading-font); font-size: 1.15rem; font-weight: 600;
          color: var(--ink); margin: 0.6rem 0 0.5rem;
        }
        .edu-step-desc { font-size: 0.9rem; line-height: 1.6; color: var(--ink-2); }

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
          color: #05201d; margin: 0.35rem 0 0.35rem;
        }
        .edu-cotd-desc { font-size: 0.95rem; line-height: 1.55; color: #0a3a34; max-width: 52ch; }
        .edu-cotd-cta {
          display: inline-flex; align-items: center; gap: 0.5rem; white-space: nowrap;
          padding: 0.7rem 1.4rem; border-radius: 10px; background: #05201d;
          color: var(--accent-strong); font-weight: 600; font-size: 0.9rem;
        }

        /* Filters */
        .edu-filters { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.75rem; }
        .edu-filter {
          font-family: var(--mono-font); font-size: 0.76rem; letter-spacing: 0.04em;
          padding: 0.5rem 1.1rem; border-radius: 999px; cursor: pointer;
          background: var(--surface); color: var(--ink-2); border: 1px solid var(--line);
          transition: all 0.15s;
        }
        .edu-filter:hover { color: var(--ink); border-color: var(--accent); }
        .edu-filter.on { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); font-weight: 600; }

        /* Resource cards */
        .edu-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.25rem; }
        .edu-card {
          display: flex; flex-direction: column; padding: 1.6rem;
          background: var(--surface); border: 1px solid var(--line); border-radius: 16px;
        }
        .edu-card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; }
        .edu-card-title {
          font-family: var(--heading-font); font-size: 1.15rem; font-weight: 600;
          color: var(--ink); line-height: 1.3; flex: 1;
        }
        .edu-status {
          font-family: var(--mono-font); font-size: 0.66rem; font-weight: 600;
          letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap;
          margin-top: 0.25rem;
        }
        .edu-card-desc { font-size: 0.9rem; line-height: 1.65; color: var(--ink-2); margin: 0.7rem 0; flex: 1; }
        .edu-card-lead { font-size: 0.78rem; color: var(--muted); margin-bottom: 0.8rem; }
        .edu-card-tags { display: flex; flex-wrap: wrap; gap: 0.35rem; }
        .edu-tag {
          font-family: var(--mono-font); font-size: 0.66rem; letter-spacing: 0.04em;
          text-transform: uppercase; color: var(--ink-2); background: var(--surface-2);
          border: 1px solid var(--line); border-radius: 999px; padding: 0.2rem 0.6rem;
        }
        .edu-tag-aud { color: var(--accent); border-color: var(--accent-soft); }
        .edu-card-link {
          display: inline-flex; align-items: center; gap: 0.4rem; margin-top: 1rem;
          font-size: 0.85rem; font-weight: 600; color: var(--accent);
        }
        .edu-empty {
          text-align: center; color: var(--muted); padding: 3rem 0;
          font-family: var(--mono-font); font-size: 0.88rem;
        }

        /* Pennsieve */
        .edu-pennsieve {
          display: flex; flex-direction: column; gap: 0.6rem; padding: 2.25rem;
          background: var(--surface); border: 1px solid var(--line); border-radius: 16px;
        }
        .edu-pennsieve-title {
          font-family: var(--heading-font); font-size: 1.5rem; font-weight: 700; color: var(--ink);
        }
        .edu-pennsieve-desc { font-size: 0.98rem; line-height: 1.7; color: var(--ink-2); max-width: 68ch; margin-bottom: 0.6rem; }

        @media (max-width: 1000px) {
          .edu-steps { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 560px) {
          .edu-steps { grid-template-columns: 1fr; }
        }
      `}</style>
    </main>
  );
}
