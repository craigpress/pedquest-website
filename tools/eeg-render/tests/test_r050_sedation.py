"""0.5.0 sedation and neuromuscular blockade (spec_version 3): a drug REPLACES the awake background.

Feature review 2026-09-26 (research/eeg-atlas/feature-review-20260926/sedation.md, PQW-109 candidates S109-01..09):
the PDR and blinks survived every hypnotic at level 0.8 and complete blockade, propofol alpha stayed occipital,
dexmedetomidine spindles were 1.5 uV on a 3.7 s clock, benzodiazepine beta stayed below alpha, ketamine gamma sat at
35 Hz with theta falling, barbiturate bursts were 7 s of gated awake EEG over a dead-flat suppression, and display
calibration normalised the neonatal midazolam attenuation away.

Every measurement is on the displayed signal: longitudinal bipolar through the causal 1-70 Hz (+60 Hz notch) chain,
each spec against the same seed with the drug removed (the unsedated twin).
"""
import copy

import numpy as np
import pytest
from scipy import signal as sps

from eeg_render import montage as mt
from eeg_render.render_page import apply_filters, build_filters
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer

HORIZON = 1800.0
FRONT = ["Fp1-F3", "Fp2-F4", "F3-C3", "F4-C4", "Fp1-F7", "Fp2-F8"]
OCC = ["P3-O1", "P4-O2", "T5-O1", "T6-O2"]
TEMP = ["F7-T3", "T3-T5", "F8-T4", "T4-T6"]


def _spec(seed, age="adult", agent=None, level=0.8, **extra):
    """The PQW-109 candidate spec (research/eeg-atlas/p7/batch109_candidates.py) at spec_version 3."""
    s = {"sample_rate": 256, "channels": "standard_19", "duration_min": 30, "seed": seed, "spec_version": 3,
         "age_group": age,
         "background": {"type": "continuous", "amplitude_uv": 40.0, "dominant_hz": 9.0 if age != "neonate" else 2.0,
                        "slow_fraction": 0.3 if age != "neonate" else 0.8, "reactivity": "present",
                        "channel_gain_max": 1.5},
         "events": []}
    if agent:
        s["sedation"] = {"agent": agent, "level": level}
    s.update(copy.deepcopy(extra))
    return s


def _synth(spec, nosed=False):
    s = copy.deepcopy(spec)
    if nosed:
        s.pop("sedation", None)
        s["events"] = [e for e in s["events"] if e["type"] != "sedation_change"]
    img = {"kind": "qeeg_panel", "license": "synthetic-original", "attribution": None, "spec": s}
    return Synthesizer(normalize(img)["spec"], HORIZON)


_CACHE = {}


def _pair(key, spec):
    if key not in _CACHE:
        _CACHE[key] = (_synth(spec), _synth(spec, nosed=True))
    return _CACHE[key]


PENTO_EVENT = [{"type": "sedation_change", "at_min": 5.0, "direction": "increase", "agent": "pentobarbital",
                "level": 0.8, "effect": {"ramp_min": 5.0, "suppression_ratio_target_pct": 60.0}}]
SEIZ_VENT = [{"type": "seizure", "onset_min": 9.8, "duration_s": 60.0, "onset_region": "left_temporal",
              "spread": "generalized", "muscle": "clinical"},
             {"type": "artifact", "kind": "ventilator", "at_min": 9.0, "duration_s": 180.0, "intensity": "high"}]
SPECS = {
    "propofol": _spec(610901, agent="propofol"),
    "dexmedetomidine": _spec(610902, agent="dexmedetomidine"),
    "midazolam": _spec(610903, agent="midazolam"),
    "neonate_midazolam": _spec(610904, "neonate", agent="midazolam"),
    "ketamine": _spec(610905, agent="ketamine"),
    "pentobarbital": _spec(610906, "child", agent="pentobarbital", events=PENTO_EVENT),
}


def _disp(S, t0, t1):
    pairs = mt.montage_pairs("longitudinal_bipolar", S.scalp)
    _, x = S.segment(t0 - 10.0, t1)
    d = apply_filters(S.derive(x, pairs, "longitudinal_bipolar"),
                      build_filters(S.fs, {"lf_hz": 1.0, "hf_hz": 70.0, "notch_hz": 60}, True), True)
    return [f"{a}-{b}" for a, b in pairs], d[:, int(10.0 * S.fs):]


def _bp(d, fs, lo, hi):
    f, p = sps.welch(d, fs=fs, nperseg=int(2 * fs), axis=-1)
    m = (f >= lo) & (f < hi)
    return p[..., m].sum(-1) * (f[1] - f[0])


