import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import CaseQuiz from "@/components/CaseQuiz";
import SignedInGate from "@/components/SignedInGate";
import ResearchDisclaimer from "@/components/ResearchDisclaimer";
import { getPublicBankItem } from "@/lib/qbank-server";
import { QBANK_DOMAIN_LABELS, type QbankDomain } from "@/lib/cases";

export const dynamic = "force-dynamic";

const wrap: React.CSSProperties = { maxWidth: 860, margin: "0 auto", padding: "3rem 1.5rem 5rem" };

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
): Promise<Metadata> {
  const { id } = await params;
  const item = await getPublicBankItem(id);
  if (!item) return { title: "Question — PedQuEST" };
  return {
    title: `${item.title} — PedQuEST question bank`,
    description: item.leadIn ?? undefined,
  };
}

export default async function QuestionBankItemPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const item = await getPublicBankItem(id);
  if (!item) notFound();

  const chips = [
    item.domain ? QBANK_DOMAIN_LABELS[item.domain as QbankDomain] ?? item.domain : null,
    item.difficulty,
    item.population,
    item.setting,
  ].filter(Boolean) as string[];

  return (
    <div style={wrap}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12, marginBottom: 22 }}>
        <div style={{ fontFamily: "var(--mono-font)", fontSize: 12, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--accent-primary)", fontWeight: 600 }}>
          qEEG question bank{item.qbankId ? ` · ${item.qbankId}` : ""}
        </div>
        <Link href="/education/question-bank" style={{ fontFamily: "var(--mono-font)", fontSize: 13 }}>
          ← All questions
        </Link>
      </div>

      <article>
        <h1 style={{ fontFamily: "var(--heading-font)", fontSize: "clamp(1.6rem,4vw,2.2rem)", lineHeight: 1.15, color: "var(--text)", margin: "0 0 12px" }}>
          {item.title}
        </h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 26 }}>
          {chips.map((chip) => (
            <span key={chip} style={{ fontFamily: "var(--mono-font)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em", padding: "3px 9px", borderRadius: 6, border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
              {chip}
            </span>
          ))}
          {item.tags.map((t) => (
            <span key={t} style={{ fontFamily: "var(--mono-font)", fontSize: 11, padding: "3px 9px", borderRadius: 6, background: "var(--member-badge-bg)", color: "var(--member-badge-text)" }}>
              {t}
            </span>
          ))}
        </div>

        <SignedInGate
          title="Sign in to answer this question"
          message="Question-bank items are open to PedQuEST members and registered learners, so your progress can be tracked by domain."
        >
          <CaseQuiz caseData={item} />
        </SignedInGate>
      </article>

      <div style={{ marginTop: 32, display: "flex", gap: 14, flexWrap: "wrap", fontFamily: "var(--mono-font)", fontSize: 13 }}>
        <Link href="/education/question-bank/practice">Practice mode →</Link>
        <Link href="/education/case-of-the-day">Case of the Day →</Link>
      </div>

      <ResearchDisclaimer />
    </div>
  );
}
