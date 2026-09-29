"""r9 (0.5.2) neonatal background, graphoelements, aEEG sleep-wake cycling and trend-panel fixes (spec_version 3).

Gallery review 2026-09-29 (research/eeg-atlas/gallery-20260929/ISSUES.json): neo-30w-discontinuous (bursts ~2x the
PMA table), neo-stop-24w / neo-temporal-theta-29w (graphoelements visible only over a lowered background; STOP not
sharp), trd-aeeg-term-swc / trd-aeeg-dnv (sleep-wake cycling never shows), global ibi_floor_at_h ignored on a
continuous background, trd-suppression-ratio (annotation over the header), trd-composite-seizure (7 uV/mm page).
"""
from functools import lru_cache

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402

from eeg_render import montage as mt  # noqa: E402
from eeg_render import render_panel as rp  # noqa: E402
from eeg_render.render_aeeg import synth_spec_for_aeeg  # noqa: E402
from eeg_render.render_page import apply_filters, build_filters  # noqa: E402
from eeg_render.spec import SpecError, normalize  # noqa: E402
from eeg_render.synth import Synthesizer  # noqa: E402
from eeg_render.trends import aeeg_margins  # noqa: E402


def _page(bg_type, pma, version=3, seed=4242, **bg):
    b = {"type": bg_type, "pma_weeks": pma, "dominant_hz": 2.0, "slow_fraction": 0.8, "reactivity": "present",
         "channel_gain_max": 1.5, "delta_brushes": "riding"}
    b.update(bg)
    return {"kind": "eeg_page", "license": "synthetic-original", "attribution": None,
            "spec": {"spec_version": version, "seed": seed, "age_group": "neonate", "sample_rate": 256,
                     "channels": "standard_19", "duration_min": 20, "background": b, "events": [], "at_min": 5,
                     "window_s": 20, "sensitivity_uv_mm": 10, "montage": "neonatal_reduced",
                     "filters": {"lf_hz": 0.5, "hf_hz": 70.0}}}


@lru_cache(maxsize=None)
def _syn(bg_type, pma, version=3):
    spec = normalize(_page(bg_type, pma, version))["spec"]
    return Synthesizer(spec, float(spec.get("duration_min", 20.0)) * 60.0)


def _display(syn, a, b):
    pairs = mt.montage_pairs("neonatal_reduced", syn.scalp)
    _, x = syn.segment(a - 10.0, b)
    ch = build_filters(syn.fs, {"lf_hz": 0.5, "hf_hz": 70.0}, True)
    return apply_filters(syn.derive(x, pairs, "neonatal_reduced"), ch, True)[:, int(10 * syn.fs):]


