// trend-sidecar — compute the viewer's qEEG trends once, next to the recording.
//
// Runs under Node on the export host (moltbot) with the SAME TypeScript engine
// the browser viewer uses (src/lib/eeg/trends.ts), so the sidecar and a strip
// computed live are identical. Bundled with esbuild (npm run trends:sidecar:build)
// into dist/trend-sidecar.mjs and copied to /opt/pedquest-eeg-render/.
//
//   node trend-sidecar.mjs <recording.edf | recording.lay> [--out <file>] [--force]
//       writes <stem>.trends.bin beside the recording; prints one JSON line
//       {path, bytes, nT, hopS, seconds}
//
//   node trend-sidecar.mjs --backfill <store dir> [--update-db] [--force]
//       every LAB-*/ folder that has a recording but no current sidecar gets one;
//       with --update-db (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env) the
//       eeg_lab_jobs row's artifacts gain "trends": "eeglab://<id>/<file>".

import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { EdfReader, type ByteSource } from "../../../src/lib/eeg/edf";
import { LayReader } from "../../../src/lib/eeg/lay";
import type { Recording } from "../../../src/lib/eeg/recording";
import { createTrendEngine, TREND_ENGINE_VERSION, SR_THRESHOLD_UV, SR_EPOCH_S, SR_WINDOW_S } from "../../../src/lib/eeg/trends";
import { encodeTrends, readTrendSidecarHeader, TREND_SIDECAR_EXT } from "../../../src/lib/eeg/trend-sidecar";

const BLOCK_S = 60;

class FsByteSource implements ByteSource {
  readonly size: number;
  private readonly fd: number;
  constructor(path: string) {
    this.fd = openSync(path, "r");
    this.size = fstatSync(this.fd).size;
  }
  async read(offset: number, length: number): Promise<ArrayBuffer> {
    const n = Math.max(0, Math.min(length, this.size - offset));
    const buf = Buffer.allocUnsafe(n);
    let got = 0;
    while (got < n) {
      const r = readSync(this.fd, buf, got, n - got, offset + got);
      if (r <= 0) break;
      got += r;
    }
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + got);
  }
  close() { closeSync(this.fd); }
}

/** Case-insensitive sibling lookup: the store writes LAB-….LAY / .DAT in upper case. */
function sibling(path: string, ext: string): string | null {
  const dir = dirname(path);
  const stem = basename(path).replace(/\.[^.]+$/, "").toLowerCase();
  for (const name of readdirSync(dir)) {
    if (name.toLowerCase() === `${stem}${ext}`) return join(dir, name);
  }
  return null;
}

async function openRecording(path: string): Promise<{ reader: Recording; close: () => void }> {
  const ext = extname(path).toLowerCase();
  if (ext === ".edf") {
    const src = new FsByteSource(path);
    return { reader: await EdfReader.open(src), close: () => src.close() };
  }
  if (ext === ".lay") {
    const dat = sibling(path, ".dat");
    if (!dat) throw new Error(`no .dat beside ${path}`);
    const src = new FsByteSource(dat);
    return { reader: await LayReader.open(readFileSync(path, "utf8"), src), close: () => src.close() };
  }
  throw new Error(`not a recording: ${path}`);
}

async function computeSidecar(recording: string, out: string): Promise<{ path: string; bytes: number; nT: number; hopS: number; seconds: number; qaPath: string }> {
  const started = Date.now();
  const { reader, close } = await openRecording(recording);
  try {
    if (!reader.sampleRate || !reader.durationS) throw new Error("recording has no sample rate or duration");
    const engine = createTrendEngine(reader.durationS, reader.sampleRate, reader.labels);
    const margin = engine.marginS();
    for (let t0 = 0; t0 < reader.durationS; t0 += BLOCK_S) {
      const t1 = Math.min(reader.durationS, t0 + BLOCK_S);
      const win = await reader.readWindow(Math.max(0, t0 - margin), Math.min(reader.durationS, t1 + margin));
      engine.process(win.t0, win.data);
    }
    const buf = encodeTrends(engine.trends, { durationS: reader.durationS, sampleRate: reader.sampleRate, channels: reader.labels.length });
    writeFileSync(out, Buffer.from(buf));
    // These samples come from the exported recording, never a second synthesis.
    const windows = [];
    for (const fraction of [0, 0.5, 0.9]) {
      const start = Math.max(0, Math.min(reader.durationS - 15, reader.durationS * fraction));
      const win = await reader.readWindow(start, Math.min(reader.durationS, start + 15));
      windows.push({ t0: win.t0, data: win.data.map((channel) => Array.from(channel)) });
    }
    const qaPath = out + ".qa.json";
    writeFileSync(qaPath, JSON.stringify({ sampleRate: reader.sampleRate, labels: reader.labels,
      suppressionRule: { peakToPeakUv: 2 * SR_THRESHOLD_UV, epochS: SR_EPOCH_S, windowS: SR_WINDOW_S },
      durationS: reader.durationS, windows, trendSidecar: out, engineVersion: TREND_ENGINE_VERSION,
      coverage: "Three 15-second windows at start, midpoint and near end; full-record calculated trends. Events outside these windows are not visually verified." }));
    return { path: out, bytes: buf.byteLength, nT: engine.trends.nT, hopS: engine.trends.hopS, seconds: Math.round((Date.now() - started) / 1000), qaPath };
  } finally {
    close();
  }
}

