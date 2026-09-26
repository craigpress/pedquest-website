"""0.5.0 phase B, seizures and ICU backgrounds (feature review 2026-09-26, seizures-icu.md).

Every measurement is on the displayed signal: longitudinal bipolar through the causal 1-70 Hz page chain, and for
ictal features the ictal component is (record - same record without the seizure), so the background is identical.
References (cached under research/eeg-atlas/references/cache/learningeeg/, internal comparison only):
L1 left temporal focal seizure, L2 right temporal to bilateral tonic-clonic, L4 burst suppression, L5 breach rhythm.
"""
import copy
from functools import lru_cache

import numpy as np
import pytest
import scipy.signal as sps

from eeg_render import montage as mt
from eeg_render.render_page import apply_filters, build_filters
from eeg_render.render_panel import _ratio_axis
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer

FS = 256
ICU = dict(type="continuous", amplitude_uv=35.0, dominant_hz=3.0, slow_fraction=0.8, reactivity="absent",
           channel_gain_max=1.5, blink_rate_per_min=0)
CHILD = dict(type="continuous", amplitude_uv=40.0, dominant_hz=9.0, slow_fraction=0.4, reactivity="present",
             channel_gain_max=1.5)


def _img(age, bg, events, version=3, seed=517401):
    return {"kind": "qeeg_panel", "license": "synthetic-original", "attribution": None,
            "spec": {"sample_rate": FS, "channels": "standard_19", "seed": seed, "spec_version": version,
                     "age_group": age, "duration_min": 30, "background": bg, "events": events}}


def _synth(image):
    return Synthesizer(normalize(copy.deepcopy(image))["spec"], 1800.0)


def _displayed(s, t0, t1, pairs, pad=10.0):
    _, x = s.segment(t0 - pad, t1)
    d = apply_filters(s.derive(x, pairs), build_filters(FS, {"lf_hz": 1.0, "hf_hz": 70.0}, True), True)
    return d[:, int(pad * FS):]


def _sz(dur, region, **extra):
    e = dict(type="seizure", onset_min=5.0, duration_s=dur, onset_region=region, spread="none",
             evolution=dict(start_hz=5.0, end_hz=2.0, amplitude_start_uv=50, amplitude_end_uv=140))
    e.update(extra)
    return e


@lru_cache(maxsize=None)
def _ictal_pair(dur, region, age="adult", seed=517401, version=3):
    bg = ICU if age == "adult" else CHILD
    return _synth(_img(age, bg, [_sz(dur, region)], version, seed)), _synth(_img(age, bg, [], version, seed))


def _p2p_ratio(dur, region, windows, pairs):
    """Median 1-s p2p of the ictal component / median 1-s p2p of the background, per derivation and window."""
    a_s, b_s = _ictal_pair(dur, region)
    a, b = _displayed(a_s, 300.0, 300.0 + dur, pairs), _displayed(b_s, 300.0, 300.0 + dur, pairs)
    n = int(dur)
    ict = np.ptp((a - b)[:, : n * FS].reshape(len(pairs), n, FS), axis=2)
    bg = np.median(np.ptp(b[:, : n * FS].reshape(len(pairs), n, FS), axis=2), axis=1)
    return {w: np.median(ict[:, w[0]:w[1]], axis=1) / bg for w in windows}


LT_CHAIN = [("Fp1", "F7"), ("F7", "T3"), ("T3", "T5"), ("T5", "O1")]
L_PARA = [("F3", "C3"), ("C3", "P3")]
R_CHAIN = [("Fp2", "F8"), ("F8", "T4"), ("T4", "T6"), ("T6", "O2")]


def test_focal_field_involves_the_whole_chain_within_10_s():
    """L1: onset in F7-T3/T3-T5; ~10 s later the whole left temporal chain at 2-3x background, leaking into
    F3-C3/C3-P3.  v2 (review B4-01) kept T5-O1 at 0.78x and the parasagittal chain at 0.4-0.5x."""
    r = _p2p_ratio(90, "left_temporal", [(0, 5), (10, 20), (40, 80)], LT_CHAIN + L_PARA + R_CHAIN)
    early, ten, late = r[(0, 5)], r[(10, 20)], r[(40, 80)]
    assert early[1] > 1.2 and early[2] > 1.2                       # onset zone F7-T3 / T3-T5
    assert early[4:6].max() < early[1:3].min()                     # parasagittal below the onset zone at onset
    assert ten[:4].min() >= 1.2, ten[:4]                           # every left temporal derivation by 10-20 s
    assert ten[1:3].min() >= 2.0                                    # 2-3x in the middle of the chain
    assert 0.6 <= ten[4:6].min() and ten[4:6].max() <= 1.8         # a parasagittal leak, not a second focus
    # default late regional spread (> 30-s run): the ipsilateral parasagittal chain joins, the other side does not
    assert late[4:6].min() >= 1.5, late[4:6]
    assert late[6:].max() < 0.35


