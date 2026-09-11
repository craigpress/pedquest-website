"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRole } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import {
  DIFFICULTIES, QBANK_DOMAINS, QBANK_DOMAIN_LABELS, QBANK_POPULATIONS,
} from "@/lib/cases";
import { adminShellWide, btnGhost, btnPrimary, card, eyebrow, h1, inp, meta, mini, STATUS_COLORS } from "@/lib/admin-ui";

interface QueueItem {
  id: string;
  qbankId: string | null;
  title: string;
  leadIn: string | null;
  domain: string | null;
  population: string | null;
  setting: string | null;
  difficulty: string;
  questionType: string;
  imageUrl: string;
  tags: string[];
  publishDate: string | null;
  status: string;
  source: string;
  version: number;
  imageLicense: string | null;
  verifiedRefs: number;
  totalRefs: number;
  responseCount: number;
  updatedAt: string | null;
}

const STATUSES = ["pending_review", "draft", "approved", "published", "archived"];

interface GenerationJobRow {
  id: string;
  status: string;
  mode: string | null;
  domain: string | null;
  topic: string | null;
  model: string | null;
  caseId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

function relativeAge(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 90) return `${Math.round(secs)}s ago`;
  if (secs < 5400) return `${Math.round(secs / 60)}m ago`;
  if (secs < 172800) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

interface AttachmentRow {
  id: string;
  kind: "pdf" | "image";
  filename: string;
  byteSize: number;
  note: string | null;
  textChars: number | null;
  warning?: string | null;
}

export default function AdminQbankQueuePage() {
  const { isEditor, isAdmin, loading: roleLoading } = useRole();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [jobs, setJobs] = useState<GenerationJobRow[]>([]);
  // what the server has been asked for, debounced off `query`
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState("");
  const [domain, setDomain] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [population, setPopulation] = useState("");
  const [source, setSource] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"gallery" | "list">("gallery");
  const [showGenerate, setShowGenerate] = useState(false);
  const [generateDomain, setGenerateDomain] = useState("foundations");
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateMessage, setGenerateMessage] = useState<string | null>(null);
  const [generatedId, setGeneratedId] = useState<string | null>(null);
  // Attachments are uploaded before the job exists, so they are tied to a
  // client-generated batch id that the generate call passes along.
  const [attachBatch] = useState(() =>
    (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `b${Date.now()}${Math.random()}`)
      .replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32));
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachNote, setAttachNote] = useState("");

  const authHeaders = useCallback(async () => {
    const sb = getSupabase();
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : null;
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (status) p.set("status", status);
      if (domain) p.set("domain", domain);
      if (difficulty) p.set("difficulty", difficulty);
      if (population) p.set("population", population);
      if (source) p.set("source", source);
      if (search.trim()) p.set("q", search.trim());
      const res = await fetch(`/api/admin/qbank?${p.toString()}`, { headers: await authHeaders() });
      const json = await res.json();
      if (res.ok && json.success) { setItems(json.items); setCounts(json.counts ?? {}); setJobs(json.jobs ?? []); }
      else setError(json.error || "Could not load the queue.");
    } catch {
      setError("Network error loading the queue.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, status, domain, difficulty, population, source, search]);

  async function uploadAttachment(file: File) {
    setAttachBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("batch", attachBatch);
      if (attachNote.trim()) form.append("note", attachNote.trim());
      const headers = await authHeaders();
      // let the browser set the multipart boundary
      delete (headers as Record<string, string>)["Content-Type"];
      const res = await fetch("/api/admin/qbank/attachments", { method: "POST", headers, body: form });
      const json = await res.json();
      if (!res.ok || !json.success) { setError(json.error || "Upload failed."); return; }
      setAttachments((a) => [...a, {
        id: json.id, kind: json.kind, filename: json.filename,
        byteSize: file.size, note: attachNote.trim() || null,
        textChars: json.textChars ?? null, warning: json.warning ?? null,
      }]);
      setAttachNote("");
    } catch {
      setError("Upload failed.");
    } finally {
      setAttachBusy(false);
    }
  }

  async function removeAttachment(id: string) {
    setAttachBusy(true);
    try {
      await fetch(`/api/admin/qbank/attachments?id=${encodeURIComponent(id)}`, {
        method: "DELETE", headers: await authHeaders(),
      });
      setAttachments((a) => a.filter((x) => x.id !== id));
    } finally {
      setAttachBusy(false);
    }
  }

  async function generateQuestion(event: FormEvent) {
    event.preventDefault();
    setGenerating(true);
    setError(null);
    setGenerateMessage("Retrieving evidence and drafting the question…");
    setGeneratedId(null);
    try {
      const res = await fetch("/api/admin/qbank/generate", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          domain: generateDomain,
          prompt: generatePrompt,
          ...(attachments.length ? { attachmentBatch: attachBatch } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setGenerateMessage(null);
        setError(json.error || "Question generation failed.");
        return;
      }

      setGeneratedId(json.item.id);
      setGeneratePrompt("");
      setGenerateMessage(`Created ${json.item.qbankId}. Rendering its EEG image…`);
      await load();

      if (!json.item.renderJobId) {
        setGenerateMessage(`Created ${json.item.qbankId}; no render job was returned.`);
        return;
      }
      const started = Date.now();
      while (Date.now() - started < 180_000) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        const poll = await fetch(`/api/admin/qbank/render?jobId=${json.item.renderJobId}`, {
          headers: await authHeaders(),
        });
        const job = await poll.json();
        if (!poll.ok) throw new Error(job.error || "Could not check the image render.");
        if (job.status === "done") {
          setGenerateMessage(`${json.item.qbankId} is ready for review.`);
          await load();
          return;
        }
        if (job.status === "error") throw new Error(job.error || "Image rendering failed.");
      }
      setGenerateMessage(`${json.item.qbankId} was created; its image is still rendering.`);
    } catch (cause) {
      setGenerateMessage(null);
      setError(cause instanceof Error ? cause.message : "Question generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  // Clearing the generation log is admin-only and non-destructive: the rows are
  // hidden, not deleted, because a drafted job holds the evidence corpus that
  // "Revise with AI" re-feeds to the model.
  const [clearing, setClearing] = useState(false);
  async function clearJobs(scope: "failed" | "all") {
    const label = scope === "all" ? "every entry in" : "the failed entries from";
    if (!window.confirm(`Clear ${label} the generation log? The items themselves are not touched.`)) return;
    setClearing(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/qbank/generate?scope=${scope}`, {
        method: "DELETE", headers: await authHeaders(),
      });
      const json = await res.json();
      if (!res.ok || !json.success) { setError(json.error || "Could not clear the generation log."); return; }
      await load();
    } catch {
      setError("Network error clearing the generation log.");
    } finally {
      setClearing(false);
    }
  }

  // `query` is what the box shows; `search` is what the server has been asked
  // for. Without this the search box never reached the server.
  useEffect(() => {
    const t = setTimeout(() => setSearch(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => { if (isEditor) void load(); }, [isEditor, load]);

  // The server now does the searching, across the whole item (vignette,
  // options, rationales, references) rather than just the titles and tags
  // that happened to be on this page.
  const filtered = items;

  if (roleLoading) {
    return <div style={adminShellWide}><p style={{ color: "var(--text-muted)" }}>Loading…</p></div>;
  }
  if (!isEditor) {
    return (
      <div style={adminShellWide}>
        <h1 style={h1}>Editor access required</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: 10 }}>
          The question-bank console is limited to PedQuEST editors and admins.{" "}
          <Link href="/login">Sign in</Link>, or ask an admin to grant you the editor role.
        </p>
      </div>
    );
  }

  return (
    <div style={adminShellWide}>
      <style>{`
        .qb-filters { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
        .qb-counts { display: flex; gap: 8px; flex-wrap: wrap; }
        .qb-toolbar { display: flex; justify-content: space-between; gap: 12px; align-items: center;
          margin-bottom: 12px; }
        .qb-view-toggle { display: flex; gap: 6px; flex: 0 0 auto; }
        .qb-row { display: grid; grid-template-columns: 92px 1fr auto; gap: 14px; align-items: center;
          padding: 12px 16px; border-bottom: 1px solid var(--border); }
        .qb-thumb { width: 92px; height: 56px; border-radius: 8px; border: 1px solid var(--border);
          object-fit: cover; background: var(--bg); display: block; }
        .qb-items.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 16px; }
        .qb-items.gallery .qb-row { display: flex; flex-direction: column; align-items: stretch; gap: 0;
          padding: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 12px;
          background: var(--surface); }
        .qb-items.gallery .qb-thumb { width: 100%; height: 230px; border: 0;
          border-bottom: 1px solid var(--border); border-radius: 0; object-fit: contain; }
        .qb-items.gallery .qb-body { padding: 14px 14px 10px; flex: 1; }
        .qb-items.gallery .qb-actions { padding: 0 14px 14px; justify-content: flex-start !important; }
        .qb-empty { padding: 34px; text-align: center; color: var(--text-muted); }
        @media (max-width: 860px) {
          .qb-filters { grid-template-columns: 1fr 1fr; }
          .qb-items.list .qb-row { grid-template-columns: 1fr; }
          .qb-items.list .qb-thumb { width: 100%; height: 120px; object-fit: contain; }
        }
        @media (max-width: 560px) {
          .qb-toolbar { align-items: stretch; flex-direction: column; }
          .qb-items.gallery { grid-template-columns: 1fr; }
          .qb-generate-fields { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <div style={{ marginBottom: 20 }}>
        <span style={eyebrow}>Question bank</span>
        <h1 style={{ ...h1, marginTop: 6 }}>Review queue</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: 8, maxWidth: "62ch" }}>
          Nothing here is visible to learners until an editor approves it. Approval opens the item in the
          question bank; featuring it as Case of the Day is a separate, optional step. Approval needs an
          image license, at least one verified reference, and a reviewer who is not the item&apos;s author.
        </p>
        <button
          type="button"
          onClick={() => setShowGenerate((value) => !value)}
          aria-expanded={showGenerate}
          style={{ ...btnPrimary, marginTop: 14 }}
        >
          {showGenerate ? "Close generator" : "Generate question with AI"}
        </button>
      </div>

      {showGenerate && (
        <form onSubmit={generateQuestion} style={{ ...card, padding: 18, marginBottom: 18 }}>
          <h2 style={{ fontSize: 18, margin: 0 }}>New AI-assisted question</h2>
          <p style={{ ...meta, marginTop: 6, marginBottom: 14, lineHeight: 1.55 }}>
            Describe the clinical concept, learner level, and EEG or qEEG finding to test. The pipeline
            retrieves PubMed evidence, writes the answers and rationales, verifies citations, and renders
            an original synthetic image. Nothing is published automatically.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(180px, 0.3fr) 1fr", gap: 12 }} className="qb-generate-fields">
            <label style={meta}>
              Question domain
              <select value={generateDomain} onChange={(e) => setGenerateDomain(e.target.value)} style={{ ...inp, display: "block", width: "100%", marginTop: 5 }} disabled={generating}>
                {QBANK_DOMAINS.map((value) => <option key={value} value={value}>{QBANK_DOMAIN_LABELS[value]}</option>)}
              </select>
            </label>
            <label style={meta}>
              Prompt
              <textarea
                value={generatePrompt}
                onChange={(e) => setGeneratePrompt(e.target.value)}
                placeholder="Example: Create an intermediate PICU question distinguishing evolving electrographic seizure burden from rhythmic ventilator artifact on a four-hour qEEG panel."
                minLength={15}
                maxLength={1200}
                required
                disabled={generating}
                style={{ ...inp, display: "block", width: "100%", minHeight: 96, resize: "vertical", marginTop: 5 }}
              />
            </label>
          </div>
          <div style={{ borderTop: "1px solid var(--border)", marginTop: 14, paddingTop: 12 }}>
            <div style={eyebrow}>Source material (optional)</div>
            <p style={{ ...meta, marginTop: 6, marginBottom: 10, lineHeight: 1.55 }}>
              Attach a PDF to ground the item on, or a figure to base a synthetic version on.
              A reference image is never published — the item still gets an original rendered
              figure. You can also name a paper in the prompt (&ldquo;use PMID 34510095&rdquo; or a DOI)
              and it will be fetched and added to the evidence.
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input
                type="text"
                value={attachNote}
                onChange={(e) => setAttachNote(e.target.value)}
                placeholder="How to use the next file, e.g. make a synthetic version of this"
                maxLength={400}
                disabled={generating || attachBusy}
                style={{ ...inp, flex: "1 1 280px" }}
              />
              <label style={{ ...mini, cursor: attachBusy ? "wait" : "pointer", display: "inline-flex", alignItems: "center" }}>
                {attachBusy ? "Uploading…" : "Attach PDF or image"}
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/gif,image/webp"
                  disabled={generating || attachBusy}
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) void uploadAttachment(f);
                  }}
                />
              </label>
            </div>
            {attachments.length > 0 && (
              <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "flex", flexDirection: "column", gap: 6 }}>
                {attachments.map((a) => (
                  <li key={a.id} style={{ ...meta, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                    <span style={{ fontFamily: "var(--mono-font)" }}>{a.kind === "pdf" ? "PDF" : "IMG"}</span>
                    <span style={{ color: "var(--text)" }}>{a.filename}</span>
                    {a.note && <span>— {a.note}</span>}
                    {a.kind === "pdf" && a.textChars != null && (
                      <span>{a.textChars.toLocaleString()} characters read</span>
                    )}
                    {a.warning && <span style={{ color: "var(--accent-secondary)" }}>{a.warning}</span>}
                    <button type="button" style={mini} disabled={attachBusy} onClick={() => void removeAttachment(a.id)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            <button type="submit" style={btnPrimary} disabled={generating || generatePrompt.trim().length < 15}>
              {generating ? "Generating…" : "Create draft"}
            </button>
            {generateMessage && <span role="status" style={{ ...meta, color: "var(--accent-tertiary)" }}>{generateMessage}</span>}
            {generatedId && <Link href={`/admin/qbank/${generatedId}`} style={mini}>Open draft</Link>}
          </div>
        </form>
      )}

      {jobs.length > 0 && (
        <details style={{ ...card, padding: "12px 16px", marginBottom: 16 }}>
          <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
            AI generation queue
            {jobs.some((j) => j.status === "running" || j.status === "queued") && (
              <span style={{ ...meta, marginLeft: 8, color: "var(--accent-tertiary)" }}>
                {jobs.filter((j) => j.status === "running" || j.status === "queued").length} in progress
              </span>
            )}
            {jobs.some((j) => j.status === "failed") && (
              <span style={{ ...meta, marginLeft: 8, color: "var(--accent-secondary)" }}>
                {jobs.filter((j) => j.status === "failed").length} failed
              </span>
            )}
          </summary>
          {isAdmin && (
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button
                type="button"
                style={mini}
                disabled={clearing || !jobs.some((j) => j.status === "failed")}
                onClick={() => void clearJobs("failed")}
              >
                {clearing ? "Clearing…" : "Clear failed"}
              </button>
              <button type="button" style={mini} disabled={clearing} onClick={() => void clearJobs("all")}>
                Clear all
              </button>
              <span style={meta}>
                Admin only. Entries are hidden from this log; the drafts, items and their evidence stay.
              </span>
            </div>
          )}
          <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "flex", flexDirection: "column", gap: 8 }}>
            {jobs.map((j) => (
              <li key={j.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{
                    fontFamily: "var(--mono-font)", fontSize: 11, textTransform: "uppercase",
                    letterSpacing: ".05em",
                    color: j.status === "failed" ? "var(--accent-secondary)"
                      : j.status === "drafted" ? "var(--accent-tertiary)" : "var(--text-muted)",
                  }}>
                    {j.status}
                  </span>
                  <span style={{ color: "var(--text)", fontSize: 13 }}>
                    {j.topic ?? j.domain ?? "(no topic)"}
                  </span>
                  <span style={meta}>{relativeAge(j.createdAt)}</span>
                  {j.model && <span style={meta}>{j.model}</span>}
                  {j.caseId && <Link href={`/admin/qbank/${j.caseId}`} style={mini}>Open</Link>}
                </div>
                {j.error && (
                  <div style={{ ...meta, color: "var(--accent-secondary)", marginTop: 4, lineHeight: 1.5 }}>
                    {j.error}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="qb-counts" style={{ marginBottom: 16 }}>
        {["all", ...STATUSES].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s === "all" ? "" : s)}
            style={{
              ...mini,
              borderColor: (s === "all" ? status === "" : status === s) ? "var(--accent-primary)" : "var(--border)",
              color: s === "all" ? "var(--text-secondary)" : (STATUS_COLORS[s] ?? "var(--text-secondary)"),
              fontWeight: (s === "all" ? status === "" : status === s) ? 700 : 500,
            }}
          >
            {s.replace("_", " ")} · {counts[s === "all" ? "all" : s] ?? 0}
          </button>
        ))}
        <span style={{ ...meta, alignSelf: "center" }}>in bank: {counts.bank ?? 0}</span>
      </div>

      <div className="qb-toolbar">
        <div className="qb-filters" style={{ flex: 1 }}>
          <select value={domain} onChange={(e) => setDomain(e.target.value)} style={inp} aria-label="Domain">
            <option value="">All domains</option>
            {QBANK_DOMAINS.map((d) => <option key={d} value={d}>{QBANK_DOMAIN_LABELS[d]}</option>)}
          </select>
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} style={inp} aria-label="Difficulty">
            <option value="">All difficulties</option>
            {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={population} onChange={(e) => setPopulation(e.target.value)} style={inp} aria-label="Population">
            <option value="">All populations</option>
            {QBANK_POPULATIONS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value)} style={inp} aria-label="Source">
            <option value="">Any source</option>
            <option value="team">Team-written</option>
            <option value="ai">Pipeline draft</option>
          </select>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all text — stem, options, rationales, references"
            style={inp}
            aria-label="Search items"
          />
        </div>
        <div className="qb-view-toggle" aria-label="Queue layout">
          {(["gallery", "list"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setView(mode)}
              aria-pressed={view === mode}
              style={{ ...mini, borderColor: view === mode ? "var(--accent-primary)" : "var(--border)", fontWeight: view === mode ? 700 : 500 }}
            >
              {mode === "gallery" ? "Gallery" : "List"}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" style={{ ...card, borderColor: "var(--accent-secondary)", padding: "12px 16px", marginBottom: 14, color: "var(--accent-secondary)", fontSize: 14 }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading items…</p>
      ) : (
        <div className={`qb-items ${view}`} style={view === "list" ? { ...card, overflow: "hidden" } : undefined}>
          {filtered.length === 0 && (
            <div className="qb-empty" style={view === "gallery" ? { ...card, gridColumn: "1 / -1" } : undefined}>
              Nothing matches these filters. Import content with{" "}
              <code>npm run qbank:import</code> or wait for the weekly generation cron.
            </div>
          )}
          {filtered.map((i) => {
            const refsOk = i.verifiedRefs > 0;
            return (
              <div className="qb-row" key={i.id}>
                {i.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="qb-thumb" src={i.imageUrl} alt="" />
                ) : (
                  <div className="qb-thumb" style={{ display: "grid", placeItems: "center", color: "var(--text-muted)", fontFamily: "var(--mono-font)", fontSize: 10 }}>
                    no image
                  </div>
                )}
                <div className="qb-body">
                  <Link href={`/admin/qbank/${i.id}`} style={{ fontWeight: 600, color: "var(--text)" }}>
                    {i.title}
                  </Link>
                  <div style={{ ...meta, marginTop: 5, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ color: STATUS_COLORS[i.status] ?? "var(--text-muted)", fontWeight: 600 }}>● {i.status.replace("_", " ")}</span>
                    {i.qbankId && <span>{i.qbankId}</span>}
                    <span>v{i.version}</span>
                    {i.domain && <span>{QBANK_DOMAIN_LABELS[i.domain as keyof typeof QBANK_DOMAIN_LABELS] ?? i.domain}</span>}
                    <span>{i.difficulty}</span>
                    {i.population && <span>{i.population}</span>}
                    {i.setting && <span>{i.setting}</span>}
                    <span>{i.questionType === "point_to_feature" ? "point" : "quiz"}</span>
                    {i.source === "ai" && <span style={{ color: "var(--accent-secondary)" }}>pipeline draft</span>}
                  </div>
                  <div style={{ ...meta, marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ color: refsOk ? "var(--accent-tertiary)" : "var(--accent-secondary)" }}>
                      {i.verifiedRefs}/{i.totalRefs} refs verified
                    </span>
                    <span style={{ color: i.imageLicense ? "var(--text-muted)" : "var(--accent-secondary)" }}>
                      {i.imageLicense ?? "no license"}
                    </span>
                    {i.responseCount > 0 && <span>{i.responseCount} responses</span>}
                    {i.publishDate && <span>COTD {i.publishDate}</span>}
                  </div>
                </div>
                <div className="qb-actions" style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <Link href={`/admin/qbank/${i.id}`} style={mini}>Review</Link>
                  {(i.status === "published" || i.status === "approved") && (
                    <Link href={`/education/question-bank/${i.id}`} target="_blank" style={mini}>View ↗</Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link href="/admin" style={btnGhost}>← Admin dashboard</Link>
        <Link href="/admin/users" style={btnGhost}>Roles &amp; permissions</Link>
        <Link href="/education/question-bank" style={btnGhost}>Learner view</Link>
      </div>
    </div>
  );
}
