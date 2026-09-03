import Link from "next/link";
import type { Metadata } from "next";
import QuestionBankBrowser from "./QuestionBankBrowser";
import ResearchDisclaimer from "@/components/ResearchDisclaimer";
import { getBankFacets } from "@/lib/qbank-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "qEEG Question Bank — PedQuEST",
  description:
    "A peer-reviewed bank of pediatric and neonatal quantitative-EEG questions: rendered trend figures, one-best-answer items, per-option rationales and cited evidence.",
};

export default async function QuestionBankPage() {
  // Facet counts are public — they say what the bank holds without exposing an
  // item. The items themselves are served to signed-in members by
  // /api/qbank/items.
  const facets = await getBankFacets();

  return (
    <main>
      <section className="qb-hero">
        <div className="home-container">
          <span className="section-eyebrow">Education &amp; training</span>
          <h1 className="qb-hero-h1">The qEEG question bank.</h1>
          <p className="qb-hero-sub">
            One-best-answer items built to NBME standards on synthetic qEEG trend figures —
            every number traced to a verified citation, every item signed off by a second
            editor before it goes live.
          </p>
          <div className="qb-hero-stats">
            <span><strong>{facets.total}</strong> published items</span>
            <span><strong>{Object.keys(facets.byDomain).length}</strong> domains covered</span>
            <span><strong>{facets.byPopulation.neonate ?? 0}</strong> neonatal</span>
          </div>
          <div className="qb-hero-links">
            <Link href="/education/case-of-the-day">Today&apos;s case →</Link>
            <Link href="/education">All education resources →</Link>
          </div>
        </div>
      </section>

      <section className="home-section" style={{ paddingTop: "2.5rem" }}>
        <div className="home-container">
          <QuestionBankBrowser initialFacets={facets} />
        </div>
      </section>

      <div className="home-container">
        <ResearchDisclaimer />
      </div>

      <style>{`
        /* ── Question bank (page-specific; shared classes in globals.css) ── */
        .qb-hero { padding: clamp(3rem, 6vw, 4.5rem) 2rem 0; background: var(--bg); }
        .qb-hero-h1 {
          font-family: var(--heading-font); font-size: clamp(2rem, 5vw, 3.1rem);
          line-height: 1.08; color: var(--ink); margin: 0.75rem 0 0; text-wrap: balance;
        }
        .qb-hero-sub { color: var(--ink-2); max-width: 58ch; margin-top: 1rem; line-height: 1.65; }
        .qb-hero-stats {
          display: flex; gap: 1.5rem; flex-wrap: wrap; margin-top: 1.5rem;
          font-family: var(--mono-font); font-size: 0.82rem; letter-spacing: .04em;
          text-transform: uppercase; color: var(--muted);
        }
        .qb-hero-stats strong { color: var(--accent); font-size: 1.15rem; }
        .qb-hero-links {
          display: flex; gap: 1.25rem; flex-wrap: wrap; margin-top: 1.25rem;
          font-family: var(--mono-font); font-size: 0.85rem;
        }

        .qb-eyebrow {
          font-family: var(--mono-font); font-size: 0.7rem; letter-spacing: .14em;
          text-transform: uppercase; color: var(--accent); font-weight: 600; margin-bottom: 0.6rem;
        }

        /* facet tiles shown to anonymous visitors */
        .qb-facets { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
        .qb-facet {
          background: var(--surface); border: 1px solid var(--line); border-radius: 14px;
          padding: 1.1rem 1.2rem; display: flex; flex-direction: column; gap: 0.35rem;
        }
        .qb-facet-n { font-family: var(--mono-font); font-size: 1.6rem; color: var(--accent); font-weight: 600; }
        .qb-facet-k { font-size: 0.88rem; color: var(--ink-2); }

        .qb-signin {
          margin-top: 1.5rem; background: var(--surface); border: 1px solid var(--line);
          border-radius: 16px; padding: 2rem; text-align: center;
        }
        .qb-signin-h { font-family: var(--heading-font); font-size: 1.4rem; color: var(--ink); margin: 0; }
        .qb-signin-p { color: var(--ink-2); max-width: 52ch; margin: 0.75rem auto 1.35rem; line-height: 1.6; }
        .qb-signin-cta { display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap; }

        /* progress */
        .qb-prog-top { color: var(--ink-2); font-size: 0.95rem; margin-bottom: 0.9rem; }
        .qb-prog-top strong { color: var(--ink); }
        .qb-prog-list { display: flex; flex-direction: column; gap: 0.5rem; }
        .qb-prog-row { display: grid; grid-template-columns: minmax(120px, 200px) 1fr auto; gap: 0.9rem; align-items: center; }
        .qb-prog-name { font-size: 0.88rem; color: var(--ink-2); }
        .qb-prog-bar { height: 7px; border-radius: 7px; background: var(--surface-2); overflow: hidden; display: block; }
        .qb-prog-bar > span { display: block; height: 100%; background: var(--accent); border-radius: 7px; }
        .qb-prog-num { font-family: var(--mono-font); font-size: 0.75rem; color: var(--muted); white-space: nowrap; }

        /* controls */
        .qb-controls {
          display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: center; margin-bottom: 1.5rem;
        }
        .qb-controls select {
          padding: 0.5rem 0.7rem; border-radius: 9px; border: 1px solid var(--line);
          background: var(--bg); color: var(--ink); font: inherit; font-size: 0.87rem;
        }
        .qb-check {
          display: flex; align-items: center; gap: 0.4rem; font-family: var(--mono-font);
          font-size: 0.78rem; color: var(--ink-2); text-transform: uppercase; letter-spacing: .05em;
        }
        .qb-practice { margin-left: auto; }

        /* cards */
        .qb-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.15rem; }
        .qb-card {
          background: var(--surface); border: 1px solid var(--line); border-radius: 16px;
          overflow: hidden; display: flex; flex-direction: column; color: inherit;
          transition: border-color .15s ease, transform .15s ease;
        }
        .qb-card:hover { border-color: var(--accent); transform: translateY(-3px); }
        .qb-card-img { width: 100%; height: 132px; object-fit: cover; display: block; background: var(--bg); }
        .qb-card-noimg {
          display: grid; place-items: center; font-family: var(--mono-font);
          font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: .1em;
        }
        .qb-card-body { padding: 1rem 1.1rem 1.2rem; display: flex; flex-direction: column; gap: 0.5rem; }
        .qb-card-meta {
          display: flex; gap: 0.5rem; flex-wrap: wrap; font-family: var(--mono-font);
          font-size: 0.66rem; text-transform: uppercase; letter-spacing: .07em; color: var(--muted);
        }
        .qb-done { color: var(--good); }
        .qb-card-title { font-family: var(--heading-font); font-size: 1.02rem; color: var(--ink); margin: 0; line-height: 1.3; }
        .qb-card-lead { font-size: 0.86rem; color: var(--ink-2); margin: 0; line-height: 1.5; }

        @media (max-width: 900px) {
          .qb-grid, .qb-facets { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 560px) {
          .qb-grid, .qb-facets { grid-template-columns: 1fr; }
          .qb-practice { margin-left: 0; width: 100%; text-align: center; }
          .qb-prog-row { grid-template-columns: 1fr auto; }
          .qb-prog-bar { grid-column: 1 / -1; }
        }
      `}</style>
    </main>
  );
}
