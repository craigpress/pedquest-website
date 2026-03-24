import { Metadata } from "next";
import { members } from "@/data/members";

export const metadata: Metadata = {
  title: "About PedQuEST — Mission, Leadership & Research Platform",
  description:
    "Learn about PedQuEST's mission to advance quantitative EEG for pediatric critical care, our leadership team, multicenter research platform, and how to get involved.",
};

const coDirectors = members.filter((m) => m.leadershipRole === "co_director");
const scientificCommittee = members.filter(
  (m) => m.leadershipRole === "scientific_committee"
);
const seniorAdvisors = members.filter(
  (m) => m.leadershipRole === "senior_advisor"
);
const educationLeads = members.filter(
  (m) => m.leadershipRole === "education_lead"
);

const milestones = [
  {
    year: "2022",
    title: "Initial Conversations",
    description:
      "Founding members begin discussing the need for a collaborative, multicenter approach to pediatric qEEG research.",
  },
  {
    year: "2023",
    title: "PedQuEST Formally Established",
    description:
      "The Pediatric Quantitative EEG Strategic Taskforce is officially formed with leadership structure, scientific committee, and founding member institutions.",
  },
  {
    year: "2023",
    title: "PERF Partnership",
    description:
      "PedQuEST secures support from the Pediatric Epilepsy Research Foundation (PERF) to fund infrastructure and pilot research studies.",
  },
  {
    year: "2024",
    title: "Research Platform Launch",
    description:
      "The first multicenter pediatric/neonatal ICU EEG research platform goes live, integrating Persyst, Pennsieve, and REDCap into a unified data pipeline.",
  },
  {
    year: "2025",
    title: "International Expansion",
    description:
      "PedQuEST grows to 66+ members across 24 institutions in 4 countries, with pilot research aims actively enrolling data.",
  },
];

