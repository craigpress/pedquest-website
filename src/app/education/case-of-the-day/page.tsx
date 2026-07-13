import Link from "next/link";
import type { Metadata } from "next";
import CaseQuiz from "@/components/CaseQuiz";
import ResearchDisclaimer from "@/components/ResearchDisclaimer";
import { getTodaysPublicCase } from "@/lib/cases-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "qEEG Case of the Day — PedQuEST",
  description: "A daily pediatric quantitative-EEG teaching case with an interactive quiz, community answer statistics, and expert explanation.",
};

const wrap: React.CSSProperties = { maxWidth: 860, margin: "0 auto", padding: "3rem 1.5rem 5rem" };

export default async function CaseOfTheDayPage() {
  const c = await getTodaysPublicCase();
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <div style={wrap}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12, marginBottom: 24 }}>
        <div>
          <div style={{ fontFamily: "monospace", fontSize: 12, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--accent-primary)", fontWeight: 600 }}>
            qEEG Case of the Day
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>{today}</div>
        </div>
        <Link href="/education/case-of-the-day/archive"
          style={{ fontFamily: "monospace", fontSize: 13, color: "var(--accent-primary)", textDecoration: "none" }}>
          View archive →
        </Link>
      </div>

      {!c ? (
        <div style={{ border: "1px solid var(--border)", borderRadius: 14, padding: "3rem 2rem", textAlign: "center", color: "var(--text-muted)", background: "var(--bg-card)" }}>
          <p style={{ fontSize: "1.05rem", margin: 0 }}>No case is published for today yet.</p>
          <p style={{ marginTop: 8 }}><Link href="/education/case-of-the-day/archive" style={{ color: "var(--accent-primary)" }}>Browse the archive →</Link></p>
        </div>
      ) : (
        <article>
          <h1 style={{ fontFamily: "var(--heading-font)", fontSize: "clamp(1.7rem,4vw,2.4rem)", lineHeight: 1.15, color: "var(--text)", margin: "0 0 12px" }}>
            {c.title}
          </h1>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 28 }}>
            <span style={{ fontFamily: "monospace", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", padding: "3px 9px", borderRadius: 6, background: "var(--member-badge-bg)", color: "var(--member-badge-text)" }}>
              {c.difficulty}
            </span>
            {c.tags.map((t) => (
              <span key={t} style={{ fontFamily: "monospace", fontSize: 11, padding: "3px 9px", borderRadius: 6, border: "1px solid var(--border)", color: "var(--text-secondary)" }}>{t}</span>
            ))}
          </div>
          <CaseQuiz caseData={c} />
        </article>
      )}
      <ResearchDisclaimer />
    </div>
  );
}
