// Client half of the admin -> test-account switch.
//
// The admin's own session is stashed in localStorage BEFORE verifyOtp replaces
// it, because verifyOtp overwrites the single Supabase session slot — without
// the stash the admin would have to sign in again to get back. Every switch
// ends in a full window navigation rather than a router push so that useRole()
// and every other hook re-reads the new identity from scratch.

/* eslint-disable @next/next/no-location-assign-relative-destination -- a client-side
   router push would keep the old identity cached in every mounted hook; the whole
   point of a switch is to reload the app under the new session. */

import { getSupabase } from "@/lib/supabase";
import { signOut } from "@/lib/auth";

const STASH_KEY = "pq_admin_session";

interface Stash {
  accessToken: string;
  refreshToken: string;
  email: string | null;
  startedAt: string;
  /** where "return to my account" lands; the page that started the switch (editors have no /admin/users) */
  returnTo?: string;
}

function readStash(): Stash | null {
  try {
    const raw = localStorage.getItem(STASH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stash;
    if (!parsed?.accessToken || !parsed?.refreshToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearStash() {
  try { localStorage.removeItem(STASH_KEY); } catch { /* ignore */ }
}

export function readImpersonation(): { adminEmail: string | null } | null {
  const stash = readStash();
  return stash ? { adminEmail: stash.email } : null;
}

/**
 * Switch into a test account. `landOn` is where the new session opens (default
 * the lab library); `returnTo` is where "return to my account" goes afterwards
 * (default the admin users console). A course page passes itself for both, so
 * an editor sees the student's view of that course and comes straight back.
 */
export async function switchToUser(
  email: string,
  authHeaders: () => Promise<Record<string, string>>,
  opts: { landOn?: string; returnTo?: string } = {},
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase is not configured.");

  const res = await fetch("/api/admin/switch-user", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ email }),
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || "Could not switch to that account.");
  }

  const { data: sessionData } = await sb.auth.getSession();
  const session = sessionData.session;
  try {
    localStorage.setItem(
      STASH_KEY,
      JSON.stringify({
        accessToken: session?.access_token ?? "",
        refreshToken: session?.refresh_token ?? "",
        email: session?.user?.email ?? null,
        startedAt: new Date().toISOString(),
        returnTo: opts.returnTo,
      } satisfies Stash),
    );
  } catch {
    // ignore
  }

  const { error } = await sb.auth.verifyOtp({ token_hash: json.tokenHash, type: "magiclink" });
  if (error) {
    clearStash();
    throw new Error(error.message);
  }

  window.location.assign(opts.landOn ?? "/admin/eeg-lab/library");
}

export async function returnToAdmin(): Promise<void> {
  const sb = getSupabase();
  const stash = readStash();
  if (!sb || !stash) {
    clearStash();
    window.location.assign("/admin/users");
    return;
  }

  const { error } = await sb.auth.setSession({
    access_token: stash.accessToken,
    refresh_token: stash.refreshToken,
  });
  clearStash();
  if (error) {
    await signOut();
    window.location.assign("/login");
    return;
  }
  window.location.assign(stash.returnTo && stash.returnTo.startsWith("/") ? stash.returnTo : "/admin/users");
}
