"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRole } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import {
  FORMAT_LABELS,
  TZ_LABELS,
  fmtEventDate,
  isoToLocalInput,
  localInputToIso,
  type AdminEvent,
  type EventFormat,
  type EventRegistration,
  type EventTalk,
} from "@/lib/events";

interface Registration {
  email: string;
  name: string | null;
  institution: string | null;
  created_at: string;
}
type Row = AdminEvent & { registrations: Registration[] };

interface EditState {
  id?: string;
  slug: string;
  series: string;
  title: string;
  summary: string;
  host: string;
  hostUrl: string;
  hostLogo: string;
  timezone: string;
  startsLocal: string;
  endsLocal: string;
  format: EventFormat;
  location: string;
  talks: EventTalk[];
  registration: EventRegistration;
  registrationUrl: string;
  registrationNote: string;
  joinUrl: string;
  meetingId: string;
  passcode: string;
  status: string;
}

function blankEdit(): EditState {
  return {
    slug: "", series: "", title: "", summary: "",
    host: "PNCRG · Multimodal Neuromonitoring Subgroup",
    hostUrl: "https://www.pncrg.org/", hostLogo: "/images/events/pncrg-logo.png",
    timezone: "ET", startsLocal: "", endsLocal: "",
    format: "virtual", location: "Zoom", talks: [],
    registration: "email", registrationUrl: "",
    registrationNote: "Enter your email and we'll send you the Zoom link.",
    joinUrl: "", meetingId: "", passcode: "", status: "draft",
  };
}

function fromEvent(e: Row): EditState {
  const tz = e.timezone || "ET";
  return {
    id: e.id, slug: e.slug, series: e.series ?? "", title: e.title, summary: e.summary ?? "",
    host: e.host, hostUrl: e.hostUrl ?? "", hostLogo: e.hostLogo ?? "",
    timezone: tz,
    startsLocal: isoToLocalInput(e.startsAt, tz),
    endsLocal: isoToLocalInput(e.endsAt, tz),
    format: e.format, location: e.location ?? "", talks: e.talks,
    registration: e.registration, registrationUrl: e.registrationUrl ?? "",
    registrationNote: e.registrationNote ?? "",
    joinUrl: e.joinUrl ?? "", meetingId: e.meetingId ?? "", passcode: e.passcode ?? "",
    status: e.status,
  };
}

const STATUS_COLORS: Record<string, string> = {
  published: "var(--accent-tertiary)",
  draft: "var(--accent-secondary)",
  archived: "var(--text-muted)",
};

