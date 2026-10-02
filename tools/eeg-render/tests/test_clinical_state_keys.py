import numpy as np

from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer
from eeg_render.export.manifest import realized_events


def test_clinical_state_keys_tile_transitions_without_fake_sleep():
    states = ["drowsy", "sleep", "sedated", "comatose", "wake"]
    img = {"kind": "eeg_page", "license": "synthetic-original", "spec": {
        "spec_version": 3, "seed": 30100111, "age_group": "adult", "duration_min": 6,
        "background": {"type": "continuous", "clinical_state": "awake", "sleep_staging": "static"},
        "events": [{"type": "state_change", "at_min": i + 1, "to": state} for i, state in enumerate(states)]}}
    syn = Synthesizer(normalize(img)["spec"], 360)
    rows = [r for r in realized_events(syn, 360) if r["kind"] == "state"]
    assert [r["label"] for r in rows] == ["awake", "drowsy", "asleep", "sedated", "comatose", "awake"]
    assert [r["onset_s"] for r in rows] == [0, 60, 120, 180, 240, 300]
    assert [r["offset_s"] for r in rows] == [60, 120, 180, 240, 300, 360]
    stages = [r for r in realized_events(syn, 360) if r["kind"] == "sleep_stage"]
    assert all(not (r["onset_s"] < 300 and r["offset_s"] > 180) for r in stages)


def test_coma_mimic_keys_stop_at_authored_recovery():
    img = {"kind": "eeg_page", "license": "synthetic-original", "spec": {
        "spec_version": 3, "seed": 30100112, "age_group": "adult", "duration_min": 4,
        "background": {"type": "continuous", "coma_pattern": "spindle"},
        "events": [{"type": "state_change", "at_min": 2, "to": "wake"}]}}
    syn = Synthesizer(normalize(img)["spec"], 240)
    rows = realized_events(syn, 240)
    assert [(r["label"], r["onset_s"], r["offset_s"]) for r in rows if r["kind"] == "state"] == [
        ("comatose", 0, 120), ("awake", 120, 240)]
    coma = [r for r in rows if r.get("label") == "spindle_coma"]
    assert coma and all(r["offset_s"] <= 120 for r in coma)
    assert all(r["spindles"] == 0 for r in rows if r["kind"] == "sleep_stage" and r["label"] == "W")
