import assert from "node:assert/strict";
import { test } from "node:test";
import { EEG_REFERENCES, matchEegFeatures } from "./eeg-reference";
const basis = (text: string, id: string) => matchEegFeatures(text).find((m) => m.id === id)?.basis;
test("stable reference IDs and source URLs", () => {
  assert.equal(new Set(EEG_REFERENCES.map((r) => r.id)).size, EEG_REFERENCES.length);
  for (const r of EEG_REFERENCES) { assert.match(r.id,/^[a-z0-9-]+$/); assert.equal(new URL(r.source.url).protocol,"https:"); }
});
test("mentions preserve uncertainty and negation", () => {
  assert.equal(basis("No RMTD.","rmtd"),"negated");
  assert.equal(basis("RMTD is absent.","rmtd"),"negated");
  assert.equal(basis("Possible RMTD.","rmtd"),"uncertain");
  assert.equal(basis("RMTD observed.","rmtd"),"mentioned");
  assert.equal(basis("No RMTD. RMTD later.","rmtd"),"uncertain");
  assert.equal(basis("disregard", "suppression-ratio"),undefined);
});
test("explicit editor tags take precedence and aliases normalize", () => {
  assert.equal(matchEegFeatures("No wickets",["wicket waves"]).find((m)=>m.id==="wickets")?.basis,"explicit_tag");
  assert.ok(matchEegFeatures("photic_driving").some((m)=>m.id==="photic-driving"));
  assert.ok(matchEegFeatures("fft_LL and total_power_R").some((m)=>m.id==="fft-spectrogram"));
});
