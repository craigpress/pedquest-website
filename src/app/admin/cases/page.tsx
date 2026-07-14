"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import type { EegCase, QuestionType, Difficulty } from "@/lib/cases";

const ADMIN_EMAILS = ["pressca@chop.edu", "craigpress@gmail.com", "gbenedet@med.umich.edu", "ajay.thomas@bcm.edu"];

type AdminCase = EegCase & { responseCount: number };

interface EditState {
  id?: string;
  title: string;
  clinicalVignette: string;
  imageUrl: string;
  questionType: QuestionType;
  questionPrompt: string;
  explanation: string;
  teachingPointsText: string;
  tagsText: string;
  difficulty: Difficulty;
  options: { label: string; isCorrect: boolean; optionExplanation: string }[];
  region: { x: number; y: number; w: number; h: number };
  regionTolerance: number;
  publishDate: string;
  status: string;
  source: string;
  aiSourceUrl: string;
}

function blankEdit(): EditState {
  return {
    title: "", clinicalVignette: "", imageUrl: "", questionType: "multiple_choice", questionPrompt: "",
    explanation: "", teachingPointsText: "", tagsText: "", difficulty: "intermediate",
    options: [{ label: "", isCorrect: true, optionExplanation: "" }, { label: "", isCorrect: false, optionExplanation: "" }],
    region: { x: 0.4, y: 0.1, w: 0.2, h: 0.8 }, regionTolerance: 0.03,
    publishDate: "", status: "draft", source: "team", aiSourceUrl: "",
  };
}
function fromCase(c: AdminCase): EditState {
  const r = c.correctRegion && c.correctRegion.kind === "rect" ? c.correctRegion : { x: 0.4, y: 0.1, w: 0.2, h: 0.8 };
  return {
    id: c.id, title: c.title, clinicalVignette: c.clinicalVignette ?? "", imageUrl: c.imageUrl,
    questionType: c.questionType, questionPrompt: c.questionPrompt, explanation: c.explanation ?? "",
    teachingPointsText: c.teachingPoints.join("\n"), tagsText: c.tags.join(", "), difficulty: c.difficulty,
    options: c.options.length ? c.options.map((o) => ({ label: o.label, isCorrect: o.isCorrect, optionExplanation: o.optionExplanation ?? "" }))
      : [{ label: "", isCorrect: true, optionExplanation: "" }],
    region: { x: r.x, y: r.y, w: r.w, h: r.h }, regionTolerance: c.regionTolerance ?? 0.03,
    publishDate: c.publishDate ?? "", status: c.status, source: c.source, aiSourceUrl: c.aiSourceUrl ?? "",
  };
}

const STATUS_COLORS: Record<string, string> = {
  published: "var(--accent-tertiary)", approved: "var(--accent-tertiary)",
  pending_review: "var(--accent-secondary)", draft: "var(--text-muted)", archived: "var(--text-muted)",
};

