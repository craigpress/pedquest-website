"use client";

/**
 * EEG review queue — where an editor finds recordings waiting on them: what
 * authors have submitted, legacy recordings published at migration without a
 * review, and (for the author) their own drafts and what came back with
 * changes requested. Each row opens either the recording page (title,
 * description, the authored findings, and the review action) or the viewer.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRole } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { adminShellWide, btnGhost, card, eyebrow, fieldLabel, h1, inp, meta, mini } from "@/lib/admin-ui";
import { displayTitle, humanDuration, labelize, type LibraryEntry, type LibraryFacets } from "@/lib/lab/library";

type Tab = "pending_review" | "legacy" | "mine";

const TABS: { id: Tab; label: string }[] = [
  { id: "pending_review", label: "Awaiting review" },
  { id: "legacy", label: "Legacy · not yet reviewed" },
  { id: "mine", label: "My recordings" },
];

const EMPTY_STATE: Record<Tab, string> = {
  pending_review: "Nothing is waiting for review.",
  legacy: "No legacy recordings left unreviewed.",
  mine: "You have no drafts or submitted recordings.",
};

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

export default function EegReviewQueuePage() {
  const { isEditor, loading: roleLoading } = useRole();
  const [tab, setTab] = useState<Tab>("pending_review");
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [facets, setFacets] = useState<LibraryFacets | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-row "Revise with AI": which row is open, its note, and the outcome.
  const [reviseOpen, setReviseOpen] = useState<string | null>(null);
  const [reviseNotes, setReviseNotes] = useState("");
  const [reviseBusy, setReviseBusy] = useState<string | null>(null);
  const [reviseResult, setReviseResult] = useState<Record<string, { ok: boolean; message: string; newJobId?: string }>>({});

  const authHeaders = useCallback(async () => {
    const sb = getSupabase();
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : null;
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }, []);

  /** POST revise: the model edits the spec from the note and a new export is
   *  queued as this editor's draft; the recording in the queue is untouched. */
  async function reviseWithAi(jobId: string) {
    const feedback = reviseNotes.trim();
    if (!feedback) return;
    setReviseBusy(jobId);
    try {
      const res = await fetch(`/api/admin/lab/jobs/${jobId}/review`, {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ action: "revise", feedback }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setReviseResult((m) => ({ ...m, [jobId]: { ok: false, message: json.error || "The AI revision failed — nothing was queued." } }));
        return;
      }
      setReviseResult((m) => ({
        ...m,
        [jobId]: { ok: true, message: `Revised export queued as ${json.job.recordingId ?? json.job.id}.`, newJobId: json.job.id as string },
      }));
      setReviseOpen(null);
      setReviseNotes("");
    } catch {
      setReviseResult((m) => ({ ...m, [jobId]: { ok: false, message: "Network error during the AI revision." } }));
    } finally {
      setReviseBusy(null);
    }
  }

  useEffect(() => {
    if (!isEditor) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/lab/library?review=${tab}`, { headers: await authHeaders() });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json.success) {
          setError(json.error || "Could not load the review queue.");
        } else {
          setError(null);
          setEntries(json.entries as LibraryEntry[]);
          setFacets(json.facets as LibraryFacets);
        }
      } catch {
        if (!cancelled) setError("Could not reach the review queue.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isEditor, tab, authHeaders]);

  const counts = useMemo(() => ({
    pending_review: facets?.review?.pending_review ?? 0,
    legacy: facets?.review?.legacy ?? 0,
    mine: facets?.review?.mine ?? 0,
  }), [facets]);

  if (roleLoading) {
    return <div style={adminShellWide}><p style={{ color: "var(--text-muted)" }}>Loading…</p></div>;
  }
  if (!isEditor) {
    return (
      <div style={adminShellWide}>
        <h1 style={h1}>Editors only</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: 10 }}>
          The EEG review queue is available to editors. <Link href="/admin/eeg-lab/library">Back to the library</Link>.
        </p>
      </div>
    );
  }

  return (
    <div style={adminShellWide}>
      <style>{`
        .rq-row { border-top: 1px solid var(--border); padding: 14px 0; display: flex; flex-direction: column; gap: 8px; }
        .rq-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
        .rq-title { color: var(--text); font-weight: 600; font-size: 15px; }
        .rq-chips { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .rq-chip { font-family: var(--mono-font); font-size: 11.5px; padding: 2px 8px; border-radius: 999px;
          border: 1px solid var(--border); color: var(--text-secondary); white-space: nowrap; }
        .rq-chip.bank { border-color: var(--accent-primary); color: var(--accent-primary); font-weight: 700; }
        .rq-tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
      `}</style>

      <div style={{ marginBottom: 18 }}>
        <span style={eyebrow}>EEG Teaching Lab</span>
        <h1 style={{ ...h1, marginTop: 6 }}>EEG review queue</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: 8, maxWidth: "68ch", lineHeight: 1.6 }}>
          Recordings an author submitted, legacy recordings published without a review, and your own drafts.
        </p>
      </div>

      <div className="rq-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            style={{
              ...mini,
              borderColor: tab === t.id ? "var(--accent-primary)" : "var(--border)",
              color: tab === t.id ? "var(--accent-primary)" : "var(--text-secondary)",
              fontWeight: tab === t.id ? 700 : 500,
            }}
          >
            {t.label} · {counts[t.id]}
          </button>
        ))}
      </div>

      <section style={{ ...card, padding: "4px 18px 18px" }}>
        {error && <p style={{ color: "var(--accent-secondary)", marginTop: 14 }}>{error}</p>}
        {!loading && !error && entries.length === 0 && (
          <p style={{ ...meta, marginTop: 14 }}>{EMPTY_STATE[tab]}</p>
        )}
        {entries.map((e) => {
          const s = e.summary;
          const qn = e.question;
          return (
            <div className="rq-row" key={e.jobId}>
              <div className="rq-head">
                <div className="rq-chips">
                  {qn && <span className="rq-chip bank">{qn.qbankId}</span>}
                  <span className="rq-title">{displayTitle(e)}</span>
                </div>
                <span style={meta}>{e.recordingId ?? e.jobId.slice(0, 8)} · {shortDate(e.submittedAt ?? e.createdAt)}</span>
              </div>
              <div className="rq-chips">
                <span className="rq-chip">{labelize(s.kind)}</span>
                {s.ageGroup && <span className="rq-chip">{s.ageGroup}</span>}
                <span className="rq-chip">{humanDuration(e.durationS)}</span>
                {e.authorship === "ai" ? (
                  <span className="rq-chip">AI generated</span>
                ) : e.authorEmail ? (
                  <span style={meta}>{e.authorEmail}</span>
                ) : null}
              </div>
              <div className="rq-chips">
                <Link
                  href={`/admin/eeg-lab/library/${e.jobId}`}
                  style={{ ...mini, borderColor: "var(--accent-primary)", color: "var(--accent-primary)" }}
                >
                  Review
                </Link>
                <Link href={`/admin/eeg-lab/viewer?job=${e.jobId}`} style={mini}>Open in viewer</Link>
                <button
                  type="button"
                  style={mini}
                  disabled={reviseBusy !== null}
                  onClick={() => {
                    setReviseOpen(reviseOpen === e.jobId ? null : e.jobId);
                    setReviseNotes("");
                  }}
                >
                  {reviseOpen === e.jobId ? "Cancel" : "Revise with AI"}
                </button>
              </div>
              {reviseOpen === e.jobId && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: "72ch" }}>
                  <label htmlFor={`rq-revise-${e.jobId}`} style={fieldLabel}>
                    What should change in the EEG — the model edits the spec and queues a revised export as your draft
                  </label>
                  <textarea
                    id={`rq-revise-${e.jobId}`}
                    value={reviseNotes}
                    onChange={(ev) => setReviseNotes(ev.target.value)}
                    rows={3}
                    style={{ ...inp, resize: "vertical" }}
                    placeholder="e.g. the posterior temporal chain mirrors bilaterally; make the asymmetry hold from 5 h onward"
                  />
                  <div>
                    <button
                      type="button"
                      style={{ ...mini, borderColor: "var(--accent-primary)", color: "var(--accent-primary)" }}
                      disabled={reviseBusy !== null || !reviseNotes.trim()}
                      onClick={() => void reviseWithAi(e.jobId)}
                    >
                      {reviseBusy === e.jobId ? "Revising — this takes a minute…" : "Send to the model"}
                    </button>
                  </div>
                </div>
              )}
              {reviseResult[e.jobId] && (
                <p style={{ ...meta, color: reviseResult[e.jobId].ok ? "var(--text-secondary)" : "var(--accent-secondary)", whiteSpace: "pre-wrap" }}>
                  {reviseResult[e.jobId].message}
                  {reviseResult[e.jobId].newJobId && (
                    <>{" "}<Link href={`/admin/eeg-lab/library/${reviseResult[e.jobId].newJobId}`}>Open the new draft</Link>.</>
                  )}
                </p>
              )}
            </div>
          );
        })}
      </section>

      <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link href="/admin/eeg-lab/library" style={btnGhost}>EEG Library</Link>
        <Link href="/admin/eeg-lab" style={btnGhost}>Lab console</Link>
      </div>
    </div>
  );
}