def _burst_and_ibi_uv(syn, n=16):
    """Median over bursts of the whole-burst peak-to-peak in the median display derivation, and the same for the
    interburst intervals longer than 2.5 s (0.5 s in from each edge)."""
    st, en = syn._burst_start, syn._burst_end
    idx = [i for i in range(len(st) - 1) if st[i] > 60 and en[i] < syn.duration_s - 10 and en[i] - st[i] > 1.5]
    idx = idx[:: max(1, len(idx) // n)][:n]
    bursts = [np.median(np.ptp(_display(syn, float(st[i]), float(en[i])), axis=1)) for i in idx]
    ibis = [np.median(np.ptp(_display(syn, float(en[i]) + 0.5, float(st[i + 1]) - 0.5), axis=1))
            for i in idx if st[i + 1] - en[i] > 2.5]
    return float(np.median(bursts)), float(np.median(ibis))


# ------------------------------------------------------------------ burst voltage = PMA table

@pytest.mark.parametrize("bg_type,pma", [("discontinuous", 30.0), ("discontinuous", 26.0), ("trace_alternant", 38.0)])
def test_displayed_burst_voltage_matches_the_pma_table(bg_type, pma):
    """neo-30w-discontinuous: 30-w bursts displayed ~235 uV against the table's 110 (0.4.0 estimator: median 1-s p-p).
    Version 3 reads amplitude_uv as the whole-burst p-p in the typical (median) display derivation."""
    syn = _syn(bg_type, pma)
    burst, _ = _burst_and_ibi_uv(syn)
    req = float(syn.bg["amplitude_uv"])
    assert 0.85 <= burst / req <= 1.2, (burst, req)


def test_interburst_voltage_by_maturity():
    """Trace discontinu keeps a quiescent (< 25 uV) interburst; trace alternant's interburst is 25-50 uV."""
    assert _burst_and_ibi_uv(_syn("discontinuous", 30.0))[1] < 25.0
    assert 25.0 <= _burst_and_ibi_uv(_syn("trace_alternant", 38.0))[1] <= 50.0


def test_burst_content_defaults_are_capped_at_the_burst_voltage_and_authored_values_win():
    ge = normalize(_page("discontinuous", 30.0))["spec"]["background"]["graphoelements"]
    assert ge["delta_brush"]["amplitude_uv"] == pytest.approx(110.0)
    assert ge["occipital_delta"]["amplitude_uv"] <= 110.0
    ge = normalize(_page("discontinuous", 30.0, graphoelements={"delta_brush": {"amplitude_uv": 170}}))[
        "spec"]["background"]["graphoelements"]
    assert ge["delta_brush"]["amplitude_uv"] == 170.0
    # version 2 keeps the table
    ge2 = normalize(_page("discontinuous", 30.0, version=2))["spec"]["background"]["graphoelements"]
    assert ge2["delta_brush"]["amplitude_uv"] > 200.0


# ------------------------------------------------------------------ graphoelements

def _element_rows(syn, name, k=12):
    ev = syn._ge_events[name]
    ev = ev[(ev[:, 0] > 20) & (ev[:, 0] < syn.duration_s - 20)][:k]
    pairs = mt.montage_pairs("neonatal_reduced", syn.scalp)
    out = []
    for t0, dur, *_ in ev:
        t = np.arange(t0 - 0.2, t0 + dur + 0.2, 1.0 / syn.fs)
        g = syn.graphoelement_rows(t, only=(name,)) / np.maximum(syn.burst_envelope(t), 1e-6)[None, :]
        out.append(syn.derive(g, pairs, "neonatal_reduced"))
    return ev, out


@pytest.mark.parametrize("name,pma", [("stop", 24.0), ("temporal_theta", 29.0)])
def test_graphoelement_amplitude_is_the_displayed_peak_to_peak(name, pma):
    """neo-stop-24w / neo-temporal-theta-29w: amplitude_uv is the p-p in the display derivation of largest field."""
    syn = _syn("discontinuous", pma)
    ev, rows = _element_rows(syn, name)
    assert len(rows) >= 5
    ratio = [np.max(np.ptp(r, axis=1)) / a for r, a in zip(rows, ev[:, 4])]
    assert 0.8 <= np.median(ratio) <= 1.2


def test_default_stop_and_temporal_theta_reach_the_burst_voltage():
    for name, pma in (("stop", 24.0), ("temporal_theta", 29.0)):
        spec = normalize(_page("discontinuous", pma))["spec"]
        assert spec["background"]["graphoelements"][name]["amplitude_uv"] >= spec["background"]["amplitude_uv"]


def test_stop_is_sharply_contoured():
    """STOP is sharp theta: pointed surface-negative peaks over broad troughs, so the signal spends far less time
    near its negative extreme than near its positive one (a sinusoid spends the same)."""
    syn = _syn("discontinuous", 24.0)
    ev = syn._ge_events["stop"]
    t0, dur = ev[(ev[:, 0] > 20)][0][:2]
    t = np.arange(t0, t0 + dur, 1.0 / syn.fs)
    o1 = syn._idx["O1"]
    sig = (syn.graphoelement_rows(t, only=("stop",)) / np.maximum(syn.burst_envelope(t), 1e-6)[None, :])[o1]
    assert np.mean(sig < 0.5 * sig.min()) < 0.6 * np.mean(sig > 0.5 * sig.max())


def test_version_2_graphoelements_are_unchanged():
    syn = _syn("discontinuous", 24.0, version=2)
    assert syn.spec_version == 2 and syn.bg["graphoelements"]["stop"]["amplitude_uv"] == pytest.approx(35.0 * 1.0, rel=0.2)


# ------------------------------------------------------------------ aEEG sleep-wake cycling

def _aeeg(bg, cyc, hours=2.5, seed=29265001, version=3):
    img = {"kind": "aeeg", "license": "synthetic-original", "attribution": None,
           "spec": {"spec_version": version, "seed": seed, "age_group": "neonate", "sample_rate": 256,
                    "channels": ["C3-P3", "C4-P4"], "duration_h": hours, "pattern": "CNV",
                    "sleep_wake_cycling": cyc, "background": bg, "seizures": []}}
    spec = normalize(img)["spec"]
    return Synthesizer(synth_spec_for_aeeg(spec), hours * 3600.0)


@lru_cache(maxsize=None)
def _margins(kind, cyc):
    bg = ({"type": "continuous", "pma_weeks": 40, "dominant_hz": 2.5, "amplitude_uv": 25, "slow_fraction": 0.6,
           "reactivity": "present"} if kind == "cnv" else
          {"type": "discontinuous", "dominant_hz": 2.0, "amplitude_uv": 30, "slow_fraction": 0.75,
           "reactivity": "present"})
    syn = _aeeg(bg, cyc, seed=29265001 if kind == "cnv" else 29265002)
    t, lo, hi = aeeg_margins(syn, syn.duration_s, ("C3", "P3"), bin_s=12.0)
    q = syn._swc_cycle_v3(t)[1] if syn._swc_v3 is not None else np.zeros_like(t)
    return syn, t, lo, hi, q


def test_mature_cycling_widens_the_band_without_a_state_cycle():
    """trd-aeeg-term-swc: ``sleep_wake_cycling: mature`` alone gave no visible cycling (3-h period, sleep weight
    only).  Quiet sleep now drops the lower margin and lifts the upper one, about once an hour."""
    syn, t, lo, hi, q = _margins("cnv", "mature")
    assert syn._swc_v3 is not None and syn._swc_v3["period_s"] == 3600.0
    qs, act = q > 0.9, q < 0.05
    assert qs.sum() > 50 and act.sum() > 50
    assert np.median(lo[qs]) <= 0.8 * np.median(lo[act])
    assert np.median(hi[qs]) >= 1.25 * np.median(hi[act])
    assert np.median(hi[qs] / lo[qs]) >= 1.5 * np.median(hi[act] / lo[act])


def test_immature_cycling_moves_the_lower_margin_of_a_discontinuous_record():
    """trd-aeeg-dnv: ``immature`` on a discontinuous record showed no cycling."""
    syn, t, lo, hi, q = _margins("dnv", "immature")
    qs, act = q > 0.9, q < 0.05
    assert np.median(lo[act]) >= 1.3 * np.median(lo[qs])
    assert np.median(lo[qs]) < 5.0 and np.median(hi) > 10.0      # still DNV


def test_authored_state_cycle_and_version_2_keep_their_model():
    bg = {"type": "continuous", "pma_weeks": 40, "state_cycle": "term", "amplitude_uv": 25}
    assert _aeeg(bg, "mature", hours=0.2)._swc_v3 is None
    assert _aeeg({"type": "continuous", "amplitude_uv": 25}, "mature", hours=0.2, version=2)._swc_v3 is None


# ------------------------------------------------------------------ ibi_floor_at_h validation

def test_ibi_floor_at_h_on_a_continuous_background_is_rejected():
    bad = _page("continuous", 40.0, ibi_floor_at_h=[[0, 0.5], [1, 0.1]])
    with pytest.raises(SpecError, match="ibi_floor_at_h has no effect"):
        normalize(bad)
    normalize(_page("discontinuous", 30.0, ibi_floor_at_h=[[0, 0.5], [1, 0.1]]))      # an interburst exists
    normalize(_page("continuous", 40.0, version=2, ibi_floor_at_h=[[0, 0.5], [1, 0.1]]))  # v2 unchanged


# ------------------------------------------------------------------ trend panel annotations

def _annotation_positions(ats, duration=180.0, version=3):
    fig = plt.figure(figsize=(16, 10), dpi=100)
    ax = fig.add_axes([0.225, 0.795, 0.76, 0.10])        # a short top panel, as on trd-suppression-ratio
    ax.set_xlim(0, duration)
    spec = {"spec_version": version, "annotations": [{"at_min": a, "label": "Pentobarbital rate increase"} for a in ats]}
    rp._draw_annotations(fig, [("suppression_ratio_L", ax)], spec, rp.S.theme_for("dark"), duration, 0, 0, 1, 1)
    fig.canvas.draw()
    boxes = [a.get_bbox_patch().get_window_extent() for a in ax.texts]
    top = fig.bbox.height * (1.0 - 0.0)
    plt.close(fig)
    return boxes, top


def test_annotation_labels_stay_below_the_header():
    """trd-suppression-ratio: the second of two far-apart labels went into the header row."""
    boxes, top = _annotation_positions([40.0, 95.0])
    assert abs(boxes[0].y0 - boxes[1].y0) < 1.0                  # far apart: both on the first tier
    boxes, top = _annotation_positions([40.0, 45.0])
    assert boxes[1].y0 >= boxes[0].y1 - 1.0                      # overlapping: stacked directly above
    assert boxes[1].y1 < 0.955 * top                             # under the header row (it sits at ~0.97 of the page)


# ------------------------------------------------------------------ composite page sensitivity

def _composite(page_extra, version=3):
    return {"kind": "composite", "license": "synthetic-original", "attribution": None,
            "spec": {"spec_version": version, "seed": 7, "layout": "panel_over_page",
                     "qeeg_panel": {"age_group": "child", "sample_rate": 256, "channels": "standard_19",
                                    "duration_min": 180, "background": {"type": "continuous", "amplitude_uv": 50},
                                    "events": [{"type": "seizure", "onset_min": 125, "duration_s": 110,
                                                "onset_region": "left_temporal",
                                                "evolution": {"start_hz": 6.0, "end_hz": 2.5,
                                                              "amplitude_start_uv": 80, "amplitude_end_uv": 220}}]},
                     "eeg_page": {"window_s": 15, **page_extra}}}


def test_composite_page_sensitivity_follows_the_page_content():
    """trd-composite-seizure: an unauthored composite page defaulted to 7 uV/mm over a 220-uV seizure."""
    sens = lambda extra, v=3: normalize(_composite(extra, v))["spec"]["eeg_page"]["sensitivity_uv_mm"]  # noqa: E731
    assert sens({"at_min": 126.0}) == 15.0
    assert sens({"at_min": 30.0}) == 7.0
    assert sens({"at_min": 126.0, "sensitivity_uv_mm": 7}) == 7.0
    assert sens({"at_min": 126.0}, v=2) == 7.0
