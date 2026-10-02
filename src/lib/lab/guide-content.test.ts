// Keeps the EEG Lab authoring guide in step with the Lab form and the renderer.
// Run: npx tsx --test src/lib/lab/guide-content.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import coverage from "./guide-coverage.json";
import {
  AGE_DEFAULTS_NOTE, AGE_DEFAULTS_TABLE, GUIDE_INTRO, GUIDE_LIMITS, GUIDE_READING_NOTES, GUIDE_RENDERER_VERSION,
  GUIDE_SECTIONS, GUIDE_WALKTHROUGHS, type GuideControl,
} from "./guide-content";
import {
  ACNS_PATTERNS, ACNS_PLUS, ACNS_PREVALENCE, AGE_BACKGROUND_DEFAULTS, AGE_BANDS, backgroundDefaults, defaultGuidedScenario,
  withBackgroundDefaults, ARTIFACT_KINDS, BACKGROUND_TYPES, CHANNEL_SETS, CLINICAL_STATES,
  DISCHARGE_FOCI, DISCHARGE_MORPHOLOGIES, DURATION_MAX_MINUTES, DURATION_MIN_MINUTES, EVENT_TYPE_LABELS,
  GENERALIZED_SEIZURE_TYPES, MONTAGES, ONSET_PATTERNS, PROVOCATIONS, REGIONS, SAMPLE_RATES, SEDATION_AGENTS,
  SPEC_VERSIONS, SPREADS, STIMULI,
} from "./spec";
import { LAB_FORMATS, LAB_MMX_PRESETS, LAB_PERSYST_PANELS, type GuidedEvent, type GuidedScenario } from "./types";

// Option lists that exist only as types in types.ts. `exhaustive` fails `tsc --noEmit` when the type gains a member
// this list does not name, so a new Guided-form choice cannot slip past the guide.
type Ev<T extends GuidedEvent["type"]> = Extract<GuidedEvent, { type: T }>;
type Exhaustive<U, L extends readonly U[]> = [Exclude<U, L[number]>] extends [never] ? L : never;
function exhaustive<U>() {
  return <const L extends readonly U[]>(list: Exhaustive<U, L>): readonly string[] => list as readonly string[];
}
const STATE_TO = exhaustive<Ev<"state_change">["to"]>()(["sleep", "wake", "arousal", "rem", "drowsy", "sedated", "comatose"]);
const REACTIVITY = exhaustive<GuidedScenario["background"]["reactivity"]>()(["present", "absent"]);
const SEDATION_DIRECTION = exhaustive<Ev<"sedation_change">["direction"]>()(["increase", "decrease"]);
const ATTENUATION_SIDE = exhaustive<Ev<"attenuation_transient">["side"]>()(["both", "left", "right"]);
const ARTIFACT_SIDE = exhaustive<Ev<"artifact">["side"]>()(["all", "left", "right"]);
const ARTIFACT_INTENSITY = exhaustive<Ev<"artifact">["intensity"]>()(["low", "medium", "high"]);

const ids = (list: { id: string | number }[]) => list.map((x) => String(x.id));

/** Every Lab option list, by the `optionSet` name a guide control uses to document it. */
const LAB_OPTION_SETS: Record<string, readonly string[]> = {
  AGE_BANDS: ids(AGE_BANDS),
  CHANNEL_SETS: ids(CHANNEL_SETS),
  MONTAGES: ids(MONTAGES),
  SAMPLE_RATES: SAMPLE_RATES.map(String),
  EDITIONS: ids(SPEC_VERSIONS),
  LAB_FORMATS: ids(LAB_FORMATS),
  PERSYST: [...LAB_MMX_PRESETS, ...LAB_PERSYST_PANELS],
  BACKGROUND_TYPES: ids(BACKGROUND_TYPES),
  CLINICAL_STATES,
  REACTIVITY,
  REGIONS,
  SPREADS,
  ONSET_PATTERNS: ids(ONSET_PATTERNS),
  GENERALIZED_SEIZURE_TYPES: ids(GENERALIZED_SEIZURE_TYPES),
  PROVOCATIONS,
  ACNS_PATTERNS: ids(ACNS_PATTERNS),
  ACNS_PLUS,
  ACNS_PREVALENCE,
  DISCHARGE_FOCI,
  DISCHARGE_MORPHOLOGIES,
  STIMULI,
  SEDATION_AGENTS,
  SEDATION_DIRECTION,
  ATTENUATION_SIDE,
  ARTIFACT_KINDS,
  ARTIFACT_OPTIONS: [...ARTIFACT_SIDE, ...ARTIFACT_INTENSITY],
  STATE_TO,
};

const controls: GuideControl[] = GUIDE_SECTIONS.flatMap((s) => s.controls);

test("every Lab option list is described by a guide control", () => {
  for (const [set, values] of Object.entries(LAB_OPTION_SETS)) {
    const documented = controls.filter((c) => c.optionSet === set).flatMap((c) => (c.options ?? []).map((x) => x.value));
    assert.ok(documented.length > 0, `no guide control documents the Lab option list ${set}`);
    const missing = values.filter((v) => !documented.includes(v));
    assert.deepEqual(missing, [], `guide is missing ${set} option(s): ${missing.join(", ")}`);
  }
  // every optionSet a control names must be a real Lab list (catches a typo that would silently skip the check)
  for (const c of controls) if (c.optionSet && c.optionSet !== "DURATION") assert.ok(c.optionSet in LAB_OPTION_SETS, c.optionSet);
});

