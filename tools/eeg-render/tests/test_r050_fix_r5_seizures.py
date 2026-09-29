"""0.5.0 r5 seizure fixes: the "still off / not done" items of generalized-fix.md, focal-fix.md and acns-fix.md
(research/eeg-atlas/feature-review-20260926/).  All behaviour is spec_version 3 only.

Measured on the displayed longitudinal-bipolar chain through the causal 1-70 Hz page filters (isolated generalized rows
where a morphology is timed).  Before/after numbers from renders/phaseB/fix-r5-seizures/ (indep.py, fx.py,
measure_fix.py, r5check.py) are in r5-seizures.md.
"""
import copy

import numpy as np
import pytest
import scipy.signal as sps

from eeg_render import montage as mt
from eeg_render.render_page import apply_filters, build_filters
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer

FS = 256
FILT = {"lf_hz": 1.0, "hf_hz": 70.0, "notch_hz": 60.0}
CHILD = dict(type="continuous", amplitude_uv=40.0, dominant_hz=9.0, slow_fraction=0.4, reactivity="present",
             channel_gain_max=1.5)
LGS_BG = dict(type="continuous", amplitude_uv=70.0, dominant_hz=4.0, slow_fraction=0.85, reactivity="present",
              channel_gain_max=1.5, pdr_gain=0.3)
INFANT = dict(type="continuous", amplitude_uv=60.0, dominant_hz=6.0, slow_fraction=0.5)
# focal cases as renders/phaseD/focal/phd.py (the focal family's measurement harness)
HYPS = dict(type="hypsarrhythmia", amplitude_uv=300.0, dominant_hz=1.5, slow_fraction=0.85,
            multifocal_spikes={"rate_per_s": 1.2, "amplitude_uv": 150.0})
FOCAL_CHILD = dict(type="continuous", amplitude_uv=45.0, dominant_hz=8.5, slow_fraction=0.35, reactivity="present",
                   channel_gain_max=1.4)
ICU = dict(type="continuous", amplitude_uv=30.0, dominant_hz=3.0, slow_fraction=0.8, reactivity="absent",
           channel_gain_max=1.5, blink_rate_per_min=0)


def _spec(seed, age, bg, events, version=3, dur=30, kind="qeeg_panel"):
    img = {"kind": kind, "license": "synthetic-original", "attribution": None,
           "spec": {"sample_rate": FS, "channels": "standard_19", "seed": seed, "spec_version": version,
                    "age_group": age, "duration_min": dur, "background": copy.deepcopy(bg),
                    "events": copy.deepcopy(events)}}
    return normalize(img)["spec"]


def _chain(syn, x):
    pairs = mt.montage_pairs("longitudinal_bipolar", syn.scalp)
    return (apply_filters(syn.derive(x, pairs), build_filters(syn.fs, FILT, True), True),
            [f"{a}-{b}" for a, b in pairs])


def _display(syn, t0, t1, pad=6.0):
    t, x = syn.segment(t0 - pad, t1)
    sig, names = _chain(syn, x)
    k = t >= t0
    return t[k], sig[:, k], names


def _isolated(syn, t0, t1, pad=3.0):
    i0 = int(round((t0 - pad) * syn.fs))
    t = (i0 + np.arange(int(round((t1 - t0 + pad) * syn.fs)))) / syn.fs
    sig, names = _chain(syn, syn._gen.rows(t, i0, extras=False) * syn._ch_gain[:, None])
    k = t >= t0
    return t[k], sig[:, k], names


def _bp(x, lo, hi, fs=FS):
    return sps.sosfiltfilt(sps.butter(4, [lo, hi], "band", fs=fs, output="sos"), x, axis=-1)


def _p2p(y, w=FS):
    return np.array([np.ptp(y[i:i + w]) for i in range(0, y.size - w + 1, w)])


def gs(st, at=2.0, **kw):
    return dict(type="generalized_seizure", seizure_type=st, onset_min=at, **kw)


