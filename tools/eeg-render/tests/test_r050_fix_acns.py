"""r050-fix-acns: the independent ACNS review's findings (research/eeg-atlas/feature-review-20260926/acns-independent.md)
and two round-3 items (epileptiform-icu-r3.md C25/C26/C29-C31).

Same measurement as tests/test_r050_acns.py: longitudinal bipolar (or the named montage) through the causal 1-70 Hz page
chain; a pattern's own contribution is the record minus the same record without it.  Reference figures (internal
comparison, research/eeg-atlas/references/cache/): learningeeg lrda-clean, lrda-ty-clean, lpds-clean,
lpds-quiz-clean, triphasic-gpds-clean, BECTS-cts-bipolar, montage__pediatric__BECTS-centrotemporal-spikes-4-bipolar;
Hirsch et al. 2021 (ACNS, PMC8135051) Figs 26, 37.
"""
import copy
from functools import lru_cache

import numpy as np
import pytest
import scipy.signal as sps

from eeg_render import montage as mt
from eeg_render import rpp_v3
from eeg_render.export.manifest import realized_events
from eeg_render.render_page import apply_filters, build_filters
from eeg_render.spec import normalize, spec_warnings
from eeg_render.synth import EAR_PICKUP, Synthesizer

FS = 256
FILT = {"lf_hz": 1.0, "hf_hz": 70.0}
ICU = dict(type="continuous", amplitude_uv=30.0, dominant_hz=3.0, slow_fraction=0.8, reactivity="absent",
           channel_gain_max=1.5, blink_rate_per_min=0)
CHILD = dict(type="continuous", amplitude_uv=40.0, dominant_hz=9.0, slow_fraction=0.35, reactivity="present",
             channel_gain_max=1.5, blink_rate_per_min=0)


def _img(events, bg=ICU, age="adult", version=3, seed=771203, dur=30):
    return {"kind": "qeeg_panel", "license": "synthetic-original", "attribution": None,
            "spec": {"sample_rate": FS, "channels": "standard_19", "seed": seed, "spec_version": version,
                     "age_group": age, "duration_min": dur, "background": dict(bg), "events": events}}


def _syn(events, horizon=900.0, **kw):
    return Synthesizer(normalize(_img(copy.deepcopy(events), **kw))["spec"], horizon)


def _rpp(pattern, hz, amp, region, periodic, **extra):
    e = dict(type="rhythmic_pattern", pattern=pattern, frequency_hz=hz, amplitude_uv=amp, onset_region=region,
             periodic=periodic, onset_min=1.0, duration_min=12.0, run_duration_s=30.0)
    e.update(extra)
    return e


def _disp(s, t0, t1, ref=False, pad=8.0):
    _, x = s.segment(t0 - pad, t1)
    if ref:
        d, names = x[[s._idx[e] for e in s.scalp]], list(s.scalp)
    else:
        pairs = mt.montage_pairs("longitudinal_bipolar", s.scalp)
        d, names = s.derive(x, pairs), [f"{a}-{b}" for a, b in pairs]
    return apply_filters(d, build_filters(FS, FILT, True), True)[:, int(round(pad * FS)):], names


def _sec_ptp(y):
    n = y.shape[-1] // FS
    return np.ptp(y[..., : n * FS].reshape(*y.shape[:-1], n, FS), axis=-1)


@lru_cache(maxsize=None)
def _case(key):
    ev, kw = CASES[key]
    return _syn([ev], **kw), _syn([], **kw)


def _pattern(key, t0, t1, ref=False):
    a, b = _case(key)
    (A, names), (B, _) = _disp(a, t0, t1, ref), _disp(b, t0, t1, ref)
    return A - B, B, A, names


def _mid(key, n=20.0):
    z = max(_case(key)[0].rhythmic_patterns[:3], key=lambda r: r.duration_s)
    return z, z.t0 + 3.0, min(z.t1 - 1.0, z.t0 + 3.0 + n)


