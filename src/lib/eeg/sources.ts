// Byte sources for the EDF reader: a local File, or a URL read with HTTP
// Range requests a chunk at a time.
//
// The range source follows the pattern in Neurosift's RemoteFile
// (Apache-2.0, flatironinstitute/neurosift, src/shared/EdfViewer/EDFReader.ts):
// fixed-size chunks, a decoded-chunk cache, in-flight de-duplication, and
// read-ahead that coalesces a run of contiguous chunks into one request.

import type { ByteSource } from "./edf";

export class FileByteSource implements ByteSource {
  readonly size: number;
  constructor(private readonly file: File) { this.size = file.size; }
  async read(offset: number, length: number): Promise<ArrayBuffer> {
    return this.file.slice(offset, Math.min(this.size, offset + length)).arrayBuffer();
  }
}

export interface RangeSourceOptions {
  /** bytes per cached chunk; 1 MiB is ~4 s of 22 ch @ 256 Hz */
  chunkBytes?: number;
  /** cache ceiling in chunks (LRU) */
  maxChunks?: number;
  /** when a sequential read is detected, fetch this many chunks ahead */
  readAheadChunks?: number;
}

/**
 * `getUrl` is called for every request that has no fresh URL and again after
 * a 401/403/400, so a short-lived signed URL can be re-minted mid-session.
 */
export class RangeByteSource implements ByteSource {
  readonly size: number;
  private readonly chunkBytes: number;
  private readonly maxChunks: number;
  private readonly readAhead: number;
  private cache = new Map<number, ArrayBuffer>();
  private inflight = new Map<number, Promise<void>>();
  private url: string | null = null;
  private lastChunk = -2;
  bytesTransferred = 0;

  private constructor(
    private readonly getUrl: () => Promise<string>,
    size: number,
    initialUrl: string,
    opts: RangeSourceOptions,
  ) {
    this.size = size;
    this.url = initialUrl;
    this.chunkBytes = opts.chunkBytes ?? 1 << 20;
    this.maxChunks = opts.maxChunks ?? 96;
    this.readAhead = opts.readAheadChunks ?? 3;
  }

  /** Probes the object for size and Range support before anything else. */
  static async open(getUrl: () => Promise<string>, opts: RangeSourceOptions = {}): Promise<RangeByteSource> {
    const url = await getUrl();
    const res = await fetch(url, { headers: { Range: "bytes=0-255", "Accept-Encoding": "identity" } });
    if (res.status !== 206) {
      throw new Error(
        res.ok
          ? "The storage host ignored the Range header; streaming this recording is not possible."
          : `Could not open the recording (HTTP ${res.status}).`,
      );
    }
    const cr = res.headers.get("Content-Range") ?? "";
    const m = /\/(\d+)$/.exec(cr);
    if (!m) throw new Error("The storage host did not report the recording's size.");
    await res.arrayBuffer();
    return new RangeByteSource(getUrl, parseInt(m[1], 10), url, opts);
  }

  private async fetchRange(start: number, endInclusive: number): Promise<ArrayBuffer> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.url) this.url = await this.getUrl();
      const res = await fetch(this.url, {
        headers: { Range: `bytes=${start}-${endInclusive}`, "Accept-Encoding": "identity" },
      });
      if (res.status === 206) {
        const buf = await res.arrayBuffer();
        this.bytesTransferred += buf.byteLength;
        return buf;
      }
      // Expired signed URL: re-mint once and retry.
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        this.url = null;
        continue;
      }
      throw new Error(`Range request failed (HTTP ${res.status}).`);
    }
    throw new Error("The recording's access link could not be refreshed.");
  }

  private touch(idx: number, buf: ArrayBuffer) {
    this.cache.delete(idx);
    this.cache.set(idx, buf);
    while (this.cache.size > this.maxChunks) {
      const oldest = this.cache.keys().next().value as number;
      this.cache.delete(oldest);
    }
  }

  private loadChunks(first: number, count: number): Promise<void> {
    const start = first * this.chunkBytes;
    const end = Math.min(this.size, (first + count) * this.chunkBytes) - 1;
    const p = this.fetchRange(start, end).then((buf) => {
      for (let i = 0; i < count; i++) {
        const a = i * this.chunkBytes;
        if (a >= buf.byteLength) break;
        this.touch(first + i, buf.slice(a, Math.min(buf.byteLength, a + this.chunkBytes)));
      }
    }).finally(() => {
      for (let i = 0; i < count; i++) this.inflight.delete(first + i);
    });
    for (let i = 0; i < count; i++) this.inflight.set(first + i, p);
    return p;
  }

  private async ensure(first: number, last: number): Promise<void> {
    const lastIdx = Math.ceil(this.size / this.chunkBytes) - 1;
    // Sequential access → extend the request forward.
    const sequential = first === this.lastChunk + 1 || first === this.lastChunk;
    let want = last;
    if (sequential) want = Math.min(lastIdx, last + this.readAhead);
    this.lastChunk = last;

    const waits: Promise<void>[] = [];
    let run: number | null = null;
    for (let i = first; i <= want + 1; i++) {
      const missing = i <= want && !this.cache.has(i) && !this.inflight.has(i);
      if (missing && run === null) run = i;
      if (!missing && run !== null) {
        waits.push(this.loadChunks(run, i - run));
        run = null;
      }
      if (i <= want && this.inflight.has(i)) waits.push(this.inflight.get(i)!);
    }
    await Promise.all(waits);
  }

  async read(offset: number, length: number): Promise<ArrayBuffer> {
    const end = Math.min(this.size, offset + length);
    if (end <= offset) return new ArrayBuffer(0);
    const first = Math.floor(offset / this.chunkBytes);
    const last = Math.floor((end - 1) / this.chunkBytes);
    await this.ensure(first, last);
    const out = new Uint8Array(end - offset);
    for (let i = first; i <= last; i++) {
      const chunk = this.cache.get(i);
      if (!chunk) throw new Error("Chunk evicted before it could be read; raise maxChunks.");
      const chunkStart = i * this.chunkBytes;
      const from = Math.max(offset, chunkStart) - chunkStart;
      const to = Math.min(end, chunkStart + chunk.byteLength) - chunkStart;
      out.set(new Uint8Array(chunk, from, to - from), Math.max(offset, chunkStart) - offset);
    }
    return out.buffer;
  }
}
