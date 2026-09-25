"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";
type QaRow = { id: string; job_id: string; review_url: string; status: string; created_at: string; model: string; report: { summary?: string; coverage?: string; evidence_urls?: string[]; limitations?: string[]; suggested_prompt?: string; findings?: { feature: string; evidence: string; recommendation: string; severity: string }[] } | null };
export default function EegVisualQa({ source, jobId }: { source: "qbank" | "lab"; jobId?: string }) {
  const [rows, setRows] = useState<QaRow[]>([]);
  const [state, setState] = useState("Loading visual QA…");
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const db = getSupabase();
        if (!db) throw new Error("QA unavailable");
        const { data } = await db.auth.getSession();
        const res = await fetch(`/api/admin/eeg-qa?source=${source}${jobId ? `&jobId=${encodeURIComponent(jobId)}` : ""}`, { headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` } });
        if (!res.ok) throw new Error("QA unavailable");
        const body = await res.json();
        if (active) { setRows(body.reviews); setState(body.reviews.length ? "" : "No recorded visual QA. This is not a pass."); }
      } catch { if (active) { setRows([]); setState("Visual QA unavailable. This is not a pass."); } }
    })();
    return () => { active = false; };
  }, [source, jobId]);
  return <section style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 16, margin: "16px 0" }}>
    <h2>AI visual QA · {source}</h2>
    <p>Advisory review before human sign-off. One automatic attempt per generation; unresolved findings do not trigger regeneration.</p>
    {state && <p>{state}</p>}
    {rows.map((r) => <article key={r.id} style={{ borderTop:"1px solid var(--border)", padding:"16px 0" }}>
      <p><Link href={r.review_url}>Open {source === "lab" ? "recording" : "question-bank"} review</Link> · job {r.job_id}</p>
      <strong>{r.status === "pass" ? "AI screen passed · human review required" : r.status === "running" ? "Incomplete / running · not passed" : "Flagged for review"}</strong>
      <p>{r.report?.summary}</p><p>{r.report?.coverage}</p>
      {r.report?.evidence_urls?.map((url,i)=><p key={url}><a href={url} target="_blank" rel="noreferrer">QA evidence {i+1}</a></p>)}
      <ul>{r.report?.findings?.map((f, i) => <li key={i}><b>{f.feature} ({f.severity})</b>: {f.evidence}<br/>{f.recommendation}</li>)}{r.report?.limitations?.map((l, i) => <li key={`l${i}`}>{l}</li>)}</ul>
      {r.report?.suggested_prompt && <details><summary>Suggested prompt refinement</summary><p style={{ whiteSpace: "pre-wrap" }}>{r.report.suggested_prompt}</p></details>}
      <small>{r.model} · {r.created_at}</small>
    </article>)}
  </section>;
}
