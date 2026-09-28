// Cache keys for case / question-bank images.
//
// A re-render keeps the image's URL (`/images/qbank/<ID>.png`, or the same
// storage path), so the URL the pages hand the browser and the image optimizer
// carries `?v=<key>`. Each render then gets its own long-lived cache entry
// (next.config.ts marks versioned qbank PNGs immutable) and a new render can
// never be answered from a stale cached variant.
//
//   - Deployment PNGs are keyed by content hash (prebuild manifest), so the
//     key changes exactly when the deployed bytes change.
//   - Remote (Supabase storage) images are keyed by the row's `updated_at`:
//     the render/upload writes the object before it updates the row.
//   - Anything else is returned unchanged (served with revalidation).
import { QBANK_IMAGE_HASHES } from "@/data/qbank-image-hashes.generated";

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function versionedImageUrl(
  url: string,
  rowUpdatedAt?: string | null,
  hashes: Record<string, string> = QBANK_IMAGE_HASHES,
): string {
  if (!url || url.includes("?")) return url;
  if (url.startsWith("/")) {
    const hash = hashes[url];
    return hash ? `${url}?v=${hash}` : url;
  }
  if (/^https:\/\//.test(url) && rowUpdatedAt) return `${url}?v=${fnv1a(rowUpdatedAt)}`;
  return url;
}
