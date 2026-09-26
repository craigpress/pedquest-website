"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { btnGhost, btnPrimary, card, fieldLabel, inp, meta, mini } from "@/lib/admin-ui";
import { ANNOTATION_REGIONS, REGION_LABELS, formatClock, type AnnotationRegion } from "@/lib/eeg/annotations";
import type { KeyEvent } from "@/lib/lab/scoring";
import type { AnswerOverrideHistory } from "@/lib/lab/answer-overrides";

interface Payload {
  key: KeyEvent[];
  history: AnswerOverrideHistory[];
  canEdit: boolean;
  originalArtifact: string;
  generation: string;
}

interface Draft {
  id: string | null;
  kind: string;
  onsetS: number;
  offsetS: number;
  region: AnnotationRegion | null;
  channels: string;
  label: string;
  note: string;
}

const emptyDraft = (): Draft => ({ id: null, kind: "seizure", onsetS: 0, offsetS: 0, region: null, channels: "", label: "", note: "" });

export default function AnswerKeyEditor({ jobId, durationS }: { jobId: string; durationS: number }) {
  const [data, setData] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ action: "remove"; event: KeyEvent } | { action: "reset" } | null>(null);

  const headers = useCallback(async () => {
    const sb = getSupabase();
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : null;
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/lab/jobs/${jobId}/answer-key`, { headers: await headers(), cache: "no-store" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Could not load the answer key.");
    setData(json as Payload);
  }, [jobId, headers]);

  useEffect(() => { void load().catch((e: Error) => setError(e.message)); }, [load]);

  async function mutate(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/admin/lab/jobs/${jobId}/answer-key`, {
        method: "POST", headers: await headers(), body: JSON.stringify({ ...body, expectedGeneration: data?.generation }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not save the answer key.");
      setDraft(null);
      setConfirmAction(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the answer key.");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <section style={{ ...card, padding: 16 }}><div style={fieldLabel}>Answer key</div><p style={meta}>{error ?? "Loading…"}</p></section>;
  const activeHistory = data.history.filter((h) => h.activeArtifact);
  const activeChanges = activeHistory.slice(0, activeHistory.findIndex((h) => h.action === "reset") < 0
    ? activeHistory.length
    : activeHistory.findIndex((h) => h.action === "reset")).length;

  return (
    <section style={{ ...card, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
        <div>
          <div style={fieldLabel}>Answer key · editor overrides</div>
          <p style={{ ...meta, marginTop: 6 }}>
            The rendered manifest stays unchanged. Results, course grades and the viewer use this merged key immediately.
          </p>
        </div>
        <button type="button" style={btnPrimary} disabled={busy || !!draft} onClick={() => setDraft(emptyDraft())}>Add event</button>
      </div>
      <p style={{ ...meta, marginTop: 8, color: "var(--accent-secondary)" }}>
        Re-rendering or replacing the answers artifact starts from the new rendered key and does not carry these active overrides. The audit history remains.
      </p>
      {error && <p role="alert" style={{ color: "var(--accent-secondary)", fontSize: 13 }}>{error}</p>}

      {draft && (
        <form onSubmit={(e) => {
          e.preventDefault();
          void mutate({
            action: draft.id ? "update" : "add", eventId: draft.id,
            event: {
              kind: draft.kind, onsetS: draft.onsetS, offsetS: draft.offsetS,
              region: draft.region, channels: draft.channels.split(",").map((s) => s.trim()).filter(Boolean),
              label: draft.label,
            },
            note: draft.note,
          });
        }} style={{ marginTop: 14, padding: 12, border: "1px solid var(--border-strong)", borderRadius: 10, display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <label><span style={fieldLabel}>Kind</span><input style={inp} value={draft.kind} maxLength={64} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} /></label>
            <label><span style={fieldLabel}>Onset (s)</span><input style={inp} type="number" min={0} max={durationS} step={0.1} value={draft.onsetS} onChange={(e) => setDraft({ ...draft, onsetS: Number(e.target.value) })} /></label>
            <label><span style={fieldLabel}>Offset (s)</span><input style={inp} type="number" min={0} max={durationS} step={0.1} value={draft.offsetS} onChange={(e) => setDraft({ ...draft, offsetS: Number(e.target.value) })} /></label>
            <label><span style={fieldLabel}>Region</span><select style={inp} value={draft.region ?? ""} onChange={(e) => setDraft({ ...draft, region: (e.target.value || null) as AnnotationRegion | null })}><option value="">Not stated</option>{ANNOTATION_REGIONS.map((r) => <option key={r} value={r}>{REGION_LABELS[r]}</option>)}</select></label>
          </div>
          <label><span style={fieldLabel}>Channels</span><input style={inp} value={draft.channels} placeholder="C4, C4-P4" onChange={(e) => setDraft({ ...draft, channels: e.target.value })} /></label>
          <label><span style={fieldLabel}>Label</span><input style={inp} value={draft.label} maxLength={160} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></label>
          <label><span style={fieldLabel}>Audit note</span><input style={inp} value={draft.note} maxLength={1000} placeholder="Why this correction was made" onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" style={btnGhost} onClick={() => setDraft(null)} disabled={busy}>Cancel</button><button type="submit" style={btnPrimary} disabled={busy}>{draft.id ? "Save change" : "Add to key"}</button></div>
        </form>
      )}

      <div style={{ display: "grid", gap: 6, marginTop: 14 }}>
        {data.key.length === 0 && <p style={meta}>No events in the merged key.</p>}
        {data.key.map((event) => (
          <div key={event.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, padding: "9px 10px", border: "1px solid var(--border)", borderRadius: 8 }}>
            <div>
              <div style={{ fontSize: 13.5, color: "var(--text)" }}><b>{event.label || event.kind}</b> · {formatClock(event.onsetS)}–{formatClock(event.offsetS)}</div>
              <div style={meta}>{event.kind}{event.region ? ` · ${REGION_LABELS[event.region]}` : ""}{event.channels.length ? ` · ${event.channels.join(", ")}` : ""}</div>
            </div>
            <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
              <button type="button" style={mini} disabled={busy || !!draft} onClick={() => setDraft({ id: event.id, kind: event.kind, onsetS: event.onsetS, offsetS: event.offsetS, region: event.region, channels: event.channels.join(", "), label: event.label, note: "" })}>edit</button>
              <button type="button" style={{ ...mini, color: "var(--accent-secondary)" }} disabled={busy || !!draft || !!confirmAction} onClick={() => setConfirmAction({ action: "remove", event })}>remove</button>
            </div>
          </div>
        ))}
      </div>

      {confirmAction && (
        <div role="alertdialog" aria-labelledby="answer-key-confirm-title" style={{ marginTop: 14, padding: 12, border: "1px solid var(--accent-secondary)", borderRadius: 8 }}>
          <div id="answer-key-confirm-title" style={{ color: "var(--text)", fontWeight: 600 }}>
            {confirmAction.action === "remove"
              ? `Remove ${confirmAction.event.label || confirmAction.event.kind} from the merged key?`
              : "Reset every active answer-key override?"}
          </div>
          <p style={{ ...meta, marginTop: 5 }}>
            {confirmAction.action === "reset" ? "The rendered manifest becomes the active key again. Audit history is retained." : "The original rendered manifest remains unchanged."}
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" style={btnGhost} disabled={busy} onClick={() => setConfirmAction(null)}>Cancel</button>
            <button type="button" style={{ ...btnPrimary, background: "var(--accent-secondary)" }} disabled={busy} onClick={() => void mutate(confirmAction.action === "remove"
              ? { action: "remove", eventId: confirmAction.event.id, note: "Removed from recording-page editor" }
              : { action: "reset", confirmReset: true, note: "Reset to rendered answer key" })}>
              {confirmAction.action === "remove" ? "Remove event" : "Reset overrides"}
            </button>
          </div>
        </div>
      )}

      {activeChanges > 0 && <button type="button" style={{ ...btnGhost, color: "var(--accent-secondary)", marginTop: 14 }} disabled={busy || !!draft || !!confirmAction} onClick={() => setConfirmAction({ action: "reset" })}>Reset active overrides</button>}

      <details style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer", color: "var(--text-secondary)", fontSize: 13 }}>Audit history ({data.history.length})</summary>
        <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
          {data.history.length === 0 && <span style={meta}>No answer-key edits yet.</span>}
          {data.history.map((h) => <div key={h.id} style={{ ...meta, borderLeft: `3px solid ${h.activeArtifact ? "var(--accent-primary)" : "var(--border)"}`, paddingLeft: 9 }}><b>{h.action}</b>{h.event ? ` · ${h.event.label || h.event.kind} at ${formatClock(h.event.onsetS)}` : ""} · {h.editedByEmail} · {new Date(h.createdAt).toLocaleString()}{h.note ? ` · ${h.note}` : ""}{!h.activeArtifact ? " · earlier artifact" : ""}</div>)}
        </div>
      </details>
    </section>
  );
}
