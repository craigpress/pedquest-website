import { test } from "node:test";
import assert from "node:assert/strict";
import { versionedImageUrl } from "./image-version";

const hashes = { "/images/qbank/PQ-A-001.png": "abc123" };

test("deployment PNG gets its content hash", () => {
  assert.equal(versionedImageUrl("/images/qbank/PQ-A-001.png", null, hashes), "/images/qbank/PQ-A-001.png?v=abc123");
});

test("unknown local path is left unversioned", () => {
  assert.equal(versionedImageUrl("/images/qbank/PQ-Z-999.png", "2026-09-01", hashes), "/images/qbank/PQ-Z-999.png");
});

test("remote image is keyed by updated_at and changes when the row changes", () => {
  const url = "https://x.supabase.co/storage/v1/object/public/eeg-cases/a.png";
  const a = versionedImageUrl(url, "2026-09-01T00:00:00Z", hashes);
  const b = versionedImageUrl(url, "2026-09-02T00:00:00Z", hashes);
  assert.match(a, /\?v=[0-9a-f]{8}$/);
  assert.notEqual(a, b);
  assert.equal(versionedImageUrl(url, null, hashes), url);
});

test("empty and already-queried URLs pass through", () => {
  assert.equal(versionedImageUrl("", "x", hashes), "");
  assert.equal(versionedImageUrl("https://x.supabase.co/a.png?token=t", "x", hashes), "https://x.supabase.co/a.png?token=t");
});
