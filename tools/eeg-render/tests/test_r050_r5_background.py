"""Round 5 background fixes (spec_version 3): blink contour, ECG artifact visibility, the drug suppression-ratio trend,
the awake child's theta / PDR mix, infant arousals and infant N2.

Measurements before / after and the references: research/eeg-atlas/feature-review-20260926/r5-background.md.
"""
import copy

import numpy as np
import pytest
from scipy import signal as sps
from scipy.ndimage import median_filter

from eeg_render import montage as mt
from eeg_render.render_page import apply_filters, build_filters, page_signals
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer

import test_r050_artifacts as ART
import test_r050_blink_reference as BR
import test_r050_sedation as SD
from test_r050_sleep import FS, _disp, _mk


# ----------------------------------------------------------------------------------------------- blink contour --
def _blink_img(seed):
    return {"kind": "eeg_page", "license": "synthetic-original", "attribution": None,
            "spec": {"sample_rate": 256, "channels": "standard_19", "seed": seed, "spec_version": 3,
                     "age_group": "adult", "duration_min": 10, "at_min": 2.0, "window_s": 30.0,
                     "background": {"type": "continuous", "amplitude_uv": 30.0, "dominant_hz": 10.0,
                                    "slow_fraction": 0.2, "reactivity": "present", "blink_rate_per_min": 20.0},
                     "events": []}}


def test_blink_contour_matches_the_reference_iqr_at_every_point(monkeypatch):
    """artifacts.md 1c (15 blinks, 6 learningeeg figures, displayed Fp1-F3): before r5 +60/+80/+100 ms read
    0.01/-0.29/-0.40 against the IQR .11/.26, -.20/.09, -.25/-.03 (the LFF undershoot peaked 50 ms early).  Pooled
    median over four records: every point inside the reference IQR (+-0.05, the existing test's tolerance), and the
    two points the re-review named (-100 and +100 ms) inside it without tolerance."""
    waves = []
    for seed in (90511, 90514, 90515, 90517):
        spec = normalize(_blink_img(seed))["spec"]
        monkeypatch.setattr(BR, "_page", lambda v, spec=spec: (spec,) + tuple(page_signals(spec)[:4]))
        waves.append(BR._median_blink(3))
    w = np.median(waves, axis=0)
    out = [(m, round(float(v), 2)) for m, v, lo, hi in zip(BR.MS, w, BR.IQR_LO, BR.IQR_HI) if not lo - 0.05 <= v <= hi + 0.05]
    assert not out, out
    for m in (-100, 100):
        i = BR.MS.index(m)
        assert BR.IQR_LO[i] <= w[i] <= BR.IQR_HI[i], (m, w[i])


def test_blink_contour_change_keeps_the_displayed_size():
    """The contour fix must not move the blink size (focal-fix.md: adult Fp1-F3 median 1.76 rows, 8.5x background;
    reference 1.9 rows, 0.9-4.3, 3-10x).  The shoulder adds 18 % at the source peak, which _BLINK_NORM_V5 takes back:
    the displayed Fp1-F3 peak of a nominal blink stays within 5 % of the r3 profile."""
    img = _blink_img(90511)
    S = Synthesizer(normalize(img)["spec"], 600.0)
    t = np.arange(0.0, 6.0, 1.0 / FS)
    pairs = [("Fp1", "F3")]
    filt = build_filters(FS, {"lf_hz": 1.0, "hf_hz": 70.0}, True)

    def peak():
        prof = S._blink_profile(t, np.array([3.0]))
        x = np.zeros((S.n_elec, t.size))
        x[S._idx["Fp1"]] = prof
        return float(apply_filters(S.derive(x, pairs, "x"), filt, True)[0].max())
    new = peak()
    saved = (S._BLINK_FALL_V3R, S._BLINK_LOBE_V3R, S._BLINK_SHOULDER_V5, S._BLINK_NORM_V5)
    try:
        S._BLINK_FALL_V3R, S._BLINK_LOBE_V3R, S._BLINK_SHOULDER_V5, S._BLINK_NORM_V5 = 0.90, (0.22, 0.40, 0.12), (0.0, 0.0, 1.0), 1.0
        old = peak()
    finally:
        S._BLINK_FALL_V3R, S._BLINK_LOBE_V3R, S._BLINK_SHOULDER_V5, S._BLINK_NORM_V5 = saved
    assert 0.95 <= new / old <= 1.05, new / old


