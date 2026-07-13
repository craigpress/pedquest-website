import Link from "next/link";
import type { Metadata } from "next";
import CaseCard from "@/components/CaseCard";
import ResearchDisclaimer from "@/components/ResearchDisclaimer";
import { getArchive } from "@/lib/cases-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "qEEG Case Archive — PedQuEST",
  description: "Browse the archive of PedQuEST daily quantitative-EEG teaching cases.",
};

const wrap: React.CSSProperties = { maxWidth: 1040, margin: "0 auto", padding: "3rem 1.5rem 5rem" };

export default async function ArchivePage() {
  const items = await getArchive();
  return (
    <div style={wrap}>
      <div style={{ marginBottom: 26 }}>
        <div style={{ fontFamily: "monospace", fontSize: 12, letterSpacing: ".16em", textTransform: "uppercase", color: "var(--accent-primary)", fontWeight: 600 }}>
          Case archive
        </div>
        <h1 style={{ fontFamily: "var(--heading-font)", fontSize: "clamp(1.7rem,4vw,2.4rem)", color: "var(--text)", margin: "10px 0 8px" }}>
          qEEG Case of the Day — archive
        </h1>
        <p style={{ color: "var(--text-secondary)", maxWidth: "60ch", margin: 0 }}>
          Every published teaching case. <Link href="/education/case-of-the-day" style={{ color: "var(--accent-primary)" }}>Today&rsquo;s case →</Link>
        </p>
      </div>

      {items.length === 0 ? (
        <div style={{ border: "1px solid var(--border)", borderRadius: 14, padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>
          No cases published yet.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 18 }}>
          {items.map((it) => <CaseCard key={it.id} item={it} />)}
        </div>
      )}
      <ResearchDisclaimer />
    </div>
  );
}
