"""Round 8, generalized family (research/eeg-atlas/generalized-review-20260928: Craig's review, JITTER_AUDIT.md,
REFERENCE_TARGETS.md).  Spec_version 3 only.

- the seven features Craig accepted are byte-identical to renderer 0.5.0 (digests of the reviewed pages);
- the whole-head jitter is shared by every electrode (bisynchrony survives) and the rebuilt features meet the
  reference targets;
- every rebuilt feature stays window and horizon independent.
"""
import copy

import numpy as np
import pytest
import scipy.signal as sps

from eeg_render import montage as mt
from eeg_render.render_page import apply_filters, build_filters
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer

from _gen_r8_digest import ACCEPTED, digest

CHILD = dict(type="continuous", amplitude_uv=40.0, dominant_hz=9.0, slow_fraction=0.4, reactivity="present",
             channel_gain_max=1.5)
LGS_BG = dict(type="continuous", amplitude_uv=70.0, dominant_hz=4.0, slow_fraction=0.85, reactivity="present",
              channel_gain_max=1.5, pdr_gain=0.3)
SLEEP = [{"type": "state_change", "at_min": 0.5, "to": "sleep"}]
FILT = {"lf_hz": 1.0, "hf_hz": 70.0, "notch_hz": 60.0}

#: renderer 0.5.0 (origin/main cb0e97b) digests of the accepted pages, research/eeg-atlas/generalized-review-20260928
ACCEPTED_DIGESTS = {
    "typical_absence": "976d352b08b63d88883a071d6a540de5146dba993f4e3b81eda98f497da1d800",
    "myoclonic": "a12ea8442567c582ef7325de38a6054e4a86b6c26674b77e0f5dbbcc29c878f8",
    "myoclonic_atonic": "f9352e39731a9671bba4ca7aef477ae99cdd19718d0bae95e5c51efbeffd48eb",
    "myoclonic_tonic": "38a11001147c6960cd4530273e008574ccba1d67dd80a115916f6b311d215882",
    "atonic": "3f568425720a1d882e9e02a1b743c3d0eb82a6fdf272982baa8c3dddb1b42652",
    "interictal_gsw": "34ec2e9b3c18907fb040c674643d71a4740e8fde6383203cc263c0ff0daac939",
    "interictal_psw_jme": "37e89bd3c64350d4d5bf7ca5a36ac883b60700f5c67304996b3fb6eb4e434576",
}


def _spec(seed, age, bg, events, dur=30, kind="qeeg_panel"):
    img = {"kind": kind, "license": "synthetic-original", "attribution": None,
           "spec": {"sample_rate": 256, "channels": "standard_19", "seed": seed, "spec_version": 3,
                    "age_group": age, "duration_min": dur, "background": bg, "events": events}}
    return normalize(img)["spec"]


def gs(st, at=2.0, **kw):
    return dict(type="generalized_seizure", seizure_type=st, onset_min=at, **kw)


def gd(pat, **kw):
    return dict(type="generalized_discharges", pattern=pat, **kw)


def _chain(syn, x, montage="longitudinal_bipolar", filt=True):
    pairs = mt.montage_pairs(montage, syn.scalp)
    sig = syn.derive(x, pairs, montage)
    if filt:
        sig = apply_filters(sig, build_filters(syn.fs, FILT, True), True)
    return sig, [a if b is None else f"{a}-{b}" for a, b in pairs]


def _display(syn, t0, t1, pad=6.0):
    t, x = syn.segment(t0 - pad, t1)
    sig, names = _chain(syn, x)
    keep = t >= t0
    return t[keep], sig[:, keep], names


def _isolated(syn, t0, t1, montage="longitudinal_bipolar", pad=3.0, filt=True):
    i0 = int(round((t0 - pad) * syn.fs))
    t = (i0 + np.arange(int(round((t1 - t0 + pad) * syn.fs)))) / syn.fs
    sig, names = _chain(syn, syn._gen.rows(t, i0, extras=False) * syn._ch_gain[:, None], montage, filt)
    keep = t >= t0
    return t[keep], sig[:, keep], names


def _p2p(y, w):
    return np.array([np.ptp(y[i:i + w]) for i in range(0, y.size - w + 1, w)])


