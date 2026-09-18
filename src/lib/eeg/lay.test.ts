import assert from "node:assert/strict";
import { test } from "node:test";
import { LayReader } from "./lay";
import { applyChain, DEFAULT_FILTERS, designChain } from "./filters";
import { applyMontage, buildMontage } from "./montage";

for (const dataType of [0, 7]) {
  test(`Persyst DataType=${dataType} decodes signed counts into calibrated microvolts`, async () => {
    const counts = [100, -200, -100, 200, 0, -1, 300, -300];
    const width = dataType === 7 ? 4 : 2;
    const buf = new ArrayBuffer(8 + counts.length * width);
    const view = new DataView(buf);
    counts.forEach((v, i) => {
      if (dataType === 7) view.setInt32(8 + i * width, v, true);
      else view.setInt16(8 + i * width, v, true);
    });
    const reader = await LayReader.open(`
[FileInfo]
SamplingRate=256
WaveformCount=2
Calibration=0.25
DataType=${dataType}
HeaderLength=8
[ChannelMap]
Fp1-Ref=1
F7-Ref=2
`, { size: buf.byteLength, read: async (offset, length) => buf.slice(offset, offset + length) });
    assert.equal(reader.durationS, 4 / 256);
    const win = await reader.readWindow(0, reader.durationS);
    assert.deepEqual(Array.from(win.data[0]), [25, -25, 0, 75]);
    assert.deepEqual(Array.from(win.data[1]), [-50, 50, -0.25, -75]);
    const partial = await reader.readWindow(1 / 256, 3 / 256);
    assert.deepEqual(Array.from(partial.data[1]), [50, -0.25]);
    const rows = win.data.map((r) => applyChain(Float32Array.from(r), designChain(256, DEFAULT_FILTERS)));
    const trace = applyMontage(rows, reader.labels, buildMontage("longitudinal_bipolar", reader.labels))[0];
    assert.ok(trace.every(Number.isFinite));
    assert.ok(trace.some((v) => Math.abs(v) > 1), "nonzero, drawable EEG survives filtering and montage");
  });
}

test("51-channel, 256 Hz DataType=7 recording uses the reported clinical calibration", async () => {
  // Synthetic samples; only the technical header values came from the reported file.
  const calibration = 0.00415373;
  const channels = 51;
  const samples = 2560;
  const buf = new ArrayBuffer(channels * samples * 4);
  const view = new DataView(buf);
  for (let i = 0; i < samples; i++) {
    const count = Math.round(50 * Math.sin(2 * Math.PI * 10 * i / 256) / calibration);
    for (let c = 0; c < channels; c++) view.setInt32((i * channels + c) * 4, c === 0 ? count : 0, true);
  }
  const names = ["Fp1-Ref", "F7-Ref", ...Array.from({ length: 49 }, (_, i) => `Ch${i + 3}`)];
  const reader = await LayReader.open(`
[FileInfo]
FileType=Interleaved
SamplingRate=256
HeaderLength=0
Calibration=${calibration}
WaveformCount=51
DataType=7
[ChannelMap]
${names.map((name, i) => `${name}=${i + 1}`).join("\n")}
`, { size: buf.byteLength, read: async (offset, length) => buf.slice(offset, offset + length) });
  assert.equal(reader.durationS, 10);
  const win = await reader.readWindow(0, 10);
  assert.equal(win.data.length, 51);
  assert.ok(Math.abs(Math.max(...win.data[0]) - 50) <= calibration);
  assert.ok(Math.abs(Math.min(...win.data[0]) + 50) <= calibration);
  const filtered = win.data.map((r) => applyChain(Float32Array.from(r), designChain(256, DEFAULT_FILTERS)));
  const trace = applyMontage(filtered, reader.labels, buildMontage("longitudinal_bipolar", reader.labels))[0];
  assert.ok(trace.every(Number.isFinite));
  assert.ok(Math.max(...trace.subarray(512)) > 40);
  assert.ok(Math.min(...trace.subarray(512)) < -40);
});
