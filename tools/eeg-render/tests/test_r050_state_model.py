"""0.5.0 state model (spec_version 3): sleep stages, eye state, spindles, vertex waves and K-complexes.

Feature review 2026-09-26 (normal-variants.md, seizures-icu.md): one sleep depth for hours, clockwork spindles at
16/min, no vertex waves or K-complexes, temporal spindles at 0.3 of central, no muscle all night, and no eye state.
"""
from collections import Counter

import numpy as np
import pytest
from scipy import signal as sps

from eeg_render import montage as mt
from eeg_render.render_page import apply_filters, build_filters
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer

DUR_MIN = 180


@pytest.fixture(scope="module")
def S():
    img = {"kind": "qeeg_panel", "license": "synthetic-original", "attribution": None,
           "spec": {"sample_rate": 256, "channels": "standard_19", "seed": 27960625, "spec_version": 3,
                    "age_group": "child", "duration_min": DUR_MIN,
                    "background": {"type": "continuous", "reactivity": "present", "dominant_hz": 8.5,
                                   "amplitude_uv": 50, "slow_fraction": 0.35},
                    "events": [{"type": "state_change", "at_min": 20, "to": "sleep"}]}}
    return Synthesizer(normalize(img)["spec"], DUR_MIN * 60.0)


def _minutes(S):
    c = Counter()
    for a, b, st in S._hypno:
        c[st] += max(0.0, min(b, DUR_MIN * 60) - max(a, 0.0)) / 60.0
    return c


def _disp(S, t0, t1, pairs):
    _, x = S.segment(t0 - 10, t1)
    d = apply_filters(S.derive(x, pairs, "longitudinal_bipolar"), build_filters(S.fs, {"lf_hz": 1.0, "hf_hz": 70.0}, True), True)
    return d[:, int(10 * S.fs):]


def test_sleep_cycles_through_stages(S):
    m = _minutes(S)
    assert all(m[st] > 3 for st in ("N1", "N2", "N3", "R"))
    first_n3 = next(a for a, b, st in S._hypno if st == "N3")
    first_rem = next(a for a, b, st in S._hypno if st == "R")
    assert first_n3 < first_rem                       # slow-wave sleep precedes the first REM period


def test_spindles_are_scheduled_not_clockwork(S):
    n2 = _minutes(S)["N2"] + 0.35 * _minutes(S)["N3"]
    assert 3.0 <= S._sp_t.size / n2 <= 5.5
    gaps = np.diff(S._sp_t)
    gaps = gaps[gaps < 60]
    assert gaps.std() / gaps.mean() > 0.5            # Poisson-like, not a 3.7-s clock
    assert 0.5 <= S._sp["dur"].min() and S._sp["dur"].max() <= 2.0
    assert S._vx_t.size > 0 and S._kc_t.size > 0


def test_temporal_spindles_lower_but_present(S):
    pairs = mt.montage_pairs("longitudinal_bipolar", S.scalp)
    names = [f"{a}-{b}" for a, b in pairs]
    a, b = next((a, b) for a, b, st in S._hypno if st == "N2" and b - a > 200)
    t0 = a + 30
    d = _disp(S, t0, t0 + 120, pairs)
    sig = sps.sosfiltfilt(sps.butter(4, [11, 16], "bandpass", fs=S.fs, output="sos"), d, axis=1)
    tt = t0 + np.arange(d.shape[1]) / S.fs
    ins = np.zeros(tt.size, bool)
    for k, ts in enumerate(S._sp_t):
        ins |= (tt >= ts) & (tt < ts + S._sp["dur"][k])
    rms = np.sqrt((sig[:, ins] ** 2).mean(1))
    between = np.sqrt((sig[:, ~ins] ** 2).mean(1))
    c, tmp = names.index("C3-P3"), names.index("T3-T5")
    assert rms[c] > 2.5 * between[c]                  # spindles stand out centrally
    assert 0.5 <= rms[tmp] / rms[c] <= 1.0            # Craig: temporal lower voltage, not absent