# ------------------------------------------------------------------ generalized

@pytest.mark.parametrize("seed", [26092606, 926206])
def test_tonic_fast_activity_is_bisynchronous_and_monomorphic(seed):
    """atlas-tonic-seizure-i/-ii: a continuous, bisynchronous 10-25 Hz rhythm under one crescendo.  Before r5 the
    per-electrode AM and frequency/phase scatter made packets and dephased homologous chains (displayed 10-25 Hz
    F3-C3/F4-C4 correlation 0.14-0.21, detrended envelope CV 0.18-0.20).  r8 (generalized-review-20260928: "a little
    more frequency jitter") adds a whole-head frequency wander and a 0.18 common amplitude modulation, so the
    homologous chains stay in phase while the detrended envelope CV may rise to 0.30 (the r5 bound was 0.14)."""
    syn = Synthesizer(_spec(seed, "child", LGS_BG, [gs("tonic", at=2.05)]), 400.0)
    g = syn._gen.gpfa[0]
    t, s, n = _display(syn, g["t0"] + 1.0, g["t0"] + 6.0)
    a, b = _bp(s[n.index("F3-C3")], 10, 25), _bp(s[n.index("F4-C4")], 10, 25)
    assert np.corrcoef(a, b)[0, 1] >= 0.9
    env = np.abs(sps.hilbert(a))
    rel = env / sps.savgol_filter(env, 129, 1)
    assert np.std(rel) / np.mean(rel) <= 0.30


def test_myoclonic_tonic_fast_activity_is_bisynchronous():
    """Myoclonic-tonic inherits the tonic fix (generalized-independent: 'the same beaded look'); before r5 the tonic
    part's 12-25 Hz F3-C3/F4-C4 correlation was 0.04."""
    syn = Synthesizer(_spec(26092605, "child", CHILD, [gs("myoclonic_tonic", count=2, interval_s=6.0)]), 400.0)
    g = syn._gen.gpfa[0]
    t, s, n = _display(syn, g["t0"] + 0.3, g["t1"])
    assert np.corrcoef(_bp(s[n.index("F3-C3")], 12, 25), _bp(s[n.index("F4-C4")], 12, 25))[0, 1] >= 0.7


