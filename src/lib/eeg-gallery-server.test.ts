import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GALLERY_BUCKET, GALLERY_SIGNED_URL_TTL_S } from "./eeg-gallery";
import { GALLERY_MANIFEST, signedGalleryImages } from "./eeg-gallery-server";

type Row = { signedUrl: string; error: string | null };
type Result = { data: Row[] | null; error: { message: string } | null };
function client(sign: (paths: string[], ttl: number) => Promise<Result>): SupabaseClient {
  return {
    storage: { from(bucket: string) { assert.equal(bucket, GALLERY_BUCKET); return { createSignedUrls: sign }; } },
  } as unknown as SupabaseClient;
}
function success(paths: string[], prefix = "signed"): Result {
  return { data: paths.map((path) => ({ signedUrl: `${prefix}/${path}`, error: null })), error: null };
}

test("gallery signing deduplicates requests, refreshes before expiry, and retries failures", async (t) => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, "now", () => now);
  const thumbPaths = GALLERY_MANIFEST.items.map((it) => it.thumbPath);
  const fullPaths = GALLERY_MANIFEST.items.map((it) => it.path);
  let calls = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const sb = client(async (actualPaths, ttl) => {
    assert.deepEqual(actualPaths, calls % 2 ? fullPaths : thumbPaths);
    calls++;
    assert.equal(ttl, GALLERY_SIGNED_URL_TTL_S);
    await pending;
    return success(actualPaths);
  });
  const first = signedGalleryImages(sb);
  assert.equal(signedGalleryImages(sb), first, "concurrent callers must share the in-flight signing request");
  assert.equal(calls, 2, "cold signing starts both batches before either completes");
  release();
  const result = await first;
  assert.equal(result.expiresAt, now + GALLERY_SIGNED_URL_TTL_S * 1000);
  for (const item of GALLERY_MANIFEST.items) {
    assert.deepEqual(result.urls[item.id], { thumb: `signed/${item.thumbPath}`, full: `signed/${item.path}` });
  }

  await t.test("warm cache persists until the ten-minute refresh boundary", async () => {
    now = result.expiresAt - 10 * 60_000 - 1;
    assert.equal(signedGalleryImages(sb), first);
    assert.equal(calls, 2, "warm signing performs no additional storage operations");
    now++;
    const refreshed = signedGalleryImages(client(async (actualPaths) => { calls++; return success(actualPaths, "new"); }));
    assert.notEqual(refreshed, first);
    assert.equal((await refreshed).expiresAt, now + GALLERY_SIGNED_URL_TTL_S * 1000);
    assert.equal(calls, 4);
  });

  await t.test("rejected transport is evicted and the next request retries", async () => {
    now += GALLERY_SIGNED_URL_TTL_S * 1000;
    const failing = client(async () => { throw new Error("transport unavailable"); });
    await assert.rejects(signedGalleryImages(failing), /transport unavailable/);
    const retried = await signedGalleryImages(client(async (actualPaths) => success(actualPaths, "recovered")));
    assert.equal(retried.urls[GALLERY_MANIFEST.items[0].id].thumb, `recovered/${thumbPaths[0]}`);
  });

  await t.test("batch-level signing errors are evicted and retry succeeds", async () => {
    now += GALLERY_SIGNED_URL_TTL_S * 1000;
    await assert.rejects(signedGalleryImages(client(async () => ({ data: null, error: { message: "signing unavailable" } }))));
    const retried = await signedGalleryImages(client(async (actualPaths) => success(actualPaths, "batch-recovered")));
    assert.equal(retried.urls[GALLERY_MANIFEST.items[0].id].full, `batch-recovered/${fullPaths[0]}`);
  });

  for (const failedPaths of [thumbPaths, fullPaths]) await t.test(`a partial ${failedPaths === thumbPaths ? "thumbnail" : "full-image"} failure is evicted and retries`, async () => {
    now += GALLERY_SIGNED_URL_TTL_S * 1000;
    await assert.rejects(signedGalleryImages(client(async (actualPaths) => {
      const response = success(actualPaths);
      if (actualPaths[0] === failedPaths[0]) response.data![0] = { signedUrl: "", error: "Object temporarily unavailable" };
      return response;
    })));
    const retried = await signedGalleryImages(client(async (actualPaths) => success(actualPaths, "object-recovered")));
    assert.deepEqual(retried.urls[GALLERY_MANIFEST.items[0].id], {
      thumb: `object-recovered/${thumbPaths[0]}`, full: `object-recovered/${fullPaths[0]}`,
    });
  });

  await t.test("a late old rejection cannot evict a newer successful cache entry", async () => {
    now += GALLERY_SIGNED_URL_TTL_S * 1000;
    let rejectOld!: (reason: Error) => void;
    const deferred = new Promise<Result>((_resolve, reject) => { rejectOld = reject; });
    const old = signedGalleryImages(client(async () => deferred));
    now += GALLERY_SIGNED_URL_TTL_S * 1000;
    const replacement = signedGalleryImages(client(async (actualPaths) => success(actualPaths, "replacement")));
    await replacement;
    const rejected = assert.rejects(old, /old transport failed/);
    rejectOld(new Error("old transport failed"));
    await rejected;
    assert.equal(signedGalleryImages(sb), replacement);
  });
});
