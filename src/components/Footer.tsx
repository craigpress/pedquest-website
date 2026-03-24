"use client";

import Link from "next/link";

const quickLinks = [
  { href: "/about", label: "About" },
  { href: "/members", label: "Members" },
  { href: "/publications", label: "Publications" },
  { href: "/education", label: "Education" },
  { href: "/contact", label: "Contact" },
];

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer
      style={{
        background: "var(--bg-card)",
        borderTop: "1px solid var(--border)",
      }}
    >
      <div
        className="mx-auto px-6 py-16"
        style={{ maxWidth: 1200 }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* Column 1: Branding */}
          <div className="flex flex-col gap-4">
            <Link href="/" className="no-underline">
              <span
                className="text-xl font-bold tracking-tight"
                style={{
                  fontFamily: "var(--heading-font)",
                  color: "var(--text)",
                }}
              >
                Ped
                <span style={{ color: "var(--accent-primary)" }}>Qu</span>
                EST
              </span>
            </Link>
            <p
              className="text-sm leading-relaxed"
              style={{
                color: "var(--text-secondary)",
                fontFamily: "var(--body-font)",
                maxWidth: 280,
              }}
            >
              Pediatric Quantitative EEG Strategic Taskforce — advancing
              EEG-based brain monitoring in pediatric critical care through
              multicenter collaboration.
            </p>
          </div>

          {/* Column 2: Quick Links */}
          <div className="flex flex-col gap-3">
            <h4
              className="text-sm font-semibold uppercase tracking-wider mb-1"
              style={{
                color: "var(--text-muted)",
                fontFamily: "var(--body-font)",
                fontSize: "0.7rem",
                letterSpacing: "0.08em",
              }}
            >
              Quick Links
            </h4>
            {quickLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm no-underline transition-colors duration-150"
                style={{
                  color: "var(--text-secondary)",
                  fontFamily: "var(--body-font)",
                }}
                onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
                  e.currentTarget.style.color = "var(--accent-primary)";
                }}
                onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
                  e.currentTarget.style.color = "var(--text-secondary)";
                }}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Column 3: Support */}
          <div className="flex flex-col gap-3">
            <h4
              className="text-sm font-semibold uppercase tracking-wider mb-1"
              style={{
                color: "var(--text-muted)",
                fontFamily: "var(--body-font)",
                fontSize: "0.7rem",
                letterSpacing: "0.08em",
              }}
            >
              Supported By
            </h4>
            <a
              href="https://pediatricepilepsyresearchfoundation.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm no-underline transition-colors duration-150"
              style={{
                color: "var(--text-secondary)",
                fontFamily: "var(--body-font)",
              }}
              onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
                e.currentTarget.style.color = "var(--accent-primary)";
              }}
              onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
            >
              Pediatric Epilepsy Research Foundation (PERF)
              <span className="inline-block ml-1 opacity-50" aria-hidden="true">
                &#8599;
              </span>
            </a>
          </div>

          {/* Column 4: Get Involved */}
          <div className="flex flex-col gap-3">
            <h4
              className="text-sm font-semibold uppercase tracking-wider mb-1"
              style={{
                color: "var(--text-muted)",
                fontFamily: "var(--body-font)",
                fontSize: "0.7rem",
                letterSpacing: "0.08em",
              }}
            >
              Get Involved
            </h4>
            <a
              href="https://forms.office.com/r/0SdngdpiPt"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary inline-flex items-center gap-2 text-sm no-underline"
              style={{ width: "fit-content" }}
            >
              Join PedQuEST
              <span aria-hidden="true">&#8599;</span>
            </a>
            <p
              className="text-xs"
              style={{
                color: "var(--text-muted)",
                fontFamily: "var(--body-font)",
                lineHeight: 1.5,
              }}
            >
              Open to pediatric neurologists, neurophysiologists, and
              researchers interested in quantitative EEG.
            </p>
          </div>
        </div>

        {/* Bottom bar */}
        <div
          className="mt-12 pt-6 flex flex-col sm:flex-row items-center justify-between gap-3"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <p
            className="text-xs"
            style={{
              color: "var(--text-muted)",
              fontFamily: "var(--body-font)",
            }}
          >
            &copy; {year} PedQuEST. All rights reserved.
          </p>
          <p
            className="text-xs"
            style={{
              color: "var(--text-muted)",
              fontFamily: "var(--body-font)",
            }}
          >
            Pediatric Quantitative EEG Strategic Taskforce
          </p>
        </div>
      </div>
    </footer>
  );
}