export default function AdminCasesPage() {
  const { user, loading: userLoading } = useUser();
  const isAdmin = !!user?.email && ADMIN_EMAILS.includes(user.email.toLowerCase());
  const [cases, setCases] = useState<AdminCase[]>([]);
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2400); };

  const authHeaders = useCallback(async (json = true) => {
    const sb = getSupabase();
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : null;
    return { ...(json ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/cases", { headers: await authHeaders() });
      const json = await res.json();
      if (res.ok && json.success) setCases(json.cases);
      else flash(json.error || "Could not load cases.");
    } finally { setLoading(false); }
  }, [authHeaders]);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  async function lifecycle(id: string, action: string) {
    if (action === "delete" && !confirm("Delete this case and all its responses?")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/cases", { method: "POST", headers: await authHeaders(), body: JSON.stringify({ action, id }) });
      const json = await res.json();
      if (res.ok && json.success) { flash(`Case ${action}d.`); load(); } else flash(json.error || "Action failed.");
    } finally { setBusy(false); }
  }

  async function save() {
    if (!edit) return;
    if (!edit.title.trim() || !edit.questionPrompt.trim()) { flash("Title and question prompt are required."); return; }
    setBusy(true);
    try {
      const payload = {
        action: "save",
        case: {
          id: edit.id, title: edit.title, clinicalVignette: edit.clinicalVignette, imageUrl: edit.imageUrl,
          questionType: edit.questionType, questionPrompt: edit.questionPrompt, explanation: edit.explanation,
          teachingPoints: edit.teachingPointsText.split("\n").map((s) => s.trim()).filter(Boolean),
          tags: edit.tagsText.split(",").map((s) => s.trim()).filter(Boolean),
          difficulty: edit.difficulty, status: edit.status, source: edit.source, aiSourceUrl: edit.aiSourceUrl || null,
          publishDate: edit.publishDate || null,
          options: edit.questionType === "multiple_choice" ? edit.options : [],
          correctRegion: edit.questionType === "point_to_feature" ? { kind: "rect", ...edit.region } : null,
          regionTolerance: edit.questionType === "point_to_feature" ? edit.regionTolerance : null,
        },
      };
      const res = await fetch("/api/admin/cases", { method: "POST", headers: await authHeaders(), body: JSON.stringify(payload) });
      const json = await res.json();
      if (res.ok && json.success) { flash("Saved."); setEdit(null); load(); } else flash(json.error || "Save failed.");
    } finally { setBusy(false); }
  }

  async function generate() {
    const topic = prompt("Topic or finding for the AI to draft a case about (e.g. 'burst suppression after hypoxic-ischemic injury'):");
    if (!topic) return;
    setBusy(true); flash("Generating with AI…");
    try {
      const res = await fetch("/api/admin/cases/generate", { method: "POST", headers: await authHeaders(), body: JSON.stringify({ topic }) });
      const json = await res.json();
      if (res.ok && json.success) { flash("Draft created — review it in the list."); load(); } else flash(json.error || "Generation failed.");
    } finally { setBusy(false); }
  }

  async function uploadImage(file: File) {
    if (!edit) return;
    setBusy(true); flash("Uploading image…");
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/admin/cases/upload", { method: "POST", headers: await authHeaders(false), body: fd });
      const json = await res.json();
      if (res.ok && json.success) { setEdit({ ...edit, imageUrl: json.url }); flash("Image uploaded."); }
      else flash(json.error || "Upload failed.");
    } finally { setBusy(false); }
  }

  if (userLoading) return <Shell><p style={{ color: "var(--text-muted)" }}>Loading…</p></Shell>;
  if (!isAdmin) return <Shell><h1 style={h1}>Admin access required</h1><p style={{ color: "var(--text-secondary)" }}>Sign in with an authorized account to manage cases.</p></Shell>;

  return (
    <Shell>
      <style>{`
        .cases-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .cases-row-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
        @media (max-width: 640px) {
          .cases-row-2 { grid-template-columns: 1fr; }
          .cases-row-4 { grid-template-columns: 1fr 1fr; }
        }
      `}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 22 }}>
        <div>
          <h1 style={h1}>qEEG Case of the Day — admin</h1>
          <p style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: 13, margin: "4px 0 0" }}>{cases.length} cases</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button style={btnGhost} onClick={generate} disabled={busy}>✦ Generate with AI</button>
          <button style={btnPrimary} onClick={() => setEdit(blankEdit())} disabled={busy}>+ New case</button>
        </div>
      </div>

      {loading ? <p style={{ color: "var(--text-muted)" }}>Loading cases…</p> : (
        <div style={{ border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", background: "var(--bg-card)" }}>
          {cases.length === 0 && <div style={{ padding: 30, color: "var(--text-muted)", textAlign: "center" }}>No cases yet. Create one or generate a draft.</div>}
          {cases.map((c) => (
            <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center", padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
              <div>
                <div style={{ fontWeight: 600, color: "var(--text)" }}>{c.title}</div>
                <div style={{ display: "flex", gap: 10, marginTop: 5, flexWrap: "wrap", fontFamily: "monospace", fontSize: 11.5, color: "var(--text-muted)" }}>
                  <span style={{ color: STATUS_COLORS[c.status] || "var(--text-muted)", fontWeight: 600 }}>● {c.status}</span>
                  <span>{c.questionType === "point_to_feature" ? "point" : "quiz"}</span>
                  <span>{c.difficulty}</span>
                  <span>{c.publishDate ?? "no date"}</span>
                  <span>{c.responseCount} responses</span>
                  {c.source === "ai" && <span style={{ color: "var(--accent-secondary)" }}>AI draft</span>}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {c.responseCount > 0 && <Link href={`/education/case-of-the-day/${c.id}`} target="_blank" style={mini}>Stats ↗</Link>}
                <button style={mini} onClick={() => setEdit(fromCase(c))}>Edit</button>
                {c.status !== "published" && <button style={mini} onClick={() => lifecycle(c.id, "publish")}>Publish</button>}
                {c.status === "pending_review" && <button style={mini} onClick={() => lifecycle(c.id, "approve")}>Approve</button>}
                {c.status === "published" && <button style={mini} onClick={() => lifecycle(c.id, "archive")}>Archive</button>}
                <button style={{ ...mini, color: "var(--accent-primary)" }} onClick={() => lifecycle(c.id, "delete")}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {edit && (
        <Editor edit={edit} setEdit={setEdit} onSave={save} onClose={() => setEdit(null)} onUpload={uploadImage} busy={busy} />
      )}
      {toast && (
        <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: "var(--text)", color: "var(--bg)", padding: "11px 18px", borderRadius: 10, fontFamily: "monospace", fontSize: 13, zIndex: 60 }}>{toast}</div>
      )}
    </Shell>
  );
}

function Editor({ edit, setEdit, onSave, onClose, onUpload, busy }:
  { edit: EditState; setEdit: (e: EditState) => void; onSave: () => void; onClose: () => void; onUpload: (f: File) => void; busy: boolean }) {
  const set = (patch: Partial<EditState>) => setEdit({ ...edit, ...patch });
  return (
    <div role="dialog" aria-modal="true" aria-label="Edit case" onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(5,10,20,.5)", zIndex: 50, display: "flex", justifyContent: "flex-end" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: 560, maxWidth: "94vw", height: "100%", background: "var(--bg-card)", borderLeft: "1px solid var(--border)", overflowY: "auto", padding: "22px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontFamily: "var(--heading-font)", fontSize: "1.3rem", color: "var(--text)", margin: 0 }}>{edit.id ? "Edit case" : "New case"}</h2>
          <button style={mini} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <Field label="Title" required><input style={inp} value={edit.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Clinical vignette (de-identified)"><textarea style={inp} rows={2} value={edit.clinicalVignette} onChange={(e) => set({ clinicalVignette: e.target.value })} /></Field>

        <Field label="Case image">
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input style={{ ...inp, flex: 1, minWidth: 200 }} placeholder="/images/... or https://…" value={edit.imageUrl} onChange={(e) => set({ imageUrl: e.target.value })} />
            <label style={{ ...mini, cursor: "pointer" }}>Upload<input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} /></label>
          </div>
          {edit.imageUrl && (/* eslint-disable-next-line @next/next/no-img-element */
            <img src={edit.imageUrl} alt="" style={{ marginTop: 8, width: "100%", borderRadius: 10, border: "1px solid var(--border)" }} />)}
          <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>Use only licensed / de-identified images. No patient identifiers.</span>
        </Field>

        <div className="cases-row-2">
          <Field label="Question type">
            <select style={inp} value={edit.questionType} onChange={(e) => set({ questionType: e.target.value as QuestionType })}>
              <option value="multiple_choice">Multiple choice</option>
              <option value="point_to_feature">Point to feature</option>
            </select>
          </Field>
          <Field label="Difficulty">
            <select style={inp} value={edit.difficulty} onChange={(e) => set({ difficulty: e.target.value as Difficulty })}>
              <option value="introductory">Introductory</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
            </select>
          </Field>
        </div>

        <Field label="Question prompt" required><input style={inp} value={edit.questionPrompt} onChange={(e) => set({ questionPrompt: e.target.value })} /></Field>

        {edit.questionType === "multiple_choice" ? (
          <Field label="Answer options (select the correct one)">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {edit.options.map((o, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <input type="radio" name="correct" checked={o.isCorrect} aria-label={`Option ${i + 1} is correct`}
                    onChange={() => set({ options: edit.options.map((x, j) => ({ ...x, isCorrect: j === i })) })} style={{ marginTop: 12 }} />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                    <input style={inp} placeholder={`Option ${i + 1}`} value={o.label} onChange={(e) => set({ options: edit.options.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />
                    <input style={{ ...inp, fontSize: 12 }} placeholder="Why (shown on reveal)" value={o.optionExplanation} onChange={(e) => set({ options: edit.options.map((x, j) => j === i ? { ...x, optionExplanation: e.target.value } : x) })} />
                  </div>
                  {edit.options.length > 2 && <button style={mini} onClick={() => set({ options: edit.options.filter((_, j) => j !== i) })} aria-label="Remove option">✕</button>}
                </div>
              ))}
              <button style={{ ...mini, alignSelf: "flex-start" }} onClick={() => set({ options: [...edit.options, { label: "", isCorrect: false, optionExplanation: "" }] })}>+ Add option</button>
            </div>
          </Field>
        ) : (
          <Field label="Correct region (normalized 0–1 rectangle)">
            <div className="cases-row-4">
              {(["x", "y", "w", "h"] as const).map((k) => (
                <label key={k} style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-muted)" }}>{k}
                  <input style={{ ...inp, marginTop: 2 }} type="number" step="0.01" min="0" max="1" value={edit.region[k]}
                    onChange={(e) => set({ region: { ...edit.region, [k]: parseFloat(e.target.value) || 0 } })} />
                </label>
              ))}
            </div>
            <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>x,y = top-left corner; w,h = size, as fractions of the image.</span>
          </Field>
        )}

        <Field label="Explanation (shown after answering)"><textarea style={inp} rows={3} value={edit.explanation} onChange={(e) => set({ explanation: e.target.value })} /></Field>
        <Field label="Teaching points (one per line)"><textarea style={inp} rows={3} value={edit.teachingPointsText} onChange={(e) => set({ teachingPointsText: e.target.value })} /></Field>
        <div className="cases-row-2">
          <Field label="Tags (comma-separated)"><input style={inp} value={edit.tagsText} onChange={(e) => set({ tagsText: e.target.value })} /></Field>
          <Field label="Publish date"><input style={inp} type="date" value={edit.publishDate} onChange={(e) => set({ publishDate: e.target.value })} /></Field>
        </div>
        <Field label="Status">
          <select style={inp} value={edit.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="draft">Draft</option><option value="pending_review">Pending review</option>
            <option value="approved">Approved</option><option value="published">Published</option><option value="archived">Archived</option>
          </select>
        </Field>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6, position: "sticky", bottom: 0, background: "var(--bg-card)", paddingTop: 12 }}>
          <button style={btnGhost} onClick={onClose}>Cancel</button>
          <button style={btnPrimary} onClick={onSave} disabled={busy}>{busy ? "Saving…" : "Save case"}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>{label}{required && <span style={{ color: "var(--accent-primary)" }}> *</span>}</span>
      {children}
    </label>
  );
}
function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: 940, margin: "0 auto", padding: "3rem 1.5rem 5rem" }}>{children}</div>;
}

const h1: React.CSSProperties = { fontFamily: "var(--heading-font)", fontSize: "1.7rem", color: "var(--text)", margin: 0 };
const inp: React.CSSProperties = { padding: "9px 11px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", font: "inherit", fontSize: 14, width: "100%" };
const btnPrimary: React.CSSProperties = { padding: "9px 16px", borderRadius: 9, border: "none", background: "var(--accent-primary)", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 14 };
const btnGhost: React.CSSProperties = { padding: "9px 16px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text)", fontWeight: 600, cursor: "pointer", fontSize: 14 };
const mini: React.CSSProperties = { padding: "5px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-secondary)", cursor: "pointer", fontSize: 12.5, fontFamily: "monospace", textDecoration: "none" };
