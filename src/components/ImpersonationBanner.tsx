"use client";

// Always-visible reminder that the current session is NOT the admin's own.
// Mounted globally because a switched-in admin browses the whole learner site,
// not just /admin — without this it is genuinely easy to forget which identity
// is active and mistake test data for real data.

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { ROLE_LABELS, isRole, type Role } from "@/lib/roles";
import { readImpersonation, returnToAdmin } from "@/lib/impersonation";

export default function ImpersonationBanner() {
  const [active, setActive] = useState(false);
  const [identity, setIdentity] = useState<{ email: string; role: Role | null; displayName: string | null } | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!readImpersonation()) return;
      if (mounted) setActive(true);
      try {
        const sb = getSupabase();
        const token = sb ? (await sb.auth.getSession()).data.session?.access_token : null;
        if (!token) return;
        const res = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json();
        if (mounted && json?.signedIn) {
          setIdentity({
            email: json.email,
            role: isRole(json.role) ? json.role : null,
            displayName: json.displayName ?? null,
          });
        }
      } catch {
        // ignore — the banner still shows without the identity detail
      }
    })();
    return () => { mounted = false; };
  }, []);

  if (!active) return null;

  const who = identity?.displayName || identity?.email || "test account";
  const roleLabel = identity?.role ? ROLE_LABELS[identity.role] : null;

  return (
    <div
      role="status"
      style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 80,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 14,
        flexWrap: "wrap", padding: "9px 16px",
        background: "var(--bg-card)", borderTop: "2px solid var(--accent-primary)",
        fontFamily: "var(--mono-font)", fontSize: 13, color: "var(--text)",
      }}
    >
      <span>
        Viewing as <strong style={{ color: "var(--accent-primary)" }}>{who}</strong>
        {roleLabel ? ` · ${roleLabel}` : ""} · test account
      </span>
      <button
        type="button"
        onClick={() => { void returnToAdmin(); }}
        style={{
          padding: "5px 12px", borderRadius: 7, border: "1px solid var(--accent-primary)",
          background: "transparent", color: "var(--accent-primary)", cursor: "pointer",
          font: "inherit", fontWeight: 600,
        }}
      >
        Return to admin
      </button>
    </div>
  );
}