const pilotAims = [
  {
    aim: "Aim 1",
    title: "Centralized EEG Database with Normative Cohort",
    description:
      "Establish a multicenter, cloud-based EEG repository with standardized qEEG features extracted from a normative pediatric ICU cohort to serve as a shared reference for future studies.",
    icon: (
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4.03 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5" />
      </svg>
    ),
  },
  {
    aim: "Aim 2",
    title: "qEEG Biomarkers Post-Cardiac Arrest",
    description:
      "Identify early quantitative EEG biomarkers that predict neurological outcome in children following cardiac arrest, enabling earlier prognostication and targeted neuroprotective interventions.",
    icon: (
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },
  {
    aim: "Aim 3",
    title: "EEG Biomarkers of NORSE/FIRES",
    description:
      "Detect early EEG signatures and quantitative features that distinguish NORSE/FIRES from other etiologies of refractory status epilepticus, enabling more timely diagnosis and treatment.",
    icon: (
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
    ),
  },
];

export default function AboutPage() {
  return (
    <main>
      {/* ── Hero / Mission ── */}
      <section className="about-hero">
        <div className="about-hero-bg" aria-hidden="true" />
        <div className="about-hero-content">
          <h1 className="about-hero-heading">About PedQuEST</h1>
          <p className="about-hero-subtitle">
            The Pediatric Quantitative EEG Strategic Taskforce
          </p>
        </div>
      </section>

      {/* ── Mission Statement ── */}
      <section className="mission-section">
        <div className="mission-container">
          <h2 className="section-heading">Our Mission</h2>
          <div className="mission-grid">
            {[
              {
                title: "Advance Clinical qEEG",
                text: "Promote the use of quantitative EEG for clinical neuromonitoring in pediatric and neonatal intensive care settings.",
              },
              {
                title: "Identify Biomarkers",
                text: "Discover and validate qEEG biomarkers that predict neurological outcomes and guide treatment decisions.",
              },
              {
                title: "Standardize Pipelines",
                text: "Develop standardized data extraction, processing, and analysis pipelines for multicenter EEG research.",
              },
              {
                title: "Build Infrastructure",
                text: "Create shared research infrastructure including cloud-based data platforms, centralized repositories, and collaborative tools.",
              },
              {
                title: "Deliver Education",
                text: "Develop and disseminate standardized qEEG education for clinicians at every level of expertise.",
              },
              {
                title: "Promote Collaboration",
                text: "Foster international, multidisciplinary collaboration across institutions, specialties, and career stages.",
              },
            ].map((item) => (
              <div key={item.title} className="card mission-card">
                <h3 className="mission-card-title">{item.title}</h3>
                <p className="mission-card-text">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Timeline / History ── */}
      <section className="timeline-section">
        <div className="timeline-container">
          <h2 className="section-heading">Our Journey</h2>
          <p className="section-subheading">
            Key milestones in the formation and growth of PedQuEST.
          </p>
          <div className="timeline">
            <div className="timeline-line" aria-hidden="true" />
            {milestones.map((milestone, i) => (
              <div
                key={i}
                className={`timeline-item ${i % 2 === 0 ? "timeline-left" : "timeline-right"}`}
              >
                <div className="timeline-dot" aria-hidden="true" />
                <div className="card timeline-card">
                  <span className="timeline-year">{milestone.year}</span>
                  <h3 className="timeline-title">{milestone.title}</h3>
                  <p className="timeline-desc">{milestone.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Research Platform ── */}
      <section className="platform-section">
        <div className="platform-container">
          <h2 className="section-heading">Research Platform</h2>
          <p className="section-subheading" style={{ marginBottom: "2.5rem" }}>
            The first multicenter pediatric and neonatal ICU EEG research
            platform, built for scalable, reproducible science.
          </p>

          <div className="platform-innovations">
            <h3 className="platform-subhead">Key Innovations</h3>
            <div className="innovations-grid">
              {[
                {
                  title: "Automated EEG Extraction",
                  desc: "Persyst + Python pipeline for automated, standardized qEEG feature extraction across all sites.",
                },
                {
                  title: "Pennsieve Cloud Platform",
                  desc: "HIPAA-compliant, cloud-based data management through the Pennsieve platform for secure EEG storage and sharing.",
                },
                {
                  title: "REDCap-Linked Clinical Data",
                  desc: "Structured clinical and demographic data captured via REDCap and linked to EEG records for integrated analysis.",
                },
                {
                  title: "Central + Site-Based Workflows",
                  desc: "Flexible architecture supporting both centralized processing and site-based data workflows to accommodate institutional needs.",
                },
              ].map((item) => (
                <div key={item.title} className="card innovation-card">
                  <h4 className="innovation-title">{item.title}</h4>
                  <p className="innovation-desc">{item.desc}</p>
                </div>
              ))}
            </div>
            <div className="pennsieve-link">
              <a
                href="https://pennsieve.io"
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary"
              >
                Visit Pennsieve
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 3h8v8M13 3L3 13" />
                </svg>
              </a>
            </div>
          </div>

          <div className="pilot-aims">
            <h3 className="platform-subhead">Pilot Research Aims</h3>
            <div className="aims-grid">
              {pilotAims.map((aim) => (
                <div key={aim.aim} className="card aim-card">
                  <div className="aim-icon">{aim.icon}</div>
                  <span className="aim-label">{aim.aim}</span>
                  <h4 className="aim-title">{aim.title}</h4>
                  <p className="aim-desc">{aim.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Leadership ── */}
      <section className="leadership-section">
        <div className="leadership-container">
          <h2 className="section-heading">Leadership</h2>

          {/* Co-Directors */}
          <div className="leadership-group">
            <h3 className="leadership-group-title">Co-Directors</h3>
            <div className="codirectors-grid">
              {coDirectors.map((m) => (
                <div key={m.id} className="card codirector-card">
                  <div className="codirector-avatar">
                    {m.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </div>
                  <h4 className="codirector-name">
                    {m.name}, {m.title}
                  </h4>
                  <p className="codirector-institution">{m.institution}</p>
                  <p className="codirector-bio">{m.bio}</p>
                  <div className="codirector-interests">
                    {m.interests.map((interest) => (
                      <span key={interest} className="badge badge-member">
                        {interest}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Scientific Committee */}
          <div className="leadership-group">
            <h3 className="leadership-group-title">Scientific Committee</h3>
            <p className="leadership-group-desc">
              Chaired by Dana B. Harrar, MD — Children&apos;s National Hospital
            </p>
            <div className="committee-grid">
              {scientificCommittee.map((m) => (
                <div key={m.id} className="card committee-card">
                  <div className="committee-avatar">
                    {m.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </div>
                  <h4 className="committee-name">
                    {m.name}, {m.title}
                  </h4>
                  <p className="committee-institution">{m.institution}</p>
                  {m.role && (
                    <span className="committee-role">{m.role}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Senior Scientific Advisors */}
          <div className="leadership-group">
            <h3 className="leadership-group-title">
              Senior Scientific Advisors
            </h3>
            <div className="advisors-list">
              {seniorAdvisors.map((m) => (
                <div key={m.id} className="advisor-item">
                  <div className="advisor-dot" aria-hidden="true" />
                  <div className="advisor-info">
                    <span className="advisor-name">
                      {m.name}, {m.title}
                    </span>
                    <span className="advisor-institution">
                      {m.institution}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Education Leads */}
          <div className="leadership-group">
            <h3 className="leadership-group-title">Education Leads</h3>
            <div className="committee-grid">
              {educationLeads.map((m) => (
                <div key={m.id} className="card committee-card">
                  <div className="committee-avatar">
                    {m.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")}
                  </div>
                  <h4 className="committee-name">
                    {m.name}, {m.title}
                  </h4>
                  <p className="committee-institution">{m.institution}</p>
                </div>
              ))}
              {/* Anuj Jayakar is in scientific committee but also education lead */}
              {scientificCommittee
                .filter((m) => m.role?.includes("Education"))
                .map((m) => (
                  <div key={`edu-${m.id}`} className="card committee-card">
                    <div className="committee-avatar">
                      {m.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")}
                    </div>
                    <h4 className="committee-name">
                      {m.name}, {m.title}
                    </h4>
                    <p className="committee-institution">{m.institution}</p>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Partners & Donors ── */}
      <section className="partners-section">
        <div className="partners-container">
          <h2 className="section-heading">Our Partners</h2>
          <p
            className="section-subheading"
            style={{ marginBottom: "2.5rem" }}
          >
            PedQuEST is made possible through the generous support of our
            partners and donors.
          </p>

          {/* PERF Feature */}
          <div className="card perf-feature-card">
            <p className="perf-feature-label">Founding Supporter</p>
            <h3 className="perf-feature-name">
              Pediatric Epilepsy Research Foundation (PERF)
            </h3>
            <p className="perf-feature-desc">
              PERF provides critical funding for PedQuEST&apos;s research
              infrastructure, pilot studies, and educational initiatives,
              enabling the consortium to advance qEEG science for children
              worldwide.
            </p>
            <a
              href="https://www.pediatricepilepsyresearchfoundation.org"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary"
            >
              Visit PERF
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 3h8v8M13 3L3 13" />
              </svg>
            </a>
          </div>

          {/* Partner Logos Placeholder */}
          <div className="partner-logos-placeholder">
            <p className="partner-logos-text">
              Partner logos coming soon
            </p>
          </div>

          {/* Become a Donor */}
          <div className="donor-cta">
            <h3 className="donor-cta-heading">Support Our Mission</h3>
            <p className="donor-cta-text">
              Your contribution helps advance brain-directed care for
              critically ill children through qEEG research and education.
            </p>
            <a href="/contact" className="btn-secondary">
              Become a Donor
            </a>
          </div>
        </div>
      </section>

      {/* ── Join CTA ── */}
      <section className="about-join-section">
        <div className="about-join-container">
          <h2 className="about-join-heading">Join PedQuEST</h2>
          <p className="about-join-description">
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
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 3h8v8M13 3L3 13" />
            </svg>
          </a>
        </div>
      </section>

      <style>{`
        /* ── About Hero ── */
        .about-hero {
          position: relative;
          padding: 4rem 2rem 3rem;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }
        .about-hero-bg {
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse 80% 60% at 30% 40%, color-mix(in srgb, var(--accent-primary) 8%, transparent) 0%, transparent 70%),
            radial-gradient(ellipse 60% 50% at 70% 60%, color-mix(in srgb, var(--accent-tertiary) 8%, transparent) 0%, transparent 60%);
          z-index: 0;
        }
        .about-hero-content {
          position: relative;
          z-index: 1;
          text-align: center;
          max-width: 780px;
        }
        .about-hero-heading {
          font-family: var(--heading-font);
          font-size: clamp(2.5rem, 5vw, 3.75rem);
          font-weight: 800;
          line-height: 1.1;
          color: var(--text);
          margin-bottom: 1rem;
          letter-spacing: -0.02em;
        }
        .about-hero-subtitle {
          font-size: 1.25rem;
          color: var(--text-secondary);
          font-weight: 500;
        }

        /* ── Mission ── */
        .mission-section {
          padding: 5rem 2rem;
          max-width: 1100px;
          margin: 0 auto;
        }
        .mission-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1.25rem;
          margin-top: 2rem;
        }
        .mission-card {
          padding: 1.75rem;
        }
        .mission-card-title {
          font-family: var(--heading-font);
          font-size: 1.15rem;
          font-weight: 700;
          color: var(--text);
          margin-bottom: 0.5rem;
        }
        .mission-card-text {
          font-size: 0.92rem;
          color: var(--text-secondary);
          line-height: 1.6;
        }

        /* ── Timeline ── */
        .timeline-section {
          padding: 5rem 2rem;
          background: var(--bg-card);
          border-top: 1px solid var(--border);
          border-bottom: 1px solid var(--border);
        }
        .timeline-container {
          max-width: 900px;
          margin: 0 auto;
        }
        .timeline {
          position: relative;
          margin-top: 3rem;
          padding: 1rem 0;
        }
        .timeline-line {
          position: absolute;
          left: 50%;
          top: 0;
          bottom: 0;
          width: 2px;
          background: var(--border-strong);
          transform: translateX(-50%);
        }
        .timeline-item {
          position: relative;
          width: 50%;
          padding: 0 2.5rem 3rem;
        }
        .timeline-left {
          left: 0;
          text-align: right;
          padding-right: 3rem;
        }
        .timeline-right {
          left: 50%;
          text-align: left;
          padding-left: 3rem;
        }
        .timeline-dot {
          position: absolute;
          top: 0.5rem;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--accent-primary);
          border: 3px solid var(--bg-card);
          box-shadow: 0 0 0 2px var(--accent-primary);
        }
        .timeline-left .timeline-dot {
          right: -7px;
        }
        .timeline-right .timeline-dot {
          left: -7px;
        }
        .timeline-card {
          padding: 1.5rem;
          display: inline-block;
          text-align: left;
        }
        .timeline-year {
          font-family: var(--heading-font);
          font-size: 0.85rem;
          font-weight: 700;
          color: var(--accent-primary);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .timeline-title {
          font-family: var(--heading-font);
          font-size: 1.1rem;
          font-weight: 700;
          color: var(--text);
          margin: 0.35rem 0 0.5rem;
        }
        .timeline-desc {
          font-size: 0.9rem;
          color: var(--text-secondary);
          line-height: 1.6;
        }

        /* ── Research Platform ── */
        .platform-section {
          padding: 5rem 2rem;
          max-width: 1100px;
          margin: 0 auto;
        }
        .platform-subhead {
          font-family: var(--heading-font);
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--text);
          margin-bottom: 1.5rem;
        }
        .innovations-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 1.25rem;
        }
        .innovation-card {
          padding: 1.75rem;
        }
        .innovation-title {
          font-family: var(--heading-font);
          font-size: 1.05rem;
          font-weight: 700;
          color: var(--text);
          margin-bottom: 0.5rem;
        }
        .innovation-desc {
          font-size: 0.9rem;
          color: var(--text-secondary);
          line-height: 1.6;
        }
        .pennsieve-link {
          margin-top: 1.5rem;
        }
        .pilot-aims {
          margin-top: 4rem;
        }
        .aims-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1.25rem;
        }
        .aim-card {
          padding: 2rem;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .aim-icon {
          width: 52px;
          height: 52px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
          color: var(--accent-primary);
        }
        .aim-label {
          font-size: 0.8rem;
          font-weight: 700;
          color: var(--accent-primary);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .aim-title {
          font-family: var(--heading-font);
          font-size: 1.1rem;
          font-weight: 700;
          color: var(--text);
        }
        .aim-desc {
          font-size: 0.9rem;
          color: var(--text-secondary);
          line-height: 1.6;
        }

        /* ── Leadership ── */
        .leadership-section {
          padding: 5rem 2rem;
          background: var(--bg-card);
          border-top: 1px solid var(--border);
          border-bottom: 1px solid var(--border);
        }
        .leadership-container {
          max-width: 1100px;
          margin: 0 auto;
        }
        .leadership-group {
          margin-top: 3rem;
        }
        .leadership-group-title {
          font-family: var(--heading-font);
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--text);
          margin-bottom: 0.5rem;
        }
        .leadership-group-desc {
          font-size: 0.95rem;
          color: var(--text-secondary);
          margin-bottom: 1.5rem;
        }

        /* Co-Directors */
        .codirectors-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 1.5rem;
          margin-top: 1.5rem;
        }
        .codirector-card {
          padding: 2.25rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 0.75rem;
        }
        .codirector-avatar {
          width: 72px;
          height: 72px;
          border-radius: 50%;
          background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
          color: var(--accent-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--heading-font);
          font-size: 1.5rem;
          font-weight: 700;
          margin-bottom: 0.5rem;
        }
        .codirector-name {
          font-family: var(--heading-font);
          font-size: 1.25rem;
          font-weight: 700;
          color: var(--text);
        }
        .codirector-institution {
          font-size: 0.9rem;
          color: var(--accent-primary);
          font-weight: 600;
        }
        .codirector-bio {
          font-size: 0.9rem;
          color: var(--text-secondary);
          line-height: 1.6;
          max-width: 400px;
        }
        .codirector-interests {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          justify-content: center;
          margin-top: 0.5rem;
        }

        /* Scientific Committee Grid */
        .committee-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 1.25rem;
          margin-top: 1.5rem;
        }
        .committee-card {
          padding: 1.75rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 0.5rem;
        }
        .committee-avatar {
          width: 52px;
          height: 52px;
          border-radius: 50%;
          background: color-mix(in srgb, var(--accent-tertiary) 15%, transparent);
          color: var(--accent-tertiary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: var(--heading-font);
          font-size: 1rem;
          font-weight: 700;
          margin-bottom: 0.25rem;
        }
        .committee-name {
          font-family: var(--heading-font);
          font-size: 1rem;
          font-weight: 700;
          color: var(--text);
        }
        .committee-institution {
          font-size: 0.82rem;
          color: var(--text-secondary);
        }
        .committee-role {
          font-size: 0.75rem;
          color: var(--accent-primary);
          font-weight: 600;
          margin-top: 0.25rem;
        }

        /* Senior Advisors List */
        .advisors-list {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          margin-top: 1.5rem;
          max-width: 600px;
        }
        .advisor-item {
          display: flex;
          align-items: center;
          gap: 1rem;
        }
        .advisor-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--accent-primary);
          flex-shrink: 0;
        }
        .advisor-info {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }
        .advisor-name {
          font-family: var(--heading-font);
          font-size: 1rem;
          font-weight: 700;
          color: var(--text);
        }
        .advisor-institution {
          font-size: 0.85rem;
          color: var(--text-secondary);
        }

        /* ── Partners & Donors ── */
        .partners-section {
          padding: 5rem 2rem;
          max-width: 1100px;
          margin: 0 auto;
        }
        .perf-feature-card {
          padding: 3rem;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
          margin-bottom: 2.5rem;
        }
        .perf-feature-label {
          font-size: 0.8rem;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--text-muted);
          font-weight: 600;
        }
        .perf-feature-name {
          font-family: var(--heading-font);
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--text);
        }
        .perf-feature-desc {
          font-size: 0.95rem;
          color: var(--text-secondary);
          line-height: 1.6;
          max-width: 600px;
        }
        .partner-logos-placeholder {
          border: 2px dashed var(--border-strong);
          border-radius: 16px;
          padding: 3rem;
          text-align: center;
          margin-bottom: 2.5rem;
        }
        .partner-logos-text {
          color: var(--text-muted);
          font-size: 0.9rem;
        }
        .donor-cta {
          text-align: center;
          padding: 3rem 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
        }
        .donor-cta-heading {
          font-family: var(--heading-font);
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--text);
        }
        .donor-cta-text {
          font-size: 0.95rem;
          color: var(--text-secondary);
          max-width: 500px;
          line-height: 1.6;
        }

        /* ── Join CTA ── */
        .about-join-section {
          padding: 6rem 2rem;
          background:
            radial-gradient(ellipse 70% 50% at 50% 50%, color-mix(in srgb, var(--accent-primary) 6%, transparent) 0%, transparent 70%);
        }
        .about-join-container {
          max-width: 640px;
          margin: 0 auto;
          text-align: center;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1.25rem;
        }
        .about-join-heading {
          font-family: var(--heading-font);
          font-size: 2rem;
          font-weight: 700;
          color: var(--text);
        }
        .about-join-description {
          font-size: 1.05rem;
          color: var(--text-secondary);
          line-height: 1.7;
          margin-bottom: 0.5rem;
        }

        /* ── Responsive ── */
        @media (max-width: 900px) {
          .mission-grid {
            grid-template-columns: repeat(2, 1fr);
          }
          .aims-grid {
            grid-template-columns: 1fr;
            max-width: 500px;
          }
          .committee-grid {
            grid-template-columns: repeat(2, 1fr);
          }
          .codirectors-grid {
            grid-template-columns: 1fr;
            max-width: 500px;
            margin-left: auto;
            margin-right: auto;
          }
          .innovations-grid {
            grid-template-columns: 1fr;
          }
          /* Timeline stacks to single column */
          .timeline-line {
            left: 7px;
          }
          .timeline-item {
            width: 100%;
            left: 0 !important;
            text-align: left !important;
            padding-left: 2.5rem !important;
            padding-right: 0 !important;
          }
          .timeline-left .timeline-dot,
          .timeline-right .timeline-dot {
            left: 0 !important;
            right: auto !important;
          }
        }
        @media (max-width: 600px) {
          .about-hero {
            padding: 3rem 1.25rem 2rem;
          }
          .mission-section,
          .platform-section,
          .partners-section {
            padding: 3.5rem 1.25rem;
          }
          .mission-grid {
            grid-template-columns: 1fr;
          }
          .timeline-section,
          .leadership-section {
            padding: 3.5rem 1.25rem;
          }
          .committee-grid {
            grid-template-columns: 1fr;
          }
          .about-join-section {
            padding: 4rem 1.25rem;
          }
          .perf-feature-card {
            padding: 2rem 1.25rem;
          }
        }
      `}</style>
    </main>
  );
}
