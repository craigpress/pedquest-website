// Shared inline-style tokens for the admin consoles. Same values the existing
// /admin/cases and /admin/events screens use, lifted out so new admin pages
// stay visually identical without copy-pasting them again.
//
// Colours come from the design tokens in src/app/globals.css — never literals.
import type { CSSProperties } from "react";

export const adminShell: CSSProperties = { maxWidth: 940, margin: "0 auto", padding: "3rem 1.5rem 5rem" };
export const adminShellWide: CSSProperties = { maxWidth: 1180, margin: "0 auto", padding: "3rem 1.5rem 5rem" };

export const h1: CSSProperties = {
  fontFamily: "var(--heading-font)", fontSize: "1.7rem", color: "var(--text)", margin: 0,
};
export const h2: CSSProperties = {
  fontFamily: "var(--heading-font)", fontSize: "1.25rem", color: "var(--text)", margin: 0,
};
export const eyebrow: CSSProperties = {
  fontFamily: "var(--mono-font)", fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase",
  color: "var(--accent-primary)", fontWeight: 600,
};
export const meta: CSSProperties = {
  fontFamily: "var(--mono-font)", fontSize: 12.5, color: "var(--text-muted)",
};
export const inp: CSSProperties = {
  padding: "9px 11px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)",
  color: "var(--text)", font: "inherit", fontSize: 14, width: "100%",
};
export const btnPrimary: CSSProperties = {
  padding: "9px 16px", borderRadius: 9, border: "none", background: "var(--accent-primary)",
  color: "#05201d", fontWeight: 600, cursor: "pointer", fontSize: 14,
};
export const btnGhost: CSSProperties = {
  padding: "9px 16px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg-card)",
  color: "var(--text)", fontWeight: 600, cursor: "pointer", fontSize: 14,
};
export const mini: CSSProperties = {
  padding: "5px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg-card)",
  color: "var(--text-secondary)", cursor: "pointer", fontSize: 12.5,
  fontFamily: "var(--mono-font)", textDecoration: "none",
};
export const card: CSSProperties = {
  background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14,
};
export const fieldLabel: CSSProperties = {
  display: "block", fontFamily: "var(--mono-font)", fontSize: 11, letterSpacing: ".07em",
  textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6,
};

export const STATUS_COLORS: Record<string, string> = {
  published: "var(--accent-tertiary)",
  approved: "var(--accent-tertiary)",
  pending_review: "var(--accent-secondary)",
  draft: "var(--text-muted)",
  archived: "var(--text-muted)",
};
