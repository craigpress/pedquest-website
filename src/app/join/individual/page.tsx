"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import FormPrivacyNote from "@/components/FormPrivacyNote";

const ROLE_OPTIONS = [
  "Attending physician",
  "Fellow",
  "Resident",
  "Advanced practice provider",
  "Nurse",
  "EEG technologist",
  "Scientist / researcher",
  "Engineer / data scientist",
  "Student",
  "Other",
];

type Status = "idle" | "loading" | "success" | "error";

export default function JoinIndividualPage() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    institution: "",
    country: "",
    roleTitle: "",
    interests: "",
    honeypot: "",
  });
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [existingMember, setExistingMember] = useState<{ id: string; name: string } | null>(
    null
  );

  const update = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/join/individual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, consentEmail: consent }),
      });
      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setErrorMsg(data.error || "Something went wrong. Please try again.");
        return;
      }

      setExistingMember(data.existingMember ?? null);
      setStatus("success");
    } catch {
      setStatus("error");
      setErrorMsg("Network error. Please check your connection and try again.");
    }
  }

  if (status === "success") {
    return (
      <main className="ji-wrap">
        <div className="home-container">
          <div className="ji-done">
          <span className="section-eyebrow">You&apos;re on the list</span>
          <h1 className="ji-h1">Check your inbox.</h1>
          <p className="ji-sub">
            We&apos;ve sent a confirmation to <strong>{form.email}</strong>. You&apos;ll
            get invitations to PedQuEST meetings and education sessions, plus
            occasional consortium news.
          </p>

          {existingMember && (
            <div className="ji-match">
              <p>
                You&apos;re already listed as a PedQuEST member —{" "}
                <strong>{existingMember.name}</strong>. Sign in to update your
                bio, research interests, and CV rather than starting a new
                profile.
              </p>
              <div className="ji-match-actions">
                <Link href="/login" className="btn-primary">
                  Sign in
                </Link>
                <Link href={`/members/${existingMember.id}`} className="btn-secondary">
                  View your profile
                </Link>
              </div>
            </div>
          )}

          <p className="ji-foot">
            If your centre wants to contribute qEEG data,{" "}
            <Link href="/join/site">apply as a member site</Link>. To be removed
            from the list at any time, reply to the confirmation email or use
            our <Link href="/contact">contact form</Link>.
            </p>
          </div>
        </div>

        <style>{`
          ${SHARED_CSS}
        `}</style>
      </main>
    );
  }

  return (
    <main className="ji-wrap">
      <div className="home-container">
        <div className="ji-inner">
        <Link href="/join" className="ji-back">
          ← Both ways to join
        </Link>
        <span className="section-eyebrow">For individuals</span>
        <h1 className="ji-h1">Join as an individual.</h1>
        <p className="ji-sub">
          For clinicians, trainees, technologists, and researchers who want
          meeting invitations and consortium news. No institutional commitment,
          and you can leave the list at any time.
        </p>

        <form onSubmit={handleSubmit} className="ji-form" noValidate>
          <div className="ji-row">
            <label className="ji-field">
              <span className="ji-label">
                Name <span className="ji-req">*</span>
              </span>
              <input
                name="name"
                value={form.name}
                onChange={update}
                required
                autoComplete="name"
                className="ji-input"
                placeholder="Dr Jane Okafor"
              />
            </label>
            <label className="ji-field">
              <span className="ji-label">
                Email <span className="ji-req">*</span>
              </span>
              <input
                name="email"
                type="email"
                value={form.email}
                onChange={update}
                required
                autoComplete="email"
                className="ji-input"
                placeholder="you@hospital.edu"
              />
            </label>
          </div>

          <div className="ji-row">
            <label className="ji-field">
              <span className="ji-label">Institution</span>
              <input
                name="institution"
                value={form.institution}
                onChange={update}
                autoComplete="organization"
                className="ji-input"
                placeholder="Optional"
              />
            </label>
            <label className="ji-field">
              <span className="ji-label">Country</span>
              <input
                name="country"
                value={form.country}
                onChange={update}
                autoComplete="country-name"
                className="ji-input"
                placeholder="Optional"
              />
            </label>
          </div>

          <label className="ji-field">
            <span className="ji-label">Role</span>
            <select
              name="roleTitle"
              value={form.roleTitle}
              onChange={update}
              className="ji-input"
            >
              <option value="">Optional — select one</option>
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label className="ji-field">
            <span className="ji-label">What brings you to PedQuEST?</span>
            <textarea
              name="interests"
              value={form.interests}
              onChange={update}
              rows={4}
              className="ji-input ji-textarea"
              placeholder="Optional — the qEEG questions you care about, or what you'd like from the meetings."
            />
          </label>

          {/* spam trap */}
          <input
            type="text"
            name="honeypot"
            value={form.honeypot}
            onChange={update}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="ji-honeypot"
          />

          <label className="ji-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="ji-checkbox"
            />
            <span>
              Email me about PedQuEST meetings, education sessions, and
              consortium news. <span className="ji-req">*</span>
            </span>
          </label>

          {status === "error" && (
            <p role="alert" className="ji-error">
              {errorMsg}
            </p>
          )}

          <button
            type="submit"
            className="btn-primary ji-submit"
            disabled={status === "loading"}
          >
            {status === "loading" ? "Signing you up…" : "Sign me up"}
          </button>

          <FormPrivacyNote what="your name, email and the optional details above" />
          </form>
        </div>
      </div>

      <style>{`
        ${SHARED_CSS}
      `}</style>
    </main>
  );
}

