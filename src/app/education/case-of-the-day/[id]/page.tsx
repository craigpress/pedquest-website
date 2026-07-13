import Link from "next/link";
import type { Metadata } from "next";
import CaseQuiz from "@/components/CaseQuiz";
import { getPublicCaseById } from "@/lib/cases-server";

export const dynamic = "force-dynamic";

const wrap: React.CSSProperties = { maxWidth: 860, margin: "0 auto", padding: "3rem 1.5rem 5rem" };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const c = await getPublicCaseById(id);
  return {
    title: c ? `${c.title} — qEEG Case — PedQuEST` : "qEEG Case — PedQuEST",
    description: c?.clinicalVignette ?? "A PedQuEST quantitative-EEG teaching case.",
  };
}

export default async function ArchivedCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getPublicCaseById(id);

  return (
    <div style={wrap}>
      <Link href="/education/case-of-the-day/archive"
        style={{ fontFamily: "monospace", fontSize: 13, color: "var(--accent-primary)", textDecoration: "none", display: "inline-block", marginBottom: 22 }}>
        ← Back to archive
      </Link>

      {!c ? (
        <div style={{ border: "1px solid var(--border)", borderRadius: 14, padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>
          This case isn&rsquo;t available.
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
          <CaseQuiz caseData={c} archived />
        </article>
      )}
    </div>
  );
}