CASES = {
    "lrda": (_rpp("LRDA", 1.5, 80, "left_temporal", False), {}),
    "lrda_f": (_rpp("LRDA", 1.5, 80, "left_temporal", False, plus_modifier="+F"), {}),
    "lrda_s": (_rpp("LRDA", 1.5, 80, "left_temporal", False, plus_modifier="+S"), {}),
    "lrda_fl": (_rpp("LRDA", 1.5, 80, "left_temporal", False, modifier="fluctuating", run_duration_s=60.0), {}),
    "lrda_seed2": (_rpp("LRDA", 1.5, 80, "left_temporal", False), dict(seed=518101)),
    "birda": (_rpp("BIRDA", 1.5, 80, "left_temporal", False), {}),
    "lpd": (_rpp("LPDs", 1.0, 100, "left_temporal", True), {}),
    "lpd_v3": (_rpp("LPDs", 1.0, 100, "left_temporal", True, sharpness="sharp"), {}),
    "bipd": (_rpp("BIPDs", 1.0, 100, "left_temporal", True), {}),
    "lpd_neg": (_rpp("LPDs", 1.0, 100, "left_temporal", True, polarity="surface_negative"), {}),
    "spiky": (_rpp("LPDs", 1.0, 100, "left_temporal", True, sharpness="spiky"), {}),
    "spiky2": (_rpp("LPDs", 1.0, 100, "left_temporal", True, sharpness="spiky"), dict(seed=518101)),
    "sharp": (_rpp("LPDs", 1.0, 100, "left_temporal", True, sharpness="sharp"), {}),
    "tri": (_rpp("triphasic", 1.8, 110, "generalized", True), {}),
    "tri2": (_rpp("triphasic", 1.8, 110, "generalized", True), dict(seed=518101)),
    "evo_short": (_rpp("LPDs", 1.0, 100, "left_temporal", True, modifier="evolving", run_duration_s=6.0,
                       evolution=dict(start_hz=1.0, end_hz=2.0)), {}),
    "evo_long": (_rpp("LPDs", 1.0, 100, "left_temporal", True, modifier="evolving", run_duration_s=24.0,
                      evolution=dict(start_hz=1.0, end_hz=3.0)), {}),
}


# ------------------------------------------------------------------------------------------ 1. lateralized RDA / PDs

@pytest.mark.parametrize("key", ["lrda", "lrda_f", "lrda_s", "lrda_fl", "lrda_seed2", "birda"])
def test_lateralized_rda_is_visible_on_the_chain(key):
    """acns-independent.md: an 80-uV LRDA displayed 30 uV p-p, 0.85x the background (BIRDA the same), invisible on the
    page.  learningeeg lrda-clean / lrda-ty-clean: temporal 1-1.5 Hz delta obvious at page scale, about 2-3x the other
    side.  amplitude_uv is now the p-p on the maximal bipolar derivation (0.8-1.35x; +S adds its transient), the
    temporal chain carries >= 1.8x its own background, and the page there is >= 1.6x the contralateral chain."""
    z, a, b = _mid(key)
    pat, bg, full, names = _pattern(key, a, b)
    pp = np.median(_sec_ptp(pat), -1)
    bgp = np.median(_sec_ptp(bg), -1)
    side = ("F8-T4", "T4-T6") if z.onset_region.startswith("right") else ("F7-T3", "T3-T5")
    other = ("F7-T3", "T3-T5") if side[0] == "F8-T4" else ("F8-T4", "T4-T6")
    i = [names.index(n) for n in side]
    assert 0.8 * 80 <= pp.max() <= 1.35 * 80, pp.max()
    assert (pp[i] / bgp[i]).max() >= 1.8, pp[i] / bgp[i]
    if not key.startswith("birda"):
        tot = np.median(_sec_ptp(full), -1)
        assert tot[i].max() >= 1.6 * tot[[names.index(n) for n in other]].max()


@pytest.mark.parametrize("key", ["lpd", "lpd_v3", "bipd"])
def test_lateralized_pds_deliver_their_amplitude(key):
    """acns-independent.md: LPDs gave 58-70 uV p-p on the max bipolar channel for 100 requested (1.7x background;
    learningeeg lpds-clean / lpds-quiz-clean read 3-4x).  Calibrated like the generalized family: 0.8-1.25x
    amplitude_uv on the max derivation, >= 2.2x the background of a 30-uV ICU record."""
    z, a, b = _mid(key)
    pat, bg, _, names = _pattern(key, a, b)
    pp = np.median(_sec_ptp(pat), -1)
    j = int(np.argmax(pp))
    assert 0.8 * 100 <= pp[j] <= 1.25 * 100, (names[j], pp[j])
    assert pp[j] / np.median(_sec_ptp(bg[j])) >= 2.2


