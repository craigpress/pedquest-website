import type { EegReference } from "@/lib/eeg-reference";
import styles from "@/app/education/eeg-reference/reference.module.css";

function populated(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(populated);
  if (value && typeof value === "object") return Object.values(value).some(populated);
  return value != null && value !== "";
}
function Criteria({ value }: { value: unknown }) {
  if (!populated(value)) return null;
  if (Array.isArray(value)) return <ul>{value.filter(populated).map((v, i) => <li key={i}><Criteria value={v}/></li>)}</ul>;
  if (value && typeof value === "object") return <dl>{Object.entries(value).filter(([, v]) => populated(v)).map(([k, v]) => <div key={k}><dt>{k.replaceAll("_", " ")}</dt><dd><Criteria value={v}/></dd></div>)}</dl>;
  return <>{String(value)}</>;
}
export default function EegReferenceContent({ entry }: { entry: EegReference }) {
  const page = entry.source.url.match(/#page=(\d+)/)?.[1];
  const extras = entry.examples.filter((e, i, all) => e.url !== entry.source.url && all.findIndex((a) => a.url === e.url) === i);
  return <div className={styles.detailContent}>
    <div className={styles.criteriaGrid}>
      <section><h3>Criteria & assessment</h3><Criteria value={entry.criteria}/></section>
      <aside>
        {populated(entry.context) && <section><h3>Clinical context</h3><Criteria value={entry.context}/></section>}
        {populated(entry.pitfalls) && <section className={styles.pitfalls}><h3>Watch for</h3><Criteria value={entry.pitfalls}/></section>}
      </aside>
    </div>
    <div className={styles.sourceBar}>
      <div><span className={styles.eyebrow}>Source · {entry.source.version}</span><a href={entry.source.url} target="_blank" rel="noreferrer">{entry.source.title}{page ? ` · PDF p. ${page}` : entry.source.url.includes("/books/") ? " · atlas chapter" : ""} ↗</a></div>
      {extras.map((e) => <a key={e.url} href={e.url} target="_blank" rel="noreferrer">{e.title} ↗</a>)}
    </div>
    {populated(entry.engineering) && <details className={styles.technical}><summary>Generation & measurement notes</summary><Criteria value={entry.engineering}/></details>}
    <p className={styles.draft} title={entry.status}>Editorial draft · clinical review pending</p>
  </div>;
}
