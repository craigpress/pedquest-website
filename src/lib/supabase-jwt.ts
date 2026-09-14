// Local verification of Supabase access tokens.
//
// Every API route used to ask Supabase Auth to validate the Bearer token
// (`auth.getUser(token)`): one network round trip, 50–150 ms, on every call,
// before the route did any work. Supabase signs access tokens with an
// asymmetric key (ES256, `kid` in the header) and publishes the public keys at
// /auth/v1/.well-known/jwks.json, so the signature can be checked here with
// Node's crypto and no request at all. Keys are cached in module memory and
// re-fetched once when an unknown `kid` shows up (key rotation).
//
// Returns null whenever it cannot say "valid" for sure (HS256 legacy token,
// JWKS unreachable, clock skew) — the caller then falls back to getUser, so
// this is an optimisation, never a weaker gate. Revocation: access tokens
// live one hour; a signed-out session's token stays valid for the remainder,
// exactly as it did with getUser (which checks the signature, not a blocklist).
//
// Server-only.

import { createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";

interface Jwk { kid: string; kty: string; alg?: string; crv?: string; x?: string; y?: string; use?: string }

export interface VerifiedToken { userId: string; email: string; exp: number }

let keys: Map<string, KeyObject> | null = null;
let keysFetchedAt = 0;
let inflight: Promise<Map<string, KeyObject>> | null = null;
const JWKS_TTL_MS = 10 * 60 * 1000;

function jwksUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  return base ? `${base.replace(/\/+$/, "")}/auth/v1/.well-known/jwks.json` : null;
}

async function loadKeys(force = false): Promise<Map<string, KeyObject>> {
  if (keys && !force && Date.now() - keysFetchedAt < JWKS_TTL_MS) return keys;
  if (inflight) return inflight;
  inflight = (async () => {
    const url = jwksUrl();
    if (!url) throw new Error("no Supabase URL");
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`jwks HTTP ${res.status}`);
    const body = (await res.json()) as { keys?: Jwk[] };
    const next = new Map<string, KeyObject>();
    for (const k of body.keys ?? []) {
      if (!k.kid || k.kty !== "EC") continue; // only asymmetric keys can be checked here
      try { next.set(k.kid, createPublicKey({ key: k as unknown as JsonWebKey, format: "jwk" })); } catch { /* skip malformed */ }
    }
    keys = next; keysFetchedAt = Date.now();
    return next;
  })();
  try { return await inflight; } finally { inflight = null; }
}

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Verify an access token against the project's JWKS. Null = could not verify (caller falls back), never "invalid but let through". */
export async function verifySupabaseToken(token: string): Promise<VerifiedToken | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: { alg?: string; kid?: string }, payload: Record<string, unknown>;
  try {
    header = JSON.parse(b64url(parts[0]).toString("utf8"));
    payload = JSON.parse(b64url(parts[1]).toString("utf8"));
  } catch { return null; }
  if (header.alg !== "ES256" || !header.kid) return null;

  let key: KeyObject | undefined;
  try {
    key = (await loadKeys()).get(header.kid) ?? (await loadKeys(true)).get(header.kid);
  } catch { return null; }
  if (!key) return null;

  const ok = cryptoVerify("sha256", Buffer.from(`${parts[0]}.${parts[1]}`), { key, dsaEncoding: "ieee-p1363" }, b64url(parts[2]));
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  const exp = Number(payload.exp);
  if (!Number.isFinite(exp) || exp <= now) return null;
  if (payload.aud !== "authenticated" || payload.role !== "authenticated") return null;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  if (base && payload.iss !== `${base}/auth/v1`) return null;
  const userId = typeof payload.sub === "string" ? payload.sub : "";
  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (!userId || !email) return null;
  return { userId, email, exp };
}
