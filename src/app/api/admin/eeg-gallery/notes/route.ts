import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/admin-auth";
import { createServerClient } from "@/lib/supabase";
import type { GalleryNote } from "@/lib/eeg-gallery";
import { galleryItem } from "@/lib/eeg-gallery-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = {
  id: string; item_id: string; renderer_version: string; author_name: string | null; body: string; created_at: string;
};
const COLS = "id,item_id,renderer_version,author_name,body,created_at";
const toNote = (r: Row): GalleryNote => ({
  id: r.id, itemId: r.item_id, rendererVersion: r.renderer_version, authorName: r.author_name, body: r.body,
  createdAt: r.created_at,
});

// GET /api/admin/eeg-gallery/notes?item=<id> -> that item's notes, oldest first.
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, "editor");
  if (!auth.ok) return auth.response;
  const item = galleryItem(request.nextUrl.searchParams.get("item"));
  if (!item) return NextResponse.json({ error: "Unknown item." }, { status: 400 });
  const sb = createServerClient();
  if (!sb) return NextResponse.json({ error: "Server not configured." }, { status: 503 });
  const { data, error } = await sb.from("eeg_gallery_notes").select(COLS).eq("item_id", item.id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ notes: (data as Row[]).map(toNote) }, { headers: { "Cache-Control": "private, no-store" } });
}

// POST /api/admin/eeg-gallery/notes { itemId, body } -> the new note, stamped with the item's renderer version.
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, "editor");
  if (!auth.ok) return auth.response;
  const payload = (await request.json().catch(() => null)) as { itemId?: unknown; body?: unknown } | null;
  const item = galleryItem(payload?.itemId);
  const body = typeof payload?.body === "string" ? payload.body.trim() : "";
  if (!item || !body || body.length > 5000) {
    return NextResponse.json({ error: "Unknown item or empty note." }, { status: 400 });
  }
  const sb = createServerClient();
  if (!sb) return NextResponse.json({ error: "Server not configured." }, { status: 503 });
  const { data, error } = await sb.from("eeg_gallery_notes").insert({
    item_id: item.id, renderer_version: item.rendererVersion, author_id: auth.userId,
    author_name: auth.displayName || auth.email, body,
  }).select(COLS).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: toNote(data as Row) });
}
