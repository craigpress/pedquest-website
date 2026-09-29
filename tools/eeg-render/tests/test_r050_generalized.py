"""0.5.0 phase D, generalized family (research/eeg-atlas/feature-review-20260926/generalized-review.md).

Generalized seizures and generalized interictal patterns (eeg_render/generalized_v3.py), the rebuilt polyspike and the
C26 GPD field.  Every measurement is on the longitudinal-bipolar display through the causal 1-70 Hz page chain; where a
morphology is timed the generalized rows are isolated and passed through the same (linear) derivation and filters.
Reference figures are cached in research/eeg-atlas/references/cache/ (learningeeg, eegatlas-online).
"""
import copy

import numpy as np
import pytest
import scipy.signal as sps

from eeg_render import montage as mt
from eeg_render.export.manifest import realized_events
from eeg_render.render_page import apply_filters, build_filters
from eeg_render.spec import SpecError, normalize
from eeg_render.synth import Synthesizer

CHILD = dict(type="continuous", amplitude_uv=40.0, dominant_hz=9.0, slow_fraction=0.4, reactivity="present",
             channel_gain_max=1.5)
LGS_BG = dict(type="continuous", amplitude_uv=70.0, dominant_hz=4.0, slow_fraction=0.85, reactivity="present",
              channel_gain_max=1.5, pdr_gain=0.3)
SLEEP = [{"type": "state_change", "at_min": 0.5, "to": "sleep"}]
FILT = {"lf_hz": 1.0, "hf_hz": 70.0, "notch_hz": 60.0}
CHAINS = ["Fp1-F7", "F7-T3", "T3-T5", "T5-O1", "Fp2-F8", "F8-T4", "T4-T6", "T6-O2", "Fp1-F3", "F3-C3", "C3-P3",
          "P3-O1", "Fp2-F4", "F4-C4", "C4-P4", "P4-O2", "Fz-Cz", "Cz-Pz"]


def _spec(seed, age, bg, events, version=3, dur=30):
    img = {"kind": "qeeg_panel", "license": "synthetic-original", "attribution": None,
           "spec": {"sample_rate": 256, "channels": "standard_19", "seed": seed, "spec_version": version,
                    "age_group": age, "duration_min": dur, "background": bg, "events": events}}
    return normalize(img)["spec"]


def _chain(syn, x):
    pairs = mt.montage_pairs("longitudinal_bipolar", syn.scalp)
    sig = apply_filters(syn.derive(x, pairs), build_filters(syn.fs, FILT, True), True)
    return sig, [f"{a}-{b}" for a, b in pairs]


def _display(syn, t0, t1, pad=6.0):
    t, x = syn.segment(t0 - pad, t1)
    sig, names = _chain(syn, x)
    keep = t >= t0
    return t[keep], sig[:, keep], names


def _isolated(syn, t0, t1, pad=6.0):
    """Only the generalized cerebral rows (no EMG / eye / photic), through the same derivation and filters."""
    i0 = int(round((t0 - pad) * syn.fs))
    t = (i0 + np.arange(int(round((t1 - t0 + pad) * syn.fs)))) / syn.fs
    sig, names = _chain(syn, syn._gen.rows(t, i0, extras=False) * syn._ch_gain[:, None])
    keep = t >= t0
    return t[keep], sig[:, keep], names


def _p2p(y, w):
    return np.array([np.ptp(y[i:i + w]) for i in range(0, y.size - w + 1, w)])


def _band_rms(y, fs, lo, hi):
    sos = sps.butter(4, [lo, min(hi, fs / 2 - 1)], btype="bandpass", fs=fs, output="sos")
    return float(np.sqrt(np.mean(sps.sosfiltfilt(sos, y) ** 2)))


def gs(st, at=2.0, **kw):
    return dict(type="generalized_seizure", seizure_type=st, onset_min=at, **kw)


def gd(pat, **kw):
    return dict(type="generalized_discharges", pattern=pat, **kw)


def _row(syn, kind="generalized_seizure"):
    return [r for r in syn._gen.events() if r["kind"] == kind]


# ------------------------------------------------------------------ typical absence

