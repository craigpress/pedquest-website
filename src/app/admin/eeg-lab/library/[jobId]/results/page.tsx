"use client";

// Class results for one lab recording — teachers and up.
//
// One timeline (answer key on top, one row per learner), a per-event table
// (who caught which seizure, how late), and a per-learner table with the
// scoring from src/lib/lab/scoring.ts. Instructors' own marks are shown in a
// separate strip and never counted in the class numbers.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRole } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { adminShellWide, card, eyebrow, h1, meta, mini } from "@/lib/admin-ui";
import { REGION_LABELS, annotationColor, describeTarget, formatClock } from "@/lib/eeg/annotations";
import type { ClassSummary, KeyEvent, LearnerMark, LearnerScore, MarkTask } from "@/lib/lab/scoring";

interface Learner {
  userId: string; email: string; displayName: string | null; role: string; isTest: boolean; isInstructor: boolean;
  marks: (LearnerMark & { label: string; note: string; createdAt: string })[];
  scores: Record<string, LearnerScore>;
}
interface Results {
  job: { id: string; title: string | null; durationS: number; recordingId: string | null; hasAnswerKey: boolean };
  keyError: string | null;
  key: KeyEvent[];
  tasks: { task: MarkTask; summary: ClassSummary }[];
  learners: Learner[];
}

const name = (l: Learner) => l.displayName ?? l.email;
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
const secs = (x: number | null, signed = true) => (x === null ? "—" : `${signed && x > 0 ? "+" : ""}${Math.round(x)} s`);
const TREND_LABELS: Record<string, string> = {
  aeeg_left: "aEEG L", aeeg_right: "aEEG R", psd_left: "FFT L", psd_right: "FFT R", asym_spec: "Asym FFT",
  sr: "Suppr %", adr: "α/δ", power: "Power", asym: "Asym %", psd_vs_left: "FFT vs BL L", psd_vs_right: "FFT vs BL R",
  power_vs: "Power vs BL", adr_vs: "α/δ vs BL",
};

