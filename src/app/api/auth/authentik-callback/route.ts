import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const origin = url.origin;

  const cookieStore = await cookies();
  const savedState = cookieStore.get("auth_state")?.value;

  if (!code || !state || state !== savedState) {
    console.error("[Authentik Callback] Invalid state or missing code");
    return NextResponse.redirect(new URL("/login?error=state", origin));
  }

  const clientId = process.env.AUTHENTIK_CLIENT_ID;
  const clientSecret = process.env.AUTHENTIK_CLIENT_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!clientId || !clientSecret || !supabaseUrl || !supabaseServiceKey) {
    console.error("[Authentik Callback] Missing env vars");
    return NextResponse.redirect(new URL("/login?error=config", origin));
  }

  try {
    // Exchange authorization code for tokens with Authentik
    const tokenRes = await fetch("https://auth.presshome.net/application/o/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${origin}/api/auth/authentik-callback`,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error("[Authentik Callback] Token exchange failed:", err);
      return NextResponse.redirect(new URL("/login?error=token", origin));
    }

    const tokens = await tokenRes.json();
    const idToken = tokens.id_token;

    if (!idToken) {
      console.error("[Authentik Callback] No id_token in response");
      return NextResponse.redirect(new URL("/login?error=token", origin));
    }

    // Decode the ID token to get user email and name
    const payload = JSON.parse(
      Buffer.from(idToken.split(".")[1], "base64").toString()
    );
    const email = payload.email;
    const name = payload.name || payload.preferred_username || "";

    if (!email) {
      console.error("[Authentik Callback] No email in ID token");
      return NextResponse.redirect(new URL("/login?error=noemail", origin));
    }

    // Use Supabase Admin API to create/confirm user and generate a magic link
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Ensure user exists in Supabase
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
    const existingUser = existingUsers?.users?.find((u) => u.email === email);

    if (!existingUser) {
      await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: name, auth_provider: "authentik" },
      });
    }

    // Generate a token hash server-side (no email is sent)
    const { data: linkData, error: linkError } =
      await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });

    if (linkError || !linkData?.properties?.hashed_token) {
      console.error("[Authentik Callback] generateLink failed:", linkError?.message);
      return NextResponse.redirect(new URL("/login?error=link", origin));
    }

    // Clean up state cookies
    cookieStore.delete("auth_state");
    cookieStore.delete("auth_nonce");

    // Pass token hash to client via short-lived cookie for verifyOtp
    cookieStore.set("auth_token_hash", linkData.properties.hashed_token, {
      path: "/",
      maxAge: 60,
      httpOnly: false,
      secure: true,
      sameSite: "lax",
    });

    return NextResponse.redirect(new URL("/auth/callback?provider=authentik", origin));
  } catch (e) {
    console.error("[Authentik Callback] Unexpected error:", e);
    return NextResponse.redirect(new URL("/login?error=callback", origin));
  }
}
