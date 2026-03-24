"use client";

import { useState } from "react";
import Link from "next/link";

type FormData = {
  // Step 1 — Site Info
  hospital: string;
  affiliatedUniversity: string;
  piName: string;
  piEmail: string;
  piPhone: string;
  // Step 2 — Your Profile
  roleTitle: string;
  researchInterests: string;
  howHeard: string;
  statementOfInterest: string;
  agreeToTerms: boolean;
  honeypot: string;
};

type FieldErrors = Partial<Record<keyof FormData, string>>;

const HOW_HEARD_OPTIONS = [
  "Colleague referral",
  "Conference or symposium",
  "Journal article or publication",
  "Social media",
  "PedQuEST website",
  "Email newsletter",
  "Other",
];

const INITIAL_FORM: FormData = {
  hospital: "",
  affiliatedUniversity: "",
  piName: "",
  piEmail: "",
  piPhone: "",
  roleTitle: "",
  researchInterests: "",
  howHeard: "",
  statementOfInterest: "",
  agreeToTerms: false,
  honeypot: "",
};

function validateStep1(data: FormData): FieldErrors {
  const errors: FieldErrors = {};
  if (!data.hospital.trim()) errors.hospital = "Hospital name is required.";
  if (!data.piEmail.trim()) {
    errors.piEmail = "PI email is required.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.piEmail)) {
    errors.piEmail = "Please enter a valid email address.";
  }
  if (!data.piPhone.trim()) errors.piPhone = "PI phone number is required.";
  return errors;
}

function validateStep2(data: FormData): FieldErrors {
  const errors: FieldErrors = {};
  if (!data.agreeToTerms)
    errors.agreeToTerms = "You must agree to the consortium terms to submit.";
  return errors;
}

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <p style={{ color: "#e05a3a", fontSize: "0.82rem", marginTop: "0.35rem" }}>
      {msg}
    </p>
  );
}

