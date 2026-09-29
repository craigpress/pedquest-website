"""0.5.0 phase B fix-focal: what the independent focal review found (feature-review-20260926/focal-independent.md).

Measured on the displayed signal (longitudinal bipolar; neonates the reduced bipolar montage; causal 1-70 Hz page
chain).  The ictal component is the record minus the same record without the event.  References (internal comparison):
  S1  research/eeg-atlas/references/infantile-spasm-craig-20260926.png (= learningeeg atlas-infantile-spasm-i): the
      overriding 17-19 Hz fast activity is 0.4-0.75x the slow wave in F3-C3/C3-P3/P3-O1/Cz-Pz; the temporalis EMG
      burst starts 1.2-1.5 s after the slow-wave trough and does not overlap the wave
  S2  atlas-infantile-spasm-ii: the high-frequency burst follows the wave, into the decrement; the wave stands above
      the hypsarrhythmic chaos
  LO  o1-onset-seizure-bipolar p1: 22-24 Hz low-voltage fast activity in P3-O1/T5-O1 at about 1.5x; p2 16 -> 13 Hz
  L1  atlas-l-temporal-focal-seizure: mesial temporal theta maximal at F7/T1/T3
  L2  atlas-r-temporal-to-bilateral-tcs p3-p5: whole-head tonic EMG, clonic bursts with near-flat pauses
  artifacts.md 1e: blinks 0.9-4.3 channel spacings (median 1.9) and 3-10x their own Fp background (15 blinks, 6 figures)
"""
import copy
from functools import lru_cache

import numpy as np
import pytest
import scipy.signal as sps

from eeg_render import montage as mt
from eeg_render.render_page import apply_filters, build_filters, page_signals
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer

FS = 256
ROW_UV = 73.2          # one channel spacing at 7 uV/mm (test_r050_polish)
ADULT = dict(type="continuous", amplitude_uv=40.0, dominant_hz=9.5, slow_fraction=0.25, reactivity="present",
             channel_gain_max=1.4)
CHILD = dict(type="continuous", amplitude_uv=45.0, dominant_hz=8.5, slow_fraction=0.35, reactivity="present",
             channel_gain_max=1.4)
INFANT = dict(type="continuous", amplitude_uv=60.0, dominant_hz=6.0, slow_fraction=0.5)
HYPS = dict(type="hypsarrhythmia", amplitude_uv=300.0, dominant_hz=1.5, slow_fraction=0.85,
            multifocal_spikes={"rate_per_s": 1.2, "amplitude_uv": 150.0})
NEO_BS = {"type": "burst_suppression", "pma_weeks": 40.0, "amplitude_uv": 60.0, "dominant_hz": 2.0,
          "slow_fraction": 0.8, "reactivity": "present", "channel_gain_max": 1.5, "delta_brushes": "riding"}


def _sz(region, dur=60.0, f0=6.0, f1=2.5, a0=50, a1=150, onset_min=5.0, **extra):
    e = dict(type="seizure", onset_min=onset_min, duration_s=dur, onset_region=region, spread="none",
             evolution=dict(start_hz=f0, end_hz=f1, amplitude_start_uv=a0, amplitude_end_uv=a1))
    e.update(extra)
    return e


CASES = {
    "spasm": ("infant", INFANT, [dict(type="spasm", onset_min=2.1)], 926003, 5),
    "spasm_cluster": ("infant", INFANT, [dict(type="spasm_cluster", onset_min=2.0, interval_s=9.0, count=8)], 926004, 5),
    "spasm_hyps": ("infant", HYPS, [dict(type="spasm_cluster", onset_min=2.05, interval_s=10.0, count=8)], 926002, 5),
    "occipital": ("child", CHILD, [_sz("left_occipital", 50, 8.0, 3.0)], 926104, 12),
    "parietal": ("child", CHILD, [_sz("right_parietal", 45, 7.0, 3.0)], 926109, 12),
    "central": ("child", CHILD, [_sz("left_central", 50, 6.0, 2.5, clinical_correlate="focal_clonic")], 926105, 12),
    "fbtc": ("adult", ADULT, [_sz("right_temporal", 110, 6.0, 2.0, a1=180, spread="generalized",
                                  clinical_correlate="generalized_tonic_clonic", muscle="clinical")], 926106, 12),
    "mesial": ("adult", ADULT, [_sz("left_mesial_temporal", 70, 7.0, 3.0, clinical_correlate="behavioral_arrest")],
               926101, 12),
    "neo_bs": ("neonate", NEO_BS, [_sz("left_temporal", 60, 2.5, 1.2, 40, 100, muscle="none")], 926205, 12),
}


