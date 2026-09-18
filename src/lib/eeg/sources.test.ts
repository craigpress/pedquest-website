import assert from "node:assert/strict";
import { test } from "node:test";
import { RangeByteSource } from "./sources";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function rangeResponse(bytes: Uint8Array, start: number, end: number) {
  return new Response(bytes.slice(start, end + 1), {
    status: 206,
    headers: { "Content-Range": `bytes ${start}-${end}/${bytes.length}` },
  });
}

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

test("cached pages render while read-ahead is pending, and the next page shares that fetch", { timeout: 2000 }, async () => {
  const originalFetch = globalThis.fetch;
  const bytes = Uint8Array.from({ length: 16 }, (_, i) => i);
  const pending = deferred<Response>();
  const ranges: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const range = new Headers(init?.headers).get("Range")!;
    ranges.push(range);
    if (range === "bytes=0-255") return rangeResponse(bytes, 0, 15);
    if (range === "bytes=4-11") return pending.promise;
    const [, start, end] = /bytes=(\d+)-(\d+)/.exec(range)!;
    return rangeResponse(bytes, +start, +end);
  };
  try {
    const source = await RangeByteSource.open(async () => "https://example.test/eeg", { chunkBytes: 4, readAheadChunks: 2 });
    assert.deepEqual(new Uint8Array(await source.read(0, 2)), bytes.slice(0, 2));
    assert.ok(ranges.includes("bytes=4-11"), "prefetch starts before the next scroll");
    assert.deepEqual(new Uint8Array(await source.read(2, 2)), bytes.slice(2, 4));
    const next = source.read(4, 4);
    pending.resolve(rangeResponse(bytes, 4, 11));
    assert.deepEqual(new Uint8Array(await next), bytes.slice(4, 8));
    assert.equal(ranges.filter((r) => r === "bytes=4-11").length, 1);
    assert.equal(ranges.includes("bytes=4-7"), false);
  } finally {
    pending.resolve(rangeResponse(bytes, 4, 11));
    globalThis.fetch = originalFetch;
  }
});

test("read-ahead follows backward scrolling and clamps at the file boundaries", async () => {
  const originalFetch = globalThis.fetch;
  const bytes = Uint8Array.from({ length: 23 }, (_, i) => i);
  const ranges: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const range = new Headers(init?.headers).get("Range")!;
    ranges.push(range);
    if (range === "bytes=0-255") return rangeResponse(bytes, 0, 22);
    const [, start, end] = /bytes=(\d+)-(\d+)/.exec(range)!;
    assert.ok(+end < bytes.length);
    return rangeResponse(bytes, +start, +end);
  };
  try {
    const source = await RangeByteSource.open(async () => "https://example.test/eeg", { chunkBytes: 4, readAheadChunks: 2 });
    await source.read(20, 3);
    await source.read(12, 4);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(ranges.includes("bytes=4-11"));
    await source.read(0, 4);
    assert.equal(ranges.some((r) => r.startsWith("bytes=-")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed speculative reads do not break cached pages and can be retried on demand", async () => {
  const originalFetch = globalThis.fetch;
  const bytes = Uint8Array.from({ length: 8 }, (_, i) => i);
  let fail = true;
  globalThis.fetch = async (_input, init) => {
    const range = new Headers(init?.headers).get("Range")!;
    if (range === "bytes=0-255") return rangeResponse(bytes, 0, 7);
    if (range === "bytes=4-7" && fail) return new Response(null, { status: 503 });
    const [, start, end] = /bytes=(\d+)-(\d+)/.exec(range)!;
    return rangeResponse(bytes, +start, +end);
  };
  try {
    const source = await RangeByteSource.open(async () => "https://example.test/eeg", { chunkBytes: 4, readAheadChunks: 1 });
    await source.read(0, 4);
    await new Promise((resolve) => setImmediate(resolve));
    fail = false;
    assert.deepEqual(new Uint8Array(await source.read(4, 4)), bytes.slice(4));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("concurrent reads retain their bytes even when the LRU is smaller than a request", async () => {
  const originalFetch = globalThis.fetch;
  const bytes = Uint8Array.from({ length: 32 }, (_, i) => i);
  globalThis.fetch = async (_input, init) => {
    const range = new Headers(init?.headers).get("Range")!;
    if (range === "bytes=0-255") return rangeResponse(bytes, 0, 31);
    const [, start, end] = /bytes=(\d+)-(\d+)/.exec(range)!;
    return rangeResponse(bytes, +start, +end);
  };
  try {
    const source = await RangeByteSource.open(async () => "https://example.test/eeg", { chunkBytes: 4, maxChunks: 2, readAheadChunks: 0 });
    const [a, b] = await Promise.all([source.read(0, 16), source.read(12, 20)]);
    assert.deepEqual(new Uint8Array(a), bytes.slice(0, 16));
    assert.deepEqual(new Uint8Array(b), bytes.slice(12));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
