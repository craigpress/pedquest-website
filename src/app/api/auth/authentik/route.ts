import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET(request: NextRequest) {
  const clientId = process.env.AUTHENTIK_CLIENT_ID;
  if (!clientId) {
    return NextResponse.redirect(new URL("/login?error=config", request.url));
  }

  const nonce = crypto.randomUUID();
  const state = crypto.randomUUID();
  const origin = new URL(request.url).origin;

  const cookieStore = await cookies();
  cookieStore.set("auth_nonce", nonce, {
    path: "/",
    maxAge: 600,
    httpOnly: false,
    secure: true,
    sameSite: "lax",
  });
  cookieStore.set("auth_state", state, {
    path: "/",
    maxAge: 600,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}/api/auth/authentik-callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
  });

  return NextResponse.redirect(
    `https://auth.presshome.net/application/o/authorize/?${params}`
  );
}
