"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRole } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import {
  DIFFICULTIES, QBANK_BLOOMS, QBANK_DOMAINS, QBANK_DOMAIN_LABELS,
  QBANK_POPULATIONS, QBANK_SETTINGS,
  type CaseReference, type EegCase, type Region,
} from "@/lib/cases";
import {
  adminShellWide, btnGhost, btnPrimary, card, eyebrow, fieldLabel, h1, h2, inp, meta, mini, STATUS_COLORS,
} from "@/lib/admin-ui";

const LICENSES = [
  "", "synthetic-original", "dataset-derived", "consortium", "cc0", "cc-by",
  "cc-by-sa", "cc-by-nc", "cc-by-nd", "public-domain", "ai-original",
];

interface Revision {
  id: string; version: number; content: unknown;
  changedBy: string | null; changeNote: string | null; createdAt: string;
}
interface Review {
  id: string; reviewer: string | null; reviewerEmail: string | null;
  decision: string; notes: string | null; createdAt: string;
}
interface EditorItem {
  case: EegCase;
  references: CaseReference[];
  revisions: Revision[];
  reviews: Review[];
  renderJob: { id: string; status: string; imageUrl: string | null; error: string | null } | null;
}

interface Form {
  title: string;
  vignette: string;
  leadIn: string;
  imageCaption: string;
  questionPrompt: string;
  explanation: string;
  learningObjective: string;
  domain: string;
  population: string;
  setting: string;
  bloom: string;
  difficulty: string;
  keyPoints: string[];
  tagsText: string;
  imageLicense: string;
  imageAttribution: string;
  imageSourceUrl: string;
  options: { label: string; isCorrect: boolean; optionExplanation: string }[];
  references: (CaseReference & { checkResult?: string })[];
}

function toForm(item: EditorItem): Form {
  const c = item.case;
  return {
    title: c.title ?? "",
    vignette: c.clinicalVignette ?? "",
    leadIn: c.leadIn ?? "",
    imageCaption: c.imageCaption ?? "",
    questionPrompt: c.questionPrompt ?? "",
    explanation: c.explanation ?? "",
    learningObjective: c.learningObjective ?? "",
    domain: c.domain ?? "",
    population: c.population ?? "",
    setting: c.setting ?? "",
    bloom: c.bloom ?? "",
    difficulty: c.difficulty ?? "intermediate",
    keyPoints: (c.keyPoints?.length ? c.keyPoints : c.teachingPoints).slice(0, 6),
    tagsText: (c.tags ?? []).join(", "),
    imageLicense: c.imageLicense ?? "",
    imageAttribution: c.imageAttribution ?? "",
    imageSourceUrl: c.imageSourceUrl ?? "",
    options: c.options.map((o) => ({
      label: o.label, isCorrect: o.isCorrect, optionExplanation: o.optionExplanation ?? "",
    })),
    references: item.references.map((r) => ({ ...r })),
  };
}

