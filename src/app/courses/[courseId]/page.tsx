"use client";

/**
 * One course. Two completely different screens behind one URL, because the
 * API decides which: a teacher gets the roster, the gradebook and the class
 * KPIs; an enrolled student gets their own assignment list and nothing about
 * anyone else. `canManage` on the payload is the discriminator — the client
 * never picks, and every write is re-authorized server-side.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useUser } from "@/lib/auth";
import { switchToUser } from "@/lib/impersonation";
import { getSupabase } from "@/lib/supabase";
import {
  adminShellWide, btnGhost, btnPrimary, card, eyebrow, fieldLabel, h1, inp, meta, mini,
} from "@/lib/admin-ui";
import { displayTitle, humanDuration, type LibraryEntry } from "@/lib/lab/library";
import {
  COURSE_STATUS_LABELS, SUBMISSION_COLORS, SUBMISSION_LABELS, isDone, teacherNames,
  type CourseAssignment, type CourseDetail, type CourseDetailStudent, type CourseDetailTeacher,
  type CoursePerson, type CourseStatus, type SubmissionState, type SubmissionStatus,
} from "@/lib/courses/types";

/** What a teacher almost always wants to say; editable before the assignment is created. */
const DEFAULT_INSTRUCTIONS =
  "Mark every electrographic seizure from onset to offset and say which channels or region.";

const STATUS_COLOR: Record<CourseStatus, string> = {
  draft: "var(--text-muted)",
  active: "var(--accent-tertiary)",
  archived: "var(--accent-secondary)",
};
const ORDER: SubmissionStatus[] = ["not_started", "in_progress", "submitted", "returned"];

type Headers = () => Promise<Record<string, string>>;

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
/** a date input wants YYYY-MM-DD, never the full timestamp the API returns */
function dateValue(iso: string | null): string {
  return shortDate(iso);
}
function isPast(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}
function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}
function score(v: number | null): string {
  return v === null ? "—" : `${Math.round(v)}`;
}
function num1(v: number | null): string {
  return v === null ? "—" : v.toFixed(1);
}
function secs(v: number | null): string {
  return v === null ? "—" : `${Math.round(v)} s`;
}

function StatusChip({ status }: { status: CourseStatus }) {
  return <span style={{ ...meta, color: STATUS_COLOR[status], fontWeight: 600 }}>● {COURSE_STATUS_LABELS[status]}</span>;
}

function DemoChip() {
  return (
    <span title="Owned by a test account; every editor can run it to demonstrate courses" style={{ ...meta, color: "var(--accent-secondary)", fontWeight: 600 }}>
      Demo class
    </span>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const frac = total > 0 ? done / total : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 130 }}>
      <div style={{ flex: 1, height: 7, borderRadius: 999, background: "var(--border)", overflow: "hidden" }}>
        <div style={{ width: `${Math.round(frac * 100)}%`, height: "100%", background: "var(--accent-tertiary)" }} />
      </div>
      <span style={meta}>{done}/{total}</span>
    </div>
  );
}

