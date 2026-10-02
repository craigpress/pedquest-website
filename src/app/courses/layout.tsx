import ResearchDisclaimer from "@/components/ResearchDisclaimer";

// Learner-facing EEG teaching pages carry the same education disclaimer as the question bank.
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 1.5rem 3rem" }}>
        <ResearchDisclaimer style={{ marginTop: 0 }} />
      </div>
    </>
  );
}
