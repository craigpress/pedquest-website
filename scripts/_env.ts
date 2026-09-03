import { readFileSync, existsSync } from "node:fs";

/**
 * Load .env.local for scripts run outside Next (tsx, node), which don't get it
 * automatically. Values may be quoted — `KEY="value"` is valid dotenv and
 * Supabase rejects a URL that still has the quotes attached — so strip one
 * matching pair of surrounding quotes.
 *
 * Real environment variables win, so CI can override the local file.
 */
export function loadEnvLocal(path = ".env.local"): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i <= 0) continue;
    const key = trimmed.slice(0, i).trim();
    if (process.env[key]) continue;
    let value = trimmed.slice(i + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

/** Supabase URL + service-role key, however they happen to be named. */
export function supabaseCredentials(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY");
  return { url, key };
}