def _image(case, version=3, events=True):
    age, bg, evs, seed, dmin = CASES[case]
    return {"kind": "eeg_page", "license": "synthetic-original", "attribution": None,
            "spec": {"sample_rate": FS, "channels": "neonatal_9" if age == "neonate" else "standard_19",
                     "seed": seed, "spec_version": version, "age_group": age, "duration_min": dmin,
                     "background": copy.deepcopy(bg), "events": copy.deepcopy(evs) if events else []}}


@lru_cache(maxsize=None)
def S(case, version=3, events=True):
    return Synthesizer(normalize(_image(case, version, events))["spec"], float(CASES[case][4]) * 60.0)


def _display(syn, t0, t1, pad=10.0):
    montage = "neonatal_reduced" if syn.age == "neonate" else "longitudinal_bipolar"
    pairs = [p for p in mt.montage_pairs(montage, syn.scalp) if p[1]]
    _, x = syn.segment(t0 - pad, t1)
    d = apply_filters(syn.derive(x, pairs), build_filters(FS, {"lf_hz": 1.0, "hf_hz": 70.0}, True), True)
    return d[:, int(round(pad * FS)):], [f"{a}-{b}" for a, b in pairs]


def _pair(case, t0, t1):
    A, names = _display(S(case), t0, t1)
    B, _ = _display(S(case, events=False), t0, t1)
    return A, B, A - B, names


def _band(x, lo, hi):
    return sps.sosfiltfilt(sps.butter(4, [lo, hi], btype="band", fs=FS, output="sos"), x, axis=-1)


def _peak_hz(y, lo, hi):
    f, p = sps.welch(y, FS, nperseg=min(len(y), FS), nfft=4 * FS)
    m = (f >= lo) & (f <= hi)
    return float(f[m][np.argmax(p[m])])


# ------------------------------------------------------------------------------------------------ spasms

@lru_cache(maxsize=None)
def _spasm_decomposition(case, k):
    """Per chain (slow-wave p2p, 14-30 Hz p2p on the wave, pre-spasm chaos p2p) and timing of spasm ``k``."""
    syn = S(case)
    z = sorted([q for q in syn.seizures if q.kind == "spasm"], key=lambda q: q.t0)[k]
    A, B, I, names = _pair(case, z.t0 - 3.0, z.t0 + 6.0)
    s = lambda u, v: slice(int((3 + u) * FS), int((3 + v) * FS))
    slow, fast, emg = _band(I, 0.3, 4.0), _band(I, 14.0, 30.0), _band(I, 35.0, 70.0)
    out = {}
    for c in names:
        j = names.index(c)
        out[c] = (np.ptp(slow[j, s(-0.2, 1.5)]), np.ptp(fast[j, s(0.0, z.duration_s)]),
                  np.median(np.ptp(B[j, s(-3, 0)].reshape(3, FS), axis=1)),
                  _peak_hz(fast[j, s(0.0, z.duration_s + 0.2)], 10.0, 32.0),
                  np.std(emg[j, s(0.0, z.duration_s)]), np.std(_band(A[j], 35.0, 70.0)[s(-2.5, -0.3)]))
    tt = np.arange(I.shape[1]) / FS - 3.0
    jc = names.index("Cz-Pz")
    trough = tt[s(-0.2, 1.5)][np.argmin(slow[jc, s(-0.2, 1.5)])]
    onsets = []
    for c in ("F7-T3", "F8-T4"):
        env = sps.savgol_filter(np.abs(sps.hilbert(emg[names.index(c)])), 51, 2)[s(-0.2, 4.0)]
        onsets.append(tt[s(-0.2, 4.0)][np.argmax(env > 0.5 * env.max())] - trough)
    return out, onsets