def test_blinks_are_window_independent():
    S = Synthesizer(normalize(_blink_img(90511))["spec"], 600.0)
    t1 = np.arange(120.0 * FS, 130.0 * FS) / FS
    t2 = np.arange(117.25 * FS, 131.0 * FS) / FS          # on the same sample grid
    k = int(round(2.75 * FS))
    a = S.blink_rows(t1, np.ones(t1.size))
    b = S.blink_rows(t2, np.ones(t2.size))
    assert np.allclose(a, b[:, k:k + t1.size], atol=1e-9)


# ------------------------------------------------------------------------------------------ ECG artifact --
def _ecg_local(bg_over=None, seed=711004):
    img = ART._image(ART.CASES["ecg"][0], seed)
    img["spec"]["background"].update(bg_over or {})
    spec = normalize(img)["spec"]
    synth, t, sig, pairs, _ = page_signals(spec)
    bare = copy.deepcopy(img)
    bare["spec"]["events"] = []
    bare = normalize(bare)["spec"]
    bare["filters"] = dict(spec["filters"])
    _, _, sig0, _, _ = page_signals(bare)
    lab = {f"{a}-{b}": i for i, (a, b) in enumerate(pairs)}
    beats = synth._beat_times(t[0], t[-1])
    beats = beats[(beats > t[0] + 0.2) & (beats < t[-1] - 0.5)]
    fs = synth.fs
    out = {}
    for n in ("T5-O1", "P3-O1", "Cz-Pz"):
        r = []
        for b in beats:
            k0, k1 = int((b - 0.05 - t[0]) * fs), int((b + 0.08 - t[0]) * fs)
            r.append(np.ptp(sig[lab[n], k0:k1] - sig0[lab[n], k0:k1]) / np.ptp(sig0[lab[n], k0:k1]))
        out[n] = float(np.median(r))
    return out


@pytest.mark.parametrize("bg_over", [None, {"amplitude_uv": 60.0}, {"pdr_gain": 4.0}])
def test_ecg_spike_stands_above_the_local_background_whatever_the_pdr(bg_over):
    """artifacts.md A110-04 / ECG-artifact-on-an-uncalibrated-screen: the posterior spikes stand 1.5-2x above the
    local background.  Before r5, T5-O1 read 1.0x on the default page and 0.67-0.90x at 60 uV or pdr_gain 4 while Cz-Pz
    reached 1.7x.  After: T5-O1 1.86-2.04, P3-O1 1.75-1.86, Cz-Pz 1.17-1.29 on these pages.  Per-beat spike over the
    artifact-free p2p in the same 130 ms."""
    r = _ecg_local(bg_over)
    assert 1.4 <= r["T5-O1"] <= 2.6, r
    assert 1.3 <= r["P3-O1"] <= 2.6, r
    assert 1.0 <= r["Cz-Pz"] <= 2.2, r


