import Link from "next/link";
import type { ArchiveItem } from "@/lib/cases-server";

export default function CaseCard({ item }: { item: ArchiveItem }) {
  return (
    <Link href={`/education/case-of-the-day/${item.id}`}
      style={{
        display: "flex", flexDirection: "column", border: "1px solid var(--border)", borderRadius: 14,
        overflow: "hidden", background: "var(--bg-card)", boxShadow: "var(--shadow)", textDecoration: "none",
        color: "inherit",
      }}>
      {item.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.imageUrl} alt="" style={{ width: "100%", height: 130, objectFit: "cover", background: "var(--bg)", borderBottom: "1px solid var(--border)" }} />
      )}
      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }}>{item.publishDate ?? "—"}</span>
          <span style={{ fontFamily: "monospace", fontSize: 10, textTransform: "uppercase", letterSpacing: ".04em",
            padding: "2px 7px", borderRadius: 6, background: "var(--member-badge-bg)", color: "var(--member-badge-text)" }}>
            {item.questionType === "point_to_feature" ? "Point" : "Quiz"}
          </span>
          <span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--text-muted)" }}>{item.difficulty}</span>
        </div>
        <div style={{ fontFamily: "var(--heading-font)", fontSize: "1.05rem", fontWeight: 600, lineHeight: 1.3, color: "var(--text)" }}>
          {item.title}
        </div>
      </div>
    </Link>
  );
}
