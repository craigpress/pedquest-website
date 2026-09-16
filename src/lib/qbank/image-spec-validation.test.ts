import assert from "node:assert/strict";
import { test } from "node:test";
import { validateRenderImage } from "./image-spec-validation";

test("revision validation rejects renderer-unknown neonatal margin fields", () => {
  const errors = validateRenderImage({
    kind: "qeeg_panel", license: "synthetic-original", attribution: null,
    spec: {
      seed: 1, age_group: "neonate", channels: "standard_19", duration_min: 60,
      background: {
        type: "discontinuous", dominant_hz: 2, amplitude_uv: 70,
        aeeg_lower_margin_uv: 8, aeeg_upper_margin_uv: 35,
      },
    },
  });
  assert.ok(errors.some((error) => error.includes("additional properties")));
});
