import assert from "node:assert/strict";
import { test } from "node:test";
import { signEeglabUrl } from "./eeglab-store";

test("signed evidence URLs tolerate surrounding configuration whitespace", () => {
  const original = { ...process.env };
  try {
    process.env.EEG_LAB_URL_SECRET = "test-only-secret";
    process.env.EEG_LAB_BASE_URL = "https://example.invalid";
    const expected = signEeglabUrl("eeglab://fixture/qa-raw-1.png", 60, 0);
    process.env.EEG_LAB_BASE_URL = " https://example.invalid/\r\n";
    const actual = signEeglabUrl("eeglab://fixture/qa-raw-1.png", 60, 0);
    assert.equal(actual, expected);
    assert.equal(new URL(actual).pathname, "/fixture/qa-raw-1.png");
  } finally {
    process.env = original;
  }
});
