"""EEG Atlas P7 batch 2 (0.4.2): keyed reactivity, keyed adult state rows, CAPE, breach, AP gradient."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from scipy import signal as sps

RENDERER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RENDERER))

from eeg_render.export.manifest import realized_events  # noqa: E402
from eeg_render.spec import normalize, validate_image  # noqa: E402
from eeg_render.synth import Synthesizer  # noqa: E402

FS = 256


def _img(bg_extra=None, events=None, age="adult", seed=517301):
    bg = {"type": "continuous", "amplitude_uv": 40.0, "dominant_hz": 3.0, "slow_fraction": 0.8, "reactivity": "present",
          "blink_rate_per_min": 0}
    bg.update(bg_extra or {})
    return {"kind": "eeg_page", "license": "synthetic-original",
            "spec": {"seed": seed, "age_group": age, "sample_rate": FS, "channels": "standard_19", "duration_min": 20,
                     "background": bg, "events": events or []}}


def _p2p(syn, a, b, pairs):
    _, x = syn.segment(a, b)
    sos = sps.butter(4, [0.5, 30.0], btype="bandpass", fs=FS, output="sos")
    y = sps.sosfiltfilt(sos, syn.derive(x, pairs), axis=-1)
    n = y.shape[1] // FS
    return np.ptp(y[:, : n * FS].reshape(len(pairs), n, FS), axis=2)


def _rms(syn, a, b, elec, lo, hi):
    _, x = syn.segment(a, b)
    sos = sps.butter(4, [lo, hi], btype="bandpass", fs=FS, output="sos")
    return float(np.sqrt(np.mean(sps.sosfiltfilt(sos, x[syn._idx[elec]]) ** 2)))


def test_stimulation_row_carries_the_response():
    ev = [{"type": "stimulation", "at_min": 5.0}]
    for react in ("present", "absent", "unclear"):
        syn = Synthesizer(normalize(_img({"reactivity": react}, ev))["spec"], 600.0)
        rows = [r for r in realized_events(syn, 600.0) if r["kind"] == "stimulation"]
        assert rows and rows[0]["response"] == react


def test_cape_is_keyed_and_alternates():
    img = _img({"cape": {"period_s": 40.0, "depth": 0.6, "cycles": 8, "at_min": 5.0}, "reactivity": "absent"})
    assert validate_image(img) == []
    syn = Synthesizer(normalize(img)["spec"], 900.0)
    rows = [r for r in realized_events(syn, 900.0) if r["kind"] == "cape_cycle"]
    assert len(rows) == 8 and abs(rows[0]["onset_s"] - 300.0) < 1e-6 and abs(rows[0]["offset_s"] - 340.0) < 1e-6
    pairs = [("F3", "C3"), ("C3", "P3"), ("F4", "C4"), ("C4", "P4")]
    a = _p2p(syn, 383.0, 397.0, pairs).mean()      # phase A of cycle 3 (380-400)
    b = _p2p(syn, 403.0, 417.0, pairs).mean()      # phase B (400-420)
    assert b < 0.6 * a, (a, b)
    assert not [r for r in realized_events(Synthesizer(normalize(_img())["spec"], 600.0), 600.0) if r["kind"] == "cape_cycle"]


def test_breach_raises_regional_amplitude_and_fast_activity():
    img = _img({"breach": {"focus": "C3", "gain": 2.2, "fast_gain": 2.5}, "amplitude_uv": 40.0, "dominant_hz": 9.0, "slow_fraction": 0.4}, age="child")
    assert validate_image(img) == []
    syn = Synthesizer(normalize(img)["spec"], 600.0)
    p = _p2p(syn, 200.0, 320.0, [("C3", "P3"), ("C4", "P4")])
    assert np.median(p[0]) > 1.4 * np.median(p[1])
    assert _rms(syn, 200.0, 320.0, "C3", 13.0, 30.0) > 1.6 * _rms(syn, 200.0, 320.0, "C4", 13.0, 30.0)


def test_ap_gradient_absent_flattens_posterior_alpha_dominance():
    pres = Synthesizer(normalize(_img({"dominant_hz": 10.0, "slow_fraction": 0.25, "pdr_gain": 3.0, "amplitude_uv": 35.0}))["spec"], 600.0)
    absn = Synthesizer(normalize(_img({"dominant_hz": 10.0, "slow_fraction": 0.25, "pdr_gain": 3.0, "amplitude_uv": 35.0, "ap_gradient": "absent"}))["spec"], 600.0)

    def ratio(syn):
        o = np.mean([_rms(syn, 200.0, 290.0, e, 8.0, 13.0) for e in ("O1", "O2")])
        f = np.mean([_rms(syn, 200.0, 290.0, e, 8.0, 13.0) for e in ("F3", "F4")])
        return o / f
    assert ratio(pres) > 1.5 * ratio(absn), (ratio(pres), ratio(absn))


def test_state_change_record_emits_awake_and_sleep_rows():
    syn = Synthesizer(normalize(_img({"dominant_hz": 9.0, "slow_fraction": 0.4}, [{"type": "state_change", "at_min": 8.0, "to": "sleep"}]))["spec"], 1200.0)
    rows = [r for r in realized_events(syn, 1200.0) if r["kind"] == "state"]
    labels = [r["label"] for r in rows]
    assert labels[0] == "awake" and "sleep" in labels
    assert abs(rows[0]["onset_s"]) < 1e-6 and abs(rows[-1]["offset_s"] - 1200.0) < 1e-6
    assert _rms(syn, 620.0, 740.0, "Cz", 11.0, 15.0) > 1.3 * _rms(syn, 300.0, 420.0, "Cz", 11.0, 15.0)
