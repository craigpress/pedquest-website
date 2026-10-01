// Server half of the EEG feature gallery (see src/lib/eeg-gallery.ts): the manifest and its item lookup.
import manifestJson from "@/data/eeg-gallery.json";
import type { GalleryItem, GalleryManifest } from "@/lib/eeg-gallery";
import { GALLERY_BUCKET, GALLERY_SIGNED_URL_TTL_S } from "@/lib/eeg-gallery";
import type { SupabaseClient } from "@supabase/supabase-js";

export const GALLERY_MANIFEST = manifestJson as GalleryManifest;
const BY_ID = new Map<string, GalleryItem>(GALLERY_MANIFEST.items.map((i) => [i.id, i]));

export function galleryItem(id: unknown): GalleryItem | null {
  return typeof id === "string" ? BY_ID.get(id) ?? null : null;
}

type SignedImages = {
  urls: Record<string, { thumb: string | null; full: string | null }>;
  expiresAt: number;
};
let images: { expiresAt: number; promise: Promise<SignedImages> } | null = null;

export function signedGalleryImages(sb: SupabaseClient): Promise<SignedImages> {
  if (images && images.expiresAt - Date.now() > 10 * 60_000) return images.promise;
  const expiresAt = Date.now() + GALLERY_SIGNED_URL_TTL_S * 1000;
  const promise = (async () => {
    const items = GALLERY_MANIFEST.items;
    const bucket = sb.storage.from(GALLERY_BUCKET);
    const [thumbs, full] = await Promise.all([
      bucket.createSignedUrls(items.map((it) => it.thumbPath), GALLERY_SIGNED_URL_TTL_S),
      bucket.createSignedUrls(items.map((it) => it.path), GALLERY_SIGNED_URL_TTL_S),
    ]);
    for (const result of [thumbs, full]) {
      if (result.error) throw result.error;
      const missing = result.data?.find((image) => image.error || !image.signedUrl);
      if (missing) throw new Error(missing.error || `Could not sign gallery image ${missing.path}.`);
    }
    const urls = Object.fromEntries(items.map((it, k) => [it.id, {
      thumb: thumbs.data?.[k]?.signedUrl ?? null,
      full: full.data?.[k]?.signedUrl ?? null,
    }]));
    return { urls, expiresAt };
  })();
  images = { expiresAt, promise };
  promise.catch(() => { if (images?.promise === promise) images = null; });
  return promise;
}
