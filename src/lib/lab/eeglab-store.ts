// The homelab recording store: eeglab.presshome.net (nginx secure_link in
// front of the OMV shared folder `eeg-lab`; tools/eeglab-host/).
//
// Artifact paths written by tools/eeg-render/lab_worker.py look like
// `eeglab://<recording_id>/<file>`. This module turns one into an expiring
// URL that nginx will accept:
//
//   /<recording_id>/<file>?md5=<base64url(md5("<expires><uri> <secret>"))>&expires=<unix>
//
// The md5 input order is nginx's, from `secure_link_md5 "$secure_link_expires$uri <secret>"`.
// Same TTL as the Supabase signed URLs; the viewer re-mints on 403/410.

import { createHash, createHmac } from "node:crypto";

export const EEGLAB_SCHEME = "eeglab://";

export function isEeglabPath(path: string): boolean {
  return path.startsWith(EEGLAB_SCHEME);
}

export function eeglabConfigured(): boolean {
  return Boolean(process.env.EEG_LAB_BASE_URL && process.env.EEG_LAB_URL_SECRET);
}

/** Encode each path segment; keeps `/` so nginx sees the real $uri. */
function encodeUri(rel: string): string {
  return "/" + rel.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

export function signEeglabUrl(path: string, ttlS: number, now = Date.now()): string {
  const base = (process.env.EEG_LAB_BASE_URL ?? "").replace(/\/+$/, "");
  const secret = process.env.EEG_LAB_URL_SECRET ?? "";
  if (!base || !secret) throw new Error("EEG_LAB_BASE_URL / EEG_LAB_URL_SECRET are not set.");
  const uri = encodeUri(path.slice(EEGLAB_SCHEME.length));
  const expires = Math.floor(now / 1000) + ttlS;
  const md5 = createHash("md5").update(`${expires}${uri} ${secret}`).digest("base64")
    .replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${base}${uri}?md5=${md5}&expires=${expires}`;
}

// ── same-origin proxy ──────────────────────────────────────────────────────
//
// The store answers CORS for https://pedquest.org only, so a browser on
// http://localhost:3456 cannot Range-read a recording at all — every request
// dies as "Failed to fetch" before the signed URL is even evaluated. With the
// proxy on, the download route hands back a relative path on this origin and
// /api/admin/lab/jobs/<id>/stream fetches the store server-side, where CORS
// does not apply. Production keeps serving direct store URLs: the bytes then
// never transit the Next server.

export function sameOriginProxyEnabled(): boolean {
  return process.env.EEG_LAB_SAME_ORIGIN_PROXY === "1" || process.env.NODE_ENV === "development";
}

/**
 * The stream route is fetched by the browser with NO Bearer token — a Range
 * request from the EDF reader carries no headers we control. So the download
 * route (which DID run requireRole + resolveArtifact) mints this HMAC, and the
 * stream route treats a valid one as proof that an authorized caller already
 * passed both gates. Same secret as the nginx link, same short TTL.
 */
export function streamSignature(jobId: string, artifact: string, exp: number): string {
  const secret = process.env.EEG_LAB_URL_SECRET ?? "";
  if (!secret) throw new Error("EEG_LAB_URL_SECRET is not set.");
  return createHmac("sha256", secret).update(`${jobId}|${artifact}|${exp}`).digest("hex");
}

export function streamProxyConfigured(): boolean {
  return Boolean(process.env.EEG_LAB_URL_SECRET);
}

/** Relative on purpose: same origin is the whole point, and fetch() resolves it. */
export function signStreamPath(jobId: string, artifact: string, ttlS: number, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + ttlS;
  const sig = streamSignature(jobId, artifact, exp);
  return `/api/admin/lab/jobs/${jobId}/stream?artifact=${encodeURIComponent(artifact)}&exp=${exp}&sig=${sig}`;
}
