"""EEG Atlas P7 batch 5 (0.4.3): sporadic epileptiform discharges (keyed, ACNS prevalence) and pediatric normal variants."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

RENDERER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RENDERER))

from eeg_render.export.manifest import acns_prevalence, realized_events, sporadic_summary  # noqa: E402
from eeg_render.spec import normalize, validate_image  # noqa: E402
from eeg_render.synth import Synthesizer  # noqa: E402

FS = 256
H = 3600.0


def _img(events=(), variants=None, age="child", seed=517601, dom=9.0):
    bg = {"type": "continuous", "amplitude_uv": 40.0, "dominant_hz": dom, "slow_fraction": 0.4}
    if variants is not None:
        bg["variants"] = variants
    return {"kind": "eeg_page", "license": "synthetic-original",
            "spec": {"seed": seed, "age_group": age, "sample_rate": FS, "channels": "standard_19", "duration_min": 60,
                     "background": bg, "events": list(events)}}


def _sed(focus, rate_h, amp=90.0, morph="spike", **extra):
    e = {"type": "sporadic_discharges", "focus": focus, "rate_per_h": rate_h, "amplitude_uv": amp, "morphology": morph}
    e.update(extra)
    return e


def _rows(img):
    syn = Synthesizer(normalize(img)["spec"], H)
    return syn, realized_events(syn, H)


def _focus_shape(syn, rows, focus, n=40):
    """Discharge-locked average (background cancels): median FWHM (ms), peak sign, neighbour / contralateral ratios."""
    nb = {"T3": ("F7", "T4"), "F4": ("F8", "F3"), "C4": ("P4", "C3")}[focus]
    sel = [r for r in rows if r["kind"] == "sporadic_discharge" and r["focus"] == focus and 300 < r["onset_s"] < 3500][:n]
    epochs = []
    for r in sel:
        t0 = r["onset_s"] + 0.04
        t, x = syn.segment(t0 - 0.3, t0 + 0.6)
        x = x - np.median(x, axis=1, keepdims=True)
        m = (t > t0 - 0.06) & (t < t0 + 0.06)
        k = int(np.flatnonzero(m)[np.argmin(x[syn._idx[focus]][m])])
        if k - 64 >= 0 and k + 128 <= x.shape[1]:
            epochs.append(x[:, k - 64:k + 128])
    avg = np.mean(epochs, axis=0)
    y = avg[syn._idx[focus]]
    k = 64
    half = y[k] / 2
    lo = k
    while lo > 0 and y[lo] < half:
        lo -= 1
    hi = k
    while hi < y.size - 1 and y[hi] < half:
        hi += 1
    fw = (hi - lo) / FS * 1000.0
    # generator field: divide out the per-electrode scalp gain (channel_gain_max) that multiplies everything
    g = syn._ch_gain
    near = (abs(avg[syn._idx[nb[0]], k]) / g[syn._idx[nb[0]]]) / (abs(y[k]) / g[syn._idx[focus]])
    far = abs(avg[syn._idx[nb[1]], k]) / abs(y[k])
    return float(fw), float(np.sign(y[k])), float(near), float(far)


def test_schema_defaults_and_bank_invariance():
    img = _img([_sed("T3", 120)], variants={"posts": {}})
    assert validate_image(img) == []
    n = normalize(img)["spec"]
    assert n["events"][0]["aftergoing_slow"] is True and n["events"][0]["morphology"] == "spike"
    assert n["background"]["variants"]["posts"] == {"amplitude_uv": 70.0, "rate_per_min": 6.0, "enabled": True}
    plain = normalize(_img())["spec"]
    assert "variants" not in plain["background"]           # existing bank specs gain no key (hash stability)
    assert validate_image(_img([_sed("T3", 10, morph="blob")])) != []


def test_prevalence_categories_from_realized_counts():
    assert acns_prevalence(0, H) == "none" and acns_prevalence(1, 2 * H) == "rare"
    assert acns_prevalence(5, H) == "occasional" and acns_prevalence(100, H) == "frequent" and acns_prevalence(400, H) == "abundant"
    _, rows = _rows(_img([_sed("T3", 120), _sed("F4", 8, amp=130, morph="sharp_wave")]))
    s = {x["focus"]: x for x in sporadic_summary(rows, H)}
    assert 90 <= s["T3"]["count"] <= 150 and s["T3"]["acns_prevalence"] == "frequent"
    assert 3 <= s["F4"]["count"] <= 14 and s["F4"]["acns_prevalence"] == "occasional"
    _, rows2 = _rows(_img([_sed("T3", 480)]))
    assert sporadic_summary(rows2, H)[0]["acns_prevalence"] == "abundant"


def test_spike_and_sharp_wave_morphology_and_field():
    syn, rows = _rows(_img([_sed("T3", 120), _sed("F4", 30, amp=130, morph="sharp_wave")]))
    fw, sign, near, far = _focus_shape(syn, rows, "T3")
    assert fw < 70.0 and sign < 0                    # a spike is < 70 ms and surface-negative
    assert 0.15 <= near <= 0.7 and far < 0.15        # a field: first neighbour a third or so, contralateral ~none
    fw2, sign2, _, _ = _focus_shape(syn, rows, "F4")
    assert 70.0 <= fw2 <= 200.0 and sign2 < 0        # a sharp wave is 70-200 ms


def test_variants_are_state_gated_and_keyed_normal():
    variants = {"hypnagogic_hypersynchrony": {}, "posts": {}, "posterior_slow_waves_of_youth": {}}
    syn, rows = _rows(_img([{"type": "state_change", "at_min": 10.0, "to": "sleep"}], variants=variants))
    vr = [r for r in rows if r["kind"] == "normal_variant"]
    assert vr and all(r["normal_variant"] is True for r in vr)
    for name, lo, hi in (("hypnagogic_hypersynchrony", 0.15, 0.75), ("posts", 0.55, 1.01), ("posterior_slow_waves_of_youth", -0.01, 0.2)):
        ts = np.array([r["onset_s"] for r in vr if r["variant"] == name])
        assert ts.size >= 3, name
        s = syn._sleep_at(ts)
        assert s.min() >= lo - 0.05 and s.max() <= hi + 0.05, (name, s.min(), s.max())
    f = np.array([r["frequency_hz"] for r in vr if r["variant"] == "hypnagogic_hypersynchrony"])
    assert f.min() >= 3.0 and f.max() <= 5.0
    _, plain = _rows(_img([{"type": "state_change", "at_min": 10.0, "to": "sleep"}]))
    assert not [r for r in plain if r["kind"] == "normal_variant"]


def test_posts_are_occipital_and_positive():
    syn, rows = _rows(_img([{"type": "state_change", "at_min": 5.0, "to": "sleep"}], variants={"posts": {"amplitude_uv": 90.0}}))
    runs = [r for r in rows if r["kind"] == "normal_variant" and 600 < r["onset_s"] < 3000][:10]
    pos, occ = [], []
    for r in runs:
        t, x = syn.segment(r["onset_s"] - 0.2, r["offset_s"] + 0.2)
        o1 = x[syn._idx["O1"]] - np.median(x[syn._idx["O1"]])
        pos.append(o1.max() / max(-o1.min(), 1e-9))
        occ.append(np.ptp(o1) / np.ptp(x[syn._idx["F3"]]))
    assert np.median(pos) > 1.2 and np.median(occ) > 1.5
