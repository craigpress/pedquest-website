import Link from "next/link";
import { EEG_REFERENCES } from "@/lib/eeg-reference";
import styles from "./reference.module.css";

export const metadata = { title: "EEG and qEEG reference | PedQuEST" };
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const matches = EEG_REFERENCES.filter((r) => `${r.name} ${r.aliases.join(" ")} ${r.category} ${r.definition}`.toLowerCase().includes(q.toLowerCase()));
  return <main id="main-content" className={styles.reference}>
    <h1>EEG and qEEG reference</h1>
    <p>Definitions, criteria, published examples and interpretation pitfalls. Source versions are shown on each page; editorial drafts are identified explicitly.</p>
    <form style={{ margin: "24px 0" }}><label htmlFor="reference-search">Find a feature, abbreviation or trend</label><div style={{ display: "flex", gap: 8, marginTop: 8 }}><input id="reference-search" name="q" defaultValue={q} style={{ flex: 1, padding: 10, color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)" }}/><button type="submit">Search</button></div></form>
    <p>{matches.length} entries</p>
    {Array.from(new Set(matches.map((r) => r.category))).map((category) => <section key={category} style={{ margin: "28px 0" }}><h2>{category}</h2><ul>{matches.filter((r) => r.category === category).map((r) => <li key={r.id} style={{ margin: "12px 0" }}><Link href={`/education/eeg-reference/${r.id}`}>{r.name}</Link><p style={{ margin: "4px 0", color: "var(--text-secondary)" }}>{r.definition}</p></li>)}</ul></section>)}
    {!matches.length && <p>No matching feature. Try the full term or another abbreviation.</p>}
  </main>;
}
