"use client";

/**
 * Recording page — the detail + review screen for one EEG Library recording.
 * Loads /api/admin/lab/jobs/<id>/review, which is the single source for the
 * job row, the author's title/description suggestion, what was authored into
 * the recording (the answer key), and what this viewer is allowed to do.
 *
 * Editors only, same gate as the console. Every write here re-checks
 * server-side (`can` on the GET is a UI convenience, not the authorization).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useRole } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import {
  adminShellWide, btnGhost, btnPrimary, card, eyebrow, fieldLabel, h1, inp, meta, mini,
} from "@/lib/admin-ui";
import {
  LAB_ARTIFACT_LABELS, LAB_REVIEW_STATUS_LABELS, isInstructorArtifact,
  type LabArtifact, type LabJob, type LabReview,
} from "@/lib/lab/types";
import { humanDuration, labelize, type LibraryQuestion, type LibrarySummary } from "@/lib/lab/library";

const REVIEW_STATUS_COLOR: Record<string, string> = {
  published: "var(--accent-tertiary)",
  pending_review: "var(--accent-primary)",
  draft: "var(--text-muted)",
  archived: "var(--accent-secondary)",
};

const DECISION_COLOR: Record<string, string> = {
  approved: "var(--accent-tertiary)",
  changes_requested: "var(--accent-secondary)",
  rejected: "var(--accent-secondary)",
};

const DECISION_LABEL: Record<string, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  rejected: "Rejected",
};

interface Can {
  edit: boolean;
  submit: boolean;
  withdraw: boolean;
  review: boolean;
  unpublish: boolean;
  revise: boolean;
}

interface ReviewData {
  job: LabJob;
  reviews: LabReview[];
  authorEmail: string | null;
  reviewerEmail: string | null;
  question: LibraryQuestion | null;
  summary: LibrarySummary;
  suggestion: { title: string; description: string };
  can: Can;
  viewerId: string;
  role: string;
}

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
function minutes(v: number): string {
  return v % 1 === 0 ? `${v}` : v.toFixed(1);
}

/** Start a browser download without opening a tab. */
function triggerDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function RecordingPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = params?.jobId;
  const router = useRouter();
  const { isEditor, loading: roleLoading } = useRole();

  const [data, setData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviseNotes, setReviseNotes] = useState("");

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000); };

  const authHeaders = useCallback(async () => {
    const sb = getSupabase();
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : null;
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }, []);

  const load = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/lab/jobs/${jobId}/review`, { headers: await authHeaders() });
      const json = await res.json();
      if (res.ok && json.success) {
        const d = json as ReviewData;
        setData(d);
        setTitle(d.job.title ?? d.suggestion.title);
        setDescription(d.job.description ?? d.suggestion.description);
      } else {
        setError(json.error || "Could not load this recording.");
      }
    } catch {
      setError("Network error loading the recording.");
    } finally {
      setLoading(false);
    }
  }, [jobId, authHeaders]);

  useEffect(() => { if (isEditor) void load(); }, [isEditor, load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (!jobId) return null;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/lab/jobs/${jobId}/review`, {
        method: "POST", headers: await authHeaders(), body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        flash(okMessage);
        await load();
        return json;
      }
      setError(json.error || "The action failed.");
      return null;
    } catch {
      setError("Network error.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** Feed the feedback to the model; the route queues a NEW export as this
   *  editor's draft and we move to it — the original stays as it was. */
  async function reviseWithAi(feedback: string) {
    if (!jobId) return;
    setBusy(true);
    setError(null);
    setProgress("Feeding the notes to the model and queueing a revised export — this takes a minute…");
    try {
      const res = await fetch(`/api/admin/lab/jobs/${jobId}/review`, {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ action: "revise", ...(feedback ? { feedback } : {}) }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || "The AI revision failed — nothing was queued.");
        return;
      }
      flash("Revised — the new export is queued. Opening it…");
      router.push(`/admin/eeg-lab/library/${json.job.id}`);
    } catch {
      setError("Network error during the AI revision.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  async function download(job: LabJob, artifacts: LabArtifact[]) {
    const instructor = artifacts.filter(isInstructorArtifact);
    if (instructor.length) {
      const ok = window.confirm(
        `${instructor.map((a) => LAB_ARTIFACT_LABELS[a]).join(" and ")} is the INSTRUCTOR copy — it carries the ground truth ` +
        "for this recording. Do not hand it to a learner. Download it?",
      );
      if (!ok) return;
    }
    setError(null);
    try {
      const headers = await authHeaders();
      const urls: string[] = [];
      for (const artifact of artifacts) {
        const res = await fetch(`/api/admin/lab/jobs/${job.id}/download?artifact=${artifact}`, { headers });
        const json = await res.json();
        if (!res.ok || !json.success) {
          setError(json.error || "Could not issue a download link.");
          return;
        }
        urls.push(json.url as string);
      }
      for (const url of urls) triggerDownload(url);
    } catch {
      setError("Could not issue a download link.");
    }
  }

  if (roleLoading) return <div style={adminShellWide}><p style={{ color: "var(--text-muted)" }}>Loading…</p></div>;
  if (!isEditor) {
    return (
      <div style={adminShellWide}>
        <h1 style={h1}>Editors only</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: 10 }}>
          The recording page is available to editors. <Link href="/admin/eeg-lab/library">Back to the library</Link>.
        </p>
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div style={adminShellWide}>
        <p style={{ color: "var(--text-muted)" }}>{error ?? "Loading recording…"}</p>
        <Link href="/admin/eeg-lab/library" style={{ ...mini, marginTop: 12, display: "inline-block" }}>← Back to the library</Link>
      </div>
    );
  }

  const { job, reviews, authorEmail, question, summary, suggestion, can, viewerId } = data;
  const hasEdf = !!job.artifacts?.edf;
  const hasPersyst = !!(job.artifacts?.lay && job.artifacts?.dat);
  const hasAnswers = !!job.artifacts?.answers;
  const isAuthor = job.authorId === viewerId;
  const latestChangeRequest = reviews.find((r) => r.decision === "changes_requested" && r.notes)?.notes ?? "";
  const reviseFeedback = reviseNotes.trim() || latestChangeRequest;

  return (
    <div style={adminShellWide}>
      <style>{`
        .rp-chips { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .rp-chip { font-family: var(--mono-font); font-size: 11.5px; padding: 2px 8px; border-radius: 999px;
          border: 1px solid var(--border); color: var(--text-secondary); white-space: nowrap; }
        .rp-findings { display: flex; flex-wrap: wrap; gap: 6px 14px; color: var(--text-secondary); font-size: 13.5px; line-height: 1.5; }
        .rp-findings b { color: var(--text); font-weight: 600; }
        .rp-kv { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; font-size: 13px;
          font-family: var(--mono-font); color: var(--text-secondary); }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <span style={eyebrow}>EEG Teaching Lab · Recording</span>
          <h1 style={{ ...h1, marginTop: 6 }}>
            {job.title ?? <em style={{ color: "var(--text-muted)" }}>{suggestion.title}</em>}
          </h1>
          <div className="rp-chips" style={{ marginTop: 10 }}>
            <span style={{ color: REVIEW_STATUS_COLOR[job.reviewStatus] ?? "var(--text-muted)", fontWeight: 600 }}>
              ● {LAB_REVIEW_STATUS_LABELS[job.reviewStatus]}
            </span>
            <span style={meta}>{job.recordingId ?? job.id.slice(0, 8)}</span>
            {job.source === "ai" ? (
              <span className="rp-chip">AI generated</span>
            ) : authorEmail ? (
              <span style={meta}>{authorEmail}</span>
            ) : null}
            <span style={meta}>{humanDuration(job.durationS)}</span>
            {job.formats.length > 0 && <span style={meta}>{job.formats.join(", ")}</span>}
          </div>
          <div className="rp-chips" style={{ marginTop: 6 }}>
            <span style={meta}>Created {shortDate(job.createdAt)}</span>
            {job.submittedAt && <span style={meta}>· Submitted {shortDate(job.submittedAt)}</span>}
            {job.publishedAt && <span style={meta}>· Published {shortDate(job.publishedAt)}</span>}
            {question && (
              <Link href={`/admin/qbank/${question.caseId}`} style={mini}>
                Question {question.qbankId}: {question.title ?? "untitled"}
              </Link>
            )}
          </div>
          {job.grandfathered && (
            <p style={{ ...meta, marginTop: 8, color: "var(--accent-secondary)" }}>
              Legacy — published at migration without a review.
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignSelf: "flex-start", flexWrap: "wrap" }}>
          <Link href="/admin/eeg-lab/library" style={mini}>← Library</Link>
          <Link href="/admin/eeg-lab/review" style={mini}>Review queue</Link>
        </div>
      </div>

      {error && (
        <div role="alert" style={{ ...card, borderColor: "var(--accent-secondary)", padding: "12px 16px", marginBottom: 16, color: "var(--accent-secondary)", fontSize: 14, whiteSpace: "pre-wrap" }}>
          {error}
        </div>
      )}
      {progress && (
        <div role="status" style={{ ...card, borderColor: "var(--accent-primary)", padding: "12px 16px", marginBottom: 16, color: "var(--text-secondary)", fontSize: 14 }}>
          {progress}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {/* ── actions ─────────────────────────────────────────────────── */}
        <section style={{ ...card, padding: 16 }}>
          <div className="rp-chips">
            {(hasEdf || hasPersyst) && (
              <Link href={`/admin/eeg-lab/viewer?job=${job.id}`} style={{ ...btnPrimary, textDecoration: "none" }}>
                Open in viewer
              </Link>
            )}
            {hasEdf && (
              <button type="button" style={mini} onClick={() => void download(job, ["edf"])}>EDF+</button>
            )}
            {hasPersyst && (
              <button type="button" style={mini} onClick={() => void download(job, ["lay", "dat"])}>Persyst (.lay + .dat)</button>
            )}
            {hasAnswers && (
              <button
                type="button"
                style={{ ...mini, borderColor: "var(--accent-secondary)", color: "var(--accent-secondary)" }}
                onClick={() => void download(job, ["answers"])}
              >
                Answer key · instructor
              </button>
            )}
            <Link href={`/admin/eeg-lab/library/${job.id}/results`} style={mini}>Class results</Link>
          </div>
        </section>

        {/* ── title and description ──────────────────────────────────── */}
        {can.edit && (
          <section style={{ ...card, padding: 16 }}>
            <div style={eyebrow}>Title and description</div>
            <p style={{ ...meta, marginTop: 8 }}>
              Learner-visible. Say what kind of recording this is and who it is for — not what is in it; the
              findings are the answer.
            </p>
            <div style={{ marginTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <label style={fieldLabel} htmlFor="rp-title">Title</label>
                <button type="button" style={{ ...mini, padding: "2px 8px" }} onClick={() => setTitle(suggestion.title)}>
                  Use suggestion
                </button>
              </div>
              <input id="rp-title" style={inp} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
            </div>
            <div style={{ marginTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <label style={fieldLabel} htmlFor="rp-desc">Description</label>
                <button type="button" style={{ ...mini, padding: "2px 8px" }} onClick={() => setDescription(suggestion.description)}>
                  Use suggestion
                </button>
              </div>
              <textarea
                id="rp-desc" style={{ ...inp, resize: "vertical" }} rows={4}
                value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000}
              />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
              <button
                type="button" style={btnPrimary} disabled={busy}
                onClick={() => post({ action: "save", title, description }, "Saved.")}
              >
                Save
              </button>
              {can.submit && (
                <button
                  type="button" style={btnGhost} disabled={busy}
                  onClick={() => post({ action: "submit", title, description }, "Submitted for review.")}
                >
                  Submit for review
                </button>
              )}
              {can.withdraw && (
                <button
                  type="button" style={mini} disabled={busy}
                  onClick={() => post({ action: "withdraw" }, "Withdrawn.")}
                >
                  Withdraw
                </button>
              )}
              {can.submit && <span style={meta}>Submitting sends this to another editor for approval.</span>}
            </div>
          </section>
        )}

        {/* ── what was authored into it ──────────────────────────────── */}
        <section style={{ ...card, padding: 16 }}>
          <div style={eyebrow}>What was authored into it</div>
          <p style={{ ...meta, marginTop: 8 }}>Not shown to learners.</p>
          <div className="rp-findings" style={{ marginTop: 10 }}>
            {summary.background && <span><b>Background</b> {labelize(summary.background)}</span>}
            {summary.backgroundDetail && <span>{summary.backgroundDetail}</span>}
            {summary.aeegPattern && (
              <span><b>aEEG pattern</b> {summary.aeegPattern}{summary.sleepWakeCycling ? ` · SWC ${labelize(summary.sleepWakeCycling)}` : ""}</span>
            )}
          </div>
          {summary.findings.length > 0 && (
            <div className="rp-findings" style={{ marginTop: 8 }}>
              {summary.findings.map((f, i) => (
                <span key={i}>
                  <b>{labelize(f.type)}</b>
                  {f.detail ? ` ${f.detail}` : ""}
                  {f.atMin !== null ? ` at ${minutes(f.atMin)} min` : ""}
                </span>
              ))}
            </div>
          )}
          {summary.findings.length === 0 && !summary.aeegPattern && (
            <p style={{ ...meta, marginTop: 8 }}>Background only — no authored events.</p>
          )}
          {summary.annotations.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <span style={fieldLabel}>Bedside notes in the record</span>
              <ul style={{ margin: "4px 0 0 18px", padding: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>
                {summary.annotations.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}
        </section>

        {/* ── export report ──────────────────────────────────────────── */}
        <section style={{ ...card, padding: 16 }}>
          <div style={eyebrow}>Export report</div>
          {job.status !== "done" && (
            <p style={{ ...meta, marginTop: 8, color: "var(--accent-secondary)" }}>
              Status: {job.status}. The export must finish before this recording can be submitted.
            </p>
          )}
          {job.error && (
            <p style={{ ...meta, marginTop: 8, color: "var(--accent-secondary)" }}>{job.error}</p>
          )}
          {job.report && Object.keys(job.report).length > 0 ? (
            <div className="rp-kv" style={{ marginTop: 10 }}>
              {Object.entries(job.report).map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <span>{k}</span>
                  <span>{typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ ...meta, marginTop: 8 }}>No report data.</p>
          )}
        </section>

        {/* ── review ──────────────────────────────────────────────────── */}
        {(can.review || can.unpublish || (isAuthor && job.reviewStatus === "pending_review")) && (
          <section style={{ ...card, padding: 16 }}>
            <div style={eyebrow}>Review</div>
            {can.review && (
              <>
                <p style={{ ...meta, marginTop: 8 }}>
                  Open the recording in the viewer and check it against the title, description and the authored
                  findings before approving.
                </p>
                <label htmlFor="rp-review-notes" style={{ ...fieldLabel, marginTop: 12 }}>
                  Notes to the author — required for changes-requested and rejected
                </label>
                <textarea
                  id="rp-review-notes"
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  rows={3}
                  style={{ ...inp, resize: "vertical" }}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <button
                    type="button" style={btnPrimary} disabled={busy}
                    onClick={async () => {
                      const r = await post({ action: "review", decision: "approved", notes: reviewNotes.trim() || null }, "Approved.");
                      if (r) setReviewNotes("");
                    }}
                  >
                    Approve
                  </button>
                  <button
                    type="button" style={btnGhost} disabled={busy}
                    onClick={async () => {
                      if (!reviewNotes.trim()) { setError("Say what needs to change — the note is what the author sees."); return; }
                      const r = await post({ action: "review", decision: "changes_requested", notes: reviewNotes.trim() }, "Recorded: changes requested.");
                      if (r) setReviewNotes("");
                    }}
                  >
                    Request changes
                  </button>
                  <button
                    type="button" style={{ ...btnGhost, color: "var(--accent-secondary)" }} disabled={busy}
                    onClick={async () => {
                      if (!reviewNotes.trim()) { setError("Say what needs to change — the note is what the author sees."); return; }
                      const r = await post({ action: "review", decision: "rejected", notes: reviewNotes.trim() }, "Recorded: rejected.");
                      if (r) setReviewNotes("");
                    }}
                  >
                    Reject
                  </button>
                </div>
              </>
            )}
            {!can.review && isAuthor && job.reviewStatus === "pending_review" && (
              <p style={{ ...meta, marginTop: 8 }}>
                You made this recording — another editor has to review it.
              </p>
            )}
            {job.reviewStatus === "pending_review" && (
              <div style={{ marginTop: 12 }}>
                <button type="button" style={mini} disabled={busy} onClick={() => post({ action: "notify" }, "Editors notified.")}>
                  Notify editors
                </button>
              </div>
            )}
            {can.unpublish && (
              <div style={{ borderTop: can.review ? "1px solid var(--border)" : undefined, marginTop: 14, paddingTop: can.review ? 14 : 0 }}>
                <button
                  type="button"
                  style={{ ...btnGhost, color: "var(--accent-secondary)" }}
                  disabled={busy}
                  onClick={() => {
                    if (confirm("Take this recording out of the library? Members will no longer see it.")) {
                      void post({ action: "unpublish" }, "Unpublished.");
                    }
                  }}
                >
                  Unpublish
                </button>
              </div>
            )}
          </section>
        )}

        {/* ── AI revision ────────────────────────────────────────────── */}
        {can.revise && (
          <section style={{ ...card, padding: 16 }}>
            <div style={eyebrow}>AI revision</div>
            <p style={{ ...meta, marginTop: 8 }}>
              The model edits this recording&apos;s spec from your notes and queues a new export as your draft.
              This recording is left as it is; the revised one is linked to it and lands in
              {" "}<Link href="/admin/eeg-lab/review">My recordings</Link> once the worker has exported it.
            </p>
            {job.parentJobId && (
              <p style={{ ...meta, marginTop: 6 }}>
                This recording is itself an AI revision of{" "}
                <Link href={`/admin/eeg-lab/library/${job.parentJobId}`}>{job.parentJobId.slice(0, 8)}</Link>.
              </p>
            )}
            <label htmlFor="rp-revise-notes" style={{ ...fieldLabel, marginTop: 12 }}>
              What should change{latestChangeRequest ? " — blank uses the latest changes-requested note" : ""}
            </label>
            <textarea
              id="rp-revise-notes"
              value={reviseNotes}
              onChange={(e) => setReviseNotes(e.target.value)}
              placeholder={latestChangeRequest || "e.g. move the seizure onset to 40 min and make the asymmetry right-sided"}
              rows={3}
              style={{ ...inp, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button
                type="button" style={btnPrimary} disabled={busy || !reviseFeedback}
                onClick={() => void reviseWithAi(reviseFeedback)}
              >
                Revise with AI
              </button>
              {!reviseFeedback && <span style={meta}>Write a note first.</span>}
            </div>
          </section>
        )}

        {/* ── review history ─────────────────────────────────────────── */}
        <section style={{ ...card, padding: 16 }}>
          <div style={eyebrow}>Review history</div>
          {reviews.length === 0 ? (
            <p style={{ ...meta, marginTop: 8 }}>No reviews yet.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {reviews.map((r) => (
                <li key={r.id} style={{ borderLeft: "2px solid var(--border)", paddingLeft: 10 }}>
                  <div style={meta}>
                    {r.createdAt.slice(0, 16).replace("T", " ")} · {r.reviewerEmail ?? "unknown"} ·{" "}
                    <strong style={{ color: DECISION_COLOR[r.decision] ?? "var(--text-secondary)" }}>
                      {DECISION_LABEL[r.decision] ?? r.decision}
                    </strong>
                  </div>
                  {r.notes && <div style={{ color: "var(--text-secondary)", fontSize: 13.5, marginTop: 3 }}>{r.notes}</div>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: "var(--text)", color: "var(--bg)", padding: "11px 18px", borderRadius: 10, fontFamily: "var(--mono-font)", fontSize: 13, zIndex: 60 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
