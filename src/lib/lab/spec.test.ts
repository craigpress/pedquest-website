import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EVENT_TYPE_LABELS, WORKER_MAX_SPEC_VERSION, buildSpecFromGuided, defaultEvent, defaultGuidedScenario,
  requiredSpecVersion, validateLabSpec,
} from "./spec";
import { validateLabSpecStrict } from "./spec-server";
import type { GuidedEvent } from "./types";

const base = (spec: Record<string, unknown>) => ({
  kind: "qeeg_panel", license: "synthetic-original", attribution: null,
  spec: {
    seed: 7, age_group: "child", duration_min: 60,
    background: { type: "continuous", dominant_hz: 8, amplitude_uv: 40 },
    ...spec,
  },
});

test("clinical states build and validate independently of cerebral reactivity", () => {
  const g = defaultGuidedScenario();
  g.background.clinicalState = "comatose";
  g.background.reactivity = "present";
  g.events = [{ id: "clinical-transition", type: "state_change", atMin: 10, to: "drowsy" }];
  assert.equal(requiredSpecVersion(g), 3);
  const block = buildSpecFromGuided(g) as { spec: { background: Record<string, unknown>; events: Record<string, unknown>[] } };
  assert.equal(block.spec.background.clinical_state, "comatose");
  assert.equal(block.spec.background.reactivity, "present");
  assert.equal(block.spec.events[0].to, "drowsy");
  assert.deepEqual(validateLabSpec(block).errors, []);

  for (const clinical_state of ["awake", "drowsy", "asleep", "sedated", "comatose"]) {
    const background = { type: "continuous", dominant_hz: 8, amplitude_uv: 40, clinical_state, reactivity: "absent" };
    assert.ok(validateLabSpec(base({ spec_version: 3, background })).ok);
    assert.ok(validateLabSpec(base({ spec_version: 2, background })).errors.some(e => e.includes("needs spec_version 3")));
  }
  for (const to of ["drowsy", "sedated", "comatose"]) {
    assert.ok(validateLabSpec(base({ spec_version: 3, events: [{ type: "state_change", at_min: 10, to }] })).ok);
    assert.ok(validateLabSpec(base({ spec_version: 2, events: [{ type: "state_change", at_min: 10, to }] })).errors.some(e => e.includes("needs spec_version 3")));
  }
  assert.ok(!validateLabSpec(base({ spec_version: 3, background: { type: "continuous", clinical_state: "indeterminate" } })).ok);
  const older = { ...defaultGuidedScenario(), specVersion: undefined };
  const legacy = buildSpecFromGuided(older) as { spec: { background: Record<string, unknown> } };
  assert.equal("clinical_state" in legacy.spec.background, false);
});

test("v3-only event types and montages need spec_version 3", () => {
  const gen = { type: "generalized_seizure", onset_min: 10, seizure_type: "typical_absence" };
  const v1 = validateLabSpec(base({ events: [gen] }));
  assert.equal(v1.ok, false);
  assert.ok(v1.errors.some((e) => e.includes("needs spec_version 3")));

  const v3 = validateLabSpec(base({ spec_version: 3, events: [gen] }));
  assert.equal(v3.ok, true, v3.errors.join("; "));
  if (WORKER_MAX_SPEC_VERSION < 3) assert.ok(v3.warnings.some((w) => w.includes("eeg-render 0.5.0")));

  assert.ok(validateLabSpec(base({ montage: "grapefruit", events: [] })).errors.some((e) => e.includes("needs spec_version 3")));
  assert.ok(validateLabSpec(base({ spec_version: 3, montage: "hatband", events: [] })).ok);
  assert.ok(validateLabSpec(base({ spec_version: 4 })).errors.some((e) => e.includes("spec_version")));
});

test("the renderer's newer event types are known, and untimed ones need no onset", () => {
  const v = validateLabSpec(base({
    spec_version: 3,
    events: [
      { type: "sporadic_discharges", focus: "T3", rate_per_h: 60 },
      { type: "generalized_discharges", pattern: "eses" },
      { type: "spasm_cluster", at_min: 5, count: 10 },
      { type: "normal_variant", kind: "wicket", at_min: 3 },
      { type: "artifact", kind: "glossokinetic", at_min: 4, duration_s: 10 },
      { type: "state_change", at_min: 20, to: "rem" },
    ],
  }));
  assert.deepEqual(v.errors, []);
  const bad = validateLabSpec(base({ events: [{ type: "artifact", kind: "wicket", at_min: 1 }] }));
  assert.ok(bad.errors.some((e) => e.includes("normal_variant")));
});

test("ACNS keys below spec_version 3 are warned as not synthesized; v3 gets the ACNS advisories", () => {
  const rpp = { type: "rhythmic_pattern", onset_min: 5, pattern: "BIRDs", frequency_hz: 3, run_duration_s: 12, prevalence: "rare" };
  const v1 = validateLabSpec(base({ events: [rpp] }));
  assert.ok(v1.warnings.some((w) => w.includes("not synthesized below spec_version 3")));
  const v3 = validateLabSpec(base({ spec_version: 3, events: [rpp, { type: "rhythmic_pattern", onset_min: 9, pattern: "SIRPIDs" }] }));
  assert.ok(v3.warnings.some((w) => w.includes("> 4 Hz")));
  assert.ok(v3.warnings.some((w) => w.includes("< 10 s")));
  assert.ok(v3.warnings.some((w) => w.includes("without a stimulation event")));
});