/** The four submission states of one assignment as one bar, widths proportional to counts. */
function StackedBar({ counts }: { counts: Record<SubmissionStatus, number> }) {
  const total = ORDER.reduce((s, k) => s + counts[k], 0);
  if (!total) return <span style={meta}>No students yet</span>;
  return (
    <div style={{ display: "flex", height: 9, borderRadius: 999, overflow: "hidden", background: "var(--border)", minWidth: 150 }}>
      {ORDER.map((k) => counts[k] > 0 && (
        <div
          key={k}
          title={`${SUBMISSION_LABELS[k]}: ${counts[k]}`}
          style={{ width: `${(counts[k] / total) * 100}%`, background: SUBMISSION_COLORS[k] }}
        />
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
      {ORDER.map((k) => (
        <span key={k} style={{ ...meta, display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: SUBMISSION_COLORS[k], display: "inline-block" }} />
          {SUBMISSION_LABELS[k]}
        </span>
      ))}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ ...card, padding: "12px 14px" }}>
      <div style={fieldLabel}>{label}</div>
      <div style={{ fontFamily: "var(--mono-font)", fontSize: 20, color: "var(--text)" }}>{value}</div>
    </div>
  );
}

// ─── page ──────────────────────────────────────────────────────────────────

export default function CourseDetailPage() {
  const params = useParams<{ courseId: string }>();
  const courseId = params?.courseId;
  const { user, loading: userLoading } = useUser();
  const signedIn = !!user;

  const [data, setData] = useState<CourseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = useCallback<Headers>(async () => {
    const sb = getSupabase();
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : null;
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }, []);

  const load = useCallback(async () => {
    if (!courseId) return;
    setError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}`, { headers: await authHeaders() });
      const json = await res.json();
      if (res.ok && json.success) setData(json.course as CourseDetail);
      else setError(json.error || "This course is not available to you.");
    } catch {
      setError("Network error loading the course.");
    } finally {
      setLoading(false);
    }
  }, [courseId, authHeaders]);

  useEffect(() => { if (signedIn) void load(); }, [signedIn, load]);

  if (userLoading) return <div style={adminShellWide}><p style={{ color: "var(--text-muted)" }}>Loading…</p></div>;
  if (!signedIn) {
    return (
      <div style={adminShellWide}>
        <h1 style={h1}>Sign in to open this course</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: 10 }}>
          Courses are available to signed-in PedQuEST members. <Link href="/login">Sign in</Link>.
        </p>
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div style={adminShellWide}>
        <p style={{ color: "var(--text-muted)" }}>{error ?? "Loading course…"}</p>
        <Link href="/courses" style={{ ...mini, marginTop: 12, display: "inline-block" }}>← Courses</Link>
      </div>
    );
  }

  return data.canManage
    ? <TeacherView course={data} courseId={courseId!} authHeaders={authHeaders} reload={load} />
    : <StudentView course={data} courseId={courseId!} authHeaders={authHeaders} reload={load} />;
}

// ─── teacher ───────────────────────────────────────────────────────────────

function TeacherView({ course, courseId, authHeaders, reload }: {
  course: CourseDetailTeacher; courseId: string; authHeaders: Headers; reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // course header edit
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(course.title);
  const [description, setDescription] = useState(course.description);
  const [status, setStatus] = useState<CourseStatus>(course.status);
  const [startsAt, setStartsAt] = useState(dateValue(course.startsAt));
  const [endsAt, setEndsAt] = useState(dateValue(course.endsAt));

  // add-EEG picker
  const [pickerOpen, setPickerOpen] = useState(false);
  const [libQ, setLibQ] = useState("");
  const [libResults, setLibResults] = useState<LibraryEntry[]>([]);
  const [libDue, setLibDue] = useState("");

  // per-assignment inline edit
  const [editAssignment, setEditAssignment] = useState<string | null>(null);
  const [aTitle, setATitle] = useState("");
  const [aInstructions, setAInstructions] = useState("");
  const [aDue, setADue] = useState("");
  const [aPublished, setAPublished] = useState(true);

  // add-students panel
  const [addOpen, setAddOpen] = useState(false);
  const [peopleQ, setPeopleQ] = useState("");
  const [people, setPeople] = useState<CoursePerson[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [rawEmails, setRawEmails] = useState("");

  // gradebook cell panel
  const [cell, setCell] = useState<{ assignmentId: string; email: string } | null>(null);
  const [feedback, setFeedback] = useState("");

  const call = useCallback(async (path: string, method: string, body?: unknown) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(path, {
        method, headers: await authHeaders(), body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) { setErr(json.error || "The action failed."); return null; }
      return json as Record<string, unknown>;
    } catch {
      setErr("Network error.");
      return null;
    } finally {
      setBusy(false);
    }
  }, [authHeaders]);

  // Library search runs on every keystroke, debounced — the route is a cheap
  // metadata query and only published recordings may be assigned.
  useEffect(() => {
    if (!pickerOpen) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      (async () => {
        const res = await fetch(`/api/admin/lab/library?review=published&q=${encodeURIComponent(libQ)}`, { headers: await authHeaders() });
        const json = await res.json();
        if (!cancelled) setLibResults(res.ok && json.success ? (json.entries as LibraryEntry[]).slice(0, 25) : []);
      })().catch(() => { if (!cancelled) setLibResults([]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pickerOpen, libQ, authHeaders]);

  useEffect(() => {
    if (!addOpen) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      (async () => {
        const res = await fetch(`/api/courses/people?q=${encodeURIComponent(peopleQ)}`, { headers: await authHeaders() });
        const json = await res.json();
        if (!cancelled) setPeople(res.ok && json.success ? (json.people as CoursePerson[]) : []);
      })().catch(() => { if (!cancelled) setPeople([]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [addOpen, peopleQ, authHeaders]);

  const statsById = useMemo(
    () => new Map(course.perAssignment.map((s) => [s.assignmentId, s])),
    [course.perAssignment],
  );
  const students = course.perStudent;
  const instructors = course.roster.filter((r) => r.role === "instructor");

  async function saveCourse() {
    const r = await call(`/api/courses/${courseId}`, "PATCH", {
      title: title.trim(), description: description.trim(), status,
      startsAt: startsAt || null, endsAt: endsAt || null,
    });
    if (r) { setEditing(false); await reload(); }
  }

  async function assign(entry: LibraryEntry) {
    const r = await call(`/api/courses/${courseId}/assignments`, "POST", {
      jobId: entry.jobId,
      title: displayTitle(entry),
      instructions: DEFAULT_INSTRUCTIONS,
      dueAt: libDue || null,
    });
    if (r) { setPickerOpen(false); setLibQ(""); setLibDue(""); await reload(); }
  }

  function openAssignmentEdit(a: CourseAssignment) {
    setEditAssignment(a.id);
    setATitle(a.title);
    setAInstructions(a.instructions);
    setADue(dateValue(a.dueAt));
    setAPublished(a.published);
  }

  async function saveAssignment(id: string) {
    const r = await call(`/api/courses/${courseId}/assignments/${id}`, "PATCH", {
      title: aTitle.trim(), instructions: aInstructions, dueAt: aDue || null, published: aPublished,
    });
    if (r) { setEditAssignment(null); await reload(); }
  }

  async function removeAssignment(a: CourseAssignment) {
    if (!confirm(`Remove "${a.title}" from this course? Everyone's progress on it is removed with it.`)) return;
    const r = await call(`/api/courses/${courseId}/assignments/${a.id}`, "DELETE");
    if (r) await reload();
  }

  // Editors and admins can open the site as a TEST student to demo the learner's view of this
  // course; the API refuses anything but an is_test account. Returning lands back on this page.
  async function viewAs(email: string) {
    setErr(null);
    try {
      await switchToUser(email, authHeaders, { landOn: `/courses/${courseId}`, returnTo: `/courses/${courseId}` });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not switch to that account.");
    }
  }

  async function addStudents(role: "student" | "instructor") {
    const typed = rawEmails.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    const emails = Array.from(new Set([...picked, ...typed]));
    if (!emails.length) { setErr("Pick someone, or type an email."); return; }
    const r = await call(`/api/courses/${courseId}/members`, "POST", { emails, role });
    if (r) { setPicked([]); setRawEmails(""); setAddOpen(false); await reload(); }
  }

  async function removeMember(email: string) {
    if (!confirm(`Remove ${email} from this course?`)) return;
    const r = await call(`/api/courses/${courseId}/members?email=${encodeURIComponent(email)}`, "DELETE");
    if (r) { setCell(null); await reload(); }
  }

  async function returnWork(assignmentId: string, email: string) {
    const r = await call(`/api/courses/${courseId}/assignments/${assignmentId}/submission`, "POST", {
      action: "return", email, feedback: feedback.trim(),
    });
    if (r) { setFeedback(""); await reload(); }
  }

  const openCell: SubmissionState | null = cell ? course.matrix[cell.assignmentId]?.[cell.email] ?? null : null;
  const openCellAssignment = cell ? course.assignments.find((a) => a.id === cell.assignmentId) ?? null : null;

  return (
    <div style={adminShellWide}>
      <style>{`
        .cd-kpis { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
        .cd-row { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; justify-content: space-between; }
        .cd-table-wrap { overflow-x: auto; }
        .cd-table { border-collapse: collapse; width: 100%; font-size: 13px; }
        .cd-table th, .cd-table td { border-bottom: 1px solid var(--border); padding: 7px 9px; text-align: left; vertical-align: top; }
        .cd-table th { font-family: var(--mono-font); font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
          color: var(--text-muted); font-weight: 600; white-space: nowrap; }
        .cd-cell { border: none; background: transparent; padding: 0; cursor: pointer; font: inherit; text-align: left; }
      `}</style>

      {/* ── header ───────────────────────────────────────────────────── */}
      <div className="cd-row" style={{ marginBottom: 18 }}>
        <div>
          <span style={eyebrow}>EEG Teaching Lab · Course</span>
          <h1 style={{ ...h1, marginTop: 6 }}>{course.title}</h1>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
            <StatusChip status={course.status} />
            {course.isDemo && <DemoChip />}
            <span style={meta}>{teacherNames(course)}</span>
            {(course.startsAt || course.endsAt) && (
              <span style={meta}>{shortDate(course.startsAt)}{course.endsAt ? ` → ${shortDate(course.endsAt)}` : ""}</span>
            )}
          </div>
          {course.description && (
            <p style={{ color: "var(--text-secondary)", marginTop: 8, maxWidth: 680 }}>{course.description}</p>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignSelf: "flex-start", flexWrap: "wrap" }}>
          <Link href="/courses" style={mini}>← Courses</Link>
          <button type="button" style={mini} onClick={() => setEditing((v) => !v)}>{editing ? "Cancel" : "Edit"}</button>
        </div>
      </div>

      {err && (
        <div role="alert" style={{ ...card, borderColor: "var(--accent-secondary)", padding: "12px 16px", marginBottom: 16, color: "var(--accent-secondary)", fontSize: 14 }}>
          {err}
        </div>
      )}

      {editing && (
        <section style={{ ...card, padding: 16, marginBottom: 18, display: "grid", gap: 10 }}>
          <div>
            <label style={fieldLabel} htmlFor="cd-title">Title</label>
            <input id="cd-title" style={inp} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
          </div>
          <div>
            <label style={fieldLabel} htmlFor="cd-desc">Description</label>
            <textarea id="cd-desc" style={{ ...inp, resize: "vertical" }} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ minWidth: 150 }}>
              <label style={fieldLabel} htmlFor="cd-status">Status</label>
              <select id="cd-status" style={inp} value={status} onChange={(e) => setStatus(e.target.value as CourseStatus)}>
                {(Object.keys(COURSE_STATUS_LABELS) as CourseStatus[]).map((s) => (
                  <option key={s} value={s}>{COURSE_STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>
            <div style={{ minWidth: 150 }}>
              <label style={fieldLabel} htmlFor="cd-start">Starts</label>
              <input id="cd-start" type="date" style={inp} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div style={{ minWidth: 150 }}>
              <label style={fieldLabel} htmlFor="cd-end">Ends</label>
              <input id="cd-end" type="date" style={inp} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={btnPrimary} disabled={busy} onClick={() => void saveCourse()}>Save</button>
            <button type="button" style={btnGhost} disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </section>
      )}

      {/* ── KPIs ─────────────────────────────────────────────────────── */}
      <section className="cd-kpis" style={{ marginBottom: 22 }}>
        <Tile label="Students" value={`${course.kpis.students}`} />
        <Tile label="Assignments" value={`${course.kpis.assignments}`} />
        <Tile label="Completion" value={pct(course.kpis.completion)} />
        <Tile label="On time" value={pct(course.kpis.onTime)} />
        <Tile label="Mean score" value={score(course.kpis.meanScore)} />
        <Tile label="Mean sensitivity" value={pct(course.kpis.meanSensitivity)} />
        <Tile label="False alarms / learner" value={num1(course.kpis.meanFalseAlarms)} />
        <Tile label="Median latency" value={secs(course.kpis.medianLatencyS)} />
      </section>

      {/* ── assignments ──────────────────────────────────────────────── */}
      <section style={{ marginBottom: 26 }}>
        <div className="cd-row">
          <h2 style={{ ...h1, fontSize: "1.2rem" }}>Assignments</h2>
          <button type="button" style={mini} onClick={() => setPickerOpen((v) => !v)}>{pickerOpen ? "Cancel" : "Add EEG"}</button>
        </div>

        {pickerOpen && (
          <div style={{ ...card, padding: 16, marginTop: 12 }}>
            <label style={fieldLabel} htmlFor="cd-lib">Find a published recording</label>
            <input id="cd-lib" style={inp} value={libQ} onChange={(e) => setLibQ(e.target.value)} placeholder="question id, age band, kind, anything in the question…" />
            <div style={{ marginTop: 10, maxWidth: 200 }}>
              <label style={fieldLabel} htmlFor="cd-lib-due">Due (optional)</label>
              <input id="cd-lib-due" type="date" style={inp} value={libDue} onChange={(e) => setLibDue(e.target.value)} />
            </div>
            {libResults.length === 0 ? (
              <p style={{ ...meta, marginTop: 12 }}>No published recordings match. Try fewer words.</p>
            ) : (
              <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                {libResults.map((e) => (
                  <li key={e.jobId} style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                    <div>
                      <div style={{ color: "var(--text)", fontSize: 14 }}>{displayTitle(e)}</div>
                      <div style={meta}>
                        {humanDuration(e.durationS)}
                        {e.question && ` · ${e.question.qbankId}`}
                      </div>
                    </div>
                    <button type="button" style={btnGhost} disabled={busy} onClick={() => void assign(e)}>Assign</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {course.assignments.length === 0 ? (
          <p style={{ ...meta, marginTop: 12 }}>
            No EEGs assigned yet — &ldquo;Add EEG&rdquo; searches the published library and drops one into this course.
          </p>
        ) : (
          <>
            <div style={{ marginTop: 12 }}><Legend /></div>
            <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              {course.assignments.map((a) => {
                const s = statsById.get(a.id);
                const counts: Record<SubmissionStatus, number> = {
                  not_started: s?.notStarted ?? 0, in_progress: s?.inProgress ?? 0,
                  submitted: s?.submitted ?? 0, returned: s?.returned ?? 0,
                };
                const outstanding = counts.not_started + counts.in_progress > 0;
                const overdue = isPast(a.dueAt) && outstanding;
                return (
                  <li key={a.id} style={{ ...card, padding: 14 }}>
                    <div className="cd-row">
                      <div style={{ minWidth: 240 }}>
                        <div style={{ color: "var(--text)", fontWeight: 600 }}>
                          {a.title}
                          {!a.published && <span style={{ ...meta, marginLeft: 8 }}>· hidden</span>}
                        </div>
                        <div style={meta}>
                          {a.recordingTitle ?? a.jobId.slice(0, 8)} · {humanDuration(a.durationS)}
                          {a.dueAt && (
                            <span style={{ color: overdue ? "var(--accent-secondary)" : undefined, fontWeight: overdue ? 600 : undefined }}>
                              {" · "}{overdue ? "overdue " : "due "}{shortDate(a.dueAt)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: 180 }}>
                        <StackedBar counts={counts} />
                        <div style={{ ...meta, marginTop: 5 }}>
                          mean score {score(s?.meanScore ?? null)} · sensitivity {pct(s?.meanSensitivity ?? null)}
                          {s?.late ? ` · ${s.late} late` : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <Link href={`/admin/eeg-lab/library/${a.jobId}/results?course=${courseId}`} style={mini}>Class results</Link>
                        <Link href={`/admin/eeg-lab/viewer?job=${a.jobId}&course=${courseId}&assignment=${a.id}`} style={mini}>Open</Link>
                        <button type="button" style={mini} onClick={() => (editAssignment === a.id ? setEditAssignment(null) : openAssignmentEdit(a))}>
                          {editAssignment === a.id ? "Cancel" : "Edit"}
                        </button>
                        <button type="button" style={{ ...mini, color: "var(--accent-secondary)" }} disabled={busy} onClick={() => void removeAssignment(a)}>Remove</button>
                      </div>
                    </div>

                    {editAssignment === a.id && (
                      <div style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 12, display: "grid", gap: 10 }}>
                        <div>
                          <label style={fieldLabel} htmlFor={`cd-at-${a.id}`}>Title</label>
                          <input id={`cd-at-${a.id}`} style={inp} value={aTitle} onChange={(e) => setATitle(e.target.value)} maxLength={160} />
                        </div>
                        <div>
                          <label style={fieldLabel} htmlFor={`cd-ai-${a.id}`}>Instructions</label>
                          <textarea id={`cd-ai-${a.id}`} style={{ ...inp, resize: "vertical" }} rows={3} value={aInstructions} onChange={(e) => setAInstructions(e.target.value)} maxLength={2000} />
                        </div>
                        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
                          <div style={{ minWidth: 160 }}>
                            <label style={fieldLabel} htmlFor={`cd-ad-${a.id}`}>Due</label>
                            <input id={`cd-ad-${a.id}`} type="date" style={inp} value={aDue} onChange={(e) => setADue(e.target.value)} />
                          </div>
                          <label style={{ ...meta, display: "inline-flex", alignItems: "center", gap: 7, paddingBottom: 9 }}>
                            <input type="checkbox" checked={aPublished} onChange={(e) => setAPublished(e.target.checked)} />
                            Visible to students
                          </label>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button type="button" style={btnPrimary} disabled={busy} onClick={() => void saveAssignment(a.id)}>Save</button>
                          <button type="button" style={btnGhost} disabled={busy} onClick={() => setEditAssignment(null)}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {/* ── roster / gradebook ───────────────────────────────────────── */}
      <section>
        <div className="cd-row">
          <h2 style={{ ...h1, fontSize: "1.2rem" }}>Roster</h2>
          <button type="button" style={mini} onClick={() => setAddOpen((v) => !v)}>{addOpen ? "Cancel" : "Add students"}</button>
        </div>

        {addOpen && (
          <div style={{ ...card, padding: 16, marginTop: 12 }}>
            <label style={fieldLabel} htmlFor="cd-people">Search members and accounts</label>
            <input id="cd-people" style={inp} value={peopleQ} onChange={(e) => setPeopleQ(e.target.value)} placeholder="name, email or institution" />
            {people.length > 0 && (
              <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 4, maxHeight: 280, overflowY: "auto" }}>
                {people.map((p) => (
                  <li key={p.email}>
                    <label style={{ display: "flex", gap: 9, alignItems: "baseline", padding: "5px 0", cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={picked.includes(p.email)}
                        onChange={(e) => setPicked((prev) => (e.target.checked ? [...prev, p.email] : prev.filter((x) => x !== p.email)))}
                      />
                      <span>
                        <span style={{ color: "var(--text)", fontSize: 14 }}>{p.name ?? p.email}</span>
                        <span style={{ ...meta, marginLeft: 8 }}>
                          {p.email}{p.institution ? ` · ${p.institution}` : ""}
                          {!p.hasAccount && " · no account yet"}
                        </span>
                        {p.isTest && <span style={{ ...meta, marginLeft: 8, color: "var(--accent-secondary)" }}>test</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ marginTop: 12 }}>
              <label style={fieldLabel} htmlFor="cd-raw">Or paste emails, comma separated</label>
              <textarea id="cd-raw" style={{ ...inp, resize: "vertical" }} rows={2} value={rawEmails} onChange={(e) => setRawEmails(e.target.value)} />
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
              <button type="button" style={btnPrimary} disabled={busy} onClick={() => void addStudents("student")}>Add selected</button>
              <button type="button" style={btnGhost} disabled={busy} onClick={() => void addStudents("instructor")}>Add as instructors</button>
              <span style={meta}>Someone without an account is enrolled by email and picked up when they first sign in.</span>
            </div>
          </div>
        )}

        {students.length === 0 ? (
          <p style={{ ...meta, marginTop: 12 }}>No students yet — add them by name or email and the gradebook fills in.</p>
        ) : (
          <div className="cd-table-wrap" style={{ ...card, padding: 0, marginTop: 12 }}>
            <table className="cd-table">
              <thead>
                <tr>
                  <th>Student</th>
                  {course.assignments.map((a) => <th key={a.id}>{a.title}</th>)}
                  <th>Progress</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {students.map((st) => (
                  <tr key={st.email}>
                    <td>
                      <div style={{ color: "var(--text)" }}>{st.displayName ?? st.email}</div>
                      <div style={meta}>
                        {st.email}{st.isTest ? " · test" : ""}
                        {st.isTest && (
                          <button type="button" style={{ ...mini, marginLeft: 8 }} disabled={busy} onClick={() => void viewAs(st.email)}
                            title="Open this course as this test student (editors and admins; test accounts only)">
                            View as
                          </button>
                        )}
                      </div>
                    </td>
                    {course.assignments.map((a) => {
                      const s = course.matrix[a.id]?.[st.email];
                      const status = s?.status ?? "not_started";
                      const active = cell?.assignmentId === a.id && cell.email === st.email;
                      return (
                        <td key={a.id}>
                          <button
                            type="button"
                            className="cd-cell"
                            onClick={() => {
                              setFeedback(s?.feedback ?? "");
                              setCell(active ? null : { assignmentId: a.id, email: st.email });
                            }}
                          >
                            <span style={{
                              display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11.5,
                              fontFamily: "var(--mono-font)", color: SUBMISSION_COLORS[status],
                              border: `1px solid ${SUBMISSION_COLORS[status]}`,
                              outline: active ? "2px solid var(--accent-primary)" : undefined,
                            }}>
                              {SUBMISSION_LABELS[status]}
                              {s?.score !== null && s?.score !== undefined && ` · ${Math.round(s.score)}`}
                              {s?.late && " · late"}
                            </span>
                          </button>
                        </td>
                      );
                    })}
                    <td>
                      <ProgressBar done={st.done} total={st.total} />
                      <div style={meta}>
                        mean {score(st.meanScore)}
                        {st.lastActivityAt ? ` · ${shortDate(st.lastActivityAt)}` : ""}
                      </div>
                    </td>
                    <td>
                      <button type="button" style={{ ...mini, color: "var(--accent-secondary)" }} disabled={busy} onClick={() => void removeMember(st.email)}>Remove</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {cell && openCellAssignment && (
          <div style={{ ...card, padding: 16, marginTop: 12 }}>
            <div className="cd-row">
              <div>
                <div style={{ color: "var(--text)", fontWeight: 600 }}>{openCellAssignment.title}</div>
                <div style={meta}>{cell.email}</div>
              </div>
              <button type="button" style={mini} onClick={() => setCell(null)}>Close</button>
            </div>
            {!openCell ? (
              <p style={{ ...meta, marginTop: 10 }}>Nothing recorded yet.</p>
            ) : (
              <>
                <div style={{ ...meta, marginTop: 10, display: "flex", gap: 14, flexWrap: "wrap" }}>
                  <span style={{ color: SUBMISSION_COLORS[openCell.status], fontWeight: 600 }}>● {SUBMISSION_LABELS[openCell.status]}</span>
                  <span>{openCell.markCount} mark{openCell.markCount === 1 ? "" : "s"}</span>
                  <span>score {score(openCell.score)}</span>
                  <span>sensitivity {pct(openCell.sensitivity)}</span>
                  <span>false alarms {openCell.falseAlarms ?? "—"}</span>
                  <span>latency {secs(openCell.medianLatencyS)}</span>
                </div>
                <div style={{ ...meta, marginTop: 6, display: "flex", gap: 14, flexWrap: "wrap" }}>
                  {openCell.openedAt && <span>opened {shortDate(openCell.openedAt)}</span>}
                  {openCell.submittedAt && <span>turned in {shortDate(openCell.submittedAt)}{openCell.late ? " · late" : ""}</span>}
                  {openCell.returnedAt && <span>returned {shortDate(openCell.returnedAt)}</span>}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <Link href={`/admin/eeg-lab/viewer?job=${openCellAssignment.jobId}&course=${courseId}&assignment=${openCellAssignment.id}&learner=${encodeURIComponent(cell.email)}`} style={mini}>
                    Open their marks
                  </Link>
                </div>
                {openCell.status === "submitted" && (
                  <div style={{ marginTop: 12 }}>
                    <label style={fieldLabel} htmlFor="cd-feedback">Return with feedback</label>
                    <textarea id="cd-feedback" style={{ ...inp, resize: "vertical" }} rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={2000} />
                    <button
                      type="button" style={{ ...btnPrimary, marginTop: 8 }} disabled={busy}
                      onClick={() => void returnWork(cell.assignmentId, cell.email)}
                    >
                      Return
                    </button>
                  </div>
                )}
                {openCell.status === "returned" && openCell.feedback && (
                  <p style={{ color: "var(--text-secondary)", fontSize: 13.5, marginTop: 10 }}>{openCell.feedback}</p>
                )}
              </>
            )}
          </div>
        )}

        {instructors.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <span style={fieldLabel}>Instructors</span>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {instructors.map((i) => (
                <span key={i.email} style={meta}>
                  {i.displayName ?? i.email}
                  <button type="button" style={{ ...mini, marginLeft: 6, padding: "1px 7px" }} disabled={busy} onClick={() => void removeMember(i.email)}>remove</button>
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── student ───────────────────────────────────────────────────────────────

function StudentView({ course, courseId, authHeaders, reload }: {
  course: CourseDetailStudent; courseId: string; authHeaders: Headers; reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const done = course.assignments.filter((a) => isDone(a.my.status)).length;

  async function act(assignmentId: string, action: "submit" | "unsubmit") {
    setBusy(assignmentId);
    setErr(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/assignments/${assignmentId}/submission`, {
        method: "POST", headers: await authHeaders(), body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) { setErr(json.error || "The action failed."); return; }
      await reload();
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={adminShellWide}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <span style={eyebrow}>EEG Teaching Lab · Course</span>
          <h1 style={{ ...h1, marginTop: 6 }}>{course.title}</h1>
          <div style={{ ...meta, marginTop: 8 }}>{teacherNames(course)}</div>
          {course.description && (
            <p style={{ color: "var(--text-secondary)", marginTop: 8, maxWidth: 680 }}>{course.description}</p>
          )}
          <div style={{ marginTop: 12, maxWidth: 320 }}>
            <ProgressBar done={done} total={course.assignments.length} />
          </div>
        </div>
        <Link href="/courses" style={{ ...mini, alignSelf: "flex-start" }}>← Courses</Link>
      </div>

      {err && (
        <div role="alert" style={{ ...card, borderColor: "var(--accent-secondary)", padding: "12px 16px", marginBottom: 16, color: "var(--accent-secondary)", fontSize: 14 }}>
          {err}
        </div>
      )}

      {course.assignments.length === 0 ? (
        <p style={meta}>Nothing assigned yet — your instructor adds recordings and they appear here.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          {course.assignments.map((a) => {
            const s = a.my;
            const overdue = isPast(a.dueAt) && !isDone(s.status);
            return (
              <li key={a.id} style={{ ...card, padding: 16 }}>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ minWidth: 260, flex: 1 }}>
                    <div style={{ color: "var(--text)", fontWeight: 600 }}>{a.title}</div>
                    <div style={meta}>
                      {a.recordingTitle ?? "recording"} · {humanDuration(a.durationS)}
                      {a.dueAt && (
                        <span style={{ color: overdue ? "var(--accent-secondary)" : undefined, fontWeight: overdue ? 600 : undefined }}>
                          {" · "}{overdue ? "overdue " : "due "}{shortDate(a.dueAt)}
                        </span>
                      )}
                    </div>
                    {a.instructions && (
                      <p style={{ color: "var(--text-secondary)", fontSize: 13.5, marginTop: 8 }}>{a.instructions}</p>
                    )}
                    {s.status === "returned" && s.feedback && (
                      <p style={{ color: "var(--text-secondary)", fontSize: 13.5, marginTop: 8, borderLeft: "2px solid var(--border)", paddingLeft: 10 }}>
                        {s.feedback}
                      </p>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ ...meta, color: SUBMISSION_COLORS[s.status], fontWeight: 600 }}>● {SUBMISSION_LABELS[s.status]}</span>
                    <Link href={`/admin/eeg-lab/viewer?job=${a.jobId}&course=${courseId}&assignment=${a.id}`} style={{ ...btnPrimary, textDecoration: "none" }}>
                      Open
                    </Link>
                    {s.status === "submitted" || s.status === "returned" ? (
                      <button type="button" style={btnGhost} disabled={busy === a.id} onClick={() => void act(a.id, "unsubmit")}>Reopen</button>
                    ) : (
                      <button type="button" style={btnGhost} disabled={busy === a.id} onClick={() => void act(a.id, "submit")}>Done with this EEG</button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
