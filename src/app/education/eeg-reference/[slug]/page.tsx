import Link from "next/link";
import { notFound } from "next/navigation";
import { EEG_REFERENCES } from "@/lib/eeg-reference";
import EegReferenceContent from "@/components/EegReferenceContent";
import styles from "../reference.module.css";
export function generateStaticParams() { return EEG_REFERENCES.map((r) => ({ slug: r.id })); }
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entry = EEG_REFERENCES.find((r) => r.id === slug);
  if (!entry) notFound();
  return <div className={`${styles.reference} ${styles.single}`}>
    <Link className={styles.back} href={`/education/eeg-reference?category=${encodeURIComponent(entry.category)}`}>← {entry.category}</Link>
    <header className={styles.header}><div><h1>{entry.name}</h1><p>{entry.definition}</p></div></header>
    <EegReferenceContent entry={entry}/>
  </div>;
}
