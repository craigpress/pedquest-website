"use client";

import Link from "next/link";
import { useUser } from "@/lib/auth";

/**
 * Wraps member-only content on an otherwise public page.
 *
 * This is a UX gate, not a security boundary — the server routes behind it
 * check the caller's token independently (see resolveCaller / requireRole).
 */
export default function SignedInGate({
  children,
  title = "Sign in to continue",
  message = "The question bank is open to PedQuEST members and registered learners.",
}: {
  children: React.ReactNode;
  title?: string;
  message?: string;
}) {
  const { user, loading } = useUser();

  if (loading) {
    return <p style={{ color: "var(--text-muted)", fontFamily: "var(--mono-font)", fontSize: 13 }}>Checking your session…</p>;
  }

  if (!user) {
    return (
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: "2.25rem 2rem",
          textAlign: "center",
        }}
      >
        <h2 style={{ fontFamily: "var(--heading-font)", fontSize: "1.35rem", color: "var(--text)", margin: 0 }}>
          {title}
        </h2>
        <p style={{ color: "var(--text-secondary)", margin: "10px auto 20px", maxWidth: "46ch", lineHeight: 1.6 }}>
          {message}
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/login" className="btn-primary">Sign in</Link>
          <Link href="/join" className="btn-secondary">Join PedQuEST</Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
