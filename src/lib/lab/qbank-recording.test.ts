import assert from "node:assert/strict";
import { test } from "node:test";
import { fullElectrodeNeonatalImage, qbankRecordingBlock, recordingDurationSeconds } from "./qbank-recording";

test("term neonatal composite exports a full electrode recording", () => {
  const block = qbankRecordingBlock({
    kind: "composite", license: "synthetic-original", spec: {
      seed: 1, age_group: "neonate", channels: "neonatal_reduced",
      qeeg_panel: { duration_min: 60, background: { type: "discontinuous", pma_weeks: 39 } },
      eeg_page: { montage: "neonatal_reduced" },
    },
  });
  assert.equal(block?.kind, "qeeg_panel");
  assert.equal((block?.spec as Record<string, unknown>).channels, "standard_19");
  assert.equal(recordingDurationSeconds(block!), 3600);
});

test("explicitly preterm neonatal recording can retain the reduced set", () => {
  const block = qbankRecordingBlock({
    kind: "qeeg_panel", license: "synthetic-original", spec: {
      seed: 1, age_group: "neonate", channels: "neonatal_9", duration_min: 30,
      background: { type: "discontinuous", pma_weeks: 31 },
    },
  });
  assert.equal((block?.spec as Record<string, unknown>).channels, "neonatal_9");
});

test("term neonatal image keeps its neonatal montage but uses full acquisition", () => {
  const image = fullElectrodeNeonatalImage({
    kind: "qeeg_panel", license: "synthetic-original", spec: {
      seed: 1, age_group: "neonate", channels: "neonatal_9", montage: "neonatal_reduced",
      duration_min: 30, background: { type: "discontinuous", pma_weeks: 37 },
    },
  });
  assert.equal((image?.spec as Record<string, unknown>).channels, "standard_19");
  assert.equal((image?.spec as Record<string, unknown>).montage, "neonatal_reduced");
});