@pytest.mark.parametrize("seed", [26092603, 926203])
def test_myoclonic_spikes_as_tall_as_the_wave_and_the_field_declines_backwards(seed):
    """eeg0094_db1 and myoclonic-jerk-examples/p1: the spikes are as tall as or taller than the slow wave, and the field
    falls from front to back (eeg0094: P3-O1 about F3-C3 at most).  Before r5: wave/first spike 1.8-2.9 (F3-ear), and P3-O1 (0.37-0.42) above C3-P3 (0.14-0.20)."""
    syn = Synthesizer(_spec(seed, "adolescent", CHILD, [gs("myoclonic", count=3, interval_s=4.0)]), 400.0)
    pairs = mt.montage_pairs("referential", syn.scalp)
    names_r = [a if b is None else f"{a}-{b}" for a, b in pairs]
    f3 = [k for k, nm in enumerate(names_r) if nm.startswith("F3")][0]
    fields = []
    for c in syn._gen.cx:
        lags = c["ps"][0]
        # the reviewer's measure: isolated rows, F3 referential, unfiltered, most negative wave / most negative spike
        i0 = int(round((c["t"] - 0.1) * FS))
        tr = (i0 + np.arange(int(0.9 * FS))) / FS
        yr = syn.derive(syn._gen.rows(tr, i0, extras=False) * syn._ch_gain[:, None], pairs, "referential")[f3]
        sp = (tr >= c["t"] - 0.02) & (tr <= c["t"] + lags[-1] + 0.02)
        wr = yr[tr > c["t"] + lags[-1] + 0.04].min() / yr[sp].min()
        assert 0.8 <= wr <= 1.35, wr
        # on the display (bipolar F3-C3, 1-70 Hz) the wave stays a readable part of the complex
        t, s, n = _isolated(syn, c["t"] - 0.1, c["t"] + 0.8)
        y = s[n.index("F3-C3")]
        wv = (t >= c["t"] + lags[-1] + 0.03) & (t < c["t"] + lags[-1] + 0.4)
        assert np.abs(y[wv]).max() >= 0.4 * np.abs(y[(t >= c["t"] - 0.01) & (t < c["t"] + lags[-1] + 0.02)]).max()
        # (without the record's per-electrode gains, channel_gain_max 1.5, which on a gentle field move single links
        # by more than the field does)
        i1 = int(round((c["t"] - 3.1) * FS))
        tg = (i1 + np.arange(int(3.9 * FS))) / FS
        sg, ng = _chain(syn, syn._gen.rows(tg, i1, extras=False))
        lo = sps.sosfiltfilt(sps.butter(4, 8.0, fs=FS, output="sos"), sg[:, tg >= c["t"] - 0.1], axis=-1)
        t_lo = tg[tg >= c["t"] - 0.1]
        fields.append({ch: np.ptp(lo[ng.index(ch)][(t_lo >= c["t"] - 0.05) & (t_lo < c["t"] + 0.6)])
                       for ch in ("Fp1-F3", "F3-C3", "C3-P3", "P3-O1", "T5-O1", "T3-T5", "Fz-Cz")})
    # field of the complex (< 8 Hz: the 20-ms spikes' per-link size is set by the per-electrode timing scatter that
    # lets them survive the chain, not by the field), median over the complexes
    pp = {ch: np.median([f[ch] for f in fields]) for ch in fields[0]}
    assert pp["F3-C3"] >= pp["C3-P3"] >= pp["P3-O1"] >= pp["T5-O1"], pp
    assert max(pp["F3-C3"], pp["Fz-Cz"]) == max(pp.values()), pp


@pytest.mark.parametrize("seed", [26092609, 926209])
def test_eyelid_closure_is_a_large_transient(seed):
    """PMC8610539 Fig 1E/F and PMC12593124 Fig 2: the eye closure that provokes eyelid myoclonia is a large Fp
    deflection (blink-sized).  Before r5 it was +32/+35 uV on Fp1-F3, about 1x the background 1-s p-p."""
    syn = Synthesizer(_spec(seed, "child", CHILD, [gs("eyelid_myoclonia", at=2.0 + 4 / 60)]), 400.0)
    t0 = syn._gen.events()[0]["closure_s"]
    t, s, n = _display(syn, t0 - 5.0, t0 + 3.0)
    fp = s[n.index("Fp1-F3")]
    peak = fp[(t >= t0) & (t < t0 + 0.6)].max() - np.mean(fp[(t >= t0 - 1.0) & (t < t0)])
    assert peak >= 4.0 * np.median(_p2p(fp[t < t0 - 0.5]))                 # + = Fp1 positive = displayed DOWN
    tt = np.arange(-6 * FS, 2 * FS) / FS
    fld = syn._blink_field()
    blink = ((fld[syn._idx["Fp1"]] - fld[syn._idx["F3"]]) * syn._blink_profile(tt, np.array([0.0]))
             * float(syn.bg["blink_amplitude_uv"]))
    blink = apply_filters(blink[None, :], build_filters(FS, FILT, True), True)[0][tt >= -0.2].max()
    assert 0.8 <= peak / blink <= 1.6, (peak, blink)


