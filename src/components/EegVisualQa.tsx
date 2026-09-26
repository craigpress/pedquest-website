"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
import styles from "./EegVisualQa.module.css";

export type QaRow = { id: string; job_id: string; source: "qbank" | "lab"; title?: string; review_url: string; status: string; created_at: string; model: string; report: { summary?: string; coverage?: string; evidence_urls?: string[]; limitations?: string[]; suggested_prompt?: string; findings?: { feature: string; evidence: string; recommendation: string; severity: string; remedy?: string }[] } | null };
function statusLabel(status: string) { return status === "pass" ? "AI screen passed" : status === "running" ? "Review incomplete" : status === "needs_review" ? "Needs review" : "QA unavailable"; }
function imageLabel(url: string, i: number) {
  const raw = url.match(/qa-raw-(\d+)/)?.[1];
  return raw ? `Raw EEG ${raw}` : /qa-trends/.test(url) ? "qEEG trends" : `Evidence ${i + 1}`;
}
function QaReview({ row, open }: { row: QaRow; open: boolean }) {
  const [imageIndex, setImageIndex] = useState(0);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const urls = row.report?.evidence_urls ?? [];
  const selected = urls[imageIndex];
  return <details className={styles.row} open={open}>
    <summary><div className={styles.rowTitle}>
      <div className={styles.meta}><span className={`${styles.badge} ${row.status === "pass" ? styles.pass : ""}`}>{statusLabel(row.status)}</span><span>{row.source === "lab" ? "EEG Lab" : "Question bank"}</span><time dateTime={row.created_at}>{new Date(row.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</time></div>
      <h3>{row.title || `${row.source === "lab" ? "Recording" : "Case"} ${row.job_id.slice(0, 8)}`}</h3>
      <p className={styles.summary}>{row.report?.findings?.find((f) => f.severity === "major")?.recommendation || row.report?.summary || "No completed visual assessment is available. Open the editor to inspect the generated EEG."}</p>
    </div><span className={styles.expand} aria-hidden="true">+</span></summary>
    <div className={styles.body}>
      <div className={styles.actions}><Link className={`${styles.button} ${styles.primary}`} href={row.review_url}>Open {row.source === "lab" ? "recording" : "case"} editor →</Link></div>
      <div className={styles.reviewGrid}>
        <section><h4>EEG evidence</h4>
          {urls.length ? <><div className={styles.imageTabs} aria-label="Evidence images">{urls.map((url, i) => <button key={url} aria-pressed={imageIndex === i} onClick={() => {setImageIndex(i); setFailedUrl(null);}}>{imageLabel(url, i)}</button>)}</div>
            <figure className={styles.evidence}>{failedUrl === selected ? <p className={styles.error}>Image unavailable or link expired. Refresh QA to renew the link.</p> : <a href={selected} target="_blank" rel="noreferrer" aria-label={`Open ${imageLabel(selected, imageIndex)} at full size`}>
              {/* Private signed images must not pass through the image optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img key={selected} src={selected} alt={`${imageLabel(selected, imageIndex)} for ${row.title || "this review"}`} loading="lazy" onError={() => setFailedUrl(selected)}/>
            </a>}<figcaption>{imageLabel(selected, imageIndex)} · select image for full size ↗</figcaption></figure>
          </> : <div className={styles.empty}><p>No saved image preview. Use the editor to inspect the recording or case.</p></div>}
        </section>
        <section><h4>Findings & next steps</h4>
          {row.report?.findings?.length ? row.report.findings.map((f, i) => <div className={styles.finding} key={i}><h5>{f.feature}</h5><div className={styles.meta}>{f.severity === "major" ? "Major finding" : "Minor finding"}{f.remedy ? ` · ${f.remedy === "prompt" ? "Prompt adjustment" : f.remedy === "renderer" ? "Renderer change" : f.remedy === "calculation" ? "Calculation check" : "Context needed"}` : ""}</div><p>{f.evidence}</p><p className={styles.recommendation}>{f.recommendation}</p></div>) : <p className={styles.hint}>{row.status === "pass" ? "No flagged findings in the sampled evidence. Human review is still required." : "No structured findings were returned. Check the report details and review the EEG in the editor."}</p>}
        </section>
      </div>
      {row.report?.suggested_prompt && <details className={styles.disclosure}><summary>Suggested prompt changes</summary><p>{row.report.suggested_prompt}</p></details>}
      <details className={styles.disclosure}><summary>Full summary, coverage & review details</summary><p>{row.report?.summary}</p><p>{row.report?.coverage || "Coverage was not recorded."}</p><ul>{row.report?.limitations?.map((l, i) => <li key={i}>{l}</li>)}</ul><p>{row.model} · {new Date(row.created_at).toISOString()}<br/>Job {row.job_id}</p><p>One automatic attempt per generation. Flags do not trigger regeneration or change human approval.</p></details>
    </div>
  </details>;
}

export function QaReviewList({ rows, queue = false }: { rows: QaRow[]; queue?: boolean }) {
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const filtered = rows.filter((r) => (sourceFilter === "all" || r.source === sourceFilter) && `${r.title ?? ""} ${r.job_id} ${r.report?.summary ?? ""} ${r.report?.findings?.map((f) => f.feature).join(" ") ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    {queue && <><div className={styles.stats}><span><strong>{rows.length}</strong> flagged or incomplete</span><span><strong>{rows.filter((r) => r.report?.findings?.some((f) => f.severity === "major")).length}</strong> with major findings</span></div><div className={styles.toolbar}><input type="search" aria-label="Search QA queue" placeholder="Search case, recording or finding…" value={query} onChange={(e) => setQuery(e.target.value)}/><select aria-label="Generation source" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}><option value="all">All sources</option><option value="lab">EEG Lab</option><option value="qbank">Question bank</option></select>{(query || sourceFilter !== "all") && <button onClick={() => {setQuery("");setSourceFilter("all");}}>Clear filters</button>}</div><p className={styles.hint} role="status">{filtered.length} shown · select a report to inspect evidence and recommendations</p></>}
    {filtered.map((r) => <QaReview key={r.id} row={r} open={!queue}/>)}
    {!filtered.length && <div className={styles.empty}><h3>{rows.length ? "No matching reviews" : queue ? "No flagged reviews" : "No recorded visual QA"}</h3><p>{rows.length ? "Try another term or clear the source filter." : queue ? "No unresolved reports were returned. This queue is not a record of clinical approval." : "This generation has no saved AI assessment; review the EEG in the editor."}</p></div>}
  </>;
}

export default function EegVisualQa({ source, jobId }: { source?: "qbank" | "lab"; jobId?: string }) {
  const [rows, setRows] = useState<QaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true); setErrors([]);
      const loaded: QaRow[] = [], failed: string[] = [];
      const db = getSupabase();
      const session = db ? (await db.auth.getSession()).data.session : null;
      await Promise.all((source ? [source] : ["qbank", "lab"]).map(async (kind) => {
        try {
          const res = await fetch(`/api/admin/eeg-qa?source=${kind}${jobId ? `&jobId=${encodeURIComponent(jobId)}` : ""}`, {headers: {Authorization: `Bearer ${session?.access_token ?? ""}`}});
          if (!res.ok) throw new Error("unavailable");
          loaded.push(...(await res.json()).reviews);
        } catch { failed.push(`${kind === "lab" ? "EEG Lab" : "Question bank"} QA could not be loaded. Refresh to try again.`); }
      }));
      if (active) {setRows(loaded.sort((a, b) => b.created_at.localeCompare(a.created_at)));setErrors(failed);setLoading(false);}
    })().catch(() => {if(active) {setErrors(["QA could not be loaded. Refresh to try again."]);setLoading(false);}});
    return () => {active = false;};
  }, [source, jobId, refresh]);
  return <section className={jobId ? styles.inline : undefined} aria-label="AI visual QA">
    {jobId && <h2>AI visual QA</h2>}
    <div className={styles.toolbar}><button disabled={loading} onClick={() => setRefresh((n) => n + 1)}>{loading ? "Loading QA…" : "Refresh QA"}</button><span className={styles.hint}>{jobId ? "Advisory screen · human review required" : "Latest 100 unresolved reports per source"}</span></div>
    {errors.map((error) => <p className={styles.error} role="alert" key={error}>{error}</p>)}
    {!loading && (!errors.length || rows.length > 0) && <QaReviewList rows={rows} queue={!jobId}/>}
  </section>;
}