def test_rda_contour_is_a_steep_stroke_and_a_slow_return():
    """epileptiform-icu-r3 C29/C31: the v3 RDA was a sinusoid (half the cycle each way).  learningeeg lrda-clean
    (T4-T6, T6-O2): a steep downward stroke and a slower return.  On the maximal derivation (T3-T5, negative up) the
    downward stroke takes <= 1/3 of the cycle, the return the rest."""
    z, a, b = _mid("lrda")
    pat, _, _, names = _pattern("lrda", a, b)
    y = pat[names.index("T3-T5")]
    pk, _ = sps.find_peaks(y, distance=int(0.45 * FS), prominence=0.25 * np.ptp(y))
    tr, _ = sps.find_peaks(-y, distance=int(0.45 * FS), prominence=0.25 * np.ptp(y))
    down = [(p - tr[tr < p][-1]) / FS for p in pk if (tr < p).any()]       # value rising = trace going down
    period = np.median(np.diff(pk)) / FS
    assert len(down) >= 15 and np.median(down) / period <= 1.0 / 3.0, (np.median(down), period)


def test_rpp_onset_reaches_half_voltage_within_a_second():
    """epileptiform-icu-r3 C25/C26: the onset ramp took 3.5 s to half amplitude, so a page opening on the onset was flat
    for 8 s.  v3: the displayed LRDA in the first second of a run is >= 0.5x its mid-run p-p (the keyed onset is what
    the page shows); an evolving run keeps its build-up (ramp_s 0.14 x duration)."""
    s = _case("lrda")[0]
    z = s.rhythmic_patterns[1]
    pat, _, _, names = _pattern("lrda", z.t0 - 1.0, z.t0 + 8.0)
    y = pat[names.index("T3-T5")]
    first = np.ptp(y[int(1.25 * FS): int(2.25 * FS)])
    mid = np.median(_sec_ptp(y[int(5.0 * FS):]))
    assert first >= 0.5 * mid, (first, mid)
    ev = _case("evo_long")[0].rhythmic_patterns[0]
    assert ev.rpp["ramp_s"] > 2.0


# ------------------------------------------------------------------------------------------ 2. ear references

def _ear_peaks(focus, montage, seed):
    ev = [{"type": "sporadic_discharges", "focus": focus, "rate_per_h": 900, "amplitude_uv": 120.0}]
    s = Synthesizer(normalize(_img(ev, bg=CHILD, age="child", seed=seed))["spec"], 300.0)
    t = np.arange(int(24 * FS), int(200 * FS)) / FS
    pairs = mt.montage_pairs(montage, s.scalp)
    sig = apply_filters(s.derive(s._sed_rows(t), pairs, montage), build_filters(FS, FILT, True), True)
    k = t >= 30.0
    t, sig = t[k], sig[:, k]
    P = []
    for r in s._sed:
        if 31 < r[0] < 199:
            seg = sig[:, (t > r[0] - 0.03) & (t < r[0] + 0.05)]
            P.append(seg[:, int(np.argmax(np.abs(seg).max(0)))])
    return np.median(np.array(P), 0), [mt.montage_label(p, montage) for p in pairs]


def test_ipsilateral_ear_keeps_the_temporal_spike_largest_at_the_focus():
    """acns-independent.md: A1 took 0.9 of a T3 spike, so T3-A1 was -8 uV while Fp1-A1 / O1-A1 carried +82 uV inverted
    spikes.  Ear references are "active" for temporal discharges but record only a fraction (the classic pitfall:
    smaller at the focus, inverted far away - never cancelled).  T3-A1 is the largest row and negative (up);
    far rows are inverted at 0.15-0.6x of it."""
    v, lab = _ear_peaks("T3", "ipsilateral_ear", 880004)
    i = lab.index("T3-A1")
    assert int(np.argmax(np.abs(v))) == i and v[i] < 0, dict(zip(lab, np.round(v)))
    far = np.array([v[lab.index(n)] for n in ("Fp1-A1", "O1-A1")])
    assert (far > 0).all() and (0.15 * abs(v[i]) <= far).all() and (far <= 0.6 * abs(v[i])).all(), far / v[i]


