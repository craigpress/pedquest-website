"""r7 (Craig, 2026-09-27): awake child background voltage and periodic-discharge polarity (spec_version 3 only).

A. The default awake child background is 90 uV on the longitudinal bipolar page (normal awake child EEG runs 80-100 uV
   there; the 45-uV default read low-voltage against the learningeeg 5-year-old figures).  Event defaults tuned as
   absolute voltages against the old default keep their ratio to it; authored voltages never change.
B. ACNS 2021 polarity (dominant phase, referential montage): periodic discharges default to surface-negative, maximal at
   the source (upward on the negative-up page); ``dipole`` adds a positive pole at a distinct electrode; triphasic keeps
   its positive phase 2; the key reports what was rendered.  SeLECTS centrotemporal spikes carry the horizontal dipole
   (frontal positivity).  Measurement as tests/test_r050_fix_acns.py: page chain 1-70 Hz; a pattern's own
   contribution is the record minus the same record without it.
"""
import copy
from functools import lru_cache

import numpy as np
import pytest
import scipy.signal as sps

from eeg_render import montage as mt
from eeg_render.export.manifest import realized_events
from eeg_render.render_page import apply_filters, build_filters, page_signals
from eeg_render.spec import AGE_DEFAULTS, CHILD_AMPLITUDE_UV_V3, normalize
from eeg_render.synth import Synthesizer

FS = 256
FILT = {"lf_hz": 1.0, "hf_hz": 70.0}
# the P5 C13 child background with its amplitude left to the default
CHILD = dict(type="continuous", dominant_hz=9.0, slow_fraction=0.4, reactivity="present", channel_gain_max=1.5,
             pdr_gain=3.0)
ICU = dict(type="continuous", amplitude_uv=30.0, dominant_hz=3.0, slow_fraction=0.8, reactivity="absent",
           channel_gain_max=1.5, blink_rate_per_min=0)


def _img(events=(), bg=CHILD, age="child", version=3, seed=515401, dur=30, kind="qeeg_panel", page=None):
    spec = {"sample_rate": FS, "channels": "standard_19", "seed": seed, "spec_version": version, "age_group": age,
            "duration_min": dur, "background": copy.deepcopy(bg), "events": copy.deepcopy(list(events))}
    spec.update(page or {})
    return {"kind": kind, "license": "synthetic-original", "attribution": None, "spec": spec}


def _p2p1s(y):
    n = y.shape[-1] // FS
    return np.ptp(y[..., : n * FS].reshape(*y.shape[:-1], n, FS), axis=-1)


def _awake_page_p2p(version, seed=515401, bg=CHILD, a=60.0, pages=4):
    """Median 1-s p2p per longitudinal-bipolar row over ``pages`` 30-s pages, as the reader measures it."""
    img = _img(bg=bg, version=version, seed=seed, kind="eeg_page",
               page={"at_min": a / 60.0, "window_s": 30.0, "montage": "longitudinal_bipolar", "sensitivity_uv_mm": 7.0})
    spec = normalize(img)["spec"]
    syn = Synthesizer(spec, 1800.0)
    ys = []
    for k in range(pages):
        spec = dict(spec, at_min=(a + 30.0 * k) / 60.0)
        _, _, y, pairs, _ = page_signals(spec, synth=syn)
        ys.append(y)
    names = [f"{p}-{q}" for p, q in pairs]
    med = np.median(_p2p1s(np.concatenate(ys, axis=1)), -1)
    return syn, dict(zip(names, med)), float(np.median([m for n, m in zip(names, med) if not n.startswith("Fp")]))


# ------------------------------------------------------------------------------------------ A. child voltage

@pytest.mark.parametrize("seed", [515401, 517608])
def test_child_awake_bipolar_voltage_v3(seed):
    """Awake child page: the blink-free longitudinal-bipolar median, and the C3-P3 / P3-O1 mean a reader measures,
    land at 80-100 uV (nominal 90)."""
    syn, rows, nonfp = _awake_page_p2p(3, seed)
    assert syn.bg["amplitude_uv"] == CHILD_AMPLITUDE_UV_V3 == 90.0
    assert 80.0 <= nonfp <= 100.0, nonfp
    cp = 0.5 * (rows["C3-P3"] + rows["P3-O1"])
    assert 75.0 <= cp <= 105.0, (rows["C3-P3"], rows["P3-O1"])


