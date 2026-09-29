import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/admin-auth";
import { createServerClient } from "@/lib/supabase";
import type { GalleryStatus } from "@/lib/eeg-gallery";
import { galleryItem } from "@/lib/eeg-gallery-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: GalleryStatus[] = ["new", "needs_review", "accepted"];

// POST /api/admin/eeg-gallery/state { itemId, status } -> the stored state, stamped with the item's renderer version.
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, "editor");
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { itemId?: unknown; status?: unknown } | null;
  const item = galleryItem(body?.itemId);
  const status = body?.status as GalleryStatus;
  if (!item || !STATUSES.includes(status)) {
    return NextResponse.json({ error: "Unknown item or status." }, { status: 400 });
  }
  const sb = createServerClient();
  if (!sb) return NextResponse.json({ error: "Server not configured." }, { status: 503 });
  const row = {
    item_id: item.id, status, renderer_version: item.rendererVersion, updated_by: auth.userId,
    updated_by_name: auth.displayName || auth.email, updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from("eeg_gallery_state").upsert(row, { onConflict: "item_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    itemId: item.id,
    state: { status, rendererVersion: row.renderer_version, updatedByName: row.updated_by_name, updatedAt: row.updated_at },
  });
}
