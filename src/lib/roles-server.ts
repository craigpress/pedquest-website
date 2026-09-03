// Server-only role lookups against public.user_roles. Uses the SERVICE-ROLE
// client so a role check never depends on the caller's own RLS view.
// NEVER import this from a "use client" module.
import { createServerClient } from "@/lib/supabase";
import { isRole, type Role } from "@/lib/roles";

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
