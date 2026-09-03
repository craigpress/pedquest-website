"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRole } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from "@/lib/roles";
import { adminShell, btnGhost, card, eyebrow, h1, inp, meta, mini } from "@/lib/admin-ui";

interface UserRow {
  email: string;
  role: Role | null;
  userId: string | null;
  lastSignInAt: string | null;
  createdAt: string | null;
  memberId: string | null;
  memberName: string | null;
  institution: string | null;
  grantedAt: string | null;
}
interface Counts { admin: number; editor: number; member: number; unassigned: number }

export default function AdminUsersPage() {
  const { isAdmin, loading: roleLoading } = useRole();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | Role | "unassigned">("all");

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); };

  const authHeaders = useCallback(async () => {
    const sb = getSupabase();
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : null;
    return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", { headers: await authHeaders() });
      const json = await res.json();
      if (res.ok && json.success) { setUsers(json.users); setCounts(json.counts); }
      else setError(json.error || "Could not load accounts.");
    } catch {
      setError("Network error loading accounts.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => { if (isAdmin) void load(); }, [isAdmin, load]);

  async function setRole(email: string, role: Role) {
    setSaving(email);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ email, role }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        setUsers((prev) => prev.map((u) => (u.email === email ? { ...u, role } : u)));
        flash(`${email} is now ${ROLE_LABELS[role].toLowerCase()}.`);
        void load();
      } else {
        setError(json.error || "Could not save the role.");
      }
    } catch {
      setError("Network error saving the role.");
    } finally {
      setSaving(null);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter === "unassigned" && u.role) return false;
      if (roleFilter !== "all" && roleFilter !== "unassigned" && u.role !== roleFilter) return false;
      if (!q) return true;
      return (
        u.email.includes(q) ||
        (u.memberName ?? "").toLowerCase().includes(q) ||
        (u.institution ?? "").toLowerCase().includes(q)
      );
    });
  }, [users, query, roleFilter]);

  if (roleLoading) {
    return <div style={adminShell}><p style={{ color: "var(--text-muted)" }}>Loading…</p></div>;
  }
  if (!isAdmin) {
    return (
      <div style={adminShell}>
        <h1 style={h1}>Admin access required</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: 10 }}>
          Only PedQuEST admins can grant roles. <Link href="/login">Sign in</Link> with an admin account.
        </p>
      </div>
    );
  }

  return (
    <div style={adminShell}>
      <style>{`
        .users-filters { display: flex; gap: 8px; flex-wrap: wrap; }
        .users-row { display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: center;
          padding: 13px 18px; border-bottom: 1px solid var(--border); }
        .users-roles { display: flex; gap: 6px; flex-wrap: wrap; }
        @media (max-width: 620px) {
          .users-row { grid-template-columns: 1fr; }
          .users-roles { justify-content: flex-start; }
        }
      `}</style>

      <div style={{ marginBottom: 22 }}>
        <span style={eyebrow}>Access control</span>
        <h1 style={{ ...h1, marginTop: 6 }}>Roles &amp; permissions</h1>
        <p style={{ color: "var(--text-secondary)", marginTop: 8, maxWidth: "58ch" }}>
          Roles are stored in <code>user_roles</code> and enforced server-side on every write.
          There is no longer a hardcoded email allowlist anywhere in the code.
        </p>
        {counts && (
          <p style={{ ...meta, marginTop: 8 }}>
            {counts.admin} admin · {counts.editor} editor · {counts.member} member · {counts.unassigned} no role
          </p>
        )}
      </div>

      <div style={{ display: "grid", gap: 10, marginBottom: 18 }}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by email, name or institution"
          style={inp}
          aria-label="Search accounts"
        />
        <div className="users-filters" role="group" aria-label="Filter by role">
          {(["all", ...ROLES, "unassigned"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRoleFilter(r)}
              style={{
                ...mini,
                borderColor: roleFilter === r ? "var(--accent-primary)" : "var(--border)",
                color: roleFilter === r ? "var(--accent-primary)" : "var(--text-secondary)",
              }}
            >
              {r === "all" ? "All" : r === "unassigned" ? "No role" : ROLE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" style={{ ...card, borderColor: "var(--accent-secondary)", padding: "12px 16px", marginBottom: 16, color: "var(--accent-secondary)", fontSize: 14 }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading accounts…</p>
      ) : (
        <div style={{ ...card, overflow: "hidden" }}>
          {filtered.length === 0 && (
            <div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)" }}>
              No accounts match that filter.
            </div>
          )}
          {filtered.map((u) => (
            <div className="users-row" key={u.email}>
              <div>
                <div style={{ fontWeight: 600, color: "var(--text)" }}>
                  {u.memberName || u.email}
                </div>
                <div style={{ ...meta, marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {u.memberName && <span>{u.email}</span>}
                  {u.institution && <span>{u.institution}</span>}
                  <span>{u.userId ? (u.lastSignInAt ? `last sign-in ${u.lastSignInAt.slice(0, 10)}` : "never signed in") : "no account yet"}</span>
                </div>
              </div>
              <div className="users-roles">
                {ROLES.map((r) => {
                  const active = u.role === r;
                  return (
                    <button
                      key={r}
                      type="button"
                      title={ROLE_DESCRIPTIONS[r]}
                      aria-pressed={active}
                      disabled={saving === u.email || active}
                      onClick={() => setRole(u.email, r)}
                      style={{
                        ...mini,
                        cursor: active ? "default" : "pointer",
                        borderColor: active ? "var(--accent-primary)" : "var(--border)",
                        color: active ? "var(--accent-primary)" : "var(--text-secondary)",
                        fontWeight: active ? 700 : 500,
                        opacity: saving === u.email ? 0.5 : 1,
                      }}
                    >
                      {ROLE_LABELS[r]}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ ...card, padding: "16px 18px", marginTop: 20 }}>
        <div style={eyebrow}>What each role can do</div>
        <ul style={{ margin: "10px 0 0", paddingLeft: 20, color: "var(--text-secondary)", fontSize: 14, lineHeight: 1.6 }}>
          {ROLES.map((r) => (
            <li key={r}><strong style={{ color: "var(--text)" }}>{ROLE_LABELS[r]}</strong> — {ROLE_DESCRIPTIONS[r]}</li>
          ))}
        </ul>
        <p style={{ ...meta, marginTop: 12 }}>
          The last admin cannot be demoted, and you cannot remove your own admin role.
        </p>
      </div>

      <div style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link href="/admin" style={btnGhost}>← Admin dashboard</Link>
        <Link href="/admin/qbank" style={btnGhost}>Question bank queue</Link>
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: "var(--text)", color: "var(--bg)", padding: "11px 18px", borderRadius: 10, fontFamily: "var(--mono-font)", fontSize: 13, zIndex: 60 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
