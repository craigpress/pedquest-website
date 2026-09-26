"use client";
import { useState } from "react";
import Link from "next/link";
import { EEG_REFERENCES } from "@/lib/eeg-reference";
import EegReferenceContent from "./EegReferenceContent";
import styles from "@/app/education/eeg-reference/reference.module.css";

const categories = ["All", "Critical-care EEG", "Neonatal EEG", "qEEG", "Normal variants", "Artifacts", "Activation", "Developmental EEG", "Seizure classification", "Terminology"];
export default function EegReferenceBrowser({ initialQuery = "", initialCategory = "All" }) {
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState(categories.includes(initialCategory) ? initialCategory : "All");
  function filter(nextQuery: string, nextCategory: string) {
    setQuery(nextQuery); setCategory(nextCategory);
    const url = new URL(window.location.href);
    if (nextQuery) url.searchParams.set("q", nextQuery); else url.searchParams.delete("q");
    if (nextCategory !== "All") url.searchParams.set("category", nextCategory); else url.searchParams.delete("category");
    window.history.replaceState(window.history.state, "", url);
  }
  const matches = EEG_REFERENCES.filter((r) => (category === "All" || r.category === category) && `${r.name} ${r.aliases.join(" ")} ${r.category} ${r.definition}`.toLowerCase().includes(query.trim().toLowerCase()));
  const ordered = [...matches].sort((a, b) => categories.indexOf(a.category) - categories.indexOf(b.category) || a.name.localeCompare(b.name));
  return <div className={styles.reference}>
    <header className={styles.header}><div><span className={styles.eyebrow}>Clinical reference</span><h1>EEG & qEEG</h1><p>Find a feature. Open its criteria. Go straight to the source.</p></div><span className={styles.count}>{EEG_REFERENCES.length} terms</span></header>
    <div className={styles.browserLayout}>
      <select className={styles.mobileCategories} aria-label="Reference category" value={category} onChange={(e) => filter(query, e.target.value)}>{categories.map((c) => <option key={c} value={c}>{c} · {c === "All" ? EEG_REFERENCES.length : EEG_REFERENCES.filter((r) => r.category === c).length}</option>)}</select>
      <nav className={styles.categories} aria-label="Reference categories">{categories.map((c) => <button key={c} aria-pressed={category === c} onClick={() => filter(query, c)}>{c}<span>{c === "All" ? EEG_REFERENCES.length : EEG_REFERENCES.filter((r) => r.category === c).length}</span></button>)}</nav>
      <section className={styles.results} aria-label="Reference entries">
        <div className={styles.search}><label htmlFor="reference-search">Find a term or abbreviation</label><input id="reference-search" type="search" placeholder="e.g. BIRDs, suppression, aEEG…" value={query} onChange={(e) => filter(e.target.value, category)}/></div>
        <div className={styles.resultHeader}><span role="status">{matches.length} {matches.length === 1 ? "entry" : "entries"}{category !== "All" ? ` · ${category}` : ""}</span>{(query || category !== "All") && <button onClick={() => filter("", "All")}>Clear filters</button>}</div>
        {ordered.map((r) => <details key={r.id} className={styles.entry}>
          <summary><div><span className={styles.eyebrow}>{r.category}</span><h2>{r.name}</h2><p>{r.definition}</p></div><span className={styles.expand} aria-hidden="true">+</span></summary>
          <EegReferenceContent entry={r}/><Link className={styles.permalink} href={`/education/eeg-reference/${r.id}`}>Open permanent page →</Link>
        </details>)}
        {!matches.length && <div className={styles.empty}><h2>No matching terms</h2><p>Try a full name or clear the category filter.</p><button onClick={() => filter("", "All")}>Show all terms</button></div>}
      </section>
    </div>
  </div>;
}