function sidecarCurrent(path: string): boolean {
  if (!existsSync(path)) return false;
  try {
    const fd = openSync(path, "r");
    const head = Buffer.alloc(Math.min(65536, fstatSync(fd).size));
    readSync(fd, head, 0, head.length, 0);
    closeSync(fd);
    const h = readTrendSidecarHeader(head.buffer.slice(head.byteOffset, head.byteOffset + head.length));
    return !!h && h.engineVersion === TREND_ENGINE_VERSION;
  } catch {
    return false;
  }
}

function sidecarPathFor(recording: string): string {
  return join(dirname(recording), basename(recording).replace(/\.[^.]+$/, "") + TREND_SIDECAR_EXT);
}

/** The recording the viewer would open for this folder: EDF first, then .lay. */
function pickRecording(dir: string): string | null {
  const names = readdirSync(dir);
  const byExt = (ext: string) => names.find((n) => n.toLowerCase().endsWith(ext));
  const edf = byExt(".edf");
  if (edf) return join(dir, edf);
  const lay = byExt(".lay");
  return lay ? join(dir, lay) : null;
}

async function supabase(method: string, path: string, body?: unknown): Promise<unknown> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase ${method} ${path} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function recordArtifact(recordingId: string, fileName: string): Promise<number> {
  const rows = (await supabase("GET", `/rest/v1/eeg_lab_jobs?recording_id=eq.${encodeURIComponent(recordingId)}&stage=eq.export&status=eq.done&select=id,artifacts`)) as { id: string; artifacts: Record<string, string> | null }[];
  let updated = 0;
  for (const row of rows) {
    const artifacts = { ...(row.artifacts ?? {}), trends: `eeglab://${recordingId}/${fileName}` };
    await supabase("PATCH", `/rest/v1/eeg_lab_jobs?id=eq.${row.id}`, { artifacts });
    updated++;
  }
  return updated;
}

async function backfill(store: string, updateDb: boolean, force: boolean) {
  const dirs = readdirSync(store).filter((n) => /^LAB-/.test(n) && statSync(join(store, n)).isDirectory()).sort();
  let written = 0, skipped = 0, failed = 0, dbRows = 0;
  for (const name of dirs) {
    const dir = join(store, name);
    const rec = pickRecording(dir);
    if (!rec) { console.error(`${name}: no recording`); skipped++; continue; }
    const out = sidecarPathFor(rec);
    try {
      if (!force && sidecarCurrent(out)) {
        skipped++;
      } else {
        const r = await computeSidecar(rec, out);
        written++;
        console.error(`${name}: ${basename(out)} ${r.nT} epochs @ ${r.hopS}s in ${r.seconds}s`);
      }
      if (updateDb) dbRows += await recordArtifact(name, basename(out));
    } catch (e) {
      failed++;
      console.error(`${name}: FAILED ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(JSON.stringify({ store, folders: dirs.length, written, skipped, failed, dbRows, engineVersion: TREND_ENGINE_VERSION }));
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (f: string) => args.includes(f);
  const value = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
  if (flag("--backfill")) {
    await backfill(value("--backfill")!, flag("--update-db"), flag("--force"));
    return;
  }
  const rec = args.find((a) => !a.startsWith("--") && a !== value("--out"));
  if (!rec) {
    console.error("usage: trend-sidecar <recording.edf|.lay> [--out file] [--force] | --backfill <dir> [--update-db] [--force]");
    process.exit(2);
  }
  const out = value("--out") ?? sidecarPathFor(rec);
  if (!flag("--force") && sidecarCurrent(out)) {
    console.log(JSON.stringify({ path: out, bytes: statSync(out).size, nT: null, hopS: null, seconds: 0, reused: true }));
    return;
  }
  console.log(JSON.stringify(await computeSidecar(rec, out)));
}

main().catch((e) => { console.error(e instanceof Error ? e.stack ?? e.message : String(e)); process.exit(1); });
