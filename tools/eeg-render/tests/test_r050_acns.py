"""0.5.0 phase D, ACNS 2021 critical-care patterns (research/eeg-atlas/feature-review-20260926/acns-review.md).

Definitions: Hirsch et al., ACNS Standardized Critical Care EEG Terminology 2021 (J Clin Neurophysiol 38:1-29,
PMC8135051), figures 23-42 cached under research/eeg-atlas/references/cache/acns/acns2021_*.jpg.  Teaching figures:
learningeeg rhythmicity-periodicity chapter (birds-clean/-annotated: right temporal BIRDs 4-5 Hz for 7 s;
possible-birds-ty; triphasic-gpds, periodic-triphasics, tinyc-Triphasic-and-FIRDA; gpds-plus-f; grda-plus-s;
ncse-gpds), cached under research/eeg-atlas/references/cache/learningeeg/ (internal comparison only).

Measurements are on the displayed signal: longitudinal bipolar through the causal 1-70 Hz page chain.  A pattern's
own contribution is (record - the same record without the pattern); the chain is linear and the background is drawn
independently of the events, so this is exactly what the pattern adds to the page.
"""
import copy
from functools import lru_cache

import numpy as np
import pytest
import scipy.signal as sps

from eeg_render import montage as mt
from eeg_render import rpp_v3
from eeg_render.export.manifest import _summary, realized_events
from eeg_render.render_page import apply_filters, build_filters
from eeg_render.spec import normalize, spec_warnings
from eeg_render.synth import Synthesizer

FS = 256
ICU = dict(type="continuous", amplitude_uv=30.0, dominant_hz=3.0, slow_fraction=0.8, reactivity="absent",
           channel_gain_max=1.5, blink_rate_per_min=0)
CHILD = dict(type="continuous", amplitude_uv=40.0, dominant_hz=9.0, slow_fraction=0.35, reactivity="present",
             channel_gain_max=1.5)
FILT = {"lf_hz": 1.0, "hf_hz": 70.0}


def _img(events, bg=ICU, age="adult", version=3, seed=518101):
    return {"kind": "qeeg_panel", "license": "synthetic-original", "attribution": None,
            "spec": {"sample_rate": FS, "channels": "standard_19", "seed": seed, "spec_version": version,
                     "age_group": age, "duration_min": 30, "background": dict(bg), "events": events}}


def _syn(events, **kw):
    return Synthesizer(normalize(_img(events, **kw))["spec"], 1800.0)


def _rpp(pattern, hz, amp, region, periodic, **extra):
    e = dict(type="rhythmic_pattern", pattern=pattern, frequency_hz=hz, amplitude_uv=amp, onset_region=region,
             periodic=periodic, onset_min=2.0, duration_min=10.0, run_duration_s=30.0)
    e.update(extra)
    return e


@lru_cache(maxsize=None)
def _pair(key):
    events, kw = CASES[key]
    events = copy.deepcopy(events)
    keep = [e for e in events if e["type"] == "stimulation"]
    return _syn(events, **kw), _syn(keep, **kw)


def _disp(s, t0, t1, pad=8.0):
    pairs = mt.montage_pairs("longitudinal_bipolar", s.scalp)
    _, x = s.segment(t0 - pad, t1)
    d = apply_filters(s.derive(x, pairs), build_filters(FS, FILT, True), True)
    return d[:, int(round(pad * FS)):], [f"{a}-{b}" for a, b in pairs]


def _ref(s, t0, t1, pad=8.0):
    """Referential electrode potentials (no reference subtraction) through the same filters."""
    _, x = s.segment(t0 - pad, t1)
    d = apply_filters(x[[s._idx[e] for e in s.scalp]], build_filters(FS, FILT, True), True)
    return d[:, int(round(pad * FS)):], list(s.scalp)


def _pattern(key, t0, t1, ref=False):
    a, b = _pair(key)
    f = _ref if ref else _disp
    (A, names), (B, _) = f(a, t0, t1), f(b, t0, t1)
    return A - B, B, names


def _sec_ptp(y):
    n = y.shape[-1] // FS
    return np.ptp(y[..., : n * FS].reshape(*y.shape[:-1], n, FS), axis=-1)