@pytest.mark.parametrize("case,k", [("spasm", 0), ("spasm_cluster", 0), ("spasm_cluster", 1), ("spasm_cluster", 2)])
def test_spasm_overriding_fast_activity_is_sized_to_the_wave(case, k):
    """S1: the overriding fast activity is 0.4-0.75x the slow wave in F3-C3, C3-P3, P3-O1 and Cz-Pz and peaks at 17-19 Hz.
    focal-independent measured 0.06-0.12x (wave_fast_uv 40 on a field**2 weighting)."""
    d, _ = _spasm_decomposition(case, k)
    chains = ("F3-C3", "C3-P3", "P3-O1", "Cz-Pz")
    r = np.array([d[c][1] / d[c][0] for c in chains])
    assert 0.40 <= np.median(r) <= 0.75, dict(zip(chains, r.round(2)))
    assert r.min() >= 0.30 and r.max() <= 0.90, dict(zip(chains, r.round(2)))    # one spasm, beating components
    hz = [d[c][3] for c in ("F3-C3", "Cz-Pz")]
    assert all(15.5 <= h <= 22.0 for h in hz), hz                  # 17-19 Hz, per-electrode spread and 1-s Welch


@pytest.mark.parametrize("case,k", [("spasm", 0), ("spasm_cluster", 1), ("spasm_hyps", 0)])
def test_spasm_emg_follows_the_wave(case, k):
    """S1: the temporalis burst starts 1.2-1.5 s after the slow-wave trough and does not overlap the wave (S2: it runs
    into the decrement).  focal-independent: the burst peaked 0.21 s after the trough, on the wave, where it read as the
    overriding fast activity.  On the wave the fast activity a reader sees is cerebral: 14-30 Hz above >35 Hz."""
    d, onsets = _spasm_decomposition(case, k)
    assert all(1.1 <= o <= 1.75 for o in onsets), onsets
    for c in ("F7-T3", "F8-T4", "T3-T5", "T4-T6"):
        assert d[c][4] <= 1.5 * d[c][5], (c, d[c][4], d[c][5])        # >35 Hz on the wave stays near its floor
    for c in ("F3-C3", "Cz-Pz", "C3-P3"):
        assert d[c][1] >= 3.0 * 2.0 * d[c][4], (c, d[c][1], d[c][4])   # 14-30 Hz p2p vs >35 Hz RMS (p2p ~2x RMS)


def test_spasm_on_hypsarrhythmia_stands_above_the_chaos():
    """S2 / focal-independent: on hypsarrhythmia the wave was 1.0-1.3x the chaos in the lateral chains and 2.1-2.5x at the
    midline.  The wave now stands above it laterally (median of the lateral chains >= 1.3x) and towers at the midline."""
    lat = ("F3-C3", "C3-P3", "P3-O1", "F7-T3", "T3-T5", "F4-C4", "C4-P4", "P4-O2", "F8-T4", "T4-T6")
    rl, rm = [], []
    for k in range(3):
        d, _ = _spasm_decomposition("spasm_hyps", k)
        rl += [d[c][0] / d[c][2] for c in lat]
        rm += [d[c][0] / d[c][2] for c in ("Fz-Cz", "Cz-Pz")]
    assert np.median(rl) >= 1.3, np.round(rl, 2)
    assert np.median(rm) >= 2.5, np.round(rm, 2)


def test_spasm_defaults_are_version_gated():
    ev = lambda v: normalize({"kind": "eeg_page", "license": "synthetic-original", "attribution": None,
                              "spec": {"sample_rate": FS, "channels": "standard_19", "seed": 1, "spec_version": v,
                                       "age_group": "infant", "duration_min": 2, "background": dict(INFANT),
                                       "events": [dict(type="spasm", onset_min=1.0)]}})["spec"]
    assert ev(2)["events"][0]["wave_fast_uv"] == 40.0
    assert ev(3)["events"][0]["wave_fast_uv"] == 110.0
    assert ev(2)["background"]["blink_amplitude_uv"] == 160.0
    assert ev(3)["background"]["blink_amplitude_uv"] == 250.0