@pytest.mark.parametrize("seed", [26092610, 926210])
def test_photoparoxysmal_response_is_generalized_spike_wave(seed):
    """r8 rebuild (generalized-review-20260928: Craig rejected the r5 irregular posterior train; REFERENCE_TARGETS s3,
    Waltz type 4): generalized 3-4 Hz spike-and-wave / polyspike-and-wave, frontal-to-occipital like spontaneous GSW,
    not locked to the 15-Hz flashes.  Accept: spike-wave complexes at 2.5-4.5 Hz with an interval CV 0.05-0.20, every
    parasagittal link carrying >= 35 % of the largest link, a frontal link (Fp-F, F-C, Fz-Cz) within 0.6x of it (the
    accepted typical-absence field, whose steepest link is C3-P3), and the complexes' flash phases spread over the
    flash cycle (circular resultant < 0.4)."""
    syn = Synthesizer(_spec(seed, "adolescent", CHILD, [gs("photoparoxysmal", at=2.0 + 2 / 60)]), 400.0)
    r = syn._gen.events()[0]
    cx = syn._gen.cx
    assert all(c["kind"] == "sw" and c["field"] == "gen" for c in cx)
    iv = np.diff([c["t"] for c in cx])
    assert 2.5 <= 1.0 / np.median(iv) <= 4.5
    assert 0.05 <= np.std(iv) / np.mean(iv) <= 0.20
    t, s, n = _isolated(syn, r["t0"] + 0.5, r["t1"])
    pp = {ch: np.ptp(s[n.index(ch)]) for ch in n}
    top = max(pp.values())
    para = ("Fp1-F3", "F3-C3", "C3-P3", "P3-O1", "Fp2-F4", "F4-C4", "C4-P4", "P4-O2")
    assert min(pp[c] for c in para) >= 0.35 * top, pp
    assert max(pp[c] for c in ("Fp1-F3", "Fp2-F4", "F3-C3", "F4-C4", "Fz-Cz")) >= 0.6 * top, pp
    ph = np.mod((np.array([c["t"] for c in cx]) - r["stimulus_onset_s"]) * r["stimulus_frequency_hz"], 1.0)
    assert abs(np.mean(np.exp(2j * np.pi * ph))) < 0.4


# ------------------------------------------------------------------ focal: spasm and occipital

def _spasm_syn(bg, seed, events, strip=False):
    return Synthesizer(_spec(seed, "infant", bg, [] if strip else events, dur=5, kind="eeg_page"), 300.0)


def _spasm_parts(bg, seed, events, n=4):
    a, b = _spasm_syn(bg, seed, events), _spasm_syn(bg, seed, events, strip=True)
    out = []
    for z in sorted([q for q in a.seizures if q.kind == "spasm"], key=lambda q: q.t0)[:n]:
        ta, A, names = _display(a, z.t0 - 3.0, z.t0 + 6.0)
        _, B, _ = _display(b, z.t0 - 3.0, z.t0 + 6.0)
        out.append((z, ta - z.t0, A, A - B, names))
    return out


def test_spasm_emg_is_not_the_largest_thing_on_hypsarrhythmia():
    """focal-independent (infantile-spasm-craig-20260926, S1): the striking element is the slow wave with overriding
    cerebral fast activity; the temporalis burst is separate and later.  On hypsarrhythmia the burst scaled with the
    55-uV background RMS: 584-960 uV p-p, 0.83-1.80x the spasm slow wave in F7-T3/F8-T4 before r5 (0.47-0.74 on a
    normal infant page)."""
    ev = [dict(type="spasm_cluster", onset_min=2.05, interval_s=10.0, count=8)]
    ratios = []
    for z, tt, A, I, names in _spasm_parts(HYPS, 926002, ev):
        for c in ("F7-T3", "F8-T4"):
            k = names.index(c)
            emg = np.ptp(_bp(A[k], 35, 70)[(tt >= 0.8) & (tt < 3.5)])
            slow = np.ptp(_bp(I[k], 0.3, 4.0)[(tt >= -0.2) & (tt < 1.5)])
            ratios.append(emg / slow)
    assert np.median(ratios) <= 0.7 and max(ratios) <= 0.9, np.round(ratios, 2)
    assert min(ratios) >= 0.2, np.round(ratios, 2)          # still a visible burst (infantile-spasm-ii)


