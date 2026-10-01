import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/admin-auth";
import { createServerClient } from "@/lib/supabase";
import { type GalleryState } from "@/lib/eeg-gallery";
import { GALLERY_MANIFEST, signedGalleryImages } from "@/lib/eeg-gallery-server";

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

  const [states, notes, images] = await Promise.all([
    sb.from("eeg_gallery_state").select("item_id,status,renderer_version,updated_by_name,updated_at"),
    sb.from("eeg_gallery_notes").select("item_id"),
    signedGalleryImages(sb).catch((error: { message: string }) => ({ error, urls: {}, expiresAt: 0 })),
  ]);
  const err = states.error || notes.error || ("error" in images ? images.error : null);
  if (err) return NextResponse.json({ error: err.message }, { status: 500, headers: NO_STORE });

  const state: Record<string, GalleryState> = {};
  for (const r of states.data ?? []) {
    state[r.item_id] = {
      status: r.status, rendererVersion: r.renderer_version, updatedByName: r.updated_by_name, updatedAt: r.updated_at,
    };
  }
  const noteCount: Record<string, number> = {};
  for (const r of notes.data ?? []) noteCount[r.item_id] = (noteCount[r.item_id] ?? 0) + 1;
  return NextResponse.json(
    { manifest: GALLERY_MANIFEST, state, noteCount, urls: images.urls, expiresAt: images.expiresAt },
    { headers: NO_STORE },
  );
}
