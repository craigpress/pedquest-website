import { NextRequest, NextResponse } from "next/server";
import { resolveCaller } from "@/lib/admin-auth";

// Who am I, and what may I do?
//
// The client UI gates on this instead of a hardcoded email list. Called with
// the caller's Supabase access token as a Bearer header; resolveCaller also
// performs the login-time upsert into user_roles (creating a 'member' row and
// backfilling user_id), so hitting this once after sign-in is enough to
// register a new member.
//
// Returns 200 with { signedIn: false } for an anonymous caller — the absence
// of a session is not an error for a page that renders a sign-in prompt.
export async function GET(request: NextRequest) {
  const caller = await resolveCaller(request);
  if (!caller) {
    return NextResponse.json({ success: true, signedIn: false, role: null, email: null });
  }
  return NextResponse.json({
    success: true,
    signedIn: true,
    email: caller.email,
    userId: caller.userId,
    role: caller.role,
  });
}
