"use client";

// EEG Lab Viewer — /admin/eeg-lab/viewer[?job=<uuid>]
//
// Without ?job: a file picker for an EDF+ file, or a Persyst .lay + .dat pair
// (an .answers.json alongside is picked up as the answer key). With ?job: opens
// that lab job's recording through signed URLs. Any signed-in member; the
// answer key overlay and the console links stay editor-only.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRole, useUser } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { adminShellWide, btnPrimary, card, eyebrow, h1 } from "@/lib/admin-ui";
import type { LabJob } from "@/lib/lab/types";
import type { CourseAssignment, SubmissionState } from "@/lib/courses/types";
import LabViewer, { type ViewerAssignment, type ViewerSource } from "@/components/lab/LabViewer";

/** GET /api/courses/[courseId]/assignments/[assignmentId] */
interface AssignmentPayload {
  assignment: CourseAssignment;
  my: SubmissionState;
  course: { id: string; title: string };
  canManage: boolean;
}

export default function ViewerPage() {
  return (
    <Suspense fallback={<div style={adminShellWide}><p style={{ color: "var(--text-muted)" }}>Loading…</p></div>}>
      <ViewerInner />
    </Suspense>
  );
}

function ViewerInner() {
  const { user, loading: userLoading } = useUser();
  const { isEditor, isTeacher, loading: roleLoading } = useRole();
  const signedIn = !!user;
  const params = useSearchParams();
  const router = useRouter();
  const jobId = params.get("job");
  // deep links from class results: ?t=<seconds> lands on a mark, ?learner=<email> filters to one learner
  const initialT = params.get("t") !== null && Number.isFinite(Number(params.get("t"))) ? Number(params.get("t")) : null;
  // deep link from a course: ?course=&assignment= adds the task header and the turn-in button
  const courseId = params.get("course");
  const assignmentId = params.get("assignment");
  const [assignmentData, setAssignmentData] = useState<AssignmentPayload | null>(null);
  const markedOpen = useRef(false);
  const [source, setSource] = useState<ViewerSource | null>(null);
  const [job, setJob] = useState<LabJob | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const authHeaders = useCallback(async () => {
    const sb = getSupabase();
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : null;
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }, []);

  useEffect(() => {
    // The job read goes out as soon as there is a session — in parallel with
    // /api/me, not after it. The source is assembled below once both are in.
    if (!jobId || !signedIn) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/admin/lab/jobs/${jobId}`, { headers: await authHeaders() });
      const json = await res.json();
      if (cancelled) return;
      if (!res.ok || !json.job) { setJobError(json.error || "Could not load the job."); return; }
      setJob(json.job as LabJob);
    })().catch(() => { if (!cancelled) setJobError("Network error loading the job."); });
    return () => { cancelled = true; };
  }, [jobId, signedIn, authHeaders]);

  const assignmentPath = courseId && assignmentId ? `/api/courses/${courseId}/assignments/${assignmentId}` : null;

  useEffect(() => {
    if (!assignmentPath || !signedIn) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(assignmentPath, { headers: await authHeaders() });
      const json = await res.json();
      // a stale or foreign link just drops the course context; the recording still opens
      if (!cancelled && res.ok && json.success) setAssignmentData(json as AssignmentPayload);
    })().catch(() => { /* the viewer works without the course context */ });
    return () => { cancelled = true; };
  }, [assignmentPath, signedIn, authHeaders]);

  // Opening the recording from a course is what moves a learner to "in progress";
  // once per mount, and never for the teacher looking at it.
  useEffect(() => {
    if (!assignmentPath || !assignmentData || assignmentData.canManage || markedOpen.current) return;
    markedOpen.current = true;
    (async () => {
      const res = await fetch(`${assignmentPath}/submission`, {
        method: "POST", headers: await authHeaders(), body: JSON.stringify({ action: "open" }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setAssignmentData((prev) => (prev ? { ...prev, my: json.submission as SubmissionState } : prev));
      }
    })().catch(() => { /* marking it opened is best-effort */ });
  }, [assignmentPath, assignmentData, authHeaders]);

  const submissionAction = useCallback(async (action: "submit" | "unsubmit") => {
    if (!assignmentPath) return;
    const res = await fetch(`${assignmentPath}/submission`, {
      method: "POST", headers: await authHeaders(), body: JSON.stringify({ action }),
    });
    const json = await res.json();
    if (res.ok && json.success) {
      setAssignmentData((prev) => (prev ? { ...prev, my: json.submission as SubmissionState } : prev));
    }
  }, [assignmentPath, authHeaders]);

  const viewerAssignment: ViewerAssignment | undefined = useMemo(() => {
    if (!assignmentData || !courseId) return undefined;
    const a = assignmentData.assignment;
    return {
      id: a.id,
      courseId,
      courseTitle: assignmentData.course.title,
      title: a.title,
      instructions: a.instructions,
      dueAt: a.dueAt,
      my: assignmentData.my,
      canManage: assignmentData.canManage,
      onSubmit: () => submissionAction("submit"),
      onReopen: () => submissionAction("unsubmit"),
    };
  }, [assignmentData, courseId, submissionAction]);

  useEffect(() => {
    if (!job || roleLoading) return;
    // teachers (not just editors) see everyone's marks and the answer key
    // eslint-disable-next-line react-hooks/set-state-in-effect -- assembling the source from two async results
    setSource({ kind: "job", job, authHeaders, isInstructor: isTeacher, canEditKey: isEditor });
  }, [job, roleLoading, isTeacher, isEditor, authHeaders]);

  // Closing a recording returns to wherever it was opened from — the library,
  // a recording page, the review queue or a question — not to this picker.
  // A file picked here has no "from", so it just closes to the picker.
  const closeViewer = useCallback(() => {
    if (!jobId) { setSource(null); return; }
    const cameFromSite = typeof document !== "undefined"
      && document.referrer.startsWith(window.location.origin)
      && !document.referrer.includes("/admin/eeg-lab/viewer")
      && window.history.length > 1;
    if (cameFromSite) { router.back(); return; }
    // opened in a new tab or from a bookmark: the recording's own page for
    // editors, the library for everyone else
    router.push(isEditor ? `/admin/eeg-lab/library/${jobId}` : "/admin/eeg-lab/library");
  }, [jobId, isEditor, router]);

  if (userLoading || roleLoading) {
    return <div style={adminShellWide}><p style={{ color: "var(--text-muted)" }}>Loading…</p></div>;
  }
  if (!signedIn) {
    return (
      <div style={adminShellWide}>
        <h1 style={h1}>Sign in to open the EEG Viewer</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: 10 }}>
          The viewer is available to signed-in PedQuEST members. <Link href="/login">Sign in</Link>.
        </p>
      </div>
    );
  }

  if (source) {
    return (
      <div className="lv-shell">
        <style>{`
          .lv-shell { padding: 12px 16px 16px; height: calc(100vh - 112px); min-height: 560px; box-sizing: border-box; }
          @media (max-width: 900px) { .lv-shell { height: auto; min-height: 0; padding: 8px 8px 24px; } }
        `}</style>
        <LabViewer source={source} onClose={closeViewer} initialT={initialT} initialAuthor={params.get("learner")} assignment={viewerAssignment} />
      </div>
    );
  }

  return (
    <div style={adminShellWide}>
      <div style={eyebrow}>EEG Teaching Lab</div>
      <h1 style={{ ...h1, marginTop: 6 }}>EEG Lab Viewer</h1>
      <p style={{ color: "var(--text-secondary)", marginTop: 8, maxWidth: 640 }}>
        Review a recording in the browser: whole-record qEEG trends, a raw page with montage,
        filters and sensitivity, and your own annotations. Find a finished recording in the{" "}
        <Link href="/admin/eeg-lab/library">EEG Library</Link>
        {isEditor ? <>, build one in the <Link href="/admin/eeg-lab">console</Link>,</> : ""} or choose a file here.
      </p>
      {jobId && (
        <p style={{ color: "var(--accent-secondary)", marginTop: 8 }}>{jobError ?? "Loading job…"}</p>
      )}
      <div style={{ ...card, padding: 20, marginTop: 20, display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gap: 6 }}>
          <span style={{ color: "var(--text)", fontWeight: 600 }}>Open a recording from this computer</span>
          <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
            One <code>.edf</code> file, or a Persyst <code>.lay</code> and <code>.dat</code> pair selected together.
            Add the matching <code>.answers.json</code> to overlay the answer key. Nothing is uploaded — the file
            is read in your browser, and annotations are kept in this browser.
          </span>
          <div
            onDragOver={(e) => { e.preventDefault(); }}
            onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const files = Array.from(e.dataTransfer.files ?? []);
              if (files.length) setSource({ kind: "file", files });
            }}
            style={{
              marginTop: 6, padding: 24, borderRadius: 12, textAlign: "center",
              border: `1px dashed ${dragOver ? "var(--accent-primary)" : "var(--border)"}`,
              background: dragOver ? "color-mix(in srgb, var(--accent-primary) 6%, transparent)" : "transparent",
            }}
          >
            <button type="button" style={btnPrimary} onClick={() => fileInputRef.current?.click()}>
              Choose EEG files…
            </button>
            <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 10 }}>or drag and drop them here</div>
            <input
              ref={fileInputRef}
              type="file" multiple accept=".edf,.lay,.dat,.json"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) setSource({ kind: "file", files });
              }}
              style={{ display: "none" }}
            />
          </div>
        </div>
        <div>
          <Link
            href={isEditor ? "/admin/eeg-lab" : "/admin/eeg-lab/library"}
            style={{ ...btnPrimary, display: "inline-block", textDecoration: "none" }}
          >
            {isEditor ? "Go to the lab console" : "Browse the EEG Library"}
          </Link>
        </div>
      </div>
    </div>
  );
}