CASES = {
    "birds": ([_rpp("BIRDs", 4.5, 80, "right_temporal", False, run_duration_s=7.0, prevalence="frequent")], {}),
    "birds_evo": ([_rpp("BIRDs", 5.0, 80, "left_temporal", False, run_duration_s=6.0, modifier="evolving")], {}),
    "sirpids": ([_rpp("GPDs", 1.5, 90, "generalized", True, stimulus_induced=True, run_duration_s=40.0),
                 dict(type="stimulation", at_min=4.0, stimulus="sternal_rub"),
                 dict(type="stimulation", at_min=8.0, stimulus="suction")], {}),
    "tri": ([_rpp("triphasic", 1.8, 110, "generalized", True)], {}),
    "tri_pa": ([_rpp("triphasic", 1.8, 110, "generalized", True, lag="posterior_anterior")], {}),
    "evolving": ([_rpp("LPDs", 1.0, 100, "left_temporal", True, modifier="evolving", run_duration_s=24.0,
                       prevalence="frequent", evolution=dict(start_hz=1.0, end_hz=3.0))], {}),
    "fluct": ([_rpp("LRDA", 1.5, 80, "left_temporal", False, modifier="fluctuating", run_duration_s=60.0)], {}),
    "lpd_f1": ([_rpp("LPDs", 1.0, 100, "left_temporal", True, plus_modifier="+F")], {}),
    "lpd_f2": ([_rpp("LPDs", 2.0, 100, "left_temporal", True, plus_modifier="+F")], {}),
    "lpd_nof1": ([_rpp("LPDs", 1.0, 100, "left_temporal", True, sharpness="sharp")], {}),
    "lpd_nof2": ([_rpp("LPDs", 2.0, 100, "left_temporal", True, sharpness="sharp")], {}),
    "lpd_r": ([_rpp("LPDs", 0.8, 100, "left_temporal", True, plus_modifier="+R")], {}),
    "edb": ([_rpp("EDB", 1.5, 150, "generalized", False, duration_min=20.0)],
            dict(bg=dict(CHILD, reactivity="absent", dominant_hz=4.0, slow_fraction=0.7, pdr_gain=0.0), age="child")),
    "spiky": ([_rpp("LPDs", 1.0, 100, "left_temporal", True, sharpness="spiky")], {}),
    "sharp": ([_rpp("LPDs", 1.0, 100, "left_temporal", True, sharpness="sharp")], {}),
    "blunt": ([_rpp("LPDs", 1.0, 100, "left_temporal", True, sharpness="blunt")], {}),
    "gpd_plain": ([_rpp("GPD", 2.0, 110, "generalized", True)], {}),
    "atten": ([dict(type="stimulation", at_min=5.0, stimulus="auditory", response="attenuation")],
              dict(bg=CHILD, age="child")),
    "parad": ([dict(type="stimulation", at_min=5.0, stimulus="sternal_rub", response="paradoxical")],
              dict(bg=dict(ICU, dominant_hz=6.0, slow_fraction=0.5))),
}


def _runs(key):
    return _pair(key)[0].rhythmic_patterns


def _key(key):
    s = _pair(key)[0]
    return realized_events(s, 1800.0), _summary(s, 1800.0)


# ------------------------------------------------------------------------------------------------ BIRDs

def test_birds_are_one_focal_run_above_4hz_not_bipd():
    """synth.py sent any "BIRD*" pattern to two hemispheric clocks at 0.88x/1.12x (the BIPD path; GAP_ANALYSIS code
    finding 1).  ACNS 2021 E: focal rhythmic activity > 4 Hz, >= 6 waves, 0.5 to < 10 s.  birds-annotated: right
    temporal 4-5 Hz for 7 s, F8-T4/T4-T6/T6-O2 max, about 2-3x the background, nothing on the left."""
    runs = _runs("birds")
    assert runs and all(z.onset_region == "right_temporal" for z in runs)
    assert all(0.5 <= z.duration_s < 10.0 and z.start_hz > 4.0 and z.duration_s * z.start_hz >= 6 for z in runs)
    z = max(runs[:6], key=lambda r: r.duration_s)
    pat, bg, names = _pattern("birds", z.t0 + 0.5, z.t1 - 0.3)
    r = np.median(_sec_ptp(pat), axis=-1) / np.median(_sec_ptp(bg), axis=-1)
    right = [names.index(n) for n in ("F8-T4", "T4-T6")]
    left = [names.index(n) for n in ("F7-T3", "T3-T5")]
    assert r[right].min() >= 1.8, r[right]
    assert r[left].max() <= 0.35 * r[right].min(), (r[left], r[right])
    y = pat[names.index("T4-T6")]
    f, p = sps.welch(y, FS, nperseg=min(y.size, 2 * FS))
    assert 4.0 <= f[np.argmax(p * (f > 2))] <= 6.0
    rows, _ = _key("birds")
    br = [x for x in rows if x["kind"] == "rhythmic_pattern"]
    assert br and all(x["acns_classification"] == "BIRDs_possible" for x in br)
    assert all(x["duration_category"] == "very_brief" for x in br)


