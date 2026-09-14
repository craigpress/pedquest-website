"use client";

/**
 * Courses — the front door to the EEG Teaching Lab for both sides of a class.
 *
 * A learner sees the courses they were enrolled in and how far through the
 * assigned recordings they are; a teacher also sees the courses they run and
 * can start a new one. Everything else (roster, assignments, gradebook) lives
 * on the course detail page — this screen is only "which class, how far in".
 *
 * The API decides who is a teacher: `teaching` comes back empty for a student
 * even if the client renders the section, so the role check here is UI only.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRole, useUser } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import {
  adminShellWide, btnGhost, btnPrimary, card, eyebrow, fieldLabel, h1, inp, meta, mini,
} from "@/lib/admin-ui";
import { COURSE_STATUS_LABELS, type CourseStatus, type CourseSummary } from "@/lib/courses/types";

const STATUS_COLOR: Record<CourseStatus, string> = {
  draft: "var(--text-muted)",
  active: "var(--accent-tertiary)",
  archived: "var(--accent-secondary)",
};

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function StatusChip({ status }: { status: CourseStatus }) {
  return (
    <span style={{ ...meta, color: STATUS_COLOR[status], fontWeight: 600 }}>● {COURSE_STATUS_LABELS[status]}</span>
  );
}

/** done/total as a bar plus the count; the same shape teachers and students read. */
function ProgressBar({ done, total }: { done: number; total: number }) {
  const frac = total > 0 ? done / total : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <div style={{ flex: 1, height: 7, borderRadius: 999, background: "var(--border)", overflow: "hidden" }}>
        <div style={{ width: `${Math.round(frac * 100)}%`, height: "100%", background: "var(--accent-tertiary)" }} />
      </div>
      <span style={meta}>{done}/{total}</span>
    </div>
  );
}