const SHARED_CSS = `
  /* ── Individual signup (page-specific; shared classes in globals.css) ── */
  .ji-wrap {
    padding: clamp(5rem, 10vw, 7rem) 2rem clamp(4rem, 8vw, 6rem);
    background: var(--bg);
  }
  .ji-inner, .ji-done { max-width: 44rem; }
  .ji-back {
    display: block;
    margin-bottom: 1.5rem;
    font-size: 0.85rem;
    color: var(--muted);
    text-decoration: none;
  }
  .ji-back:hover { color: var(--accent); }
  .ji-h1 {
    font-family: var(--heading-font);
    font-size: clamp(2rem, 4vw, 2.9rem);
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.02em;
    color: var(--ink);
    margin: 0.9rem 0 0;
  }
  .ji-sub {
    margin-top: 1rem;
    font-size: 1.02rem;
    line-height: 1.7;
    color: var(--ink-2);
    max-width: 56ch;
  }

  .ji-form {
    margin-top: 2.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .ji-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; }
  .ji-field { display: flex; flex-direction: column; gap: 0.45rem; }
  .ji-label {
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .ji-req { color: var(--accent); }
  .ji-input {
    width: 100%;
    padding: 0.7rem 0.85rem;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--bg-card);
    color: var(--text);
    font-family: var(--body-font);
    font-size: 0.95rem;
    transition: border-color 0.2s ease;
  }
  .ji-input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .ji-input::placeholder { color: var(--muted); }
  .ji-textarea { resize: vertical; line-height: 1.6; }
  .ji-honeypot {
    position: absolute;
    left: -9999px;
    width: 1px;
    height: 1px;
    opacity: 0;
  }

  .ji-consent {
    display: flex;
    align-items: flex-start;
    gap: 0.65rem;
    font-size: 0.92rem;
    line-height: 1.6;
    color: var(--ink-2);
    cursor: pointer;
  }
  .ji-checkbox {
    margin-top: 0.25rem;
    width: 1rem;
    height: 1rem;
    accent-color: var(--accent);
    flex-shrink: 0;
  }
  .ji-error {
    padding: 0.8rem 1rem;
    border-radius: 8px;
    border: 1px solid var(--warm);
    color: var(--warm);
    font-size: 0.88rem;
    margin: 0;
  }
  .ji-submit { align-self: flex-start; }

  .ji-match {
    margin-top: 2rem;
    padding: 1.25rem 1.5rem;
    border: 1px solid var(--accent);
    border-radius: 12px;
    background: var(--bg-card);
  }
  .ji-match p {
    margin: 0 0 1rem;
    font-size: 0.95rem;
    line-height: 1.65;
    color: var(--ink-2);
  }
  .ji-match strong { color: var(--ink); }
  .ji-match-actions { display: flex; flex-wrap: wrap; gap: 0.75rem; }

  .ji-foot {
    margin-top: 2rem;
    font-size: 0.88rem;
    line-height: 1.7;
    color: var(--muted);
  }
  .ji-foot a { color: var(--accent); }

  @media (max-width: 640px) {
    .ji-row { grid-template-columns: 1fr; }
  }
`;
