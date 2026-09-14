"use client";

// Annotation list + editor beside the panes. The parent owns the rows and the
// store; this component only renders and raises intents.

import { useEffect, useState } from "react";
import { btnGhost, btnPrimary, fieldLabel, inp, mini } from "@/lib/admin-ui";
import {
  ANNOTATION_KINDS, ANNOTATION_REGIONS, REGION_LABELS, annotationColor, describeTarget, formatClock,
  type AnnotationRegion, type AnnotationTarget,
  type ViewerAnnotation, type ViewerAnnotationInput, type ViewerAnnotationKind,
} from "@/lib/eeg/annotations";
import { trendRowLabel } from "./TrendStrip";

export interface Draft extends AnnotationTarget {
  id: string | null; onsetS: number; durationS: number; kind: ViewerAnnotationKind; label: string; note: string;
}

export default function AnnotationPanel({
  annotations, draft, storeLabel, busy, trendRows, channelOptions,
  onDraftChange, onSave, onCancel, onDelete, onJump, onExport,
}: {
  annotations: ViewerAnnotation[];
  draft: Draft | null;
  storeLabel: string;
  busy: boolean;
  /** rows currently in the strip, for the trend-row select */
  trendRows: { id: string; label: string }[];
  /** recording labels ∪ derivation labels, offered as chips under the channels field */
  channelOptions: string[];
  onDraftChange: (d: Draft) => void;
  onSave: (input: ViewerAnnotationInput, id: string | null) => void;
  onCancel: () => void;
  onDelete: (id: string) => void;
  onJump: (a: ViewerAnnotation) => void;
  onExport: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "mine">("all");
  const others = annotations.some((a) => !a.mine);
  useEffect(() => { if (!others) setFilter("all"); }, [others]);

  // The channels field keeps the raw text while it is being typed, so a
  // trailing comma survives; it falls back to the draft's own list whenever a
  // different mark opens (the key changes) — no effect needed to resync.
  const [typed, setTyped] = useState<{ key: string; text: string } | null>(null);
  const draftKey = draft ? `${draft.id ?? "new"}:${draft.onsetS}` : "";
  const channelText = typed?.key === draftKey ? typed.text : (draft?.channels.join(", ") ?? "");
  const setChannels = (list: string[]) => {
    if (!draft) return;
    setTyped({ key: draftKey, text: list.join(", ") });
    onDraftChange({ ...draft, channels: list });
  };
  const shown = annotations
    .filter((a) => filter === "all" || a.mine)
    .slice()
    .sort((a, b) => a.onsetS - b.onsetS);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <div>
          <div style={{ fontWeight: 600, color: "var(--text)" }}>Annotations</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>saved to {storeLabel}</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {others && (
            <button type="button" style={mini} onClick={() => setFilter(filter === "all" ? "mine" : "all")}>
              {filter === "all" ? "everyone" : "mine only"}
            </button>
          )}
          <button type="button" style={mini} onClick={onExport} disabled={!annotations.length}>export</button>
        </div>
      </div>

      {draft && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave({
              onsetS: draft.onsetS, durationS: draft.durationS, kind: draft.kind, label: draft.label, note: draft.note,
              pane: draft.pane, trendRow: draft.pane === "trend" ? draft.trendRow : null,
              channels: draft.channels, region: draft.region,
            }, draft.id);
          }}
          style={{ border: "1px solid var(--border-strong)", borderRadius: 10, padding: 12, display: "grid", gap: 10, background: "var(--bg)" }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <label>
              <span style={fieldLabel}>Onset (s)</span>
              <input type="number" step={0.1} min={0} value={round1(draft.onsetS)} style={inp}
                onChange={(e) => onDraftChange({ ...draft, onsetS: Number(e.target.value) })} />
            </label>
            <label>
              <span style={fieldLabel}>Duration (s)</span>
              <input type="number" step={0.1} min={0} value={round1(draft.durationS)} style={inp}
                onChange={(e) => onDraftChange({ ...draft, durationS: Number(e.target.value) })} />
            </label>
          </div>
          <label>
            <span style={fieldLabel}>Kind</span>
            <select value={draft.kind} style={inp} onChange={(e) => onDraftChange({ ...draft, kind: e.target.value as ViewerAnnotationKind })}>
              {ANNOTATION_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </label>
          <div style={{ display: "grid", gridTemplateColumns: draft.pane === "trend" ? "1fr 1fr" : "1fr", gap: 8 }}>
            <label>
              <span style={fieldLabel}>Pane</span>
              <select value={draft.pane} style={inp}
                onChange={(e) => onDraftChange({ ...draft, pane: e.target.value === "trend" ? "trend" : "raw", trendRow: null })}>
                <option value="raw">Raw EEG</option>
                <option value="trend">Trend</option>
              </select>
            </label>
            {draft.pane === "trend" && (
              <label>
                <span style={fieldLabel}>Trend row</span>
                <select value={draft.trendRow ?? ""} style={inp}
                  onChange={(e) => onDraftChange({ ...draft, trendRow: e.target.value || null })}>
                  <option value="">Not stated</option>
                  {trendRows.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </label>
            )}
          </div>
          <label>
            <span style={fieldLabel}>Channels</span>
            <input value={channelText} style={inp} placeholder="e.g. C4 or C4-P4"
              onChange={(e) => { setTyped({ key: draftKey, text: e.target.value }); onDraftChange({ ...draft, channels: splitChannels(e.target.value) }); }} />
          </label>
          {channelOptions.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: -4 }}>
              {channelOptions.map((c) => {
                const on = draft.channels.includes(c);
                return (
                  <button key={c} type="button"
                    style={{ ...mini, borderColor: on ? "var(--accent-primary)" : "var(--border)", color: on ? "var(--accent-primary)" : "var(--text-secondary)" }}
                    onClick={() => setChannels(on ? draft.channels.filter((x) => x !== c) : [...draft.channels, c])}>
                    {c}
                  </button>
                );
              })}
            </div>
          )}
          <label>
            <span style={fieldLabel}>Region</span>
            <select value={draft.region ?? ""} style={inp}
              onChange={(e) => onDraftChange({ ...draft, region: (e.target.value || null) as AnnotationRegion | null })}>
              <option value="">Not stated</option>
              {ANNOTATION_REGIONS.map((r) => <option key={r} value={r}>{REGION_LABELS[r]}</option>)}
            </select>
          </label>
          <label>
            <span style={fieldLabel}>Label</span>
            <input value={draft.label} style={inp} maxLength={120} placeholder="e.g. rhythmic theta, L temporal"
              onChange={(e) => onDraftChange({ ...draft, label: e.target.value })} autoFocus />
          </label>
          <label>
            <span style={fieldLabel}>Note</span>
            <textarea value={draft.note} style={{ ...inp, minHeight: 56, resize: "vertical" }} maxLength={2000}
              onChange={(e) => onDraftChange({ ...draft, note: e.target.value })} />
          </label>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" style={btnGhost} onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="submit" style={btnPrimary} disabled={busy}>{draft.id ? "Save" : "Add"}</button>
          </div>
        </form>
      )}

      {!draft && (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)" }}>
          Click the raw EEG to place a mark, or drag to select a span. Click a trend row to mark on that trend.
          Press <kbd>A</kbd> to annotate at the cursor.
        </p>
      )}

      <div style={{ overflowY: "auto", minHeight: 0, flex: 1, display: "grid", gap: 6, alignContent: "start" }}>
        {shown.length === 0 && <div style={{ fontSize: 13, color: "var(--text-muted)" }}>No annotations yet.</div>}
        {shown.map((a) => (
          <div key={a.id} style={{
            display: "grid", gridTemplateColumns: "4px 1fr auto", gap: 10, alignItems: "start",
            padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)",
          }}>
            <div style={{ background: annotationColor(a.kind), borderRadius: 2, alignSelf: "stretch" }} />
            <button type="button" onClick={() => onJump(a)} style={{ all: "unset", cursor: "pointer", minWidth: 0 }}>
              <div style={{ fontFamily: "var(--mono-font)", fontSize: 12, color: "var(--text-secondary)" }}>
                {formatClock(a.onsetS)}{a.durationS > 0 ? ` – ${formatClock(a.onsetS + a.durationS)}` : ""}
                {describeTarget(a, trendRowLabel) && (
                  <span style={{ marginLeft: 8, color: "var(--text-muted)" }}>{describeTarget(a, trendRowLabel)}</span>
                )}
                {!a.mine && a.authorEmail && <span style={{ marginLeft: 8, color: "var(--text-muted)" }}>{a.authorEmail}</span>}
              </div>
              <div style={{ color: "var(--text)", fontSize: 13.5 }}>{a.label || ANNOTATION_KINDS.find((k) => k.id === a.kind)?.label}</div>
              {a.note && <div style={{ color: "var(--text-muted)", fontSize: 12.5, whiteSpace: "pre-wrap" }}>{a.note}</div>}
            </button>
            {a.mine && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <button type="button" style={mini} onClick={() => onDraftChange({
                  id: a.id, onsetS: a.onsetS, durationS: a.durationS, kind: a.kind, label: a.label, note: a.note,
                  pane: a.pane, trendRow: a.trendRow, channels: a.channels, region: a.region,
                })}>edit</button>
                <button type="button" style={{ ...mini, color: "var(--accent-secondary)" }} onClick={() => onDelete(a.id)}>delete</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function round1(v: number) { return Math.round(v * 10) / 10; }

/** "C4, C4-P4," → ["C4", "C4-P4"]; the server re-validates. */
function splitChannels(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(",")) {
    const s = part.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}
