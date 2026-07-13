// Makes the site's purpose explicit: PedQuEST is a research + collaboration
// consortium and an educational resource. Nothing here is medical advice.
// Rendered on the qEEG "Case of the Day" pages (and reusable elsewhere).
export default function ResearchDisclaimer({ style }: { style?: React.CSSProperties }) {
  return (
    <aside
      role="note"
      aria-label="Research and education disclaimer"
      style={{
        marginTop: "2.5rem",
        padding: "14px 18px",
        borderRadius: 12,
        border: "1px solid var(--border)",
        borderLeft: "3px solid var(--accent-secondary)",
        background: "var(--bg-card)",
        color: "var(--text-secondary)",
        fontSize: 13.5,
        lineHeight: 1.6,
        ...style,
      }}
    >
      <strong style={{ color: "var(--text)" }}>For research, education, and professional collaboration only.</strong>{" "}
      PedQuEST is a multicenter research consortium. This material — including qEEG cases and quizzes —
      is intended for professional education and scholarly collaboration among clinicians and researchers.
      It is <strong>not medical advice</strong> and must not be used for diagnosis, treatment, or clinical
      decision-making. All images are synthetic or de-identified teaching examples.
    </aside>
  );
}
