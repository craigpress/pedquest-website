"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRole } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import LabViewer, { type ViewerSource } from "@/components/lab/LabViewer";
import trials from "@/data/eeg-muscle-review.json";
import { adminShellWide, h1 } from "@/lib/admin-ui";

export default function MuscleReviewPage() {
  const { isEditor, loading: roleLoading } = useRole();
  const [selected, setSelected] = useState(trials[0].id);
  const [source, setSource] = useState<ViewerSource | null>(null);
  const [opening, setOpening] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const trial = trials.find((item) => item.id === selected)!;

  useEffect(() => {
    if (roleLoading || !isEditor) return;
    const controller = new AbortController();
    async function open() {
      setOpening(true);
      setError(null);
      try {
        const token = (await getSupabase()?.auth.getSession())?.data.session?.access_token;
        const res = await fetch(`/api/admin/lab/muscle-review?recording=${encodeURIComponent(trial.id)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: controller.signal,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Could not open this recording.");
        const recording = await fetch(json.url, { signal: controller.signal });
        if (!recording.ok) throw new Error("Could not download this recording.");
        const file = new File([await recording.blob()], trial.file, {
          type: "application/octet-stream",
          // The viewer keys local annotations and trends on name, size and lastModified.
          lastModified: Number.parseInt(trial.sha256.slice(0, 12), 16),
        });
        if (!controller.signal.aborted) setSource({ kind: "file", files: [file] });
      } catch (err) {
        if (!controller.signal.aborted) {
          setSource(null);
          setError(err instanceof Error ? err.message : "Could not open this recording.");
        }
      } finally {
        if (!controller.signal.aborted) setOpening(false);
      }
    }
    void open();
    return () => controller.abort();
  }, [trial, isEditor, roleLoading]);

  if (roleLoading) return <div style={adminShellWide}>Loading…</div>;
  if (!isEditor) return <div style={adminShellWide}>
    <h1 style={h1}>EEG muscle comparison</h1>
    <p>Sign in with your PedQuEST editor account to review these experimental recordings.</p>
    <Link href="/login">Sign in</Link>
  </div>;

  return <div style={{ ...adminShellWide, maxWidth: "none", paddingTop: 16 }}>
    <style>{`.muscle-review-viewer { height: calc(100dvh - 320px); min-height: 560px; } @media (max-width: 900px) { .muscle-review-viewer { height: auto; min-height: 0; } }`}</style>
    <h1 style={{ ...h1, fontSize: 24 }}>EEG muscle comparison</h1>
    <p style={{ color: "var(--text-muted)", margin: "8px 0" }}>Experimental synthetic recordings · 3 minutes each · renderer changes pending review</p>
    <label style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      Recording
      <select value={selected} disabled={opening} onChange={(event) => setSelected(event.target.value)}
        style={{ minHeight: 40, maxWidth: "100%", padding: "6px 10px", color: "var(--text-primary)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6 }}>
        {trials.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
    </label>
    <p style={{ color: "var(--text-secondary)", margin: "10px 0" }}>{trial.description}</p>
    <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "8px 0 14px" }}>Compare at 7 µV/mm, 20 seconds/page and 70 Hz low-pass, then average reference and 35 Hz low-pass. Recheck the montage after each recording opens. Candidate settings are engineering trials, not validated clinical ranges.</p>
    {opening && <p role="status">Opening recording…</p>}
    {error && <p role="alert">{error}</p>}
    {source && <div className="muscle-review-viewer" aria-busy={opening} style={{ opacity: opening ? 0.4 : 1, pointerEvents: opening ? "none" : "auto" }}>
      <LabViewer source={source} />
    </div>}
  </div>;
}
