"use client";

import { useState, FormEvent } from "react";

const subjectOptions = [
  "General Inquiry",
  "Join PedQuEST",
  "Research Collaboration",
  "Education",
  "Other",
];

export default function ContactPage() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    subject: "",
    message: "",
    honeypot: "", // spam trap
  });
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus("error");
        setErrorMsg(data.error || "Something went wrong. Please try again.");
        return;
      }

      setStatus("success");
      setFormData({ name: "", email: "", subject: "", message: "", honeypot: "" });
    } catch {
      setStatus("error");
      setErrorMsg("Network error. Please check your connection and try again.");
    }
  };

  return (
    <main
      style={{
        maxWidth: 1200,
        margin: "0 auto",
        padding: "3rem 1.5rem 4rem",
      }}
    >
      {/* Page Header */}
      <section style={{ marginBottom: "3rem" }}>
        <h1
          className="section-heading"
          style={{
            fontFamily: "var(--heading-font)",
            fontSize: "2.75rem",
            marginBottom: "0.75rem",
          }}
        >
          Contact Us
        </h1>
        <p
          className="section-subheading"
          style={{ maxWidth: 600, lineHeight: 1.7 }}
        >
          Have a question about PedQuEST, interested in joining the consortium,
          or want to explore a research collaboration? We'd love to hear from you.
        </p>
      </section>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "3rem",
          alignItems: "start",
        }}
      >
        {/* Contact Form */}
        <form
          onSubmit={handleSubmit}
          className="card"
          style={{ padding: "2rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}
        >
          {/* Honeypot - hidden from humans */}
          <div style={{ position: "absolute", left: "-9999px" }} aria-hidden="true">
            <label htmlFor="honeypot">Do not fill this field</label>
            <input
              type="text"
              id="honeypot"
              name="honeypot"
              value={formData.honeypot}
              onChange={handleChange}
              tabIndex={-1}
              autoComplete="off"
            />
          </div>

          {/* Name */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            <label
              htmlFor="name"
              style={{
                fontSize: "0.85rem",
                fontWeight: 600,
                color: "var(--text-secondary)",
                fontFamily: "var(--body-font)",
              }}
            >
              Name <span style={{ color: "var(--accent-primary)" }}>*</span>
            </label>
            <input
              type="text"
              id="name"
              name="name"
              required
              value={formData.name}
              onChange={handleChange}
              placeholder="Your full name"
              style={{
                padding: "0.75rem 1rem",
                borderRadius: 8,
                border: "1px solid var(--border-strong)",
                background: "var(--bg)",
                color: "var(--text)",
                fontFamily: "var(--body-font)",
                fontSize: "0.9rem",
                outline: "none",
                transition: "border-color 0.15s ease",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent-primary)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border-strong)")}
            />
          </div>

          {/* Email */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            <label
              htmlFor="email"
              style={{
                fontSize: "0.85rem",
                fontWeight: 600,
                color: "var(--text-secondary)",
                fontFamily: "var(--body-font)",
              }}
            >
              Email <span style={{ color: "var(--accent-primary)" }}>*</span>
            </label>
            <input
              type="email"
              id="email"
              name="email"
              required
              value={formData.email}
              onChange={handleChange}
              placeholder="you@example.com"
              style={{
                padding: "0.75rem 1rem",
                borderRadius: 8,
                border: "1px solid var(--border-strong)",
                background: "var(--bg)",
                color: "var(--text)",
                fontFamily: "var(--body-font)",
                fontSize: "0.9rem",
                outline: "none",
                transition: "border-color 0.15s ease",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent-primary)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border-strong)")}
            />
          </div>

          {/* Subject */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            <label
              htmlFor="subject"
              style={{
                fontSize: "0.85rem",
                fontWeight: 600,
                color: "var(--text-secondary)",
                fontFamily: "var(--body-font)",
              }}
            >
              Subject <span style={{ color: "var(--accent-primary)" }}>*</span>
            </label>
            <select
              id="subject"
              name="subject"
              required
              value={formData.subject}
              onChange={handleChange}
              style={{
                padding: "0.75rem 1rem",
                borderRadius: 8,
                border: "1px solid var(--border-strong)",
                background: "var(--bg)",
                color: formData.subject ? "var(--text)" : "var(--text-muted)",
                fontFamily: "var(--body-font)",
                fontSize: "0.9rem",
                outline: "none",
                cursor: "pointer",
                transition: "border-color 0.15s ease",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent-primary)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border-strong)")}
            >
              <option value="" disabled>
                Select a subject...
              </option>
              {subjectOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          {/* Message */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            <label
              htmlFor="message"
              style={{
                fontSize: "0.85rem",
                fontWeight: 600,
                color: "var(--text-secondary)",
                fontFamily: "var(--body-font)",
              }}
            >
              Message <span style={{ color: "var(--accent-primary)" }}>*</span>
            </label>
            <textarea
              id="message"
              name="message"
              required
              rows={5}
              value={formData.message}
              onChange={handleChange}
              placeholder="How can we help?"
              style={{
                padding: "0.75rem 1rem",
                borderRadius: 8,
                border: "1px solid var(--border-strong)",
                background: "var(--bg)",
                color: "var(--text)",
                fontFamily: "var(--body-font)",
                fontSize: "0.9rem",
                outline: "none",
                resize: "vertical",
                minHeight: 120,
                transition: "border-color 0.15s ease",
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent-primary)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border-strong)")}
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            className="btn-primary"
            disabled={status === "loading"}
            style={{
              justifyContent: "center",
              opacity: status === "loading" ? 0.7 : 1,
              cursor: status === "loading" ? "not-allowed" : "pointer",
            }}
          >
            {status === "loading" ? "Sending..." : "Send Message"}
          </button>

          {/* Feedback Messages */}
          {status === "success" && (
            <div
              style={{
                padding: "0.875rem 1rem",
                borderRadius: 8,
                background: `var(--accent-tertiary)14`,
                border: "1px solid var(--accent-tertiary)",
                color: "var(--accent-tertiary)",
                fontSize: "0.85rem",
                fontWeight: 500,
              }}
            >
              Thank you! Your message has been sent. We'll get back to you soon.
            </div>
          )}

          {status === "error" && (
            <div
              style={{
                padding: "0.875rem 1rem",
                borderRadius: 8,
                background: "rgba(220, 50, 50, 0.08)",
                border: "1px solid rgba(220, 50, 50, 0.3)",
                color: "#dc3232",
                fontSize: "0.85rem",
                fontWeight: 500,
              }}
            >
              {errorMsg}
            </div>
          )}
        </form>

        {/* Info Panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          <div
            className="card"
            style={{ padding: "2rem", display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            <h2
              style={{
                fontFamily: "var(--heading-font)",
                fontSize: "1.25rem",
                fontWeight: 700,
                color: "var(--text)",
              }}
            >
              Get Involved
            </h2>
            <p
              style={{
                fontSize: "0.9rem",
                lineHeight: 1.7,
                color: "var(--text-secondary)",
              }}
            >
              PedQuEST is a growing consortium of pediatric institutions
              committed to advancing qEEG research and clinical practice. Whether
              you're a researcher, clinician, or institution, there are many ways
              to contribute.
            </p>
          </div>

          <div
            className="card"
            style={{ padding: "2rem", display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            <h2
              style={{
                fontFamily: "var(--heading-font)",
                fontSize: "1.25rem",
                fontWeight: 700,
                color: "var(--text)",
              }}
            >
              Response Time
            </h2>
            <p
              style={{
                fontSize: "0.9rem",
                lineHeight: 1.7,
                color: "var(--text-secondary)",
              }}
            >
              We typically respond within 3-5 business days. For urgent research
              collaboration inquiries, please indicate so in your message.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
