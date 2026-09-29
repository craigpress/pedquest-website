import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/admin-auth";
import { createServerClient } from "@/lib/supabase";
import { GALLERY_BUCKET, GALLERY_SIGNED_URL_TTL_S, type GalleryState } from "@/lib/eeg-gallery";
import { GALLERY_MANIFEST } from "@/lib/eeg-gallery-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

// GET /api/admin/eeg-gallery -> the manifest, each item's review state and note count, and signed image URLs
// (800-px thumbnail + full PNG, valid GALLERY_SIGNED_URL_TTL_S). Editors only.
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, "editor");
  if (!auth.ok) return auth.response;
  const sb = createServerClient();
  if (!sb) return NextResponse.json({ error: "Server not configured." }, { status: 503, headers: NO_STORE });

  const items = GALLERY_MANIFEST.items;
  const bucket = sb.storage.from(GALLERY_BUCKET);
  const [states, notes, thumbs, fulls] = await Promise.all([
    sb.from("eeg_gallery_state").select("item_id,status,renderer_version,updated_by_name,updated_at"),
    sb.from("eeg_gallery_notes").select("item_id"),
    items.length ? bucket.createSignedUrls(items.map((i) => i.thumbPath), GALLERY_SIGNED_URL_TTL_S) : null,
    items.length ? bucket.createSignedUrls(items.map((i) => i.path), GALLERY_SIGNED_URL_TTL_S) : null,
  ]);
  const err = states.error || notes.error || thumbs?.error || fulls?.error;
  if (err) return NextResponse.json({ error: err.message }, { status: 500, headers: NO_STORE });

  const state: Record<string, GalleryState> = {};
  for (const r of states.data ?? []) {
    state[r.item_id] = {
      status: r.status, rendererVersion: r.renderer_version, updatedByName: r.updated_by_name, updatedAt: r.updated_at,
    };
  }
  const noteCount: Record<string, number> = {};
  for (const r of notes.data ?? []) noteCount[r.item_id] = (noteCount[r.item_id] ?? 0) + 1;
  const urls: Record<string, { thumb: string | null; full: string | null }> = {};
  items.forEach((it, k) => {
    urls[it.id] = { thumb: thumbs?.data?.[k]?.signedUrl ?? null, full: fulls?.data?.[k]?.signedUrl ?? null };
  });
  return NextResponse.json(
    { manifest: GALLERY_MANIFEST, state, noteCount, urls, expiresAt: Date.now() + GALLERY_SIGNED_URL_TTL_S * 1000 },
    { headers: NO_STORE },
  );
}