def test_child_voltage_unchanged_below_v3_and_elsewhere():
    """spec_version 2 keeps the 45-uV child default (and its display); other ages, authored child voltages and
    non-continuous child backgrounds keep theirs at v3."""
    syn, _, nonfp = _awake_page_p2p(2)
    assert syn.bg["amplitude_uv"] == AGE_DEFAULTS["child"]["amplitude_uv"] == 45.0
    assert 36.0 <= nonfp <= 54.0, nonfp
    for age in ("neonate", "infant", "adolescent", "adult"):
        bg = normalize(_img(bg={"type": "continuous"} if age != "neonate" else {}, age=age))["spec"]["background"]
        assert bg["amplitude_uv"] == AGE_DEFAULTS[age]["amplitude_uv"], age
    assert normalize(_img(bg=dict(CHILD, amplitude_uv=40.0)))["spec"]["background"]["amplitude_uv"] == 40.0
    for t in ("suppressed", "low_voltage", "burst_suppression"):
        assert normalize(_img(bg=dict(CHILD, type=t)))["spec"]["background"]["amplitude_uv"] == 45.0, t


def test_child_event_defaults_scale_with_the_default_background():
    """On the r7 default background the absolute event defaults tuned against 45 uV double (sporadic 80 -> 160, mu
    60 -> 120, POSTS 70 -> 140); authored values, authored backgrounds and v2 keep them."""
    ev = [{"type": "sporadic_discharges", "focus": "T3"}, {"type": "normal_variant", "kind": "mu", "at_min": 1.0},
          {"type": "sporadic_discharges", "focus": "T4", "amplitude_uv": 90.0}]
    bgv = dict(CHILD, variants={"posts": {}})

    def amps(spec):
        e = spec["events"]
        return e[0]["amplitude_uv"], e[1]["amplitude_uv"], e[2]["amplitude_uv"], spec["background"]["variants"]["posts"]["amplitude_uv"]
    assert amps(normalize(_img(ev, bg=bgv))["spec"]) == (160.0, 120.0, 90.0, 140.0)
    assert amps(normalize(_img(ev, bg=dict(bgv, amplitude_uv=45.0)))["spec"]) == (80.0, 60.0, 90.0, 70.0)
    s2 = normalize(_img(ev[:1] + ev[2:], bg=bgv, version=2))["spec"]
    assert (s2["events"][0]["amplitude_uv"], s2["background"]["variants"]["posts"]["amplitude_uv"]) == (80.0, 70.0)


