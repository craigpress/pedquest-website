import Link from "next/link";
import { notFound } from "next/navigation";
import { EEG_REFERENCES } from "@/lib/eeg-reference";
import styles from "../reference.module.css";

export function generateStaticParams() { return EEG_REFERENCES.map((r) => ({ slug: r.id })); }
function Criteria({ value }: { value: unknown }) {
  if (value == null || (Array.isArray(value) && !value.length)) return null;
  if (Array.isArray(value)) return <ul>{value.map((v, i) => <li key={i}><Criteria value={v}/></li>)}</ul>;
  if (value && typeof value === "object") return <dl>{Object.entries(value).map(([k, v]) => <div key={k} style={{ margin: "12px 0" }}><dt><strong>{k.replaceAll("_", " ")}</strong></dt><dd><Criteria value={v}/></dd></div>)}</dl>;
  return <>{String(value ?? "")}</>;
}
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ref = EEG_REFERENCES.find((r) => r.id === slug);
  if (!ref) notFound();
  return <main id="main-content" className={styles.reference}>
    <Link href="/education/eeg-reference">← EEG and qEEG reference</Link>
    <p>{ref.category}</p><h1>{ref.name}</h1><p>{ref.definition}</p>
    <p style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 8 }}>{ref.status}</p>
    <h2>Context</h2><Criteria value={ref.context}/><h2>Criteria and assessment</h2><Criteria value={ref.criteria}/>
    <h2>Pitfalls</h2><Criteria value={ref.pitfalls}/>
    <h2>Generation and measurement choices</h2><p>These implementation choices are separate from source-defined clinical criteria.</p><Criteria value={ref.engineering}/>
    <h2>Source and examples</h2><p><a href={ref.source.url} target="_blank" rel="noreferrer">{ref.source.title} ({ref.source.version})</a></p>
    <ul>{ref.examples.map((e) => <li key={e.url}><a href={e.url} target="_blank" rel="noreferrer">{e.title}</a></li>)}</ul>
    <p>Examples open at the publisher. A feature mention or an AI QA result is not clinical approval.</p>
    {ref.aliases.length > 0 && <p>Also indexed as: {ref.aliases.join(", ")}</p>}
  </main>;
}