def test_spasm_emg_cap_leaves_normal_infant_pages_alone():
    """The cap acts only above a 20-uV background RMS (a normal infant page is 10-12 uV)."""
    syn = _spasm_syn(INFANT, 926003, [dict(type="spasm", onset_min=2.1)])
    assert syn.amp_rms < syn._SPASM_EMG_RMS_CAP


def test_spasm_riding_fast_activity_is_irregular():
    """S1 (infantile-spasm-craig-20260926): the overriding fast activity comes in irregular bursts.  Before r5 the two
    steady sines gave a half-period CV of 0.07-0.16 and a successive-peak change of 0.11-0.21 on a normal-background
    cluster (Cz-Pz / F3-C3 / C3-P3, 0.2-0.8 x the spasm duration)."""
    ev = [dict(type="spasm_cluster", onset_min=2.0, interval_s=9.0, count=8)]
    hp_cv, pk_ch = [], []
    for z, tt, A, I, names in _spasm_parts(INFANT, 926004, ev):
        for c in ("Cz-Pz", "F3-C3", "C3-P3"):
            fw = _bp(I[names.index(c)], 14, 30)[(tt >= 0.2 * z.duration_s) & (tt < 0.8 * z.duration_s)]
            zc = np.nonzero(np.diff(np.signbit(fw)))[0]
            hp = np.diff(zc)
            hp_cv.append(np.std(hp) / np.mean(hp))
            pk = np.array([np.abs(fw[a:b]).max() for a, b in zip(zc[:-1], zc[1:])])
            pk_ch.append(np.mean(np.abs(np.diff(pk))) / np.mean(pk))
    assert np.mean(hp_cv) >= 0.14 and np.mean(pk_ch) >= 0.18, (np.round(hp_cv, 2), np.round(pk_ch, 2))


OCC = dict(type="seizure", onset_min=5.0, duration_s=50.0, onset_region="left_occipital", spread="none",
           evolution=dict(start_hz=8.0, end_hz=3.0, amplitude_start_uv=50, amplitude_end_uv=150))


def test_occipital_run_is_largest_in_p3o1_and_t5o1():
    """learningeeg o1-onset-seizure-bipolar p1/p2: the rhythm is in P3-O1 and T5-O1.  Before r5 C3-P3 carried the
    largest bipolar/background ratio from 4 s (2.2-3.4x) and a larger p-p than P3-O1 from 6 s (74-101 vs 54-68 uV)."""
    a = Synthesizer(_spec(926104, "child", FOCAL_CHILD, [OCC], dur=12, kind="eeg_page"), 720.0)
    b = Synthesizer(_spec(926104, "child", FOCAL_CHILD, [], dur=12, kind="eeg_page"), 720.0)
    z = a.seizures[0]
    _, A, n = _display(a, z.t0, z.t0 + 14.0)
    _, B, _ = _display(b, z.t0, z.t0 + 14.0)
    I = A - B
    for w0 in range(0, 14, 2):
        seg = slice(w0 * FS, (w0 + 2) * FS)
        pp = {c: np.median(np.ptp(I[n.index(c), seg].reshape(-1, FS), axis=1)) for c in n}
        top2 = sorted(pp, key=pp.get)[-2:]
        assert set(top2) == {"P3-O1", "T5-O1"}, (w0, {c: round(pp[c]) for c in top2})
        assert pp["C3-P3"] <= 0.8 * pp["P3-O1"], (w0, pp["C3-P3"], pp["P3-O1"])
        if w0 < 12:          # the ratio table of fx.py onset (0-12 s); by 12-14 s all three are ~2x
            ratio = {c: np.std(I[n.index(c), seg]) / np.std(B[n.index(c), seg]) for c in ("C3-P3", "P3-O1", "T5-O1")}
            assert ratio["C3-P3"] < max(ratio["P3-O1"], ratio["T5-O1"]), (w0, ratio)