def test_evolving_birds_are_definite():
    """ACNS 2021 E(a) / Fig 41A: BIRDs with evolution are definite BIRDs; evolution = >= 2 consecutive changes of
    >= 0.5 Hz in the same direction."""
    z = _runs("birds_evo")[0]
    lv = [s[1] for s in z.rpp["steps"]]
    d = np.diff(lv)
    assert len(lv) >= 3 and (d >= 0.5 - 1e-9).all() and z.duration_s < 10.0
    rows, _ = _key("birds_evo")
    assert {x["acns_classification"] for x in rows if x["kind"] == "rhythmic_pattern"} == {"BIRDs_definite"}


def test_v2_birds_keep_the_legacy_path_and_warn():
    """Version 1/2 stay byte-identical: BIRDs still use the BIPD construction there, and spec_warnings says so."""
    ev = _rpp("BIRDs", 4.5, 80, "right_temporal", False, run_duration_s=7.0)
    s = _syn([ev], version=2)
    assert {z.onset_region for z in s.rhythmic_patterns} == {"left_temporal", "right_temporal"}
    w = spec_warnings(normalize(_img([dict(ev, sharpness="blunt")], version=2)))
    assert any("not synthesized below spec_version 3" in x and "BIPD" in x for x in w)
    a = _syn([dict(ev, pattern="LPDs", periodic=True, sharpness="blunt", plus_modifier="+R")], version=2)
    b = _syn([dict(ev, pattern="LPDs", periodic=True, plus_modifier="+R")], version=2)
    assert np.array_equal(a.segment(300.0, 304.0)[1], b.segment(300.0, 304.0)[1])


# ------------------------------------------------------------------------------------------------ SIRPIDs

def test_sirpids_follow_each_stimulus_and_are_absent_otherwise():
    """ACNS 2021 C3g: SI- = reproducibly brought about by an alerting stimulus.  Runs start 0.5-3 s after every
    stimulation; before the first stimulus the pattern contributes nothing; within 6 s it is at least 2x the
    background on the frontal chain.  Key: SI-GPDs, stimulus index/latency, SIRPIDs-only reactivity."""
    runs = _runs("sirpids")
    stims = [240.0, 480.0]
    assert len(runs) == 2
    for z, a in zip(runs, stims):
        assert 0.5 <= z.t0 - a <= 3.0
    pat, bg, names = _pattern("sirpids", 200.0, 238.0)
    assert np.abs(pat).max() < 1e-6
    pat, bg, names = _pattern("sirpids", 244.0, 256.0)
    i = names.index("F3-C3")
    assert np.median(_sec_ptp(pat[i])) >= 2.0 * np.median(_sec_ptp(bg[i]))
    rows, _ = _key("sirpids")
    rr = [x for x in rows if x["kind"] == "rhythmic_pattern"]
    assert [x["stimulus_index"] for x in rr] == [0, 1] and all(x["acns_label"] == "SI-GPDs" for x in rr)
    st = [x for x in rows if x["kind"] == "stimulation"]
    assert [x["stimulus"] for x in st] == ["sternal_rub", "suction"]
    assert all(x["acns_reactivity"] == "SIRPIDs-only" and len(x["induced_runs"]) == 1 for x in st)


# ------------------------------------------------------------------------------------------------ evolution / IIC