# ------------------------------------------------------------------------------------------------ posterior onsets

@pytest.mark.parametrize("case,chains", [("occipital", ("P3-O1", "T5-O1")), ("parietal", ("P4-O2", "C4-P4"))])
def test_posterior_onset_starts_above_the_alpha_band(case, chains):
    """focal-independent: the onset was an 11 -> 8 Hz rhythm (the 7-13 Hz clip) that read as an asymmetric alpha.
    r9 (gallery-20260929, Lab guide "rhythmic spikes"): phase B's 15-25 Hz onset read as low-voltage fast activity;
    the onset is now rhythmic spikes at 11-15 Hz (test_r052_seizures), still above the alpha rhythm, then slows."""
    z = S(case).seizures[0]
    A, B, I, names = _pair(case, z.t0, z.t0 + 10.0)
    js = [names.index(c) for c in chains]
    j = max(js, key=lambda q: np.std(I[q, : int(1.5 * FS)]))
    y = I[j, : int(1.5 * FS)]
    assert 10.0 <= _peak_hz(y, 2.0, 40.0) <= 16.0, _peak_hz(y, 2.0, 40.0)
    assert _peak_hz(I[j, 6 * FS: 10 * FS], 2.0, 40.0) <= 13.0            # then it slows


def test_central_onset_keeps_its_alpha_theta_rhythm():
    """focal-independent passed the central onset (9 -> 5 Hz, C3 phase reversal); the posterior change leaves it."""
    z = S("central").seizures[0]
    _, _, I, names = _pair("central", z.t0, z.t0 + 4.0)
    assert 5.0 <= _peak_hz(I[names.index("C3-P3"), : 2 * FS], 2.0, 40.0) <= 13.0


# ------------------------------------------------------------------------------------------------ bilateral TC

def test_bilateral_tonic_clonic_suppresses_the_background():
    """L2 p5: near-flat pauses between the clonic bursts.  focal-independent: the posterior alpha ran on in the pauses
    at 76-85 % of its pre-ictal RMS and normal blinks kept occurring through the clonic phase."""
    syn = S("fbtc")
    z = syn.seizures[0]
    t_b, t_c = syn._gtc_times(z)
    A, names = _display(syn, z.t0 - 20.0, z.t1)
    tt = z.t0 - 20.0 + np.arange(A.shape[1]) / FS
    _, clonic, pulse = syn._gtc_pulse(z, tt)
    pause = (clonic > 0.9) & (pulse < 0.02)
    pre = tt < z.t0 - 1.0
    assert pause.sum() > 5 * FS
    for c in ("P4-O2", "T6-O2", "P3-O1"):
        al = _band(A[names.index(c)], 8.0, 12.0)
        assert np.std(al[pause]) <= 0.3 * np.std(al[pre]), (c, np.std(al[pause]) / np.std(al[pre]))
    # blinks: the background envelope that gates them is at most 0.15 from 3 s after the bilateral onset to the offset
    bt = syn._blink_t[(syn._blink_t > t_b + 3.0) & (syn._blink_t < z.t1 - 1.0)]
    assert bt.size >= 3 and syn.gtc_bg_envelope(bt + 0.1).max() <= 0.15
    before = syn._blink_t[(syn._blink_t > z.t0 - 60.0) & (syn._blink_t < z.t0 - 1.0)]
    assert np.all(syn.gtc_bg_envelope(before) == 1.0)


# ------------------------------------------------------------------------------------------------ mesial temporal

