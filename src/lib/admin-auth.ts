// Server-side authorization for write endpoints.
//
// The client sends its Supabase access token as a Bearer header; we validate it
// with the service-role client and look the caller's role up in
// public.user_roles (migration 20260903_qbank.sql). This replaced a hardcoded
// email allowlist — grant roles at /admin/users, not in code.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { ensureUserRole, getRoleRow } from "@/lib/roles-server";
import { hasRole, ROLE_LABELS, type Role } from "@/lib/roles";

export type AuthOk = {
  ok: true;
  email: string;
  userId: string;
  role: Role;
  isTest: boolean;
  displayName: string | null;
};
export type AuthCheck = AuthOk | { ok: false; response: NextResponse };

/**
 * Require a signed-in caller holding at least `minimum`.
 * 401 when unauthenticated, 403 when under-privileged, 503 when the server has
 * no Supabase credentials.
 */
export async function requireRole(request: NextRequest, minimum: Role): Promise<AuthCheck> {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return { ok: false, response: NextResponse.json({ error: "Authentication required." }, { status: 401 }) };
  }
  const supabase = createServerClient();
  if (!supabase) {
    return { ok: false, response: NextResponse.json({ error: "Server not configured." }, { status: 503 }) };
  }
  const { data, error } = await supabase.auth.getUser(token);
  const email = data?.user?.email?.toLowerCase();
  if (error || !email || !data.user) {
    return { ok: false, response: NextResponse.json({ error: "Authentication required." }, { status: 401 }) };
  }

  // ensureUserRole doubles as the login backfill: any authenticated request
  // guarantees the caller has a 'member' row with its user_id filled in.
  const role = await ensureUserRole(email, data.user.id);
  if (!hasRole(role, minimum)) {
    const label = ROLE_LABELS[minimum];
    return { ok: false, response: NextResponse.json({ error: `${label} access required.` }, { status: 403 }) };
  }
  const row = await getRoleRow(email);
  return {
    ok: true,
    email,
    userId: data.user.id,
    role: role as Role,
    isTest: row?.isTest ?? false,
    displayName: row?.displayName ?? null,
  };
}

/** Back-compat wrapper: the existing admin routes call this. */
export async function requireAdmin(request: NextRequest): Promise<AuthCheck> {
  return requireRole(request, "admin");
}

/** Same as requireRole(request, 'editor'), spelled out for readability. */
export async function requireEditor(request: NextRequest): Promise<AuthCheck> {
  return requireRole(request, "editor");
}

/**
 * Resolve the caller without failing the request — for endpoints that behave
 * differently for signed-in members (e.g. the question-bank browser).
 */
export async function resolveCaller(
  request: NextRequest,
): Promise<{ email: string; userId: string; role: Role; isTest: boolean; displayName: string | null } | null> {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  const supabase = createServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser(token);
  const email = data?.user?.email?.toLowerCase();
  if (error || !email || !data.user) return null;
  const role = (await ensureUserRole(email, data.user.id)) ?? "member";
  const row = await getRoleRow(email);
  return {
    email,
    userId: data.user.id,
    role,
    isTest: row?.isTest ?? false,
    displayName: row?.displayName ?? null,
  };
}
