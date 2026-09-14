// Server-only role lookups against public.user_roles. Uses the SERVICE-ROLE
// client so a role check never depends on the caller's own RLS view.
// NEVER import this from a "use client" module.
import { createServerClient } from "@/lib/supabase";
import { isRole, type Role, type RoleRow } from "@/lib/roles";

/** Read the stored role for an email. Returns null when there is no row. */
export async function getRoleForEmail(email: string): Promise<Role | null> {
  const supabase = createServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (error || !data) return null;
  return isRole(data.role) ? data.role : null;
}

/**
 * Called on every login (both the Authentik bridge and the Supabase magic
 * link). Idempotent:
 *   * no row yet          -> insert as 'member'
 *   * row exists          -> leave the role alone, backfill user_id if missing
 * Returns the effective role, or null when Supabase is not configured.
 */
export async function ensureUserRole(email: string, userId?: string | null): Promise<Role | null> {
  const supabase = createServerClient();
  if (!supabase) return null;
  const lower = email.toLowerCase();

  const { data: existing, error: readErr } = await supabase
    .from("user_roles")
    .select("email,role,user_id")
    .eq("email", lower)
    .maybeSingle();

  // Deploying this code before applying migration 20260903_qbank.sql would lock
  // every admin out, because there is no allowlist to fall back to any more.
  // Say so loudly instead of silently denying access.
  if (readErr && (readErr.code === "42P01" || readErr.code === "PGRST205")) {
    console.error(
      "[Roles] public.user_roles does not exist. Apply supabase/migrations/20260903_qbank.sql — " +
      "until then every role check fails and admin/editor pages are inaccessible.",
    );
    return null;
  }

  if (!existing) {
    const { error } = await supabase
      .from("user_roles")
      .insert({ email: lower, user_id: userId ?? null, role: "member" });
    // A concurrent login can win the race; the row exists either way.
    if (error && error.code !== "23505") {
      console.error("[Roles] could not create role row:", error.message);
      return null;
    }
    return "member";
  }

  if (userId && !existing.user_id) {
    const { error } = await supabase
      .from("user_roles")
      .update({ user_id: userId })
      .eq("email", lower);
    if (error) console.error("[Roles] user_id backfill failed:", error.message);
  }
  return isRole(existing.role) ? existing.role : "member";
}

/**
 * The login-time upsert and the role read in ONE round trip: the row as it is
 * (creating a 'member' row when there is none, backfilling user_id when it is
 * missing). Every authenticated API call goes through this, so it must stay a
 * single select on the hot path — the insert and the backfill only run when
 * the row is actually missing or unlinked.
 */
export async function ensureRoleRow(email: string, userId: string): Promise<RoleRow | null> {
  const supabase = createServerClient();
  if (!supabase) return null;
  const lower = email.toLowerCase();
  const { data, error } = await supabase
    .from("user_roles")
    .select("email,role,user_id,is_test,display_name")
    .eq("email", lower)
    .maybeSingle();
  if (error && (error.code === "42P01" || error.code === "PGRST205")) {
    console.error("[Roles] public.user_roles does not exist. Apply supabase/migrations/20260903_qbank.sql.");
    return null;
  }
  if (!data) {
    const { error: insErr } = await supabase.from("user_roles").insert({ email: lower, user_id: userId, role: "member" });
    if (insErr && insErr.code !== "23505") { console.error("[Roles] could not create role row:", insErr.message); return null; }
    return { email: lower, role: "member", userId, isTest: false, displayName: null };
  }
  if (!data.user_id) {
    // fire-and-forget: the answer does not depend on it
    void supabase.from("user_roles").update({ user_id: userId }).eq("email", lower).then(({ error: e }) => {
      if (e) console.error("[Roles] user_id backfill failed:", e.message);
    });
    data.user_id = userId;
  }
  return rowToRoleRow(data);
}

/** The full role row for an email (role, test flag, display name), or null when there is none. */
export async function getRoleRow(email: string): Promise<RoleRow | null> {
  const supabase = createServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("user_roles")
    .select("email,role,user_id,is_test,display_name")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (error || !data) return null;
  return rowToRoleRow(data);
}

/** Role rows for a set of auth user ids — the class-results page uses this for names and test badges. */
export async function getRoleRowsByUserIds(userIds: string[]): Promise<Map<string, RoleRow>> {
  const out = new Map<string, RoleRow>();
  const supabase = createServerClient();
  if (!supabase || userIds.length === 0) return out;
  const { data, error } = await supabase
    .from("user_roles")
    .select("email,role,user_id,is_test,display_name")
    .in("user_id", userIds);
  if (error || !data) return out;
  for (const r of data) {
    const row = rowToRoleRow(r);
    if (row.userId) out.set(row.userId, row);
  }
  return out;
}

/**
 * Auth user ids of every test account. Aggregate statistics (Case-of-the-Day
 * community stats, admin counts) subtract these so synthetic learners never
 * move a real number. Learner-facing views (a teacher looking at a class's
 * marks) deliberately keep them — that is what the accounts are for.
 */
export async function getTestUserIds(): Promise<Set<string>> {
  const supabase = createServerClient();
  if (!supabase) return new Set();
  const { data, error } = await supabase
    .from("user_roles")
    .select("user_id")
    .eq("is_test", true)
    .not("user_id", "is", null);
  if (error || !data) return new Set();
  return new Set(data.map((r) => String(r.user_id)));
}

function rowToRoleRow(r: { email: string; role: string; user_id: string | null; is_test?: boolean | null; display_name?: string | null }): RoleRow {
  return {
    email: String(r.email).toLowerCase(),
    role: isRole(r.role) ? r.role : "member",
    userId: r.user_id ?? null,
    isTest: Boolean(r.is_test),
    displayName: r.display_name ?? null,
  };
}

/** How many admins are left — used to refuse removing the last one. */
export async function countAdmins(): Promise<number> {
  const supabase = createServerClient();
  if (!supabase) return 0;
  const { count, error } = await supabase
    .from("user_roles")
    .select("email", { count: "exact", head: true })
    .eq("role", "admin");
  if (error) return 0;
  return count ?? 0;
}