export default function CoursesPage() {
  const { user, loading: userLoading } = useUser();
  const { isTeacher, loading: roleLoading } = useRole();
  const signedIn = !!user;

  const [teaching, setTeaching] = useState<CourseSummary[]>([]);
  const [enrolled, setEnrolled] = useState<CourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const authHeaders = useCallback(async () => {
    const sb = getSupabase();
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : null;
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/courses", { headers: await authHeaders() });
      const json = await res.json();
      if (res.ok && json.success) {
        setTeaching((json.teaching ?? []) as CourseSummary[]);
        setEnrolled((json.enrolled ?? []) as CourseSummary[]);
      } else {
        setError(json.error || "Could not load your courses.");
      }
    } catch {
      setError("Network error loading your courses.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { if (signedIn) void load(); }, [signedIn, load]);

  async function create() {
    if (!title.trim()) { setError("A course needs a title."); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/courses", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          startsAt: startsAt || null,
          endsAt: endsAt || null,
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setTitle(""); setDescription(""); setStartsAt(""); setEndsAt("");
        setCreating(false);
        await load();
      } else {
        setError(json.error || "Could not create the course.");
      }
    } catch {
      setError("Network error creating the course.");
    } finally {
      setBusy(false);
    }
  }

  if (userLoading || roleLoading) {
    return <div style={adminShellWide}><p style={{ color: "var(--text-muted)" }}>Loading…</p></div>;
  }
  if (!signedIn) {
    return (
      <div style={adminShellWide}>
        <h1 style={h1}>Sign in to see your courses</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: 10 }}>
          Courses are available to signed-in PedQuEST members. <Link href="/login">Sign in</Link>.
        </p>
      </div>
    );
  }

  return (
    <div style={adminShellWide}>
      <style>{`
        .co-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); }
        .co-card { padding: 16px; text-decoration: none; display: flex; flex-direction: column; gap: 9px; }
        .co-card:hover { border-color: var(--accent-primary); }
      `}</style>

      <div style={eyebrow}>EEG Teaching Lab</div>
      <h1 style={{ ...h1, marginTop: 6 }}>Courses</h1>
      <p style={{ color: "var(--text-secondary)", marginTop: 8, maxWidth: 680 }}>
        A course is a class: a roster, and a list of EEG recordings each learner works through in the viewer.
      </p>

      {error && (
        <div role="alert" style={{ ...card, borderColor: "var(--accent-secondary)", padding: "12px 16px", marginTop: 16, color: "var(--accent-secondary)", fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* ── my courses ─────────────────────────────────────────────────── */}
      <section style={{ marginTop: 26 }}>
        <h2 style={{ ...h1, fontSize: "1.2rem" }}>My courses</h2>
        {loading ? (
          <p style={{ ...meta, marginTop: 10 }}>Loading…</p>
        ) : enrolled.length === 0 ? (
          <p style={{ ...meta, marginTop: 10 }}>
            You are not enrolled in a course yet — a teacher adds you by email, and the class appears here.
          </p>
        ) : (
          <div className="co-grid" style={{ marginTop: 12 }}>
            {enrolled.map((c) => (
              <Link key={c.id} href={`/courses/${c.id}`} className="co-card" style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                  <span style={{ color: "var(--text)", fontWeight: 600, fontSize: 15 }}>{c.title}</span>
                  <StatusChip status={c.status} />
                </div>
                <span style={meta}>{c.ownerName ?? c.ownerEmail}</span>
                <ProgressBar done={c.progress?.done ?? 0} total={c.progress?.total ?? c.assignmentCount} />
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* ── teaching ───────────────────────────────────────────────────── */}
      {isTeacher && (
        <section style={{ marginTop: 32 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ ...h1, fontSize: "1.2rem" }}>Teaching</h2>
            <button type="button" style={mini} onClick={() => setCreating((v) => !v)}>
              {creating ? "Cancel" : "New course"}
            </button>
          </div>

          {creating && (
            <div style={{ ...card, padding: 16, marginTop: 12 }}>
              <div style={{ display: "grid", gap: 10 }}>
                <div>
                  <label style={fieldLabel} htmlFor="co-title">Title</label>
                  <input id="co-title" style={inp} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="Neonatal EEG, fall block" />
                </div>
                <div>
                  <label style={fieldLabel} htmlFor="co-desc">Description</label>
                  <textarea id="co-desc" style={{ ...inp, resize: "vertical" }} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 160 }}>
                    <label style={fieldLabel} htmlFor="co-start">Starts</label>
                    <input id="co-start" type="date" style={inp} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
                  </div>
                  <div style={{ minWidth: 160 }}>
                    <label style={fieldLabel} htmlFor="co-end">Ends</label>
                    <input id="co-end" type="date" style={inp} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" style={btnPrimary} disabled={busy} onClick={() => void create()}>Create course</button>
                  <button type="button" style={btnGhost} disabled={busy} onClick={() => setCreating(false)}>Cancel</button>
                </div>
              </div>
            </div>
          )}

          {loading ? (
            <p style={{ ...meta, marginTop: 10 }}>Loading…</p>
          ) : teaching.length === 0 ? (
            <p style={{ ...meta, marginTop: 10 }}>
              No courses yet — create one, enrol your learners by email, then assign published recordings from the EEG Library.
            </p>
          ) : (
            <div className="co-grid" style={{ marginTop: 12 }}>
              {teaching.map((c) => (
                <Link key={c.id} href={`/courses/${c.id}`} className="co-card" style={card}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                    <span style={{ color: "var(--text)", fontWeight: 600, fontSize: 15 }}>{c.title}</span>
                    <StatusChip status={c.status} />
                  </div>
                  <span style={meta}>
                    {c.studentCount} student{c.studentCount === 1 ? "" : "s"} · {c.assignmentCount} assignment{c.assignmentCount === 1 ? "" : "s"}
                    {c.completion !== null && ` · ${Math.round(c.completion * 100)}% done`}
                  </span>
                  {(c.startsAt || c.endsAt) && (
                    <span style={meta}>{shortDate(c.startsAt)}{c.endsAt ? ` → ${shortDate(c.endsAt)}` : ""}</span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
