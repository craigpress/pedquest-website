"use client";

import Link from "next/link";
import Image from "next/image";

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
        className="mx-auto px-6 pt-20 pb-16"
        style={{ maxWidth: 1200 }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* Column 1: Branding */}
          <div className="flex flex-col gap-4">
            <Link href="/" className="no-underline">
              <Image
                src="/images/pedquest-wordmark.png"
                alt="PedQuEST"
                width={200}
                height={60}
                style={{ height: 50, width: "auto", objectFit: "contain" }}
              />
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
            <Link
              href="/join"
              className="btn-primary inline-flex items-center gap-2 text-sm no-underline"
              style={{ width: "fit-content" }}
            >
              Apply to Join
            </Link>
            <Link
              href="/sponsor"
              className="text-sm no-underline transition-colors duration-150"
              style={{
                color: "var(--text-secondary)",
                fontFamily: "var(--body-font)",
                fontWeight: 500,
              }}
              onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
                e.currentTarget.style.color = "var(--accent-primary)";
              }}
              onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
            >
              Become a Sponsor
            </Link>
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
            <a
              href="https://discord.gg/t6aXyfuHsW"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm no-underline"
              style={{
                color: "var(--text-secondary)",
                fontFamily: "var(--body-font)",
                transition: "color 0.2s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#5865F2"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; }}
            >
              <svg width="18" height="14" viewBox="0 0 71 55" fill="currentColor">
                <path d="M60.1 4.9A58.5 58.5 0 0 0 45.4.2a.2.2 0 0 0-.2.1 40.7 40.7 0 0 0-1.8 3.7 54 54 0 0 0-16.2 0A37.4 37.4 0 0 0 25.4.3a.2.2 0 0 0-.2-.1A58.4 58.4 0 0 0 10.5 4.9a.2.2 0 0 0-.1.1C1.5 18.7-.9 32.2.3 45.5v.2a58.9 58.9 0 0 0 17.7 9 .2.2 0 0 0 .3-.1 42.1 42.1 0 0 0 3.6-5.9.2.2 0 0 0-.1-.3 38.8 38.8 0 0 1-5.5-2.6.2.2 0 0 1 0-.4l1.1-.9a.2.2 0 0 1 .2 0 42 42 0 0 0 35.6 0 .2.2 0 0 1 .2 0l1.1.9a.2.2 0 0 1 0 .4 36.4 36.4 0 0 1-5.5 2.6.2.2 0 0 0-.1.3 47.2 47.2 0 0 0 3.6 5.9.2.2 0 0 0 .3.1 58.7 58.7 0 0 0 17.7-9 .2.2 0 0 0 .1-.2c1.4-14.8-2.4-27.7-10.2-39.1a.2.2 0 0 0-.1-.1zM23.7 37.3c-3.4 0-6.2-3.1-6.2-6.9s2.7-6.9 6.2-6.9 6.3 3.1 6.2 6.9c0 3.8-2.8 6.9-6.2 6.9zm22.9 0c-3.4 0-6.2-3.1-6.2-6.9s2.7-6.9 6.2-6.9 6.3 3.1 6.2 6.9c0 3.8-2.7 6.9-6.2 6.9z"/>
              </svg>
              Join our Discord
            </a>
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
          <div className="flex items-center gap-3">
            <p
              className="text-xs"
              style={{
                color: "var(--text-muted)",
                fontFamily: "var(--body-font)",
              }}
            >
              Pediatric Quantitative EEG Strategic Taskforce
            </p>
            <Link
              href="/admin"
              className="text-xs no-underline"
              style={{
                color: "var(--text-muted)",
                fontFamily: "var(--body-font)",
                opacity: 0.5,
              }}
            >
              Admin
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
