"use client";

// Share links for a case.
//
// The URL shared is always the case's own page, never the state the sharer is
// looking at: answers live in localStorage, not the query string, so someone
// opening a shared link gets the unanswered question. That is the point —
// sharing an interesting case should hand the recipient the question, not the
// answer.

import { useCallback, useEffect, useState } from "react";

export default function ShareCase({
  path,
  title,
  summary,
}: {
  /** site-absolute path, e.g. /education/question-bank/<id> */
  path: string;
  title: string;
  summary?: string | null;
}) {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);

  useEffect(() => {
    setUrl(new URL(path, window.location.origin).toString());
    setCanNativeShare(typeof navigator !== "undefined" && !!navigator.share);
  }, [path]);

  const blurb = summary?.trim()
    ? `${title} — ${summary.trim().slice(0, 160)}`
    : title;

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard blocked — the links below still work */
    }
  }, [url]);

  const nativeShare = useCallback(async () => {
    try { await navigator.share({ title, text: blurb, url }); } catch { /* cancelled */ }
  }, [title, blurb, url]);

  if (!url) return null;

  const e = encodeURIComponent;
  const links: { label: string; href: string }[] = [
    { label: "Email", href: `mailto:?subject=${e(`PedQuEST qEEG case: ${title}`)}&body=${e(`${blurb}\n\n${url}`)}` },
    { label: "Text", href: `sms:?&body=${e(`${blurb} ${url}`)}` },
    { label: "X", href: `https://twitter.com/intent/tweet?text=${e(blurb)}&url=${e(url)}` },
    { label: "LinkedIn", href: `https://www.linkedin.com/sharing/share-offsite/?url=${e(url)}` },
    { label: "Bluesky", href: `https://bsky.app/intent/compose?text=${e(`${blurb} ${url}`)}` },
  ];

  const chip: React.CSSProperties = {
    fontFamily: "var(--mono-font, monospace)", fontSize: 12, lineHeight: 1,
    padding: "7px 11px", borderRadius: 999, border: "1px solid var(--border)",
    background: "var(--bg-card)", color: "var(--text-secondary)",
    textDecoration: "none", cursor: "pointer",
  };

  return (
    <div style={{ marginTop: 28, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
      <div style={{
        fontFamily: "var(--mono-font, monospace)", fontSize: 11, letterSpacing: ".08em",
        textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10,
      }}>
        Share this case
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {canNativeShare && (
          <button type="button" onClick={nativeShare} style={chip}>Share…</button>
        )}
        {links.map((l) => (
          <a key={l.label} href={l.href} target="_blank" rel="noopener noreferrer" style={chip}>
            {l.label}
          </a>
        ))}
        <button type="button" onClick={copy} style={chip} aria-live="polite">
          {copied ? "Link copied" : "Copy link"}
        </button>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "10px 0 0" }}>
        Shares the question, not your answer.
      </p>
    </div>
  );
}
