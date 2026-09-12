"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRole } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import {
  adminShellWide, btnGhost, btnPrimary, card, eyebrow, fieldLabel, h1, h2, inp, meta, mini,
} from "@/lib/admin-ui";
import {
  AGE_BANDS, ARTIFACT_KINDS, BACKGROUND_TYPES, CHANNEL_SETS, DURATION_MAX_MINUTES,
  DURATION_MIN_MINUTES, EVENT_TYPE_LABELS, MONTAGES, REGIONS, SAMPLE_RATES, SEDATION_AGENTS,
  SPREADS, defaultAnnotation, defaultEvent, defaultGuidedScenario, randomSeed,
} from "@/lib/lab/spec";
import {
  LAB_ARTIFACT_LABELS, LAB_FORMATS, LAB_MMX_PRESETS, LAB_PERSYST_PANELS, SYNTHETIC_STAMP,
  isInstructorArtifact, isLabTerminal,
  type GuidedEvent, type GuidedScenario, type LabArtifact, type LabFormat, type LabJob,
  type LabMode, type LabValidation,
} from "@/lib/lab/types";

// EEG Teaching Lab — editor console.
//
// Three ways in (Guided form, prose, raw spec), one way out: a validated image
// block is queued as an `export` job and the page polls it. Nothing is produced
// inside a request — a 120-minute export is ~20 s, Persyst processing is
// minutes, and the last full render took 73 minutes.
//
// Gated exactly like /admin/qbank: useRole(), early return when !isEditor. That
// is the UI gate; every route re-checks with requireRole() server-side.

const MODES: { id: LabMode; label: string; hint: string }[] = [
  { id: "guided", label: "Guided", hint: "Build the scenario from fields." },
  { id: "prose", label: "Prose", hint: "Describe the case; the model writes the spec." },
  { id: "expert", label: "Expert", hint: "Paste or edit the spec as YAML or JSON." },
];

const STATUS_COLOR: Record<string, string> = {
  pending: "var(--text-muted)",
  running: "var(--accent-secondary)",
  done: "var(--accent-tertiary)",
  error: "var(--accent-secondary)",
  cancelled: "var(--text-muted)",
};

function relativeAge(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 90) return `${Math.round(secs)}s ago`;
  if (secs < 5400) return `${Math.round(secs / 60)}m ago`;
  if (secs < 172800) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

function humanDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 90) return `${mins} min`;
  const hours = mins / 60;
  return `${hours % 1 === 0 ? hours : hours.toFixed(1)} h`;
}

function labelize(value: string): string {
  return value.replace(/_/g, " ");
}

// ── small field components ─────────────────────────────────────────────────

function Num(props: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; disabled?: boolean; hint?: string;
}) {
  return (
    <label style={{ display: "block" }}>
      <span style={fieldLabel}>{props.label}</span>
      <input
        type="number"
        value={Number.isFinite(props.value) ? props.value : 0}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        style={inp}
      />
      {props.hint && <span style={{ ...meta, display: "block", marginTop: 4 }}>{props.hint}</span>}
    </label>
  );
}

function Pick(props: {
  label: string; value: string; onChange: (v: string) => void;
  options: { id: string; label: string }[]; disabled?: boolean; hint?: string;
}) {
  return (
    <label style={{ display: "block" }}>
      <span style={fieldLabel}>{props.label}</span>
      <select
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.value)}
        style={inp}
      >
        {props.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      {props.hint && <span style={{ ...meta, display: "block", marginTop: 4 }}>{props.hint}</span>}
    </label>
  );
}

const asOptions = (values: readonly string[]) =>
  values.map((v) => ({ id: v, label: labelize(v) }));

// ── page ───────────────────────────────────────────────────────────────────