def test_mesial_temporal_maximum_stays_anterior():
    """L1: the maximum stays at F7/T1/T3 (Fp1-F7 / F7-T3).  focal-independent: from 5 s the maximum was T3-T5 (65 vs 48
    uV; 101 vs 80 at 20 s), which reads as mid-temporal; T5 should stay at or below half of F7 until after 30 s."""
    z = S("mesial").seizures[0]
    _, _, I, names = _pair("mesial", z.t0, z.t0 + 30.0)
    for w0 in (0, 5, 10, 15, 20, 25):
        seg = I[:, w0 * FS:(w0 + 4) * FS]
        p = np.median(np.ptp(seg.reshape(len(names), 4, FS), axis=2), axis=1)
        ant = max(p[names.index("Fp1-F7")], p[names.index("F7-T3")])
        assert ant >= p[names.index("T3-T5")], (w0, dict(zip(names, p.round())))
        assert p[names.index("T5-O1")] <= 0.5 * p[names.index("F7-T3")], (w0, dict(zip(names, p.round())))
        assert ant >= 0.95 * p.max(), (w0, names[int(np.argmax(p))])


# ------------------------------------------------------------------------------------------------ neonatal BS

def test_postictal_delta_on_burst_suppression_is_proportionate():
    """focal-independent: on a burst-suppression background the postictal left temporal delta was 8-18x the interburst
    for 10 s, as large as the seizure; review target: at most 2-3x the interburst.  It stays visible (>= 1.3x)."""
    syn = S("neo_bs")
    z = syn.seizures[0]
    A, B, I, names = _pair("neo_bs", z.t0 - 60.0, z.t1 + 20.0)
    off = lambda t: int(round((t - (z.t0 - 60.0)) * FS))
    for c in ("Fp1-T3", "T3-O1", "T3-C3"):
        j = names.index(c)
        ib = np.percentile(np.ptp(B[j, : off(z.t0)].reshape(-1, FS), axis=1), 20)
        post = [np.median(np.ptp(I[j, off(z.t1 + w):off(z.t1 + w + 5)].reshape(-1, FS), axis=1)) for w in (0, 5, 10)]
        ict = np.median(np.ptp(I[j, off(z.t0 + 10):off(z.t1 - 5)].reshape(-1, FS), axis=1))
        assert max(post) <= 3.5 * ib and max(post) >= 1.3 * ib, (c, np.round(np.array(post) / ib, 1))
        assert ict >= 3.0 * max(post)


# ------------------------------------------------------------------------------------------------ blinks

BLINKS = {"adult": [(90511, 30.0, 10.0), (90514, 35.0, 10.0), (91001, 40.0, 9.5), (91011, 30.0, 10.0), (91012, 45.0, 9.0),
                    (91013, 35.0, 10.5)],
          "child": [(90512, 50.0, 9.0), (90513, 45.0, 8.5), (90516, 50.0, 9.0), (91021, 55.0, 8.0), (91022, 45.0, 9.0),
                    (91023, 50.0, 8.5)],
          "infant": [(90515, 60.0, 6.5), (926003, 60.0, 6.0), (91002, 70.0, 6.0), (91031, 60.0, 5.5), (91032, 80.0, 6.0),
                     (91033, 55.0, 6.5)]}


def _blink_page(seed, age, amp, dom, rate, at):
    bg = {"type": "continuous", "amplitude_uv": amp, "dominant_hz": dom, "slow_fraction": 0.3,
          "reactivity": "present", "blink_rate_per_min": rate}
    img = {"kind": "eeg_page", "license": "synthetic-original", "attribution": None,
           "spec": {"sample_rate": FS, "channels": "standard_19", "seed": seed, "spec_version": 3, "age_group": age,
                    "duration_min": 10, "at_min": at, "window_s": 30.0, "montage": "longitudinal_bipolar",
                    "sensitivity_uv_mm": 7.0, "background": bg, "events": []}}
    return page_signals(normalize(img)["spec"])


