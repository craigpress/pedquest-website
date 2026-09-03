"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";

/** Register the freshly signed-in user in public.user_roles.
 *  GET /api/me performs the upsert (creates a 'member' row, backfills
 *  user_id). Failure is non-fatal — requireRole() repeats it on the next
 *  authorized request. */
async function registerMember(sb: NonNullable<ReturnType<typeof getSupabase>>) {
  try {
    const token = (await sb.auth.getSession()).data.session?.access_token;
    if (!token) return;
    await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    // ignore — not worth blocking the redirect
  }
}

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get("provider");
    const code = params.get("code");

    const sb = getSupabase();
    if (!sb) {
      router.replace("/login?error=config");
      return;
    }

    if (provider === "authentik") {
      // Authentik flow: read token hash from cookie, verify with Supabase
      const tokenHash = document.cookie
        .split("; ")
        .find((c) => c.startsWith("auth_token_hash="))
        ?.split("=")
        .slice(1)
        .join("=");

      if (!tokenHash) {
        router.replace("/login?error=notoken");
        return;
      }

      // Clean up cookie
      document.cookie = "auth_token_hash=; path=/; max-age=0";

      sb.auth.verifyOtp({
        token_hash: tokenHash,
        type: "magiclink",
      }).then(async ({ error }) => {
        if (error) {
          console.error("[Auth Callback] verifyOtp failed:", error.message);
          router.replace(`/login?error=${encodeURIComponent(error.message)}`);
        } else {
          await registerMember(sb);
          router.replace("/profile");
        }
      });
    } else if (code) {
      // Magic link flow: exchange code for session
      sb.auth.exchangeCodeForSession(code).then(async ({ error }) => {
        if (error) {
          console.error("[Auth Callback] Code exchange failed:", error.message);
          router.replace("/login?error=callback");
        } else {
          await registerMember(sb);
          router.replace("/profile");
        }
      });
    } else {
      router.replace("/login?error=nocode");
    }
  }, [router]);

  return (
    <div
      style={{
        minHeight: "calc(100vh - 92px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-secondary)",
        fontFamily: "var(--body-font)",
      }}
    >
      Signing you in…
    </div>
  );
}