def test_evolving_lpds_step_by_half_hz_and_key_as_seizure():
    """ACNS 2021 C3h: evolution in frequency = >= 2 consecutive changes in the same direction by >= 0.5 Hz, each level
    persisting >= 3 cycles; an RPP evolving for >= 10 s is an ESz (criterion B).  Measured: discharge rate counted on
    the displayed F7-T3/T3-T5 pattern in the first and last level."""
    z = _runs("evolving")[0]
    st = z.rpp["steps"]
    lv = np.array([s[1] for s in st])
    ts = np.array([s[0] for s in st] + [z.duration_s])
    assert (np.diff(lv) >= 0.5 - 1e-9).all() and len(lv) >= 3
    assert all((ts[k + 1] - ts[k]) * lv[k] >= 3.0 for k in range(len(lv)))
    for k in (0, len(lv) - 1):
        a, b = z.t0 + ts[k] + 0.3, z.t0 + ts[k + 1] - 0.3
        pat, _, names = _pattern("evolving", a, b)
        y = pat[names.index("T3-T5")]
        pk, _ = sps.find_peaks(np.abs(y), height=0.45 * np.abs(y).max(), distance=int(0.6 / lv[k] * FS))
        rate = (pk.size - 1) / ((pk[-1] - pk[0]) / FS)
        assert abs(rate - lv[k]) <= 0.25 * lv[k], (k, rate, lv[k])
    rows, summ = _key("evolving")
    assert summ["seizure_burden"]["count"] >= 1          # ESz-keyed runs count toward the seizure burden
    r0 = [x for x in rows if x["kind"] == "rhythmic_pattern"][0]
    assert r0["acns_classification"] == "electrographic_seizure" and "criterion B" in r0["classification_basis"]
    assert r0["evolution"] == "evolving" and r0["min_hz"] == 1.0 and r0["max_hz"] == 3.0


def test_fluctuating_changes_frequency_not_just_voltage():
    """ACNS 2021: fluctuating = >= 3 changes <= 1 min apart by >= 0.5 Hz, not evolving; voltage change alone is
    neither (the 0.4.0 'fluctuating' modifier only raised the amplitude wax/wane)."""
    for z in _runs("fluct")[:3]:
        st = z.rpp["steps"]
        lv = np.array([s[1] for s in st])
        ts = np.array([s[0] for s in st])
        assert len(lv) >= 4 and (np.abs(np.diff(lv)) >= 0.5 - 1e-9).all()
        assert (np.sign(np.diff(lv))[1:] != np.sign(np.diff(lv))[:-1]).all()      # back and forth, not evolving
        assert np.diff(ts).max() <= 60.0
    rows, _ = _key("fluct")
    r0 = [x for x in rows if x["kind"] == "rhythmic_pattern"][0]
    assert r0["evolution"] == "fluctuating" and r0["acns_classification"] == "IIC"     # LRDA > 1 Hz + fluctuation


@pytest.mark.parametrize("ev,expect", [
    (_rpp("GPDs", 3.0, 110, "generalized", True, prevalence="abundant", rate_jitter=0.0), ("electrographic_seizure", "criterion A")),
    (_rpp("GPDs", 2.0, 110, "generalized", True, sharpness="sharp", rate_jitter=0.0), ("IIC", "> 1 and <= 2.5")),
    (_rpp("LPDs", 0.8, 100, "left_temporal", True, plus_modifier="+F", rate_jitter=0.0), ("IIC", "plus modifier")),
    (_rpp("LPDs", 0.8, 100, "left_temporal", True, sharpness="sharp", rate_jitter=0.0), ("RPP_interictal", None)),
    (_rpp("LRDA", 1.5, 80, "left_temporal", False, plus_modifier="+S", rate_jitter=0.0), ("IIC", "lateralized RDA")),
    (_rpp("GRDA", 1.5, 80, "generalized", False, plus_modifier="+S", rate_jitter=0.0), ("RPP_interictal", None)),
])
def test_acns_2_5_hz_rule_and_iic_classification(ev, expect):
    """ACNS 2021 D1 (ESz A: discharges averaging > 2.5 Hz for >= 10 s) and F (IIC rules 1-3; GRDA is excluded from
    rule 3).  Checked on the realized runs of the key."""
    s = _syn([ev])
    rows = [x for x in realized_events(s, 1800.0) if x["kind"] == "rhythmic_pattern"
            and x["offset_s"] - x["onset_s"] >= 10.0]
    assert rows
    for x in rows:
        assert x["acns_classification"] == expect[0], x
        if expect[1]:
            assert expect[1] in x["classification_basis"]


# ------------------------------------------------------------------------------------------------ triphasic