def _comb(image, off=False):
    s, q = _synth(image), _synth(copy.deepcopy(image) | {"spec": {**image["spec"], "events": []}})
    if off:
        s._CYCLE_WARP, s._CYCLE_PSI = 0.0, (0.0, 0.0, 0.0, 0.0)
    pair = [("T4", "T6")]
    _, xa = s.segment(300, 420)
    _, xb = q.segment(300, 420)
    d = (s.derive(xa, pair) - q.derive(xb, pair))[0]
    combs, proms = [], []
    for k in range(10, 110, 4):
        f, p = sps.welch(d[k * FS:(k + 8) * FS], FS, nperseg=4 * FS, noverlap=2 * FS)
        m = (f >= 1) & (f <= 8)
        f0 = f[m][np.argmax(p[m])]
        at = lambda q_: p[np.argmin(np.abs(f - q_))]
        combs.append(np.log10((at(2 * f0) + at(3 * f0)) / (at(1.5 * f0) + at(2.5 * f0))))
        proms.append(np.log10(at(f0) / np.median(p[(f > 0.5) & (f < 20)])))
    return float(np.median(combs)), float(np.median(proms))


@pytest.mark.parametrize("seed", [517401, 517402])
def test_ictal_spectrum_is_a_smeared_flame_not_a_harmonic_comb(seed):
    """Review B4-02/C14/C18: deterministic harmonics drew 5-6 parallel CSA lines.  Per-cycle period (~7 % SD)
    and harmonic-phase jitter smear harmonics 2-3 into the inter-harmonic troughs, while the fundamental stays a
    peak far above the spectrum median (the rhythmicity panels)."""
    ev = dict(type="seizure", onset_min=5.0, duration_s=120, onset_region="right_temporal", spread="none",
              evolution=dict(start_hz=4.0, end_hz=2.0, amplitude_start_uv=60, amplitude_end_uv=150))
    image = _img("adult", ICU, [ev], seed=seed)
    comb_on, prom_on = _comb(image)
    comb_off, _ = _comb(image, off=True)
    assert comb_off > 1.2                  # without the jitter: harmonics 30x their troughs
    assert comb_on < 0.65, comb_on         # with it: under 4.5x
    assert prom_on > 1.5                   # fundamental still > 30x the spectrum median


def _band_rms(sig, lo, hi):
    return float(np.std(sps.sosfiltfilt(sps.butter(4, [lo, hi], btype="bandpass", fs=FS, output="sos"), sig)))


@pytest.mark.parametrize("seed", [517401, 517402, 517403])
def test_postictal_focal_delta_over_the_onset_zone(seed):
    """Review B4-03/C14/C18: every run cut straight back to background (compare L2 p6).  The default attenuation
    now has focal polymorphic delta over the onset field: left/right 1-4 Hz RMS in the temporal chain 5-25 s after
    a left temporal seizure is at least 1.4x its pre-ictal value."""
    ev = dict(type="seizure", onset_min=10.0, duration_s=60, onset_region="left_temporal", spread="none",
              evolution=dict(start_hz=5.0, end_hz=2.5, amplitude_start_uv=60, amplitude_end_uv=150))
    s = _synth(_img("child", CHILD, [ev], seed=seed))
    pairs = [("F7", "T3"), ("T3", "T5"), ("F8", "T4"), ("T4", "T6")]
    d = _displayed(s, 570.0, 690.0, pairs)
    pre, post = slice(0, 28 * FS), slice(95 * FS, 115 * FS)
    asym = lambda sl: (np.mean([_band_rms(d[i, sl], 1, 4) for i in (0, 1)])
                       / np.mean([_band_rms(d[i, sl], 1, 4) for i in (2, 3)]))
    assert asym(post) / asym(pre) >= 1.4


BREACH = dict(CHILD, breach={"focus": "C3", "gain": 2.2, "fast_gain": 2.5})
BREACH_PAIRS = [("F3", "C3"), ("C3", "P3"), ("F7", "T3"), ("T3", "T5")]


