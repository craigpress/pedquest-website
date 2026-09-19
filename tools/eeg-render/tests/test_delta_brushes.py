"""Delta brushes as events (0.3.12): a delta wave with a fast burst riding on it, opt-in.

Craig's review of the P5 neonatal pages (2026-09-16): the 0.3.10 ``delta_brushes: true``
stream is 13-Hz activity gated by the delta stream, so fast bursts recur at delta rate
head-wide without a slow wave of their own, and they stay on at term. ``"riding"``
replaces it with PMA-scheduled events whose fast burst sits on its own delta wave.
Legacy specs (bool) must normalize and synthesize exactly as before.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from scipy import signal

RENDERER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RENDERER))

from eeg_render.spec import delta_brush_defaults, normalize, spec_warnings, validate_image
from eeg_render.synth import Synthesizer

FS = 256


def _neo(bg_extra=None, seed=515101):
    bg = {"type": "discontinuous", "pma_weeks": 32.0, "amplitude_uv": 60.0, "dominant_hz": 1.5, "slow_fraction": 0.8}
    bg.update(bg_extra or {})
    # spec_version 1: the 0.3.12 mechanics under the 0.3.x defaults (0.4.0 makes riding the neonatal default)
    return {"kind": "eeg_page", "license": "synthetic-original",
            "spec": {"seed": seed, "spec_version": 1, "age_group": "neonate", "sample_rate": FS, "channels": "standard_19",
                     "duration_min": 20, "background": bg, "events": []}}


# ------------------------------------------------------------- legacy ------
def test_legacy_bool_spec_gains_no_new_keys():
    norm = normalize(_neo())["spec"]["background"]
    assert norm["delta_brushes"] is True
    assert "delta_brush_events" not in norm
    assert "delta_brush" not in norm["graphoelements"]
    norm_off = normalize(_neo({"delta_brushes": False}))["spec"]["background"]
    assert norm_off["delta_brushes"] is False and "delta_brush_events" not in norm_off


def test_legacy_spec_synthesizes_identically_with_and_without_riding_code_path():
    # the same legacy spec normalized twice is bit-identical (guards the new normalize branch)
    a = Synthesizer(normalize(_neo())["spec"], 300.0)
    b = Synthesizer(normalize(_neo())["spec"], 300.0)
    _, xa = a.segment(60.0, 90.0); _, xb = b.segment(60.0, 90.0)
    assert np.array_equal(xa, xb)


def test_legacy_brushes_carry_an_advisory():
    w = spec_warnings(normalize(_neo({"pma_weeks": 40.0})))
    assert any("delta_brushes: true" in x and "PMA 40.0" in x for x in w)
    assert not any("delta_brushes: true" in x for x in spec_warnings(normalize(_neo({"delta_brushes": "riding"}))))


# ------------------------------------------------------------- riding ------
def test_riding_validates_and_normalizes_to_events():
    img = _neo({"delta_brushes": "riding"})
    assert validate_image(img) == []
    bg = normalize(img)["spec"]["background"]
    assert bg["delta_brushes"] is False and bg["delta_brush_events"] is True
    assert bg["graphoelements"]["delta_brush"]["rate_per_min"] > 2.5   # PMA 32 w is near the peak
    assert bg["graphoelements"]["delta_brush"]["amplitude_uv"] > 100


def test_riding_rate_follows_pma_and_is_zero_at_term():
    assert delta_brush_defaults(32.0)["rate_per_min"] > delta_brush_defaults(37.0)["rate_per_min"] > 0
    assert delta_brush_defaults(40.0)["rate_per_min"] == 0.0
    bg40 = normalize(_neo({"delta_brushes": "riding", "pma_weeks": 40.0}))["spec"]["background"]
    assert bg40["graphoelements"]["delta_brush"]["rate_per_min"] == 0.0
    assert any("schedules no brushes" in x for x in spec_warnings(normalize(_neo({"delta_brushes": "riding", "pma_weeks": 40.0}))))
    # without a PMA the request still means something
    nopma = _neo({"delta_brushes": "riding"}); del nopma["spec"]["background"]["pma_weeks"]
    bg_nopma = normalize(nopma)["spec"]["background"]
    assert bg_nopma["graphoelements"]["delta_brush"]["rate_per_min"] == 2.0
    # an author override wins
    bg_forced = normalize(_neo({"delta_brushes": "riding", "pma_weeks": 40.0,
                                "graphoelements": {"delta_brush": {"rate_per_min": 1.0}}}))["spec"]["background"]
    assert bg_forced["graphoelements"]["delta_brush"]["rate_per_min"] == 1.0


def test_riding_brush_is_a_delta_wave_with_fast_activity_on_it():
    # a continuous background so the burst-envelope gate is ~1 and the event is seen whole; the
    # other PMA-table graphoelements (occipital delta runs at 32 w!) are silenced so O1 shows the brush alone
    others = {n: {"enabled": False} for n in ("occipital_delta", "temporal_theta", "temporal_alpha", "stop",
                                                "frontal_sharp", "anterior_slow", "midline_theta")}
    syn_cont = Synthesizer(normalize(_neo({"delta_brushes": "riding", "type": "continuous", "graphoelements": others}))["spec"], 300.0)
    ev2 = syn_cont._ge_events["delta_brush"]
    assert ev2.shape[0] >= 3
    t0, dur, freq, side, amp, _ = ev2[(ev2[:, 0] > 10) & (ev2[:, 0] < 280)][0]
    assert 10.0 <= freq <= 20.0 and 0.5 <= dur <= 3.0
    t = np.arange(t0 - 2.0, t0 + dur + 2.0, 1.0 / FS)
    rows = syn_cont.graphoelement_rows(t)
    # the spec is 32 w: complexes are occipito-temporal at that age (0.4.0 field by PMA)
    focus = "O2" if side > 0 else "O1"
    y = rows[syn_cont._idx[focus]]
    inside = (t > t0) & (t < t0 + dur)
    outside = ~inside
    # slow wave: a surface-negative deflection of about half the peak-to-peak request
    assert y[inside].min() < -0.35 * amp and y[outside].max() - y[outside].min() < 0.05 * amp
    # fast burst rides on it: 10-20 Hz band power inside the event, essentially none outside
    sos = signal.butter(4, [9.0, 22.0], btype="bandpass", fs=FS, output="sos")
    fast = signal.sosfiltfilt(sos, y)
    assert np.sqrt(np.mean(fast[inside] ** 2)) > 5.0 * (np.sqrt(np.mean(fast[outside] ** 2)) + 1e-9)
    # the slow wave dominates the burst (brush = delta with beta on top, not beta alone)
    slow_sos = signal.butter(4, 3.0, btype="lowpass", fs=FS, output="sos")
    slow = signal.sosfiltfilt(slow_sos, y)
    assert np.abs(slow[inside]).max() > 2.0 * np.abs(fast[inside]).max()


def test_riding_page_has_no_delta_gated_stream():
    # with events off (rate 0) a riding spec has no 13-Hz bursts recurring at delta rate: the
    # fast band on a quiet page is the beta stream only, far below the legacy gated bursts
    legacy = Synthesizer(normalize(_neo({"pma_weeks": 40.0}))["spec"], 200.0)
    riding = Synthesizer(normalize(_neo({"delta_brushes": "riding", "pma_weeks": 40.0}))["spec"], 200.0)
    _, xl = legacy.segment(60.0, 120.0); _, xr = riding.segment(60.0, 120.0)
    sos = signal.butter(4, [10.0, 18.0], btype="bandpass", fs=FS, output="sos")
    fl = np.sqrt(np.mean(signal.sosfiltfilt(sos, xl, axis=1) ** 2))
    fr = np.sqrt(np.mean(signal.sosfiltfilt(sos, xr, axis=1) ** 2))
    assert fr < fl
