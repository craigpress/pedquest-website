"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const quickLinks = [
  { href: "/about", label: "About" },
  { href: "/members", label: "Members" },
  { href: "/publications", label: "Publications" },
  { href: "/education", label: "Education" },
  { href: "/education/question-bank", label: "Question bank" },
  { href: "/admin/eeg-lab/library", label: "EEG Library" },
  { href: "/admin/eeg-lab/viewer", label: "EEG Viewer" },
  { href: "/events", label: "Events" },
  { href: "/contact", label: "Contact" },
  { href: "/sponsor", label: "Sponsor" },
];

/** Full-height tools where the footer would only take room from the work. */
const COMPACT_ROUTES = ["/admin/eeg-lab/viewer", "/admin/eeg-lab/review"];

// Desktop (≥640px) keeps the four-column layout; phones get a short footer:
// no blurb or column headings, links in a three-column grid of 40px rows.
const css = `
  .ft-inner { max-width: 1200px; margin: 0 auto; padding: 3.5rem 1.5rem 2rem; }
  .ft-logo { height: 50px; width: auto; object-fit: contain; }
  .ft-col { display: flex; flex-direction: column; gap: 0.75rem; }
  .ft-head { color: var(--text-muted); font-family: var(--body-font); font-size: 0.7rem; font-weight: 600; line-height: 1.15; letter-spacing: 0.08em; text-transform: uppercase; }
  .ft-link { color: var(--text-secondary); font-family: var(--body-font); font-size: 0.875rem; line-height: 1.25rem; text-decoration: none; transition: color 0.15s; }
  .ft-link:hover { color: var(--accent-primary); }
  .ft-discord:hover { color: #5865F2; }
  .ft-small { color: var(--text-muted); font-family: var(--body-font); font-size: 0.75rem; line-height: 1rem; }
  .ft-bottom { border-top: 1px solid var(--border); margin-top: 2.5rem; padding-top: 1.25rem; padding-bottom: 0.5rem; }
  @media (max-width: 639px) {
    .ft-inner { padding: 1.25rem 1rem calc(0.5rem + env(safe-area-inset-bottom)); }
    .ft-grid { gap: 0.75rem; }
    .ft-logo { height: 36px; }
    .ft-blurb, .ft-head, .ft-mobile-hide { display: none !important; }
    .ft-links { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: 0.5rem; row-gap: 0; }
    .ft-link { min-height: 40px; display: flex; align-items: center; }
    .ft-involve { flex-direction: row; flex-wrap: wrap; align-items: center; gap: 0.5rem 1.25rem; }
    .ft-bottom { margin-top: 0.75rem; padding-top: 0.75rem; padding-bottom: 0; gap: 0.25rem; }
    .ft-bottom .ft-small-link { min-height: 40px; display: inline-flex; align-items: center; }
  }
`;