@lru_cache(maxsize=None)
def _eyes_open_blinks(age):
    """Isolated eyes-open blinks (eye-state gate > 0.5): Fp1-F3 peak above baseline (uV), its ratio to the Fp1-F3
    background (2.5-97.5 percentile range), and the blink-only Fp1-F7 peak-to-peak (uV)."""
    peaks, ratios, p2p = [], [], []
    for seed, amp, dom in BLINKS[age]:
        for at in (2.0, 5.0, 8.0):
            syn, t, sig, pairs, _ = _blink_page(seed, age, amp, dom, 15.0, at)
            _, _, sig0, _, _ = _blink_page(seed, age, amp, dom, 0.0, at)
            names = [f"{a}-{b}" for a, b in pairs]
            r, r7 = names.index("Fp1-F3"), names.index("Fp1-F7")
            x, x0 = sig[r], sig0[r]
            bg = np.percentile(x0, 97.5) - np.percentile(x0, 2.5)
            pk = syn._blink_t + 0.10
            open_ = syn._eye_factor(pk)[1] > 0.5
            for i, p in enumerate(pk):
                if not (t[0] + 0.5 < p < t[-1] - 0.6) or not open_[i]:
                    continue
                if (i and p - pk[i - 1] < 0.7) or (i < len(pk) - 1 and pk[i + 1] - p < 0.7):
                    continue
                k = int(round((p - t[0]) * FS))
                k = k - int(0.05 * FS) + int(np.argmax(x[k - int(0.05 * FS):k + int(0.05 * FS)]))
                base = np.median(x[max(0, k - int(0.5 * FS)):k - int(0.2 * FS)])
                peaks.append(x[k] - base)
                ratios.append((x[k] - base) / bg)
                d7 = (sig - sig0)[r7]
                p2p.append(np.ptp(d7[max(0, k - int(0.3 * FS)):k + int(0.5 * FS)]))
    return np.array(peaks), np.array(ratios), np.array(p2p)


@pytest.mark.parametrize("age", ["adult", "child", "infant"])
def test_eyes_open_blinks_match_the_reference_size(age):
    """artifacts.md 1e: 0.9-4.3 spacings (median 1.9) and 3-10x the Fp background.  focal-independent /
    generalized-independent: 320 uV displayed 522-686 uV p2p in Fp1-F7 (eyes-open Fp1-F3 median 2.0-2.4 rows, maxima
    5-6.7 rows).  Adults sit at the 1.9-spacing median; children and infants, whose background is larger, lower."""
    peaks, ratios, p2p = _eyes_open_blinks(age)
    assert peaks.size >= 15
    rows = peaks / ROW_UV
    if age == "adult":
        assert 1.6 <= np.median(rows) <= 2.3, np.median(rows)
    else:
        assert 1.2 <= np.median(rows) <= 2.0, np.median(rows)
    assert rows.max() <= 4.3, rows.max()
    assert 3.0 <= np.median(ratios) <= 10.0, np.median(ratios)
    assert p2p.max() <= 500.0, p2p.max()


def test_blink_tail_is_bounded():
    syn = S("spasm")
    a = syn._blink_amp
    assert a.min() >= 0.65 - 1e-12 and a.max() <= 1.45 + 1e-12 and 0.9 <= np.median(a) <= 1.1


# ------------------------------------------------------------------------------------------------ window independence

@pytest.mark.parametrize("case,w", [("spasm", (126.5, 129.5)), ("spasm_hyps", (123.5, 127.0)),
                                    ("fbtc", (347.0, 353.0)), ("fbtc", (408.0, 413.0)),
                                    ("occipital", (299.5, 303.0)), ("mesial", (325.0, 334.0)),
                                    ("neo_bs", (359.0, 368.0))])
def test_fix_focal_features_are_window_independent(case, w):
    """The spasm EMG onset, the GTC background gate, the posterior onset, the mesial recruitment and the BS postictal
    delta are drawn once per record."""
    syn = S(case)
    t_a, t_b = w
    _, whole = syn.segment(t_a - 6.1, t_b + 4.3)
    _, part = syn.segment(t_a, t_b)
    i0 = int(round(6.1 * FS))
    np.testing.assert_allclose(whole[:, i0:i0 + part.shape[1]], part, rtol=0, atol=1e-9)
