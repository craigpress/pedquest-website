"""0.5.0 phase D: focal seizures, spasms and neonatal seizure types (feature review 2026-09-26, focal-review.md).

Every measurement is on the displayed signal: longitudinal bipolar (neonatal: the reduced bipolar montage) through the
causal 1-70 Hz page chain.  The ictal component is (record - same record without the event), so the background is
identical.  References (cached under research/eeg-atlas/references/cache/learningeeg/, internal comparison only):
  L1  atlas-l-temporal-focal-seizure p1        rhythmic 6-8 Hz theta building at F7/T1/T3 (mesial temporal onset)
  LP  atlas-l-posterior-quadrant-seizure p1    T1/T2 theta building from low voltage
  LO  o1-onset-seizure-bipolar p1/p2           posterior fast/rhythmic activity in P3-O1 / T5-O1
  L2  atlas-r-temporal-to-bilateral-tcs p1-p6  focal onset, whole-head tonic EMG (p3), slowing clonic bursts (p5)
  T1/T2 atlas-tonic-seizure-i/-ii              decrement, then 10-20 Hz fast in every chain incl. parasagittal
  S1  infantile-spasm-craig-20260926.png = atlas-infantile-spasm-i; S2 atlas-infantile-spasm-ii
Neonatal types follow the ACNS 2013 neonatal terminology (Tsuchida et al., J Clin Neurophysiol 2013): >= 10 s evolving
rhythmic discharges; focal clonic = repetitive sharp waves at the clonic rate; seizures may arise from a
burst-suppression background.
"""
import copy
from functools import lru_cache

import numpy as np
import pytest
import scipy.signal as sps

from eeg_render import montage as mt
from eeg_render.render_page import apply_filters, build_filters
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer

FS = 256
ADULT = dict(type="continuous", amplitude_uv=40.0, dominant_hz=9.5, slow_fraction=0.25, reactivity="present",
             channel_gain_max=1.4)
CHILD = dict(type="continuous", amplitude_uv=45.0, dominant_hz=8.5, slow_fraction=0.35, reactivity="present",
             channel_gain_max=1.4)
ICU = dict(type="continuous", amplitude_uv=35.0, dominant_hz=3.0, slow_fraction=0.8, reactivity="absent",
           channel_gain_max=1.5, blink_rate_per_min=0)
INFANT = dict(type="continuous", amplitude_uv=60.0, dominant_hz=6.0, slow_fraction=0.5)
HYPS = dict(type="hypsarrhythmia", amplitude_uv=300.0, dominant_hz=1.5, slow_fraction=0.85,
            multifocal_spikes={"rate_per_s": 1.2, "amplitude_uv": 150.0})


def _neo_bg(bg_type="continuous", amp=40.0):
    return {"type": bg_type, "pma_weeks": 40.0, "amplitude_uv": amp, "dominant_hz": 2.0, "slow_fraction": 0.8,
            "reactivity": "present", "channel_gain_max": 1.5, "delta_brushes": "riding"}


def _sz(region, dur=60.0, f0=6.0, f1=2.5, a0=50, a1=150, onset_min=5.0, **extra):
    e = dict(type="seizure", onset_min=onset_min, duration_s=dur, onset_region=region, spread="none",
             evolution=dict(start_hz=f0, end_hz=f1, amplitude_start_uv=a0, amplitude_end_uv=a1))
    e.update(extra)
    return e


