"""The EEG Lab authoring guide (/admin/eeg-lab/guide) must describe every authorable event type and background setting.

The guide's coverage list is src/lib/lab/guide-coverage.json; src/lib/lab/guide-content.test.ts checks that the guide
text covers every entry of that list.  This test closes the loop from the renderer side: adding an event type or a
background setting to schema.py, or bumping RENDERER_VERSION, fails here until the guide is updated.
"""
import json
from pathlib import Path

from eeg_render import RENDERER_VERSION
from eeg_render import schema

COVERAGE = Path(__file__).resolve().parents[3] / "src" / "lib" / "lab" / "guide-coverage.json"
HINT = "update src/lib/lab/guide-content.ts and src/lib/lab/guide-coverage.json"


def _coverage():
    return json.loads(COVERAGE.read_text(encoding="utf-8"))


def test_every_event_type_is_covered():
    missing = sorted(set(schema._EVENT["properties"]["type"]["enum"]) - set(_coverage()["eventTypes"]))
    assert not missing, f"event types missing from the guide ({HINT}): {missing}"


def test_every_background_setting_is_covered():
    missing = sorted(set(schema._BACKGROUND["properties"]) - set(_coverage()["backgroundFields"]))
    assert not missing, f"background settings missing from the guide ({HINT}): {missing}"


def test_guide_renderer_version_matches():
    assert _coverage()["rendererVersion"] == RENDERER_VERSION, HINT
