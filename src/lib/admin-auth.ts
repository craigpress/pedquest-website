// Server-side authorization for API routes.
//
// The client sends its Supabase access token as a Bearer header. The token is
// verified locally against the project's JWKS (src/lib/supabase-jwt.ts) —
// falling back to Supabase Auth's getUser only when local verification cannot
// decide — and the caller's role comes from public.user_roles in a single
// query (ensureRoleRow, which also does the login-time upsert). Two round
// trips at most, usually one; it used to be four.
//
// Roles are granted at /admin/users, never in code.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { ensureRoleRow } from "@/lib/roles-server";
import { verifySupabaseToken } from "@/lib/supabase-jwt";
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

type Identity = { userId: string; email: string };

/** Who holds this token — locally when possible, via Supabase Auth otherwise. Null = not a valid session. */
async function identify(token: string): Promise<Identity | null | "unconfigured"> {
  const local = await verifySupabaseToken(token);
  if (local) return { userId: local.userId, email: local.email };
  const supabase = createServerClient();
  if (!supabase) return "unconfigured";
  const { data, error } = await supabase.auth.getUser(token);
  const email = data?.user?.email?.toLowerCase();
  if (error || !email || !data.user) return null;
  return { userId: data.user.id, email };
}

function bearer(request: NextRequest): string {
  const header = request.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

async function authenticate(request: NextRequest): Promise<AuthOk | null | "unconfigured"> {
  const token = bearer(request);
  if (!token) return null;
  const who = await identify(token);
  if (who === "unconfigured" || who === null) return who;
  const row = await ensureRoleRow(who.email, who.userId);
  if (!row) return "unconfigured";
  return { ok: true, email: who.email, userId: who.userId, role: row.role, isTest: row.isTest, displayName: row.displayName };
}

/**
 * Require a signed-in caller holding at least `minimum`.
 * 401 when unauthenticated, 403 when under-privileged, 503 when the server has
 * no Supabase credentials.
 */
export async function requireRole(request: NextRequest, minimum: Role): Promise<AuthCheck> {
  const auth = await authenticate(request);
  if (auth === "unconfigured") {
    return { ok: false, response: NextResponse.json({ error: "Server not configured." }, { status: 503 }) };
  }
  if (!auth) {
    return { ok: false, response: NextResponse.json({ error: "Authentication required." }, { status: 401 }) };
  }
  if (!hasRole(auth.role, minimum)) {
    return { ok: false, response: NextResponse.json({ error: `${ROLE_LABELS[minimum]} access required.` }, { status: 403 }) };
  }
  return auth;
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
  const auth = await authenticate(request);
  if (!auth || auth === "unconfigured") return null;
  return { email: auth.email, userId: auth.userId, role: auth.role, isTest: auth.isTest, displayName: auth.displayName };
}