def test_contralateral_ear_shows_no_dominant_inverted_copy():
    """acns-independent.md: T4-A1 carried +82 uV for a T3 spike (a large inverted copy on the wrong side).  With the
    contralateral ear, T3-A2 is the largest row and every right-sided row is <= 0.45x of it."""
    v, lab = _ear_peaks("T3", "contralateral_ear", 880004)
    i = lab.index("T3-A2")
    assert int(np.argmax(np.abs(v))) == i
    right = [j for j, n in enumerate(lab) if mt.side_of(n.split("-")[0]) == "right"]
    assert np.abs(v[right]).max() <= 0.45 * abs(v[i])


def test_v2_ear_weights_are_unchanged():
    """Version 1/2 keep the 0.4.x projection (A1 ~0.91 of a T3 monopole); v3 uses EAR_PICKUP of T3."""
    for ver, want in ((2, 0.914), (3, EAR_PICKUP)):
        s = _syn([], horizon=60.0, version=ver)
        w = s._gen_weights("T3", 0.60)
        assert abs(w[s._idx["A1"]] - want) < 0.01, (ver, w[s._idx["A1"]])


# ------------------------------------------------------------------------------------------ 3. rate at the cutoffs

@pytest.mark.parametrize("ev,want", [
    (_rpp("GPDs", 2.5, 100, "generalized", True, sharpness="sharp"), "IIC"),
    (_rpp("GPDs", 2.5, 100, "generalized", True), "IIC"),
    (_rpp("LPDs", 1.0, 100, "left_temporal", True, sharpness="sharp"), "RPP_interictal"),
    (_rpp("LPDs", 1.0, 100, "left_temporal", True), "RPP_interictal"),
    (_rpp("LPDs", 1.0, 100, "left_temporal", True, plus_modifier="+S"), "RPP_interictal"),
    (_rpp("LRDA", 1.0, 80, "left_temporal", False, plus_modifier="+F"), "RPP_interictal"),
])
def test_run_rate_stays_on_the_authored_side_of_the_acns_cutoff(ev, want):
    """acns-independent.md: authored 2.5-Hz GPDs keyed ESz in 6/18 runs, authored 1.0-Hz LPDs keyed IIC in 6/18 (ACNS
    2021 D1: > 2.5 Hz; F: > 1 and <= 2.5 Hz).  Every run keys the authored class, and the rate_jitter spread is kept
    (>= 0.1 Hz between runs) on the authored side."""
    s = _syn([ev], horizon=1800.0)
    rows = [x for x in realized_events(s, 1800.0) if x["kind"] == "rhythmic_pattern"]
    assert len(rows) >= 18 and {x["acns_classification"] for x in rows} == {want}
    hz = [x["mean_hz"] for x in rows]
    assert max(hz) - min(hz) >= 0.1


def test_keep_rate_side_bins():
    assert rpp_v3.keep_rate_side(2.5, 2.7) == pytest.approx(2.3)
    assert rpp_v3.keep_rate_side(1.0, 1.1) == pytest.approx(0.9)
    assert rpp_v3.keep_rate_side(1.2, 0.95) > 1.0
    assert rpp_v3.keep_rate_side(3.0, 2.4) > 2.5
    assert rpp_v3.keep_rate_side(1.5, 1.7) == 1.7


# ------------------------------------------------------------------------------------------ 4. sharpness, lag

def _dominant_ms(key):
    """Dominant-phase duration at baseline on the referential focus (acns-independent.md method: zero crossing to zero
    crossing around each discharge peak, median)."""
    s = _case(key)[0]
    z = s.rhythmic_patterns[0]
    pat, _, _, names = _pattern(key, z.t0 + 2.0, z.t0 + 22.0, ref=True)
    y = pat[names.index("T3")]
    pk, _ = sps.find_peaks(np.abs(y), distance=int(0.6 * FS), height=0.5 * np.abs(y).max())
    wid = []
    for p in pk:
        s0, a, b = np.sign(y[p]), p, p
        while a > 0 and np.sign(y[a]) == s0:
            a -= 1
        while b < y.size - 1 and np.sign(y[b]) == s0:
            b += 1
        wid.append((b - a) / FS * 1000.0)
    return float(np.median(wid))