export default function AdminEegLabPage() {
  const { isEditor, loading: roleLoading } = useRole();

  const [mode, setMode] = useState<LabMode>("guided");
  const [guided, setGuided] = useState<GuidedScenario>(defaultGuidedScenario);
  const [prose, setProse] = useState("");
  const [specText, setSpecText] = useState("");

  const [formats, setFormats] = useState<LabFormat[]>(["lay"]);
  const [durationMin, setDurationMin] = useState(120);
  const [seed, setSeed] = useState(() => randomSeed());
  const [runPersyst, setRunPersyst] = useState(false);
  const [mmxPreset, setMmxPreset] = useState(LAB_MMX_PRESETS[0]);
  const [panel, setPanel] = useState(LAB_PERSYST_PANELS[0]);
  // Default OFF, and it stays OFF unless an editor deliberately asks: the key
  // is the instructor copy.
  const [includeAnswers, setIncludeAnswers] = useState(false);

  const [validation, setValidation] = useState<LabValidation | null>(null);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<"draft" | "validate" | "submit" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [jobs, setJobs] = useState<LabJob[]>([]);
  // The API returns newest first, so a bulk enqueue (the 52 bank items) would
  // push every finished recording out of a single short list.  Split instead.
  const activeJobs = jobs.filter((j) => !isLabTerminal(j.status));
  const finishedJobs = jobs.filter((j) => isLabTerminal(j.status));

  const authHeaders = useCallback(async () => {
    const sb = getSupabase();
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : null;
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/lab/jobs?limit=100", { headers: await authHeaders() });
      const json = await res.json();
      if (res.ok && json.success) setJobs(json.jobs as LabJob[]);
    } catch {
      // a failed poll is not worth an error banner; the next tick retries
    }
  }, [authHeaders]);

  useEffect(() => { if (isEditor) void loadJobs(); }, [isEditor, loadJobs]);

  // Poll only while something is unsettled. A 24 h recording is not going to
  // finish while anyone watches, so there is no point hammering the API once
  // every row is terminal.
  useEffect(() => {
    if (!isEditor) return;
    if (!jobs.some((j) => !isLabTerminal(j.status))) return;
    const timer = setInterval(() => { void loadJobs(); }, 6000);
    return () => clearInterval(timer);
  }, [isEditor, jobs, loadJobs]);

  function requestBody(extra: Record<string, unknown>) {
    return JSON.stringify({
      mode,
      guided: mode === "guided" ? guided : undefined,
      prose: mode === "prose" ? prose : undefined,
      specText: mode === "expert" ? specText : undefined,
      formats,
      durationMin,
      seed,
      runPersyst,
      includeAnswers,
      mmxPreset,
      panel,
      ...extra,
    });
  }

  async function post(extra: Record<string, unknown>) {
    const res = await fetch("/api/admin/lab/jobs", {
      method: "POST",
      headers: await authHeaders(),
      body: requestBody(extra),
    });
    return { res, json: await res.json() };
  }

  /** Validate without enqueuing. Also fills the Expert textarea with the
   *  normalized block, so "what will be queued" is always inspectable. */
  async function validateSpec() {
    setBusy("validate");
    setError(null);
    setMessage(null);
    try {
      const { res, json } = await post({ dryRun: true });
      if (!res.ok) { setError(json.error || "Validation failed."); setValidation(null); return; }
      setValidation(json.validation as LabValidation);
      if (json.specText) setSpecText(json.specText as string);
      setMessage(json.validation?.ok ? "Spec validates." : "The spec has errors — see below.");
    } catch {
      setError("Network error while validating.");
    } finally {
      setBusy(null);
    }
  }

  /** Prose -> spec. Lands in Expert mode so the editor reviews and edits the
   *  block before committing to a job that may run for an hour. */
  async function draftFromProse() {
    setBusy("draft");
    setError(null);
    setValidation(null);
    setDraftNote(null);
    setMessage("Drafting the recording spec…");
    try {
      const { res, json } = await post({ dryRun: true });
      if (!res.ok) {
        setMessage(null);
        setError(json.error || "Drafting failed.");
        return;
      }
      setSpecText(json.specText as string);
      setValidation(json.validation as LabValidation);
      const draft = json.draft as { model?: string; repaired?: boolean; notes?: string[] } | undefined;
      setDraftNote([
        draft?.model ? `Drafted by ${draft.model}.` : null,
        draft?.repaired ? "One repair round was needed." : null,
        ...(draft?.notes ?? []),
      ].filter(Boolean).join(" "));
      setMode("expert");
      setMessage(
        json.validation?.ok
          ? "Draft ready. Review it, then queue the export."
          : "Draft ready but it does not validate yet — fix the errors below.",
      );
    } catch {
      setMessage(null);
      setError("Network error while drafting.");
    } finally {
      setBusy(null);
    }
  }

  async function queueJob(event: FormEvent) {
    event.preventDefault();
    setBusy("submit");
    setError(null);
    setMessage(null);
    try {
      const { res, json } = await post({});
      if (!res.ok || !json.success) {
        setError(json.error || "Could not queue the export.");
        if (json.validation) setValidation(json.validation as LabValidation);
        return;
      }
      setValidation(json.validation as LabValidation);
      const job = json.job as LabJob;
      setMessage(
        `Queued ${job.recordingId ?? job.id.slice(0, 8)} — ${humanDuration(job.durationS)}. ` +
        "Exporting runs on the render host; this page polls it.",
      );
      await loadJobs();
    } catch {
      setError("Network error while queueing the export.");
    } finally {
      setBusy(null);
    }
  }

  async function download(job: LabJob, artifact: LabArtifact) {
    if (isInstructorArtifact(artifact)) {
      const ok = window.confirm(
        `${LAB_ARTIFACT_LABELS[artifact]} is the INSTRUCTOR copy — it carries the ground truth ` +
        "for this recording. Do not hand it to a learner. Download it?",
      );
      if (!ok) return;
    }
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/lab/jobs/${job.id}/download?artifact=${artifact}`,
        { headers: await authHeaders() },
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || "Could not issue a download link.");
        return;
      }
      window.open(json.url as string, "_blank", "noopener,noreferrer");
    } catch {
      setError("Network error requesting the download link.");
    }
  }

  // ── guided helpers ───────────────────────────────────────────────────────

  function patchEvent(id: string, patch: Record<string, unknown>) {
    setGuided((g) => ({
      ...g,
      events: g.events.map((e) => (e.id === id ? ({ ...e, ...patch } as GuidedEvent) : e)),
    }));
  }
  function patchEvolution(id: string, patch: Record<string, unknown>) {
    setGuided((g) => ({
      ...g,
      events: g.events.map((e) =>
        e.id === id && "evolution" in e
          ? ({ ...e, evolution: { ...e.evolution, ...patch } } as GuidedEvent)
          : e),
    }));
  }
  function removeEvent(id: string) {
    setGuided((g) => ({ ...g, events: g.events.filter((e) => e.id !== id) }));
  }
  function addEvent(type: GuidedEvent["type"]) {
    setGuided((g) => ({ ...g, events: [...g.events, defaultEvent(type, durationMin)] }));
  }

  if (roleLoading) {
    return <div style={adminShellWide}><p style={{ color: "var(--text-muted)" }}>Loading…</p></div>;
  }
  if (!isEditor) {
    return (
      <div style={adminShellWide}>
        <h1 style={h1}>Editor access required</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: 10 }}>
          The EEG Teaching Lab is limited to PedQuEST editors and admins.{" "}
          <Link href="/login">Sign in</Link>, or ask an admin to grant you the editor role.
        </p>
      </div>
    );
  }

  const busyAny = busy !== null;

  return (
    <div style={adminShellWide}>
      <style>{`
        .lab-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .lab-grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        .lab-grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        .lab-event { border: 1px solid var(--border); border-radius: 12px; padding: 14px;
          background: var(--bg); margin-bottom: 12px; }
        .lab-event-head { display: flex; justify-content: space-between; align-items: center;
          gap: 10px; margin-bottom: 10px; }
        .lab-modes { display: flex; gap: 8px; flex-wrap: wrap; }
        .lab-job { border-top: 1px solid var(--border); padding: 12px 0; }
        .lab-chips { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        @media (max-width: 860px) {
          .lab-grid3, .lab-grid4 { grid-template-columns: 1fr 1fr; }
        }
        @media (max-width: 560px) {
          .lab-grid2, .lab-grid3, .lab-grid4 { grid-template-columns: 1fr; }
        }
      `}</style>

      <div style={{ marginBottom: 18 }}>
        <span style={eyebrow}>EEG teaching lab</span>
        <h1 style={{ ...h1, marginTop: 6 }}>Build a teaching recording</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: 8, maxWidth: "68ch", lineHeight: 1.6 }}>
          Specify a scenario and export it as a recording a learner can scroll through in a
          review station — Persyst <code>.lay/.dat</code> or EDF+ — rather than a figure. The
          scenario spec is the answer key, and it is a separate download.
        </p>
      </div>

      <div
        role="note"
        style={{
          ...card, borderColor: "var(--accent-secondary)", padding: "10px 14px", marginBottom: 18,
          fontFamily: "var(--mono-font)", fontSize: 12, letterSpacing: ".08em",
          textTransform: "uppercase", color: "var(--accent-secondary)", fontWeight: 700,
        }}
      >
        {SYNTHETIC_STAMP}
      </div>

      {error && (
        <div role="alert" style={{
          ...card, borderColor: "var(--accent-secondary)", padding: "12px 16px", marginBottom: 14,
          color: "var(--accent-secondary)", fontSize: 14,
        }}>
          {error}
        </div>
      )}
      {message && (
        <div role="status" style={{
          ...card, padding: "12px 16px", marginBottom: 14,
          color: "var(--accent-tertiary)", fontSize: 14,
        }}>
          {message}
        </div>
      )}

      <form onSubmit={queueJob}>
        {/* ── mode ───────────────────────────────────────────────────── */}
        <div className="lab-modes" style={{ marginBottom: 14 }}>
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              aria-pressed={mode === m.id}
              title={m.hint}
              style={{
                ...mini,
                borderColor: mode === m.id ? "var(--accent-primary)" : "var(--border)",
                color: mode === m.id ? "var(--text)" : "var(--text-secondary)",
                fontWeight: mode === m.id ? 700 : 500,
              }}
            >
              {m.label}
            </button>
          ))}
          <span style={{ ...meta, alignSelf: "center" }}>
            {MODES.find((m) => m.id === mode)?.hint}
          </span>
        </div>

        {/* ── guided ─────────────────────────────────────────────────── */}
        {mode === "guided" && (
          <section style={{ ...card, padding: 18, marginBottom: 16 }}>
            <h2 style={h2}>Recording</h2>
            <div className="lab-grid4" style={{ marginTop: 12 }}>
              <Pick
                label="Age band" value={guided.ageBand} disabled={busyAny}
                options={AGE_BANDS}
                onChange={(v) => setGuided((g) => ({
                  ...g,
                  ageBand: v as GuidedScenario["ageBand"],
                  // The neonatal array and montage travel together; picking
                  // neonate and leaving a 19-channel 10-20 set is a mistake the
                  // renderer would accept and a reader would not.
                  ...(v === "neonate"
                    ? { channels: "neonatal_9" as const, montage: "neonatal_reduced" as const }
                    : {}),
                }))}
              />
              <Pick
                label="Channel set" value={guided.channels} disabled={busyAny}
                options={CHANNEL_SETS}
                onChange={(v) => setGuided((g) => ({ ...g, channels: v as GuidedScenario["channels"] }))}
              />
              <Pick
                label="Montage" value={guided.montage} disabled={busyAny}
                options={MONTAGES}
                onChange={(v) => setGuided((g) => ({ ...g, montage: v as GuidedScenario["montage"] }))}
              />
              <Pick
                label="Sample rate" value={String(guided.sampleRate)} disabled={busyAny}
                options={SAMPLE_RATES.map((r) => ({ id: String(r), label: `${r} Hz` }))}
                onChange={(v) => setGuided((g) => ({ ...g, sampleRate: Number(v) }))}
              />
            </div>

            <h2 style={{ ...h2, marginTop: 22 }}>Background</h2>
            <div className="lab-grid4" style={{ marginTop: 12 }}>
              <Pick
                label="Type" value={guided.background.type} disabled={busyAny}
                options={BACKGROUND_TYPES}
                onChange={(v) => setGuided((g) => ({
                  ...g, background: { ...g.background, type: v as GuidedScenario["background"]["type"] },
                }))}
              />
              <Num
                label="Dominant Hz" value={guided.background.dominantHz} disabled={busyAny}
                min={0.3} max={20} step={0.1}
                onChange={(v) => setGuided((g) => ({ ...g, background: { ...g.background, dominantHz: v } }))}
              />
              <Num
                label="Amplitude µV" value={guided.background.amplitudeUv} disabled={busyAny}
                min={1} max={300}
                onChange={(v) => setGuided((g) => ({ ...g, background: { ...g.background, amplitudeUv: v } }))}
              />
              <Num
                label="Slow fraction" value={guided.background.slowFraction} disabled={busyAny}
                min={0} max={1} step={0.05} hint="Delta/theta share of power"
                onChange={(v) => setGuided((g) => ({ ...g, background: { ...g.background, slowFraction: v } }))}
              />
            </div>
            {guided.background.type === "burst_suppression" && (
              <div className="lab-grid3" style={{ marginTop: 12 }}>
                <Num
                  label="Burst length s" value={guided.background.burstS} disabled={busyAny}
                  min={0.2} step={0.1}
                  onChange={(v) => setGuided((g) => ({ ...g, background: { ...g.background, burstS: v } }))}
                />
                <Num
                  label="Interburst interval s" value={guided.background.ibiS} disabled={busyAny}
                  min={0.2} step={0.1}
                  onChange={(v) => setGuided((g) => ({ ...g, background: { ...g.background, ibiS: v } }))}
                />
                <Pick
                  label="Reactivity" value={guided.background.reactivity} disabled={busyAny}
                  options={asOptions(["present", "absent"])}
                  onChange={(v) => setGuided((g) => ({
                    ...g, background: { ...g.background, reactivity: v as "present" | "absent" },
                  }))}
                />
              </div>
            )}

            <h2 style={{ ...h2, marginTop: 22 }}>Events</h2>
            <p style={{ ...meta, marginTop: 6, marginBottom: 12, lineHeight: 1.55 }}>
              Times are minutes from the start of the recording. What you put here is the
              ground truth — it is what the answer key contains, and it is never written into
              the learner&apos;s file.
            </p>

            {guided.events.length === 0 && (
              <p style={{ ...meta, marginBottom: 12 }}>
                No events yet — this would export as a background-only recording.
              </p>
            )}

            {guided.events.map((event) => (
              <div className="lab-event" key={event.id}>
                <div className="lab-event-head">
                  <strong style={{ color: "var(--text)", fontSize: 14 }}>
                    {EVENT_TYPE_LABELS[event.type]}
                  </strong>
                  <button type="button" style={mini} disabled={busyAny} onClick={() => removeEvent(event.id)}>
                    Remove
                  </button>
                </div>

                {event.type === "seizure" && (
                  <>
                    <div className="lab-grid4">
                      <Num label="Onset min" value={event.onsetMin} min={0} max={durationMin} disabled={busyAny}
                        onChange={(v) => patchEvent(event.id, { onsetMin: v })} />
                      <Num label="Duration s" value={event.durationS} min={1} disabled={busyAny}
                        onChange={(v) => patchEvent(event.id, { durationS: v })} />
                      <Pick label="Onset region" value={event.onsetRegion} options={asOptions(REGIONS)} disabled={busyAny}
                        onChange={(v) => patchEvent(event.id, { onsetRegion: v })} />
                      <Pick label="Spread" value={event.spread} options={asOptions(SPREADS)} disabled={busyAny}
                        onChange={(v) => patchEvent(event.id, { spread: v })} />
                    </div>
                    <div className="lab-grid4" style={{ marginTop: 12 }}>
                      <Num label="Start Hz" value={event.evolution.startHz} min={0.2} max={30} step={0.1} disabled={busyAny}
                        onChange={(v) => patchEvolution(event.id, { startHz: v })} />
                      <Num label="End Hz" value={event.evolution.endHz} min={0.2} max={30} step={0.1} disabled={busyAny}
                        onChange={(v) => patchEvolution(event.id, { endHz: v })} />
                      <Num label="Start µV" value={event.evolution.amplitudeStartUv} min={1} disabled={busyAny}
                        onChange={(v) => patchEvolution(event.id, { amplitudeStartUv: v })} />
                      <Num label="End µV" value={event.evolution.amplitudeEndUv} min={1} disabled={busyAny}
                        onChange={(v) => patchEvolution(event.id, { amplitudeEndUv: v })} />
                    </div>
                    <div className="lab-grid3" style={{ marginTop: 12 }}>
                      <Num label="Postictal attenuation s" value={event.postictalAttenuationS} min={0} disabled={busyAny}
                        onChange={(v) => patchEvent(event.id, { postictalAttenuationS: v })} />
                    </div>
                  </>
                )}

                {event.type === "seizure_cluster" && (
                  <>
                    <div className="lab-grid4">
                      <Num label="Start min" value={event.startMin} min={0} max={durationMin} disabled={busyAny}
                        onChange={(v) => patchEvent(event.id, { startMin: v })} />
                      <Num label="End min" value={event.endMin} min={0} max={durationMin} disabled={busyAny}
                        onChange={(v) => patchEvent(event.id, { endMin: v })} />
                      <Num label="Interval min" value={event.intervalMin} min={0.5} step={0.5} disabled={busyAny}
                        onChange={(v) => patchEvent(event.id, { intervalMin: v })} />
                      <Pick label="Onset region" value={event.onsetRegion} options={asOptions(REGIONS)} disabled={busyAny}
                        onChange={(v) => patchEvent(event.id, { onsetRegion: v })} />
                    </div>
                    <div className="lab-grid4" style={{ marginTop: 12 }}>
                      <Num label="First run s" value={event.durationS} min={1} disabled={busyAny}
                        onChange={(v) => patchEvent(event.id, { durationS: v })} />
                      <Num
                        label="Last run s" value={event.durationEndS} min={1} disabled={busyAny}
                        hint="Longer = an escalating cluster; equal = uniform runs"
                        onChange={(v) => patchEvent(event.id, { durationEndS: v })}
                      />
                      <Num label="Start Hz" value={event.evolution.startHz} min={0.2} max={30} step={0.1} disabled={busyAny}
                        onChange={(v) => patchEvolution(event.id, { startHz: v })} />
                      <Num label="End Hz" value={event.evolution.endHz} min={0.2} max={30} step={0.1} disabled={busyAny}
                        onChange={(v) => patchEvolution(event.id, { endHz: v })} />
                    </div>
                  </>
                )}

                {event.type === "sedation_change" && (
                  <div className="lab-grid4">
                    <Num label="At min" value={event.atMin} min={0} max={durationMin} disabled={busyAny}
                      onChange={(v) => patchEvent(event.id, { atMin: v })} />
                    <Pick label="Direction" value={event.direction} options={asOptions(["increase", "decrease"])} disabled={busyAny}
                      onChange={(v) => patchEvent(event.id, { direction: v })} />
                    <Pick label="Agent" value={event.agent} options={asOptions(SEDATION_AGENTS)} disabled={busyAny}
                      onChange={(v) => patchEvent(event.id, { agent: v })} />
                    <Num label="Target SR %" value={event.suppressionRatioTargetPct} min={0} max={100} disabled={busyAny}
                      onChange={(v) => patchEvent(event.id, { suppressionRatioTargetPct: v })} />
                    <Num label="Ramp min" value={event.rampMin} min={0} disabled={busyAny}
                      onChange={(v) => patchEvent(event.id, { rampMin: v })} />
                    <label style={{ ...meta, display: "flex", gap: 8, alignItems: "center", marginTop: 22 }}>
                      <input
                        type="checkbox" checked={event.betaBoost} disabled={busyAny}
                        onChange={(e) => patchEvent(event.id, { betaBoost: e.target.checked })}
                      />
                      Beta boost
                    </label>
                  </div>
                )}

                {event.type === "attenuation_transient" && (
                  <>
                    <div className="lab-grid4">
                      <Num label="At min" value={event.atMin} min={0} max={durationMin} disabled={busyAny}
                        onChange={(v) => patchEvent(event.id, { atMin: v })} />
                      <Num label="Duration min" value={event.durationMin} min={0.5} step={0.5} disabled={busyAny}
                        onChange={(v) => patchEvent(event.id, { durationMin: v })} />
                      <Pick label="Side" value={event.side} options={asOptions(["both", "left", "right"])} disabled={busyAny}
                        onChange={(v) => patchEvent(event.id, { side: v })} />
                      <Num label="Ramp min" value={event.rampMin} min={0} disabled={busyAny}
                        hint="0 = abrupt; longer = an evolving process"
                        onChange={(v) => patchEvent(event.id, { rampMin: v })} />
                    </div>
                    <div className="lab-grid2" style={{ marginTop: 12 }}>
                      <Num label="Depth %" value={event.depthPct} min={0} max={100} disabled={busyAny}
                        onChange={(v) => patchEvent(event.id, { depthPct: v })} />
                      <Num
                        label="Delta depth %" value={event.deltaDepthPct} min={0} max={100} disabled={busyAny}
                        hint="Below Depth % for ischemia — equal values leave band ratios flat"
                        onChange={(v) => patchEvent(event.id, { deltaDepthPct: v })}
                      />
                    </div>
                  </>
                )}

                {event.type === "artifact" && (
                  <div className="lab-grid4">
                    <Pick label="Kind" value={event.kind} options={asOptions(ARTIFACT_KINDS)} disabled={busyAny}
                      onChange={(v) => patchEvent(event.id, { kind: v })} />
                    <Num label="At min" value={event.atMin} min={0} max={durationMin} disabled={busyAny}
                      onChange={(v) => patchEvent(event.id, { atMin: v })} />
                    <Num label="Duration s" value={event.durationS} min={1} disabled={busyAny}
                      onChange={(v) => patchEvent(event.id, { durationS: v })} />
                    <Pick label="Intensity" value={event.intensity} options={asOptions(["low", "medium", "high"])} disabled={busyAny}
                      onChange={(v) => patchEvent(event.id, { intensity: v })} />
                    <Pick label="Side" value={event.side} options={asOptions(["all", "left", "right"])} disabled={busyAny}
                      onChange={(v) => patchEvent(event.id, { side: v })} />
                  </div>
                )}

                {event.type === "state_change" && (
                  <div className="lab-grid2">
                    <Num label="At min" value={event.atMin} min={0} max={durationMin} disabled={busyAny}
                      onChange={(v) => patchEvent(event.id, { atMin: v })} />
                    <Pick label="To" value={event.to} options={asOptions(["sleep", "wake", "arousal"])} disabled={busyAny}
                      onChange={(v) => patchEvent(event.id, { to: v })} />
                  </div>
                )}
              </div>
            ))}

            <div className="lab-chips" style={{ marginTop: 4 }}>
              {(Object.keys(EVENT_TYPE_LABELS) as GuidedEvent["type"][]).map((type) => (
                <button key={type} type="button" style={mini} disabled={busyAny} onClick={() => addEvent(type)}>
                  + {EVENT_TYPE_LABELS[type]}
                </button>
              ))}
            </div>

            <h2 style={{ ...h2, marginTop: 22 }}>Bedside annotations</h2>
            <p style={{ ...meta, marginTop: 6, marginBottom: 12, lineHeight: 1.55 }}>
              What the bedside team wrote on the time axis — &ldquo;Lorazepam 0.1 mg/kg&rdquo;.
              These <strong>are</strong> visible to the learner, so do not name the finding in one.
            </p>
            {guided.annotations.map((a) => (
              <div className="lab-grid3" key={a.id} style={{ marginBottom: 10, alignItems: "end" }}>
                <Num label="At min" value={a.atMin} min={0} max={durationMin} disabled={busyAny}
                  onChange={(v) => setGuided((g) => ({
                    ...g, annotations: g.annotations.map((x) => x.id === a.id ? { ...x, atMin: v } : x),
                  }))} />
                <label style={{ display: "block" }}>
                  <span style={fieldLabel}>Label</span>
                  <input
                    type="text" value={a.label} maxLength={60} disabled={busyAny} style={inp}
                    onChange={(e) => setGuided((g) => ({
                      ...g, annotations: g.annotations.map((x) => x.id === a.id ? { ...x, label: e.target.value } : x),
                    }))}
                  />
                </label>
                <button
                  type="button" style={{ ...mini, alignSelf: "center" }} disabled={busyAny}
                  onClick={() => setGuided((g) => ({ ...g, annotations: g.annotations.filter((x) => x.id !== a.id) }))}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button" style={mini} disabled={busyAny}
              onClick={() => setGuided((g) => ({ ...g, annotations: [...g.annotations, defaultAnnotation(durationMin)] }))}
            >
              + Annotation
            </button>
          </section>
        )}

        {/* ── prose ──────────────────────────────────────────────────── */}
        {mode === "prose" && (
          <section style={{ ...card, padding: 18, marginBottom: 16 }}>
            <h2 style={h2}>Describe the recording</h2>
            <p style={{ ...meta, marginTop: 6, marginBottom: 12, lineHeight: 1.55 }}>
              The model writes a spec against the image-spec DSL and it is checked before you
              see it. The draft lands in Expert mode so you can read and edit every value
              before committing to an export.
            </p>
            <textarea
              value={prose}
              onChange={(e) => setProse(e.target.value)}
              disabled={busyAny}
              minLength={20}
              maxLength={4000}
              placeholder="Example: A four-hour PICU recording in a 6-month-old after cardiac arrest. Start discontinuous with a delta-dominant background, then a cluster of right-central seizures that escalates from one minute to four over two hours, a midazolam load at 150 minutes that drives the suppression ratio to 60 per cent, and chest physiotherapy artifact near the end."
              style={{ ...inp, minHeight: 150, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
              <button
                type="button" style={btnPrimary}
                disabled={busyAny || prose.trim().length < 20}
                onClick={() => void draftFromProse()}
              >
                {busy === "draft" ? "Drafting…" : "Draft the spec →"}
              </button>
              <span style={meta}>Drafting does not queue anything.</span>
            </div>
            {draftNote && <p style={{ ...meta, marginTop: 10 }}>{draftNote}</p>}
          </section>
        )}

        {/* ── expert ─────────────────────────────────────────────────── */}
        {mode === "expert" && (
          <section style={{ ...card, padding: 18, marginBottom: 16 }}>
            <h2 style={h2}>Spec</h2>
            <p style={{ ...meta, marginTop: 6, marginBottom: 12, lineHeight: 1.55 }}>
              YAML or JSON. Either a full image block (<code>kind / license / spec</code>) or the
              bare <code>spec</code> mapping. The spec&apos;s own <code>duration_min</code> wins over
              the duration control below.
            </p>
            <textarea
              value={specText}
              onChange={(e) => setSpecText(e.target.value)}
              disabled={busyAny}
              spellCheck={false}
              placeholder={"kind: qeeg_panel\nlicense: synthetic-original\nspec:\n  seed: 12345\n  age_group: child\n  duration_min: 120\n  background:\n    type: continuous\n    dominant_hz: 7\n    amplitude_uv: 40\n  events: []"}
              style={{ ...inp, minHeight: 340, resize: "vertical", fontFamily: "var(--mono-font)", fontSize: 12.5 }}
            />
            {draftNote && <p style={{ ...meta, marginTop: 10 }}>{draftNote}</p>}
          </section>
        )}

        {/* ── output ─────────────────────────────────────────────────── */}
        <section style={{ ...card, padding: 18, marginBottom: 16 }}>
          <h2 style={h2}>Output</h2>

          <div className="lab-grid3" style={{ marginTop: 12 }}>
            <Num
              label="Duration (minutes)" value={durationMin}
              min={DURATION_MIN_MINUTES} max={DURATION_MAX_MINUTES} step={10} disabled={busyAny}
              hint={`${DURATION_MIN_MINUTES}–${DURATION_MAX_MINUTES} min (up to 48 h)`}
              onChange={setDurationMin}
            />
            <Num
              label="Seed" value={seed} min={1} disabled={busyAny}
              hint="Same spec + seed = the same recording, every time"
              onChange={setSeed}
            />
            <div style={{ alignSelf: "end" }}>
              <button type="button" style={mini} disabled={busyAny} onClick={() => setSeed(randomSeed())}>
                New seed
              </button>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <span style={fieldLabel}>Formats</span>
            <div className="lab-chips">
              {LAB_FORMATS.map((f) => (
                <label key={f.id} style={{ ...meta, display: "flex", gap: 8, alignItems: "center" }} title={f.hint}>
                  <input
                    type="checkbox"
                    checked={formats.includes(f.id)}
                    disabled={busyAny}
                    onChange={(e) => setFormats((current) => (
                      e.target.checked
                        ? Array.from(new Set([...current, f.id]))
                        : current.filter((x) => x !== f.id)
                    ))}
                  />
                  {f.label}
                </label>
              ))}
            </div>
            {formats.length === 0 && (
              <p style={{ ...meta, color: "var(--accent-secondary)", marginTop: 6 }}>
                Pick at least one format.
              </p>
            )}
          </div>

          <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
            <label style={{ ...meta, display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox" checked={runPersyst} disabled={busyAny}
                onChange={(e) => setRunPersyst(e.target.checked)}
              />
              Run through Persyst after export
            </label>
            <p style={{ ...meta, marginTop: 6, lineHeight: 1.55 }}>
              A second job on the licensed workstation: <code>/Process</code>,{" "}
              <code>/DetectSeizures</code>, <code>/ExportCSV</code>. It runs separately so the
              recording can be kept and reprocessed if PSCLI faults — which it does on roughly
              one run in three.
            </p>
            {runPersyst && (
              <div className="lab-grid2" style={{ marginTop: 12 }}>
                <Pick
                  label="MMX preset" value={mmxPreset} disabled={busyAny}
                  options={LAB_MMX_PRESETS.map((p) => ({ id: p, label: p }))}
                  onChange={setMmxPreset}
                />
                <Pick
                  label="Export panel" value={panel} disabled={busyAny}
                  options={LAB_PERSYST_PANELS.map((p) => ({ id: p, label: p }))}
                  onChange={setPanel}
                />
              </div>
            )}
          </div>

          <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
            <label style={{ ...meta, display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox" checked={includeAnswers} disabled={busyAny}
                onChange={(e) => setIncludeAnswers(e.target.checked)}
              />
              <span style={{ color: includeAnswers ? "var(--accent-secondary)" : "var(--text-secondary)", fontWeight: 600 }}>
                Include answer key (instructor download)
              </span>
            </label>
            <p style={{ ...meta, marginTop: 6, lineHeight: 1.55 }}>
              The key is a separate file — the realized-event manifest — and it needs editor
              access of its own to download. It is never merged into the recording: the
              <code> .lay/.dat</code> and EDF+ files are exported without event annotations, so
              a learner scrolling the file cannot read the answer off the timeline.
            </p>
          </div>
        </section>

        {/* ── validation + submit ────────────────────────────────────── */}
        {validation && (validation.errors.length > 0 || validation.warnings.length > 0) && (
          <section style={{ ...card, padding: 16, marginBottom: 16 }}>
            {validation.errors.length > 0 && (
              <>
                <div style={{ ...eyebrow, color: "var(--accent-secondary)" }}>Errors</div>
                <ul style={{ margin: "8px 0 0", paddingLeft: 20, color: "var(--accent-secondary)", fontSize: 13.5, lineHeight: 1.6 }}>
                  {validation.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </>
            )}
            {validation.warnings.length > 0 && (
              <>
                <div style={{ ...eyebrow, marginTop: validation.errors.length ? 14 : 0 }}>Warnings</div>
                <ul style={{ margin: "8px 0 0", paddingLeft: 20, color: "var(--text-secondary)", fontSize: 13.5, lineHeight: 1.6 }}>
                  {validation.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </>
            )}
          </section>
        )}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 28 }}>
          {/* Hidden in prose mode: a dry run there re-drafts through the model,
              and a two-minute LLM call does not belong behind a button labelled
              "Validate". Drafting has its own button. */}
          {mode !== "prose" && (
            <button type="button" style={btnGhost} disabled={busyAny} onClick={() => void validateSpec()}>
              {busy === "validate" ? "Checking…" : "Validate"}
            </button>
          )}
          <button
            type="submit"
            style={btnPrimary}
            disabled={busyAny || formats.length === 0 || (mode === "prose")}
            title={mode === "prose" ? "Draft the spec first, then queue it from Expert mode." : undefined}
          >
            {busy === "submit" ? "Queueing…" : "Queue export"}
          </button>
          <span style={meta}>
            Exporting is asynchronous — a 24 h recording cannot be produced inside a web request.
          </span>
        </div>
      </form>

      {/* ── jobs ─────────────────────────────────────────────────────── */}
      <section style={{ ...card, padding: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={h2}>Queue</h2>
          <button type="button" style={mini} onClick={() => void loadJobs()}>Refresh</button>
        </div>

        {activeJobs.length === 0 && (
          <p style={{ ...meta, marginTop: 12 }}>Nothing in progress.</p>
        )}

        {activeJobs.map(jobRow)}
      </section>

      <section style={{ ...card, padding: 18, marginTop: 16 }}>
        <h2 style={h2}>Finished recordings</h2>
        <p style={{ ...meta, marginTop: 4 }}>
          Question-bank recordings are labelled with their item id; open one in the viewer or download it.
        </p>
        {finishedJobs.length === 0 && (
          <p style={{ ...meta, marginTop: 12 }}>Nothing finished yet.</p>
        )}
        {finishedJobs.map(jobRow)}
      </section>

      <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link href="/admin" style={btnGhost}>← Admin dashboard</Link>
        <Link href="/admin/eeg-lab/viewer" style={btnGhost}>EEG Lab Viewer</Link>
        <Link href="/admin/qbank" style={btnGhost}>Question bank</Link>
      </div>
    </div>
  );

  function jobRow(job: LabJob) {
    const bank = job.requestedBy?.startsWith("qbank:") ? job.requestedBy.slice("qbank:".length) : null;
    return (
          <div className="lab-job" key={job.id}>
            <div className="lab-chips">
              <span style={{
                fontFamily: "var(--mono-font)", fontSize: 11, textTransform: "uppercase",
                letterSpacing: ".05em", fontWeight: 700,
                color: STATUS_COLOR[job.status] ?? "var(--text-muted)",
              }}>
                {job.stage} · {job.status}
              </span>
              <span style={{ color: "var(--text)", fontSize: 13.5, fontFamily: "var(--mono-font)" }}>
                {job.recordingId ?? job.id.slice(0, 8)}
              </span>
              {bank && (
                <span style={{ ...meta, color: "var(--accent-primary)", fontWeight: 700 }}>{bank}</span>
              )}
              <span style={meta}>{humanDuration(job.durationS)}</span>
              <span style={meta}>{job.formats.join(", ")}</span>
              {job.options.runPersyst && <span style={meta}>persyst</span>}
              {job.options.includeAnswers && (
                <span style={{ ...meta, color: "var(--accent-secondary)" }}>key</span>
              )}
              <span style={meta}>{relativeAge(job.createdAt)}</span>
              {job.attempts > 1 && <span style={meta}>attempt {job.attempts}/{job.maxAttempts}</span>}
            </div>

            {job.error && (
              <div style={{ ...meta, color: "var(--accent-secondary)", marginTop: 6, lineHeight: 1.5 }}>
                {job.error}
                {job.lastExitCode != null && ` (exit ${job.lastExitCode})`}
              </div>
            )}

            {job.report?.baseline && job.report.baseline.ok === false && (
              <div style={{ ...meta, color: "var(--accent-secondary)", marginTop: 6, lineHeight: 1.5 }}>
                Baseline not usable by Persyst&apos;s stock auto-search
                {job.report.baseline.reasons?.length ? `: ${job.report.baseline.reasons.join("; ")}` : "."}
              </div>
            )}

            {job.report && (job.report.clippedSamples ?? 0) > 0 && (
              <div style={{ ...meta, color: "var(--accent-secondary)", marginTop: 6 }}>
                {job.report.clippedSamples} samples clipped — lower the amplitudes or raise the calibration.
              </div>
            )}

            {job.artifacts && Object.keys(job.artifacts).length > 0 && (
              <div className="lab-chips" style={{ marginTop: 8 }}>
                {job.status === "done" && (job.artifacts.edf || (job.artifacts.lay && job.artifacts.dat)) && (
                  <Link
                    href={`/admin/eeg-lab/viewer?job=${job.id}`}
                    style={{ ...mini, borderColor: "var(--accent-primary)", color: "var(--accent-primary)" }}
                  >
                    Open in viewer
                  </Link>
                )}
                {(Object.keys(job.artifacts) as LabArtifact[]).map((artifact) => (
                  <button
                    key={artifact}
                    type="button"
                    style={{
                      ...mini,
                      borderColor: isInstructorArtifact(artifact) ? "var(--accent-secondary)" : "var(--border)",
                      color: isInstructorArtifact(artifact) ? "var(--accent-secondary)" : "var(--text-secondary)",
                    }}
                    onClick={() => void download(job, artifact)}
                  >
                    {LAB_ARTIFACT_LABELS[artifact]}
                    {isInstructorArtifact(artifact) ? " · instructor" : ""}
                  </button>
                ))}
              </div>
            )}
          </div>
    );
  }
}
