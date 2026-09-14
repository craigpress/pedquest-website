import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireRole } from "@/lib/admin-auth";
import { isRole, type Role } from "@/lib/roles";
import { isValidEmail } from "@/lib/validation";

// Admin -> test account session handoff.
//
// Returns a one-shot magic-link token hash for a SYNTHETIC account so an admin
// can see the site as a learner or teacher. The same mechanism the Authentik
// bridge uses (generateLink -> hashed_token -> client verifyOtp), so no
// password or long-lived credential ever exists for these accounts.
//
// The `is_test` gate is the whole security model: a token minted here grants a
// full session as the target, so anything but a flagged test row must be
// refused before generateLink is ever called.

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, "admin");
  if (!auth.ok) return auth.response;
  const supabase = createServerClient()!;

  let body: { email?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = String(body.email || "").trim().toLowerCase();
  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  const { data: row, error: roleError } = await supabase
    .from("user_roles")
    .select("email,role,is_test,display_name")
    .eq("email", email)
    .maybeSingle();
  if (roleError) {
    console.error("[SwitchUser] role lookup failed:", roleError.message);
    return NextResponse.json({ error: "Could not look up that account." }, { status: 500 });
  }
  if (!row || row.is_test !== true) {
    return NextResponse.json({ error: "Only test accounts can be switched into." }, { status: 403 });
  }

  let userId: string | null = null;
  for (let page = 1; page <= 10 && !userId; page++) {
    const { data } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    const users = data?.users ?? [];
    userId = users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
    if (users.length < 200) break;
  }
  if (!userId) {
    return NextResponse.json({ error: "That test account has no Supabase user yet." }, { status: 404 });
  }

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !linkData?.properties?.hashed_token) {
    console.error("[SwitchUser] generateLink failed:", linkError?.message);
    return NextResponse.json({ error: "Could not mint a session for that account." }, { status: 500 });
  }

  console.info(`[SwitchUser] ${auth.email} -> ${email}`);

  return NextResponse.json(
    {
      success: true,
      tokenHash: linkData.properties.hashed_token,
      email,
      role: (isRole(row.role) ? row.role : "member") as Role,
      displayName: (row.display_name as string | null) ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
