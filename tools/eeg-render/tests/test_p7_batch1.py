"""EEG Atlas P7 batch 1 (0.4.2): emitted term sleep-wake cycle, first-hours state, transient sharp waves, dysmaturity.

All behind spec_version 2 and new opt-in keys; a version-1 or key-less spec is unchanged.
"""
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


def _img(bg_extra=None, seed=517001, version=None, duration_min=30):
    bg = {"type": "continuous", "pma_weeks": 40.0, "amplitude_uv": 45.0, "dominant_hz": 2.0, "slow_fraction": 0.8}
    bg.update(bg_extra or {})
    s = {"seed": seed, "age_group": "neonate", "sample_rate": FS, "channels": "neonatal_9", "duration_min": duration_min,
         "background": bg, "events": []}
    if version:
        s["spec_version"] = version
    return {"kind": "eeg_page", "license": "synthetic-original", "spec": s}


def _p2p_1s(syn, a, b, pairs=(("C3", "O1"), ("C4", "O2"), ("T3", "O1"), ("T4", "O2"))):
    _, x = syn.segment(a, b)
    sos = sps.butter(4, [0.5, 30.0], btype="bandpass", fs=FS, output="sos")
    y = sps.sosfiltfilt(sos, syn.derive(x, list(pairs)), axis=-1)
    n = y.shape[1] // FS
    return np.ptp(y[:, : n * FS].reshape(y.shape[0], n, FS), axis=2).max(axis=0)


def test_state_cycle_is_emitted_and_quiet_sleep_is_trace_alternant():
    img = _img({"state_cycle": "term", "hours_of_life": 60.0})
    assert validate_image(img) == []
    syn = Synthesizer(normalize(img)["spec"], 1800.0)
    rows = [r for r in realized_events(syn, 1800.0) if r["kind"] == "state"]
    labels = {r["label"] for r in rows}
    assert rows and labels <= {"awake", "active_sleep", "quiet_sleep", "indeterminate"}
    # the intervals tile the record
    assert abs(rows[0]["onset_s"]) < 1e-6 and abs(rows[-1]["offset_s"] - 1800.0) < 1e-6
    for a, b in zip(rows, rows[1:]):
        assert abs(a["offset_s"] - b["onset_s"]) < 1e-6
    qs = [r for r in rows if r["label"] == "quiet_sleep"]
    act = [r for r in rows if r["label"] == "active_sleep"]
    assert qs and act, labels
    q = qs[0]; a = act[0]
    pq = _p2p_1s(syn, q["onset_s"] + 5, min(q["offset_s"], q["onset_s"] + 125))
    pa = _p2p_1s(syn, a["onset_s"] + 5, min(a["offset_s"], a["onset_s"] + 125))
    # trace alternant: bursts (upper quartile) well above the interburst (lower quartile); active sleep is flat by comparison
    ratio_q = np.percentile(pq, 80) / max(np.percentile(pq, 20), 1e-6)
    ratio_a = np.percentile(pa, 80) / max(np.percentile(pa, 20), 1e-6)
    assert ratio_q > 1.8 and ratio_q > 1.3 * ratio_a, (ratio_q, ratio_a)
    # interburst stays above the ACNS neonatal suppression band (this is TA, not burst suppression)
    assert np.percentile(pq, 20) > 15.0


def test_no_state_cycle_means_no_state_rows_and_unchanged_synthesis():
    syn = Synthesizer(normalize(_img())["spec"], 600.0)
    assert not [r for r in realized_events(syn, 600.0) if r["kind"] == "state"]
    assert syn._state_intervals == []


