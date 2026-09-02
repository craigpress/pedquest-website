"use client";

import { useState } from "react";

interface Access {
  joinUrl: string;
  meetingId: string | null;
  passcode: string | null;
}

interface Calendar {
  filename: string;
  content: string;
}

export default function EventRegisterForm({
  slug,
  note,
}: {
  slug: string;
  note?: string | null;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [calendar, setCalendar] = useState<Calendar | null>(null);
  const [emailed, setEmailed] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/events/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, email, name, institution, honeypot }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Registration failed. Please try again.");
        return;
      }
      setAccess(data.access ?? null);
      setCalendar(data.calendar ?? null);
      setEmailed(Boolean(data.emailed));
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function downloadCalendar() {
    if (!calendar) return;
    // Blob rather than a data: URI — Safari won't honour `download` on data URIs.
    const url = URL.createObjectURL(
      new Blob([calendar.content], { type: "text/calendar;charset=utf-8" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = calendar.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (access) {
    return (
      <div className="ev-reg ev-reg-done">
        <h3 className="ev-reg-title">You&apos;re registered.</h3>
        <p className="ev-reg-note">
          {emailed
            ? `We've emailed the join details and a calendar invite to ${email}. Here they are as well:`
            : `Here are your join details — we've also noted your registration.`}
        </p>
        <div className="ev-reg-actions">
          <a className="btn-primary ev-reg-join" href={access.joinUrl} target="_blank" rel="noopener noreferrer">
            Join on Zoom
          </a>
          {calendar && (
            <button type="button" className="btn-secondary ev-reg-cal" onClick={downloadCalendar}>
              Add to calendar
            </button>
          )}
        </div>
        <dl className="ev-reg-meta">
          {access.meetingId && (
            <div>
              <dt>Meeting ID</dt>
              <dd>{access.meetingId}</dd>
            </div>
          )}
          {access.passcode && (
            <div>
              <dt>Passcode</dt>
              <dd>{access.passcode}</dd>
            </div>
          )}
        </dl>
        <style>{FORM_CSS}</style>
      </div>
    );
  }

  return (
    <form className="ev-reg" onSubmit={submit}>
      <h3 className="ev-reg-title">Register to get the link</h3>
      {note && <p className="ev-reg-note">{note}</p>}

      <label className="ev-reg-label" htmlFor={`ev-email-${slug}`}>
        Email <span aria-hidden="true">*</span>
      </label>
      <input
        id={`ev-email-${slug}`}
        className="ev-reg-input"
        type="email"
        required
        autoComplete="email"
        placeholder="you@hospital.edu"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <div className="ev-reg-row">
        <div>
          <label className="ev-reg-label" htmlFor={`ev-name-${slug}`}>
            Name
          </label>
          <input
            id={`ev-name-${slug}`}
            className="ev-reg-input"
            type="text"
            autoComplete="name"
            placeholder="Optional"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="ev-reg-label" htmlFor={`ev-institution-${slug}`}>
            Institution
          </label>
          <input
            id={`ev-institution-${slug}`}
            className="ev-reg-input"
            type="text"
            autoComplete="organization"
            placeholder="Optional"
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
          />
        </div>
      </div>

      {/* Honeypot — hidden from people, filled by bots. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
        style={{ position: "absolute", left: "-9999px", width: 1, height: 1 }}
      />

      {error && (
        <p className="ev-reg-error" role="alert">
          {error}
        </p>
      )}

      <button className="btn-primary ev-reg-submit" type="submit" disabled={submitting}>
        {submitting ? "Registering…" : "Send me the link"}
      </button>
      <p className="ev-reg-fine">
        We use your email only to send the join details and future MNM lecture
        announcements. No sharing, unsubscribe any time — see our{" "}
        <a href="/privacy">privacy notice</a>.
      </p>
      <style>{FORM_CSS}</style>
    </form>
  );
}

const FORM_CSS = `
  .ev-reg {
    background: var(--surface-2); border: 1px solid var(--line);
    border-radius: 16px; padding: 1.5rem;
  }
  .ev-reg-title {
    font-family: var(--heading-font); font-size: 1.15rem; font-weight: 700;
    color: var(--ink); margin-bottom: 0.4rem;
  }
  .ev-reg-note { font-size: 0.9rem; line-height: 1.55; color: var(--ink-2); margin-bottom: 1.1rem; }
  .ev-reg-label {
    display: block; font-family: var(--mono-font); font-size: 0.7rem;
    letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted);
    margin-bottom: 0.35rem;
  }
  .ev-reg-label span { color: var(--accent); }
  .ev-reg-input {
    width: 100%; padding: 0.7rem 0.85rem; margin-bottom: 0.9rem;
    font-family: var(--body-font); font-size: 0.95rem; color: var(--ink);
    background: var(--surface); border: 1px solid var(--border-strong);
    border-radius: 10px; outline: none; transition: border-color 0.15s;
  }
  .ev-reg-input::placeholder { color: var(--muted); }
  .ev-reg-input:focus { border-color: var(--accent); }
  .ev-reg-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem; }
  .ev-reg-submit { width: 100%; margin-top: 0.35rem; justify-content: center; }
  .ev-reg-error { color: #ff8a6a; font-size: 0.85rem; margin-bottom: 0.75rem; }
  .ev-reg-fine {
    font-size: 0.76rem; line-height: 1.5; color: var(--muted); margin-top: 0.9rem;
  }
  .ev-reg-fine a { color: var(--accent); }
  .ev-reg-done { border-color: var(--accent); }
  .ev-reg-actions { display: flex; gap: 0.7rem; flex-wrap: wrap; }
  .ev-reg-join, .ev-reg-cal { flex: 1 1 160px; justify-content: center; text-align: center; }
  .ev-reg-cal { cursor: pointer; font: inherit; font-weight: 600; }
  .ev-reg-meta { display: flex; gap: 1.75rem; margin-top: 1.1rem; flex-wrap: wrap; }
  .ev-reg-meta dt {
    font-family: var(--mono-font); font-size: 0.68rem; letter-spacing: 0.06em;
    text-transform: uppercase; color: var(--muted);
  }
  .ev-reg-meta dd {
    font-family: var(--mono-font); font-size: 0.95rem; color: var(--ink); margin-top: 0.2rem;
  }
  @media (max-width: 560px) {
    .ev-reg-row { grid-template-columns: 1fr; }
  }
`;