test("the guide states the Lab's recording-length limits", () => {
  const c = controls.find((x) => x.optionSet === "DURATION");
  assert.ok(c?.range, "recording length control has no range");
  assert.match(c.range, new RegExp(`\\b${DURATION_MIN_MINUTES}\\b`));
  assert.match(c.range, new RegExp(`\\b${DURATION_MAX_MINUTES}\\b`));
});

test("every Guided-form event type has a guide control marked as in the form", () => {
  for (const type of Object.keys(EVENT_TYPE_LABELS)) {
    assert.ok(controls.some((c) => c.where === "form" && c.names.includes(`event:${type}`)), `guide has no form control for event ${type}`);
  }
});

test("every renderer event type and background setting in guide-coverage.json is described", () => {
  const names = new Set(controls.flatMap((c) => c.names));
  for (const t of coverage.eventTypes) assert.ok(names.has(`event:${t}`), `guide does not describe event type ${t}`);
  for (const f of coverage.backgroundFields) assert.ok(names.has(`bg:${f}`), `guide does not describe background setting ${f}`);
});

test("guide renderer version matches the renderer", () => {
  const init = readFileSync(path.resolve(__dirname, "../../../tools/eeg-render/eeg_render/__init__.py"), "utf8");
  const m = init.match(/^RENDERER_VERSION\s*=\s*["']([^"']+)["']/m);
  assert.ok(m, "RENDERER_VERSION not found in eeg_render/__init__.py");
  assert.equal(GUIDE_RENDERER_VERSION, m[1], "update src/lib/lab/guide-content.ts (and guide-coverage.json) for the new renderer version");
});

test("control ids are unique and every control says what it is, its default and how it looks", () => {
  assert.equal(new Set(controls.map((c) => c.id)).size, controls.length);
  assert.equal(new Set(GUIDE_SECTIONS.map((s) => s.id)).size, GUIDE_SECTIONS.length);
  for (const c of controls) for (const f of ["name", "what", "defaultText", "onPage"] as const) assert.ok(c[f].trim(), `${c.id}.${f}`);
});

test("the guide's age table equals the Guided form's background defaults", () => {
  assert.deepEqual(AGE_DEFAULTS_TABLE.map((r) => r.id), AGE_BANDS.map((a) => a.id));
  for (const r of AGE_DEFAULTS_TABLE) {
    // each row documents the age's own background type at the current edition (3)
    const type = r.id === "neonate" ? "discontinuous" : "continuous";
    const d = backgroundDefaults(r.id, type, 3);
    assert.deepEqual([r.dominantHz, r.amplitudeUv, r.slowFraction], [d.dominantHz, d.amplitudeUv, d.slowFraction], `age table row ${r.id}`);
    // and the form fills exactly those values when the author picks that age at edition 3
    const base = defaultGuidedScenario();
    const g = withBackgroundDefaults({ ...base, specVersion: 3, ageBand: r.id, background: { ...base.background, type } });
    assert.deepEqual([g.background.dominantHz, g.background.amplitudeUv, g.background.slowFraction],
      [r.dominantHz, r.amplitudeUv, r.slowFraction], `form defaults for ${r.id}`);
  }
  // the child row's note for other background types must match the age preset
  const childNote = AGE_DEFAULTS_TABLE.find((r) => r.id === "child")?.amplitudeNote ?? "";
  assert.ok(childNote.includes(`${AGE_BACKGROUND_DEFAULTS.child.amplitudeUv} µV`), childNote);
  assert.equal(backgroundDefaults("child", "burst_suppression", 3).amplitudeUv, AGE_BACKGROUND_DEFAULTS.child.amplitudeUv);
});

test("an author's own background value is kept when the age changes", () => {
  const base = defaultGuidedScenario();
  const edited = { ...base, specVersion: 3 as const, background: { ...base.background, amplitudeUv: 60, edited: ["amplitudeUv" as const] } };
  const g = withBackgroundDefaults({ ...edited, ageBand: "adult" });
  assert.equal(g.background.amplitudeUv, 60);
  assert.equal(g.background.dominantHz, AGE_BACKGROUND_DEFAULTS.adult.dominantHz);
});

test("reader-facing text avoids programming vocabulary", () => {
  const prose: string[] = [...GUIDE_INTRO, ...GUIDE_READING_NOTES, ...GUIDE_LIMITS, AGE_DEFAULTS_NOTE];
  for (const r of AGE_DEFAULTS_TABLE) prose.push(r.age, r.amplitudeNote ?? "", r.background, r.blinks);
  for (const s of GUIDE_SECTIONS) {
    prose.push(s.title, s.summary, ...s.intro, ...(s.notes ?? []));
    for (const c of s.controls) {
      prose.push(c.name, c.what, c.range ?? "", c.defaultText, c.onPage, c.onTrends ?? "");
      for (const x of c.options ?? []) prose.push(x.label, x.text);
    }
  }
  for (const w of GUIDE_WALKTHROUGHS) {
    prose.push(w.title, w.teaches, ...w.expect);
    for (const st of w.steps) prose.push(st.label, st.detail);
  }
  const banned = /\b(spec|specs|schema|json|yaml|normali[sz]\w*|keys?|keyed|enums?|seeds?|worker|v[123])\b/i;
  for (const text of prose) {
    const cleaned = text.replace(/answer key/gi, "");
    assert.doesNotMatch(cleaned, banned, `jargon in guide text: "${text}"`);
  }
});