def test_child_default_sporadic_spike_stays_conspicuous():
    """The default T3 spike stays >= 2x the F7-T3 background (the B5-01 reference ratio) on the 90-uV page."""
    spec = normalize(_img([{"type": "sporadic_discharges", "rate_per_h": 120}], dur=30))["spec"]
    syn = Synthesizer(spec, 1200.0)
    pairs = mt.montage_pairs("longitudinal_bipolar", syn.scalp)
    names = [f"{a}-{b}" for a, b in pairs]
    ratios = []
    for e in [e for e in syn.sporadic_events() if 60.0 < e["t0"] < 1100.0][:8]:
        t0 = float(np.floor(e["t0"])) - 10.0
        _, x = syn.segment(t0 - 8.0, t0 + 15.0)
        y = apply_filters(syn.derive(x, pairs), build_filters(FS, FILT, True), True)[names.index("F7-T3"), 8 * FS:]
        tt = t0 + np.arange(y.size) / FS
        m = (tt > e["t0"] - 0.05) & (tt < e["t0"] + 0.12)
        n = int(0.15 * FS)
        ratios.append(np.ptp(y[m]) / np.median(np.ptp(y[: y.size // n * n].reshape(-1, n), -1)))
    assert np.median(ratios) >= 2.0, ratios


# ------------------------------------------------------------------------------------------ B. PD polarity

def _rpp(pattern, hz, amp, region, **extra):
    e = dict(type="rhythmic_pattern", pattern=pattern, frequency_hz=hz, amplitude_uv=amp, onset_region=region,
             periodic=True, onset_min=1.0, duration_min=12.0, run_duration_s=30.0)
    e.update(extra)
    return e


CASES = {
    "lpd": _rpp("LPDs", 1.0, 100, "left_temporal"),
    "lpd_sharp": _rpp("LPDs", 1.0, 100, "left_temporal", sharpness="sharp"),     # the phase-D path
    "lpd_pos": _rpp("LPDs", 1.0, 100, "left_temporal", polarity="surface_positive"),
    "lpd_dip": _rpp("LPDs", 1.0, 100, "left_temporal", polarity="dipole"),
    "lpd_dip_sharp": _rpp("LPDs", 1.0, 100, "left_temporal", polarity="dipole", sharpness="sharp"),
    "gpd": _rpp("GPDs", 1.5, 100, "generalized"),
    "tri": _rpp("triphasic", 1.8, 110, "generalized"),
}


@lru_cache(maxsize=None)
def _case(key, version=3):
    def syn(ev):
        return Synthesizer(normalize(_img(ev, bg=ICU, age="adult", version=version, seed=771203, dur=30))["spec"], 900.0)
    return syn([CASES[key]]), syn([])


def _peaks(key, version=3, montage=None):
    """(names, per-discharge values at each discharge's largest-deflection sample) of the pattern's own signal."""
    a, b = _case(key, version)
    z = a.rhythmic_patterns[0]
    t0, t1 = z.t0 + 2.0, z.t0 + 22.0
    out = []
    for s in (a, b):
        _, x = s.segment(t0 - 8.0, t1)
        if montage is None:
            d, names = x[[s._idx[e] for e in s.scalp]], list(s.scalp)
        elif montage == "average":
            sc = x[[s._idx[e] for e in s.scalp]]
            d, names = sc - sc.mean(0, keepdims=True), list(s.scalp)
        else:
            pairs = mt.montage_pairs(montage, s.scalp)
            d, names = s.derive(x, pairs), [f"{p}-{q}" for p, q in pairs]
        out.append(apply_filters(d, build_filters(FS, FILT, True), True)[:, 8 * FS:])
    pat = out[0] - out[1]
    env = np.abs(pat).max(0)
    pk, _ = sps.find_peaks(env, distance=int(0.4 * FS / z.start_hz), height=0.5 * env.max())
    return names, pat[:, pk], a


@pytest.mark.parametrize("key", ["lpd", "lpd_sharp"])
@pytest.mark.parametrize("montage", [None, "average"])
def test_pd_default_is_surface_negative_maximal_at_the_source(key, montage):
    """Referential (and average reference): the source electrode T3 carries the largest deflection of every discharge,
    and it is negative (drawn upward)."""
    names, v, _ = _peaks(key, montage=montage)
    assert v.shape[1] >= 10
    big = np.argmax(np.abs(v), axis=0)
    assert (np.array(names)[big] == "T3").mean() >= 0.9, np.array(names)[big]
    assert (v[names.index("T3")] < 0).all()


def test_pd_default_bipolar_reversal_points_at_the_source():
    """Longitudinal bipolar (negative up): F7-T3 deflects down (positive) and T3-T5 up (negative), pointing toward each
    other at T3, in every discharge."""
    names, v, _ = _peaks("lpd", montage="longitudinal_bipolar")
    assert (v[names.index("F7-T3")] > 0).all() and (v[names.index("T3-T5")] < 0).all()


def test_pd_surface_positive_stays_available_and_v2_is_unchanged():
    for key, version in (("lpd_pos", 3), ("lpd", 2)):
        names, v, _ = _peaks(key, version)
        assert (v[names.index("T3")] > 0).all(), (key, version)


@pytest.mark.parametrize("key", ["lpd_dip", "lpd_dip_sharp"])
def test_dipole_has_opposite_poles(key):
    """A tangential dipole: T3 negative, Fp1 positive at 0.4-0.8 of it, in every discharge, on the referential page."""
    names, v, _ = _peaks(key)
    t3, fp1 = v[names.index("T3")], v[names.index("Fp1")]
    assert (t3 < 0).all() and (fp1 > 0).all()
    assert 0.4 <= np.median(fp1 / -t3) <= 0.8, np.median(fp1 / -t3)
    big = np.argmax(np.abs(v), axis=0)
    assert (np.array(names)[big] == "T3").mean() >= 0.9


@pytest.mark.parametrize("key,pol,acns", [("lpd", "surface_negative", "negative"),
                                          ("lpd_sharp", "surface_negative", "negative"),
                                          ("lpd_pos", "surface_positive", "positive"),
                                          ("lpd_dip", "dipole", "dipole"),
                                          ("gpd", "surface_negative", "negative"),
                                          ("tri", "surface_positive", "positive")])
def test_key_reports_rendered_polarity(key, pol, acns):
    """The answer key carries the polarity the discharge was drawn with, and its ACNS category; the rendered dominant
    referential deflection has that sign (triphasic: the positive phase 2)."""
    rows = [x for x in realized_events(_case(key)[0], 900.0) if x["kind"] == "rhythmic_pattern"]
    assert rows and all(r["polarity"] == pol and r["polarity_acns"] == acns for r in rows)
    if pol == "dipole":
        assert rows[0]["dipole_positive_pole"] == "Fp1"
    names, v, _ = _peaks(key)
    dom = v[np.argmax(np.abs(v), axis=0), np.arange(v.shape[1])]
    assert (np.sign(dom) == (1 if pol == "surface_positive" else -1)).mean() >= 0.9


@pytest.mark.parametrize("key", ["lpd", "lpd_dip", "lpd_dip_sharp"])
def test_polarity_is_window_independent(key):
    s = _case(key)[0]
    z = s.rhythmic_patterns[0]
    a = z.t0 + 3.3
    t1, x1 = s.segment(a, a + 4.0)
    t2, x2 = s.segment(a - 17.0, a + 11.0)
    k = np.searchsorted(t2, t1[0] - 1e-9)
    assert np.allclose(t2[k:k + t1.size], t1) and np.allclose(x2[:, k:k + t1.size], x1, atol=1e-9)


# ------------------------------------------------------------------------------------------ SeLECTS dipole

def test_centrotemporal_spike_is_a_horizontal_dipole():
    """SeLECTS: negative at C3/T3, positive frontal pole (Fp1 >= 0.3 of the C3 peak, Fz positive) on the
    referential page, in every discharge; the chain still reverses at C3 and not at Cz."""
    ev = [{"type": "sporadic_discharges", "focus": "left_centrotemporal", "rate_per_h": 600, "amplitude_uv": 120.0,
           "morphology": "sharp_wave"}]
    s = Synthesizer(normalize(_img(ev, bg=dict(CHILD, amplitude_uv=40.0, blink_rate_per_min=0), seed=551178))["spec"],
                    300.0)
    t = np.arange(int(24 * FS), int(290 * FS)) / FS
    rows = s._sed_rows(t)
    ref = apply_filters(rows[[s._idx[e] for e in s.scalp]], build_filters(FS, FILT, True), True)
    names = list(s.scalp)
    n = 0
    for r in s._sed:
        if 31 < r[0] < 289:
            m = (t > r[0] - 0.03) & (t < r[0] + 0.05)
            seg = ref[:, m]
            j = int(np.argmax(np.abs(seg[names.index("C3")])))
            v = seg[:, j]
            assert v[names.index("C3")] < 0 and v[names.index("T3")] < 0
            assert v[names.index("Fp1")] >= 0.3 * -v[names.index("C3")] and v[names.index("Fz")] > 0
            n += 1
    assert n >= 20
    # window independence of the new field
    t1, x1 = s.segment(100.0, 104.0)
    t2, x2 = s.segment(90.0, 120.0)
    k = np.searchsorted(t2, t1[0] - 1e-9)
    assert np.allclose(x2[:, k:k + t1.size], x1, atol=1e-9)