def test_first_hours_state_is_more_discontinuous_and_indeterminate():
    day3 = normalize(_img({"state_cycle": "term", "hours_of_life": 60.0}))["spec"]
    early = normalize(_img({"state_cycle": "term", "hours_of_life": 3.0}))["spec"]
    assert early["background"]["burst_suppression"]["ibi_s"] > day3["background"]["burst_suppression"]["ibi_s"]
    assert early["background"]["burst_suppression"]["ibi_floor"] < day3["background"]["burst_suppression"]["ibi_floor"]
    ge_d, ge_e = day3["background"]["graphoelements"], early["background"]["graphoelements"]
    assert ge_e["frontal_sharp"]["rate_per_min"] < 0.5 * ge_d["frontal_sharp"]["rate_per_min"]
    assert ge_e["sharp_transient"]["rate_per_min"] > 4.0 * ge_d["sharp_transient"]["rate_per_min"]
    assert ge_e["delta_brush"]["rate_per_min"] >= 0.6 > ge_d["delta_brush"]["rate_per_min"]
    # indeterminate sleep dominates the first hours (S22: 63 % vs 28 %)
    def indet_fraction(spec):
        syn = Synthesizer(spec, 7200.0)
        rows = [r for r in realized_events(syn, 7200.0) if r["kind"] == "state"]
        return sum(r["offset_s"] - r["onset_s"] for r in rows if r["label"] == "indeterminate") / 7200.0
    assert indet_fraction(early) > 2.0 * indet_fraction(day3)


def test_term_transient_sharp_waves_follow_s22_rates_and_regions():
    n = normalize(_img({"state_cycle": "term", "hours_of_life": 60.0}))["spec"]
    assert abs(n["background"]["graphoelements"]["sharp_transient"]["rate_per_min"] - 0.13) < 1e-9     # 7.6 / h
    # without the state-cycle module the element is not even in the normalized spec (bank hashes unchanged)
    assert "sharp_transient" not in normalize(_img())["spec"]["background"]["graphoelements"]
    assert "sharp_transient" not in normalize(_img(version=1))["spec"]["background"]["graphoelements"]
    syn = Synthesizer(n, 7200.0)
    ev = syn._ge_events["sharp_transient"]
    inside = ev[(ev[:, 0] >= 0) & (ev[:, 0] < 7200.0)]
    per_hour = inside.shape[0] / 2.0
    assert 4.0 < per_hour < 12.0, per_hour
    regions = inside[:, 2].astype(int)
    assert (regions == 0).mean() > 0.3 and (regions == 3).mean() < 0.2                                 # temporal > frontal
    # one event: a surface-negative sharp wave 100-400 ms wide, > 50 uV on its focus, one side
    t0, dur, region, side, amp, _ = inside[0]
    t = np.arange(t0 - 0.2, t0 + 0.6, 1.0 / FS)
    rows = syn.graphoelement_rows(t)
    left = {0: "T3", 1: "C3", 2: "O1", 3: "Fp1"}[int(region)]
    mirror = {"T3": "T4", "C3": "C4", "O1": "O2", "Fp1": "Fp2"}
    focus, contra = (mirror[left], left) if side > 0 else (left, mirror[left])
    y = rows[syn._idx[focus]]
    assert y.min() < -0.4 * amp and np.ptp(y) > 50.0
    width = (np.abs(y) > 0.2 * np.abs(y).max()).sum() / FS
    assert 0.08 < width < 0.45, width
    other = rows[syn._idx[contra]]
    assert np.ptp(other) < 0.4 * np.ptp(y)


def test_dysmaturity_draws_maturational_defaults_from_the_younger_pma():
    stated = normalize(_img({"type": "discontinuous", "state_cycle": "term", "hours_of_life": 60.0}))["spec"]
    dys = normalize(_img({"type": "discontinuous", "state_cycle": "term", "hours_of_life": 60.0, "dysmature_pma_weeks": 34.0}))["spec"]
    ref34 = normalize(_img({"type": "discontinuous", "pma_weeks": 34.0, "state_cycle": "term", "hours_of_life": 60.0}))["spec"]
    assert dys["background"]["pma_weeks"] == 40.0 and dys["background"]["dysmature_pma_weeks"] == 34.0
    assert dys["background"]["graphoelements"] == ref34["background"]["graphoelements"]
    assert dys["background"]["graphoelements"]["delta_brush"]["rate_per_min"] > 5 * stated["background"]["graphoelements"]["delta_brush"]["rate_per_min"]