export default function AdminEventsPage() {
  // Role comes from the server (/api/me -> user_roles), never a hardcoded list.
  const { user, isAdmin, loading: userLoading } = useRole();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  const authHeaders = useCallback(async () => {
    const sb = getSupabase();
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : null;
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/events", { headers: await authHeaders() });
      const json = await res.json();
      if (res.ok && json.success) setRows(json.events);
      else flash(json.error || "Could not load events.");
    } finally { setLoading(false); }
  }, [authHeaders]);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  async function remove(id: string, title: string) {
    if (!confirm(`Delete "${title}"? Registrations for it are kept.`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/events", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({ action: "delete", id }),
      });
      const json = await res.json();
      if (res.ok && json.success) { flash("Event deleted."); load(); } else flash(json.error || "Delete failed.");
    } finally { setBusy(false); }
  }

  async function save() {
    if (!edit) return;
    if (!edit.title.trim() || !edit.host.trim() || !edit.startsLocal) {
      flash("Title, host, and start time are required.");
      return;
    }
    if (edit.registration === "email" && edit.status === "published" && !edit.joinUrl.trim()) {
      flash("An email-gated event needs a join link before it goes live.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/events", {
        method: "POST", headers: await authHeaders(),
        body: JSON.stringify({
          action: "save",
          event: {
            id: edit.id,
            slug: edit.slug,
            series: edit.series,
            title: edit.title,
            summary: edit.summary,
            host: edit.host,
            hostUrl: edit.hostUrl,
            hostLogo: edit.hostLogo,
            startsAt: localInputToIso(edit.startsLocal, edit.timezone),
            endsAt: edit.endsLocal ? localInputToIso(edit.endsLocal, edit.timezone) : null,
            timezone: edit.timezone,
            format: edit.format,
            location: edit.location,
            talks: edit.talks,
            registration: edit.registration,
            registrationUrl: edit.registrationUrl,
            registrationNote: edit.registrationNote,
            joinUrl: edit.joinUrl,
            meetingId: edit.meetingId,
            passcode: edit.passcode,
            status: edit.status,
          },
        }),
      });
      const json = await res.json();
      if (res.ok && json.success) { flash("Saved."); setEdit(null); load(); }
      else flash(json.error || "Save failed.");
    } finally { setBusy(false); }
  }

  async function copyEmails(r: Row) {
    const list = r.registrations.map((x) => x.email).join(", ");
    if (!list) { flash("No registrations yet."); return; }
    try {
      await navigator.clipboard.writeText(list);
      flash(`Copied ${r.registrations.length} email${r.registrations.length === 1 ? "" : "s"}.`);
    } catch {
      flash("Clipboard blocked — download the CSV instead.");
    }
  }

  function downloadCsv(r: Row) {
    const esc = (v: string | null) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const csv = [
      "email,name,institution,registered_at",
      ...r.registrations.map((x) => [esc(x.email), esc(x.name), esc(x.institution), esc(x.created_at)].join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${r.slug}-registrations.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (userLoading) return <Shell><p style={{ color: "var(--text-muted)" }}>Loading…</p></Shell>;
  if (!isAdmin) {
    return (
      <Shell>
        <h1 style={h1}>Admin access required</h1>
        <p style={{ color: "var(--text-secondary)" }}>Sign in with an authorized account to manage events.</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <style>{`
        .ev-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .ev-row-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
        @media (max-width: 640px) {
          .ev-row-2, .ev-row-3 { grid-template-columns: 1fr; }
        }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 22 }}>
        <div>
          <h1 style={h1}>Events — admin</h1>
          <p style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: 13, margin: "4px 0 0" }}>
            {rows.length} event{rows.length === 1 ? "" : "s"} · <Link href="/events" target="_blank" style={{ color: "var(--accent-primary)" }}>view page ↗</Link>
          </p>
        </div>
        <button style={btnPrimary} onClick={() => setEdit(blankEdit())} disabled={busy}>+ New event</button>
      </div>

      {loading ? <p style={{ color: "var(--text-muted)" }}>Loading events…</p> : (
        <div style={{ border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", background: "var(--bg-card)" }}>
          {rows.length === 0 && (
            <div style={{ padding: 30, color: "var(--text-muted)", textAlign: "center" }}>No events yet. Create one.</div>
          )}
          {rows.map((r) => (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center", padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
              <div>
                <div style={{ fontWeight: 600, color: "var(--text)" }}>
                  {r.series ? `${r.series} — ` : ""}{r.title}
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 5, flexWrap: "wrap", fontFamily: "monospace", fontSize: 11.5, color: "var(--text-muted)" }}>
                  <span style={{ color: STATUS_COLORS[r.status] || "var(--text-muted)", fontWeight: 600 }}>● {r.status}</span>
                  <span>{fmtEventDate(r.startsAt, r.timezone)}</span>
                  <span>{FORMAT_LABELS[r.format]}</span>
                  <span>{r.registration === "email" ? "email gate" : r.registration === "external" ? "external" : "no signup"}</span>
                  <span>{r.registrations.length} registered</span>
                  {r.registration === "email" && !r.joinUrl && (
                    <span style={{ color: "var(--accent-secondary)" }}>no join link</span>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {r.registrations.length > 0 && (
                  <>
                    <button style={mini} onClick={() => copyEmails(r)}>Copy emails</button>
                    <button style={mini} onClick={() => downloadCsv(r)}>CSV</button>
                  </>
                )}
                <button style={mini} onClick={() => setEdit(fromEvent(r))}>Edit</button>
                <button style={{ ...mini, color: "var(--accent-primary)" }} onClick={() => remove(r.id, r.title)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {edit && <Editor edit={edit} setEdit={setEdit} onSave={save} onClose={() => setEdit(null)} busy={busy} />}
      {toast && (
        <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: "var(--text)", color: "var(--bg)", padding: "11px 18px", borderRadius: 10, fontFamily: "monospace", fontSize: 13, zIndex: 60 }}>{toast}</div>
      )}
    </Shell>
  );
}

function Editor({ edit, setEdit, onSave, onClose, busy }: {
  edit: EditState;
  setEdit: (e: EditState) => void;
  onSave: () => void;
  onClose: () => void;
  busy: boolean;
}) {
  const set = (patch: Partial<EditState>) => setEdit({ ...edit, ...patch });
  const setTalk = (i: number, patch: Partial<EventTalk>) =>
    set({ talks: edit.talks.map((t, j) => (j === i ? { ...t, ...patch } : t)) });

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Edit event"
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(5,10,20,.5)", zIndex: 50, display: "flex", justifyContent: "flex-end" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: 600, maxWidth: "94vw", height: "100%", background: "var(--bg-card)", borderLeft: "1px solid var(--border)", overflowY: "auto", padding: "22px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ fontFamily: "var(--heading-font)", fontSize: "1.3rem", color: "var(--text)", margin: 0 }}>
            {edit.id ? "Edit event" : "New event"}
          </h2>
          <button style={mini} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="ev-row-2">
          <Field label="Series label"><input style={inp} placeholder="MNM Lecture 4" value={edit.series} onChange={(e) => set({ series: e.target.value })} /></Field>
          <Field label="Status">
            <select style={inp} value={edit.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="draft">Draft (hidden)</option>
              <option value="published">Published (live)</option>
              <option value="archived">Archived (hidden)</option>
            </select>
          </Field>
        </div>

        <Field label="Title" required><input style={inp} value={edit.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <Field label="Summary"><textarea style={inp} rows={3} value={edit.summary} onChange={(e) => set({ summary: e.target.value })} /></Field>

        <div className="ev-row-2">
          <Field label="Host" required><input style={inp} value={edit.host} onChange={(e) => set({ host: e.target.value })} /></Field>
          <Field label="Host website"><input style={inp} placeholder="https://…" value={edit.hostUrl} onChange={(e) => set({ hostUrl: e.target.value })} /></Field>
        </div>
        <Field label="Host logo path">
          <input style={inp} placeholder="/images/events/pncrg-logo.png" value={edit.hostLogo} onChange={(e) => set({ hostLogo: e.target.value })} />
          <span style={hint}>Optional. A file already in <code>public/images/events/</code>, or any absolute URL.</span>
        </Field>

        <div className="ev-row-3">
          <Field label="Time zone">
            <select style={inp} value={edit.timezone} onChange={(e) => set({ timezone: e.target.value })}>
              {TZ_LABELS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Starts" required>
            <input style={inp} type="datetime-local" value={edit.startsLocal} onChange={(e) => set({ startsLocal: e.target.value })} />
          </Field>
          <Field label="Ends">
            <input style={inp} type="datetime-local" value={edit.endsLocal} onChange={(e) => set({ endsLocal: e.target.value })} />
          </Field>
        </div>

        <div className="ev-row-2">
          <Field label="Format">
            <select style={inp} value={edit.format} onChange={(e) => set({ format: e.target.value as EventFormat })}>
              <option value="virtual">Virtual</option>
              <option value="in_person">In person</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </Field>
          <Field label="Location"><input style={inp} placeholder="Zoom / Seattle, WA" value={edit.location} onChange={(e) => set({ location: e.target.value })} /></Field>
        </div>

        <Field label="Featured presentations">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {edit.talks.map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)", marginTop: 12 }}>{i + 1}</span>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                  <input style={inp} placeholder="Talk title" value={t.title} onChange={(e) => setTalk(i, { title: e.target.value })} />
                  <div className="ev-row-2">
                    <input style={{ ...inp, fontSize: 12.5 }} placeholder="Presenter (Dr. …)" value={t.presenter} onChange={(e) => setTalk(i, { presenter: e.target.value })} />
                    <input style={{ ...inp, fontSize: 12.5 }} placeholder="Institution (optional)" value={t.institution ?? ""} onChange={(e) => setTalk(i, { institution: e.target.value })} />
                  </div>
                </div>
                <button style={mini} onClick={() => set({ talks: edit.talks.filter((_, j) => j !== i) })} aria-label={`Remove presentation ${i + 1}`}>✕</button>
              </div>
            ))}
            <button style={{ ...mini, alignSelf: "flex-start" }} onClick={() => set({ talks: [...edit.talks, { presenter: "", title: "" }] })}>
              + Add presentation
            </button>
          </div>
        </Field>

        <Field label="How people sign up">
          <select style={inp} value={edit.registration} onChange={(e) => set({ registration: e.target.value as EventRegistration })}>
            <option value="email">Email gate — collect an email, then hand over the link</option>
            <option value="external">External — send people to another registration page</option>
            <option value="none">None — information only</option>
          </select>
        </Field>

        {edit.registration === "external" && (
          <Field label="Registration URL" required>
            <input style={inp} placeholder="https://…" value={edit.registrationUrl} onChange={(e) => set({ registrationUrl: e.target.value })} />
          </Field>
        )}

        <Field label="Note shown with the sign-up">
          <textarea style={inp} rows={2} value={edit.registrationNote} onChange={(e) => set({ registrationNote: e.target.value })} />
        </Field>

        {edit.registration === "email" && (
          <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
            <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--accent-primary)" }}>
              GATED — released only after someone registers
            </span>
            <Field label="Join link" required>
              <input style={inp} placeholder="https://us06web.zoom.us/j/…" value={edit.joinUrl} onChange={(e) => set({ joinUrl: e.target.value })} />
            </Field>
            <div className="ev-row-2">
              <Field label="Meeting ID"><input style={inp} value={edit.meetingId} onChange={(e) => set({ meetingId: e.target.value })} /></Field>
              <Field label="Passcode"><input style={inp} value={edit.passcode} onChange={(e) => set({ passcode: e.target.value })} /></Field>
            </div>
            <span style={hint}>These never appear on the public page — the register API returns them to the person who signed up.</span>
          </div>
        )}

        <Field label="URL slug">
          <input style={inp} placeholder="auto from title" value={edit.slug} onChange={(e) => set({ slug: e.target.value })} />
          <span style={hint}>Identifies the event in registrations. Leave blank to generate it from the title.</span>
        </Field>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6, position: "sticky", bottom: 0, background: "var(--bg-card)", paddingTop: 12 }}>
          <button style={btnGhost} onClick={onClose}>Cancel</button>
          <button style={btnPrimary} onClick={onSave} disabled={busy}>{busy ? "Saving…" : "Save event"}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
        {label}{required && <span style={{ color: "var(--accent-primary)" }}> *</span>}
      </span>
      {children}
    </label>
  );
}
function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: 940, margin: "0 auto", padding: "3rem 1.5rem 5rem" }}>{children}</div>;
}

const h1: React.CSSProperties = { fontFamily: "var(--heading-font)", fontSize: "1.7rem", color: "var(--text)", margin: 0 };
const hint: React.CSSProperties = { fontSize: 11.5, color: "var(--text-muted)" };
const inp: React.CSSProperties = { padding: "9px 11px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", font: "inherit", fontSize: 14, width: "100%" };
const btnPrimary: React.CSSProperties = { padding: "9px 16px", borderRadius: 9, border: "none", background: "var(--accent-primary)", color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 14 };
const btnGhost: React.CSSProperties = { padding: "9px 16px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text)", fontWeight: 600, cursor: "pointer", fontSize: 14 };
const mini: React.CSSProperties = { padding: "5px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text-secondary)", cursor: "pointer", fontSize: 12.5, fontFamily: "monospace", textDecoration: "none" };