def test_triphasic_kernel_phases():
    """ACNS 2021 C4b: three phases negative-positive-negative, each longer than the previous, the positive the
    largest (surface potential; the page draws negative up)."""
    tau = np.linspace(-0.3, 0.6, 9001)
    k = rpp_v3.tri_kernel(tau)
    s = np.sign(k)
    s[np.abs(k) < 0.02] = 0
    lobes, cur, start = [], 0, 0
    for i, v in enumerate(s):
        if v != cur:
            if cur != 0:
                lobes.append((cur, tau[i] - tau[start], np.abs(k[start:i]).max()))
            cur, start = v, i
    assert [l[0] for l in lobes] == [-1, 1, -1]
    assert lobes[0][1] < lobes[1][1] < lobes[2][1]
    assert lobes[1][2] > lobes[2][2] > lobes[0][2]


def _lag_ms(key):
    z = max(_runs(key)[:4], key=lambda r: r.duration_s)
    pat, _, names = _pattern(key, z.t0 + 0.3 * z.duration_s, z.t0 + 0.3 * z.duration_s + 12.0, ref=True)
    a, p = pat[names.index("Fz")], pat[names.index("Pz")]
    c = sps.correlate(p, a, mode="full")
    lags = sps.correlation_lags(p.size, a.size, mode="full")
    m = np.abs(lags) <= int(0.3 * FS)
    return lags[m][np.argmax(c[m])] / FS * 1000.0, pat, names


def test_triphasic_gpds_have_an_anterior_posterior_lag_and_frontal_maximum():
    """ACNS 2021 C4c / Fig 37: an A-P lag is a consistent delay > 100 ms from the most anterior to the most posterior
    derivation (triphasic-gpds, periodic-triphasics: the complex marches back along the chain).  Measured Fz -> Pz
    lag by cross-correlation of the pattern's referential potentials: 50-110 ms over the half head (Fp -> O twice
    that, > 100 ms); posterior_anterior reverses the sign.  Frontal maximum: Fz >= 1.6x Pz."""
    lag, pat, names = _lag_ms("tri")
    assert 45.0 <= lag <= 110.0, lag
    lag_pa, _, _ = _lag_ms("tri_pa")
    assert -110.0 <= lag_pa <= -45.0, lag_pa
    fz, pz = np.median(_sec_ptp(pat[names.index("Fz")])), np.median(_sec_ptp(pat[names.index("Pz")]))
    assert fz >= 1.6 * pz, (fz, pz)
    rows, _ = _key("tri")
    r0 = [x for x in rows if x["kind"] == "rhythmic_pattern"][0]
    assert r0["triphasic"] and r0["lag_ms"] == 120.0 and r0["acns_label"] == "GPDs"


def test_triphasic_gpds_dominate_the_bipolar_page():
    """triphasic-gpds / periodic-triphasics / gpds-plus-f: the complexes dominate the anterior bipolar derivations
    (review baseline: 0.5-1.2x the background, lost in it).  Pattern at >= 3x the background on F3-C3, Fz-Cz,
    Fp1-F3; the ACNS voltage (max bipolar channel) lands within 25 % of amplitude_uv."""
    z = max(_runs("tri")[:4], key=lambda r: r.duration_s)
    pat, bg, names = _pattern("tri", z.t0 + 0.3 * z.duration_s, z.t0 + 0.3 * z.duration_s + 20.0)
    r = np.median(_sec_ptp(pat), axis=-1) / np.median(_sec_ptp(bg), axis=-1)
    for n in ("F3-C3", "Fz-Cz", "Fp1-F3"):
        assert r[names.index(n)] >= 3.0, (n, r[names.index(n)])
    top = np.median(_sec_ptp(pat), axis=-1).max()
    assert 0.75 * 110 <= top <= 1.25 * 110, top


def test_plain_v3_gpds_survive_the_bipolar_chain():
    """epileptiform-v3 C26 (remaining item): v3 GPDs were 20-30 uV in bipolar (a quarter of the references' page
    dominance) with a near-flat generalized field.  Now frontally predominant: F3-C3 and Cz-Pz >= 2.5x the background
    and >= 0.3x referential Fz (the review asked 0.5x; a monotonic A-P field gives 0.3-0.4, see acns-review.md), and
    the max bipolar channel within 25 % of amplitude_uv (ACNS voltage)."""
    z = max(_runs("gpd_plain")[:4], key=lambda r: r.duration_s)
    a, b = z.t0 + 0.3 * z.duration_s, z.t0 + 0.3 * z.duration_s + 12.0
    pat, _, names = _pattern("gpd_plain", a, b)
    ref, _, rn = _pattern("gpd_plain", a, b, ref=True)
    fz = np.median(_sec_ptp(ref[rn.index("Fz")]))
    _, bg, _ = _pattern("gpd_plain", a, b)
    # merge with the generalized family (its _gpd_field_scale carries frontal GPDs): F3-C3 >= 0.5x and Cz-Pz >= 0.2x
    # referential Fz, the split test_r050_generalized.test_gpd_survives_the_bipolar_chain documents
    for n, share in (("F3-C3", 0.3), ("Cz-Pz", 0.2)):
        v = np.median(_sec_ptp(pat[names.index(n)]))
        assert v >= share * fz and v >= 2.5 * np.median(_sec_ptp(bg[names.index(n)])), (n, v, fz)
    top = np.median(_sec_ptp(pat), axis=-1).max()
    assert 0.75 * 110 <= top <= 1.25 * 110, top


