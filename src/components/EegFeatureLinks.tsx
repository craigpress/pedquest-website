"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { matchEegFeatures } from "@/lib/eeg-reference";

export default function EegFeatureLinks({ text, tags = [], source, resourceId }: { text: string; tags?: string[]; source?: "lab" | "qbank"; resourceId?: string }) {
  const [corrections, setCorrections] = useState<Record<string,string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function headers() {
    const session = await getSupabase()?.auth.getSession();
    return { Authorization: `Bearer ${session?.data.session?.access_token ?? ""}`, "Content-Type":"application/json" };
  }
  useEffect(() => {
    let active = true;
    if (source && resourceId) (async () => {
      try {
        const res = await fetch(`/api/admin/eeg-features?source=${source}&id=${resourceId}`, { headers: await headers() });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (active) { setCorrections(Object.fromEntries(data.corrections.map((c: {feature_id:string;disposition:string})=>[c.feature_id,c.disposition]))); setError(""); }
      } catch { if (active) setError("Saved feature corrections unavailable."); }
    })();
    return () => { active = false; };
  }, [source,resourceId]);
  async function correct(featureId:string, disposition:string) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/eeg-features", { method:"POST", headers:await headers(), body:JSON.stringify({source,id:resourceId,featureId,disposition}) });
      if (!res.ok) throw new Error();
      setCorrections((old)=>({...old,[featureId]:disposition === "reset" ? "" : disposition})); setError("");
    } catch { setError("Correction was not saved."); } finally { setBusy(false); }
  }
  const matches = matchEegFeatures(text, tags);
  return <aside style={{ padding: 16, border: "1px solid var(--border)", borderRadius: 10, margin: "16px 0" }}>
    <Link href="/education/eeg-reference" target="_blank">EEG and qEEG definitions, criteria and examples ↗</Link>
    {error && <p role="status">{error}</p>}
    {matches.length > 0 && <><p style={{ fontSize: 13 }}>Automatic concept tags identify mentions, not visually verified findings. Editor corrections are saved separately.</p><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{matches.map((m) => <span key={m.id} style={{ padding: "4px 8px", border: "1px solid var(--border)", borderRadius: 12, opacity:corrections[m.id]==="dismissed" ? .6 : 1 }}><Link href={`/education/eeg-reference/${m.id}`} target="_blank">{m.term} · {(corrections[m.id] || m.basis).replaceAll("_", " ")}</Link>{source && resourceId && <select aria-label={`Correct ${m.term} tag`} disabled={busy} value={corrections[m.id] || "reset"} onChange={(e)=>correct(m.id,e.target.value)}><option value="reset">Automatic</option><option value="confirmed_mention">Confirm mention</option><option value="dismissed">Dismiss match</option></select>}</span>)}</div></>}
  </aside>;
}
