// Server-side admin verification for write endpoints.
//
// The current app gates admin UI purely client-side (ADMIN_EMAILS hardcoded in
// admin/page.tsx). That protects nothing on the server. This helper adds real
// enforcement: the client sends its Supabase access token as a Bearer header;
// we validate it with the service-role client and check the allowlist.
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// Keep in sync with the client allowlist in src/app/admin/page.tsx.
export const ADMIN_EMAILS = [
  "pressca@chop.edu",
  "craigpress@gmail.com",
  "gbenedet@med.umich.edu",
  "ajay.thomas@bcm.edu",
];

export type AdminCheck =
  | { ok: true; email: string; userId: string }
  | { ok: false; response: NextResponse };

export async function requireAdmin(request: NextRequest): Promise<AdminCheck> {
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
  if (error || !email || !ADMIN_EMAILS.includes(email)) {
    return { ok: false, response: NextResponse.json({ error: "Admin access required." }, { status: 403 }) };
  }
  return { ok: true, email, userId: data.user!.id };
}