# ------------------------------------------------------------------------------------------------ sharpness

def _dominant_phase_ms(key):
    """Duration of the dominant phase of the discharge-averaged pattern, measured at the baseline (ACNS 2021 C3e)."""
    z = max(_runs(key)[:4], key=lambda r: r.duration_s)
    pat, _, names = _pattern(key, z.t0 + 5.0, z.t1 - 3.0)
    y = pat[names.index("F7-T3")]
    pk, _ = sps.find_peaks(np.abs(y), height=0.5 * np.abs(y).max(), distance=int(0.6 * FS))
    w = int(0.35 * FS)
    avg = np.mean([y[p - w:p + w] for p in pk if w <= p < y.size - w], axis=0)
    base = np.median(avg[:int(0.1 * FS)])
    v = avg - base
    j = int(np.argmax(np.abs(v)))
    sgn = np.sign(v[j])
    lo = j
    while lo > 0 and np.sign(v[lo]) == sgn:
        lo -= 1
    hi = j
    while hi < v.size - 1 and np.sign(v[hi]) == sgn:
        hi += 1
    return (hi - lo) / FS * 1000.0


def test_sharpness_categories_measure_as_acns_defines_them():
    """ACNS 2021 C3e: spiky < 70 ms, sharp 70-200 ms (dominant-phase duration at the EEG baseline), blunt = smooth
    and longer.  The schema accepted `sharpness` and synth never read it."""
    spiky, sharp, blunt = (_dominant_phase_ms(k) for k in ("spiky", "sharp", "blunt"))
    assert spiky < 70.0, spiky
    assert 70.0 <= sharp <= 200.0, sharp
    assert blunt > 200.0 and blunt > 1.5 * sharp, blunt


# ------------------------------------------------------------------------------------------------ plus modifiers

def _fast_only(key, ref):
    """The +F contribution alone: the same runs with and without +F (same schedule draws), displayed difference."""
    s, q = _pair(key)[0], _pair(ref)[0]
    z = max(s.rhythmic_patterns[:4], key=lambda r: r.duration_s)
    (A, names), (B, _) = _disp(s, z.t0 + 4.0, z.t1 - 2.0), _disp(q, z.t0 + 4.0, z.t1 - 2.0)
    pat, _, _ = _pattern(ref, z.t0 + 4.0, z.t1 - 2.0)
    i = names.index("F7-T3")
    return (A - B)[i], pat[i]


def test_plus_f_is_independent_fast_activity_not_a_harmonic():
    """GAP code finding 4: "+F" added sin(9*phase) - 9 Hz on a 1-Hz LPD, 18 Hz on a 2-Hz one.  ACNS 2021: +F is
    superimposed fast activity (theta or faster); gpds-plus-f: sharply contoured faster activity riding each
    discharge.  The fast component peaks at the same 12-17 Hz for 1-Hz and 2-Hz LPDs, it is at least 0.25x the
    discharge's p-p, and its 10-25 Hz power sits within 250 ms of each discharge (>= 5x elsewhere)."""
    peaks = []
    for key, ref in (("lpd_f1", "lpd_nof1"), ("lpd_f2", "lpd_nof2")):
        fast, pd = _fast_only(key, ref)
        f, p = sps.welch(fast, FS, nperseg=2 * FS)
        peaks.append(f[np.argmax(p * (f >= 4.0))])
        assert np.median(_sec_ptp(fast)) >= 0.25 * np.median(_sec_ptp(pd))
    assert all(12.0 <= v <= 17.0 for v in peaks), peaks
    fast, pd = _fast_only("lpd_f1", "lpd_nof1")
    pk, _ = sps.find_peaks(np.abs(pd), height=0.5 * np.abs(pd).max(), distance=int(0.6 * FS))
    near = np.zeros(pd.size, bool)
    for p_ in pk:
        near[max(0, p_ - int(0.12 * FS)):p_ + int(0.25 * FS)] = True
    assert (fast[near] ** 2).mean() >= 5.0 * (fast[~near] ** 2).mean()


