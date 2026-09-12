// EDF / EDF+ reader over a byte source that is read a slice at a time.
//
// Written for the files tools/eeg-render/eeg_render/export/edfplus.py produces,
// but it parses the standard header, so any conforming EDF or EDF+C recording
// opens. Not handled: EDF+D (discontinuous) records are treated as contiguous,
// and per-signal sample rates are honoured for reading but the viewer draws
// against the first EEG signal's rate.
//
// Isomorphic: no DOM, no node. `FileByteSource` and `RangeByteSource` live in
// ./sources.ts because one needs File and the other fetch.

import type { Recording, RecordingInfo } from "./recording";

export interface ByteSource {
  readonly size: number;
  /** Bytes [offset, offset + length). May return fewer at end of source. */
  read(offset: number, length: number): Promise<ArrayBuffer>;
}

export interface EdfSignal {
  index: number;
  label: string;
  transducer: string;
  physicalDimension: string;
  physicalMin: number;
  physicalMax: number;
  digitalMin: number;
  digitalMax: number;
  prefiltering: string;
  samplesPerRecord: number;
  /** derived */
  sampleRate: number;
  gain: number;   // physical per digital unit
  offset: number; // physical = digital * gain + offset
  isAnnotation: boolean;
  /** byte offset of this signal's block inside a data record */
  recordByteOffset: number;
}

export interface EdfHeader {
  version: string;
  patient: string;
  recording: string;
  startDate: string;
  startTime: string;
  headerBytes: number;
  reserved: string;
  isEdfPlus: boolean;
  isContinuous: boolean;
  nRecords: number;
  recordDurationS: number;
  signals: EdfSignal[];
  /** signals that carry data (not EDF Annotations) */
  dataSignals: EdfSignal[];
  recordBytes: number;
  durationS: number;
  /** Startdate from the EDF+ recording field, if present */
  startDateTime: Date | null;
}

export interface EdfAnnotation {
  onsetS: number;
  durationS: number | null;
  text: string;
  /** which data record it came from — used to dedupe scans */
  record: number;
}

const ANNOT_LABEL = "EDF Annotations";

function ascii(buf: Uint8Array, start: number, len: number): string {
  let s = "";
  for (let i = start; i < start + len; i++) s += String.fromCharCode(buf[i]);
  return s.trim();
}

function num(buf: Uint8Array, start: number, len: number): number {
  const v = parseFloat(ascii(buf, start, len));
  return Number.isFinite(v) ? v : 0;
}

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

function parseStart(recording: string, date: string, time: string): Date | null {
  const m = /Startdate (\d{2})-([A-Z]{3})-(\d{4})/i.exec(recording);
  const [hh, mm, ss] = time.split(".").map((x) => parseInt(x, 10));
  if (m && MONTHS[m[2].toUpperCase()] !== undefined) {
    return new Date(parseInt(m[3], 10), MONTHS[m[2].toUpperCase()], parseInt(m[1], 10), hh || 0, mm || 0, ss || 0);
  }
  const d = date.split(".").map((x) => parseInt(x, 10));
  if (d.length === 3 && d.every(Number.isFinite)) {
    // EDF two-digit year: 85-99 → 1985-1999, 00-84 → 2000-2084
    const year = d[2] >= 85 ? 1900 + d[2] : 2000 + d[2];
    return new Date(year, d[1] - 1, d[0], hh || 0, mm || 0, ss || 0);
  }
  return null;
}