# ----------------------------------------------------------------------------------- suppression-ratio trend --
def test_pentobarbital_sr_trend_reads_the_authored_target():
    """S109-06 authors a 60 % suppression ratio.  The page mask (80th-percentile chain envelope < 5 uV) read 61 %, but
    the qEEG trend read 47 / 50 %: a 0.5-s epoch straddling a burst edge is lost, about 0.5 s of every 2.5-s interburst.
    The generator is on target on the page, so the estimator was fixed (0.25-s flags).  Both sides 55-68 % after 12 min,
    within 6 points of the page mask; nothing before the drug."""
    from eeg_render.trends import compute_trends
    S, _ = SD._pair("pentobarbital", SD.SPECS["pentobarbital"])
    tr = compute_trends(S, SD.HORIZON)
    n, d = SD._disp(S, 720.0, SD.HORIZON)
    fs = S.fs
    env = np.convolve(np.percentile(np.abs(d), 80, axis=0), np.ones(fs // 2) / (fs // 2), "same")
    page = 100.0 * float(np.mean(env < 5.0))
    for side in ("left", "right"):
        sr = float(np.mean(tr.sr[side][tr.t > 720]))
        assert 55.0 <= sr <= 68.0 and abs(sr - page) <= 6.0, (side, sr, page)
        assert tr.sr[side][tr.t < 300].max() < 5.0


# ------------------------------------------------------------------------------------------- awake child --
def _band_shares(x, fs=FS):
    """page_metrics.py band shares on the signal: detrended by a 1-s running median, 1-30 Hz Hann periodogram."""
    dev = x - median_filter(x, size=fs + 1, mode="nearest")
    f = np.fft.rfftfreq(x.size, 1.0 / fs)
    p = np.abs(np.fft.rfft(dev * np.hanning(x.size))) ** 2
    tot = p[(f >= 1) & (f < 30)].sum()
    return p[(f >= 4) & (f < 8)].sum() / tot, p[(f >= 8) & (f < 13)].sum() / tot


@pytest.mark.parametrize("seed", [27960625, 4242])
def test_awake_child_pdr_is_mixed_with_theta(seed):
    """learningeeg 5yo-F-posterior-slow-wave-of-youth-2 / posterior-slow-waves-of-youth-again (page_metrics.py, pixel
    domain): midline theta share 0.41-0.46, P-O alpha share 0.24-0.26.  Ours before r5 (eyes-closed pages, rows
    registered): 0.28-0.37 and 0.32-0.42; after 0.40-0.59 and 0.26-0.28.  The pixel tracker dilutes band shares, so the
    test reads the same shares on the displayed signal, where the same pages measured midline theta 0.37-0.42 / P-O
    alpha 0.36-0.53 before and 0.57-0.72 / 0.29-0.40 after."""
    S = _mk("child", minutes=30, seed=seed, events=[])
    at = next(a + 1.0 for a, b, st in S._eyes if st == "closed" and a > 30 and b - a >= 17)
    names, d = _disp(S, at, at + 15.0)
    sh = {n: _band_shares(d[names.index(n)]) for n in names}
    mid = np.mean([sh[n][0] for n in ("Fz-Cz", "Cz-Pz")])
    po = np.mean([sh[n][1] for n in ("P3-O1", "P4-O2", "T5-O1", "T6-O2")])
    assert mid >= 0.5 and po <= 0.38, (mid, po)


# ---------------------------------------------------------------------------------------------- arousals --
def _sos(lo, hi):
    return sps.butter(4, [lo, hi], "bandpass", fs=FS, output="sos")


def _rms(v):
    return float(np.sqrt(np.mean(v ** 2)))


def test_infant_arousal_raises_its_own_waking_rhythm_and_the_emg_settles():
    """AASM arousal: an abrupt shift to theta / alpha for >= 3 s.  The infant PDR (5.5 Hz) rose only 1.48x in its own
    band (child 3.7x).  learningeeg normal-asleep arousal: an abrupt EMG burst that settles to waking muscle; the burst
    held 0.35 of its peak, so the last 40 % of the arousal read 3.2x the record's waking EMG (onset 5.0x).  Targets:
    own band >= 2x; onset >= 3x and late <= 2x the waking EMG (F7-T3 30-70 Hz)."""
    S = _mk("infant", seed=141421)
    names = [f"{a}-{b}" for a, b in mt.montage_pairs("longitudinal_bipolar", S.scalp)]
    f0 = S.dominant_hz
    emg = _sos(30, 70)
    wake = float(np.median([_rms(sps.sosfiltfilt(emg, _disp(S, t, t + 20)[1][names.index("F7-T3")]))
                            for t in range(60, 540, 60)]))
    pdr, early, late = [], [], []
    for a, w, _g, _tau, _m in S._aro_burst:
        if a < 700 or S.stage_at(np.array([a - 2.0]))[0] not in ("N2", "N3") or len(pdr) >= 8:
            continue
        _, d = _disp(S, a - 6, a + w + 1)
        i = 6 * FS
        p = sps.sosfiltfilt(_sos(f0 - 1.5, f0 + 1.5), d[names.index("P3-O1")])
        e = sps.sosfiltfilt(emg, d[names.index("F7-T3")])
        pdr.append(_rms(p[i:i + 3 * FS]) / _rms(p[:i - FS]))
        early.append(_rms(e[i:i + 3 * FS]) / wake)
        late.append(_rms(e[i + int(0.6 * w * FS):i + int(w * FS)]) / wake)
    assert len(pdr) >= 5
    assert np.median(pdr) >= 2.0, pdr
    assert np.median(early) >= 3.0 and np.median(late) <= 2.0, (early, late)


# ---------------------------------------------------------------------------------------------- infant N2 --
def test_infant_n2_seed_with_a_hot_ear_electrode_stays_under_the_n3_criterion():
    """sleep-fix.md: seed 5150301 (A1 channel gain 1.5) scored 25 % of N2 epochs as N3 on F4-A1 (target < 20 %, AASM).
    At the current head it reads 15 %; eight infant seeds read 0-18 %.  Regression guard."""
    from test_r050_sleep_fix import _aasm
    S = _mk("infant", seed=5150301, minutes=100)
    n2, n3 = _aasm(S, "N2", 60), _aasm(S, "N3", 20)
    assert n2.size >= 40 and np.mean(n2 > 0.2) < 0.2, np.mean(n2 > 0.2)
    assert np.mean(n3 > 0.2) >= 0.9