# ------------------------------------------------------------------ ACNS: LRDA+F

def _rpp(**extra):
    e = dict(type="rhythmic_pattern", pattern="LRDA", frequency_hz=1.5, amplitude_uv=80, onset_region="left_temporal",
             periodic=False, onset_min=1.0, duration_min=12.0, run_duration_s=30.0)
    e.update(extra)
    return e


def test_lrda_plus_f_delta_carries_the_requested_voltage():
    """ACNS 2021: the voltage of RDA+F is the delta's; the fast activity rides on it.  Before r5 the +F delta (< 5 Hz,
    T3-T5) was 0.84x the plain LRDA's and the pattern measured 1.94x background (acns-fix.md, measure_fix.py); plain
    LRDA 2.36x."""
    lp = sps.butter(4, 5.0, fs=FS, output="sos")

    def delta(ev):
        s = Synthesizer(_spec(771203, "adult", ICU, [ev]), 900.0)
        b = Synthesizer(_spec(771203, "adult", ICU, []), 900.0)
        out, xbg = [], []
        for r in s.rhythmic_patterns[:3]:
            _, A, n = _display(s, r.t0 + 2.0, r.t1 - 1.0)
            _, B, _ = _display(b, r.t0 + 2.0, r.t1 - 1.0)
            k = n.index("T3-T5")
            out.append(np.median(_p2p(sps.sosfiltfilt(lp, A[k] - B[k]))))
            xbg.append(np.median(_p2p(A[k] - B[k])) / np.median(_p2p(B[k])))
        return np.median(out), np.median(xbg)
    d_plain, x_plain = delta(_rpp())
    d_f, x_f = delta(_rpp(plus_modifier="+F"))
    assert 0.9 <= d_f / d_plain <= 1.15, (d_f, d_plain)
    assert x_f >= 2.3, x_f


# ------------------------------------------------------------------ window independence

@pytest.mark.parametrize("case", ["tonic", "eyelid", "ppr", "spasm", "occipital"])
def test_r5_features_are_window_independent(case):
    if case == "spasm":
        spec = _spec(926004, "infant", HYPS, [dict(type="spasm_cluster", onset_min=2.0, interval_s=9.0, count=4)], dur=5,
                     kind="eeg_page")
        a = 120.0
    elif case == "occipital":
        spec = _spec(926104, "child", FOCAL_CHILD, [dict(OCC, onset_min=2.0)], dur=6, kind="eeg_page")
        a = 128.0
    else:
        ev = {"tonic": gs("tonic", at=2.05), "eyelid": gs("eyelid_myoclonia", at=2.0),
              "ppr": gs("photoparoxysmal", at=2.0)}[case]
        spec = _spec(926232, "child", LGS_BG if case == "tonic" else CHILD, [ev], dur=6, kind="eeg_page")
        a = 120.0 if case != "tonic" else 124.0
    syn = Synthesizer(spec, 360.0)
    _, x1 = syn.segment(a - 5.0, a + 10.0)
    _, x2 = syn.segment(a, a + 4.0)
    i = int(round(5.0 * syn.fs))
    assert np.allclose(x1[:, i:i + x2.shape[1]], x2, atol=1e-6)
    # a page synthesizer (short horizon) draws the same events (whole segments differ by the horizon's display
    # calibration, so the event rows are compared)
    page = Synthesizer(copy.deepcopy(spec), a + 70.0)
    i0 = int(round(a * syn.fs))
    tt = (i0 + np.arange(4 * syn.fs)) / syn.fs
    if syn._gen is not None:
        assert np.allclose(syn._gen.rows(tt, i0), page._gen.rows(tt, i0), atol=1e-6)
    else:
        assert np.allclose(syn._seizure_block(tt), page._seizure_block(tt), atol=1e-6)
