import Link from "next/link";
import { publications } from "@/data/publications";
import { members } from "@/data/members";

const recentPubs = [...publications]
  .sort((a, b) => b.year - a.year || (b.month ?? 0) - (a.month ?? 0))
  .slice(0, 4);

function getMemberBadge(pub: (typeof publications)[0]) {
  if (!pub.isMemberPaper || pub.memberAuthorIds.length === 0) return null;
  const member = members.find((m) => pub.memberAuthorIds.includes(m.id));
  return member?.name ?? null;
}

export default function HomePage() {
  return (
    <main>
      {/* ── Hero Section ── */}
      <section className="hero-section">
        <div className="hero-bg" aria-hidden="true" />
        {/* Spectrogram bands */}
        <div className="spectrogram-container" aria-hidden="true">
          <div className="spectrogram-band band-delta" />
          <div className="spectrogram-band band-theta" />
          <div className="spectrogram-band band-alpha" />
          <div className="spectrogram-band band-beta" />
          <div className="spectrogram-band band-gamma" />
        </div>
        {/* EEG waveform traces */}
        <div className="eeg-wave-container" aria-hidden="true">
          <svg viewBox="0 0 1200 120" preserveAspectRatio="none" className="eeg-wave">
            <path className="eeg-trace eeg-trace-1" d="M0 60 L50 60 L70 45 L80 75 L90 30 L100 90 L110 40 L120 70 L130 55 L150 60 L200 60 L220 50 L230 70 L240 35 L250 85 L260 42 L270 68 L280 55 L300 60 L400 60 L420 48 L430 72 L440 32 L450 88 L460 38 L470 65 L480 58 L500 60 L600 60 L620 52 L630 68 L640 38 L650 82 L660 44 L670 62 L680 56 L700 60 L800 60 L820 46 L830 74 L840 34 L850 86 L860 40 L870 66 L880 54 L900 60 L1000 60 L1020 50 L1030 70 L1040 36 L1050 84 L1060 42 L1070 64 L1080 58 L1100 60 L1200 60" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path className="eeg-trace eeg-trace-2" d="M0 60 L80 60 L100 48 L110 72 L120 35 L130 85 L140 42 L150 68 L160 55 L180 60 L280 60 L300 52 L310 68 L320 38 L330 82 L340 44 L350 62 L360 56 L380 60 L480 60 L500 46 L510 74 L520 34 L530 86 L540 40 L550 66 L560 54 L580 60 L680 60 L700 50 L710 70 L720 36 L730 84 L740 42 L750 64 L760 58 L780 60 L880 60 L900 48 L910 72 L920 35 L930 85 L940 42 L950 68 L960 55 L980 60 L1200 60" fill="none" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
            <path className="eeg-trace eeg-trace-3" d="M0 60 L120 60 L140 52 L150 68 L160 40 L170 80 L180 45 L190 65 L200 58 L220 60 L350 60 L370 48 L380 72 L390 36 L400 84 L410 42 L420 64 L430 56 L450 60 L580 60 L600 50 L610 70 L620 38 L630 82 L640 44 L650 62 L660 56 L680 60 L780 60 L800 46 L810 74 L820 34 L830 86 L840 40 L850 66 L860 54 L880 60 L1050 60 L1070 52 L1080 68 L1090 40 L1100 80 L1110 45 L1120 65 L1130 58 L1150 60 L1200 60" fill="none" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <div className="hero-content">
          <h1 className="hero-heading">
            Advancing Brain-Directed Care for Critically Ill Children
          </h1>
          <p className="hero-subtitle">
            PedQuEST is an international, multidisciplinary consortium dedicated
            to improving outcomes for critically ill children through
            quantitative EEG (qEEG) research, education, and clinical
            translation.
          </p>
          <div className="hero-ctas">
            <Link href="/about" className="btn-primary">
              Explore Our Work
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </Link>
            <a
              href="https://forms.office.com/r/0SdngdpiPt"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
            >
              Join PedQuEST
            </a>
          </div>
        </div>
      </section>

      {/* ── Stats Bar ── */}
      <section className="stats-bar">
        <div className="stats-container">
          <div className="stat-item">
            <span className="stat-number">66+</span>
            <span className="stat-label">Members</span>
          </div>
          <div className="stat-divider" />
          <div className="stat-item">
            <span className="stat-number">24</span>
            <span className="stat-label">Institutions</span>
          </div>
          <div className="stat-divider" />
          <div className="stat-item">
            <span className="stat-number">4</span>
            <span className="stat-label">Countries</span>
          </div>
        </div>
      </section>

      {/* ── Feature Cards ── */}
      <section className="features-section">
        <div className="features-grid">
          <Link href="/about" className="card feature-card">
            <div className="feature-icon research-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
              </svg>
            </div>
            <h3 className="feature-title">Research</h3>
            <p className="feature-description">
              A multicenter qEEG research platform uniting investigators across
              24 institutions to advance brain-directed critical care through
              collaborative studies and shared data infrastructure.
            </p>
            <span className="feature-link">
              Learn more
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </span>
          </Link>

          <Link href="/education" className="card feature-card">
            <div className="feature-icon education-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 14l9-5-9-5-9 5 9 5z" />
                <path d="M12 14l6.16-3.422A12.083 12.083 0 0121 16.5c0 1-3.58 3-9 3s-9-2-9-3a12.1 12.1 0 012.84-5.922L12 14z" />
                <path d="M21 9v6" />
              </svg>
            </div>
            <h3 className="feature-title">Education</h3>
            <p className="feature-description">
              A standardized qEEG curriculum initiative developing training
              modules, workshops, and certification pathways for clinicians at
              every level of expertise.
            </p>
            <span className="feature-link">
              Learn more
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </span>
          </Link>

          <Link href="/publications" className="card feature-card">
            <div className="feature-icon publications-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
                <path d="M8 7h8M8 11h6" />
              </svg>
            </div>
            <h3 className="feature-title">Publications</h3>
            <p className="feature-description">
              A searchable database of peer-reviewed publications spanning qEEG
              research, neurocritical care outcomes, and brain monitoring
              innovations from our consortium members.
            </p>
            <span className="feature-link">
              Browse publications
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </span>
          </Link>
        </div>
      </section>

      {/* ── Latest Publications ── */}
      <section className="publications-section">
        <div className="publications-container">
          <div className="publications-header">
            <h2 className="section-heading">Latest Publications</h2>
            <p className="section-subheading">
              Recent contributions from PedQuEST members and the broader
              pediatric neurocritical care community.
            </p>
          </div>
          <div className="publications-grid">
            {recentPubs.map((pub) => {
              const memberName = getMemberBadge(pub);
              return (
                <article key={pub.id} className="card pub-card">
                  <div className="pub-meta">
                    <span className="pub-journal">{pub.journal}</span>
                    <span className="pub-year">{pub.year}</span>
                  </div>
                  <h3 className="pub-title">{pub.title}</h3>
                  <p className="pub-authors">
                    {pub.authors.slice(0, 3).join(", ")}
                    {pub.authors.length > 3 && " et al."}
                  </p>
                  {memberName && (
                    <span className="badge badge-member">
                      PedQuEST Member
                    </span>
                  )}
                </article>
              );
            })}
          </div>
          <div className="publications-cta">
            <Link href="/publications" className="btn-secondary">
              View All Publications
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* ── PERF Acknowledgment ── */}
      <section className="perf-section">
        <div className="perf-container">
          <p className="perf-label">Proudly Supported By</p>
          <h3 className="perf-name">
            Pediatric Epilepsy Research Foundation (PERF)
          </h3>
          <a
            href="https://www.pediatricepilepsyresearchfoundation.org"
            target="_blank"
            rel="noopener noreferrer"
            className="perf-link"
          >
            Visit PERF
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 3h8v8M13 3L3 13" />
            </svg>
          </a>
        </div>
      </section>

      {/* ── Join CTA ── */}
      <section className="join-section">
        <div className="join-container">
          <h2 className="join-heading">Interested in Joining PedQuEST?</h2>
          <p className="join-description">
            We welcome neurologists, intensivists, neurophysiologists, data
            scientists, and other professionals passionate about improving
            brain-directed care for critically ill children.
          </p>
          <a
            href="https://forms.office.com/r/0SdngdpiPt"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary"
          >
            Apply to Join
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 3h8v8M13 3L3 13" />
            </svg>
          </a>
        </div>
      </section>

      <style>{`
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
          min-height: 78vh;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          padding: 4rem 2rem 2rem;
        }
        .hero-bg {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse 80% 60% at 15% 30%, color-mix(in srgb, var(--accent-primary) 10%, transparent) 0%, transparent 60%),
            radial-gradient(ellipse 60% 50% at 85% 25%, color-mix(in srgb, var(--accent-tertiary) 8%, transparent) 0%, transparent 55%),
            radial-gradient(ellipse 70% 50% at 50% 70%, color-mix(in srgb, var(--accent-secondary) 8%, transparent) 0%, transparent 50%);
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
        .hero-content {
          position: relative;
          z-index: 1;
          max-width: 780px;
          text-align: center;
        }
        .hero-heading {
          font-family: var(--heading-font);
          font-size: clamp(2.25rem, 5vw, 3.75rem);
          font-weight: 800;
          line-height: 1.08;
          color: var(--text);
          margin-bottom: 1.5rem;
          letter-spacing: -0.025em;
          animation: fade-up 0.7s ease-out both;
        }
        .hero-subtitle {
          font-size: 1.15rem;
          color: var(--text-secondary);
          line-height: 1.7;
          max-width: 620px;
          margin: 0 auto 2.5rem;
          animation: fade-up 0.7s ease-out 0.15s both;
        }
        .hero-ctas {
          display: flex;
          gap: 1rem;
          justify-content: center;
          flex-wrap: wrap;
          animation: fade-up 0.7s ease-out 0.3s both;
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
        .publications-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 1.25rem;
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
          .publications-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 600px) {
          .hero-section {
            min-height: 65vh;
            padding: 3rem 1.25rem 2rem;
          }
          .stats-container {
            gap: 1.5rem;
            padding: 1.5rem 1.25rem;
          }
          .stat-number {
            font-size: 2rem;
          }
          .stat-divider {
            height: 36px;
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