export default function ClassResultsPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { isTeacher, loading: roleLoading } = useRole();
  const [data, setData] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string>("seizure");
  const [open, setOpen] = useState<string | null>(null);

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const sb = getSupabase();
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  useEffect(() => {
    if (!isTeacher || !jobId) return;
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/admin/lab/jobs/${jobId}/results`, { headers: await authHeaders(), cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
        if (live) setData(json as Results);
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Could not load the class results.");
      }
    })();
    return () => { live = false; };
  }, [isTeacher, jobId, authHeaders]);

  const task = data?.tasks.find((t) => t.task.id === taskId) ?? data?.tasks[0] ?? null;
  const learners = useMemo(() => (data?.learners ?? []).filter((l) => !l.isInstructor), [data]);
  const instructors = useMemo(() => (data?.learners ?? []).filter((l) => l.isInstructor), [data]);

  if (roleLoading) return <main style={adminShellWide}><p style={meta}>Loading…</p></main>;
  if (!isTeacher) {
    return (
      <main style={adminShellWide}>
        <h1 style={h1}>Teacher access required</h1>
        <p style={meta}>Class results are available to teachers, editors and admins. <Link href="/admin/eeg-lab/library">Back to the library</Link>.</p>
      </main>
    );
  }

  return (
    <main style={adminShellWide}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 18 }}>
        <div>
          <div style={eyebrow}>EEG Teaching Lab · class results</div>
          <h1 style={{ ...h1, marginBottom: 4 }}>{data?.job.title ?? "Recording"}</h1>
          {data && (
            <p style={meta}>
              {formatClock(data.job.durationS)} recording · {learners.length} learner{learners.length === 1 ? "" : "s"} ·{" "}
              {data.key.length} answer-key event{data.key.length === 1 ? "" : "s"}
              {learners.some((l) => l.isTest) && " · includes test accounts"}
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href={`/admin/eeg-lab/viewer?job=${jobId}`} style={mini}>Open in viewer</Link>
          <Link href={`/admin/eeg-lab/library/${jobId}`} style={mini}>Recording page</Link>
          <Link href="/admin/eeg-lab/library" style={mini}>← Library</Link>
        </div>
      </div>

      {error && <div role="alert" style={{ ...card, padding: "12px 16px", marginBottom: 16, color: "var(--accent-secondary)" }}>{error}</div>}
      {data?.keyError && <div style={{ ...card, padding: "12px 16px", marginBottom: 16, color: "var(--text-muted)", fontSize: 14 }}>{data.keyError}</div>}
      {!data && !error && <p style={meta}>Loading…</p>}

      {data && task && (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {data.tasks.length > 1 && (
            <div style={{ display: "flex", gap: 8 }}>
              {data.tasks.map((t) => (
                <button key={t.task.id} type="button" style={{ ...mini, fontWeight: t.task.id === task.task.id ? 700 : 400 }} onClick={() => setTaskId(t.task.id)}>
                  {t.task.title}
                </button>
              ))}
            </div>
          )}

          {/* ── summary tiles ── */}
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            <Tile label="Task" value={task.task.title} small />
            <Tile label="Learners" value={String(task.summary.learners)} />
            <Tile label="Key events" value={String(task.summary.keyCount)} />
            <Tile label="Mean sensitivity" value={pct(task.summary.meanSensitivity)} />
            <Tile label="False alarms / learner" value={task.summary.meanFalseAlarms === null ? "—" : task.summary.meanFalseAlarms.toFixed(1)} />
            <Tile label="Median score" value={task.summary.medianComposite === null ? "—" : `${task.summary.medianComposite}`} />
          </section>

          {/* ── timeline ── */}
          <section style={{ ...card, padding: 16 }}>
            <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>Timeline</h2>
            <Timeline durationS={data.job.durationS} keyEvents={data.key} task={task.task} learners={learners} instructors={instructors} onPick={setOpen} />
            <p style={{ ...meta, marginTop: 8 }}>
              Top row: answer key. Solid blocks are marks that matched a key event; hollow blocks did not; triangles are instantaneous marks.
              Colours follow the mark kind. Tolerance for a detection: ±{task.task.toleranceS} s around each key event.
            </p>
          </section>

          {/* ── per key event ── */}
          {task.summary.perKeyEvent.length > 0 && (
            <section style={{ ...card, padding: 16, overflowX: "auto" }}>
              <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>Per event</h2>
              <table style={tbl}>
                <thead><tr><th style={th}>#</th><th style={th}>Event</th><th style={th}>Onset</th><th style={th}>Duration</th><th style={th}>Region</th><th style={th}>Detected by</th><th style={th}>Median latency</th><th style={th}>Localized correctly</th></tr></thead>
                <tbody>
                  {task.summary.perKeyEvent.map((k, n) => (
                    <tr key={k.keyIndex}>
                      <td style={td}>{n + 1}</td>
                      <td style={td}>{k.event.kind}</td>
                      <td style={td}>{formatClock(k.event.onsetS)}</td>
                      <td style={td}>{Math.round(k.event.offsetS - k.event.onsetS)} s</td>
                      <td style={td}>{k.event.region ? REGION_LABELS[k.event.region] : "—"}</td>
                      <td style={td}>{k.detectedBy} / {task.summary.learners}</td>
                      <td style={td}>{secs(k.medianLatencyS)}</td>
                      <td style={td}>{k.localizationMatches} / {k.detectedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* ── per learner ── */}
          <section style={{ ...card, padding: 16, overflowX: "auto" }}>
            <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>Learners</h2>
            {learners.length === 0 && <p style={meta}>No learner has marked this recording yet.</p>}
            {learners.length > 0 && (
              <table style={tbl}>
                <thead>
                  <tr>
                    <th style={th}>Learner</th><th style={th}>Marks</th><th style={th}>Detected</th><th style={th}>False alarms</th>
                    <th style={th}>Median onset latency</th><th style={th}>Median duration error</th><th style={th}>Localization</th><th style={th}>Pane</th><th style={th}>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {learners.map((l) => {
                    const s = l.scores[task.task.id];
                    const isOpen = open === l.userId;
                    return (
                      <LearnerRows key={l.userId} learner={l} score={s} keyEvents={data.key} isOpen={isOpen} onToggle={() => setOpen(isOpen ? null : l.userId)} />
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          {instructors.length > 0 && (
            <section style={{ ...card, padding: 16 }}>
              <h2 style={{ fontSize: 15, margin: "0 0 6px" }}>Instructor marks (not counted)</h2>
              <p style={meta}>
                {instructors.map((l) => `${name(l)} · ${l.marks.length} mark${l.marks.length === 1 ? "" : "s"}`).join(" · ")}
              </p>
            </section>
          )}
        </div>
      )}
    </main>
  );
}

function Tile({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div style={{ ...card, padding: "12px 14px" }}>
      <div style={{ ...eyebrow, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: small ? 13 : 22, fontWeight: 600, lineHeight: 1.25 }}>{value}</div>
    </div>
  );
}

function LearnerRows({ learner: l, score: s, keyEvents, isOpen, onToggle }: {
  learner: Learner; score: LearnerScore; keyEvents: KeyEvent[]; isOpen: boolean; onToggle: () => void;
}) {
  const loc = s.localization;
  const matchOf = (id: string) => s.matches.find((m) => m.markId === id);
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer" }}>
        <td style={td}>
          <span style={{ fontWeight: 600 }}>{name(l)}</span>
          {l.isTest && <span style={badge}>test</span>}
          <div style={{ ...meta, fontSize: 12 }}>{l.email}</div>
        </td>
        <td style={td}>{l.marks.length}</td>
        <td style={td}>{s.keyCount ? `${s.detected} / ${s.keyCount}` : "—"}</td>
        <td style={td}>{s.falseAlarms}</td>
        <td style={td}>{secs(s.medianOnsetLatencyS)}</td>
        <td style={td}>{secs(s.medianDurationErrorS)}</td>
        <td style={td} title="match / partial / miss / not stated">{loc.match} · {loc.partial} · {loc.miss} · {loc.not_stated}</td>
        <td style={td}>{s.byPane.raw} raw · {s.byPane.trend} trend</td>
        <td style={{ ...td, fontWeight: 600 }}>{s.composite ?? "—"}</td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={9} style={{ ...td, background: "var(--bg-subtle, transparent)" }}>
            <table style={{ ...tbl, fontSize: 13 }}>
              <thead><tr><th style={th}>Mark</th><th style={th}>Time</th><th style={th}>Target</th><th style={th}>Matched</th><th style={th}>Latency</th><th style={th}>Localization</th><th style={th}>Note</th></tr></thead>
              <tbody>
                {l.marks.map((m) => {
                  const mt = matchOf(m.id);
                  const k = mt ? keyEvents[mt.keyIndex] : null;
                  return (
                    <tr key={m.id}>
                      <td style={td}><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: annotationColor(m.kind), marginRight: 6, verticalAlign: "middle" }} />{m.label || m.kind}</td>
                      <td style={td}>{formatClock(m.onsetS)}{m.durationS > 0 ? ` – ${formatClock(m.onsetS + m.durationS)}` : ""}</td>
                      <td style={td}>{describeTarget(m, (r) => TREND_LABELS[r] ?? r) || "—"}</td>
                      <td style={td}>{k ? `${k.kind} @ ${formatClock(k.onsetS)}` : (s.unmatchedMarkIds.includes(m.id) ? "no" : "—")}</td>
                      <td style={td}>{mt ? secs(mt.onsetLatencyS) : "—"}</td>
                      <td style={td}>{mt ? mt.localization.replace("_", " ") : "—"}</td>
                      <td style={{ ...td, color: "var(--text-muted)" }}>{m.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

function Timeline({ durationS, keyEvents, task, learners, instructors, onPick }: {
  durationS: number; keyEvents: KeyEvent[]; task: MarkTask; learners: Learner[]; instructors: Learner[]; onPick: (userId: string) => void;
}) {
  const LABEL_W = 150, ROW_H = 22, PAD = 6;
  const rows = [...learners, ...instructors];
  const W = 1000;
  const plotW = W - LABEL_W - PAD;
  const x = (t: number) => LABEL_W + (Math.max(0, Math.min(durationS, t)) / durationS) * plotW;
  const H = PAD + ROW_H * (rows.length + 1) + 22;
  const ticks = useMemo(() => {
    const step = durationS > 6 * 3600 ? 3600 : durationS > 2 * 3600 ? 1800 : durationS > 1800 ? 600 : 300;
    const out: number[] = [];
    for (let t = 0; t <= durationS; t += step) out.push(t);
    return out;
  }, [durationS]);
  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 640, display: "block", fontFamily: "inherit" }} role="img" aria-label="Marks per learner against the answer key">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={PAD} y2={H - 20} stroke="var(--border)" strokeWidth={0.5} />
            <text x={x(t)} y={H - 6} fontSize={10} textAnchor="middle" fill="var(--text-muted)">{formatClock(t)}</text>
          </g>
        ))}
        {/* answer key row */}
        <text x={0} y={PAD + ROW_H / 2 + 4} fontSize={12} fontWeight={700} fill="var(--text)">Answer key</text>
        {keyEvents.map((k, i) => {
          const graded = task.keyKinds.includes(k.kind);
          return (
            <rect key={i} x={x(k.onsetS)} y={PAD + 3} width={Math.max(2, x(k.offsetS) - x(k.onsetS))} height={ROW_H - 6}
              fill={graded ? annotationColor("seizure") : "var(--text-muted)"} opacity={graded ? 0.9 : 0.4} rx={2}>
              <title>{`${k.kind} ${formatClock(k.onsetS)} – ${formatClock(k.offsetS)}${k.region ? ` · ${REGION_LABELS[k.region]}` : ""}`}</title>
            </rect>
          );
        })}
        {rows.map((l, r) => {
          const y0 = PAD + ROW_H * (r + 1);
          const s = l.scores[task.id];
          const matched = new Set(s?.matches.map((m) => m.markId) ?? []);
          return (
            <g key={l.userId} onClick={() => onPick(l.userId)} style={{ cursor: "pointer" }}>
              <line x1={LABEL_W} x2={W - PAD} y1={y0} y2={y0} stroke="var(--border)" strokeWidth={0.5} />
              <text x={0} y={y0 + ROW_H / 2 + 4} fontSize={12} fill={l.isInstructor ? "var(--text-muted)" : "var(--text)"}>
                {name(l).slice(0, 22)}{l.isInstructor ? " (instr.)" : ""}
              </text>
              {l.marks.map((m) => {
                const c = annotationColor(m.kind);
                const hit = matched.has(m.id);
                const title = `${m.label || m.kind} ${formatClock(m.onsetS)}${m.durationS > 0 ? ` – ${formatClock(m.onsetS + m.durationS)}` : ""}${describeTarget(m, (row) => TREND_LABELS[row] ?? row) ? ` · ${describeTarget(m, (row) => TREND_LABELS[row] ?? row)}` : ""}${hit ? "" : " · unmatched"}`;
                if (m.durationS <= 0) {
                  const cx = x(m.onsetS), cy = y0 + ROW_H / 2;
                  return (
                    <polygon key={m.id} points={`${cx},${cy - 6} ${cx + 5},${cy + 5} ${cx - 5},${cy + 5}`} fill={hit ? c : "none"} stroke={c} strokeWidth={1.5}>
                      <title>{title}</title>
                    </polygon>
                  );
                }
                return (
                  <rect key={m.id} x={x(m.onsetS)} y={y0 + 4} width={Math.max(2, x(m.onsetS + m.durationS) - x(m.onsetS))} height={ROW_H - 8}
                    fill={hit ? c : "none"} stroke={c} strokeWidth={1.2} opacity={hit ? 0.85 : 1} rx={2}>
                    <title>{title}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const tbl: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 14 };
const th: React.CSSProperties = { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)", fontWeight: 600, whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px", borderBottom: "1px solid var(--border)", verticalAlign: "top" };
const badge: React.CSSProperties = { marginLeft: 6, fontSize: 10, padding: "1px 6px", borderRadius: 999, border: "1px solid var(--border)", color: "var(--text-muted)", verticalAlign: "middle" };