CASES = {
    "mesial": ("adult", ADULT, [_sz("left_mesial_temporal", 70, 7.0, 3.0)], 926101, 12),
    "neocortical": ("adult", ADULT, [_sz("left_temporal", 60, 5.0, 2.5)], 926102, 12),
    "frontal": ("child", CHILD, [_sz("left_frontal", 40, 9.0, 3.0, clinical_correlate="focal_tonic")], 926103, 12),
    "occipital": ("child", CHILD, [_sz("left_occipital", 50, 8.0, 3.0)], 926104, 12),
    "central": ("child", CHILD, [_sz("left_central", 50, 6.0, 2.5, clinical_correlate="focal_clonic")], 926105, 12),
    "fbtc": ("adult", ADULT, [_sz("right_temporal", 110, 6.0, 2.0, a1=180, spread="generalized",
                                  clinical_correlate="generalized_tonic_clonic", muscle="clinical")], 926106, 12),
    "tonic": ("child", CHILD, [dict(type="tonic_seizure", onset_min=2.0)], 926005, 5),
    "spasm": ("infant", INFANT, [dict(type="spasm", onset_min=2.1)], 926003, 5),
    "spasm_left": ("infant", INFANT, [dict(type="spasm", onset_min=2.1, side="left")], 926003, 5),
    "spasm_tonic": ("infant", INFANT, [dict(type="spasm", onset_min=2.1, tonic_s=1.6)], 926003, 5),
    "spasm_hyps": ("infant", HYPS, [dict(type="spasm_cluster", onset_min=2.05, interval_s=10.0, count=6)], 926002, 5),
    "neo_clonic": ("neonate", _neo_bg(), [_sz("left_central", 60, 1.5, 1.0, 60, 120, muscle="none",
                                            clinical_correlate="focal_clonic")], 926201, 12),
    "neo_multifocal": ("neonate", _neo_bg(), [_sz("left_central", 60, 3.0, 1.5, 50, 110, muscle="none"),
                                             _sz("right_temporal", 50, 2.0, 1.2, 50, 110, onset_min=5.4, muscle="none")],
                       926202, 12),
    "neo_electrographic": ("neonate", _neo_bg(), [_sz("right_temporal", 90, 3.0, 1.5, 40, 120, muscle="none",
                                                     clinical_correlate="none")], 926204, 12),
    "neo_bs": ("neonate", _neo_bg("burst_suppression", 60.0), [_sz("left_temporal", 60, 2.5, 1.2, 40, 100, muscle="none")],
               926205, 12),
    "c15": ("child", CHILD, [_sz("left_temporal", 10, 5.0, 3.0, 50, 140)], 515411, 12),
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


def _pair(case, w0, w1, which=0):
    """(record, background-only record, ictal component, names) from w0..w1 s after event ``which``'s onset."""
    a, b = S(case), S(case, events=False)
    z = sorted(a.seizures, key=lambda q: q.t0)[which]
    A, names = _display(a, z.t0 + w0, z.t0 + w1)
    B, _ = _display(b, z.t0 + w0, z.t0 + w1)
    return A, B, A - B, names, z


def _p2p(x, n):
    return np.median(np.ptp(x[:, : n * FS].reshape(x.shape[0], n, FS), axis=2), axis=1)


def _band(x, lo, hi):
    return sps.sosfiltfilt(sps.butter(4, [lo, hi], btype="band", fs=FS, output="sos"), x, axis=-1)


def _hp(x, f=30.0):
    return sps.sosfiltfilt(sps.butter(4, f, btype="high", fs=FS, output="sos"), x, axis=-1)


def _peak_hz(y, lo=0.5, hi=30.0):
    f, p = sps.welch(y, FS, nperseg=min(len(y), 2 * FS))
    m = (f >= lo) & (f <= hi)
    return float(f[m][np.argmax(p[m])])


# ------------------------------------------------------------------------------------------------ onset by region

def test_onset_pattern_resolves_by_region():
    pats = {c: S(c).seizures[0].onset_pattern for c in ("mesial", "neocortical", "frontal", "occipital", "central")}
    assert pats == {"mesial": "rhythmic_theta", "neocortical": "lvfa", "frontal": "electrodecrement",
                    "occipital": "rhythmic_spikes", "central": "rhythmic_spikes"}, pats


def test_mesial_temporal_onset_is_anterior_rhythmic_theta_that_builds():
    """L1 / LP: rhythmic 5-9 Hz theta from the first seconds, maximal anterior temporal (Fp1-F7 / F7-T3, the F7 phase
    reversal), T5-O1 near silent, then building in voltage.  Before phase D the mesial onset did not exist: a
    left_temporal run started with 14-21 Hz low-voltage fast activity maximal in T3-T5."""
    _, _, I, names, _ = _pair("mesial", 0.5, 4.5)
    ant = [names.index("Fp1-F7"), names.index("F7-T3")]
    j = max(ant, key=lambda k: np.ptp(I[k]))
    assert 5.0 <= _peak_hz(I[j]) <= 9.0, _peak_hz(I[j])
    p = _p2p(I, 4)
    assert p[ant].min() >= 3.0 * p[names.index("T5-O1")], dict(zip(names, p.round()))
    assert p[ant].max() >= 0.9 * p.max()
    _, _, I2, _, _ = _pair("mesial", 10.0, 14.0)
    assert _p2p(I2, 4)[ant].max() >= 1.3 * p[ant].max()


def test_neocortical_temporal_keeps_the_low_voltage_fast_onset():
    """Neocortical temporal (left_temporal) keeps the 0.4.0 low-voltage fast onset, maximal in F7-T3/T3-T5."""
    _, _, I, names, z = _pair("neocortical", 0.0, 2.0)
    j = names.index("T3-T5")
    assert _peak_hz(I[j], 0.5, 40.0) >= 1.8 * z.start_hz
    p = _p2p(I, 2)
    assert names[int(np.argmax(p))] in ("T3-T5", "F7-T3")


def test_frontal_onset_is_a_regional_electrodecrement_with_low_voltage_fast():
    """Frontal-lobe onsets: an electrodecrement or low-voltage fast activity, often obscured by muscle.  The 1-8 Hz
    background over the left frontal chain drops below 55 % of the same record without the event while 15-30 Hz
    ictal activity starts there; the right frontal chain is not attenuated."""
    A, B, I, names, z = _pair("frontal", 0.2, 1.6)
    lf = [names.index("F3-C3"), names.index("C3-P3")]           # Fp1-F3 carries blinks, which are ocular
    rf = [names.index("F4-C4"), names.index("C4-P4")]
    slowA, slowB = np.std(_band(A, 1.0, 8.0), axis=1), np.std(_band(B, 1.0, 8.0), axis=1)
    assert (slowA[lf] / slowB[lf]).max() <= 0.55, (slowA / slowB)[lf]
    assert (slowA[rf] / slowB[rf]).min() >= 0.85, (slowA / slowB)[rf]
    fast = np.std(_band(I, 15.0, 30.0), axis=1) / np.std(_band(B, 15.0, 30.0), axis=1)
    assert fast[lf].max() >= 1.5, fast[lf]


def test_occipital_onset_is_posterior_rhythmic_spikes():
    """LO: posterior rhythmic activity at onset in P3-O1 / T5-O1, at alpha-beta rates with sharp transients.  The v2
    occipital field (O1/T5/P3 nearly in phase) read maximal in C3-P3 with P3-O1 below it."""
    _, _, I, names, _ = _pair("occipital", 0.5, 4.5)
    p = _p2p(I, 4)
    post = max(p[names.index("P3-O1")], p[names.index("T5-O1")])
    assert post >= 1.2 * p[names.index("C3-P3")], dict(zip(names, p.round()))
    j = names.index("T5-O1")
    assert 7.0 <= _peak_hz(I[j]) <= 14.0
    # surface-negative spikes at the focus, read referentially at O1 (the ictal field itself, before the chain):
    # negative peaks at least 1.8x the positive ones, where the same run with a plain lvfa onset is symmetric
    syn = S("occipital")
    z = syn.seizures[0]
    t = np.arange(z.t0 + 10.0, z.t0 + 20.0, 1.0 / FS)
    y = syn._seizure_block(t)[syn._idx["O1"]]
    pp, _ = sps.find_peaks(y, prominence=0.3 * np.ptp(y))
    pn, _ = sps.find_peaks(-y, prominence=0.3 * np.ptp(y))
    assert np.median(-y[pn]) >= 1.8 * np.median(y[pp]), (np.median(-y[pn]), np.median(y[pp]))


# ------------------------------------------------------------------------------------------------ focal to bilateral

def test_focal_to_bilateral_tonic_clonic_phases():
    """L2: after the focal onset, the tonic phase obscures the whole head with EMG (p3; midline least), then the
    clonic phase breaks it into bursts that slow, with near-silent pauses (p5).  Before phase D the GTC correlate
    drew a 1.5x temporal EMG floor and no tonic phase."""
    syn = S("fbtc")
    z = syn.seizures[0]
    t_b, t_c = syn._gtc_times(z)
    pre, _ = _display(syn, z.t0 - 10.0, z.t0 - 2.0)
    ton, names = _display(syn, t_b + 4.0, t_c - 1.0)
    e_pre, e_ton = np.std(_hp(pre), axis=1), np.std(_hp(ton), axis=1)
    r = e_ton / e_pre
    for ch in ("F7-T3", "F8-T4", "F3-C3", "C4-P4"):
        assert r[names.index(ch)] >= 5.0, (ch, r[names.index(ch)])
    assert e_ton[names.index("Fz-Cz")] < 0.8 * e_ton[names.index("F8-T4")]         # midline least
    cl, _ = _display(syn, t_c + 1.0, z.t1 - 0.5)
    env = np.sqrt(np.clip(sps.sosfiltfilt(sps.butter(2, 6.0, fs=FS, output="sos"), _hp(cl)[names.index("F8-T4")] ** 2), 0, None))
    assert np.percentile(env, 95) >= 4.0 * np.percentile(env, 20)          # bursts and pauses
    pk, _ = sps.find_peaks(env, distance=int(0.25 * FS), prominence=0.5 * np.percentile(env, 95))
    gaps = np.diff(pk) / FS
    half = len(gaps) // 2
    assert np.median(gaps[:half]) < np.median(gaps[half:])                  # the clonic jerks slow


def test_fbtc_key_names_the_phases():
    from eeg_render.export.manifest import realized_events
    rows = [r for r in realized_events(S("fbtc"), 720.0) if r.get("clinical_correlate") == "generalized_tonic_clonic"]
    assert rows and "tonic_phase_s" in rows[0] and "clonic_phase_s" in rows[0]
    assert rows[0]["onset_pattern"] == "lvfa"


# ------------------------------------------------------------------------------------------------ tonic seizure

def test_tonic_seizure_fast_activity_reaches_the_parasagittal_chain():
    """T1/T2: generalized 10-20 Hz fast activity in every chain, parasagittal and midline included.  The v2 run was
    near-synchronous, so it cancelled in the bipolar chain (F3-C3/Fp1-F3 10-24 uV against 76 uV referential)."""
    syn = S("tonic")
    z = next(q for q in syn.seizures if q.kind == "tonic_seizure")
    t = np.arange(z.t1 - 4.0, z.t1, 1.0 / FS)
    pairs = [p for p in mt.montage_pairs("longitudinal_bipolar", syn.scalp) if p[1]]
    d = syn.derive(syn._seizure_block(t), pairs)
    names = [f"{a}-{b}" for a, b in pairs]
    p = np.ptp(d, axis=1)
    authored = float(z.amp_end)
    assert np.sum(p >= 0.3 * authored) >= 14 and np.median(p) >= 0.4 * authored, dict(zip(names, p.round()))
    for ch in ("F3-C3", "F4-C4", "Fz-Cz", "C3-P3"):
        assert p[names.index(ch)] >= 0.4 * authored, (ch, p[names.index(ch)])
    _, B, I, names2, _ = _pair("tonic", z.duration_s - 4.0, z.duration_s)
    ratio = np.std(_band(I, 10.0, 25.0), axis=1) / np.std(_band(B, 10.0, 25.0), axis=1)
    assert ratio[names2.index("F4-C4")] >= 1.5 and ratio[names2.index("Fz-Cz")] >= 1.5, ratio


# ------------------------------------------------------------------------------------------------ spasms

def _spasm_window(case, w0, w1):
    syn = S(case)
    z = next(q for q in syn.seizures if q.kind == "spasm" and q.t0 > 60.0)
    d, names = _display(syn, z.t0 + w0, z.t0 + w1)
    return syn, z, d, names


def test_spasm_emg_burst_is_striking_in_the_temporal_chains():
    """S1/S2: the EMG burst is the most striking high-frequency event.  epileptiform-v3: >30 Hz rose only 1.2-2x
    because the decrement multiplied the burst; target at least 4x the pre-spasm level in the temporal chains."""
    syn, z, pre, names = _spasm_window("spasm", -2.5, -0.3)
    _, _, burst, _ = _spasm_window("spasm", 0.42, 0.42 + z.tonic_s)
    r = np.std(_hp(burst), axis=1) / np.std(_hp(pre), axis=1)
    for ch in ("F7-T3", "T3-T5", "F8-T4", "T4-T6"):
        assert r[names.index(ch)] >= 4.0, (ch, r[names.index(ch)])
    assert r[names.index("Cz-Pz")] < r[names.index("T3-T5")]


def test_spasm_slow_wave_reaches_the_temporal_chains():
    """S1: F7-T3 and T3-T5 carry the slow wave (Craig's figure).  epileptiform-v3: 1.6-1.9x the page median."""
    syn, z, d, names = _spasm_window("spasm", -6.0, 8.0)
    t = np.arange(d.shape[1]) / FS - 6.0
    m = (t > -0.1) & (t < z.duration_s + 0.2)
    far = (t < -1.0) | (t > 5.0)
    med = np.median(_p2p(d[:, far][:, : (far.sum() // FS) * FS], int(far.sum() // FS)))
    for ch in ("F7-T3", "T3-T5", "F8-T4", "T4-T6"):
        assert np.ptp(d[names.index(ch)][m]) >= 2.5 * med, (ch, np.ptp(d[names.index(ch)][m]), med)


def test_asymmetric_spasm_is_larger_on_the_named_side():
    """Asymmetric spasm (side = left): slow wave and overriding fast activity larger over the left hemisphere."""
    syn, z, d, names = _spasm_window("spasm_left", -0.1, 1.0)
    L = [names.index(c) for c in ("Fp1-F7", "F7-T3", "T3-T5", "F3-C3", "C3-P3")]
    R = [names.index(c) for c in ("Fp2-F8", "F8-T4", "T4-T6", "F4-C4", "C4-P4")]
    p = np.ptp(d, axis=1)
    assert np.median(p[L]) >= 1.5 * np.median(p[R]), (p[L], p[R])
    f = np.std(_band(d, 15.0, 28.0), axis=1)
    assert np.median(f[L]) >= 1.5 * np.median(f[R])


def test_tonic_spasm_holds_the_contraction():
    """A tonic spasm holds the EMG for its tonic_s (1.6 s here); the default burst is about 0.4 s."""
    def emg_len(case):
        syn, z, d, names = _spasm_window(case, -1.0, 4.0)
        e = _hp(d)[names.index("T3-T5")] ** 2
        e = sps.sosfiltfilt(sps.butter(2, 4.0, fs=FS, output="sos"), e)
        return float(np.sum(e > 0.25 * e.max())) / FS
    short, long_ = emg_len("spasm"), emg_len("spasm_tonic")
    assert short <= 0.9 and long_ >= 1.3, (short, long_)


# ------------------------------------------------------------------------------------------------ neonatal types

def test_neonatal_focal_clonic_is_repetitive_sharp_waves_with_locked_jerks():
    """ACNS 2013 / neonatal focal clonic: repetitive focal sharp waves at the clonic rate (here authored 1.5 -> 1 Hz),
    each followed by a myogenic jerk.  Before phase D it was a rounded harmonic delta run with no motor artifact."""
    A, B, I, names, z = _pair("neo_clonic", 5.0, 45.0)
    j = names.index("C3-Cz")
    y = _band(I[j], 1.0, 30.0)
    pk, _ = sps.find_peaks(np.abs(y), distance=int(0.3 * FS), prominence=0.5 * np.percentile(np.abs(y), 99))
    rate = len(pk) / 40.0
    assert 0.7 <= rate <= 2.0, rate
    # sharp: a discharge half-width under 120 ms
    widths = sps.peak_widths(np.abs(y), pk, rel_height=0.5)[0] / FS
    assert np.median(widths) <= 0.12, np.median(widths)
    e = _hp(A[names.index("T3-C3")]) ** 2
    after = np.concatenate([e[p + int(0.02 * FS): p + int(0.15 * FS)] for p in pk if p + int(0.2 * FS) < e.size])
    between = np.concatenate([e[p + int(0.3 * FS): p + int(0.5 * FS)] for p in pk if p + int(0.55 * FS) < e.size])
    assert np.sqrt(after.mean()) >= 2.5 * np.sqrt(between.mean())


def test_neonatal_multifocal_runs_keep_their_own_field():
    """Multifocal neonatal seizures: independent runs from different regions, each maximal in its own chain."""
    # windows where only one run is on: the right temporal run starts 24 s into the left central one
    for which, side, w in ((0, "left", (2.0, 8.0)), (1, "right", (38.0, 44.0))):
        _, _, I, names, z = _pair("neo_multifocal", w[0], w[1], which)
        top = names[int(np.argmax(_p2p(I, 6)))]
        assert mt.side_of(top.split("-")[0]) == side or mt.side_of(top.split("-")[1]) == side, (z.onset_region, top)


def test_neonatal_focal_tonic_holds_emg_and_neonatal_onsets_build():
    """Neonatal focal tonic: sustained EMG over the onset side through the run; neonatal runs start as a building
    rhythmic discharge (onset_pattern rhythmic_theta), not the adult low-voltage fast onset."""
    CASES.setdefault("neo_tonic", ("neonate", _neo_bg(), [_sz("right_central", 30, 4.0, 2.0, 40, 90,
                                                              clinical_correlate="focal_tonic")], 926203, 12))
    A, B, I, names, z = _pair("neo_tonic", 3.0, 27.0)
    assert z.onset_pattern == "rhythmic_theta"
    r = np.std(_hp(A), axis=1) / np.std(_hp(B), axis=1)
    right = [names.index(c) for c in ("Fp2-C4", "C4-O2", "C4-T4")]
    left = [names.index(c) for c in ("Fp1-C3", "C3-O1", "T3-C3")]
    assert r[right].min() >= 2.0 and r[right].mean() >= 1.3 * r[left].mean(), (r[right], r[left])


def test_neonatal_electrographic_only_has_no_ictal_emg():
    A, B, I, names, _ = _pair("neo_electrographic", 5.0, 60.0)
    assert (np.std(_hp(A), axis=1) / np.std(_hp(B), axis=1)).max() <= 1.5


def test_neonatal_seizure_on_burst_suppression_runs_through_the_interburst():
    """ACNS 2013: an electrographic seizure can arise from a burst-suppression background; the ictal rhythm runs
    continuously, through the suppressed intervals, not gated by the burst envelope."""
    A, B, I, names, z = _pair("neo_bs", 1.0, 59.0)
    n = 58
    ict = np.ptp(I[:, : n * FS].reshape(len(names), n, FS), axis=2).max(axis=0)
    bg = np.median(np.ptp(B[:, : n * FS].reshape(len(names), n, FS), axis=2))
    assert np.mean(ict >= 3.0 * bg) >= 0.9, (np.mean(ict >= 3.0 * bg), bg)


# ------------------------------------------------------------------------------------------------ seizures-icu-v3 items

def test_c15_ten_second_run_is_unmistakable_for_all_ten_seconds():
    """seizures-icu-v3 C15: the per-second ratio (1-30 Hz p2p of the ictal component on its strongest derivation
    over the background p2p there) was 1.0, 1.5, 1.4, 2.1, 3.2, ... so the obvious rhythm lasted 7 s.  ACNS: a
    seizure is >= 10 s; a boundary item must read 10 s."""
    A, B, I, names, z = _pair("c15", 0.0, 10.0)
    f = lambda x: sps.sosfiltfilt(sps.butter(4, [1.0, 30.0], btype="band", fs=FS, output="sos"), x, axis=-1)
    Ii, Bb = f(I), f(B)
    ict = np.ptp(Ii[:, : 10 * FS].reshape(len(names), 10, FS), axis=2)
    bg = np.median(np.ptp(Bb[:, : 10 * FS].reshape(len(names), 10, FS), axis=2), axis=1)
    r = (ict / bg[:, None]).max(axis=0)
    assert r.min() >= 1.8, r.round(2)


def test_cluster_run_lengths_are_mean_preserving():
    """seizures-icu-v3 item 2: B4-02 (15 x 60-s runs) realized 31.7 % burden against 25 % (mean run 76 s).  The
    per-run draw is now mean-corrected and clipped to 0.6-1.6x."""
    ev = {"type": "seizure_cluster", "start_min": 2.0, "end_min": 58.0, "interval_min": 4.0, "muscle": "modest",
          "seizure": {"duration_s": 60.0, "onset_region": "right_temporal", "spread": "none",
                      "evolution": {"start_hz": 5.0, "end_hz": 2.5, "amplitude_start_uv": 40, "amplitude_end_uv": 120}}}
    im = {"kind": "qeeg_panel", "license": "synthetic-original", "attribution": None,
          "spec": {"sample_rate": FS, "channels": "standard_19", "seed": 517402, "spec_version": 3,
                   "age_group": "adult", "duration_min": 60, "background": dict(ICU), "events": [ev]}}
    syn = Synthesizer(normalize(im)["spec"], 3600.0)
    d = np.array([z.duration_s for z in syn.seizures])
    assert d.size == 15
    assert 0.6 * 60.0 - 1e-6 <= d.min() and d.max() <= 1.6 * 60.0 + 1e-6, d
    assert abs(d.mean() / 60.0 - 1.0) <= 0.15, d.mean()


def test_v3_aeeg_margins_follow_40_s_cape_cycles(monkeypatch):
    """seizures-icu-v3 B2-03: 60-s aEEG margin windows each held a whole 40-s CAPE cycle, so the margins could not
    follow the cycling (r = -0.07 between the lower margin and the CAPE envelope).  With 15-s windows (standard aEEG
    epochs) the lower margin follows the cycles."""
    from eeg_render import trends
    bg = dict(ICU, dominant_hz=2.5, slow_fraction=0.85,
              cape={"period_s": 40.0, "depth": 0.6, "cycles": 12, "at_min": 5.0})
    im = {"kind": "qeeg_panel", "license": "synthetic-original", "attribution": None,
          "spec": {"sample_rate": FS, "channels": "standard_19", "seed": 517202, "spec_version": 3,
                   "age_group": "adult", "duration_min": 30, "background": bg, "events": []}}
    spec = normalize(im)["spec"]
    syn = Synthesizer(spec, 840.0)

    def r():
        tr = trends.compute_trends(syn, 840.0, spec)
        m = (tr.t > 330.0) & (tr.t < 750.0)
        return float(np.corrcoef(np.asarray(tr.aeeg_lo["left"])[m], syn.cape_envelope(tr.t[m]))[0, 1])
    r15 = r()
    monkeypatch.setattr(trends, "AEEG_DISPLAY_WIN_S_V3", trends.AEEG_DISPLAY_WIN_S)
    r60 = r()
    assert r15 >= 0.35 and r60 < 0.2, (r15, r60)


def test_v3_paired_trend_labels_follow_their_traces():
    """seizures-icu-v3 PQ-G-002 (c): 'R' was pinned to the top and 'L' to the bottom while L was the upper trace."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from eeg_render import style as S_
    from eeg_render.render_panel import _paired_panel
    fig, ax = plt.subplots()
    t = np.linspace(0, 60, 200)
    _paired_panel(ax, t, np.full_like(t, 0.07), np.full_like(t, 0.02), S_.LIGHT, 0.0, 0.08, follow=True)
    ys = {txt.get_text(): txt.get_position()[1] for txt in ax.texts}
    plt.close(fig)
    assert ys["L"] > ys["R"], ys


# ------------------------------------------------------------------------------------------------ window independence

@pytest.mark.parametrize("case,w", [("fbtc", (340.0, 356.0)), ("fbtc", (365.0, 381.0)), ("spasm", (124.0, 130.0)),
                                    ("neo_clonic", (310.0, 318.0)), ("frontal", (298.0, 306.0))])
def test_phase_d_features_are_window_independent(case, w):
    """GTC phases, spasm EMG, neonatal clonic jerks and the frontal decrement are drawn once per record."""
    syn = S(case)
    t_a, t_b = w
    _, whole = syn.segment(t_a - 7.3, t_b + 5.1)
    _, part = syn.segment(t_a, t_b)
    i0 = int(round(7.3 * FS))
    np.testing.assert_allclose(whole[:, i0:i0 + part.shape[1]], part, rtol=0, atol=1e-9)