def test_spiky_measures_under_70_ms_on_the_displayed_signal():
    """ACNS 2021 C3e: spiky < 70 ms, sharp 70-200 ms at the baseline.  acns-independent.md measured spiky at 74 ms
    (referential T3, page chain).  Two seeds."""
    assert _dominant_ms("spiky") < 67.0
    assert _dominant_ms("spiky2") < 67.0
    assert 70.0 <= _dominant_ms("sharp") <= 200.0


@pytest.mark.parametrize("key", ["tri", "tri2"])
def test_triphasic_lag_matches_the_key(key):
    """The key says lag_ms 120 (A-P); acns-independent.md measured Fp1 -> O1 90 ms by cross-correlation.  ACNS 2021 C4c /
    Fig 37: > 100 ms front to back.  Measured Fp1 -> O1 within +/-20 ms of the keyed lag."""
    s = _case(key)[0]
    z = s.rhythmic_patterns[0]
    pat, _, _, names = _pattern(key, z.t0 + 2.0, z.t0 + 22.0, ref=True)
    a, b = pat[names.index("Fp1")], pat[names.index("O1")]
    c = sps.correlate(b, a, "full")
    lags = sps.correlation_lags(b.size, a.size, "full")
    m = np.abs(lags) <= int(0.3 * FS)
    lag = lags[m][np.argmax(c[m])] / FS * 1000.0
    key_lag = [x for x in realized_events(s, 900.0) if x["kind"] == "rhythmic_pattern"][0]["lag_ms"]
    assert key_lag == 120.0 and abs(lag - key_lag) <= 20.0, lag


# ------------------------------------------------------------------------------------------ 5. short evolution

def test_evolution_under_10_s_can_be_authored_and_is_not_a_seizure():
    """acns-independent.md: a 6-s evolving run was lengthened to 10.3-11.5 s and always keyed ESz, so "evolution for
    < 10 s is not a seizure" (ACNS 2021 criterion B needs >= 10 s) could not be drawn.  A 1 -> 2 Hz run authored at 6 s
    lasts < 10 s with valid evolution (>= 2 changes of >= 0.5 Hz, >= 3 cycles per level) and is not ESz; the discharge
    rate counted on the displayed pattern still rises; a 24-s run stays ESz."""
    s = _case("evo_short")[0]
    runs = s.rhythmic_patterns
    assert runs and all(z.duration_s < 10.0 for z in runs)
    for z in runs[:5]:
        lv = np.array([x[1] for x in z.rpp["steps"]])
        ts = np.array([x[0] for x in z.rpp["steps"]] + [z.duration_s])
        assert len(lv) >= 3 and (np.diff(lv) >= 0.5 - 1e-9).all()
        assert all((ts[k + 1] - ts[k]) * lv[k] >= 3.0 - 1e-9 for k in range(len(lv)))
    rows = [x for x in realized_events(s, 900.0) if x["kind"] == "rhythmic_pattern"]
    assert rows and all(x["acns_classification"] != "electrographic_seizure" for x in rows)
    assert all(x["evolution"] == "evolving" for x in rows)
    z = runs[0]
    pat, _, _, names = _pattern("evo_short", z.t0, z.t1)
    y = pat[names.index("T3-T5")]
    pk, _ = sps.find_peaks(np.abs(y), height=0.4 * np.abs(y).max(), distance=int(0.3 * FS))
    isi = np.diff(pk) / FS
    assert isi[-2:].mean() < 0.8 * isi[:2].mean(), isi
    long_rows = [x for x in realized_events(_case("evo_long")[0], 900.0) if x["kind"] == "rhythmic_pattern"]
    assert {x["acns_classification"] for x in long_rows} == {"electrographic_seizure"}


# ------------------------------------------------------------------------------------------ 6. BIPDs plural

def test_bipds_plural_is_an_acns_main_term():
    """acns-independent.md: "BIPDs" warned "not an ACNS main term" while "LPDs" / "GPDs" were accepted."""
    w = spec_warnings(normalize(_img([_rpp("BIPDs", 1.0, 100, "left_temporal", True)])))
    assert not any("main term" in x for x in w)
    assert {z.onset_region for z in _case("bipd")[0].rhythmic_patterns} == {"left_temporal", "right_temporal"}


# ------------------------------------------------------------------------------------------ 7. LPD polarity