function InputField({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      <label
        style={{
          fontSize: "0.9rem",
          fontWeight: 600,
          color: "var(--text)",
          fontFamily: "var(--body-font)",
        }}
      >
        {label}
        {required && (
          <span style={{ color: "var(--accent-primary)", marginLeft: 3 }}>*</span>
        )}
      </label>
      {children}
      <FieldError msg={error} />
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.75rem 1rem",
  borderRadius: 10,
  border: "1px solid var(--border-strong)",
  background: "var(--bg-card)",
  color: "var(--text)",
  fontFamily: "var(--body-font)",
  fontSize: "0.95rem",
  outline: "none",
  transition: "border-color 0.15s ease",
};

const inputErrorStyle: React.CSSProperties = {
  ...inputStyle,
  borderColor: "#e05a3a",
};

export default function JoinPage() {
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<FormData>(INITIAL_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function set(field: keyof FormData, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  function handleNext() {
    const errs = validateStep1(form);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setStep(2);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs = validateStep2(form);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          agreeToTerms: String(form.agreeToTerms),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error || "Something went wrong. Please try again.");
      } else {
        setSubmitted(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      setSubmitError("Network error. Please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return <SuccessState />;
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        padding: "4rem 1.5rem 6rem",
      }}
    >
      <div style={{ maxWidth: 680, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: "2.5rem" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.3rem 0.9rem",
              borderRadius: 99,
              background: "var(--member-badge-bg)",
              color: "var(--member-badge-text)",
              fontSize: "0.78rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: "1rem",
              fontFamily: "var(--body-font)",
            }}
          >
            Consortium Membership
          </div>
          <h1
            style={{
              fontFamily: "var(--heading-font)",
              fontSize: "clamp(2rem, 5vw, 2.75rem)",
              fontWeight: 800,
              color: "var(--text)",
              lineHeight: 1.15,
              marginBottom: "0.75rem",
            }}
          >
            Join PedQuEST
          </h1>
          <p
            style={{
              color: "var(--text-secondary)",
              fontSize: "1.05rem",
              maxWidth: 540,
              lineHeight: 1.65,
              fontFamily: "var(--body-font)",
            }}
          >
            Complete the form below to apply for membership in the Pediatric
            qEEG Strategic Taskforce consortium.
          </p>
        </div>

        {/* Step indicator */}
        <StepIndicator current={step} />

        {/* Form card */}
        <div
          className="card"
          style={{ padding: "2.25rem", marginTop: "1.75rem" }}
        >
          <form onSubmit={handleSubmit} noValidate>
            {/* Honeypot — hidden from real users */}
            <input
              type="text"
              name="website"
              value={form.honeypot}
              onChange={(e) => set("honeypot", e.target.value)}
              tabIndex={-1}
              aria-hidden="true"
              style={{ display: "none" }}
              autoComplete="off"
            />

            {step === 1 && (
              <Step1
                form={form}
                errors={errors}
                set={set}
                onNext={handleNext}
              />
            )}

            {step === 2 && (
              <Step2
                form={form}
                errors={errors}
                set={set}
                submitting={submitting}
                submitError={submitError}
                onBack={() => { setStep(1); window.scrollTo({ top: 0, behavior: "smooth" }); }}
              />
            )}
          </form>
        </div>
      </div>
    </main>
  );
}

function StepIndicator({ current }: { current: 1 | 2 }) {
  const steps = [
    { n: 1, label: "Site Information" },
    { n: 2, label: "Your Profile" },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      {steps.map((s, i) => (
        <div key={s.n} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.82rem",
                fontWeight: 700,
                fontFamily: "var(--body-font)",
                background:
                  current === s.n
                    ? "var(--accent-primary)"
                    : current > s.n
                    ? "var(--accent-tertiary)"
                    : "var(--bg-card-hover)",
                color:
                  current >= s.n ? "#fff" : "var(--text-muted)",
                border:
                  current === s.n
                    ? "2px solid var(--accent-primary)"
                    : "2px solid transparent",
                transition: "all 0.2s ease",
              }}
            >
              {current > s.n ? "✓" : s.n}
            </div>
            <span
              style={{
                fontSize: "0.85rem",
                fontWeight: current === s.n ? 700 : 500,
                color: current === s.n ? "var(--text)" : "var(--text-muted)",
                fontFamily: "var(--body-font)",
              }}
            >
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              style={{
                flex: 1,
                height: 2,
                minWidth: 40,
                background:
                  current > 1
                    ? "var(--accent-primary)"
                    : "var(--border-strong)",
                borderRadius: 99,
                margin: "0 0.25rem",
                transition: "background 0.3s ease",
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function Step1({
  form,
  errors,
  set,
  onNext,
}: {
  form: FormData;
  errors: FieldErrors;
  set: (f: keyof FormData, v: string | boolean) => void;
  onNext: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div>
        <h2
          style={{
            fontFamily: "var(--heading-font)",
            fontSize: "1.3rem",
            fontWeight: 700,
            color: "var(--text)",
            marginBottom: "0.35rem",
          }}
        >
          Site Information
        </h2>
        <p style={{ fontSize: "0.88rem", color: "var(--text-muted)", fontFamily: "var(--body-font)" }}>
          Tell us about your institution and Principal Investigator.
        </p>
      </div>

      <InputField label="Hospital" required error={errors.hospital}>
        <input
          type="text"
          value={form.hospital}
          onChange={(e) => set("hospital", e.target.value)}
          placeholder="e.g. Children's Hospital of Philadelphia"
          style={errors.hospital ? inputErrorStyle : inputStyle}
          onFocus={(e) => { e.target.style.borderColor = "var(--accent-primary)"; }}
          onBlur={(e) => { e.target.style.borderColor = errors.hospital ? "#e05a3a" : "var(--border-strong)"; }}
        />
      </InputField>

      <InputField label="Affiliated University" error={errors.affiliatedUniversity}>
        <input
          type="text"
          value={form.affiliatedUniversity}
          onChange={(e) => set("affiliatedUniversity", e.target.value)}
          placeholder="e.g. University of Pennsylvania"
          style={inputStyle}
          onFocus={(e) => { e.target.style.borderColor = "var(--accent-primary)"; }}
          onBlur={(e) => { e.target.style.borderColor = "var(--border-strong)"; }}
        />
      </InputField>

      <InputField label="Site PI Full Name" error={errors.piName}>
        <input
          type="text"
          value={form.piName}
          onChange={(e) => set("piName", e.target.value)}
          placeholder="Dr. Jane Smith"
          style={inputStyle}
          onFocus={(e) => { e.target.style.borderColor = "var(--accent-primary)"; }}
          onBlur={(e) => { e.target.style.borderColor = "var(--border-strong)"; }}
        />
      </InputField>

      <InputField label="Site PI Email Address" required error={errors.piEmail}>
        <input
          type="email"
          value={form.piEmail}
          onChange={(e) => set("piEmail", e.target.value)}
          placeholder="pi@hospital.edu"
          style={errors.piEmail ? inputErrorStyle : inputStyle}
          onFocus={(e) => { e.target.style.borderColor = "var(--accent-primary)"; }}
          onBlur={(e) => { e.target.style.borderColor = errors.piEmail ? "#e05a3a" : "var(--border-strong)"; }}
        />
      </InputField>

      <InputField label="Site PI Phone Number" required error={errors.piPhone}>
        <input
          type="tel"
          value={form.piPhone}
          onChange={(e) => set("piPhone", e.target.value)}
          placeholder="+1 (555) 000-0000"
          style={errors.piPhone ? inputErrorStyle : inputStyle}
          onFocus={(e) => { e.target.style.borderColor = "var(--accent-primary)"; }}
          onBlur={(e) => { e.target.style.borderColor = errors.piPhone ? "#e05a3a" : "var(--border-strong)"; }}
        />
      </InputField>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.5rem" }}>
        <button
          type="button"
          onClick={onNext}
          className="btn-primary"
          style={{ fontSize: "0.95rem", padding: "0.8rem 2rem" }}
        >
          Next: Your Profile
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function Step2({
  form,
  errors,
  set,
  submitting,
  submitError,
  onBack,
}: {
  form: FormData;
  errors: FieldErrors;
  set: (f: keyof FormData, v: string | boolean) => void;
  submitting: boolean;
  submitError: string | null;
  onBack: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <div>
        <h2
          style={{
            fontFamily: "var(--heading-font)",
            fontSize: "1.3rem",
            fontWeight: 700,
            color: "var(--text)",
            marginBottom: "0.35rem",
          }}
        >
          Your Profile
        </h2>
        <p style={{ fontSize: "0.88rem", color: "var(--text-muted)", fontFamily: "var(--body-font)" }}>
          Help us understand your background and research interests.
        </p>
      </div>

      <InputField label="Role / Title" error={errors.roleTitle}>
        <input
          type="text"
          value={form.roleTitle}
          onChange={(e) => set("roleTitle", e.target.value)}
          placeholder="e.g. Associate Professor of Neurology"
          style={inputStyle}
          onFocus={(e) => { e.target.style.borderColor = "var(--accent-primary)"; }}
          onBlur={(e) => { e.target.style.borderColor = "var(--border-strong)"; }}
        />
      </InputField>

      <InputField label="Research Interests / Areas of Expertise" error={errors.researchInterests}>
        <textarea
          value={form.researchInterests}
          onChange={(e) => set("researchInterests", e.target.value)}
          placeholder="e.g. Neonatal EEG, seizure detection, neurocritical care..."
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
          onFocus={(e) => { e.target.style.borderColor = "var(--accent-primary)"; }}
          onBlur={(e) => { e.target.style.borderColor = "var(--border-strong)"; }}
        />
      </InputField>

      <InputField label="How did you hear about PedQuEST?" error={errors.howHeard}>
        <select
          value={form.howHeard}
          onChange={(e) => set("howHeard", e.target.value)}
          style={{ ...inputStyle, cursor: "pointer" }}
          onFocus={(e) => { e.target.style.borderColor = "var(--accent-primary)"; }}
          onBlur={(e) => { e.target.style.borderColor = "var(--border-strong)"; }}
        >
          <option value="">Select an option</option>
          {HOW_HEARD_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </InputField>

      <InputField label="Brief Statement of Interest" error={errors.statementOfInterest}>
        <textarea
          value={form.statementOfInterest}
          onChange={(e) => set("statementOfInterest", e.target.value)}
          placeholder="Briefly describe why you'd like to join PedQuEST and what you hope to contribute..."
          rows={4}
          style={{ ...inputStyle, resize: "vertical" }}
          onFocus={(e) => { e.target.style.borderColor = "var(--accent-primary)"; }}
          onBlur={(e) => { e.target.style.borderColor = "var(--border-strong)"; }}
        />
      </InputField>

      {/* Terms agreement */}
      <div
        style={{
          padding: "1.25rem",
          borderRadius: 12,
          border: `1px solid ${errors.agreeToTerms ? "#e05a3a" : "var(--border-strong)"}`,
          background: "var(--bg-card-hover)",
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "0.75rem",
            cursor: "pointer",
            fontFamily: "var(--body-font)",
          }}
        >
          <input
            type="checkbox"
            checked={form.agreeToTerms}
            onChange={(e) => set("agreeToTerms", e.target.checked)}
            style={{
              marginTop: "0.2rem",
              width: 18,
              height: 18,
              accentColor: "var(--accent-primary)",
              cursor: "pointer",
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: "0.88rem", color: "var(--text)", lineHeight: 1.55 }}>
            I agree to participate in the PedQuEST consortium in accordance with
            the consortium&apos;s data sharing policies and collaborative research
            guidelines. I understand that membership is subject to review and
            approval by the coordinating committee.
            <span style={{ color: "var(--accent-primary)", marginLeft: 3 }}>*</span>
          </span>
        </label>
        <FieldError msg={errors.agreeToTerms} />
      </div>

      {submitError && (
        <div
          style={{
            padding: "0.85rem 1rem",
            borderRadius: 10,
            background: "rgba(224, 90, 58, 0.1)",
            border: "1px solid rgba(224, 90, 58, 0.3)",
            color: "#e05a3a",
            fontSize: "0.9rem",
            fontFamily: "var(--body-font)",
          }}
        >
          {submitError}
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: "0.5rem",
          gap: "1rem",
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
            padding: "0.8rem 1.5rem",
            borderRadius: 10,
            border: "1px solid var(--border-strong)",
            background: "transparent",
            color: "var(--text-secondary)",
            fontFamily: "var(--body-font)",
            fontWeight: 600,
            fontSize: "0.9rem",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-card-hover)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>

        <button
          type="submit"
          disabled={submitting}
          className="btn-primary"
          style={{
            fontSize: "0.95rem",
            padding: "0.8rem 2rem",
            opacity: submitting ? 0.7 : 1,
            cursor: submitting ? "not-allowed" : "pointer",
          }}
        >
          {submitting ? (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ animation: "spin 1s linear infinite" }}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              Submitting…
            </>
          ) : (
            <>
              Submit Application
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function SuccessState() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "4rem 1.5rem",
      }}
    >
      <div style={{ maxWidth: 520, width: "100%", textAlign: "center" }}>
        {/* Check icon */}
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: "linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 1.75rem",
            boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
          }}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>

        <h1
          style={{
            fontFamily: "var(--heading-font)",
            fontSize: "clamp(1.75rem, 4vw, 2.25rem)",
            fontWeight: 800,
            color: "var(--text)",
            marginBottom: "1rem",
            lineHeight: 1.2,
          }}
        >
          Application Submitted!
        </h1>
        <p
          style={{
            color: "var(--text-secondary)",
            fontSize: "1.05rem",
            lineHeight: 1.65,
            marginBottom: "2.25rem",
            fontFamily: "var(--body-font)",
          }}
        >
          Thank you for your interest in joining PedQuEST. The coordinating
          committee will review your application and be in touch via the PI
          email address you provided.
        </p>

        <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/" className="btn-primary" style={{ textDecoration: "none" }}>
            Back to Home
          </Link>
          <Link href="/about" className="btn-secondary" style={{ textDecoration: "none" }}>
            Learn More About PedQuEST
          </Link>
        </div>
      </div>
    </main>
  );
}
