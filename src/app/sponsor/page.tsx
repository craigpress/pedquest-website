"use client";

import { useState } from "react";
import Link from "next/link";

const AREAS_OF_INTEREST = [
  "Research Funding",
  "Educational Programs",
  "Conference Sponsorship",
  "Equipment / Technology",
  "Data Infrastructure",
  "Other",
];

const SPONSORSHIP_TIERS = ["Platinum", "Gold", "Silver", "Bronze", "Custom"];
const BUDGET_RANGES = [
  "Under $5,000",
  "$5,000 – $25,000",
  "$25,000 – $100,000",
  "$100,000 – $500,000",
  "Over $500,000",
  "To be discussed",
];

type FormState = "idle" | "submitting" | "success" | "error";

export default function SponsorPage() {
  const [companyName, setCompanyName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [tier, setTier] = useState("");
  const [areas, setAreas] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [budgetRange, setBudgetRange] = useState("");
  const [howHeard, setHowHeard] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [formState, setFormState] = useState<FormState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const toggleArea = (area: string) => {
    setAreas((prev) =>
      prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormState("submitting");
    setErrorMsg("");

    try {
      const res = await fetch("/api/sponsor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName,
          contactName,
          contactEmail,
          phone,
          website,
          tier,
          areas: areas.join(", "),
          description,
          budgetRange,
          howHeard,
          honeypot,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || "Submission failed. Please try again.");
        setFormState("error");
      } else {
        setFormState("success");
      }
    } catch {
      setErrorMsg("Network error. Please check your connection and try again.");
      setFormState("error");
    }
  };

  if (formState === "success") {
    return (
      <main style={{ minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
        <div className="card" style={{ maxWidth: 540, width: "100%", padding: "3rem", textAlign: "center" }}>
          <div style={{
            width: 64, height: 64, borderRadius: "50%",
            background: "color-mix(in srgb, var(--accent-tertiary) 15%, transparent)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 1.5rem",
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--accent-tertiary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 style={{ fontFamily: "var(--heading-font)", fontSize: "1.6rem", fontWeight: 700, color: "var(--text)", marginBottom: "1rem" }}>
            Thank You!
          </h2>
          <p style={{ color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: "2rem" }}>
            Your sponsorship inquiry has been received. A member of the PedQuEST leadership team will be in touch within 5 business days.
          </p>
          <Link href="/" className="btn-secondary">Back to Home</Link>
        </div>
      </main>
    );
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "0.65rem 0.9rem",
    borderRadius: 8,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-card)",
    color: "var(--text)",
    fontFamily: "var(--body-font)",
    fontSize: "0.95rem",
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "0.82rem",
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: "0.35rem",
    fontFamily: "var(--body-font)",
  };

  const fieldGroup = (label: string, required: boolean, children: React.ReactNode) => (
    <div>
      <label style={labelStyle}>
        {label}{required && <span style={{ color: "var(--accent-secondary)", marginLeft: 3 }}>*</span>}
      </label>
      {children}
    </div>
  );

  return (
    <main>
      {/* Hero */}
      <section style={{
        padding: "5rem 2rem 3rem",
        background: "radial-gradient(ellipse 80% 50% at 50% 0%, color-mix(in srgb, var(--accent-primary) 8%, transparent) 0%, transparent 60%)",
        borderBottom: "1px solid var(--border)",
        textAlign: "center",
      }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <span style={{
            display: "inline-block",
            fontSize: "0.72rem",
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--accent-primary)",
            background: "color-mix(in srgb, var(--accent-primary) 10%, transparent)",
            padding: "0.3rem 0.85rem",
            borderRadius: 999,
            marginBottom: "1.25rem",
            fontFamily: "var(--body-font)",
          }}>
            Partnership Inquiry
          </span>
          <h1 style={{
            fontFamily: "var(--heading-font)",
            fontSize: "clamp(2rem, 4vw, 3rem)",
            fontWeight: 800,
            color: "var(--text)",
            lineHeight: 1.1,
            marginBottom: "1.25rem",
          }}>
            Become a PedQuEST Sponsor
          </h1>
          <p style={{ color: "var(--text-secondary)", fontSize: "1.05rem", lineHeight: 1.7 }}>
            Your support advances quantitative EEG research, education, and clinical translation for critically ill children worldwide. Tell us about your organization and how you&apos;d like to partner with us.
          </p>
        </div>
      </section>

      {/* Form */}
      <section style={{ padding: "1rem 2rem 5rem", maxWidth: 780, margin: "0 auto" }}>
        <div className="card" style={{ padding: "2.5rem" }}>
          <h2 style={{ fontFamily: "var(--heading-font)", fontSize: "1.4rem", fontWeight: 700, color: "var(--text)", marginBottom: "2rem" }}>
            Sponsorship Inquiry Form
          </h2>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            {/* Honeypot */}
            <div style={{ display: "none" }}>
              <input tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
              {fieldGroup("Company / Organization Name", true,
                <input style={inputStyle} required value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Medical Devices" />
              )}
              {fieldGroup("Contact Name", true,
                <input style={inputStyle} required value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Jane Smith" />
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
              {fieldGroup("Contact Email", true,
                <input style={inputStyle} type="email" required value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="jane@example.com" />
              )}
              {fieldGroup("Phone", false,
                <input style={inputStyle} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 (555) 000-0000" />
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
              {fieldGroup("Website", false,
                <input style={inputStyle} type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://example.com" />
              )}
              {fieldGroup("Sponsorship Tier", false,
                <select style={inputStyle} value={tier} onChange={(e) => setTier(e.target.value)}>
                  <option value="">Select a tier…</option>
                  {SPONSORSHIP_TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
            </div>

            <div>
              <label style={labelStyle}>Areas of Interest</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", marginTop: "0.25rem" }}>
                {AREAS_OF_INTEREST.map((area) => (
                  <button
                    key={area}
                    type="button"
                    onClick={() => toggleArea(area)}
                    style={{
                      padding: "0.45rem 0.9rem",
                      borderRadius: 999,
                      border: "1.5px solid",
                      borderColor: areas.includes(area) ? "var(--accent-primary)" : "var(--border-strong)",
                      background: areas.includes(area) ? "color-mix(in srgb, var(--accent-primary) 12%, transparent)" : "transparent",
                      color: areas.includes(area) ? "var(--accent-primary)" : "var(--text-secondary)",
                      fontSize: "0.85rem",
                      fontWeight: 500,
                      fontFamily: "var(--body-font)",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {area}
                  </button>
                ))}
              </div>
            </div>

            {fieldGroup("Describe Your Collaboration Vision", false,
              <textarea
                style={{ ...inputStyle, minHeight: 120, resize: "vertical" }}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Tell us about your organization's mission and how you envision partnering with PedQuEST…"
              />
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
              {fieldGroup("Budget Range", false,
                <select style={inputStyle} value={budgetRange} onChange={(e) => setBudgetRange(e.target.value)}>
                  <option value="">Select a range…</option>
                  {BUDGET_RANGES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              )}
              {fieldGroup("How Did You Hear About PedQuEST?", false,
                <input style={inputStyle} value={howHeard} onChange={(e) => setHowHeard(e.target.value)} placeholder="Conference, colleague, website…" />
              )}
            </div>

            {formState === "error" && (
              <div style={{
                padding: "0.85rem 1rem",
                borderRadius: 8,
                background: "color-mix(in srgb, var(--accent-secondary) 10%, transparent)",
                border: "1px solid color-mix(in srgb, var(--accent-secondary) 30%, transparent)",
                color: "var(--accent-secondary)",
                fontSize: "0.9rem",
                fontFamily: "var(--body-font)",
              }}>
                {errorMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={formState === "submitting"}
              className="btn-primary"
              style={{ alignSelf: "flex-start", opacity: formState === "submitting" ? 0.7 : 1, cursor: formState === "submitting" ? "not-allowed" : "pointer" }}
            >
              {formState === "submitting" ? "Sending…" : "Submit Inquiry"}
              {formState !== "submitting" && (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 8h10M9 4l4 4-4 4" />
                </svg>
              )}
            </button>
          </form>
        </div>
      </section>

      <style>{`
        @media (max-width: 600px) {
          .sponsor-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </main>
  );
}
