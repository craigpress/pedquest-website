import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireRole } from "@/lib/admin-auth";
import { countAdmins } from "@/lib/roles-server";
import { isRole, type Role } from "@/lib/roles";
import { isValidEmail } from "@/lib/validation";

// Role administration. Admin only.
//
// GET  -> every known account: Supabase auth users joined to `members` by
//         email, merged with public.user_roles (which can also hold a role
//         granted before the person has ever signed in).
// POST { email, role } -> set a role. Refuses to remove the last admin.

/* eslint-disable @typescript-eslint/no-explicit-any */

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

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, "admin");
  if (!auth.ok) return auth.response;
  const supabase = createServerClient()!;

  const byEmail = new Map<string, UserRow>();
  const blank = (email: string): UserRow => ({
    email, role: null, userId: null, lastSignInAt: null, createdAt: null,
    memberId: null, memberName: null, institution: null, grantedAt: null,
  });

  // ---- Supabase auth users (paginated) ----
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      console.error("[AdminUsers] listUsers failed:", error.message);
      return NextResponse.json({ error: "Could not load accounts." }, { status: 500 });
    }
    const users = data?.users ?? [];
    for (const u of users) {
      const email = u.email?.toLowerCase();
      if (!email) continue;
      const row = byEmail.get(email) ?? blank(email);
      row.userId = u.id;
      row.lastSignInAt = u.last_sign_in_at ?? null;
      row.createdAt = u.created_at ?? null;
      byEmail.set(email, row);
    }
    if (users.length < 200) break;
  }

  // ---- roles (may include emails with no auth user yet) ----
  const { data: roles } = await supabase.from("user_roles").select("email,role,granted_at,user_id");
  for (const r of (roles ?? []) as any[]) {
    const email = String(r.email).toLowerCase();
    const row = byEmail.get(email) ?? blank(email);
    row.role = isRole(r.role) ? r.role : null;
    row.grantedAt = r.granted_at ?? null;
    row.userId = row.userId ?? r.user_id ?? null;
    byEmail.set(email, row);
  }

  // ---- member registry, matched on either email column ----
  const { data: members } = await supabase
    .from("members")
    .select("id,name,institution,email,auth_email");
  for (const m of (members ?? []) as any[]) {
    for (const candidate of [m.email, m.auth_email]) {
      const email = candidate ? String(candidate).toLowerCase() : "";
      if (!email) continue;
      const row = byEmail.get(email);
      if (!row) continue; // don't surface registry rows that have no account/role
      row.memberId = m.id;
      row.memberName = m.name ?? null;
      row.institution = m.institution ?? null;
    }
  }

  const users = [...byEmail.values()].sort((a, b) => {
    const rank = { admin: 0, editor: 1, member: 2 } as Record<string, number>;
    const ra = a.role ? rank[a.role] : 3;
    const rb = b.role ? rank[b.role] : 3;
    if (ra !== rb) return ra - rb;
    return a.email.localeCompare(b.email);
  });

  return NextResponse.json({
    success: true,
    users,
    counts: {
      admin: users.filter((u) => u.role === "admin").length,
      editor: users.filter((u) => u.role === "editor").length,
      member: users.filter((u) => u.role === "member").length,
      unassigned: users.filter((u) => !u.role).length,
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, "admin");
  if (!auth.ok) return auth.response;
  const supabase = createServerClient()!;

  let body: { email?: string; role?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = String(body.email || "").trim().toLowerCase();
  const role = String(body.role || "");
  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }
  if (!isRole(role)) {
    return NextResponse.json({ error: "Role must be member, editor or admin." }, { status: 400 });
  }

  const { data: current } = await supabase
    .from("user_roles").select("role").eq("email", email).maybeSingle();

  // Never let the last admin lose the keys — that would lock everyone out of
  // role management, which only an admin can perform.
  if (current?.role === "admin" && role !== "admin") {
    if ((await countAdmins()) <= 1) {
      return NextResponse.json(
        { error: "This is the last admin. Promote another admin before changing this one." },
        { status: 400 },
      );
    }
    if (email === auth.email) {
      return NextResponse.json(
        { error: "You cannot remove your own admin role. Ask another admin to do it." },
        { status: 400 },
      );
    }
  }

  // Resolve the auth user id so the row is linked even for a first grant.
  let userId: string | null = null;
  for (let page = 1; page <= 10 && !userId; page++) {
    const { data } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    const users = data?.users ?? [];
    userId = users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
    if (users.length < 200) break;
  }

  const { error } = await supabase
    .from("user_roles")
    .upsert(
      { email, role, user_id: userId, granted_by: auth.userId },
      { onConflict: "email" },
    );
  if (error) {
    console.error("[AdminUsers] role upsert failed:", error.message);
    return NextResponse.json({ error: "Could not save the role." }, { status: 500 });
  }

  return NextResponse.json({ success: true, email, role });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
