"""Displayed field, timing and suppression regressions from the full-gallery review."""
from functools import lru_cache

import numpy as np
import pytest
from scipy.signal import butter, sosfiltfilt

from eeg_render import montage as mt
from eeg_render.render_page import apply_filters, build_filters, page_signals
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer


@lru_cache(maxsize=None)
def _neonatal(kind, suppressed_example=False):
    image = {"kind": "eeg_page", "license": "synthetic-original", "attribution": None,
             "spec": {"spec_version": 3, "seed": 29260315, "age_group": "neonate", "sample_rate": 256,
                      "channels": "standard_19", "duration_min": 30, "at_min": 10, "window_s": 30,
                      "sensitivity_uv_mm": 7, "montage": "neonatal_reduced", "events": [],
                      "background": {"type": kind, "pma_weeks": 40, "dominant_hz": 2,
                                     "amplitude_uv": 100, "slow_fraction": .8, "reactivity": "absent",
                                     "channel_gain_max": 1.5, "delta_brushes": "riding"},
                      "filters": {"lf_hz": .5, "hf_hz": 70, "notch_hz": 60}}}
    if suppressed_example:
        image["spec"]["background"].update({
            "ibi_floor_uv": .5, "baseline_ecg_uv": .5,
            "graphoelements": {name: {"enabled": False, "rate_per_min": 0}
                               for name in ("occipital_delta", "temporal_theta", "temporal_alpha", "stop",
                                            "frontal_sharp", "anterior_slow", "midline_theta", "delta_brush")}})
    spec = normalize(image)["spec"]
    return Synthesizer(spec, 1800)


def _display(syn, a, b, montage, lf=.5):
    t, x = syn.segment(a - 10, b)
    pairs = mt.montage_pairs(montage, syn.scalp)
    d = apply_filters(syn.derive(x, pairs, montage),
                      build_filters(syn.fs, {"lf_hz": lf, "hf_hz": 70, "notch_hz": 60}, True), True)
    return t[10 * syn.fs:], d[:, 10 * syn.fs:]


def test_neonatal_suppression_does_not_contain_normal_high_voltage_transients():
    """The gallery's authored anterior slow wave at 605.765 s formerly gave a 42-uV excursion in suppression."""
    syn = _neonatal("burst_suppression")
    _, d = _display(syn, 606, 608, "neonatal_reduced")
    assert np.max(np.abs(d)) < 10, np.max(np.abs(d))
    # Bursts remain unmistakably present on the same page; this cannot pass by muting the whole record.
    _, page = _display(syn, 600, 630, "neonatal_reduced")
    assert np.max(np.ptp(page, axis=1)) > 100


def test_authored_neonatal_burst_suppression_meets_acns_interburst_voltage():
    syn = _neonatal("burst_suppression", suppressed_example=True)
    _, t, d, _, _ = page_signals(syn.spec, syn)
    cores = 0
    for end, start in zip(syn._burst_end[:-1], syn._burst_start[1:]):
        a, b = max(600, end + 1.5), min(630, start - 1.5)
        if b - a < 1:
            continue
        cores += 1
        assert np.max(np.ptp(d[:, (t >= a) & (t < b)], axis=1)) < 5
    assert cores == 3
    assert np.max(np.ptp(d[:, (t >= 600) & (t < 630)], axis=1)) > 100
    assert all(row["rate_per_min"] == 0 for row in syn.bg["graphoelements"].values())


@pytest.mark.parametrize("kind", ["continuous", "discontinuous"])
def test_normal_neonatal_transients_remain_visible_without_pathological_suppression(kind):
    syn = _neonatal(kind)
    t = np.arange(606, 608, 1 / syn.fs)
    pairs = mt.montage_pairs("neonatal_reduced", syn.scalp)
    transient = syn.derive(syn.graphoelement_rows(t, only=("anterior_slow",)), pairs, "neonatal_reduced")
    assert np.max(np.ptp(transient, axis=1)) > 15


def _sleep_image(k_complex=False, controls=True):
    style = {"spindle_topography": "central"} if controls else {}
    if not k_complex:
        style["spindle_rate_per_min"] = 8
    if k_complex and controls:
        style["k_complex_spindle_delay_s"] = 1.3
    return {"kind": "eeg_page", "license": "synthetic-original", "attribution": None,
            "spec": {"spec_version": 3, "seed": 29268104 if k_complex else 29268103,
                     "age_group": "adolescent" if k_complex else "child", "sample_rate": 256,
                     "channels": "standard_19", "duration_min": 60, "at_min": 27.04 if k_complex else 30.6,
                     "window_s": 20 if k_complex else 15, "sensitivity_uv_mm": 10,
                     "montage": "longitudinal_bipolar", "style": style,
                     "background": {"type": "continuous", "dominant_hz": 9.5 if k_complex else 8.5,
                                    "amplitude_uv": 40 if k_complex else 90,
                                    "slow_fraction": .3 if k_complex else .35, "reactivity": "present",
                                    "sleep_staging": "static"},
                     "events": [{"type": "state_change", "at_min": 10, "to": "sleep"}],
                     "filters": {"lf_hz": 1, "hf_hz": 70, "notch_hz": 60}}}


@lru_cache(maxsize=None)
def _sleep(k_complex=False, controls=True):
    spec = normalize(_sleep_image(k_complex, controls))["spec"]
    return Synthesizer(spec, 3600)


def test_authored_fast_spindle_is_central_in_the_displayed_bipolar_montage():
    syn = _sleep()
    pairs = mt.montage_pairs("longitudinal_bipolar", syn.scalp)
    _, d = _display(syn, 1838.2, 1839.2, "longitudinal_bipolar", lf=1)
    sigma = sosfiltfilt(butter(4, [11, 16], fs=syn.fs, btype="bandpass", output="sos"), d, axis=1)
    rms = np.sqrt(np.mean(sigma ** 2, axis=1))
    central = [i for i, p in enumerate(pairs) if p in [("F3", "C3"), ("C3", "P3"), ("F4", "C4"), ("C4", "P4")]]
    temporal = [i for i, p in enumerate(pairs) if p in [("T3", "T5"), ("T5", "O1"), ("T4", "T6"), ("T6", "O2")]]
    assert len(central) == len(temporal) == 4
    assert np.max(rms[central]) > 2 * np.max(rms[temporal]), rms


def test_authored_k_complex_spindles_follow_the_complex_and_render_consistently_in_chunks():
    syn = _sleep(k_complex=True)
    page_start, page_end = 1622.4, 1642.4
    k_times = syn._kc_t[(syn._kc_t > page_start) & (syn._kc_t < page_end)]
    assert len(k_times) >= 2
    for tk in k_times:
        packet_overlap = (syn._sp_t + syn._sp["dur"] > tk - .4) & (syn._sp_t < tk + 1.3 - 1e-8)
        assert not packet_overlap.any(), (tk, syn._sp_t[packet_overlap])
    t = np.arange(page_start, page_end, 1 / syn.fs)
    whole = syn._spindle_rows_v3(t)
    split = len(t) // 2
    chunks = np.concatenate([syn._spindle_rows_v3(t[:split]), syn._spindle_rows_v3(t[split:])], axis=1)
    np.testing.assert_allclose(whole, chunks, rtol=0, atol=1e-10)
    # The unscaled packet component remains present, rather than passing by dropping every packet.
    assert np.max(np.abs(whole)) > .5
