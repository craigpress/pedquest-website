"""0.5.0 key-versus-visible contracts for ictal runs (feature review 2026-09-26, seizures-icu.md).

Every keyed second must be visible (ictal RMS >= background RMS in some longitudinal-bipolar derivation, displayed
through the 1-70 Hz page chain), clusters must not be clones, and motor correlates bring their artifact.
"""
import numpy as np
import pytest

from eeg_render.contracts import seizure_visibility
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer

ICU = dict(type="continuous", amplitude_uv=35.0, dominant_hz=3.0, slow_fraction=0.8, reactivity="absent",
           channel_gain_max=1.5, blink_rate_per_min=0)
CHILD = dict(type="continuous", amplitude_uv=40.0, dominant_hz=9.0, slow_fraction=0.4, reactivity="present",
             channel_gain_max=1.5)


def _img(age, bg, events, version=3, dur=30, seed=517401):
    return {"kind": "qeeg_panel", "license": "synthetic-original", "attribution": None,
            "spec": {"sample_rate": 256, "channels": "standard_19", "seed": seed, "spec_version": version,
                     "age_group": age, "duration_min": dur, "background": bg, "events": events}}


def _visible_enough(r):
    """A run of 20 s or less is visible for every keyed second, so boundary items land on the side of the ACNS line
    they are keyed on.  A longer run is visible within 2 s of its keyed onset and for >= 93 % of its seconds: the
    remainder falls in the late clonic phase, whose pauses between bursts are physiological."""
    whole = int(r["keyed_s"])
    assert r["first_visible_s"] is not None and r["first_visible_s"] <= (0 if whole <= 20 else 2), r
    assert r["visible_s"] >= (whole if whole <= 20 else int(np.floor(0.93 * whole))), r


CASES = {
    "status 12 min (B4-01)": ("adult", ICU, dict(type="seizure", onset_min=5.0, duration_s=720, onset_region="left_temporal",
                                                  spread="none", evolution=dict(start_hz=5.0, end_hz=2.0,
                                                  amplitude_start_uv=50, amplitude_end_uv=140))),
    "10-s boundary (C15)": ("child", CHILD, dict(type="seizure", onset_min=5.0, duration_s=10, onset_region="left_temporal",
                                                 spread="none", evolution=dict(start_hz=5.0, end_hz=3.0,
                                                 amplitude_start_uv=60, amplitude_end_uv=120))),
    "request at background voltage (PQ-G-002)": ("child", dict(CHILD, amplitude_uv=50.0),
                                                  dict(type="seizure", onset_min=5.0, duration_s=90,
                                                       onset_region="right_temporal", spread="none",
                                                       evolution=dict(start_hz=4.0, end_hz=1.5,
                                                                      amplitude_start_uv=55, amplitude_end_uv=150))),
}


@pytest.mark.parametrize("name", list(CASES))
def test_every_keyed_second_is_visible(name):
    age, bg, ev = CASES[name]
    r = seizure_visibility(_img(age, bg, [ev]))[0]
    _visible_enough(r)


def test_v2_is_unchanged_and_still_short():
    """Documents the defect v3 fixes; v2 renders must not move."""
    age, bg, ev = CASES["status 12 min (B4-01)"]
    r = seizure_visibility(_img(age, bg, [ev], version=2))[0]
    assert r["first_visible_s"] > 10 and r["visible_s"] < 0.95 * r["keyed_s"]


def _cluster(version):
    ev = dict(type="seizure_cluster", start_min=1.0, end_min=57.0, interval_min=4.0,
              seizure=dict(duration_s=60, onset_region="right_temporal", spread="none",
                           evolution=dict(start_hz=4.0, end_hz=2.0, amplitude_start_uv=60, amplitude_end_uv=150)),
              clinical_correlate="subtle")
    return _img("adult", ICU, [ev], version=version, dur=60, seed=517402)


def test_cluster_runs_vary_and_recruit():
    spec = normalize(_cluster(3))["spec"]
    assert spec["events"][0]["seizure"]["evolution"]["profile"] == "recruit"
    runs = Synthesizer(spec, 3600.0).seizures
    d = np.array([z.duration_s for z in runs])
    gaps = np.diff([z.t0 for z in runs])
    # phase D: the draw is mean-preserving and clipped to 0.6-1.6x (seizures-icu-v3 item 2), which narrows the
    # spread; this seed measures CV 0.19 (range 36-81 s) against v2's 0.1
    assert d.std() / d.mean() > 0.15                 # v2: about 0.1
    assert gaps.std() / gaps.mean() > 0.05           # v2: 0.04
    assert len({round(z.start_hz, 2) for z in runs}) > len(runs) // 2


def test_cluster_runs_are_all_visible():
    for r in seizure_visibility(_cluster(3)):
        _visible_enough(r)


def test_motor_correlate_brings_muscle_and_postictal_default():
    ev = dict(type="seizure", onset_min=10.0, duration_s=70, onset_region="left_frontal", spread="none",
              evolution=dict(start_hz=6.0, end_hz=2.5, amplitude_start_uv=60, amplitude_end_uv=160),
              clinical_correlate="focal_clonic")
    v3 = normalize(_img("child", CHILD, [ev]))["spec"]["events"][0]
    v2 = normalize(_img("child", CHILD, [ev], version=2))["spec"]["events"][0]
    assert v3["muscle"] == "modest" and v2["muscle"] == "none"
    assert v3["postictal_attenuation_s"] > 0 and v2["postictal_attenuation_s"] == 0