export default function AdminQbankItemPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { isEditor, isAdmin, loading: roleLoading } = useRole();

  const [item, setItem] = useState<EditorItem | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showRegion, setShowRegion] = useState(true);
  const [reviewNotes, setReviewNotes] = useState("");
  const [publishDate, setPublishDate] = useState("");
  const [diffPair, setDiffPair] = useState<[number, number] | null>(null);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const authHeaders = useCallback(async () => {
    const sb = getSupabase();
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : null;
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/qbank/${id}`, { headers: await authHeaders() });
      const json = await res.json();
      if (res.ok && json.success) {
        setItem(json.item);
        setForm(toForm(json.item));
        setPublishDate(json.item.case.publishDate ?? new Date().toISOString().slice(0, 10));
      } else {
        setError(json.error || "Could not load this item.");
      }
    } catch {
      setError("Network error loading the item.");
    } finally {
      setLoading(false);
    }
  }, [id, authHeaders]);

  useEffect(() => { if (isEditor) void load(); }, [isEditor, load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/qbank/${id}`, {
        method: "POST", headers: await authHeaders(), body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        flash(okMessage);
        await load();
        return json;
      }
      // The publish gate's own message is the useful one — show it verbatim.
      setError(json.error || "The action failed.");
      return null;
    } catch {
      setError("Network error.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!form) return;
    await post({
      action: "save",
      item: {
        ...form,
        keyPoints: form.keyPoints.map((k) => k.trim()).filter(Boolean),
        tags: form.tagsText.split(",").map((t) => t.trim()).filter(Boolean),
        references: form.references,
      },
    }, "Saved.");
  }

  async function review(decision: "approved" | "changes_requested" | "rejected") {
    if (decision !== "approved" && !reviewNotes.trim()) {
      setError("Please say what needs to change — the note is what the author sees.");
      return;
    }
    const notes = reviewNotes.trim();
    const result = await post({ action: "review", decision, notes: notes || null }, `Recorded: ${decision.replace("_", " ")}.`);
    if (!result) return;
    setReviewNotes("");
    // For an AI item, "request changes" queues an automatic revision. Run it
    // now so the editor sees the revised draft + new image without waiting for
    // the weekly cron. If it fails, the job stays queued for the cron.
    if (decision === "changes_requested" && result.regeneration?.queued) {
      await regenerate(notes);
    }
  }

  async function pollRender(jobId: string): Promise<void> {
    if (!jobId) return;
    const started = Date.now();
    // The Python worker polls the queue; a render takes seconds, not minutes.
    while (Date.now() - started < 180000) {
      await new Promise((r) => setTimeout(r, 4000));
      const res = await fetch(`/api/admin/qbank/render?jobId=${jobId}`, { headers: await authHeaders() });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Could not poll the render job."); return; }
      if (json.status === "done") { flash("Rendered."); await load(); return; }
      if (json.status === "error") { setError(json.error || "The renderer reported an error."); return; }
    }
    flash("Still rendering — reload in a moment.");
  }

  async function rerender() {
    const result = await post({ action: "render" }, "Render queued.");
    if (!result?.jobId) return;
    setBusy(true);
    try { await pollRender(result.jobId); } finally { setBusy(false); }
  }

  // AI item only: feed the review feedback back to the model, re-critique,
  // re-render, and return the item to the queue as a new version.
  async function regenerate(feedback?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/qbank/${id}`, {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ action: "regenerate", ...(feedback ? { feedback } : {}) }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || "The AI revision failed — the item stays queued for the weekly run.");
        await load();
        return;
      }
      flash("Revised by AI — rendering the new image…");
      await load();
      if (json.renderJobId) await pollRender(json.renderJobId);
    } catch {
      setError("Network error during the AI revision.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyReference(index: number) {
    if (!form) return;
    const ref = form.references[index];
    if (!ref.pmid) {
      setError("That reference has no PMID to check.");
      return;
    }
    setBusy(true);
    try {
      const p = new URLSearchParams({ pmid: ref.pmid, citation: ref.citation ?? "" });
      const res = await fetch(`/api/admin/qbank/verify-pmid?${p.toString()}`, { headers: await authHeaders() });
      const json = await res.json();
      if (!res.ok) { setError(json.error || "Verification failed."); return; }
      const refs = [...form.references];
      refs[index] = {
        ...ref,
        verified: !!json.verified,
        verifiedBy: json.verified ? json.verifiedBy : ref.verifiedBy,
        checkResult: json.match && !json.match.ok
          ? `${json.summary} — ${json.match.reason}`
          : json.summary,
      };
      set({ references: refs });
      flash(json.verified ? "PMID verified." : "PMID did not verify — see the note.");
    } finally {
      setBusy(false);
    }
  }

  const region: Region | null = useMemo(() => {
    if (!item) return null;
    const sidecar = item.case.imageSidecar;
    const fromSidecar = sidecar && typeof sidecar === "object"
      ? ((sidecar as Record<string, unknown>).answer_region as Region | undefined)
      : undefined;
    return fromSidecar ?? item.case.correctRegion ?? null;
  }, [item]);

  if (roleLoading) return <div style={adminShellWide}><p style={{ color: "var(--text-muted)" }}>Loading…</p></div>;
  if (!isEditor) {
    return (
      <div style={adminShellWide}>
        <h1 style={h1}>Editor access required</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: 10 }}>
          Ask an admin for the editor role. <Link href="/login">Sign in</Link>
        </p>
      </div>
    );
  }
  if (loading || !item || !form) {
    return (
      <div style={adminShellWide}>
        <p style={{ color: "var(--text-muted)" }}>{error ?? "Loading item…"}</p>
        <Link href="/admin/qbank" style={{ ...mini, marginTop: 12, display: "inline-block" }}>← Back to the queue</Link>
      </div>
    );
  }

  const c = item.case;

  return (
    <div style={adminShellWide}>
      <style>{`
        .qbi-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 22px; align-items: start; }
        .qbi-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .qbi-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
        .qbi-diff { display: grid; grid-template-columns: 1fr 1fr; gap: 0; font-family: var(--mono-font); font-size: 11.5px; }
        @media (max-width: 980px) {
          .qbi-grid, .qbi-2, .qbi-3, .qbi-diff { grid-template-columns: 1fr; }
        }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <span style={eyebrow}>Question bank · review</span>
          <h1 style={{ ...h1, marginTop: 6 }}>{c.title}</h1>
          <div style={{ ...meta, marginTop: 8, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <span style={{ color: STATUS_COLORS[c.status] ?? "var(--text-muted)", fontWeight: 600 }}>● {c.status.replace("_", " ")}</span>
            {c.qbankId && <span>{c.qbankId}</span>}
            <span>v{c.version}</span>
            <span>{c.source === "ai" ? "pipeline draft" : "team-written"}</span>
            {c.specHash && <span>spec {c.specHash}</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
          <Link href="/admin/qbank" style={mini}>← Queue</Link>
          <button type="button" style={btnPrimary} onClick={save} disabled={busy}>Save changes</button>
        </div>
      </div>

      {error && (
        <div role="alert" style={{ ...card, borderColor: "var(--accent-secondary)", padding: "12px 16px", marginBottom: 16, color: "var(--accent-secondary)", fontSize: 14, whiteSpace: "pre-wrap" }}>
          {error}
        </div>
      )}

      <div className="qbi-grid">
        {/* ───────────── left: image, review, history ───────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <section style={{ ...card, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={eyebrow}>Rendered image</div>
              <div style={{ display: "flex", gap: 8 }}>
                {region && (
                  <button type="button" style={mini} onClick={() => setShowRegion((v) => !v)} aria-pressed={showRegion}>
                    {showRegion ? "Hide" : "Show"} answer region
                  </button>
                )}
                <button type="button" style={mini} onClick={rerender} disabled={busy || !c.spec}>
                  Re-render
                </button>
              </div>
            </div>
            {c.imageUrl ? (
              <ImageWithRegion src={c.imageUrl} alt={c.imageCaption ?? c.title} region={showRegion ? region : null} />
            ) : (
              <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)", border: "1px dashed var(--border)", borderRadius: 12 }}>
                No image yet. {c.spec ? "Re-render to produce one." : "This item has no image spec."}
              </div>
            )}
            {c.imageCaption && (
              <p style={{ color: "var(--text-secondary)", fontSize: 13.5, marginTop: 10, lineHeight: 1.55 }}>{c.imageCaption}</p>
            )}
            {item.renderJob && (
              <p style={{ ...meta, marginTop: 8 }}>
                last render job: {item.renderJob.status}
                {item.renderJob.error ? ` — ${item.renderJob.error}` : ""}
              </p>
            )}
            {!region && c.questionType === "point_to_feature" && (
              <p style={{ ...meta, marginTop: 8, color: "var(--accent-secondary)" }}>
                This is a point-to-feature item with no answer region — re-render to get one from the spec.
              </p>
            )}
          </section>

          <section style={{ ...card, padding: 16 }}>
            <div style={eyebrow}>Review</div>
            <p style={{ ...meta, marginTop: 8 }}>
              {item.references.filter((r) => r.verified).length} of {item.references.length} references verified ·{" "}
              license {c.imageLicense ?? "not set"} ·{" "}
              {c.reviewedBy ? "reviewed" : "not yet reviewed"}
            </p>
            <label htmlFor="review-notes" style={{ ...fieldLabel, marginTop: 12 }}>Notes to the author</label>
            <textarea
              id="review-notes"
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              rows={3}
              style={{ ...inp, resize: "vertical" }}
              placeholder="Required for changes-requested and rejected."
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button type="button" style={btnPrimary} onClick={() => review("approved")} disabled={busy}>Approve</button>
              <button type="button" style={btnGhost} onClick={() => review("changes_requested")} disabled={busy}>Request changes</button>
              <button type="button" style={{ ...btnGhost, color: "var(--accent-secondary)" }} onClick={() => review("rejected")} disabled={busy}>Reject</button>
            </div>
            {item.case.source === "ai" && (
              <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 8, marginBottom: 0 }}>
                Requesting changes on this AI-drafted item automatically feeds your note back to the
                model, re-checks it, and re-renders the image.{" "}
                <button
                  type="button"
                  onClick={() => regenerate(reviewNotes.trim() || undefined)}
                  disabled={busy}
                  style={{ ...btnGhost, padding: "2px 8px", fontSize: 12 }}
                >
                  Revise with AI now
                </button>
              </p>
            )}

            <div style={{ borderTop: "1px solid var(--border)", marginTop: 16, paddingTop: 14 }}>
              <div style={eyebrow}>Schedule as Case of the Day</div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <input
                  type="date"
                  value={publishDate}
                  onChange={(e) => setPublishDate(e.target.value)}
                  style={{ ...inp, width: "auto" }}
                  aria-label="Publish date"
                />
                <button
                  type="button"
                  style={btnGhost}
                  disabled={busy}
                  onClick={() => post({ action: "schedule", publishDate }, "Published.")}
                >
                  Publish on this date
                </button>
              </div>
              <p style={{ ...meta, marginTop: 8 }}>
                Publishing runs the database gate: license, a verified reference, and a reviewer other than the author.
              </p>
            </div>

            <div style={{ borderTop: "1px solid var(--border)", marginTop: 16, paddingTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                style={mini}
                disabled={busy}
                onClick={() => post({ action: "bank", inBank: !c.inBank }, c.inBank ? "Removed from the bank." : "Added to the bank.")}
              >
                {c.inBank ? "Remove from bank" : "Add to bank"}
              </button>
              <button type="button" style={mini} disabled={busy} onClick={() => post({ action: "notify" }, "Editors notified.")}>
                Notify editors
              </button>
              {isAdmin && (
                <button
                  type="button"
                  style={{ ...mini, color: "var(--accent-secondary)" }}
                  disabled={busy}
                  onClick={() => {
                    if (confirm("Delete this item, its options, references and responses?")) {
                      void post({ action: "delete" }, "Deleted.");
                    }
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          </section>

          {item.reviews.length > 0 && (
            <section style={{ ...card, padding: 16 }}>
              <div style={eyebrow}>Review history</div>
              <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {item.reviews.map((r) => (
                  <li key={r.id} style={{ borderLeft: "2px solid var(--border)", paddingLeft: 10 }}>
                    <div style={{ ...meta }}>
                      {r.createdAt.slice(0, 16).replace("T", " ")} · {r.reviewerEmail ?? "unknown"} ·{" "}
                      <strong style={{ color: r.decision === "approved" ? "var(--accent-tertiary)" : "var(--accent-secondary)" }}>
                        {r.decision.replace("_", " ")}
                      </strong>
                    </div>
                    {r.notes && <div style={{ color: "var(--text-secondary)", fontSize: 13.5, marginTop: 3 }}>{r.notes}</div>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <RevisionHistory
            revisions={item.revisions}
            currentVersion={c.version}
            currentContent={c.content ?? null}
            diffPair={diffPair}
            onSelect={setDiffPair}
          />
        </div>

        {/* ───────────── right: the editable item ───────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <section style={{ ...card, padding: 16 }}>
            <div style={eyebrow}>Classification</div>
            <div className="qbi-2" style={{ marginTop: 10 }}>
              <Field label="Domain">
                <select value={form.domain} onChange={(e) => set({ domain: e.target.value })} style={inp}>
                  <option value="">—</option>
                  {QBANK_DOMAINS.map((d) => <option key={d} value={d}>{QBANK_DOMAIN_LABELS[d]}</option>)}
                </select>
              </Field>
              <Field label="Difficulty">
                <select value={form.difficulty} onChange={(e) => set({ difficulty: e.target.value })} style={inp}>
                  {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
            </div>
            <div className="qbi-3" style={{ marginTop: 10 }}>
              <Field label="Population">
                <select value={form.population} onChange={(e) => set({ population: e.target.value })} style={inp}>
                  <option value="">—</option>
                  {QBANK_POPULATIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Setting">
                <select value={form.setting} onChange={(e) => set({ setting: e.target.value })} style={inp}>
                  <option value="">—</option>
                  {QBANK_SETTINGS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Bloom">
                <select value={form.bloom} onChange={(e) => set({ bloom: e.target.value })} style={inp}>
                  <option value="">—</option>
                  {QBANK_BLOOMS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Learning objective" style={{ marginTop: 10 }}>
              <input value={form.learningObjective} onChange={(e) => set({ learningObjective: e.target.value })} style={inp} maxLength={240} />
            </Field>
            <Field label="Tags (comma separated)" style={{ marginTop: 10 }}>
              <input value={form.tagsText} onChange={(e) => set({ tagsText: e.target.value })} style={inp} />
            </Field>
          </section>

          <section style={{ ...card, padding: 16 }}>
            <div style={eyebrow}>Stem</div>
            <Field label="Title" style={{ marginTop: 10 }}>
              <input value={form.title} onChange={(e) => set({ title: e.target.value })} style={inp} maxLength={90} />
            </Field>
            <Field label="Vignette" style={{ marginTop: 10 }}>
              <textarea value={form.vignette} onChange={(e) => set({ vignette: e.target.value })} rows={7} style={{ ...inp, resize: "vertical" }} />
              <span style={meta}>{form.vignette.length} characters (200–1100)</span>
            </Field>
            <Field label="Image caption" style={{ marginTop: 10 }}>
              <textarea value={form.imageCaption} onChange={(e) => set({ imageCaption: e.target.value })} rows={3} style={{ ...inp, resize: "vertical" }} />
            </Field>
            <Field label="Lead-in" style={{ marginTop: 10 }}>
              <input value={form.leadIn} onChange={(e) => set({ leadIn: e.target.value })} style={inp} maxLength={200} />
            </Field>
            <Field label="Question prompt shown to the learner" style={{ marginTop: 10 }}>
              <input value={form.questionPrompt} onChange={(e) => set({ questionPrompt: e.target.value })} style={inp} />
            </Field>
          </section>

          <section style={{ ...card, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={eyebrow}>Options &amp; rationales</div>
              <button
                type="button"
                style={mini}
                onClick={() => set({ options: [...form.options, { label: "", isCorrect: false, optionExplanation: "" }] })}
              >
                + Option
              </button>
            </div>
            {form.options.length === 0 && (
              <p style={{ ...meta, marginTop: 10 }}>
                No options — this is a point-to-feature item, answered by clicking the tracing.
              </p>
            )}
            {form.options.map((o, i) => (
              <div key={i} style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <label style={{ ...meta, display: "flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}>
                    <input
                      type="radio"
                      name="correct-option"
                      checked={o.isCorrect}
                      onChange={() => set({ options: form.options.map((x, j) => ({ ...x, isCorrect: i === j })) })}
                    />
                    correct
                  </label>
                  <input
                    value={o.label}
                    onChange={(e) => set({ options: form.options.map((x, j) => (i === j ? { ...x, label: e.target.value } : x)) })}
                    style={inp}
                    placeholder={`Option ${String.fromCharCode(65 + i)}`}
                    maxLength={140}
                  />
                  <button
                    type="button"
                    style={mini}
                    aria-label={`Remove option ${i + 1}`}
                    onClick={() => set({ options: form.options.filter((_, j) => j !== i) })}
                  >
                    ✕
                  </button>
                </div>
                <textarea
                  value={o.optionExplanation}
                  onChange={(e) => set({ options: form.options.map((x, j) => (i === j ? { ...x, optionExplanation: e.target.value } : x)) })}
                  rows={2}
                  style={{ ...inp, resize: "vertical", marginTop: 8 }}
                  placeholder="Why this option is right or wrong (1–3 sentences)"
                  maxLength={500}
                />
              </div>
            ))}
          </section>

          <section style={{ ...card, padding: 16 }}>
            <div style={eyebrow}>Explanation &amp; key points</div>
            <Field label="Explanation" style={{ marginTop: 10 }}>
              <textarea value={form.explanation} onChange={(e) => set({ explanation: e.target.value })} rows={10} style={{ ...inp, resize: "vertical" }} />
              <span style={meta}>{form.explanation.length} characters (500–2200)</span>
            </Field>
            <div style={{ marginTop: 10 }}>
              <span style={fieldLabel}>Key points (3)</span>
              {[0, 1, 2].map((i) => (
                <input
                  key={i}
                  value={form.keyPoints[i] ?? ""}
                  onChange={(e) => {
                    const next = [...form.keyPoints];
                    next[i] = e.target.value;
                    set({ keyPoints: next });
                  }}
                  style={{ ...inp, marginBottom: 8 }}
                  placeholder={`Flashcard bullet ${i + 1} (≤ 20 words)`}
                  maxLength={160}
                />
              ))}
            </div>
          </section>

          <section style={{ ...card, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={eyebrow}>References</div>
              <button
                type="button"
                style={mini}
                onClick={() => set({
                  references: [...form.references, {
                    id: `new-${form.references.length}`, pmid: "", doi: null, url: null,
                    citation: "", role: "supporting", verified: false, verifiedBy: null,
                    openAccess: null, memberAuthor: false, sortOrder: form.references.length,
                  }],
                })}
              >
                + Reference
              </button>
            </div>
            {form.references.length === 0 && (
              <p style={{ ...meta, marginTop: 10, color: "var(--accent-secondary)" }}>
                No references. Approval requires at least one verified reference.
              </p>
            )}
            {form.references.map((r, i) => (
              <div key={r.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <input
                    value={r.pmid ?? ""}
                    onChange={(e) => set({ references: form.references.map((x, j) => (i === j ? { ...x, pmid: e.target.value.replace(/\D/g, "") } : x)) })}
                    style={{ ...inp, width: 130 }}
                    placeholder="PMID"
                    inputMode="numeric"
                  />
                  <select
                    value={r.role}
                    onChange={(e) => set({ references: form.references.map((x, j) => (i === j ? { ...x, role: e.target.value as "primary" | "supporting" } : x)) })}
                    style={{ ...inp, width: 150 }}
                  >
                    <option value="primary">primary</option>
                    <option value="supporting">supporting</option>
                  </select>
                  <button type="button" style={mini} onClick={() => verifyReference(i)} disabled={busy}>Verify PMID</button>
                  <span style={{ ...meta, color: r.verified ? "var(--accent-tertiary)" : "var(--accent-secondary)" }}>
                    {r.verified ? "verified" : "unverified"}
                  </span>
                  <button
                    type="button"
                    style={mini}
                    aria-label={`Remove reference ${i + 1}`}
                    onClick={() => set({ references: form.references.filter((_, j) => j !== i) })}
                  >
                    ✕
                  </button>
                </div>
                <textarea
                  value={r.citation}
                  onChange={(e) => set({ references: form.references.map((x, j) => (i === j ? { ...x, citation: e.target.value } : x)) })}
                  rows={2}
                  style={{ ...inp, resize: "vertical", marginTop: 8 }}
                  placeholder="Vancouver citation"
                  maxLength={400}
                />
                {r.checkResult && (
                  <p style={{ ...meta, marginTop: 6, color: r.verified ? "var(--text-muted)" : "var(--accent-secondary)" }}>
                    {r.checkResult}
                  </p>
                )}
              </div>
            ))}
          </section>

          <section style={{ ...card, padding: 16 }}>
            <div style={eyebrow}>Image licensing</div>
            <div className="qbi-2" style={{ marginTop: 10 }}>
              <Field label="License">
                <select value={form.imageLicense} onChange={(e) => set({ imageLicense: e.target.value })} style={inp}>
                  {LICENSES.map((l) => <option key={l} value={l}>{l || "— not set —"}</option>)}
                </select>
              </Field>
              <Field label="Source URL">
                <input value={form.imageSourceUrl} onChange={(e) => set({ imageSourceUrl: e.target.value })} style={inp} />
              </Field>
            </div>
            <Field label="Attribution / credit line" style={{ marginTop: 10 }}>
              <input value={form.imageAttribution} onChange={(e) => set({ imageAttribution: e.target.value })} style={inp} />
              <span style={meta}>Required unless the license is consortium, synthetic-original or ai-original.</span>
            </Field>
          </section>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" style={btnPrimary} onClick={save} disabled={busy}>Save changes</button>
            <button type="button" style={btnGhost} onClick={() => setForm(toForm(item))} disabled={busy}>Discard edits</button>
          </div>
        </div>
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: "var(--text)", color: "var(--bg)", padding: "11px 18px", borderRadius: 10, fontFamily: "var(--mono-font)", fontSize: 13, zIndex: 60 }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <label style={{ display: "block", ...style }}>
      <span style={fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

/** The rendered image with the renderer's answer region drawn over it. */
function ImageWithRegion({ src, alt, region }: { src: string; alt: string; region: Region | null }) {
  return (
    <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)", background: "var(--bg)", lineHeight: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} style={{ width: "100%", display: "block" }} />
      {region && (
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        >
          {region.kind === "rect" && (
            <rect
              x={region.x * 100} y={region.y * 100} width={region.w * 100} height={region.h * 100}
              fill="rgba(62,203,142,0.12)" stroke="var(--accent-tertiary)" strokeWidth={0.5} strokeDasharray="2 1.4"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {region.kind === "circle" && (
            <circle
              cx={region.cx * 100} cy={region.cy * 100} r={region.r * 100}
              fill="rgba(62,203,142,0.12)" stroke="var(--accent-tertiary)" strokeWidth={0.5} strokeDasharray="2 1.4"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {region.kind === "poly" && (
            <polygon
              points={region.points.map(([x, y]) => `${x * 100},${y * 100}`).join(" ")}
              fill="rgba(62,203,142,0.12)" stroke="var(--accent-tertiary)" strokeWidth={0.5} strokeDasharray="2 1.4"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      )}
    </div>
  );
}

// ---- revision history + side-by-side diff -------------------------------

function pretty(value: unknown): string[] {
  if (value == null) return ["(no content snapshot)"];
  try {
    return JSON.stringify(value, null, 2).split("\n");
  } catch {
    return [String(value)];
  }
}

/** Longest-common-subsequence line diff, enough for a JSON snapshot. */
function diffLines(a: string[], b: string[]): { left: string | null; right: string | null; same: boolean }[] {
  const n = a.length;
  const m = b.length;
  // Guard the O(n·m) table: a snapshot is a few hundred lines, not thousands.
  if (n * m > 400_000) {
    return [{ left: `(${n} lines)`, right: `(${m} lines)`, same: false }];
  }
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: { left: string | null; right: string | null; same: boolean }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ left: a[i], right: b[j], same: true }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push({ left: a[i], right: null, same: false }); i++; }
    else { out.push({ left: null, right: b[j], same: false }); j++; }
  }
  while (i < n) out.push({ left: a[i++], right: null, same: false });
  while (j < m) out.push({ left: null, right: b[j++], same: false });
  return out;
}

function RevisionHistory({
  revisions, currentVersion, currentContent, diffPair, onSelect,
}: {
  revisions: Revision[];
  currentVersion: number;
  currentContent: unknown;
  diffPair: [number, number] | null;
  onSelect: (pair: [number, number] | null) => void;
}) {
  // "current" is treated as one more entry so the newest revision can be
  // compared against what is live.
  const entries = useMemo(
    () => [
      { version: currentVersion, content: currentContent, label: "current", createdAt: "", changeNote: null as string | null },
      ...revisions.map((r) => ({
        version: r.version, content: r.content, label: `v${r.version}`,
        createdAt: r.createdAt, changeNote: r.changeNote,
      })),
    ],
    [revisions, currentVersion, currentContent],
  );

  const diff = useMemo(() => {
    if (!diffPair) return null;
    const left = entries.find((e) => e.version === diffPair[0]);
    const right = entries.find((e) => e.version === diffPair[1]);
    if (!left || !right) return null;
    return { left, right, rows: diffLines(pretty(left.content), pretty(right.content)) };
  }, [diffPair, entries]);

  if (revisions.length === 0) {
    return (
      <section style={{ ...card, padding: 16 }}>
        <div style={eyebrow}>Revision history</div>
        <p style={{ ...meta, marginTop: 8 }}>No revisions yet — the first content edit creates one.</p>
      </section>
    );
  }

  return (
    <section style={{ ...card, padding: 16 }}>
      <div style={eyebrow}>Revision history</div>
      <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {entries.map((e, i) => (
          <li key={`${e.version}-${i}`} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--mono-font)", fontSize: 12, color: "var(--accent-primary)", fontWeight: 600, minWidth: 62 }}>
              {e.label}
            </span>
            <span style={meta}>{e.createdAt ? e.createdAt.slice(0, 16).replace("T", " ") : "live"}</span>
            {e.changeNote && <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>{e.changeNote}</span>}
            {i < entries.length - 1 && (
              <button
                type="button"
                style={mini}
                onClick={() => onSelect([entries[i + 1].version, e.version])}
              >
                diff vs {entries[i + 1].label}
              </button>
            )}
          </li>
        ))}
      </ul>

      {diff && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={meta}>{`${diff.left.label} → ${diff.right.label}`}</span>
            <button type="button" style={mini} onClick={() => onSelect(null)}>Close diff</button>
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "auto", maxHeight: 420 }}>
            <div className="qbi-diff">
              <div style={{ borderRight: "1px solid var(--border)" }}>
                {diff.rows.map((r, i) => (
                  <div key={i} style={{
                    padding: "1px 8px", whiteSpace: "pre-wrap", wordBreak: "break-word",
                    background: r.same ? "transparent" : r.left ? "color-mix(in srgb, var(--accent-secondary) 12%, transparent)" : "transparent",
                    color: r.same ? "var(--text-muted)" : "var(--text)",
                  }}>
                    {r.left ?? ""}
                  </div>
                ))}
              </div>
              <div>
                {diff.rows.map((r, i) => (
                  <div key={i} style={{
                    padding: "1px 8px", whiteSpace: "pre-wrap", wordBreak: "break-word",
                    background: r.same ? "transparent" : r.right ? "color-mix(in srgb, var(--accent-tertiary) 12%, transparent)" : "transparent",
                    color: r.same ? "var(--text-muted)" : "var(--text)",
                  }}>
                    {r.right ?? ""}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