def test_plus_r_adds_rhythmic_delta_not_time_locked():
    """ACNS 2021 Fig 32: PDs+R = RDA at the same time as the PDs without a time-locked relation.  An 0.8-Hz LPD+R
    carries a spectral peak at the RDA rate (1.14 Hz, not a harmonic of 0.8) at least 2x the plain LPD's power
    there."""
    s, q = _pair("lpd_r")
    z = max(s.rhythmic_patterns[:4], key=lambda r: r.duration_s)
    fr = z.rpp["plus_r"]["hz"]
    assert abs(fr / 0.8 - round(fr / 0.8)) > 0.2
    plain = _syn([_rpp("LPDs", 0.8, 100, "left_temporal", True)])
    pz = max(plain.rhythmic_patterns[:4], key=lambda r: r.duration_s)
    def pw(syn, run):
        (A, names), (B, _) = _disp(syn, run.t0 + 4.0, run.t0 + 24.0), _disp(q, run.t0 + 4.0, run.t0 + 24.0)
        f, p = sps.welch((A - B)[names.index("T3-T5")], FS, nperseg=8 * FS)
        return p[np.argmin(np.abs(f - fr))]
    assert pw(s, z) >= 2.0 * pw(plain, pz)


def test_plus_s_on_pds_is_not_an_acns_subtype():
    """ACNS 2021: +S applies to RDA only (+FS for RDA, +FR for PDs).  On PDs it warns, renders as sharpness spiky
    and is keyed without the +S."""
    ev = _rpp("LPDs", 1.0, 100, "left_temporal", True, plus_modifier="+S")
    assert any("+S applies to RDA only" in w for w in spec_warnings(normalize(_img([ev]))))
    s = _syn([ev])
    z = s.rhythmic_patterns[0]
    assert z.rpp["sharpness"] == "spiky" and z.rpp["acns"]["plus"] is None


# ------------------------------------------------------------------------------------------------ EDB

def test_extreme_delta_brush_is_continuous_delta_with_phase_locked_beta():
    """ACNS 2021 Table 2 / Figs 35-36: definite EDB = abundant or continuous RDA+F with the fast activity in a
    stereotyped relation to each delta wave.  Schmitt 2012: 1-3 Hz delta with 20-30 Hz bursts riding each wave,
    frontally predominant.  Measured: prevalence >= 90 %, frontal delta peak 1-3 Hz, beta peak 20-30 Hz, and the beta
    envelope phase-locked to the delta (PLV >= 0.5)."""
    _, summ = _key("edb")
    rp = summ["rhythmic_patterns"][0]
    assert rp["acns_prevalence"] == "continuous" and rp["edb"] == "definite", rp
    z = max(_runs("edb")[:3], key=lambda r: r.duration_s)
    pat, bg, names = _pattern("edb", z.t0 + 10.0, z.t0 + 40.0)
    y = pat[names.index("F3-C3")]
    f, p = sps.welch(y, FS, nperseg=4 * FS)
    assert 1.0 <= f[np.argmax(p * (f < 4))] <= 3.0
    hi = (f >= 15) & (f <= 40)
    assert 20.0 <= f[hi][np.argmax(p[hi])] <= 30.0
    delta = sps.sosfiltfilt(sps.butter(3, [0.8, 3.0], "bandpass", fs=FS, output="sos"), y)
    beta = np.abs(sps.hilbert(sps.sosfiltfilt(sps.butter(4, [18, 32], "bandpass", fs=FS, output="sos"), y)))
    ph = np.angle(sps.hilbert(delta))
    plv = np.abs(np.sum(beta * np.exp(1j * ph))) / np.sum(beta)
    assert plv >= 0.5, plv
    r = np.median(_sec_ptp(pat), axis=-1) / np.median(_sec_ptp(bg), axis=-1)
    assert r[names.index("F3-C3")] >= 2.0 and r[names.index("F3-C3")] > r[names.index("P3-O1")]


