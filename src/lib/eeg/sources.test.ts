import assert from "node:assert/strict";
import { test } from "node:test";
import { RangeByteSource } from "./sources";

test("refreshes an expired same-origin stream URL", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  let issued = 0;
  const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    urls.push(url);
    if (urls.length === 1) {
      return new Response(bytes.slice(0, 4), {
        status: 206,
        headers: { "Content-Range": "bytes 0-3/8" },
      });
    }
    if (url === "https://example.test/expired") return new Response(null, { status: 410 });
    assert.equal(init?.headers && new Headers(init.headers).get("Range"), "bytes=0-3");
    return new Response(bytes.slice(0, 4), {
      status: 206,
      headers: { "Content-Range": "bytes 0-3/8" },
    });
  };

  try {
    const source = await RangeByteSource.open(
      async () => (++issued === 1 ? "https://example.test/expired" : "https://example.test/fresh"),
      { chunkBytes: 4, readAheadChunks: 0 },
    );
    assert.deepEqual(new Uint8Array(await source.read(0, 4)), bytes.slice(0, 4));
    assert.equal(issued, 2);
    assert.deepEqual(urls, [
      "https://example.test/expired",
      "https://example.test/expired",
      "https://example.test/fresh",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
