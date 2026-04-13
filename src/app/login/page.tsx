"use client";

import { useState } from "react";
import Link from "next/link";
import { signInWithMagicLink } from "@/lib/auth";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus("loading");
    setErrorMsg("");

    const { error } = await signInWithMagicLink(email.trim());

    if (error) {
      setStatus("error");
      setErrorMsg(error);
    } else {
      setStatus("success");
    }
  }

  return (
    <div
      style={{
        minHeight: "calc(100vh - 92px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        background: "var(--bg)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: "2.5rem",
          boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--heading-font)",
            fontSize: "1.75rem",
            fontWeight: 800,
            color: "var(--text)",
            marginBottom: "0.5rem",
            marginTop: 0,
          }}
        >
          Sign In
        </h1>
        <p
          style={{
            fontFamily: "var(--body-font)",
            fontSize: "0.95rem",
            color: "var(--text-secondary)",
            marginBottom: "1.5rem",
            lineHeight: 1.5,
          }}
        >
          Sign in with your institutional account or email.
        </p>

        {/* Authentik SSO Button */}
        <button
          type="button"
          onClick={() => {
            window.location.href = "/api/auth/authentik";
          }}
          style={{
            width: "100%",
            padding: "0.8rem",
            fontSize: "1rem",
            fontWeight: 600,
            fontFamily: "var(--body-font)",
            color: "white",
            background: "var(--accent-primary)",
            border: "none",
            borderRadius: 10,
            cursor: "pointer",
            marginBottom: "1.5rem",
            transition: "opacity 0.2s",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.9")}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" fill="currentColor"/>
          </svg>
          Sign in with Authentik
        </button>

        {/* Divider */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          <span
            style={{
              fontFamily: "var(--body-font)",
              fontSize: "0.8rem",
              color: "var(--text-secondary)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            or
          </span>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>

        {status === "success" ? (
          <div
            style={{
              padding: "1.25rem",
              borderRadius: 12,
              background: "var(--bg-card-hover)",
              border: "1px solid var(--accent-primary)",
              textAlign: "center",
            }}
          >
            <p
              style={{
                fontFamily: "var(--body-font)",
                fontSize: "1rem",
                fontWeight: 600,
                color: "var(--accent-primary)",
                margin: 0,
              }}
            >
              Check your email for a login link
            </p>
            <p
              style={{
                fontFamily: "var(--body-font)",
                fontSize: "0.85rem",
                color: "var(--text-secondary)",
                marginTop: "0.5rem",
                marginBottom: 0,
              }}
            >
              We sent a link to <strong>{email}</strong>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <label
              htmlFor="email"
              style={{
                display: "block",
                fontFamily: "var(--body-font)",
                fontSize: "0.85rem",
                fontWeight: 600,
                color: "var(--text-secondary)",
                marginBottom: "0.5rem",
              }}
            >
              Email address
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@institution.edu"
              style={{
                width: "100%",
                padding: "0.75rem 1rem",
                fontSize: "1rem",
                fontFamily: "var(--body-font)",
                color: "var(--text)",
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                outline: "none",
                boxSizing: "border-box",
                marginBottom: "0.75rem",
              }}
            />

            {status === "error" && errorMsg && (
              <p
                style={{
                  fontFamily: "var(--body-font)",
                  fontSize: "0.85rem",
                  color: "#e53e3e",
                  margin: "0 0 0.75rem 0",
                }}
              >
                {errorMsg}
              </p>
            )}

            <button
              type="submit"
              disabled={status === "loading"}
              style={{
                width: "100%",
                padding: "0.75rem",
                fontSize: "1rem",
                fontWeight: 600,
                fontFamily: "var(--body-font)",
                color: "white",
                background: "var(--accent-primary)",
                border: "none",
                borderRadius: 10,
                cursor: status === "loading" ? "not-allowed" : "pointer",
                opacity: status === "loading" ? 0.7 : 1,
                transition: "opacity 0.2s",
              }}
            >
              {status === "loading" ? "Sending..." : "Send Login Link"}
            </button>
          </form>
        )}

        <p
          style={{
            fontFamily: "var(--body-font)",
            fontSize: "0.85rem",
            color: "var(--text-secondary)",
            textAlign: "center",
            marginTop: "1.5rem",
            marginBottom: 0,
          }}
        >
          Not a member?{" "}
          <Link
            href="/join"
            style={{ color: "var(--accent-primary)", fontWeight: 600 }}
          >
            Join PedQuEST
          </Link>
        </p>

        <p
          style={{
            fontFamily: "var(--body-font)",
            fontSize: "0.8rem",
            color: "var(--text-secondary)",
            textAlign: "center",
            marginTop: "0.75rem",
            marginBottom: 0,
          }}
        >
          <Link href="/" style={{ color: "var(--text-secondary)" }}>
            Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}