def test_muscle_and_alpha_follow_stage(S):
    pairs = mt.montage_pairs("longitudinal_bipolar", S.scalp)
    names = [f"{a}-{b}" for a, b in pairs]
    hp = sps.butter(4, [30, 70], "bandpass", fs=S.fs, output="sos")
    emg, p2p = {}, {}
    for st in ("W", "N2", "N3", "R"):
        a, b = next((a, b) for a, b, s_ in S._hypno if s_ == st and b - a > 90 and a > 0)
        d = _disp(S, a + 30, a + 60, pairs)
        emg[st] = float(np.sqrt((sps.sosfiltfilt(hp, d[names.index("T3-T5")]) ** 2).mean()))
        c = d[names.index("C3-P3")]
        p2p[st] = float(np.median([np.ptp(c[k * S.fs:(k + 1) * S.fs]) for k in range(30)]))
    assert emg["W"] > 2 * emg["N2"] > 2 * emg["R"]
    assert p2p["N3"] > 1.3 * p2p["W"]                # sleep raises voltage (was flat)


def test_pdr_attenuates_with_eyes_open(S):
    pairs = mt.montage_pairs("longitudinal_bipolar", S.scalp)
    names = [f"{a}-{b}" for a, b in pairs]
    ab = sps.butter(4, [7, 11], "bandpass", fs=S.fs, output="sos")
    out = {}
    for state in ("closed", "open"):
        a, b = next((a, b) for a, b, s_ in S._eyes if s_ == state and b - a > 12 and a > 0)
        d = _disp(S, a + 2, a + 10, pairs)
        out[state] = float(np.sqrt((sps.sosfiltfilt(ab, d[names.index("P3-O1")]) ** 2).mean()))
    assert out["open"] < 0.5 * out["closed"]


def test_state_model_is_window_independent(S):
    """The same second from two differently cut requests is identical (drawn once per record)."""
    a, b = next((a, b) for a, b, st in S._hypno if st == "N2" and b - a > 200)
    t0 = a + 40
    _, x1 = S.segment(t0, t0 + 20)
    _, x2 = S.segment(t0 - 7.25, t0 + 31)
    k = int(round(7.25 * S.fs))
    assert np.allclose(x1, x2[:, k:k + x1.shape[1]], atol=1e-6)


def test_v2_records_have_no_hypnogram():
    img = {"kind": "qeeg_panel", "license": "synthetic-original", "attribution": None,
           "spec": {"sample_rate": 256, "channels": "standard_19", "seed": 1, "spec_version": 2, "age_group": "child",
                    "duration_min": 30, "background": {"type": "continuous", "reactivity": "present"},
                    "events": [{"type": "state_change", "at_min": 5, "to": "sleep"}]}}
    assert Synthesizer(normalize(img)["spec"], 1800.0)._hypno == []


def test_pdr_has_an_anterior_posterior_gradient_on_bipolar(S):
    """Feature review: C3-P3 carried 0.87-0.99 of P3-O1's alpha.  The PDR is best seen in P3-O1."""
    pairs = mt.montage_pairs("longitudinal_bipolar", S.scalp)
    names = [f"{a}-{b}" for a, b in pairs]
    ab = sps.butter(4, [7, 10], "bandpass", fs=S.fs, output="sos")
    a, b = next((a, b) for a, b, s_ in S._eyes if s_ == "closed" and b - a > 12 and a > 0)
    d = _disp(S, a + 2, a + 10, pairs)
    rms = {n: float(np.sqrt((sps.sosfiltfilt(ab, d[names.index(n)]) ** 2).mean())) for n in ("C3-P3", "P3-O1", "T5-O1")}
    assert 0.3 <= rms["C3-P3"] / rms["P3-O1"] <= 0.65, rms
    assert rms["T5-O1"] > rms["C3-P3"], rms