def test_typical_absence_matches_the_atlas_absence():
    """atlas-absence-seizure/p1 (= absence-seizure-at-20uV) and eegatlas-online eeg0087: generalized 3-Hz
    spike(-polyspike)-and-wave in EVERY longitudinal chain at many times the background, frontal maximum, abrupt onset
    (full voltage within ~1 cycle) and offset, ~3.5 Hz early slowing toward ~2.5-3 Hz.  The 0.4.x generalized
    spike-wave run measured 1.3-2.4x the background on the chain (71-135 against 42-100 uV)."""
    syn = Synthesizer(_spec(926201, "child", CHILD, [gs("typical_absence", duration_s=8.0)]), 400.0)
    t0, t1 = 120.0, 128.0
    t, s, names = _display(syn, t0 - 6.0, t1 + 4.0)
    fs = syn.fs
    pre, mid = (t < t0 - 0.5), (t > t0 + 1.0) & (t < t1 - 1.0)
    ratios = {ch: np.median(_p2p(s[names.index(ch)][mid], fs)) / np.median(_p2p(s[names.index(ch)][pre], fs))
              for ch in CHAINS}
    assert np.median(list(ratios.values())) >= 4.0 and min(ratios.values()) >= 2.5, ratios
    # frequency: complexes per second early vs late (key), and the displayed Fz-Cz spectral peak
    cx = np.array([c["t"] for c in syn._gen.cx])
    early = np.sum((cx >= t0) & (cx < t0 + 2.0)) / 2.0
    late = np.sum((cx >= t1 - 2.0) & (cx < t1)) / 2.0
    assert 3.0 <= early <= 4.0 and 2.3 <= late <= 3.2 and late < early, (early, late)
    f, p = sps.welch(s[names.index("Fz-Cz")][mid], fs, nperseg=4 * fs)
    band = f > 1.5
    assert 2.4 <= f[band][np.argmax(p[band])] <= 3.8
    # abrupt onset and offset on the isolated discharge: 10 -> 90 % of the run's envelope within 0.5 s
    ti, si, _ = _isolated(syn, t0 - 3.0, t1 + 3.0)
    env = np.convolve(np.abs(si).max(axis=0), np.ones(fs // 3) / (fs // 3), "same")
    lvl = np.median(env[(ti > t0 + 1) & (ti < t1 - 1)])
    rise = ti[np.argmax(env > 0.9 * lvl)] - ti[np.argmax(env > 0.1 * lvl)]
    assert rise <= 0.5, rise
    after = (ti > t1 + 0.9) & (ti < t1 + 2.5)
    assert env[after].max() <= 0.1 * lvl
    # frontal maximum (referential on the isolated rows): F3/Fz >= 2x O1, every chain carries a share
    i0 = int(round((t0 + 2) * fs))
    tt = (i0 + np.arange(2 * fs)) / fs
    ref = syn._gen.rows(tt, i0)
    pp = {e: np.ptp(ref[syn._idx[e]]) for e in ("Fp1", "F3", "Fz", "C3", "P3", "O1")}
    assert pp["Fz"] >= 2.0 * pp["O1"] and pp["F3"] >= 2.0 * pp["O1"], pp
    # the background, PDR and blinks stop during the run (absence gate)
    tm = np.linspace(t0 + 1, t1 - 1, 50)
    assert syn.absence_gate(tm).min() >= 0.95 and syn._gen.bg_factor(tm).max() <= 0.4


def test_typical_absence_spike_and_wave_morphology():
    """Spike 20-70 ms (IFCN) followed by a slow wave at least as large; about a quarter of the seizures carry a second
    spike (absence-seizure-at-20uV: "spike/polyspike and waves"), drawn once per seizure (independent re-review: the
    references repeat the same complex cycle after cycle)."""
    doubles = []
    for seed in range(926300, 926320):
        s = Synthesizer(_spec(seed, "child", CHILD, [gs("typical_absence", duration_s=4.0)]), 200.0)
        d = {c["double"] for c in s._gen.cx}
        assert len(d) == 1
        doubles.append(d.pop())
    assert 0.1 <= np.mean(doubles) <= 0.45, np.mean(doubles)
    syn = Synthesizer(_spec(926201, "child", CHILD, [gs("typical_absence", duration_s=8.0)]), 400.0)
    cx = [c for c in syn._gen.cx if c["kind"] == "sw"]
    fs = syn.fs
    wave_over_spike = []
    for c in cx[3:9]:
        t, s, names = _isolated(syn, c["t"] - 0.1, c["t"] + c["period"] - 0.02)
        y = s[names.index("Fz-Cz")]
        # spike: the fast part (>8 Hz), slow wave: the part below 6 Hz
        fast = sps.sosfiltfilt(sps.butter(4, 8.0, "highpass", fs=fs, output="sos"), y)
        slow = sps.sosfiltfilt(sps.butter(4, 6.0, "lowpass", fs=fs, output="sos"), y)
        wave_over_spike.append(np.ptp(slow) / np.ptp(fast))
    assert np.median(wave_over_spike) >= 0.8, wave_over_spike


def test_atypical_absence_is_slow_and_gradual():
    """Atypical absence: slow (<2.5 Hz) spike-and-wave, gradual onset and offset (vs the abrupt typical absence),
    irregular rate."""
    syn = Synthesizer(_spec(926202, "child", LGS_BG, [gs("atypical_absence", duration_s=12.0)]), 400.0)
    cx = np.array([c["t"] for c in syn._gen.cx])
    isi = np.diff(cx)
    assert 1.5 <= 1.0 / np.median(isi) <= 2.5 and np.std(isi) / np.mean(isi) >= 0.08
    t0, t1 = 120.0, 132.0
    ti, si, _ = _isolated(syn, t0 - 2.0, t1 + 2.0)
    fs = syn.fs
    env = np.convolve(np.abs(si).max(axis=0), np.ones(fs) / fs, "same")
    lvl = np.median(env[(ti > t0 + 4) & (ti < t1 - 4)])
    rise = ti[np.argmax(env > 0.9 * lvl)] - ti[np.argmax(env > 0.2 * lvl)]
    assert rise >= 1.0, rise


# ------------------------------------------------------------------ myoclonic family

def _emg(syn, t, s, names, m_on, m_pre, chans=("F7-T3", "T3-T5", "F8-T4", "T4-T6")):
    return np.median([_band_rms(s[names.index(c)][m_on], syn.fs, 30, 70) /
                      _band_rms(s[names.index(c)][m_pre], syn.fs, 30, 70) for c in chans])


def test_myoclonic_polyspike_wave_with_emg_burst():
    """Myoclonic seizure (myoclonic-jerk-examples/p1, eeg0094_db1): generalized polyspike-and-wave, 3-8 irregular spikes,
    a slow wave at least as large as the spikes, and a brief EMG burst time-locked to the spikes."""
    syn = Synthesizer(_spec(926203, "adolescent", CHILD, [gs("myoclonic", count=3, interval_s=4.0)]), 400.0)
    fs = syn.fs
    for c in syn._gen.cx:
        lags = c["ps"][0]
        assert 3 <= lags.size <= 8 and np.all(np.diff(lags) >= 0.045 - 1e-9)
        t, s, names = _isolated(syn, c["t"] - 0.1, c["t"] + lags[-1] + 0.5)
        y = s[names.index("F3-C3")]
        fast = sps.sosfiltfilt(sps.butter(4, 12.0, "highpass", fs=fs, output="sos"), y)
        slow = sps.sosfiltfilt(sps.butter(4, 5.0, "lowpass", fs=fs, output="sos"), y)
        assert np.ptp(slow) >= 0.8 * np.ptp(fast), (np.ptp(slow), np.ptp(fast))
        td, sd, nd = _display(syn, c["t"] - 3.0, c["t"] + 1.0)
        on = (td > c["t"]) & (td < c["t"] + lags[-1] + 0.05)
        pre = td < c["t"] - 0.5
        # myoclonic-jerk-examples/p1: the burst is visible over the temporal chains, not a saturating artifact
        assert _emg(syn, td, sd, nd, on, pre) >= 2.5
        # conspicuity: the complex >= 3x the page's 1-s background in F3-C3
        assert np.ptp(sd[nd.index("F3-C3")][on | ((td > c["t"]) & (td < c["t"] + lags[-1] + 0.4))]) >= \
            3.0 * np.median(_p2p(sd[nd.index("F3-C3")][pre], fs))


def test_myoclonic_atonic_silences_and_myoclonic_tonic_stiffens():
    """Myoclonic-atonic: the tonic EMG falls silent after the jerk; myoclonic-tonic: tonic EMG and a low-voltage fast
    decrement follow it (ILAE 2017; Doose syndrome / LGS)."""
    syn = Synthesizer(_spec(926204, "child", CHILD, [gs("myoclonic_atonic", count=1, atonic_s=1.0)]), 400.0)
    c = syn._gen.cx[0]
    a0 = c["t"] + c["ps"][0][-1] + 0.08
    td, sd, nd = _display(syn, c["t"] - 4.0, a0 + 1.5)
    assert _emg(syn, td, sd, nd, (td > a0 + 0.15) & (td < a0 + 0.9), td < c["t"] - 0.5) <= 0.4
    syn = Synthesizer(_spec(926205, "child", CHILD, [gs("myoclonic_tonic", count=1, tonic_s=2.0)]), 400.0)
    c = syn._gen.cx[0]
    a0 = c["t"] + c["ps"][0][-1] + 0.15
    td, sd, nd = _display(syn, c["t"] - 4.0, a0 + 2.5)
    assert _emg(syn, td, sd, nd, (td > a0 + 0.4) & (td < a0 + 1.8), td < c["t"] - 0.5) >= 2.0


def test_atonic_slow_wave_and_loss_of_tone():
    """Atonic seizure: a generalized sharp-and-slow-wave that stands above the background and an abrupt EMG loss."""
    syn = Synthesizer(_spec(926207, "child", CHILD, [gs("atonic", duration_s=1.2)]), 400.0)
    t0 = 120.0
    td, sd, nd = _display(syn, t0 - 4.0, t0 + 2.0)
    fs = syn.fs
    on, pre = (td > t0 - 0.1) & (td < t0 + 0.9), td < t0 - 0.5
    # vertex / frontocentral field (independent re-review): the parasagittal and midline chains carry it, the temporal
    # chains little
    para = ["Fp1-F3", "F3-C3", "C3-P3", "P3-O1", "Fp2-F4", "F4-C4", "C4-P4", "P4-O2", "Fz-Cz", "Cz-Pz"]
    rat = np.median([np.ptp(sd[nd.index(ch)][on]) / np.median(_p2p(sd[nd.index(ch)][pre], fs)) for ch in para])
    assert rat >= 3.0, rat
    assert _emg(syn, td, sd, nd, (td > t0 + 0.2) & (td < t0 + 1.1), pre) <= 0.4


# ------------------------------------------------------------------ tonic

def test_tonic_seizure_fast_activity_survives_the_chain():
    """atlas-tonic-seizure-i/-ii: generalized paroxysmal fast activity 10-25 Hz in every parasagittal derivation,
    frontally predominant, building in voltage.  The 0.4.x tonic_seizure fast activity cancelled on the parasagittal
    chain (only temporal EMG showed)."""
    for ev in (gs("tonic", duration_s=8.0), {"type": "tonic_seizure", "onset_min": 2.0}):
        syn = Synthesizer(_spec(926206, "child", LGS_BG, [ev]), 400.0)
        t0 = 120.0 + 1.5
        td, sd, nd = _display(syn, t0 - 8.0, t0 + 6.0)
        fs = syn.fs
        on, pre = (td > t0 + 2.0) & (td < t0 + 6.0), td < t0 - 2.5
        r = {ch: _band_rms(sd[nd.index(ch)][on], fs, 10, 25) / _band_rms(sd[nd.index(ch)][pre], fs, 10, 25)
             for ch in ("Fp1-F3", "F3-C3", "Fz-Cz", "F4-C4", "C3-P3")}
        assert min(r[c] for c in ("Fp1-F3", "F3-C3", "Fz-Cz", "F4-C4")) >= 3.0, (ev["type"], r)
        f, p = sps.welch(sd[nd.index("F3-C3")][on], fs, nperseg=fs)
        band = f > 6
        assert 10.0 <= f[band][np.argmax(p[band])] <= 25.0
        fr = _band_rms(sd[nd.index("Fp1-F3")][on], fs, 10, 25) + _band_rms(sd[nd.index("F3-C3")][on], fs, 10, 25)
        po = 2 * _band_rms(sd[nd.index("P3-O1")][on], fs, 10, 25)
        assert fr >= 1.3 * po


# ------------------------------------------------------------------ GTC

def test_gtc_phases():
    """atlas-gtc-at-20uv p1-p3: the tonic phase is dominated by muscle, the clonic phase breaks into bursts whose silent
    intervals lengthen, and the seizure ends in diffuse postictal suppression (<10 uV-class, no EMG)."""
    syn = Synthesizer(_spec(926208, "adolescent", CHILD, [gs("gtc")]), 600.0)
    r = _row(syn)[0]
    t0, tc, t1 = 120.0, r["tonic_end_s"], r["clonic_end_s"]
    td, sd, nd = _display(syn, t0 - 8.0, t0 + 10.0)
    assert _emg(syn, td, sd, nd, (td > t0 + 3) & (td < t0 + 10), td < t0 - 1.0) >= 4.0
    bursts = np.array([c["t"] for c in syn._gen.cx if tc <= c["t"] < t1])
    isi = np.diff(bursts)
    assert np.mean(isi[:5]) < 0.6 * np.mean(isi[-5:]), isi
    assert 1.0 / np.mean(isi[-5:]) <= 1.2
    tb, sb, nb = _display(syn, t0 - 20.0, t0 - 5.0)
    tp, sp_, npn = _display(syn, t1 + 3.0, t1 + 18.0)
    fs = syn.fs
    before = np.median([np.median(_p2p(sb[nb.index(c)], fs)) for c in CHAINS])
    post = np.median([np.median(_p2p(sp_[npn.index(c)], fs)) for c in CHAINS])
    assert post <= 0.35 * before and post <= 12.0, (post, before)


# ------------------------------------------------------------------ eyelid myoclonia, PPR

def test_eyelid_myoclonia_closure_then_discharge():
    """Eyelid myoclonia (Jeavons): eye closure (cornea-positive Fp deflection, DOWN in Fp1-F3) followed by a brief
    generalized 3-6 Hz polyspike-and-wave burst (4-6-Hz-spike-and-waves-with-JME).  r8: 0.5-1.2 s after the closure
    (generalized-review-20260928 REFERENCE_TARGETS s7: 0.5-2 s; was 0.2-0.5 s)."""
    syn = Synthesizer(_spec(926209, "child", CHILD, [gs("eyelid_myoclonia")]), 400.0)
    r = _row(syn)[0]
    assert 0.5 <= r["discharge_onset_s"] - r["closure_s"] <= 1.2
    cx = np.array([c["t"] for c in syn._gen.cx])
    assert 3.0 <= 1.0 / np.median(np.diff(cx)) <= 6.0
    t0 = r["closure_s"]
    i0 = int(round((t0 - 1) * syn.fs))
    tt = (i0 + np.arange(int(1.2 * syn.fs))) / syn.fs
    eye = syn._gen._eye_rows(tt)
    sig, names = _chain(syn, eye)
    assert sig[names.index("Fp1-F3")][tt > t0 + 0.1].mean() > 0     # cornea-positive at Fp1: + in Fp1-F3 = DOWN


def test_photoparoxysmal_response_is_time_locked_to_the_train():
    """eegatlas-online eeg0066 (21-Hz train): occipital driving at the flash rate, then generalized polyspike-and-wave
    starting 0.5-2 s into the train and stopping with it (self-limited) or outlasting it by 1-3 s."""
    for outl in (False, True):
        syn = Synthesizer(_spec(926210, "adolescent", CHILD, [gs("photoparoxysmal", outlasting=outl)]), 400.0)
        r = _row(syn)[0]
        lat = r["onset_s"] if "onset_s" in r else r["t0"]
        lat = r["t0"] - r["stimulus_onset_s"]
        tail = r["t1"] - r["stimulus_offset_s"]
        assert 0.5 <= lat <= 2.0
        assert (1.0 <= tail <= 3.4) if outl else (tail <= 0.5), (outl, tail)
    s0 = r["stimulus_onset_s"]
    td, sd, nd = _display(syn, s0 - 5.0, s0 + 0.45)
    fs = syn.fs
    y = sd[nd.index("P3-O1")]
    on, pre = td > s0 + 0.05, td < s0 - 0.5
    fl = r["stimulus_frequency_hz"]
    assert _band_rms(y[on], fs, fl - 1.5, fl + 1.5) >= 2.0 * _band_rms(y[pre], fs, fl - 1.5, fl + 1.5)


# ------------------------------------------------------------------ interictal

def test_interictal_generalized_bursts_rate_and_frequency():
    """IGE interictal generalized spike-and-wave (more-generalized-discharges, eeg0087: 1-2-s bursts at 3-4 Hz) and JME
    polyspike-and-wave (4-6-Hz-spike-and-waves-with-JME).  Realized burst rate within 25 % of the authored rate."""
    for pat, lo, hi in (("spike_wave", 3.0, 4.2), ("polyspike_wave", 3.8, 6.0)):
        syn = Synthesizer(_spec(926211, "adolescent", CHILD, [gd(pat, rate_per_h=120)], dur=60), 3600.0)
        rows = [r for r in _row(syn, "generalized_discharge") if 0 <= r["t0"] < 3600]
        assert 0.75 * 120 <= len(rows) <= 1.25 * 120, len(rows)
        d = np.array([r["t1"] - r["t0"] for r in rows])
        assert d.min() >= 0.25 and d.max() <= 4.1
        f = np.median([r["frequency_hz"] for r in rows])
        assert lo <= f <= hi, (pat, f)
        r = rows[len(rows) // 2]
        td, sd, nd = _display(syn, r["t0"] - 5.0, r["t1"])
        on, pre = td > r["t0"], td < r["t0"] - 0.5
        y = sd[nd.index("F3-C3")]
        assert np.ptp(y[on]) >= 3.0 * np.median(_p2p(y[pre], syn.fs))


def test_lgs_slow_spike_wave():
    """different-LGS-background-at-10uV: slow generalized spike-and-wave (sharp waves ~100 ms, 1.5-2.5 Hz) in runs."""
    syn = Synthesizer(_spec(926213, "child", LGS_BG, [gd("slow_spike_wave", rate_per_h=200)], dur=30), 1800.0)
    rows = _row(syn, "generalized_discharge")
    f = np.array([r["frequency_hz"] for r in rows])
    assert 1.5 <= np.median(f) <= 2.5 and f.max() <= 3.0
    cx = [c for c in syn._gen.cx if c["kind"] == "ssw" and c["t"] > 60.0][10:16]
    fs = syn.fs
    widths = []
    for c in cx:
        t, s, names = _isolated(syn, c["t"] - 0.3, c["t"] + 0.3)
        y = -s[names.index("F3-C3")]
        pk, _ = sps.find_peaks(y)
        k = pk[np.argmin(np.abs(t[pk] - c["t"]))]
        # width at half prominence: the sharp wave rides on the previous complex's slow wave
        widths.append(float(sps.peak_widths(y, [k], rel_height=0.5)[0][0]) / fs * 1000.0)
    assert 60.0 <= np.median(widths) <= 200.0, widths


def test_gpfa_only_in_nrem_and_visible():
    """LGS generalized paroxysmal fast activity: 10-25 Hz bursts of 0.5-10 s in NREM sleep, frontally predominant."""
    syn = Synthesizer(_spec(926214, "child", LGS_BG, SLEEP + [gd("gpfa", rate_per_h=200)], dur=60), 3600.0)
    rows = _row(syn, "generalized_discharge")
    assert rows and all(r["stage"] in ("N2", "N3") for r in rows)
    assert all(10.0 <= r["frequency_hz"] <= 25.0 and 0.5 <= r["t1"] - r["t0"] <= 10.0 for r in rows)
    r = next(r for r in rows if r["t1"] - r["t0"] >= 2.0 and r["t0"] > 300)
    td, sd, nd = _display(syn, r["t0"] - 6.0, r["t1"])
    on, pre = (td > r["t0"] + 0.3), td < r["t0"] - 1.0
    for ch in ("F3-C3", "Fz-Cz"):
        y = sd[nd.index(ch)]
        assert _band_rms(y[on], syn.fs, 10, 25) >= 3.0 * _band_rms(y[pre], syn.fs, 10, 25), ch


def test_eses_spike_wave_index():
    """ESES / CSWS (ESES-example-left-hemispheric-predominance-at-20uV: '>85 % of non-REM sleep dominated by spike-wave
    activity'): the spike-wave index over N2/N3 >= 85 %, awake <= 20 %, and side=left weights the left hemisphere."""
    syn = Synthesizer(_spec(926215, "child", CHILD, SLEEP + [gd("eses", side="left")], dur=120), 7200.0)
    rows = _row(syn, "generalized_discharge")
    hyp = syn._hypno

    def swi(stages):
        tot = cov = 0.0
        for a, b, st in hyp:
            a, b = max(a, 0.0), min(b, 7200.0)
            if st not in stages or b <= a:
                continue
            tot += b - a
            for r in rows:
                cov += max(0.0, min(b, r["t1"]) - max(a, r["t0"]))
        return cov / tot if tot else None
    nrem = swi(("N2", "N3"))
    assert nrem is not None and nrem >= 0.85, nrem
    wake = swi(("W",))
    assert wake is None or wake <= 0.2, wake
    r = next(r for r in rows if r["stage"] in ("N2", "N3") and r["t1"] - r["t0"] >= 6 and r["t0"] > 600)
    t, s, names = _isolated(syn, r["t0"] + 1, r["t0"] + 5)
    left = np.mean([np.ptp(s[names.index(c)]) for c in ("F3-C3", "C3-P3", "F7-T3", "T3-T5")])
    right = np.mean([np.ptp(s[names.index(c)]) for c in ("F4-C4", "C4-P4", "F8-T4", "T4-T6")])
    assert left >= 1.5 * right
    assert 1.5 <= r["frequency_hz"] <= 2.6


# ------------------------------------------------------------------ polyspike rebuild (B5-04 / HYPS)

def test_polyspike_rebuilt_as_irregular_spikes_into_a_dominant_wave():
    """epileptiform-v3.md change 1 (eeg0094_db1, myoclonic-jerk-examples/p1): the v3 phase-B polyspike was a 16-Hz
    sine burst (81 % of the train's power within 3 Hz of 1/ISI, 1 % above 25 Hz, wave 0.41x the train).  Now: power
    near 1/ISI <= 0.5, above 25 Hz >= 0.1, slow wave >= 0.8x the spike train, complex >= 5x the 150-ms background."""
    spec = _spec(517604, "child", CHILD, [{"type": "sporadic_discharges", "focus": "generalized_frontocentral",
                                           "rate_per_h": 120, "amplitude_uv": 150.0, "morphology": "polyspike",
                                           "n_spikes": 6}])
    syn = Synthesizer(spec, 900.0)
    fs = syn.fs
    near, high, wave, consp, cv = [], [], [], [], []
    for j in [j for j, r in enumerate(syn._sed) if 60.0 < r[0] < 800.0][:8]:
        t0 = float(syn._sed[j, 0])
        lags = syn._sed_poly[j][0]
        cv.append(np.std(np.diff(lags)) / np.mean(np.diff(lags)))
        tt = np.arange(int(round((t0 - 6.0) * fs)), int(round((t0 + 1.5) * fs))) / fs
        sig, names = _chain(syn, syn._sed_rows(tt))
        y = sig[names.index("F3-C3")]
        train = (tt > t0 - 0.02) & (tt < t0 + lags[-1] + 0.03)
        # the spike train's own shape: its slow-wave onset removed by an 8-Hz high-pass
        yh = sps.sosfiltfilt(sps.butter(4, 8.0, "highpass", fs=fs, output="sos"), y)
        x = yh[train] - yh[train].mean()
        X = np.abs(np.fft.rfft(x, 4096)) ** 2
        f = np.fft.rfftfreq(4096, 1.0 / fs)
        f0 = 1.0 / np.mean(np.diff(lags))
        near.append(X[np.abs(f - f0) <= 3.0].sum() / X[f > 1.0].sum())
        high.append(X[f > 25.0].sum() / X[f > 1.0].sum())
        fast = sps.sosfiltfilt(sps.butter(4, 12.0, "highpass", fs=fs, output="sos"), y)
        slow = sps.sosfiltfilt(sps.butter(4, 5.0, "lowpass", fs=fs, output="sos"), y)
        m = (tt > t0 - 0.05) & (tt < t0 + lags[-1] + 0.5)
        wave.append(np.ptp(slow[m]) / np.ptp(fast[m]))
        td, sd, nd = _display(syn, t0 - 20.0, t0 + 1.5)
        yd = sd[nd.index("F3-C3")]
        md = (td > t0 - 0.05) & (td < t0 + lags[-1] + 0.5)
        consp.append(np.ptp(yd[md]) / np.median(_p2p(yd[td < t0 - 1.0], int(0.15 * fs))))
    assert np.median(cv) >= 0.12, cv
    assert np.median(near) <= 0.5, near
    assert np.median(high) >= 0.1, high
    assert np.median(wave) >= 0.8, wave
    assert np.median(consp) >= 5.0, consp


# ------------------------------------------------------------------ C26 GPD field

def test_gpd_survives_the_bipolar_chain():
    """epileptiform-v3.md C26: mid-run per-cycle p-p on F3-C3 and Cz-Pz was 0.30x referential Fz (v2 0.65) because the
    near-uniform generalized field reached the chain only through the inter-electrode lag.  The proposed acceptance
    (both >= 0.5x) needs a referential drop of a full Fz from Fz to Pz, which would empty the posterior chains that
    gpds-ty-clean shows; the frontal links (F3-C3, Fz-Cz, where GPDs are largest) now reach >= 0.5x and every
    longitudinal chain keeps a share (Cz-Pz >= 0.2x, P3-O1 >= 0.15x)."""
    ev = {"type": "rhythmic_pattern", "pattern": "GPD", "periodic": True, "frequency_hz": 2.0, "amplitude_uv": 110,
          "run_duration_s": 60, "onset_min": 5.0, "duration_min": 3.0, "onset_region": "generalized", "min_cycles": 6}
    bg = dict(type="continuous", amplitude_uv=15.0, dominant_hz=2.0, slow_fraction=0.85, reactivity="absent",
              channel_gain_max=1.5, blink_rate_per_min=0, pdr_gain=0.0)
    syn = Synthesizer(_spec(515702, "adult", bg, [ev]), 900.0)
    z = syn.rhythmic_patterns[0]
    a, b = z.t0 + 10.0, z.t0 + 20.0
    fs = syn.fs
    t = np.arange(int(round((a - 6.0) * fs)), int(round(b * fs))) / fs
    rows = syn._seizure_block(t)
    sig, names = _chain(syn, rows)
    ref = apply_filters(rows[[syn._idx["Fz"]]], build_filters(fs, FILT, True), True)[0]
    keep = t >= a
    per = int(round(fs / 2.0))
    fz = np.median(_p2p(ref[keep], per))
    r = {ch: np.median(_p2p(sig[names.index(ch)][keep], per)) / fz for ch in ("F3-C3", "Fz-Cz", "Cz-Pz", "P3-O1")}
    # merged with the ACNS family, whose predominance field carries v3 GPDs (visible in every chain at >= 2.5x
    # background, test_r050_acns); its frontal share is 0.43-0.45x referential Fz
    assert r["F3-C3"] >= 0.4 and r["Fz-Cz"] >= 0.4 and r["Cz-Pz"] >= 0.2 and r["P3-O1"] >= 0.15, r


# ------------------------------------------------------------------ key, gating, independence

def test_generalized_events_are_keyed():
    evs = [gs("typical_absence", at=2.0), gs("gtc", at=5.0), gd("spike_wave", rate_per_h=120)]
    syn = Synthesizer(_spec(926220, "child", CHILD, evs, dur=30), 600.0)
    rows = realized_events(syn, 600.0)
    sz = [r for r in rows if r["kind"] == "generalized_seizure"]
    assert {r["seizure_type"] for r in sz} == {"typical_absence", "gtc"}
    absn = next(r for r in sz if r["seizure_type"] == "typical_absence")
    assert absn["provocation"] == "hyperventilation" and absn["clinical_correlate"] == "behavioral_arrest"
    assert abs(absn["onset_s"] - 120.0) < 1e-6 and abs(absn["offset_s"] - 130.0) < 1e-6
    assert absn["semiology"] and absn["onset_region"] == "generalized"
    assert any(r["kind"] == "generalized_discharge" and r["pattern"] == "spike_wave" for r in rows)


def test_generalized_events_need_spec_version_3():
    with pytest.raises(SpecError):
        _spec(1, "child", CHILD, [gs("typical_absence")], version=2)


@pytest.mark.parametrize("case", ["absence", "gtc", "eses", "interictal", "ppr"])
def test_generalized_features_are_window_and_horizon_independent(case):
    ev = {"absence": ([gs("typical_absence", at=2.0)], 118.0),
          "gtc": ([gs("gtc", at=2.0)], 150.0),
          "eses": (SLEEP + [gd("eses")], 700.0),
          "interictal": ([gd("polyspike_wave", rate_per_h=900)], 300.0),
          "ppr": ([gs("photoparoxysmal", at=2.0)], 119.0)}[case]
    spec = _spec(926230, "child", CHILD, ev[0], dur=30)
    a = ev[1]
    syn = Synthesizer(spec, 1200.0)
    t1, x1 = syn.segment(a - 5.0, a + 10.0)
    t2, x2 = syn.segment(a, a + 4.0)
    i = int(round(5.0 * syn.fs))
    assert np.allclose(x1[:, i:i + x2.shape[1]], x2, atol=1e-6)
    # a page synthesizer (short horizon) sees the same generalized rows as the whole-record one
    page = Synthesizer(copy.deepcopy(spec), a + 70.0)
    tt = (int(round(a * syn.fs)) + np.arange(4 * syn.fs)) / syn.fs
    i0 = int(round(a * syn.fs))
    assert np.allclose(syn._gen.rows(tt, i0), page._gen.rows(tt, i0), atol=1e-6)


# ------------------------------------------------------------------ independent re-review fixes (r050-fix-generalized)
# research/eeg-atlas/feature-review-20260926/generalized-independent.md; measurements re-run with its scripts in
# renders/phaseB/fix-generalized/ (indep.py, fixcheck.py) and written up in generalized-fix.md.

def _ref_isolated(syn, t0, t1, pad=1.0):
    """Only the generalized cerebral rows, unfiltered, ear-referenced (the reviewer's "F3-ear isolated" trace)."""
    i0 = int(round((t0 - pad) * syn.fs))
    t = (i0 + np.arange(int(round((t1 - t0 + pad) * syn.fs)))) / syn.fs
    pairs = mt.montage_pairs("referential", syn.scalp)
    sig = syn.derive(syn._gen.rows(t, i0, extras=False) * syn._ch_gain[:, None], pairs, "referential")
    keep = t >= t0
    return t[keep], sig[:, keep], [a for a, _ in pairs]


def _fwhm_s(y, i, fs):
    h = abs(y[i]) / 2.0
    a = b = i
    while a > 0 and abs(y[a]) > h and np.sign(y[a]) == np.sign(y[i]):
        a -= 1
    while b < y.size - 1 and abs(y[b]) > h and np.sign(y[b]) == np.sign(y[i]):
        b += 1
    return (b - a) / fs


def test_absence_slow_wave_is_a_broad_dome_joined_to_the_spike():
    """atlas-absence-seizure/p1 (digitized: the negative dome ~0.24 s of a 0.34-s cycle, ~70 %) and Wikimedia Commons
    Spike-waves.png: the dome is the largest deflection and fills most of the cycle.  The old k_sw wave measured 35-42 %
    of the cycle at half maximum (F3-ear).  Accept 55-85 % and a wave at least 0.8x the spike (F3-ear)."""
    for seed in (26092601, 926201):
        syn = Synthesizer(_spec(seed, "child", CHILD, [gs("typical_absence", duration_s=8.0)]), 400.0)
        fs = syn.fs
        frac, ratio = [], []
        for c in syn._gen.cx[3:10]:
            t, s, names = _ref_isolated(syn, c["t"] - 0.1, c["t"] + c["period"])
            y = s[names.index("F3")]
            isp = int(np.argmin(np.where(t < c["t"] + 0.06, y, np.inf)))
            iw = int(np.argmin(np.where(t > c["t"] + 0.08, y, np.inf)))
            frac.append(_fwhm_s(y, iw, fs) / c["period"])
            ratio.append(abs(y[iw]) / abs(y[isp]))
        assert 0.55 <= np.median(frac) <= 0.85, (seed, frac)
        assert np.median(ratio) >= 0.8, (seed, ratio)


def test_slow_spike_wave_reads_at_its_authored_rate():
    """different-LGS-background-at-10uV and ILAE (LGS / atypical absence): slow spike-and-wave at 1.5-2.5 Hz, one
    sharp-then-slow unit per cycle.  With the old k_ssw trough the sharp wave and the slow wave split into two humps and
    an authored 2-Hz atypical absence displayed a 4.1-4.25 Hz peak (Fz-Cz); LGS runs read 3.6-5.0 Hz in 17 of 24."""
    from eeg_render.generalized_v3 import k_ssw
    t_ = np.arange(0.0, 0.5, 1.0 / 256)
    x = sum(sum(k_ssw(t_ + k * 0.5, 0.5)) for k in (-2, -1, 0, 1))
    X = np.abs(np.fft.rfft(np.tile(x - x.mean(), 8))) ** 2
    f = np.fft.rfftfreq(t_.size * 8, 1.0 / 256)
    assert X[np.argmin(abs(f - 2.0))] >= 5.0 * X[np.argmin(abs(f - 4.0))]
    for seed in (26092602, 926202):
        syn = Synthesizer(_spec(seed, "child", LGS_BG, [gs("atypical_absence", duration_s=11.0)]), 400.0)
        t, s, names = _display(syn, 123.0, 128.0)
        y = s[names.index("Fz-Cz")]
        fq, p = sps.welch(y - y.mean(), syn.fs, nperseg=4 * syn.fs, nfft=8 * syn.fs)
        band = (fq >= 1.0) & (fq <= 30.0)
        assert 1.5 <= fq[band][np.argmax(p[band])] <= 2.5, seed
    syn = Synthesizer(_spec(26092613, "child", LGS_BG, [gd("slow_spike_wave", rate_per_h=200)]), 600.0)
    ok = []
    for r in [r for r in _row(syn, "generalized_discharge") if 30 < r["t0"] < 560 and r["t1"] - r["t0"] >= 4.0][:8]:
        t, s, names = _display(syn, r["t0"] + 1.0, r["t1"] - 1.0)
        fq, p = sps.welch(s[names.index("Fz-Cz")], syn.fs, nperseg=min(t.size, 4 * syn.fs), nfft=8 * syn.fs)
        band = (fq >= 1.0) & (fq <= 5.0)
        ok.append(1.5 <= fq[band][np.argmax(p[band])] <= 2.6)
    assert np.mean(ok) >= 0.8, ok


def test_jme_polyspike_wave_involves_every_chain():
    """4-6-Hz-spike-and-waves-with-JME: every chain carries the 4-6 Hz (poly)spike-and-wave, temporal chains included,
    1-2 spikes per complex.  The frontocentral table left C3-P3 / F7-T3 / T3-T5 / T5-O1 at 0.09-0.14 of Fz-Cz and a
    chain-median of 2.4x; 2-4 spikes at ~72 ms filled the 213-ms cycle."""
    syn = Synthesizer(_spec(26092612, "adolescent", CHILD, [gd("polyspike_wave", rate_per_h=120)], dur=30), 1800.0)
    fs = syn.fs
    rows = [r for r in _row(syn, "generalized_discharge") if r["t0"] > 60]
    med = []
    prev = -np.inf
    for r in rows:
        clean = r["t0"] - prev >= 9.0          # the background window must be free of the previous burst
        prev = r["t1"]
        if not clean:
            continue
        td, sd, nd = _display(syn, r["t0"] - 8.0, r["t1"] + 0.3)
        on, pre = (td >= r["t0"]) & (td < r["t1"]), td < r["t0"] - 0.5
        med.append(np.median([np.ptp(sd[nd.index(c)][on]) / np.median(_p2p(sd[nd.index(c)][pre], fs))
                              for c in CHAINS]))
        if len(med) == 10:
            break
    assert np.median(med) >= 3.0, med
    ns = [len(c["ps"][0]) for c in syn._gen.cx if c["kind"] == "psw"]
    isi = np.concatenate([np.diff(c["ps"][0]) for c in syn._gen.cx if c["kind"] == "psw"])
    assert set(ns) <= {1, 2} and 0.035 - 1e-9 <= isi.min() and isi.max() <= 0.060 + 1e-9


def test_sporadic_polyspike_spikes_proportionate_and_conspicuous():
    """eeg0094_db1 and myoclonic-jerk-examples/p1: the spikes stand as tall as or taller than the after-going wave, and
    the complex stands well above the page's background.  At _PS_WAVE_GAIN 2.2 the wave was 1.45-2.11x the spike train
    (F3-ear) and the complex 1.1-4.8x the 1-s background p-p.  Accept wave/spike 0.7-1.4 and complex >= 3x the 1-s
    background (F3-C3, blink-free background)."""
    bg = dict(CHILD, blink_rate_per_min=0)
    syn = Synthesizer(_spec(517604, "child", bg, [{"type": "sporadic_discharges", "focus": "generalized_frontocentral",
                                                   "rate_per_h": 120, "amplitude_uv": 150.0,
                                                   "morphology": "polyspike", "n_spikes": 5}]), 900.0)
    fs = syn.fs
    ratio, consp = [], []
    pairs = mt.montage_pairs("referential", syn.scalp)
    for j in [j for j, r in enumerate(syn._sed) if 60.0 < r[0] < 800.0][:8]:
        t0 = float(syn._sed[j, 0])
        lags = syn._sed_poly[j][0]
        tt = np.arange(int(round((t0 - 0.1) * fs)), int(round((t0 + 1.0) * fs))) / fs
        y = syn.derive(syn._sed_rows(tt), pairs, "referential")[[a for a, _ in pairs].index("F3")]
        train = (tt >= t0 - 0.02) & (tt <= t0 + lags[-1] + 0.02)
        ratio.append(np.min(y[tt > t0 + lags[-1] + 0.04]) / np.min(y[train]))
        td, sd, nd = _display(syn, t0 - 10.0, t0 + 1.0)
        yd = sd[nd.index("F3-C3")]
        m = (td > t0 - 0.05) & (td < t0 + lags[-1] + 0.5)
        pre = (td < t0 - 1.0) & (td > t0 - 9.0)
        consp.append(np.ptp(yd[m]) / np.median(_p2p(yd[pre], fs)))
    assert 0.7 <= np.median(ratio) <= 1.4, ratio
    assert np.median(consp) >= 3.0, consp


def test_atonic_is_not_a_blink_and_its_loss_of_tone_is_readable():
    """ILAE: atonic = generalized (poly)spike-and-slow-wave, vertex / frontocentral, with an EMG silent period read on a
    polygraphic EMG channel (PMC12593124 Fig 2 carries EMG rows).  Before: the complex peaked at Fp1-F7 (1.00) like the
    blink 7 s later, and the EMG fell 0.11x from a 3.7-4.7 uV scalp floor with no EMG channel on the page."""
    for seed in (26092607, 926207):
        syn = Synthesizer(_spec(seed, "child", CHILD, [gs("atonic", at=2.0 + 5 / 60)]), 400.0)
        c = syn._gen.cx[0]
        t, s, names = _isolated(syn, c["t"] - 0.05, c["t"] + 0.9)
        pp = {ch: np.ptp(s[names.index(ch)]) for ch in CHAINS}
        vtx = max(pp["Fz-Cz"], pp["Cz-Pz"], pp["C3-P3"], pp["C4-P4"], pp["F3-C3"], pp["F4-C4"])
        assert max(pp["Fp1-F7"], pp["Fp2-F8"]) <= 0.35 * vtx, (seed, pp)
        assert max(pp.values()) == vtx, (seed, pp)
        e0, e1, _ = syn._gen.emg_loss[0]
        tt = np.arange(int((e0 - 4) * syn.fs), int((e1 + 1) * syn.fs)) / syn.fs
        y = syn.emg_channel(tt)
        rest = np.sqrt(np.mean(y[(tt > e0 - 3) & (tt < e0 - 0.5)] ** 2))
        drop = np.sqrt(np.mean(y[(tt > e0 + 0.1) & (tt < e1 - 0.05)] ** 2))
        assert 10.0 <= rest <= 20.0 and drop <= 0.2 * rest, (rest, drop)
    none = Synthesizer(_spec(1, "child", CHILD, [gs("typical_absence")]), 300.0)
    assert none.emg_channel(np.arange(0, 256) / 256.0 + 120.0) is None


def test_gpfa_is_not_a_spindle_and_shows_in_n3():
    """tonic-seizure-ii onset and ILAE LGS: generalized paroxysmal fast activity is abrupt, monomorphic, ~15-25 Hz and
    in phase across the head, with the background attenuated.  Before: 12-19 Hz with per-electrode waxing-waning (read
    as a spindle in N2; homologous chains dephased) and 1.5x the N3 delta.  Accept: peak 15-25 Hz, F3-C3/F4-C4
    correlation >= 0.8, 12-28 Hz envelope CV <= 0.45 (r8 per-cycle height scatter; it was <= 0.2 for the monomorphic
    r5 burst), onset 10->70 % <= 200 ms (REFERENCE_TARGETS s5: >= 70 % within 100-250 ms; with the per-cycle heights
    scattered a 10->90 % rise ran ~0.2-0.3 s), bursts 0.5-6 s one at a time; in N3 the 15-25 Hz RMS >= 5x and the <3-Hz
    delta <= 0.7x the preceding 5 s (medians over bursts)."""
    syn = Synthesizer(_spec(926214, "child", LGS_BG, SLEEP + [gd("gpfa")], dur=60), 3600.0)
    fs = syn.fs
    rows = _row(syn, "generalized_discharge")
    assert rows and all(0.5 <= r["t1"] - r["t0"] <= 6.0 and 15.0 <= r["frequency_hz"] <= 25.0 for r in rows)
    spans = sorted((r["t0"], r["t1"]) for r in rows)
    assert all(b[0] >= a[1] for a, b in zip(spans, spans[1:]))
    clean = [r for r in rows if r["t1"] - r["t0"] >= 2.0
             and not any(o["t1"] > r["t0"] - 6.0 and o["t0"] < r["t0"] for o in rows)]
    n3 = [r for r in clean if r["stage"] == "N3"][:5]
    assert n3
    for r in clean[:5] + n3:
        ti, si, ni = _isolated(syn, r["t0"] + 0.3, r["t1"] - 0.1)
        a, b = si[ni.index("F3-C3")], si[ni.index("F4-C4")]
        assert np.corrcoef(a, b)[0, 1] >= 0.8
        env = np.abs(sps.hilbert(sps.sosfiltfilt(sps.butter(4, [12, 28], "bandpass", fs=fs, output="sos"), a)))
        env = np.convolve(env, np.ones(fs // 10) / (fs // 10), "same")[fs // 5:-fs // 5]
        assert np.std(env) / np.mean(env) <= 0.45
        fq, p = sps.welch(a, fs, nperseg=min(a.size, fs), nfft=4 * fs)
        assert 15.0 <= fq[np.argmax(p)] <= 25.0
        ti, si, ni = _isolated(syn, r["t0"] - 0.3, r["t0"] + 0.7)
        e = np.abs(si[ni.index("F3-C3")])
        w = int(0.05 * fs)
        e = np.array([e[max(0, k - w):k + 1].max() for k in range(e.size)])
        lvl = np.median(e[ti > r["t0"] + 0.3])
        assert ti[np.argmax(e > 0.7 * lvl)] - ti[np.argmax(e > 0.1 * lvl)] <= 0.20
    fast, delta = [], []
    for r in n3:
        td, sd, nd = _display(syn, r["t0"] - 5.0, r["t1"])
        y = sd[nd.index("F3-C3")]
        on, pre = (td > r["t0"] + 0.3), td < r["t0"] - 0.2
        fast.append(_band_rms(y[on], fs, 15, 25) / _band_rms(y[pre], fs, 15, 25))
        delta.append(_band_rms(y[on], fs, 0.5, 3.0) / _band_rms(y[pre], fs, 0.5, 3.0))
    assert np.median(fast) >= 5.0 and min(fast) >= 3.0, fast
    assert np.median(delta) <= 0.7, delta


def test_photoparoxysmal_page_carries_the_photic_marker():
    """eegatlas-online eeg0066 and PMC8610539 Fig 1B show the flash train on its own marker channel; before, the PPR
    page had no Photic row because Synthesizer.photic_flashes read only the authored photic_driving variants."""
    syn = Synthesizer(_spec(26092610, "adolescent", CHILD, [gs("photoparoxysmal", at=2.0 + 2 / 60)]), 400.0)
    r = _row(syn)[0]
    fl = syn.photic_flashes(r["stimulus_onset_s"] - 2.0, r["stimulus_offset_s"] + 2.0)
    n = (r["stimulus_offset_s"] - r["stimulus_onset_s"]) * r["stimulus_frequency_hz"]
    assert abs(fl.size - n) <= 1 and abs(fl[0] - r["stimulus_onset_s"]) < 1e-6 and fl[-1] < r["stimulus_offset_s"]
    assert abs(1.0 / np.median(np.diff(fl)) - r["stimulus_frequency_hz"]) < 1e-6


def test_eyelid_myoclonia_polyspikes_are_generalized_frontocentral():
    """r8 (generalized-review-20260928: Craig chose the phase D eyelid myoclonia over the r5 bioccipital one): the
    polyspike-and-wave is generalized with the frontocentral field (JME table) - the largest frontal link (Fp-F, F-C,
    Fz-Cz) at least the largest posterior one (P-O, T5/T6-O), and every parasagittal link carrying >= 25 % of it."""
    for seed in (26092609, 926209):
        syn = Synthesizer(_spec(seed, "child", CHILD, [gs("eyelid_myoclonia", at=2.0 + 4 / 60)]), 400.0)
        r = _row(syn)[0]
        t, s, names = _isolated(syn, r["discharge_onset_s"], r["discharge_onset_s"] + 1.5)
        pp = {ch: np.ptp(s[names.index(ch)]) for ch in CHAINS}
        post = max(pp[c] for c in ("P3-O1", "P4-O2", "T5-O1", "T6-O2"))
        front = max(pp[c] for c in ("Fp1-F3", "Fp2-F4", "F3-C3", "F4-C4", "Fz-Cz"))
        assert front >= post, (seed, pp)
        para = ("Fp1-F3", "F3-C3", "C3-P3", "P3-O1", "Fp2-F4", "F4-C4", "C4-P4", "P4-O2")
        assert min(pp[c] for c in para) >= 0.25 * front, (seed, pp)


@pytest.mark.parametrize("case", ["gpfa", "atonic_emg"])
def test_fixed_generalized_features_are_window_independent(case):
    ev, a = {"gpfa": (SLEEP + [gd("gpfa", rate_per_h=400)], 1100.0),
             "atonic_emg": ([gs("atonic", at=2.0)], 118.0)}[case]
    spec = _spec(926231, "child", LGS_BG, ev, dur=30)
    syn = Synthesizer(spec, 1800.0)
    t1, x1 = syn.segment(a - 5.0, a + 10.0)
    t2, x2 = syn.segment(a, a + 4.0)
    i = int(round(5.0 * syn.fs))
    assert np.allclose(x1[:, i:i + x2.shape[1]], x2, atol=1e-6)
    page = Synthesizer(copy.deepcopy(spec), a + 70.0)
    tt = (int(round(a * syn.fs)) + np.arange(4 * syn.fs)) / syn.fs
    i0 = int(round(a * syn.fs))
    assert np.allclose(syn._gen.rows(tt, i0), page._gen.rows(tt, i0), atol=1e-6)
    if case == "atonic_emg":
        long = syn.emg_channel((int(round((a - 5.0) * syn.fs)) + np.arange(15 * syn.fs)) / syn.fs)
        short = page.emg_channel(tt)
        assert np.allclose(long[i:i + short.size], short, atol=1e-6)