test("strict validation adds the renderer schema: an unknown key is an error", () => {
  const typo = validateLabSpecStrict(base({ events: [{ type: "seizure", onset_min: 5, duration_s: 60, onset_regoin: "left_temporal" }] }));
  assert.equal(typo.ok, false);
  assert.ok(typo.errors.some((e) => e.startsWith("Renderer schema:") && e.includes("onset_regoin")), typo.errors.join("; "));
  const ok = validateLabSpecStrict(base({ spec_version: 3, events: [{ type: "generalized_seizure", onset_min: 5, seizure_type: "gtc" }] }));
  assert.deepEqual(ok.errors, []);
});

test("new variant and SeLECTS timing controls warn when the selected renderer version ignores them", () => {
  const controls = {
    background: { type: "continuous", dominant_hz: 8, amplitude_uv: 40, variants: { posts: { interval_s: 1.7 } } },
    style: { spindle_topography: "central", k_complex_spindle_delay_s: 1.5 },
    events: [
      { type: "normal_variant", kind: "mu", at_min: 2, train_duration_s: 9 },
      { type: "sporadic_discharges", focus: "right_centrotemporal", centrotemporal_triphasic: true },
      { type: "normal_variant", kind: "midline_theta", at_min: 3 },
    ],
  };
  for (const version of [1, 2]) {
    const result = validateLabSpecStrict(base({ ...controls, spec_version: version }));
    assert.deepEqual(result.errors, []);
    for (const key of ["background.variants.posts.interval_s", "events[0].train_duration_s", "events[1].centrotemporal_triphasic",
      "style.spindle_topography", "style.k_complex_spindle_delay_s"]) {
      assert.ok(result.warnings.some((warning) => warning.includes(key) && warning.includes("not synthesized below spec_version 3")));
    }
    assert.ok(!result.warnings.some((warning) => warning.includes("midline_theta")), "Ciganek itself remains available to legacy specs");
  }
  const current = validateLabSpecStrict(base({ ...controls, spec_version: 3 }));
  assert.deepEqual(current.errors, []);
  assert.ok(!current.warnings.some((warning) => warning.includes("not synthesized below spec_version 3")));
});

test("optional spindle field and K-complex timing controls enforce their authoring bounds", () => {
  for (const delay of [1, 5]) {
    assert.ok(validateLabSpecStrict(base({ spec_version: 3, style: {
      spindle_topography: "central", k_complex_spindle_delay_s: delay,
    } })).ok);
  }
  for (const style of [{ spindle_topography: "temporal" }, { k_complex_spindle_delay_s: 0.5 },
    { k_complex_spindle_delay_s: 5.5 }]) {
    assert.ok(!validateLabSpecStrict(base({ spec_version: 3, style })).ok);
  }
});

// Deliberate change (renderer 0.5.0 rollout, WORKER_MAX_SPEC_VERSION 3, bank migrating to v3): a NEW form starts
// at spec_version 3, so a fresh child form shows the 90-uV awake default. This test used to require no
// spec_version on a plain new form, written when the worker accepted only up to 2. A scenario without
// specVersion (an older client or saved request) must still build exactly as before.
test("a new guided form starts at spec_version 3; a scenario without specVersion still omits it", () => {
  const fresh = { ...defaultGuidedScenario(), events: [defaultEvent("seizure", 120)] };
  const block = buildSpecFromGuided(fresh) as { spec: Record<string, unknown> };
  assert.equal(block.spec.spec_version, 3);
  assert.equal(fresh.background.amplitudeUv, 90);
  assert.equal(requiredSpecVersion(fresh), 1);

  const older = { ...fresh, specVersion: undefined };
  const legacy = buildSpecFromGuided(older) as { spec: Record<string, unknown> };
  assert.equal("spec_version" in legacy.spec, false);
});

test("every guided event type builds a spec the renderer schema accepts, and v3 choices raise spec_version", () => {
  const types = Object.keys(EVENT_TYPE_LABELS) as GuidedEvent["type"][];
  const g = { ...defaultGuidedScenario(), events: types.map((t) => defaultEvent(t, 120)) };
  assert.equal(requiredSpecVersion(g), 3);
  const block = buildSpecFromGuided(g) as { spec: Record<string, unknown> };
  assert.equal(block.spec.spec_version, 3);
  const v = validateLabSpecStrict(block, { durationS: 120 * 60 });
  assert.deepEqual(v.errors, []);

  const onset = { ...defaultGuidedScenario(), events: [{ ...defaultEvent("seizure", 120), onsetPattern: "rhythmic_theta" as const }] };
  const built = buildSpecFromGuided(onset) as { spec: { events: Record<string, unknown>[]; spec_version?: number } };
  assert.equal(built.spec.spec_version, 3);
  assert.equal(built.spec.events[0].onset_pattern, "rhythmic_theta");
});