def _breach_measures(bg, seed):
    s = _synth(_img("child", bg, [], seed=seed))
    d = _displayed(s, 240.0, 360.0, BREACH_PAIRS)
    _, x = s.segment(240.0, 360.0)
    ref = s.derive(x, [("C3", None)])[0]
    pp = np.median(np.ptp(d[:, : 120 * FS].reshape(4, 120, FS), axis=2), axis=1)
    return dict(pp=pp, r=float(np.corrcoef(d[0], d[1])[0, 1]), beta=_band_rms(ref, 13, 30), emg=_band_rms(ref, 30, 70))


@pytest.mark.parametrize("seed", [517203, 517204, 517205])
def test_breach_is_a_cerebral_plateau(seed):
    """Review B2-04 / L5: the breach is a regional field with no single-electrode mirror.  v2 put the gain on C3
    alone (F3-C3 vs C3-P3 r = -0.59, T3 x1.47) and on the muscle floor (EMG x2.3).  Ratios are against the same
    seed without the breach, so channel gains cancel."""
    b, n = _breach_measures(BREACH, seed), _breach_measures(CHILD, seed)
    gain = b["pp"] / n["pp"]
    assert 1.7 <= gain[0] <= 2.8 and 1.7 <= gain[1] <= 2.8, gain     # requested 2.2 on both C3 derivations
    assert b["r"] - n["r"] > -0.2, (b["r"], n["r"])                   # no mirror image around C3
    assert gain[2] < 1.15 and gain[3] < 1.15, gain                    # no T3 leak
    assert b["beta"] / n["beta"] > 2.0                                # fast activity accentuated
    assert b["emg"] / n["emg"] < 1.25                                 # scalp muscle is not amplified


def test_breach_v2_unchanged_documents_the_mirror():
    """v2 renders must not move: the single-electrode gain still mirrors F3-C3 against C3-P3."""
    s = _synth(_img("child", BREACH, [], version=2, seed=517203))
    d = _displayed(s, 240.0, 360.0, BREACH_PAIRS[:2])
    assert np.corrcoef(d[0], d[1])[0, 1] < -0.4


CAPE_BG = dict(type="continuous", amplitude_uv=35.0, dominant_hz=2.5, slow_fraction=0.85, reactivity="absent",
               channel_gain_max=1.5, blink_rate_per_min=0,
               cape={"period_s": 40.0, "depth": 0.6, "cycles": 12, "at_min": 5.0})


