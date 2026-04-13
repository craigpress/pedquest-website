"use client";

import { useState, useEffect } from "react";
import { getSupabase } from "./supabase";
import { members, type Member } from "@/data/members";
import type { User } from "@supabase/supabase-js";

// ─── Hook: useUser ──────────────────────────────────────────────────────
export function useUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const sb = getSupabase();

    async function getUser() {
      try {
        if (sb) {
          const { data } = await sb.auth.getUser();
          if (mounted) setUser(data.user ?? null);
        } else {
          // No Supabase — check localStorage fallback
          const stored = localStorage.getItem("pedquest_user_email");
          if (stored && mounted) {
            setUser({ email: stored, id: "local-fallback" } as unknown as User);
          }
        }
      } catch {
        try {
          const stored = localStorage.getItem("pedquest_user_email");
          if (stored && mounted) {
            setUser({ email: stored, id: "local-fallback" } as unknown as User);
          }
        } catch {
          // ignore
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    getUser();

    let subscription: { unsubscribe: () => void } | undefined;
    if (sb) {
      try {
        const { data } = sb.auth.onAuthStateChange((_event, session) => {
          if (mounted) {
            setUser(session?.user ?? null);
            setLoading(false);
          }
        });
        subscription = data.subscription;
      } catch {
        // Supabase not available
      }
    }

    return () => {
      mounted = false;
      subscription?.unsubscribe();
    };
  }, []);

  return { user, loading };
}

// ─── Hook: useMember ────────────────────────────────────────────────────
export function useMember(overrideEmail?: string | null) {
  const { user, loading: userLoading } = useUser();
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userLoading) return;

    const resolvedEmail = user?.email || overrideEmail;
    if (!resolvedEmail) {
      setMember(null);
      setLoading(false);
      return;
    }

    const email = resolvedEmail.toLowerCase();
    const found = members.find(
      (m) => m.email?.toLowerCase() === email || m.authEmail?.toLowerCase() === email
    );

    if (found) {
      try {
        const overrides = localStorage.getItem(`pedquest_profile_${found.id}`);
        if (overrides) {
          const parsed = JSON.parse(overrides);
          setMember({ ...found, ...parsed });
          setLoading(false);
          return;
        }
      } catch {
        // ignore
      }
    }

    setMember(found ?? null);
    setLoading(false);
  }, [user, userLoading, overrideEmail]);

  return { member, user, loading: userLoading || loading };
}

// ─── Helpers ────────────────────────────────────────────────────────────

export async function signInWithMagicLink(email: string): Promise<{ error: string | null }> {
  const sb = getSupabase();
  if (sb) {
    try {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) return { error: error.message };
      return { error: null };
    } catch {
      // fall through to localStorage
    }
  }

  // Supabase not available — use localStorage fallback
  const emailLower = email.toLowerCase();
  const found = members.find((m) => m.email?.toLowerCase() === emailLower || m.authEmail?.toLowerCase() === emailLower);
  if (!found) {
    return { error: "This email is not associated with a PedQuEST member." };
  }
  localStorage.setItem("pedquest_user_email", email);
  return { error: null };
}

export async function signOut(): Promise<void> {
  const sb = getSupabase();
  if (sb) {
    try {
      await sb.auth.signOut();
    } catch {
      // ignore
    }
  }
  try {
    localStorage.removeItem("pedquest_user_email");
  } catch {
    // ignore
  }
}