export async function readEdfHeader(source: ByteSource): Promise<EdfHeader> {
  const fixed = new Uint8Array(await source.read(0, 256));
  if (fixed.byteLength < 256) throw new Error("File is too short to be an EDF recording.");
  const version = ascii(fixed, 0, 8);
  if (version !== "0") throw new Error(`Not an EDF file (version field "${version}").`);

  const nSig = parseInt(ascii(fixed, 252, 4), 10);
  if (!Number.isFinite(nSig) || nSig < 1 || nSig > 512) {
    throw new Error("EDF header declares an implausible signal count.");
  }
  const headerBytes = parseInt(ascii(fixed, 184, 8), 10);
  const sigBytes = new Uint8Array(await source.read(256, 256 * nSig));
  if (sigBytes.byteLength < 256 * nSig) throw new Error("EDF signal header is truncated.");

  const reserved = ascii(fixed, 192, 44);
  const recordDurationS = num(fixed, 244, 8);
  let nRecords = parseInt(ascii(fixed, 236, 8), 10);

  // Signal header is stored field-major: all labels, then all transducers, …
  const field = (fieldIdx: number, width: number, sig: number) => {
    // cumulative widths: 16,80,8,8,8,8,8,80,8,32
    const offsets = [0, 16, 96, 104, 112, 120, 128, 136, 216, 224];
    return offsets[fieldIdx] * nSig + sig * width;
  };

  const signals: EdfSignal[] = [];
  let recordByteOffset = 0;
  for (let i = 0; i < nSig; i++) {
    const label = ascii(sigBytes, field(0, 16, i), 16);
    const physicalMin = num(sigBytes, field(3, 8, i), 8);
    const physicalMax = num(sigBytes, field(4, 8, i), 8);
    const digitalMin = num(sigBytes, field(5, 8, i), 8);
    const digitalMax = num(sigBytes, field(6, 8, i), 8);
    const samplesPerRecord = parseInt(ascii(sigBytes, field(8, 8, i), 8), 10) || 0;
    const isAnnotation = label === ANNOT_LABEL;
    const dRange = digitalMax - digitalMin || 1;
    const gain = (physicalMax - physicalMin) / dRange;
    const offset = physicalMin - digitalMin * gain;
    signals.push({
      index: i,
      label,
      transducer: ascii(sigBytes, field(1, 80, i), 80),
      physicalDimension: ascii(sigBytes, field(2, 8, i), 8),
      physicalMin, physicalMax, digitalMin, digitalMax,
      prefiltering: ascii(sigBytes, field(7, 80, i), 80),
      samplesPerRecord,
      sampleRate: recordDurationS > 0 ? samplesPerRecord / recordDurationS : 0,
      gain, offset, isAnnotation,
      recordByteOffset,
    });
    recordByteOffset += samplesPerRecord * 2;
  }
  const recordBytes = recordByteOffset;

  // -1 records means "unknown"; derive from the byte length.
  if (!Number.isFinite(nRecords) || nRecords < 0) {
    nRecords = recordBytes > 0 ? Math.floor((source.size - headerBytes) / recordBytes) : 0;
  }

  const recording = ascii(fixed, 88, 80);
  const startDate = ascii(fixed, 168, 8);
  const startTime = ascii(fixed, 176, 8);
  const isEdfPlus = reserved.startsWith("EDF+");

  return {
    version,
    patient: ascii(fixed, 8, 80),
    recording,
    startDate, startTime,
    headerBytes,
    reserved,
    isEdfPlus,
    isContinuous: !reserved.startsWith("EDF+D"),
    nRecords,
    recordDurationS,
    signals,
    dataSignals: signals.filter((s) => !s.isAnnotation),
    recordBytes,
    durationS: nRecords * recordDurationS,
    startDateTime: parseStart(recording, startDate, startTime),
  };
}

/** Parse the TALs in one record's annotation block. The first TAL is the
 *  timekeeping one (empty text) and is skipped. */
export function parseTals(block: Uint8Array, record: number): EdfAnnotation[] {
  const out: EdfAnnotation[] = [];
  let i = 0;
  const n = block.length;
  while (i < n) {
    if (block[i] === 0) { i++; continue; }
    // onset[\x15duration]\x14text\x14[text\x14...]\x00
    let j = i;
    while (j < n && block[j] !== 0x14 && block[j] !== 0x15) j++;
    const onsetS = parseFloat(String.fromCharCode(...block.subarray(i, j)));
    let durationS: number | null = null;
    if (block[j] === 0x15) {
      let k = j + 1;
      while (k < n && block[k] !== 0x14) k++;
      durationS = parseFloat(String.fromCharCode(...block.subarray(j + 1, k)));
      j = k;
    }
    // now block[j] === 0x14; texts follow, each terminated by 0x14, TAL ends at 0x00
    let k = j + 1;
    const texts: string[] = [];
    while (k < n && block[k] !== 0) {
      let e = k;
      while (e < n && block[e] !== 0x14 && block[e] !== 0) e++;
      if (e > k) texts.push(utf8(block.subarray(k, e)));
      k = block[e] === 0x14 ? e + 1 : e;
    }
    if (Number.isFinite(onsetS)) {
      for (const text of texts) {
        if (text.length) out.push({ onsetS, durationS: Number.isFinite(durationS as number) ? durationS : null, text, record });
      }
    }
    i = k + 1;
  }
  return out;
}

const decoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null;
function utf8(bytes: Uint8Array): string {
  if (decoder) return decoder.decode(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

export interface SignalWindow {
  /** seconds from recording start of sample 0 in each array */
  t0: number;
  sampleRate: number;
  /** one Float32Array per data signal, physical units, same length */
  data: Float32Array[];
  labels: string[];
  annotations: EdfAnnotation[];
}

export class EdfReader implements Recording {
  readonly info: RecordingInfo;
  readonly annotationsUpFront = false;

  private constructor(readonly source: ByteSource, readonly header: EdfHeader) {
    this.info = {
      format: header.isEdfPlus ? (header.isContinuous ? "EDF+C" : "EDF+D") : "EDF",
      startDateTime: header.startDateTime,
      patient: header.patient,
      notes: [header.recording].filter(Boolean),
    };
  }

  static async open(source: ByteSource): Promise<EdfReader> {
    return new EdfReader(source, await readEdfHeader(source));
  }

  get durationS(): number { return this.header.durationS; }

  /** The rate the viewer paints against: the first data signal's. */
  get sampleRate(): number {
    return this.header.dataSignals[0]?.sampleRate ?? 0;
  }

  get labels(): string[] { return this.header.dataSignals.map((s) => s.label); }

  private async readRecords(r0: number, r1: number): Promise<Uint8Array> {
    const { headerBytes, recordBytes } = this.header;
    const buf = await this.source.read(headerBytes + r0 * recordBytes, (r1 - r0) * recordBytes);
    return new Uint8Array(buf);
  }

  /**
   * Read [t0, t1) seconds of every data signal. Signals with a different rate
   * from the first are resampled by nearest sample onto the first's grid, so
   * the caller gets equal-length rows.
   */
  async readWindow(t0: number, t1: number): Promise<SignalWindow> {
    const h = this.header;
    const recS = h.recordDurationS;
    const t0c = Math.max(0, Math.min(t0, h.durationS));
    const t1c = Math.max(t0c, Math.min(t1, h.durationS));
    const r0 = Math.floor(t0c / recS);
    const r1 = Math.min(h.nRecords, Math.max(r0 + 1, Math.ceil(t1c / recS)));
    const bytes = await this.readRecords(r0, r1);
    const nRec = r1 - r0;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    const fs = this.sampleRate;
    const s0 = Math.round((t0c - r0 * recS) * fs);
    const nOut = Math.max(0, Math.round((t1c - t0c) * fs));

    const data: Float32Array[] = [];
    for (const sig of h.dataSignals) {
      const out = new Float32Array(nOut);
      const spr = sig.samplesPerRecord;
      const ratio = sig.sampleRate / fs;
      for (let i = 0; i < nOut; i++) {
        const k = Math.floor((s0 + i) * ratio);
        const rec = Math.floor(k / spr);
        if (rec >= nRec) break;
        const within = k - rec * spr;
        const byteAt = rec * h.recordBytes + sig.recordByteOffset + within * 2;
        if (byteAt + 1 >= bytes.byteLength) break;
        out[i] = view.getInt16(byteAt, true) * sig.gain + sig.offset;
      }
      data.push(out);
    }

    const annotations: EdfAnnotation[] = [];
    const annSig = h.signals.find((s) => s.isAnnotation);
    if (annSig) {
      for (let rec = 0; rec < nRec; rec++) {
        const start = rec * h.recordBytes + annSig.recordByteOffset;
        const block = bytes.subarray(start, start + annSig.samplesPerRecord * 2);
        for (const a of parseTals(block, r0 + rec)) {
          if (a.onsetS < t1c && (a.onsetS + (a.durationS ?? 0)) >= t0c) annotations.push(a);
        }
      }
    }

    return { t0: t0c, sampleRate: fs, data, labels: this.labels, annotations };
  }

  /**
   * Scan every record's annotation block. Reads the whole file in
   * `batchRecords`-sized runs, so on a remote source this transfers the full
   * recording; call it deliberately. `onProgress` gets 0..1.
   */
  async scanAnnotations(
    onProgress?: (frac: number) => void,
    signal?: AbortSignal,
    batchRecords = 256,
  ): Promise<EdfAnnotation[]> {
    const h = this.header;
    const annSig = h.signals.find((s) => s.isAnnotation);
    if (!annSig) return [];
    const out: EdfAnnotation[] = [];
    for (let r0 = 0; r0 < h.nRecords; r0 += batchRecords) {
      if (signal?.aborted) break;
      const r1 = Math.min(h.nRecords, r0 + batchRecords);
      const bytes = await this.readRecords(r0, r1);
      for (let rec = 0; rec < r1 - r0; rec++) {
        const start = rec * h.recordBytes + annSig.recordByteOffset;
        const block = bytes.subarray(start, start + annSig.samplesPerRecord * 2);
        out.push(...parseTals(block, r0 + rec));
      }
      onProgress?.(r1 / h.nRecords);
    }
    return out;
  }
}
