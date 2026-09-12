// Smoke test for the EEG Lab Viewer's readers, montage and trend engine
// against real exports. Not part of the app bundle.
//
//   npx tsx scripts/lab-viewer-smoke.ts <recording.edf> [<recording.lay> <recording.dat>]
//
// Reads a window across the first realized seizure of PQ-A-012 (1920–2010 s),
// compares the .lay/.dat path to the EDF path sample-for-sample, and computes
// trends over the first 35 minutes.

import { open, type FileHandle } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { EdfReader, type ByteSource } from "../src/lib/eeg/edf";
import { LayReader } from "../src/lib/eeg/lay";
import { applyMontage, buildMontage } from "../src/lib/eeg/montage";
import { createTrendEngine } from "../src/lib/eeg/trends";

class NodeSource implements ByteSource {
  constructor(private fh: FileHandle, readonly size: number) {}
  async read(offset: number, length: number) {
    const buf = Buffer.alloc(Math.max(0, Math.min(length, this.size - offset)));
    await this.fh.read(buf, 0, buf.length, offset);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
  }
}
async function src(p: string) { const fh = await open(p, "r"); return new NodeSource(fh, (await fh.stat()).size); }
const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

async function main() {
const [edfPath, layPath, datPath] = process.argv.slice(2);
if (!edfPath) { console.error("usage: lab-viewer-smoke <file.edf> [<file.lay> <file.dat>]"); process.exit(2); }

const edf = await EdfReader.open(await src(edfPath));
console.log("EDF", edf.info.format, "dur", edf.durationS, "fs", edf.sampleRate, "ch", edf.labels.length,
  edf.labels.slice(0, 5).join(","), "start", edf.info.startDateTime?.toISOString());
const c3 = edf.labels.indexOf("C3");
const ictal = await edf.readWindow(1925, 1935);
const inter = await edf.readWindow(600, 610);
console.log("C3 rms  ictal", rms(ictal.data[c3]).toFixed(1), " interictal", rms(inter.data[c3]).toFixed(1), " window len", ictal.data[0].length);
const der = buildMontage("longitudinal_bipolar", edf.labels);
console.log("bipolar rows", der.length, der.map((d) => d.label).slice(0, 6).join(" "), "… aux:", der.filter((d) => d.aux).map((d) => d.label).join(","));
console.log("montage row0 len", applyMontage(ictal.data, edf.labels, der)[0].length);
let t = performance.now();
const ann = await edf.scanAnnotations();
console.log("scanAnnotations", ann.length, `in ${(performance.now() - t).toFixed(0)} ms`);

if (layPath && datPath) {
  const lay = await LayReader.open(readFileSync(layPath, "latin1"), await src(datPath));
  console.log("LAY", lay.info.format, "dur", lay.durationS, "fs", lay.sampleRate, "ch", lay.labels.length,
    "comments", lay.lay.comments.length, "cal", lay.lay.calibration, "patient", lay.info.patient);
  const lw = await lay.readWindow(1925, 1935);
  let maxDiff = 0;
  const a = lw.data[lay.labels.indexOf("C3")], b = ictal.data[c3];
  for (let i = 0; i < Math.min(a.length, b.length); i++) maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
  console.log("lay C3 rms", rms(a).toFixed(1), " max |lay−edf| per sample", maxDiff.toFixed(3), "µV");
}

const eng = createTrendEngine(edf.durationS, edf.sampleRate, edf.labels);
const m = eng.marginS();
t = performance.now();
for (let s = 0; s < 2100; s += 60) {
  const win = await edf.readWindow(Math.max(0, s - m), Math.min(edf.durationS, s + 60 + m));
  eng.process(win.t0, win.data);
}
const tr = eng.trends;
console.log(`trends: hop ${tr.hopS}s nT ${tr.nT} filled ${tr.filled} in ${(performance.now() - t).toFixed(0)} ms; aEEG`, tr.aeegDerivation);
for (const s of [600, 1900, 1950, 2000, 2060]) {
  const i = Math.floor(s / tr.hopS);
  console.log(`t=${s}s  aEEG L ${tr.aeegLo.left[i].toFixed(1)}–${tr.aeegHi.left[i].toFixed(1)}  power L ${tr.totalPower.left[i].toFixed(0)} R ${tr.totalPower.right[i].toFixed(0)}  SR L ${tr.sr.left[i].toFixed(0)}%  α/δ ${tr.adr.left[i].toFixed(2)}  asym ${tr.asym[i].toFixed(1)}`);
}
}

void main();
