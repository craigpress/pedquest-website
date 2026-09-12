"use client";

/**
 * EEG Library — find a finished teaching recording.
 *
 * The lab console (/admin/eeg-lab) is where recordings are built and queued;
 * this page is where they are found afterwards: by question id, by what was
 * authored into them (background, seizures, patterns, artifacts), by age band,
 * by teaching domain, or by any word in the linked question. Every hit opens
 * in the viewer or downloads through the same gated route the console uses.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRole } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { adminShellWide, btnGhost, card, eyebrow, fieldLabel, h1, inp, meta, mini } from "@/lib/admin-ui";
import {
  LAB_ARTIFACT_LABELS, SYNTHETIC_STAMP, isInstructorArtifact, type LabArtifact,
} from "@/lib/lab/types";
import { labelize, type LibraryEntry, type LibraryFacets } from "@/lib/lab/library";

type Filters = {
  kind: string; age: string; background: string; event: string; domain: string; source: string;
};
const EMPTY_FILTERS: Filters = { kind: "", age: "", background: "", event: "", domain: "", source: "" };

function humanDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 90) return `${mins} min`;
  const hours = mins / 60;
  return `${hours % 1 === 0 ? hours : hours.toFixed(1)} h`;
}
function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
function minutes(v: number): string {
  return v % 1 === 0 ? `${v}` : v.toFixed(1);
}

export default function LibraryPage() {
  const { isEditor, loading: roleLoading } = useRole();
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [facets, setFacets] = useState<LibraryFacets | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const authHeaders = useCallback(async () => {
    const sb = getSupabase();
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : null;
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }, []);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    return p.toString();
  }, [q, filters]);

  // Debounced fetch: the search runs server-side over the whole library, and
  // a keystroke every 250 ms is cheap against a few hundred metadata rows.
  useEffect(() => {
    if (!isEditor) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/lab/library${params ? `?${params}` : ""}`, { headers: await authHeaders() });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json.success) {
          setError(json.error || "Could not load the library.");
        } else {
          setError(null);
          setEntries(json.entries as LibraryEntry[]);
          setFacets(json.facets as LibraryFacets);
          setTotal(json.total as number);
        }
      } catch {
        if (!cancelled) setError("Could not reach the library.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [isEditor, params, authHeaders]);

  async function download(entry: LibraryEntry, artifact: LabArtifact) {
    if (isInstructorArtifact(artifact)) {
      const ok = window.confirm(
        `${LAB_ARTIFACT_LABELS[artifact]} is the INSTRUCTOR copy — it carries the ground truth ` +
        "for this recording. Do not hand it to a learner. Download it?",
      );
      if (!ok) return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/admin/lab/jobs/${entry.jobId}/download?artifact=${artifact}`, { headers: await authHeaders() });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || "Could not issue a download link.");
        return;
      }
      window.open(json.url as string, "_blank", "noopener,noreferrer");
    } catch {
      setError("Could not issue a download link.");
    }
  }

  if (roleLoading) {
    return <div style={adminShellWide}><p style={{ color: "var(--text-muted)" }}>Loading…</p></div>;
  }
  if (!isEditor) {
    return (
      <div style={adminShellWide}>
        <h1 style={h1}>Editor access required</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: 10 }}>
          The EEG Library is available to question-bank editors and admins.
        </p>
        <Link href="/admin" style={{ ...btnGhost, display: "inline-block", marginTop: 16, textDecoration: "none" }}>← Admin dashboard</Link>
      </div>
    );
  }

  const activeFilters = Object.values(filters).filter(Boolean).length + (q.trim() ? 1 : 0);

  return (
    <div style={adminShellWide}>
      <style>{`
        .lib-filters { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-top: 12px; }
        .lib-row { border-top: 1px solid var(--border); padding: 14px 0; display: grid; gap: 8px; }
        .lib-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
        .lib-title { color: var(--text); font-weight: 600; font-size: 15px; }
        .lib-chips { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .lib-chip { font-family: var(--mono-font); font-size: 11.5px; padding: 2px 8px; border-radius: 999px;
          border: 1px solid var(--border); color: var(--text-secondary); white-space: nowrap; }
        .lib-chip.bank { border-color: var(--accent-primary); color: var(--accent-primary); font-weight: 700; }
        .lib-findings { display: flex; flex-wrap: wrap; gap: 6px 14px; color: var(--text-secondary); font-size: 13.5px; line-height: 1.5; }
        .lib-findings b { color: var(--text); font-weight: 600; }
        .lib-more { color: var(--text-secondary); font-size: 13.5px; line-height: 1.6; max-width: 80ch; }
        .lib-more ul { margin: 4px 0 0 18px; padding: 0; }
        @media (max-width: 960px) { .lib-filters { grid-template-columns: repeat(3, 1fr); } }
        @media (max-width: 560px) { .lib-filters { grid-template-columns: 1fr 1fr; } }
      `}</style>

      <div style={{ marginBottom: 18 }}>
        <span style={eyebrow}>EEG teaching lab</span>
        <h1 style={{ ...h1, marginTop: 6 }}>EEG Library</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: 8, maxWidth: "68ch", lineHeight: 1.6 }}>
          Every finished teaching recording, searchable by what was authored into it and by the
          question it belongs to. Build new recordings in the{" "}
          <Link href="/admin/eeg-lab">lab console</Link>. All recordings are {SYNTHETIC_STAMP.toLowerCase()}s.
        </p>
      </div>

      <section style={{ ...card, padding: 18 }}>
        <label style={fieldLabel} htmlFor="lib-q">Search</label>
        <input
          id="lib-q"
          style={inp}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Try: burst suppression pentobarbital · PQ-B-010 · left temporal seizure · hypsarrhythmia · neonate BS"
          autoFocus
        />
        <div className="lib-filters">
          <Facet label="Record" value={filters.kind} counts={facets?.kind} onChange={(v) => setFilters((f) => ({ ...f, kind: v }))} />
          <Facet label="Age" value={filters.age} counts={facets?.age} onChange={(v) => setFilters((f) => ({ ...f, age: v }))} />
          <Facet label="Background" value={filters.background} counts={facets?.background} onChange={(v) => setFilters((f) => ({ ...f, background: v }))} />
          <Facet label="Finding" value={filters.event} counts={facets?.event} onChange={(v) => setFilters((f) => ({ ...f, event: v }))} />
          <Facet label="Domain" value={filters.domain} counts={facets?.domain} onChange={(v) => setFilters((f) => ({ ...f, domain: v }))} />
          <Facet label="Source" value={filters.source} counts={facets?.source} labels={{ bank: "Question bank", adhoc: "Ad hoc" }} onChange={(v) => setFilters((f) => ({ ...f, source: v }))} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, gap: 10, flexWrap: "wrap" }}>
          <span style={meta}>
            {loading ? "Searching…" : `${entries.length} of ${total} recording${total === 1 ? "" : "s"}`}
          </span>
          {activeFilters > 0 && (
            <button type="button" style={mini} onClick={() => { setQ(""); setFilters(EMPTY_FILTERS); }}>Clear</button>
          )}
        </div>
        {error && <p style={{ color: "var(--accent-secondary)", marginTop: 8 }}>{error}</p>}
      </section>

      <section style={{ ...card, padding: "4px 18px 18px", marginTop: 16 }}>
        {!loading && entries.length === 0 && (
          <p style={{ ...meta, marginTop: 14 }}>
            {total === 0 ? "No finished recordings yet — the export queue is on the lab console." : "Nothing matches. Loosen a filter or try another word."}
          </p>
        )}
        {entries.map((e) => {
          const s = e.summary;
          const qn = e.question;
          const title = qn?.title ?? (s.kind === "aeeg" ? "aEEG recording" : "Teaching recording");
          const expanded = !!open[e.jobId];
          const hasMore = !!(qn?.learningObjective || qn?.imageCaption || qn?.teachingPoints.length || s.annotations.length);
          return (
            <div className="lib-row" key={e.jobId}>
              <div className="lib-head">
                <div className="lib-chips">
                  {qn && <span className="lib-chip bank">{qn.qbankId}</span>}
                  <span className="lib-title">{title}</span>
                </div>
                <span style={meta}>{e.recordingId ?? e.jobId.slice(0, 8)} · {shortDate(e.createdAt)}</span>
              </div>

              <div className="lib-chips">
                <span className="lib-chip">{labelize(s.kind)}</span>
                {s.ageGroup && <span className="lib-chip">{s.ageGroup}{s.pmaWeeks !== null ? ` · ${s.pmaWeeks} wk PMA` : ""}</span>}
                {s.background && <span className="lib-chip">{labelize(s.background)}</span>}
                {s.aeegPattern && <span className="lib-chip">aEEG {s.aeegPattern}{s.sleepWakeCycling ? ` · SWC ${labelize(s.sleepWakeCycling)}` : ""}</span>}
                <span className="lib-chip">{humanDuration(e.durationS)}</span>
                {s.channels && <span className="lib-chip">{labelize(s.channels)}</span>}
                {s.montage && <span className="lib-chip">{labelize(s.montage)}</span>}
                {qn?.domain && <span className="lib-chip">{qn.domain}</span>}
                {qn?.difficulty && <span className="lib-chip">{qn.difficulty}</span>}
                {qn?.setting && <span className="lib-chip">{qn.setting}</span>}
                {e.rendererVersion && <span className="lib-chip">render {e.rendererVersion}</span>}
              </div>

              <div className="lib-findings">
                {s.backgroundDetail && <span><b>Background</b> {s.backgroundDetail}</span>}
                {s.findings.length === 0 && !s.aeegPattern && <span>Background only — no authored events.</span>}
                {s.findings.map((f, i) => (
                  <span key={i}>
                    <b>{labelize(f.type)}</b>
                    {f.detail ? ` ${f.detail}` : ""}
                    {f.atMin !== null ? ` @ ${minutes(f.atMin)} min` : ""}
                  </span>
                ))}
              </div>

              {expanded && hasMore && (
                <div className="lib-more">
                  {qn?.learningObjective && <p style={{ margin: 0 }}><b>Objective.</b> {qn.learningObjective}</p>}
                  {qn?.imageCaption && <p style={{ margin: "6px 0 0" }}><b>Figure.</b> {qn.imageCaption}</p>}
                  {qn && qn.teachingPoints.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <b>Teaching points</b>
                      <ul>{qn.teachingPoints.map((t, i) => <li key={i}>{t}</li>)}</ul>
                    </div>
                  )}
                  {s.annotations.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <b>Bedside notes in the record</b>
                      <ul>{s.annotations.map((a, i) => <li key={i}>{a}</li>)}</ul>
                    </div>
                  )}
                  {qn?.tags.length ? <p style={{ ...meta, marginTop: 6 }}>{qn.tags.join(" · ")}</p> : null}
                </div>
              )}

              <div className="lib-chips">
                {(e.artifacts.edf || (e.artifacts.lay && e.artifacts.dat)) && (
                  <Link
                    href={`/admin/eeg-lab/viewer?job=${e.jobId}`}
                    style={{ ...mini, borderColor: "var(--accent-primary)", color: "var(--accent-primary)" }}
                  >
                    Open in viewer
                  </Link>
                )}
                {(Object.keys(e.artifacts) as LabArtifact[]).map((artifact) => (
                  <button
                    key={artifact}
                    type="button"
                    style={{
                      ...mini,
                      borderColor: isInstructorArtifact(artifact) ? "var(--accent-secondary)" : "var(--border)",
                      color: isInstructorArtifact(artifact) ? "var(--accent-secondary)" : "var(--text-secondary)",
                    }}
                    onClick={() => void download(e, artifact)}
                  >
                    {LAB_ARTIFACT_LABELS[artifact]}
                    {isInstructorArtifact(artifact) ? " · instructor" : ""}
                  </button>
                ))}
                {qn && <Link href={`/admin/qbank/${qn.caseId}`} style={mini}>Open question</Link>}
                {hasMore && (
                  <button type="button" style={mini} onClick={() => setOpen((o) => ({ ...o, [e.jobId]: !expanded }))}>
                    {expanded ? "Less" : "More"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </section>

      <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link href="/admin" style={btnGhost}>← Admin dashboard</Link>
        <Link href="/admin/eeg-lab" style={btnGhost}>Lab console</Link>
        <Link href="/admin/eeg-lab/viewer" style={btnGhost}>EEG Lab Viewer</Link>
        <Link href="/admin/qbank" style={btnGhost}>Question bank</Link>
      </div>
    </div>
  );
}

function Facet(props: {
  label: string;
  value: string;
  counts: Record<string, number> | undefined;
  labels?: Record<string, string>;
  onChange: (v: string) => void;
}) {
  const keys = Object.keys(props.counts ?? {}).sort();
  return (
    <label style={{ display: "block" }}>
      <span style={fieldLabel}>{props.label}</span>
      <select style={{ ...inp, padding: "8px 10px" }} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        <option value="">All</option>
        {keys.map((k) => (
          <option key={k} value={k}>
            {props.labels?.[k] ?? labelize(k)} ({props.counts?.[k]})
          </option>
        ))}
      </select>
    </label>
  );
}
