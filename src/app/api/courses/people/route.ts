import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireRole } from "@/lib/admin-auth";
import type { CoursePerson } from "@/lib/courses/types";

export const runtime = "nodejs";

// People a teacher can enrol: active consortium members (name, institution,
// either email column) merged with every account in user_roles. Teacher+.
//
// GET /api/courses/people?q=<text>  → { people: CoursePerson[] } (max 50)

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, "teacher");
  if (!auth.ok) return auth.response;
  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  const like = `%${q.replace(/[%_]/g, "")}%`;

  let members = supabase.from("members").select("name,email,auth_email,institution").eq("status", "active").limit(200);
  if (q) members = members.or(`name.ilike.${like},email.ilike.${like},auth_email.ilike.${like},institution.ilike.${like}`);
  let roles = supabase.from("user_roles").select("email,user_id,display_name,is_test").limit(500);
  if (q) roles = roles.or(`email.ilike.${like},display_name.ilike.${like}`);
  const [{ data: mRows }, { data: rRows }] = await Promise.all([members, roles]);

  const byEmail = new Map<string, CoursePerson>();
  for (const m of (mRows ?? []) as any[]) {
    const email = String(m.auth_email || m.email || "").toLowerCase();
    if (!email) continue;
    byEmail.set(email, { email, name: m.name ?? null, institution: m.institution ?? null, hasAccount: false, isTest: false });
  }
  for (const r of (rRows ?? []) as any[]) {
    const email = String(r.email).toLowerCase();
    const cur = byEmail.get(email);
    byEmail.set(email, {
      email,
      name: cur?.name ?? r.display_name ?? null,
      institution: cur?.institution ?? null,
      hasAccount: Boolean(r.user_id),
      isTest: Boolean(r.is_test),
    });
  }
  const people = [...byEmail.values()]
    .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email))
    .slice(0, 50);
  return NextResponse.json({ success: true, people }, { headers: { "Cache-Control": "no-store, private" } });
}