export default function Footer() {
  const year = new Date().getFullYear();
  const pathname = usePathname() ?? "";

  if (COMPACT_ROUTES.some((r) => pathname.startsWith(r))) {
    const small: React.CSSProperties = {
      color: "var(--text-muted)", fontFamily: "var(--body-font)", fontSize: 12, lineHeight: "16px",
    };
    const link: React.CSSProperties = { ...small, padding: "12px 6px", display: "inline-block" };
    return (
      <footer style={{ background: "var(--bg-card)", borderTop: "1px solid var(--border)" }}>
        <div
          className="flex flex-wrap items-center justify-center gap-x-2"
          style={{ maxWidth: 1200, margin: "0 auto", padding: "0 16px env(safe-area-inset-bottom)", ...small }}
        >
          <span>&copy; {year} PedQuEST · Research &amp; education only — not medical advice</span>
          <Link href="/admin/eeg-lab/library" className="no-underline" style={link}>Library</Link>
          <Link href="/privacy" className="no-underline" style={link}>Privacy</Link>
        </div>
      </footer>
    );
  }

  return (
    <footer style={{ background: "var(--bg-card)", borderTop: "1px solid var(--border)" }}>
      <style>{css}</style>
      <div className="ft-inner">
        <div className="ft-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* Column 1: Branding */}
          <div className="flex flex-col gap-4">
            <Link href="/" className="no-underline" style={{ width: "fit-content" }}>
              <Image
                src="/images/pedquest-wordmark-flame-darknav-2026.png"
                alt="PedQuEST"
                width={2113}
                height={744}
                sizes="142px"
                className="ft-logo"
              />
            </Link>
            <p
              className="ft-blurb text-sm leading-relaxed"
              style={{ color: "var(--text-secondary)", fontFamily: "var(--body-font)", maxWidth: 280 }}
            >
              Pediatric Quantitative EEG Strategic Taskforce — advancing
              EEG-based brain monitoring in pediatric critical care through
              multicenter collaboration.
            </p>
          </div>

          {/* Column 2: Quick Links */}
          <nav className="ft-col" aria-label="Footer">
            <h4 className="ft-head">Quick Links</h4>
            <div className="ft-col ft-links">
              {quickLinks.map((link) => (
                <Link key={link.href} href={link.href} className="ft-link">
                  {link.label}
                </Link>
              ))}
            </div>
          </nav>

          {/* Column 3: Support */}
          <div className="ft-col">
            <h4 className="ft-head">Supported By</h4>
            <a
              href="https://www.pediatricepilepsyresearchfoundation.org"
              target="_blank"
              rel="noopener noreferrer"
              className="ft-link"
            >
              <span>
                Pediatric Epilepsy Research Foundation (PERF)
                <span className="inline-block ml-1 opacity-50" aria-hidden="true">&#8599;</span>
              </span>
            </a>
          </div>

          {/* Column 4: Get Involved */}
          <div className="ft-col ft-involve">
            <h4 className="ft-head">Get Involved</h4>
            <Link
              href="/join"
              className="btn-primary inline-flex items-center gap-2 text-sm no-underline"
              style={{ width: "fit-content" }}
            >
              Apply to Join
            </Link>
            <Link href="/sponsor" className="ft-link ft-mobile-hide" style={{ fontWeight: 500 }}>
              Become a Sponsor
            </Link>
            <p className="ft-small ft-mobile-hide" style={{ lineHeight: 1.5 }}>
              Open to pediatric neurologists, neurophysiologists, and
              researchers interested in quantitative EEG.
            </p>
            <a
              href="https://discord.gg/t6aXyfuHsW"
              target="_blank"
              rel="noopener noreferrer"
              className="ft-link ft-discord inline-flex items-center gap-2"
            >
              <svg width="18" height="14" viewBox="0 0 71 55" fill="currentColor" aria-hidden="true">
                <path d="M60.1 4.9A58.5 58.5 0 0 0 45.4.2a.2.2 0 0 0-.2.1 40.7 40.7 0 0 0-1.8 3.7 54 54 0 0 0-16.2 0A37.4 37.4 0 0 0 25.4.3a.2.2 0 0 0-.2-.1A58.4 58.4 0 0 0 10.5 4.9a.2.2 0 0 0-.1.1C1.5 18.7-.9 32.2.3 45.5v.2a58.9 58.9 0 0 0 17.7 9 .2.2 0 0 0 .3-.1 42.1 42.1 0 0 0 3.6-5.9.2.2 0 0 0-.1-.3 38.8 38.8 0 0 1-5.5-2.6.2.2 0 0 1 0-.4l1.1-.9a.2.2 0 0 1 .2 0 42 42 0 0 0 35.6 0 .2.2 0 0 1 .2 0l1.1.9a.2.2 0 0 1 0 .4 36.4 36.4 0 0 1-5.5 2.6.2.2 0 0 0-.1.3 47.2 47.2 0 0 0 3.6 5.9.2.2 0 0 0 .3.1 58.7 58.7 0 0 0 17.7-9 .2.2 0 0 0 .1-.2c1.4-14.8-2.4-27.7-10.2-39.1a.2.2 0 0 0-.1-.1zM23.7 37.3c-3.4 0-6.2-3.1-6.2-6.9s2.7-6.9 6.2-6.9 6.3 3.1 6.2 6.9c0 3.8-2.8 6.9-6.2 6.9zm22.9 0c-3.4 0-6.2-3.1-6.2-6.9s2.7-6.9 6.2-6.9 6.3 3.1 6.2 6.9c0 3.8-2.7 6.9-6.2 6.9z"/>
              </svg>
              Join our Discord
            </a>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="ft-bottom flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="ft-small">
            &copy; {year} PedQuEST. All rights reserved. A research &amp; collaboration
            consortium — content is for research and professional education only, and is
            not medical advice.
          </p>
          <div className="flex items-center gap-3">
            <p className="ft-small ft-mobile-hide">Pediatric Quantitative EEG Strategic Taskforce</p>
            <Link href="/privacy" className="ft-small ft-small-link no-underline">Privacy</Link>
            <Link href="/login" className="ft-small ft-small-link no-underline" style={{ opacity: 0.5 }}>Log in</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