def test_lpd_polarity_key():
    """acns-independent.md: the default dominant phase is surface-positive at T3 (13/13; learningeeg lpds-clean and
    lpds-quiz-clean look the same), the ACNS 2021 Fig 26 schematic is surface-negative.  Craig's call: a per-event
    ``polarity``; the default stays surface-positive.  Referential T3 peaks: default > 0, surface_negative < 0 in
    every discharge; the key reports it; RDA warns."""
    for key, sign in (("lpd", 1), ("lpd_v3", 1), ("lpd_neg", -1)):
        s = _case(key)[0]
        z = s.rhythmic_patterns[0]
        pat, _, _, names = _pattern(key, z.t0 + 2.0, z.t0 + 22.0, ref=True)
        y = pat[names.index("T3")]
        pk, _ = sps.find_peaks(np.abs(y), distance=int(0.6 * FS), height=0.5 * np.abs(y).max())
        assert len(pk) >= 10 and (np.sign(y[pk]) == sign).all(), (key, np.sign(y[pk]))
    rows = [x for x in realized_events(_case("lpd_neg")[0], 900.0) if x["kind"] == "rhythmic_pattern"]
    assert rows[0]["polarity"] == "surface_negative"
    w = spec_warnings(normalize(_img([_rpp("LRDA", 1.5, 80, "left_temporal", False, polarity="surface_negative")])))
    assert any("polarity applies to periodic" in x for x in w)
    w2 = spec_warnings(normalize(_img([_rpp("LPDs", 1.0, 100, "left_temporal", True, polarity="surface_negative")],
                                      version=2)))
    assert any("not synthesized below spec_version 3" in x and "polarity" in x for x in w2)


# ------------------------------------------------------------------------------------------ 8. SeLECTS

def test_selects_discharges_do_not_reverse_at_cz():
    """acns-independent.md: a Cz reversal in 60/60 SeLECTS discharges, not in learningeeg BECTS-cts-bipolar /
    BECTS-centrotemporal-spikes-4-bipolar (reversal at C4 and T4 only).  Right discharges still reverse at C4 or T4."""
    ev = [{"type": "sporadic_discharges", "focus": "right_centrotemporal", "rate_per_h": 600, "amplitude_uv": 120.0,
           "morphology": "sharp_wave", "foci": ["right_centrotemporal", "left_centrotemporal"],
           "focus_weights": [0.7, 0.3]}]
    s = Synthesizer(normalize(_img(ev, bg=CHILD, age="child", seed=551177))["spec"], 300.0)
    t = np.arange(int(24 * FS), int(290 * FS)) / FS
    pairs = mt.montage_pairs("longitudinal_bipolar", s.scalp)
    sig = apply_filters(s.derive(s._sed_rows(t), pairs), build_filters(FS, FILT, True), True)
    k = t >= 30.0
    t, sig = t[k], sig[:, k]
    n, cz, ct = 0, 0, 0
    for r in s._sed:
        if 31 < r[0] < 289:
            seg = sig[:, (t > r[0] - 0.03) & (t < r[0] + 0.05)]
            v = seg[:, int(np.argmax(np.abs(seg).max(0)))]
            ref = np.abs(v).max()
            rev = [pairs[i][0] for i in range(1, len(pairs)) if pairs[i - 1][1] == pairs[i][0]
                   and np.sign(v[i - 1]) != np.sign(v[i]) and min(abs(v[i - 1]), abs(v[i])) > 0.25 * ref]
            n += 1
            cz += "Cz" in rev
            ct += bool({"C4", "T4", "C3", "T3"} & set(rev))
    assert n >= 20 and cz == 0 and ct >= 0.9 * n, (n, cz, ct)


# ------------------------------------------------------------------------------------------ window independence

@pytest.mark.parametrize("key", ["evo_short", "lpd_neg", "lrda_s"])
def test_fix_acns_features_are_window_independent(key):
    s = _case(key)[0]
    z = s.rhythmic_patterns[0]
    a = z.t0 + 0.4 * min(z.duration_s, 8.0)
    _, x1 = s.segment(a - 5.0, a + 10.0)
    _, x2 = s.segment(a, a + 4.0)
    i = int(round(5.0 * s.fs))
    assert np.allclose(x1[:, i:i + x2.shape[1]], x2, atol=1e-6)
