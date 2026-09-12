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

import { createHash } from "node:crypto";

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