# ------------------------------------------------------------------------------------------------ reactivity

def _win_ptp(key, a, b, ch=("C3-P3", "C4-P4", "P3-O1", "P4-O2")):
    s = _pair(key)[0]
    d, names = _disp(s, a, b)
    return np.median(_sec_ptp(d[[names.index(c) for c in ch]]))


def test_attenuation_type_reactivity():
    """ACNS 2021 A5: reactivity may be attenuation of activity (learningeeg pdr-eye-opening is the awake analogue:
    the posterior rhythm blocks).  A stimulation with response attenuation drops the displayed 1-s p-p to <= 0.55x
    the pre-stimulus minute within 1-6 s, and it recovers by 20 s.  Keyed as reactive/attenuation."""
    pre = _win_ptp("atten", 240.0, 299.0)
    during = _win_ptp("atten", 301.0, 306.0)
    after = _win_ptp("atten", 320.0, 340.0)
    assert during <= 0.55 * pre, (during, pre)
    assert after >= 0.85 * pre
    st = [x for x in _key("atten")[0] if x["kind"] == "stimulation"][0]
    assert st["response_type"] == "attenuation" and st["acns_reactivity"] == "reactive" and st["stimulus"] == "auditory"


def test_paradoxical_reactivity_adds_delta():
    """Paradoxical (arousal) response: diffuse delta rises and faster activity falls after the stimulus.  1-2.5 Hz
    power in 1-9 s after >= 2x the pre-stimulus level; 8-20 Hz power does not rise."""
    s = _pair("parad")[0]
    def bp(a, b, lo, hi):
        d, names = _disp(s, a, b)
        f, p = sps.welch(d, FS, nperseg=2 * FS, axis=-1)
        return p[:, (f >= lo) & (f <= hi)].mean()
    assert bp(301.0, 309.0, 1.0, 2.5) >= 2.0 * bp(280.0, 299.0, 1.0, 2.5)
    assert bp(301.0, 309.0, 8.0, 20.0) <= 1.05 * bp(280.0, 299.0, 8.0, 20.0)


# ------------------------------------------------------------------------------------------------ categories

@pytest.mark.parametrize("prev,lo,hi", [("continuous", 90.0, 100.0), ("frequent", 10.0, 49.0),
                                        ("occasional", 1.0, 9.9)])
def test_prevalence_categories_are_realized(prev, lo, hi):
    """ACNS 2021 C3a: continuous >= 90 %, abundant 50-89, frequent 10-49, occasional 1-9, rare < 1 % of the epoch."""
    ev = _rpp("LPDs", 1.0, 100, "left_temporal", True, prevalence=prev, onset_min=0.0, duration_min=30.0,
              run_duration_s=20.0)
    s = _syn([ev])
    rp = _summary(s, 1800.0)["rhythmic_patterns"][0]
    assert lo <= rp["prevalence_pct"] <= hi and rp["acns_prevalence"] == prev, rp


def test_duration_category_brief_is_realized():
    """ACNS 2021 C3b: brief = 10-59 s runs; the key reports the typical and longest run and their categories."""
    s = _syn([_rpp("LRDA", 1.5, 80, "left_temporal", False, duration_category="brief", onset_min=0.0,
                   duration_min=30.0, prevalence="frequent")])
    rp = _summary(s, 1800.0)["rhythmic_patterns"][0]
    assert rp["acns_duration"] == "brief" and 10.0 <= rp["typical_duration_s"] < 60.0, rp
    assert all(10.0 <= z.duration_s < 60.0 for z in s.rhythmic_patterns[:-1])


# ------------------------------------------------------------------------------------------------ window independence

@pytest.mark.parametrize("key,a", [("sirpids", 243.0), ("evolving", None), ("lpd_f1", None), ("lpd_r", None),
                                   ("edb", 400.0), ("tri", None), ("parad", 301.0), ("birds", None)])
def test_phase_d_features_are_window_independent(key, a):
    s = _pair(key)[0]
    if a is None:
        z = s.rhythmic_patterns[0]
        a = z.t0 + 0.6 * min(z.duration_s, 8.0)
    t1, x1 = s.segment(a - 5.0, a + 10.0)
    t2, x2 = s.segment(a, a + 4.0)
    i = int(round(5.0 * s.fs))
    assert np.allclose(x1[:, i:i + x2.shape[1]], x2, atol=1e-6)