def _rows(names, d, which):
    return d[[names.index(w) for w in which]]


def _p2p(d, fs):
    m = d.shape[1] // fs
    return float(np.median(np.ptp(d[:, : m * fs].reshape(d.shape[0], m, fs), axis=2)))


def _blinks(S, t0, t1):
    """Blink-like frontopolar deflections (Fp minus F, 0.1-3 Hz, > 50 uV)."""
    _, x = S.segment(t0, t1)
    b, a = sps.butter(2, [0.1, 3.0], btype="band", fs=S.fs)
    i = S._idx
    fp = sps.filtfilt(b, a, (x[i["Fp1"]] + x[i["Fp2"]]) / 2 - (x[i["F3"]] + x[i["F4"]]) / 2)
    pk, _ = sps.find_peaks(np.abs(fp), height=50, distance=int(0.5 * S.fs))
    return int(pk.size)


def _runs(mask, fs):
    d = np.diff(np.r_[0, mask.astype(int), 0])
    return (np.flatnonzero(d == -1) - np.flatnonzero(d == 1)) / fs


# ------------------------------------------------------------------ calibration (S109-04)

def test_neonatal_midazolam_attenuation_survives_calibration():
    """Jennekens 2012 (S25): a midazolam load lowers total amplitude, relative delta falls and theta rises.  The review
    measured 0.94x delivered against 0.72x authored because calibration rescaled the sedated background."""
    S, S0 = _pair("neonate_midazolam", SPECS["neonate_midazolam"])
    n, d = _disp(S, 600, 660)
    _, d0 = _disp(S0, 600, 660)
    ratio = _p2p(d, S.fs) / _p2p(d0, S.fs)
    assert 0.55 <= ratio <= 0.8
    th = _bp(d, S.fs, 4, 8).mean() / _bp(d0, S.fs, 4, 8).mean()
    de = _bp(d, S.fs, 1, 4).mean() / _bp(d0, S.fs, 1, 4).mean()
    assert th > 1.1 * de                                       # relative theta up, relative delta down


# ------------------------------------------------------------------ consciousness (S109-01..06)

@pytest.mark.parametrize("agent", ["propofol", "dexmedetomidine", "midazolam", "ketamine", "pentobarbital"])
def test_hypnotics_remove_pdr_blinks_and_muscle(agent):
    """Unconscious at level 0.8 (Purdon 2015; Breimer 1990 S24 subjects asleep): no blinks, the posterior dominant
    rhythm goes (Purdon: occipital alpha lost), tonic muscle falls.  Minutes 1-4 (before the pentobarbital ramp)."""
    S, S0 = _pair(agent, SPECS[agent])
    assert _blinks(S, 60, 240) == 0 and _blinks(S0, 60, 240) >= 5
    n, d = _disp(S, 60, 240)
    _, d0 = _disp(S0, 60, 240)
    occ_alpha = _bp(_rows(n, d, ["P3-O1", "P4-O2"]), S.fs, 8, 11).mean() / _bp(_rows(n, d0, ["P3-O1", "P4-O2"]), S.fs, 8, 11).mean()
    assert occ_alpha < (0.5 if agent in ("midazolam", "ketamine") else 0.3)
    muscle = _bp(_rows(n, d, TEMP), S.fs, 40, 58).mean() / _bp(_rows(n, d0, TEMP), S.fs, 40, 58).mean()
    assert muscle < (0.8 if agent == "ketamine" else 0.4)


def test_remifentanil_volunteers_keep_awake_features():
    """Graversen 2014 (S29): awake volunteers; blinks and PDR stay."""
    S = _synth(_spec(610907, agent="remifentanil"))
    assert _blinks(S, 60, 240) >= 5


# ------------------------------------------------------------------ propofol (S109-01)

def test_propofol_alpha_anteriorizes():
    """Purdon 2015 (and Akeju 2014, S23): under propofol alpha power shifts from occipital to frontal.  The review
    measured a front/occipital alpha ratio of 0.33 with the PDR kept, 8.6 with it removed."""
    S, S0 = _pair("propofol", SPECS["propofol"])
    n, d = _disp(S, 600, 660)
    _, d0 = _disp(S0, 600, 660)
    ratio = _bp(_rows(n, d, FRONT), S.fs, 8, 13).mean() / _bp(_rows(n, d, OCC), S.fs, 8, 13).mean()
    ratio0 = _bp(_rows(n, d0, FRONT), S.fs, 8, 13).mean() / _bp(_rows(n, d0, OCC), S.fs, 8, 13).mean()
    assert ratio > 3.0 and ratio0 < 1.0
    f, p = sps.welch(_rows(n, d, FRONT), fs=S.fs, nperseg=4 * S.fs, axis=-1)
    m = (f >= 6) & (f <= 20)
    assert 9.5 <= f[m][np.argmax(p.mean(0)[m])] <= 12.0          # frontal alpha 10-12 Hz (Purdon Fig 2D)
    assert _p2p(d, S.fs) > 1.05 * _p2p(d0, S.fs)                 # anesthetic slow + alpha is larger than awake


