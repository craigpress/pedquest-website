import { Metadata } from "next";
import Link from "next/link";
import RevealMain from "@/components/RevealMain";

export const metadata: Metadata = {
  title: "Join PedQuEST — Individual & Member Site",
  description:
    "Two ways to join PedQuEST: as an individual clinician or researcher who wants meeting invitations and consortium news, or as a member site contributing qEEG data to multicenter studies.",
  alternates: { canonical: "/join" },
};

export default function JoinPage() {
  return (
    <RevealMain>
      <section className="jn-hero">
        <div className="home-container">
          <span className="section-eyebrow">Join the consortium</span>
          <h1 className="jn-h1">There are two ways in.</h1>
          <p className="jn-sub">
            Most people start as an individual — come to the meetings, follow the
            work, decide later. Bringing a whole centre in is a separate, longer
            conversation.
          </p>
        </div>
      </section>

      <section className="home-section reveal">
        <div className="home-container">
          <div className="jn-grid">
            <Link href="/join/individual" className="jn-card jn-card-accent">
              <span className="jn-key">For individuals</span>
              <h2 className="jn-title">Join as an individual</h2>
              <p className="jn-desc">
                For clinicians, trainees, technologists, and researchers who want
                to be part of PedQuEST without committing their institution.
              </p>
              <ul className="jn-list">
                <li>Invitations to consortium meetings and education sessions</li>
                <li>Email updates on new evidence and shared protocols</li>
                <li>Takes about a minute — name and email is enough</li>
              </ul>
              <span className="jn-cta">Sign up →</span>
            </Link>

            <Link href="/join/site" className="jn-card">
              <span className="jn-key">For institutions</span>
              <h2 className="jn-title">Join as a member site</h2>
              <p className="jn-desc">
                For a centre ready to contribute qEEG data, adopt the shared
                acquisition protocol, and co-author multicenter studies.
              </p>
              <ul className="jn-list">
                <li>Contribute to the harmonized multicenter cohort</li>
                <li>Co-authorship on consortium publications</li>
                <li>
                  Needs a site PI and institutional buy-in — reviewed by the
                  scientific committee
                </li>
              </ul>
              <span className="jn-cta jn-cta-quiet">Start the application →</span>
            </Link>
          </div>

          <p className="jn-foot">
            Already a PedQuEST member?{" "}
            <Link href="/login">Sign in</Link> to update your bio, interests, and
            CV. Not sure which fits? <Link href="/contact">Ask us</Link>.
          </p>
        </div>
      </section>

      <style>{`
        /* ── Join chooser (page-specific; shared classes in globals.css) ── */
        .jn-hero {
          padding: clamp(5rem, 10vw, 8rem) 2rem clamp(2rem, 4vw, 3rem);
          background: var(--bg);
        }
        .jn-h1 {
          font-family: var(--heading-font);
          font-size: clamp(2.2rem, 4.6vw, 3.5rem);
          font-weight: 700;
          line-height: 1.08;
          letter-spacing: -0.02em;
          color: var(--ink);
          margin: 0.9rem 0 0;
        }
        .jn-sub {
          margin-top: 1.25rem;
          font-size: 1.1rem;
          line-height: 1.65;
          color: var(--ink-2);
          max-width: 58ch;
        }

        .jn-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 1.5rem;
          align-items: stretch;
        }
        .jn-card {
          display: flex;
          flex-direction: column;
          padding: 2rem;
          border: 1px solid var(--line);
          border-radius: 16px;
          background: var(--bg-card);
          text-decoration: none;
          transition: border-color 0.2s ease, background 0.2s ease,
            transform 0.2s ease;
        }
        .jn-card:hover {
          border-color: var(--accent);
          background: var(--bg-card-hover);
          transform: translateY(-2px);
        }
        .jn-card-accent {
          border-color: var(--accent);
          box-shadow: 0 0 0 1px var(--accent-soft);
        }
        .jn-key {
          font-size: 0.7rem;
          font-weight: 600;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--accent);
        }
        .jn-title {
          font-family: var(--heading-font);
          font-size: 1.6rem;
          font-weight: 700;
          letter-spacing: -0.01em;
          color: var(--ink);
          margin: 0.7rem 0 0;
        }
        .jn-desc {
          font-size: 0.98rem;
          line-height: 1.65;
          color: var(--ink-2);
          margin: 0.75rem 0 1.25rem;
        }
        .jn-list {
          list-style: none;
          padding: 0;
          margin: 0 0 1.75rem;
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
        }
        .jn-list li {
          position: relative;
          padding-left: 1.4rem;
          font-size: 0.9rem;
          line-height: 1.55;
          color: var(--ink-2);
        }
        .jn-list li::before {
          content: "";
          position: absolute;
          left: 0;
          top: 0.55em;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent);
        }
        .jn-cta {
          margin-top: auto;
          font-size: 0.92rem;
          font-weight: 600;
          color: var(--accent);
        }
        .jn-cta-quiet { color: var(--ink-2); }
        .jn-card:hover .jn-cta-quiet { color: var(--accent); }

        .jn-foot {
          margin-top: 2rem;
          font-size: 0.92rem;
          line-height: 1.7;
          color: var(--muted);
        }
        .jn-foot a { color: var(--accent); }

        @media (max-width: 780px) {
          .jn-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </RevealMain>
  );
}
