// Persyst .lay / .dat reader.
//
// The .lay is an INI file; the .dat is raw interleaved samples with no header
// of its own (HeaderLength bytes to skip, usually 0). Written to match
// tools/eeg-render/eeg_render/export/persyst.py and Persyst's own sample
// (SK000.LAY): inline or index-ordered [ChannelMap], DataType 0 = int16 counts
// scaled by Calibration (µV per count), DataType 7 = int32 counts with the same scale.
//
// [Comments] rows are `time,duration,state,type,text`, time in seconds from
// the start of the recording. That block is also how Persyst carries a
// reviewer's marks, so `mergeLayComments` writes a per-user copy of the .lay
// that opens in Persyst with the learner's annotations on the timeline. The
// .dat is never rewritten.
//
// `state` and `type` do not change how Persyst classifies a comment (PQW-093,
// verified 2026-09-13 in Persyst against a 15-row probe covering types 0-4,
// 256, 4096, 32768, 65536, 65537, 131072 and states 0-2): every row appeared in
// the Comments pane as `Origin: User-Persyst`, an ordinary reviewer comment,
// none as a detector event, and `duration` was honoured as a span (0 = point).
// So the 65536 written for learner marks and for the exporter's realized events
// is safe as is.

import type { ByteSource, EdfAnnotation, SignalWindow } from "./edf";
import type { Recording, RecordingInfo } from "./recording";

export interface LayComment {
  onsetS: number;
  durationS: number;
  state: number;
  type: number;
  text: string;
}

export interface LayFile {
  fileInfo: Record<string, string>;
  channelMap: string[];          // binary order
  patient: Record<string, string>;
  comments: LayComment[];
  sampleRate: number;
  calibration: number;
  dataType: number;
  headerLength: number;
  /** all sections verbatim, for re-emitting */
  sections: { name: string; lines: string[] }[];
}

export function parseLay(text: string): LayFile {
  const sections: { name: string; lines: string[] }[] = [];
  let cur: { name: string; lines: string[] } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^﻿/, "");
    const m = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (m) { cur = { name: m[1], lines: [] }; sections.push(cur); continue; }
    if (cur && line.trim().length) cur.lines.push(line);
  }
  const kv = (name: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const l of sections.find((s) => s.name.toLowerCase() === name.toLowerCase())?.lines ?? []) {
      const i = l.indexOf("=");
      if (i > 0) out[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    }
    return out;
  };
  const fileInfo = kv("FileInfo");
  const patient = kv("Patient");

  // ChannelMap: `Name=index` (1-based). Order by index; fall back to insertion.
  const mapLines = sections.find((s) => s.name.toLowerCase() === "channelmap")?.lines ?? [];
  const entries = mapLines.map((l, order) => {
    const i = l.indexOf("=");
    const name = (i > 0 ? l.slice(0, i) : l).trim();
    const idx = i > 0 ? parseInt(l.slice(i + 1), 10) : NaN;
    return { name, idx: Number.isFinite(idx) ? idx : order + 1 };
  });
  entries.sort((a, b) => a.idx - b.idx);
  let channelMap = entries.map((e) => e.name);
  const waveformCount = parseInt(fileInfo.WaveformCount ?? "", 10);
  if (Number.isFinite(waveformCount) && waveformCount > 0) {
    if (channelMap.length > waveformCount) channelMap = channelMap.slice(0, waveformCount);
    while (channelMap.length < waveformCount) channelMap.push(`Ch${channelMap.length + 1}`);
  }

  const comments: LayComment[] = [];
  for (const l of sections.find((s) => s.name.toLowerCase() === "comments")?.lines ?? []) {
    const c = parseLayComment(l);
    if (c) comments.push(c);
  }

  return {
    fileInfo, channelMap, patient, comments, sections,
    sampleRate: parseFloat(fileInfo.SamplingRate ?? "0") || 0,
    calibration: parseFloat(fileInfo.Calibration ?? "1") || 1,
    dataType: parseInt(fileInfo.DataType ?? "0", 10) || 0,
    headerLength: parseInt(fileInfo.HeaderLength ?? "0", 10) || 0,
  };
}

export function parseLayComment(line: string): LayComment | null {
  const parts = line.split(",");
  if (parts.length < 5) return null;
  const onsetS = parseFloat(parts[0]), durationS = parseFloat(parts[1]);
  if (!Number.isFinite(onsetS)) return null;
  return {
    onsetS,
    durationS: Number.isFinite(durationS) ? durationS : 0,
    state: parseInt(parts[2], 10) || 0,
    type: parseInt(parts[3], 10) || 0,
    text: parts.slice(4).join(",").trim(),
  };
}

export function formatLayComment(c: LayComment): string {
  // Persyst's own grammar; a comma inside the text is fine because readers
  // split on the first four commas only.
  return `${c.onsetS.toFixed(6)},${c.durationS.toFixed(6)},${c.state},${c.type},${c.text.replace(/[\r\n]+/g, " ")}`;
}