# ------------------------------------------------------------------ dexmedetomidine (S109-02)

def test_dexmedetomidine_spindles_visible_long_and_irregular():
    """Purdon 2015: dexmedetomidine spindles 9-15 Hz, bursts lasting 1-2 s, resembling N2 spindles (Akeju 2014: peak
    12.9 Hz).  learningeeg spindles run about 3-4x the local background.  The review found 1.5 uV sigma against 11 uV
    broadband on a 3.66 s metronome."""
    S, _ = _pair("dexmedetomidine", SPECS["dexmedetomidine"])
    t0, t1 = 540.0, 720.0
    n, d = _disp(S, t0, t1)
    fs = S.fs
    y = sps.sosfiltfilt(sps.butter(4, [11, 15], "bandpass", fs=fs, output="sos"), d[n.index("C3-P3")])
    tt = t0 + np.arange(y.size) / fs
    D = S._dsp
    ins = np.zeros(tt.size, bool)
    for a, du in zip(D["t"], D["dur"]):
        ins |= (tt >= a) & (tt < a + du)
    assert np.sqrt((y[ins] ** 2).mean()) > 3.0 * np.sqrt((y[~ins] ** 2).mean())
    p2p = [np.ptp(y[(tt >= a) & (tt < a + du)]) for a, du in zip(D["t"], D["dur"]) if a > t0 and a + du < t1]
    assert 18.0 <= np.median(p2p) <= 40.0                                  # 2.5-6 mm at 7 uV/mm
    env = np.convolve(np.abs(sps.hilbert(y)), np.ones(fs // 8) / (fs // 8), "same")
    vis = _runs(env > 2.0 * np.median(env[~ins]), fs)
    assert 1.0 <= np.median(vis[vis > 0.25]) <= 2.0                         # visible 1-2 s
    gaps = np.diff(D["t"][(D["t"] > t0) & (D["t"] < t1)])
    assert 5.0 <= gaps.size / 3.0 <= 15.0 and gaps.std() / gaps.mean() > 0.3
    e = env - env.mean()
    ac = np.correlate(e, e, "full")[e.size - 1:]
    ac /= ac[0]
    lags = np.arange(ac.size) / fs
    assert ac[(lags > 1.5) & (lags < 10)].max() < 0.35                     # no clock (review: r 0.43-0.48 at 3.66 s)
    # a sleep-like background: no PDR, more delta than awake
    S0 = _pair("dexmedetomidine", SPECS["dexmedetomidine"])[1]
    _, d0 = _disp(S0, t0, t1)
    nofp = [i for i, c in enumerate(n) if not c.startswith("Fp")]           # the twin's blinks carry delta at Fp
    assert _bp(d[nofp], fs, 1, 4).mean() > 1.1 * _bp(d0[nofp], fs, 1, 4).mean()


def test_drug_spindles_window_independent():
    S, _ = _pair("dexmedetomidine", SPECS["dexmedetomidine"])
    _, whole = S.segment(600.0, 620.0)
    _, a = S.segment(600.0, 610.0)
    _, b = S.segment(610.0, 620.0)
    assert np.allclose(whole, np.hstack([a, b]), atol=1e-9)


# ------------------------------------------------------------------ midazolam (S109-03)

def test_midazolam_beta_dominates_and_waxes():
    """learningeeg 'background after benzos': diffuse high-amplitude beta dominates every chain, waxing and waning;
    Breimer 1990 (S24): the largest change is in 12-30 Hz.  The review measured beta 16 uV^2 below alpha 39 uV^2."""
    S, _ = _pair("midazolam", SPECS["midazolam"])
    n, d = _disp(S, 600, 660)
    beta, alpha = _bp(d, S.fs, 13, 30), _bp(d, S.fs, 8, 13)
    assert beta.mean() > 2.0 * alpha.mean()
    assert (beta > alpha).sum() >= len(n) - 2
    f, p = sps.welch(d, fs=S.fs, nperseg=4 * S.fs, axis=-1)
    m = (f >= 8) & (f <= 30)
    assert 14.0 <= f[m][np.argmax(p.mean(0)[m])] <= 20.0
    y = sps.sosfiltfilt(sps.butter(4, [13, 25], "bandpass", fs=S.fs, output="sos"), d, axis=1)
    env = np.sqrt(np.convolve((y ** 2).mean(0), np.ones(S.fs) / S.fs, "same"))
    assert env.std() / env.mean() > 0.25                                    # waxing and waning, not stationary


# ------------------------------------------------------------------ ketamine (S109-05)

def test_ketamine_gamma_band_theta_and_alternation():
    """Purdon 2015 Fig 9: ketamine sedation gamma in a narrow 25-32 Hz band, alpha absent; Akeju 2016 (S26): theta
    increases and slow-delta alternates with gamma ('gamma burst').  The review measured 35 Hz and theta x0.85."""
    S, S0 = _pair("ketamine", SPECS["ketamine"])
    n, d = _disp(S, 540, 720)
    _, d0 = _disp(S0, 540, 720)
    fs = S.fs
    f, p = sps.welch(d, fs=fs, nperseg=4 * fs, axis=-1)
    _, p0 = sps.welch(d0, fs=fs, nperseg=4 * fs, axis=-1)
    m = (f >= 20) & (f <= 45)
    assert 25.0 <= f[m][np.argmax((p.mean(0) - p0.mean(0))[m])] <= 32.0
    nofp = [i for i, c in enumerate(n) if not c.startswith("Fp")]           # the twin's blinks carry theta at Fp
    assert _bp(d[nofp], fs, 4, 8).mean() > 1.15 * _bp(d0[nofp], fs, 4, 8).mean()

    def env(lo, hi):
        y = sps.sosfiltfilt(sps.butter(4, [lo, hi], "bandpass", fs=fs, output="sos"), d, axis=1)
        return np.sqrt(np.convolve((y ** 2).mean(0), np.ones(fs // 2) / (fs // 2), "same"))
    assert np.corrcoef(env(25, 32), env(1, 4))[0, 1] < -0.1


# ------------------------------------------------------------------ pentobarbital (S109-06)

@pytest.fixture(scope="module")
def pento():
    S, S0 = _pair("pentobarbital", SPECS["pentobarbital"])
    n, d = _disp(S, 0.01, HORIZON)
    fs = S.fs
    env = np.convolve(np.max(np.abs(d), axis=0), np.ones(fs // 2) / (fs // 2), "same")
    return S, S0, n, d, env < 5.0


def test_barbiturate_bursts_are_short_high_voltage_slow_and_sharp(pento):
    """learningeeg burst-suppression pages (R2, R3): bursts about 1-1.5 s of polyphasic sharp and slow waves at
    several times the interburst voltage, irregular IBI, low-voltage residual activity in the suppression; Purdon 2015
    Fig 2F: bursts about 1.5 s.  The review measured bursts of 7.1 s carrying 9 Hz alpha, p2p 53 against 52 uV before
    the ramp, IBI CV 0.26, suppression 0.41 uV RMS."""
    S, _, n, d, sup = pento
    fs = S.fs
    lo = int(12 * 60 * fs)
    bl = _runs(~sup[lo:], fs)
    il = _runs(sup[lo:], fs)
    bl, il = bl[bl > 0.3], il[il > 0.3]
    assert 1.0 <= np.median(bl) <= 2.0
    assert il.std() / il.mean() > 0.4
    seg, bm = d[:, lo:], ~sup[lo:]
    burst = seg[:, bm]
    burst = burst[:, : (burst.shape[1] // fs) * fs]
    pre = d[:, 60 * fs: 240 * fs]
    assert _p2p(burst, fs) > 1.7 * _p2p(pre, fs)
    rel = lambda x, a, b: _bp(x, fs, a, b).sum() / _bp(x, fs, 1, 30).sum()
    assert rel(burst, 8, 13) < 0.05 and rel(burst, 1, 8) > 0.85
    supp_rms = float(np.sqrt(np.mean(seg[:, sup[lo:]] ** 2)))
    assert 0.4 <= supp_rms <= 3.0              # residual activity + sensor/ECG floor, still under the SR criterion
    # the scheduled blinks (241 in 12-30 min before) are gated by loss of consciousness
    assert S._blink_t.size > 0 and float(S._sed_v3_at("loc", np.array([900.0]), 0)[0]) == 1.0


def test_pentobarbital_trend_carries_the_drug(pento):
    """Suppression builds with the authored ramp (5-10 min, target 60 %) and the barbiturate fast activity (13-16 Hz)
    shows before any discontinuity, with occipital alpha gone (review: 'the spectrogram carries no drug signal').  The
    qEEG suppression-ratio trend (0.5 s epochs < 3 uV, 1 s sustained for drug bursts) reads it too."""
    from eeg_render.trends import compute_trends
    S, S0, n, d, sup = pento
    tr = compute_trends(S, HORIZON)
    sr = tr.sr["left"]
    assert sr[tr.t < 300].max() < 5.0 and np.mean(sr[tr.t > 720]) > 30.0
    fs = S.fs
    sr = [sup[m * 60 * fs:(m + 1) * 60 * fs].mean() for m in range(30)]
    assert max(sr[:5]) < 0.05 and sr[10] > 0.35
    assert 0.45 <= np.mean(sr[12:]) <= 0.7
    _, d0 = _disp(S0, 60, 240)
    pre = d[:, 60 * fs: 240 * fs]
    assert _bp(pre, fs, 13, 16).mean() > 2.0 * _bp(d0, fs, 13, 16).mean()
    assert _bp(_rows(n, pre, OCC), fs, 8, 11).mean() < 0.3 * _bp(_rows(n, d0, OCC), fs, 8, 11).mean()


def test_burst_content_window_independent():
    S, _ = _pair("pentobarbital", SPECS["pentobarbital"])
    _, whole = S.segment(1200.0, 1220.0)
    _, a = S.segment(1200.0, 1207.3)
    _, b = S.segment(1207.3, 1220.0)
    assert np.allclose(whole, np.hstack([a, b]), atol=1e-9)


# ------------------------------------------------------------------ blockade (S109-08 / 09)

def _nmb(block):
    extra = {"events": SEIZ_VENT}
    if block:
        extra["neuromuscular_blockade"] = "complete"
    return _synth(_spec(610908, "child", **extra))


def test_complete_blockade_stops_blinks_and_eye_movements():
    """Whitham 2007 (S30): lids and extraocular muscles are skeletal, so complete blockade stops blinks and eye
    movements; ECG, ventilator and cerebral activity stay.  The review counted 13 blinks/min under blockade."""
    S8, S9 = _nmb(False), _nmb(True)
    assert _blinks(S8, 540, 720) >= 10 and _blinks(S9, 540, 720) == 0
    t = np.arange(540.0, 560.0, 1 / S9.fs)
    spec = copy.deepcopy(_spec(610908, "child", neuromuscular_blockade="complete",
                               events=[{"type": "artifact", "kind": k, "at_min": 9.0, "duration_s": 60.0,
                                        "intensity": "high"} for k in ("ventilator", "eye_blink")]))
    Sa = _synth(spec)
    assert len(Sa.artifacts) == 2
    art = Sa._artifact_block(t, int(540 * Sa.fs))
    only_vent = copy.deepcopy(spec)
    only_vent["events"] = [e for e in only_vent["events"] if e["kind"] == "ventilator"]
    Sv = _synth(only_vent)
    # the authored blink is skipped (other ocular kinds are rejected by normalize); the ventilator is untouched
    assert np.abs(art).max() > 1.0 and np.allclose(art, Sv._artifact_block(t, int(540 * Sv.fs)))


def test_blockade_leaves_the_ventilator_identical():
    """The ventilator is a device artifact: blockade must not touch it (S109-08 vs S109-09 share every stream)."""
    S8, S9 = _nmb(False), _nmb(True)
    t = np.arange(560.0, 580.0, 1 / S8.fs)
    assert np.array_equal(S8._artifact_block(t, int(560 * S8.fs)), S9._artifact_block(t, int(560 * S9.fs)))


def test_ventilator_survives_the_display_filter():
    """learningeeg ventilator artifact: sharp rhythmic transients at the ventilator rate visible at LFF 1 Hz."""
    S8 = _nmb(False)
    t = np.arange(560.0 - 10, 590.0, 1 / S8.fs)
    art = S8._artifact_block(t, int((560 - 10) * S8.fs))
    pairs = mt.montage_pairs("longitudinal_bipolar", S8.scalp)
    d = apply_filters(S8.derive(art, pairs), build_filters(S8.fs, {"lf_hz": 1.0, "hf_hz": 70.0}, True), True)
    assert np.ptp(d[:, 10 * S8.fs:], axis=1).max() > 20.0
