// Server half of the EEG feature gallery (see src/lib/eeg-gallery.ts): the manifest and its item lookup.
import manifestJson from "@/data/eeg-gallery.json";
import type { GalleryItem, GalleryManifest } from "@/lib/eeg-gallery";

export const GALLERY_MANIFEST = manifestJson as GalleryManifest;
const BY_ID = new Map<string, GalleryItem>(GALLERY_MANIFEST.items.map((i) => [i.id, i]));

export function galleryItem(id: unknown): GalleryItem | null {
  return typeof id === "string" ? BY_ID.get(id) ?? null : null;
}