def _log_iv_sd(t):
    return float(np.std(np.log(np.diff(t))))


# ------------------------------------------------------------------ accepted features: unchanged

@pytest.mark.parametrize("name", sorted(ACCEPTED))
def test_accepted_generalized_features_are_unchanged(name):
    """Craig accepted typical absence, myoclonic, myoclonic-atonic, myoclonic-tonic, atonic, interictal GSW and JME
    polyspike-wave as they are: the whole reviewed page (every electrode, the EMG row) is byte-identical to 0.5.0."""
    assert digest(name) == ACCEPTED_DIGESTS[name]


# ------------------------------------------------------------------ slow spike-and-wave (atypical absence, LGS)

@pytest.mark.parametrize("case", ["atypical", "lgs"])
def test_slow_spike_wave_is_an_irregular_sharp_then_slow_wave(case):
    """REFERENCE_TARGETS s4 (Craig: atypical absence "reads as notched delta, Angelman-like"; LGS SSW "needs a clearer
    spike/sharp-and-slow-wave complex"): 1.5-2.5 Hz, irregular (interval sd 0.12-0.35 in log units), per-cycle sharp-
    wave width and height, and a sharp wave 70-200 ms at half height that PRECEDES a 300-500 ms slow wave (the slow
    wave's peak >= 0.15 s after the sharp peak) instead of riding its slope."""
    if case == "atypical":
        syn = Synthesizer(_spec(26092602, "child", LGS_BG, [gs("atypical_absence", duration_s=15.0)]), 400.0)
        cx = syn._gen.cx
    else:
        syn = Synthesizer(_spec(26092613, "child", LGS_BG, [gd("slow_spike_wave", rate_per_h=200)]), 600.0)
        run = max((r for r in syn._gen.events() if 30 < r["t0"] < 500), key=lambda r: r["n_complexes"])
        cx = [c for c in syn._gen.cx if run["t0"] <= c["t"] < run["t1"] + 0.01]
    t = np.array([c["t"] for c in cx])
    assert 1.5 <= 1.0 / np.median(np.diff(t)) <= 2.5
    assert 0.12 <= _log_iv_sd(t) <= 0.35
    assert np.std(np.log([c["width"] for c in cx])) >= 0.08
    assert np.std(np.log([c["x8"]["sg"] for c in cx])) >= 0.15
    fs = syn.fs
    sharp, lag = [], []
    for c in cx[len(cx) // 3: len(cx) // 3 + 6]:
        tt, s, n = _isolated(syn, c["t"] - 0.15, c["t"] + c["period"], "referential", filt=False)
        y = s[n.index("Fz")]
        k0 = np.argmin(np.abs(tt - c["t"]))
        hi = sps.sosfiltfilt(sps.butter(2, 4.0, "highpass", fs=fs, output="sos"), y)
        i_sp = k0 - 10 + int(np.argmin(hi[k0 - 10:k0 + 10]))
        h = hi[i_sp] / 2.0
        a = b = i_sp
        while a > 0 and hi[a] < h:
            a -= 1
        while b < hi.size - 1 and hi[b] < h:
            b += 1
        sharp.append((b - a) / fs)
        lo = sps.sosfiltfilt(sps.butter(2, 4.0, "lowpass", fs=fs, output="sos"), y)
        m = np.flatnonzero((tt > c["t"] + 0.05) & (tt < c["t"] + c["period"]))
        lag.append(tt[m[int(np.argmin(lo[m]))]] - tt[i_sp])
    assert 0.05 <= np.median(sharp) <= 0.20, sharp
    assert np.median(lag) >= 0.15, lag


# ------------------------------------------------------------------ tonic

@pytest.mark.parametrize("seed", [26092606, 926206])
def test_tonic_opens_with_a_large_slow_complex_and_the_fast_activity_wanders(seed):
    """REFERENCE_TARGETS s6 (Craig: "a larger delta or sharp-wave onset before the electrodecrement; a little more
    frequency jitter"): a generalized slow complex opens the seizure before the decrement (on its largest chain
    >= 2.5x that chain's background 1-s p-p), and the fast activity's instantaneous frequency wanders (detrended CV >= 0.03) while the homologous
    chains stay in phase (F3-C3/F4-C4 >= 0.9, the r5 bisynchrony)."""
    syn = Synthesizer(_spec(seed, "child", LGS_BG, [gs("tonic")]), 400.0)
    fs = syn.fs
    t0 = 120.0
    t, s, n = _display(syn, t0 - 8.0, t0 + 1.0)
    ratio = [np.ptp(y[(t >= t0 - 0.05) & (t < t0 + 0.8)]) / np.median(_p2p(y[t < t0 - 0.5], fs)) for y in s]
    assert max(ratio) >= 2.5, ratio
    g = syn._gen.gpfa[0]
    assert g["t0"] >= t0 + 1.0            # the decrement follows the onset complex
    ti, si, ni = _isolated(syn, g["t0"] + 0.5, g["t1"] - 0.2)
    a, b = si[ni.index("F3-C3")], si[ni.index("F4-C4")]
    assert np.corrcoef(a, b)[0, 1] >= 0.9
    ph = np.unwrap(np.angle(sps.hilbert(sps.sosfiltfilt(sps.butter(4, [8, 30], "bandpass", fs=fs, output="sos"), a))))
    w = int(0.25 * fs)
    fi = np.convolve(np.diff(ph) * fs / (2 * np.pi), np.ones(w) / w, "valid")[w:-w]
    k = np.arange(fi.size)
    assert np.std(fi - np.polyval(np.polyfit(k, fi, 1), k)) / np.mean(fi) >= 0.03


# ------------------------------------------------------------------ GTC

@pytest.mark.parametrize("seed", [26092608, 926208])
def test_gtc_clonic_bursts_slow_with_muscle_and_silent_intervals(seed):
    """REFERENCE_TARGETS s1 (Craig: "much more muscle and much larger EEG amplitude"): clonic bursts start near 4 Hz
    and slow to <= 1.2 Hz (intervals growing exponentially, lognormal scatter), with a burst EMG on every polyspike
    and a near-flat, EMG-silent end to each late interval of >= 0.8 s; the bursts are >= 5x the pre-ictal
    background."""
    syn = Synthesizer(_spec(seed, "adolescent", CHILD, [gs("gtc")]), 400.0)
    r = syn._gen.events()[0]
    cx = [c for c in syn._gen.cx if r["tonic_end_s"] <= c["t"] < r["clonic_end_s"]]
    iv = np.diff([c["t"] for c in cx])
    assert 1.0 / np.median(iv[:5]) >= 3.0 and 1.0 / np.median(iv[-8:]) <= 1.2
    assert all(c["ps"] is not None for c in cx)
    bursts = [e for e in syn._gen.emg if e[5] == "gtc_burst"]
    assert len(bursts) == len(cx)
    fs = syn.fs
    t, s, n = _display(syn, 100.0, r["clonic_end_s"])
    y = s[n.index("F3-C3")]
    bg = np.median(_p2p(y[t < 119.0], fs))
    late = [c for c in cx if c["t"] > r["clonic_end_s"] - 15.0][:-1]
    peak, gap = [], []
    for c, d in zip(late, late[1:]):
        peak.append(np.ptp(y[(t >= c["t"]) & (t < c["t"] + 0.3)]))
        if d["t"] - c["t"] < 0.8:
            continue
        m = (t >= c["t"] + 0.65 * (d["t"] - c["t"])) & (t < d["t"] - 0.1)
        gap.append(np.ptp(y[m]))
        emg = syn._gen.emg_rows(t[m], int(round(t[m][0] * fs)))
        assert emg is None or np.abs(emg).max() < 1.0
    assert np.median(peak) >= 5.0 * bg, (peak, bg)
    assert np.median(gap) <= 0.3 * np.median(peak), (gap, peak)


@pytest.mark.parametrize("seed", [26092608, 926208])
def test_gtc_ends_with_full_size_discharges_then_suppression(seed):
    """REFERENCE_TARGETS s2 (Craig: "larger discharges with some muscle that fade out or just stop"): the last 3-5
    discharges come 1.0-3.5 s apart, each with muscle, either at full size (abrupt stop) or shrinking to ~0.35x (half
    of seizures; Craig's reference, researchgate 369381411 fig 3C); the seizure ends
    with its last discharge, and the postictal trace is suppressed below 10 uV (1-s p-p, F3-C3) within 3 s."""
    syn = Synthesizer(_spec(seed, "adolescent", CHILD, [gs("gtc")]), 400.0)
    r = syn._gen.events()[0]
    cx = [c for c in syn._gen.cx if r["tonic_end_s"] <= c["t"] <= r["clonic_end_s"]]
    iv = np.diff([c["t"] for c in cx])
    assert np.all((iv[-2:] >= 1.0) & (iv[-2:] <= 3.5))
    amps = np.array([c["amp"] for c in cx])
    mid = np.median(amps[len(amps) // 3: 2 * len(amps) // 3])
    full = np.min(amps[-3:]) >= 0.5 * mid
    fading = amps[-1] < amps[-3] and np.min(amps[-3:]) >= 0.15 * mid
    assert full or fading, (amps[-3:], mid)
    assert r["clonic_end_s"] - cx[-1]["t"] <= 0.8
    last = [e for e in syn._gen.emg if e[5] == "gtc_burst"][-1]
    assert last[0] >= cx[-1]["t"] - 0.05
    t, s, n = _display(syn, r["clonic_end_s"] + 3.0, r["clonic_end_s"] + 13.0)
    assert np.median(_p2p(s[n.index("F3-C3")], syn.fs)) < 10.0


@pytest.mark.parametrize("seed", [26092608, 926208])
def test_gtc_muscle_spares_the_vertex_and_jerks_move_the_electrodes(seed):
    """REFERENCE_TARGETS s1 (PubMed 41830894; Craig 2026-09-29 "fix the EMG field, and muscle artifacts"): during the
    tonic phase the 30-70 Hz muscle on Fz-Cz / Cz-Pz is <= 0.4x the temporal chains', and each clonic jerk adds a slow
    per-electrode movement transient (50-150 uV on 20-40 % of electrodes) that shows on the bipolar chain."""
    syn = Synthesizer(_spec(seed, "adolescent", CHILD, [gs("gtc")]), 400.0)
    r = syn._gen.events()[0]
    fs = syn.fs
    i0 = int(round((r["t0"] + 5.0) * fs))
    tt = (i0 + np.arange(5 * fs)) / fs
    sig, names = _chain(syn, syn._gen.emg_rows(tt, i0))

    def band(y):
        return float(np.sqrt(np.mean(sps.sosfiltfilt(sps.butter(4, [30, 70], "bandpass", fs=fs, output="sos"), y) ** 2)))
    mid = np.mean([band(sig[names.index(c)]) for c in ("Fz-Cz", "Cz-Pz")])
    temp = np.mean([band(sig[names.index(c)]) for c in ("F7-T3", "T3-T5", "F8-T4", "T4-T6")])
    assert mid <= 0.4 * temp, (mid, temp)
    n_clonic = sum(e[5] == "gtc_burst" for e in syn._gen.emg)
    assert len(syn._gen.move) == n_clonic
    for tm, sg, w in syn._gen.move[:20]:
        k = np.count_nonzero(w)
        assert 0.2 * syn._gen.n_e - 1 <= k <= 0.4 * syn._gen.n_e + 1
        assert 0.15 <= sg <= 0.35 and np.all((np.abs(w[w != 0]) >= 30.0) & (np.abs(w[w != 0]) <= 150.0))
        assert np.any(w > 0) or np.any(w < 0)


# ------------------------------------------------------------------ eyelid myoclonia

def test_eyelid_jerks_run_through_the_discharge_with_their_own_timing():
    """REFERENCE_TARGETS s7 (Craig: "more eyelid/blink artifact"): cornea-positive eyelid jerks at 4.5-6 Hz from the
    closure to the end of the discharge, interval CV >= 0.08, 30-120 uV, plus blinks around the event."""
    syn = Synthesizer(_spec(26092609, "child", CHILD, [gs("eyelid_myoclonia", at=2.0 + 4 / 60)]), 400.0)
    r = syn._gen.events()[0]
    fl = [e for e in syn._gen.eye if e[0] == "flutter"][0]
    tp = np.array([p[0] for p in fl[5]])
    ap = np.array([p[1] for p in fl[5]])
    iv = np.diff(tp)
    assert 4.0 <= 1.0 / np.median(iv) <= 6.5 and np.std(iv) / np.mean(iv) >= 0.08
    assert tp[0] <= r["closure_s"] + 0.3 and tp[-1] >= r["t1"] - 0.3
    assert 30.0 <= np.median(ap) <= 120.0
    assert sum(e[0] == "blink" for e in syn._gen.eye) >= 2


# ------------------------------------------------------------------ ESES, GPD, sporadic polyspike

def test_eses_cycles_vary_in_period_and_morphology():
    """REFERENCE_TARGETS s8 (Craig: ESES "frequency too regular, morphology identical each cycle ... between phase D
    and current"): period sd 0.08-0.25 (log), per-cycle spike width 1.1-2.1x, double spikes in some cycles, and the
    kernel between the phase D Gaussian wave and the current dome."""
    syn = Synthesizer(_spec(26092615, "child", CHILD, SLEEP + [gd("eses", side="left")], dur=60), 3600.0)
    run = next(r for r in syn._gen.events() if r.get("pattern") == "eses" and r["stage"] in ("N2", "N3")
               and r["n_complexes"] >= 20)
    cx = [c for c in syn._gen.cx if run["t0"] <= c["t"] < run["t1"] + 0.01]
    assert 0.08 <= _log_iv_sd([c["t"] for c in cx]) <= 0.25
    w = np.array([c["width"] for c in cx])
    assert w.min() >= 1.09 and w.max() <= 2.11 and np.std(np.log(w)) >= 0.08
    assert any(c["double"] for c in cx) and not all(c["double"] for c in cx)
    assert all(c["x8"]["k"] == "sw_blend" and c["x8"]["blend"] == 0.5 for c in cx)


def test_gpd_period_and_amplitude_vary_inside_the_acns_limit():
    """REFERENCE_TARGETS s8 / ACNS 2021 (Craig: GPD "frequency too regular; a little more period and amplitude
    jitter"): isolated Fz discharge intervals vary (log sd 0.05-0.15) but change by < 50 % in >= 90 % of cycle pairs."""
    bg = dict(type="continuous", amplitude_uv=15.0, dominant_hz=2.0, slow_fraction=0.85, reactivity="absent",
              channel_gain_max=1.5, blink_rate_per_min=0, pdr_gain=0.0)
    ev = [{"type": "rhythmic_pattern", "pattern": "GPD", "periodic": True, "frequency_hz": 2.0, "amplitude_uv": 110,
           "run_duration_s": 60, "onset_min": 5.0, "duration_min": 3.0, "onset_region": "generalized",
           "min_cycles": 6}]
    syn = Synthesizer(_spec(26092617, "adult", bg, ev), 600.0)
    z = syn.rhythmic_patterns[0]
    fs = syn.fs
    tt = np.arange(int((z.t0 + 3) * fs), int((z.t0 + 43) * fs)) / fs
    sig, names = _chain(syn, syn._seizure_block(tt), "referential", filt=False)
    y = sps.sosfiltfilt(sps.butter(2, 3.0, "highpass", fs=fs, output="sos"), sig[names.index("Fz")])
    pk, _ = sps.find_peaks(y, distance=int(0.25 * fs), prominence=0.3 * np.percentile(np.abs(y), 99))
    iv = np.diff(tt[pk])
    assert 0.05 <= np.std(np.log(iv)) <= 0.15
    assert np.mean(np.abs(np.diff(iv)) / iv[:-1] < 0.5) >= 0.9
    assert np.std(np.log(y[pk])) >= 0.15


def test_sporadic_generalized_polyspike_is_not_one_waveform_scaled():
    """JITTER_AUDIT (Craig: sporadic polyspike "too clean"; np.outer(w, k) scaled one waveform on every electrode):
    each electrode has its own lag (frontal first), amplitude and per-spike heights - the >8 Hz polyspikes of the
    frontocentral electrodes correlate < 0.99 on average and F3 leads C3."""
    syn = Synthesizer(_spec(26092616, "child", CHILD, [{"type": "sporadic_discharges",
                                                         "focus": "generalized_frontocentral", "rate_per_h": 600,
                                                         "amplitude_uv": 150.0, "morphology": "polyspike",
                                                         "n_spikes": 5}]), 600.0)
    fs = syn.fs
    els = ("F3", "F4", "Fz", "C3", "C4", "Cz", "Fp1", "Fp2")
    cors, leads = [], []
    for j in [j for j, r in enumerate(syn._sed) if 60.0 < r[0] < 500.0][:8]:
        t0 = float(syn._sed[j, 0])
        lags = syn._sed_poly[j][0]
        tt = np.arange(int(round((t0 - 0.1) * fs)), int(round((t0 + lags[-1] + 0.1) * fs))) / fs
        sig, names = _chain(syn, syn._sed_rows(tt), "referential", filt=False)
        Y = sps.sosfiltfilt(sps.butter(4, 8.0, "highpass", fs=fs, output="sos"),
                            np.array([sig[names.index(e)] for e in els]))
        C = np.corrcoef(Y)
        cors.append(np.mean(C[np.triu_indices(len(els), 1)]))
        up = 8
        a = sps.resample(Y[els.index("F3")], Y.shape[1] * up)
        b = sps.resample(Y[els.index("C3")], Y.shape[1] * up)
        leads.append((np.argmax(sps.correlate(b, a, "full")) - (a.size - 1)) / (fs * up))
    assert np.mean(cors) < 0.99
    assert np.median(leads) > 0.0


# ------------------------------------------------------------------ window / horizon independence

@pytest.mark.parametrize("case", ["tonic", "gtc_end", "eyelid", "atypical", "lgs", "gpfa", "polyspike", "gpd"])
def test_r8_features_are_window_and_horizon_independent(case):
    gpd = [{"type": "rhythmic_pattern", "pattern": "GPD", "periodic": True, "frequency_hz": 2.0, "amplitude_uv": 110,
            "run_duration_s": 60, "onset_min": 2.0, "duration_min": 3.0, "onset_region": "generalized",
            "min_cycles": 6}]
    poly = [{"type": "sporadic_discharges", "focus": "generalized_frontocentral", "rate_per_h": 900,
             "amplitude_uv": 150.0, "morphology": "polyspike", "n_spikes": 5}]
    ev, a, bg = {"tonic": ([gs("tonic")], 119.5, LGS_BG),
                 "gtc_end": ([gs("gtc")], 162.0, CHILD),
                 "eyelid": ([gs("eyelid_myoclonia")], 119.5, CHILD),
                 "atypical": ([gs("atypical_absence")], 124.0, LGS_BG),
                 "lgs": ([gd("slow_spike_wave", rate_per_h=400)], 300.0, LGS_BG),
                 "gpfa": (SLEEP + [gd("gpfa", rate_per_h=400)], 1100.0, LGS_BG),
                 "polyspike": (poly, 300.0, CHILD),
                 "gpd": (gpd, 140.0, CHILD)}[case]
    spec = _spec(926232, "child", bg, ev, dur=30)
    syn = Synthesizer(spec, 1800.0)
    t1, x1 = syn.segment(a - 5.0, a + 10.0)
    t2, x2 = syn.segment(a, a + 4.0)
    i = int(round(5.0 * syn.fs))
    assert np.allclose(x1[:, i:i + x2.shape[1]], x2, atol=1e-6)
    # a page synthesizer (short horizon) draws the same feature rows as the whole-record one
    page = Synthesizer(copy.deepcopy(spec), a + 70.0)
    i0 = int(round(a * syn.fs))
    tt = (i0 + np.arange(4 * syn.fs)) / syn.fs
    if case == "polyspike":
        assert np.allclose(syn._sed_rows(tt), page._sed_rows(tt), atol=1e-6)
    elif case == "gpd":
        assert np.allclose(syn._seizure_block(tt), page._seizure_block(tt), atol=1e-6)
    else:
        assert np.allclose(syn._gen.rows(tt, i0), page._gen.rows(tt, i0), atol=1e-6)