def _cape(version):
    s = _synth(_img("adult", CAPE_BG, [], version=version, seed=517202))
    cyc = s.cape_cycles()
    pairs = [p for p in mt.montage_pairs("longitudinal_bipolar", s.scalp) if not p[0].startswith("Fp")]
    end = cyc[-1][1] + 20.0
    d = _displayed(s, 290.0, end, pairs)
    seg = lambda a, b: d[:, int((a - 290.0) * FS):int((b - 290.0) * FS)]
    mids = [s._cape_v3_cache[k][1] for k in range(len(cyc))] if version >= 3 else [0.5 * (a + b) for a, b, _ in cyc]
    ratios, cshift, td, prof = [], [], [], []
    for k in range(1, len(cyc) - 1):
        a, b, _ = cyc[k]
        mid = mids[k]
        A, B = seg(a + 5, mid - 5), seg(mid + 5, b - 5)
        p2p = lambda X: np.median(np.ptp(X[:, : (X.shape[1] // FS) * FS].reshape(X.shape[0], -1, FS), axis=2))
        ratios.append(p2p(B) / p2p(A))

        def spec(X):
            f, p = sps.welch(X, FS, nperseg=2 * FS, axis=1)
            p = p.mean(0)
            return p[(f >= 4) & (f < 8)].sum() / p[(f >= 1) & (f < 4)].sum()
        td.append(spec(B) / spec(A))
        prof.append([np.sqrt(np.mean(seg(mid - 12 + 0.5 * i, mid - 11 + 0.5 * i) ** 2)) for i in range(46)])
    e = np.mean(prof, axis=0)
    hi, lo = np.median(e[:10]), np.median(e[-10:])
    t75 = np.argmax(e < lo + 0.75 * (hi - lo)) * 0.5
    t25 = np.argmax(e < lo + 0.25 * (hi - lo)) * 0.5
    return s, cyc, float(np.median(ratios)), float(np.median(td)), t25 - t75


def test_cape_is_gradual_irregular_and_changes_character():
    """ACNS CAPE: >= 6 cycles of two alternating patterns, each >= 10 s.  Review B2-03: v2 was a strictly periodic
    square wave whose two phases differed only by gain.  v3: lognormal cycle length, 4-8 s raised-cosine
    transitions, and a faster low-voltage phase B (theta/delta at least doubles)."""
    s, cyc, ratio, td, trans = _cape(3)
    per = np.diff([c[0] for c in cyc] + [cyc[-1][1]])
    assert len(cyc) >= 6
    assert 0.12 <= per.std() / per.mean() <= 0.45
    assert all(mid - a >= 10.0 + 0.5 * r and b - mid >= 10.0 + 0.5 * f for a, mid, b, r, f in s._cape_v3_cache)
    assert 0.3 <= ratio <= 0.55                   # requested depth 0.6 -> phase B at ~0.4 of phase A
    assert td >= 2.0                              # a different pattern, not just a quieter one
    assert trans >= 1.5                           # averaged 75 -> 25 % fall; v2 about 1 s
    _, cyc2, _, td2, trans2 = _cape(2)
    assert len(cyc2) == 12 and td2 < 1.3 and trans2 < trans


BS_BG = dict(type="burst_suppression", amplitude_uv=50.0, dominant_hz=3.0, slow_fraction=0.7, reactivity="absent",
             channel_gain_max=1.5, blink_rate_per_min=0)


def _bs(version):
    s = _synth(_img("adult", BS_BG, [], version=version, seed=515601))
    pairs = mt.montage_pairs("longitudinal_bipolar", s.scalp)
    d = _displayed(s, 200.0, 500.0, pairs)
    rises, onset, body, ib = [], [], [], []
    for a, b in zip(s._burst_start, s._burst_end):
        if a < 210 or b > 490:
            continue
        i = int((a - 200) * FS)
        e = np.convolve(np.abs(d[:, i - FS // 2:i + FS // 2]).max(0), np.ones(5) / 5, "same")
        rises.append((np.argmax(e > 0.9 * e.max()) - np.argmax(e > 0.1 * e.max())) / FS)
        onset.append(np.ptp(d[:, i - int(0.05 * FS):i + int(0.35 * FS)], axis=1).max())
        body.append(np.median([np.ptp(d[:, i + int((0.5 + j) * FS):i + int((1.5 + j) * FS)], axis=1).max()
                               for j in range(max(1, int(b - a - 1)))]))
    for b, a2 in zip(s._burst_end, s._burst_start[1:]):
        if b < 210 or a2 > 490 or a2 - b < 3:
            continue
        seg = d[:, int((b - 199) * FS):int((a2 - 200.5) * FS)]
        ib += list(np.ptp(seg[:, : (seg.shape[1] // FS) * FS].reshape(len(pairs), -1, FS), axis=2).ravel())
    rr = 60.0 / 72.0
    idx = np.arange(int(200 / rr) + 2, int(500 / rr) - 2)
    beats = [bt for bt in idx * rr + s._beat_jitter(idx)
             if not np.any((s._burst_start - 0.5 < bt) & (s._burst_end + 1.0 > bt))]
    ecg = np.mean([d[[0, 3], int((bt - 200.1) * FS):int((bt - 200.1) * FS) + int(0.3 * FS)] for bt in beats], axis=0)
    return np.median(rises), np.median(np.array(onset) / np.array(body)), np.array(ib), float(np.ptp(ecg, axis=1).min())


def test_burst_suppression_sharp_onsets_and_a_live_interburst():
    """L4: bursts start abruptly with a sharply contoured transient; the interburst carries residual low-voltage
    activity, not a ruler-flat line.  Review C21: v2 rose on a 0.3-s ramp over a 1.0-uV interburst.  ACNS
    suppression is < 10 uV."""
    rise, onset, ib, ecg = _bs(3)
    assert rise <= 0.1, rise
    assert 1.2 <= onset <= 2.0, onset             # onset transient ~1.5x the burst body
    assert 2.0 <= np.median(ib) <= 6.0, np.median(ib)
    assert np.percentile(ib, 99) < 10.0
    assert ecg >= 2.0                             # QRS visible in Fp1-F7 / T5-O1 through the interburst
    rise2, _, ib2, ecg2 = _bs(2)
    assert rise2 > 0.2 and np.median(ib2) < 2.0 and ecg2 < 1.5


def _clonic(correlate):
    ev = dict(type="seizure", onset_min=10.0, duration_s=70, onset_region="left_frontal", spread="none",
              evolution=dict(start_hz=6.0, end_hz=2.5, amplitude_start_uv=60, amplitude_end_uv=160),
              clinical_correlate=correlate, muscle="modest")
    s = _synth(_img("child", CHILD, [ev], seed=517403))
    _, _, _, chz, cph = s._recruit_breakpoints(s.seizures[0])
    _, x = s.segment(600.0, 680.0)
    d = s.derive(x, [("F7", "T3")])[0]
    env = np.abs(sps.hilbert(sps.sosfiltfilt(sps.butter(4, [30, 70], btype="bandpass", fs=FS, output="sos"), d)))
    b = env[: (env.size // 13) * 13].reshape(-1, 13).mean(1)
    tb = 600.0 + (np.arange(b.size) + 0.5) * 13 / FS
    cl = (tb > 600 + 0.75 * 70) & (tb < 600 + 0.97 * 70)
    bb = b[cl]
    f, p = sps.periodogram(bb - bb.mean(), FS / 13)
    m = (f > 0.8) & (f < 4)
    pulse = (0.5 + 0.5 * np.cos(2 * np.pi * chz * (tb[cl] - 600) + cph)) ** 4
    return chz, f[m][np.argmax(p[m])], np.percentile(bb, 90) / np.percentile(bb, 10), np.corrcoef(bb, pulse)[0, 1]


def test_focal_clonic_brings_time_locked_myogenic_bursts():
    """Review B4-03: focal clonic keyed with no clonic artifact.  The ictal EMG now comes in bursts on the peaks
    of the run's 1.2-2.2 Hz clonic modulation: the 30-70 Hz envelope oscillates at the clonic rate, deeply, and in
    phase with the EEG's clonic groups.  A non-clonic correlate with muscle keeps a continuous floor."""
    chz, peak, depth, r = _clonic("focal_clonic")
    assert abs(peak - chz) <= 0.2 and depth >= 3.0 and r >= 0.6, (chz, peak, depth, r)
    _, _, depth_s, r_s = _clonic("subtle")
    assert r_s < 0.3 and depth_s < depth


def test_v3_seizure_ictal_and_background_features_are_window_independent():
    """Everything scheduled here is drawn once per record: a sample must not depend on the window that asked."""
    ev = [_sz(60, "left_temporal", clinical_correlate="focal_clonic", muscle="modest")]
    for bg, t_a, t_b in ((ICU, 330.0, 372.0), (BS_BG, 300.0, 330.0), (CAPE_BG, 440.0, 470.0),
                         (BREACH, 300.0, 310.0)):
        s = _synth(_img("adult", bg, ev if bg is ICU else []))
        _, whole = s.segment(t_a - 7.3, t_b + 5.1)
        _, part = s.segment(t_a, t_b)
        i0 = int(round(7.3 * FS))
        np.testing.assert_allclose(whole[:, i0:i0 + part.shape[1]], part, rtol=0, atol=1e-9)


def test_v3_ratio_axis_fits_the_record_after_the_state_change():
    """PQ-G-002: the alpha/delta split (L 0.033 vs R 0.017 from 120 min) sat in the bottom tenth of a 0-0.5 axis
    set by 20 awake minutes.  v3 fits the 5-95th percentile after the first state change; v2 is unchanged."""
    t = np.arange(0, 480, 0.5)
    rng = np.random.default_rng(0)
    left = np.where(t < 20, 0.3, 0.033) * rng.lognormal(0, 0.2, t.size)
    right = np.where(t < 20, 0.3, np.where(t < 120, 0.033, 0.017)) * rng.lognormal(0, 0.2, t.size)
    spec = {"spec_version": 3, "events": [{"type": "state_change", "at_min": 20, "to": "sleep"}]}
    lo, hi = _ratio_axis({}, "alpha_delta_ratio_axis", [left, right], spec, t)
    assert lo == 0.0 and hi <= 0.08
    assert (0.017 - lo) / (hi - lo) > 0.15 and (0.033 - 0.017) / (hi - lo) > 0.2   # the split spans a fifth of it
    lo2, hi2 = _ratio_axis({}, "alpha_delta_ratio_axis", [left, right], dict(spec, spec_version=2), t)
    assert hi2 >= 0.3
