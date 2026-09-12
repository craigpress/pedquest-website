"use client";

// EEG Lab Viewer — /admin/eeg-lab/viewer[?job=<uuid>]
//
// Without ?job: a file picker for an EDF+ file, or a Persyst .lay + .dat pair
// (an .answers.json alongside is picked up as the answer key). With ?job: opens
// that lab job's recording through signed URLs. Editor-gated like the console.

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRole } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { adminShellWide, btnPrimary, card, eyebrow, h1 } from "@/lib/admin-ui";
import type { LabJob } from "@/lib/lab/types";
import LabViewer, { type ViewerSource } from "@/components/lab/LabViewer";

export default function ViewerPage() {
  return (
    <Suspense fallback={<div style={adminShellWide}><p style={{ color: "var(--text-muted)" }}>Loading…</p></div>}>
      <ViewerInner />
    </Suspense>
  );
}

function ViewerInner() {
  const { isEditor, loading: roleLoading } = useRole();
  const params = useSearchParams();
  const jobId = params.get("job");
  const [source, setSource] = useState<ViewerSource | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);

  const authHeaders = useCallback(async () => {
    const sb = getSupabase();
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : null;
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }, []);

  useEffect(() => {
    if (!jobId || !isEditor) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/admin/lab/jobs/${jobId}`, { headers: await authHeaders() });
      const json = await res.json();
      if (cancelled) return;
      if (!res.ok || !json.job) { setJobError(json.error || "Could not load the job."); return; }
      setSource({ kind: "job", job: json.job as LabJob, authHeaders, isEditor: true });
    })().catch(() => { if (!cancelled) setJobError("Network error loading the job."); });
    return () => { cancelled = true; };
  }, [jobId, isEditor, authHeaders]);

  if (roleLoading) {
    return <div style={adminShellWide}><p style={{ color: "var(--text-muted)" }}>Loading…</p></div>;
  }
  if (!isEditor) {
    return (
      <div style={adminShellWide}>
        <h1 style={h1}>Editor access required</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: 10 }}>
          The EEG Lab Viewer is limited to PedQuEST editors and admins. <Link href="/login">Sign in</Link>.
        </p>
      </div>
    );
  }

  if (source) {
    return (
      <div style={{ padding: "12px 16px 16px", height: "calc(100vh - 112px)", minHeight: 560, boxSizing: "border-box" }}>
        <LabViewer source={source} onClose={() => setSource(null)} />
      </div>
    );
  }

  return (
    <div style={adminShellWide}>
      <div style={eyebrow}>EEG Teaching Lab</div>
      <h1 style={{ ...h1, marginTop: 6 }}>EEG Lab Viewer</h1>
      <p style={{ color: "var(--text-secondary)", marginTop: 8, maxWidth: 640 }}>
        Review a recording in the browser: whole-record qEEG trends, a raw page with montage,
        filters and sensitivity, and your own annotations. Find a finished recording in the{" "}
        <Link href="/admin/eeg-lab/library">EEG Library</Link>, build one in the{" "}
        <Link href="/admin/eeg-lab">console</Link>, or choose a file here.
      </p>
      {jobId && (
        <p style={{ color: "var(--accent-secondary)", marginTop: 8 }}>{jobError ?? "Loading job…"}</p>
      )}
      <div style={{ ...card, padding: 20, marginTop: 20, display: "grid", gap: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ color: "var(--text)", fontWeight: 600 }}>Open from this computer</span>
          <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
            One <code>.edf</code> file, or a Persyst <code>.lay</code> and <code>.dat</code> pair selected together.
            Add the matching <code>.answers.json</code> to overlay the answer key. Nothing is uploaded — the file
            is read in your browser, and annotations are kept in this browser.
          </span>
          <input
            type="file" multiple accept=".edf,.lay,.dat,.json"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) setSource({ kind: "file", files });
            }}
            style={{ marginTop: 6 }}
          />
        </label>
        <div>
          <Link href="/admin/eeg-lab" style={{ ...btnPrimary, display: "inline-block", textDecoration: "none" }}>
            Go to the lab console
          </Link>
        </div>
      </div>
    </div>
  );
}
