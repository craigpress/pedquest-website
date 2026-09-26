"use client";
import EegVisualQa from "@/components/EegVisualQa";
import { useRole } from "@/lib/auth";
import Link from "next/link";
import styles from "@/components/EegVisualQa.module.css";
export default function Page() {
  const { isEditor, loading } = useRole();
  if (loading) return <div className={styles.page} role="status">Loading review queue…</div>;
  if (!isEditor) return <div className={styles.page}><h1>EEG review queue</h1><p>Editor access is required to review private EEG evidence.</p><Link href="/login?next=%2Fadmin%2Feeg-qa">Log in →</Link></div>;
  return <div className={styles.page}><header className={styles.header}><div><h1>EEG review queue</h1><p>Inspect AI-flagged EEGs, compare the evidence, then open the editor to correct or review the case.</p></div><Link href="/education/eeg-reference">EEG & qEEG reference ↗</Link></header><EegVisualQa/></div>;
}