/**
 * Re-emit the .lay with `[Comments]` = the original comments (bedside notes)
 * plus `extra`, sorted by onset. Every other section is copied verbatim, so
 * the result still points at the same .dat.
 */
export function mergeLayComments(lay: LayFile, extra: LayComment[]): string {
  const all = [...lay.comments, ...extra].sort((a, b) => a.onsetS - b.onsetS);
  const out: string[] = [];
  let wroteComments = false;
  for (const s of lay.sections) {
    out.push(`[${s.name}]`);
    if (s.name.toLowerCase() === "comments") {
      out.push(...all.map(formatLayComment));
      wroteComments = true;
    } else {
      out.push(...s.lines);
    }
    out.push("");
  }
  if (!wroteComments) { out.push("[Comments]", ...all.map(formatLayComment), ""); }
  return out.join("\r\n");
}

function parseStart(p: Record<string, string>): Date | null {
  const d = /(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(p.TestDate ?? "");
  const t = /(\d{1,2}):(\d{2}):(\d{2})/.exec(p.TestTime ?? "");
  if (!d) return null;
  return new Date(+d[1], +d[2] - 1, +d[3], t ? +t[1] : 0, t ? +t[2] : 0, t ? +t[3] : 0);
}

export class LayReader implements Recording {
  readonly durationS: number;
  readonly sampleRate: number;
  readonly labels: string[];
  readonly info: RecordingInfo;
  readonly annotationsUpFront = true;
  private readonly bytesPerSample: number;
  private readonly frameBytes: number;

  constructor(readonly lay: LayFile, private readonly dat: ByteSource) {
    if (!(lay.sampleRate > 0)) throw new Error("The .lay declares no SamplingRate.");
    if (!lay.channelMap.length) throw new Error("The .lay has no [ChannelMap].");
    if (lay.dataType !== 0 && lay.dataType !== 7) {
      throw new Error(`Unsupported Persyst DataType=${lay.dataType} (only 0 = int16 and 7 = int32).`);
    }
    this.sampleRate = lay.sampleRate;
    this.labels = lay.channelMap.slice();
    this.bytesPerSample = lay.dataType === 7 ? 4 : 2;
    this.frameBytes = this.labels.length * this.bytesPerSample;
    const nFrames = Math.floor((dat.size - lay.headerLength) / this.frameBytes);
    this.durationS = nFrames / this.sampleRate;
    const p = lay.patient;
    this.info = {
      format: "Persyst .lay/.dat",
      startDateTime: parseStart(p),
      patient: [p.First, p.Last, p.ID ? `(${p.ID})` : ""].filter(Boolean).join(" "),
      notes: Object.entries(p).filter(([k]) => /^Comments\d*$/i.test(k)).map(([, v]) => v),
    };
  }

  static async open(layText: string, dat: ByteSource): Promise<LayReader> {
    return new LayReader(parseLay(layText), dat);
  }

  async readWindow(t0: number, t1: number): Promise<SignalWindow> {
    const fs = this.sampleRate;
    const t0c = Math.max(0, Math.min(t0, this.durationS));
    const t1c = Math.max(t0c, Math.min(t1, this.durationS));
    const s0 = Math.round(t0c * fs);
    const n = Math.max(0, Math.round((t1c - t0c) * fs));
    const buf = await this.dat.read(this.lay.headerLength + s0 * this.frameBytes, n * this.frameBytes);
    const view = new DataView(buf);
    const nCh = this.labels.length;
    const got = Math.floor(buf.byteLength / this.frameBytes);
    const data = this.labels.map(() => new Float32Array(n));
    const cal = this.lay.calibration;
    if (this.lay.dataType === 7) {
      for (let i = 0; i < got; i++) for (let c = 0; c < nCh; c++) data[c][i] = view.getInt32((i * nCh + c) * 4, true) * cal;
    } else {
      for (let i = 0; i < got; i++) for (let c = 0; c < nCh; c++) data[c][i] = view.getInt16((i * nCh + c) * 2, true) * cal;
    }
    const annotations = this.lay.comments
      .filter((c) => c.onsetS < t1c && c.onsetS + c.durationS >= t0c)
      .map(toAnnotation);
    return { t0: s0 / fs, sampleRate: fs, data, labels: this.labels, annotations };
  }

  async scanAnnotations(onProgress?: (frac: number) => void): Promise<EdfAnnotation[]> {
    onProgress?.(1);
    return this.lay.comments.map(toAnnotation);
  }
}

function toAnnotation(c: LayComment): EdfAnnotation {
  return { onsetS: c.onsetS, durationS: c.durationS > 0 ? c.durationS : null, text: c.text, record: 0 };
}
