"""0.5.0 phase B, epileptiform family (feature review 2026-09-26, research/eeg-atlas/feature-review-20260926/epileptiform.md).

Every measurement is taken on the longitudinal-bipolar display through the causal 1-70 Hz page chain.  Where a
morphology is timed, the discharge is isolated by passing only its own referential rows through the same derivation
and filters (the chain is linear, so this is exactly the part of the displayed trace that the discharge contributes);
conspicuity is always measured on the full display.  Reference figures are cached in research/eeg-atlas/references/.
"""
import numpy as np
import pytest
import scipy.signal as sps

from eeg_render import montage as mt
from eeg_render.render_page import apply_filters, build_filters
from eeg_render.rng import substream
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer

CHILD = dict(type="continuous", amplitude_uv=40.0, dominant_hz=9.0, slow_fraction=0.4, reactivity="present",
             channel_gain_max=1.5)
ADULT_SLOW = dict(type="continuous", amplitude_uv=30.0, dominant_hz=3.0, slow_fraction=0.8, reactivity="absent",
                  channel_gain_max=1.5, blink_rate_per_min=0)
ADULT_PDR = dict(type="continuous", amplitude_uv=30.0, dominant_hz=10.0, slow_fraction=0.25, reactivity="present",
                 channel_gain_max=1.5, pdr_gain=3.0)
FILT = {"lf_hz": 1.0, "hf_hz": 70.0, "notch_hz": 60.0}


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


def _p2p(y, w):
    return np.array([np.ptp(y[i:i + w]) for i in range(0, y.size - w, w)])


# ---------------------------------------------------------------- B5-04 polyspikes

def _rpp(pattern, hz, amp, run, region, periodic, **extra):
    e = {"type": "rhythmic_pattern", "pattern": pattern, "periodic": periodic, "frequency_hz": hz,
         "amplitude_uv": amp, "run_duration_s": run, "onset_min": 5.0, "duration_min": 3.0,
         "onset_region": region, "min_cycles": 6}
    e.update(extra)
    return e


def _sed(focus, rate_h, amp, morph="spike", **extra):
    e = {"type": "sporadic_discharges", "focus": focus, "rate_per_h": rate_h, "amplitude_uv": amp, "morphology": morph}
    e.update(extra)
    return e


def _isolated_sed(syn, t0, t1):
    t = np.arange(int(round((t0 - 6.0) * syn.fs)), int(round(t1 * syn.fs))) / syn.fs
    sig, names = _chain(syn, syn._sed_rows(t))
    keep = t >= t0
    return t[keep], sig[:, keep], names


def test_polyspike_spikes_are_discrete_and_cross_baseline():
    """B5-04 (Craig: "merged on a sharp wave").  eeg0094_db1.png (digitized F3-C3) and myoclonic-jerk-examples/p1.webp:
    3-8 spikes at 55-80 ms, each swinging through the baseline, then a slow wave; 2-4x the background.  The 0.4.x
    kernel measured valleys at +0.44/+0.55 of the peak (never crossing) and one 97-ms complex."""
    spec = _spec(517604, "child", CHILD, [_sed("C4", 90, 100.0, "polyspike")], dur=30)
    syn = Synthesizer(spec, 900.0)
    idx = [j for j, r in enumerate(syn._sed) if 60.0 < r[0] < 800.0][:6]
    assert len(idx) >= 4
    for j in idx:
        t0 = float(syn._sed[j, 0])
        lags = syn._sed_poly[j][0]
        assert 3 <= lags.size <= 8
        t, iso, names = _isolated_sed(syn, t0 - 1.0, t0 + 1.5)
        ch = max(("F4-C4", "C4-P4"), key=lambda c: np.ptp(iso[names.index(c)]))
        y = iso[names.index(ch)]
        i0 = np.searchsorted(t, t0)
        s = np.sign(y[i0 - 3:i0 + 4][np.argmax(np.abs(y[i0 - 3:i0 + 4]))])
        v = s * y
        pk_i = [i0 + int(round(c * syn.fs)) - 2 + int(np.argmax(v[i0 + int(round(c * syn.fs)) - 2:
                                                                    i0 + int(round(c * syn.fs)) + 3]))
                for c in lags]
        peaks = v[pk_i]
        isi_ms = np.diff(t[pk_i]) * 1000.0
        valleys = np.array([v[a:b].min() for a, b in zip(pk_i[:-1], pk_i[1:])])
        # phase D (epileptiform-v3.md change 1): irregular ISIs, lognormal 45-130 ms (+/- one sample), replacing the
        # near-equal 55-80 ms that read as a 16-Hz sine burst
        assert np.all((isi_ms >= 40.0) & (isi_ms <= 135.0)), isi_ms
        # phase D: the troughs are small (0.20-0.35) and the after-going wave starts under the last spikes, so a late
        # valley need not cross the baseline; every valley still falls to <= 0.35 of the peaks (discrete spikes, not one
        # notched sharp wave, which measured +0.44/+0.55)
        assert np.all(valleys <= 0.35 * peaks.mean()), (valleys, peaks)
        # conspicuity on the full display
        td, sig, names = _display(syn, t0 - 20.0, t0 + 10.0)
        yd = sig[names.index(ch)]
        m = (td > t0 - 0.05) & (td < t0 + lags[-1] + 0.05)
        assert np.ptp(yd[m]) >= 2.0 * np.median(_p2p(yd, int(0.15 * syn.fs))), ch


def test_polyspike_generalized_frontocentral_field():
    """Myoclonic / JME polyspike-and-wave (eeg0094_db1.png: largest in F3-C3, F4-C4, Fz-Cz, smaller Fp-F, temporal
    chains small; myoclonic-jerk-examples/p1.webp: bilateral frontal).  Ratios on the bipolar chain."""
    spec = _spec(517604, "child", CHILD, [_sed("generalized_frontocentral", 120, 150.0, "polyspike", n_spikes=6)],
                 dur=30)
    syn = Synthesizer(spec, 900.0)
    idx = [j for j, r in enumerate(syn._sed) if 60.0 < r[0] < 800.0][:5]
    acc = None
    for j in idx:
        t0 = float(syn._sed[j, 0])
        t, iso, names = _isolated_sed(syn, t0 - 0.5, t0 + 1.2)
        p = np.array([np.ptp(r) for r in iso])
        acc = p if acc is None else acc + p
    p = dict(zip(names, acc / len(idx)))
    for ch in ("F3-C3", "F4-C4", "Fz-Cz"):
        assert p[ch] >= 2.0 * max(p["T3-T5"], p["T4-T6"]), p
    assert 0.7 <= p["F3-C3"] / p["F4-C4"] <= 1.4
    assert p["Fp1-F3"] >= 0.5 * p["F3-C3"]
    assert p["F3-C3"] >= 1.5 * p["C3-P3"]


# ---------------------------------------------------------------- B5-01/02 sporadic amplitude and prevalence

def test_sporadic_amplitude_is_the_authored_value():
    """B5-01: a 90-uV request drew 61 uV (lognormal sigma 0.25), 1.4-2x background.  The references show spikes at
    2-4x background (another-right-temporal-spike-2.webp, BECTS-centrotemporal-spikes-4-bipolar.webp)."""
    spec = _spec(517601, "child", CHILD, [_sed("T3", 120, 90.0)], dur=60)
    syn = Synthesizer(spec, 3600.0)
    amps = np.array([e["amplitude_uv"] for e in syn.sporadic_events()])
    assert amps.min() >= 0.9 * 90.0 - 1e-9 and 0.95 <= np.median(amps) / 90.0 <= 1.1
    ratios = []
    for e in [e for e in syn.sporadic_events() if 120.0 < e["t0"] < 3400.0][:8]:
        td, sig, names = _display(syn, e["t0"] - 15.0, e["t0"] + 5.0)
        y = sig[names.index("F7-T3")]
        m = (td > e["t0"] - 0.05) & (td < e["t0"] + 0.1)
        ratios.append(np.ptp(y[m]) / np.median(_p2p(y, int(0.15 * syn.fs))))
    assert np.median(ratios) >= 2.0, ratios


def test_abundant_schedule_meets_acns_and_is_horizon_independent():
    """B5-02 (Craig: "one maybe 2" spikes on an abundant page).  ACNS 2021 abundant = >= 1 per 10 s: at 480/h no
    10-s stretch is empty, the realized hourly count is the authored one, and a 15-s page holds 2 on median.  The
    schedule must not depend on the synthesis horizon (a page renders with t0 + window + 60 s, the key with 3600 s)."""
    spec = _spec(517602, "child", CHILD, [_sed("T3", 480, 90.0)], dur=60)
    ev = Synthesizer(spec, 3600.0).sporadic_events()
    t = np.array([e["t0"] for e in ev])
    rec = t[(t >= 0.0) & (t < 3600.0)]
    assert abs(rec.size - 480) <= 5
    assert np.diff(t).max() <= 10.0 + 1e-9 and np.diff(t).min() >= 1.0 - 1e-9
    pages = np.array([np.sum((rec >= s) & (rec < s + 15.0)) for s in np.arange(0.0, 3585.0, 15.0)])
    assert np.median(pages) >= 2 and pages.min() >= 1
    short = np.array([e["t0"] for e in Synthesizer(spec, 420.0).sporadic_events()])
    assert np.allclose(short[short < 420.0], t[t < 420.0])


# ---------------------------------------------------------------- C25-C31 rhythmic / periodic patterns

def _phase_peaks(syn, inst, t):
    ph, u, amp, f = syn._ictal_phase(inst, t)
    k = np.floor(ph / (2 * np.pi))
    return t[np.flatnonzero((np.diff(k) > 0) & (amp[1:] > 0.5 * np.nanmax(amp))) + 1]


def _avg_lobe_fwhm_ms(t, y, times, fs, half_s=0.4, search_s=0.04):
    w = int(half_s * fs)
    segs = [y[i - w:i + w] for i in (np.round((times - t[0]) * fs).astype(int)) if w <= i < y.size - w]
    a = np.mean(segs, axis=0)
    a = a - np.median(a)
    lo, hi = w - int(search_s * fs), w + int(search_s * fs)
    j = lo + int(np.argmax(np.abs(a[lo:hi])))
    v = np.sign(a[j]) * a
    left = j
    while left > 0 and v[left] > v[j] / 2:
        left -= 1
    right = j
    while right < v.size - 1 and v[right] > v[j] / 2:
        right += 1
    return (right - left) / fs * 1000.0, float(a[j])


PD_CASES = {  # C25 LPD 1 Hz, C26 GPD 2 Hz, C27 LPD 0.5 Hz (p5_candidates.py)
    "C25": (515701, ADULT_SLOW, _rpp("LPD", 1.0, 120, 60, "left_temporal", True), "F7-T3"),
    "C26": (515702, dict(ADULT_SLOW, amplitude_uv=15.0, dominant_hz=2.0, slow_fraction=0.85, pdr_gain=0.0),
            _rpp("GPD", 2.0, 110, 60, "generalized", True), "Fz-Cz"),
    "C27": (515703, ADULT_SLOW, _rpp("LPD", 0.5, 120, 12, "left_temporal", True), "F7-T3"),
}


def test_periodic_discharge_width_is_rate_independent():
    """C26/C27: the cycle-fraction template measured sharp FWHM 138 / 69 / 34 ms at 0.5 / 1 / 2 Hz.  References:
    lpds-quiz-clean.webp sharp FWHM ~50 ms, PLEDs.webp narrow sharp with a long flat interval at 0.75 Hz, GPD figures
    80-200 ms main phases.  v3: one width at every rate, inside 45-100 ms."""
    fw = {}
    for cid, (seed, bg, ev, ch) in PD_CASES.items():
        syn = Synthesizer(_spec(seed, "adult", bg, [ev]), 900.0)
        vals = []
        for z in syn.rhythmic_patterns[:4]:
            t, sig, names = _display(syn, z.t0, z.t1)
            vals.append(_avg_lobe_fwhm_ms(t, sig[names.index(ch)], _phase_peaks(syn, z, t), syn.fs)[0])
        fw[cid] = float(np.median(vals))
    assert all(45.0 <= v <= 100.0 for v in fw.values()), fw
    assert max(fw.values()) / min(fw.values()) <= 1.3, fw


def test_rpp_runs_stay_inside_the_acns_band():
    """C27 (LPD at the 0.5-Hz floor: runs realized 0.39-0.46 Hz) and C31 (LRDA at the 4-Hz ceiling: page FFT 4.53 Hz,
    runs to 5.02 Hz).  The drift is now a fraction of the rate; every run keeps its realized rate inside 0.5-4 Hz."""
    seed, bg, ev, _ = PD_CASES["C27"]
    syn = Synthesizer(_spec(seed, "adult", bg, [ev]), 900.0)
    for z in syn.rhythmic_patterns:
        t = np.arange(z.t0, z.t1, 1.0 / syn.fs)
        pk = _phase_peaks(syn, z, t)
        assert (pk.size - 1) / (pk[-1] - pk[0]) >= 0.5, z
        _, _, amp, f = syn._ictal_phase(z, t)
        assert f[amp > 0].min() >= 0.5
    syn = Synthesizer(_spec(515803, "adult", ADULT_PDR, [_rpp("LRDA", 4.0, 60, 10, "left_temporal", False)]), 900.0)
    for z in syn.rhythmic_patterns:
        t, sig, names = _display(syn, z.t0 + 0.5, z.t1 - 0.5)
        y = sig[names.index("F7-T3")]
        n = 1 << 16
        spec_ = np.abs(np.fft.rfft((y - y.mean()) * np.hanning(y.size), n))
        fr = np.fft.rfftfreq(n, 1.0 / syn.fs)
        m = (fr > 0.3) & (fr < 8.0)
        assert fr[m][np.argmax(spec_[m])] <= 4.0, z
        _, _, amp, f = syn._ictal_phase(z, t)
        assert f[amp > 0].max() <= 4.0


def _crest_avg(syn, ch):
    segs = []
    for z in syn.rhythmic_patterns[:8]:
        t, sig, names = _display(syn, z.t0 + 1.0, z.t1 - 1.0)
        psi = substream(syn.seed, "szharm", z.index).uniform(0, 2 * np.pi, 4)
        ph, _, _, _ = syn._ictal_phase(z, t)
        c = (ph + psi[0] - 1.5 * np.pi) / (2 * np.pi)
        idx = np.flatnonzero(np.diff(np.floor(c)) > 0) + 1
        y = sig[names.index(ch)]
        w = int(0.3 * syn.fs)
        segs += [y[i - w:i + w] for i in idx if w <= i < y.size - w]
    return np.asarray(segs)


def test_lrda_plus_s_carries_sharp_transients():
    """C30: "+S" was never read, so LRDA+S rendered as plain LRDA.  grda-plus-s-clean.webp: sharply contoured
    transients on the delta crests.  Crest-locked average on F7-T3 / T3-T5: the +S crest is narrower and larger than
    the same pattern without the modifier."""
    ev = _rpp("LRDA", 1.5, 70, 20, "left_temporal", False, plus_modifier="+S")
    s_plus = Synthesizer(_spec(515802, "adult", ADULT_PDR, [ev]), 900.0)
    s_plain = Synthesizer(_spec(515802, "adult", ADULT_PDR, [dict(ev, plus_modifier=None)]), 900.0)
    assert s_plus.rhythmic_patterns[0].plus_sharp > 0 and s_plain.rhythmic_patterns[0].plus_sharp == 0
    for ch in ("F7-T3", "T3-T5"):
        a, b = _crest_avg(s_plus, ch), _crest_avg(s_plain, ch)
        t = np.arange(a.shape[1]) / s_plus.fs
        fa, pa = _avg_lobe_fwhm_ms(t, np.concatenate(a), np.array([0.3 + k * a.shape[1] / s_plus.fs
                                                                   for k in range(a.shape[0])]), s_plus.fs, 0.29, 0.08)
        fb, pb = _avg_lobe_fwhm_ms(t, np.concatenate(b), np.array([0.3 + k * b.shape[1] / s_plus.fs
                                                                   for k in range(b.shape[0])]), s_plus.fs, 0.29, 0.08)
        assert fa <= 110.0 and fa <= 0.85 * fb, (ch, fa, fb)
        assert abs(pa) >= 1.5 * abs(pb), (ch, pa, pb)


# ---------------------------------------------------------------- C32 polymorphic focal slowing

def test_polymorphic_focal_slowing_is_slower_not_just_attenuated():
    """C32: asymmetry.slowing_hz only moved a posterior stream to 6 Hz and attenuated the side (delta fraction F7-T3
    0.57 vs F8-T4 0.62).  tinc-left-temporal-slowing.webp / tinyc-Right-Temporal-Polymorphic-Delta-Slowing-1.webp:
    irregular 1-3 Hz delta of varying shape, higher on the affected side.  Affected/contralateral 1-4 Hz RMS 1.5-2.5,
    a lower mean frequency, and no dominant delta peak."""
    bg = dict(ADULT_PDR, asymmetry={"side": "left", "attenuation_pct": 30, "slowing_hz": 4.0})
    syn = Synthesizer(_spec(515804, "adult", bg, []), 600.0)
    t, sig, names = _display(syn, 240.0, 420.0)
    out = {}
    for ch in ("F7-T3", "T3-T5", "F8-T4", "T4-T6"):
        f, p = sps.welch(sig[names.index(ch)], syn.fs, nperseg=4 * syn.fs)
        d, tot = (f >= 1) & (f < 4), (f >= 1) & (f < 30)
        out[ch] = (np.sqrt(p[d].sum()), p[d].max() / p[d].mean(), float(np.sum(f[tot] * p[tot]) / p[tot].sum()))
    for left, right in (("F7-T3", "F8-T4"), ("T3-T5", "T4-T6")):
        assert 1.5 <= out[left][0] / out[right][0] <= 2.5, out
        assert out[left][2] <= out[right][2] - 1.5, out
        assert out[left][1] < 2.5, out


# ---------------------------------------------------------------- hypsarrhythmia and spasms

HYPS = dict(type="hypsarrhythmia")


def test_hypsarrhythmia_spikes_stand_above_the_background():
    """HYPS: the multifocal discharges were surface-positive LPD templates at 184 uV under a 263-uV background (0.7x).
    another-hypsarrhythmia-9mo-M-at-50uV.webp: spikes and polyspikes still stand above >300-uV slow waves.  The 100-ms
    peak-to-peak at the focus derivations is >= 2.5x the channel's median 100-ms peak-to-peak (v2: 1.36)."""
    syn = Synthesizer(_spec(926001, "infant", HYPS, [], dur=30), 300.0)
    t, sig, names = _display(syn, 120.0, 180.0)
    pairs = mt.montage_pairs("longitudinal_bipolar", syn.scalp)
    w = int(0.10 * syn.fs)
    mf = syn._mf_spikes
    sel = np.flatnonzero((mf[:, 0] > t[0] + 0.2) & (mf[:, 0] < t[-1] - 0.6))
    ratios, neg = [], []
    for j in sel:
        t0, fi = mf[j, 0], int(mf[j, 1])
        e = syn.electrodes[fi]
        i0 = int(round((t0 - t[0]) * syn.fs))
        for c, (a, b) in enumerate(pairs):
            if e in (a, b):
                ratios.append(np.ptp(sig[c][i0 - w // 2:i0 + w]) / np.median(_p2p(sig[c], w)))
        tt = t0 + np.arange(-0.05, 0.08, 1.0 / syn.fs)
        r = syn._multifocal_spike_rows(tt)[fi]
        neg.append(r[np.argmax(np.abs(r))] < 0)
    assert np.median(ratios) >= 2.5 and np.percentile(ratios, 25) >= 1.8, np.percentile(ratios, [25, 50])
    assert np.mean(neg) == 1.0
    poly = np.mean([p is not None for p in syn._mf_poly])
    assert 0.15 <= poly <= 0.45


def _spasm_page(seed, bg, ev, t0):
    syn = Synthesizer(_spec(seed, "infant", bg, [ev], dur=30), t0 + 75.0)
    t, sig, names = _display(syn, t0, t0 + 15.0)
    z = next(z for z in syn.seizures if z.kind == "spasm" and t[0] < z.t0 < t[-1] - 5)
    return syn, t, sig, names, z


def test_spasm_slow_wave_is_the_largest_bipolar_deflection_with_overriding_fast():
    """SPASM: the near-flat field left Cz-Pz at 59 uV against a 58-uV background, the fast activity was common-mode,
    and a 0.95 decrement drew a flat line.  infantile-spasm-craig-20260926.png (= learningeeg atlas-infantile-spasm-i):
    a diffuse slow wave that is the largest deflection on the page, largest in Cz-Pz, with ~18-20 Hz fast riding it
    (C3-P3, P3-O1); atlas-infantile-spasm-ii: attenuation with residual activity afterwards."""
    bg = dict(type="continuous", amplitude_uv=60.0, dominant_hz=6.0, slow_fraction=0.5)
    syn, t, sig, names, z = _spasm_page(926003, bg, {"type": "spasm", "onset_min": 2.1}, 120.0)
    fs = syn.fs
    m = (t > z.t0 - 0.1) & (t < z.t0 + z.duration_s + 0.2)
    sp = {n: np.ptp(r[m]) for n, r in zip(names, sig)}
    one = int(fs)
    starts = np.arange(0, sig.shape[1] - one, one)
    far = np.array([not (z.t0 - 1.0 < t[s] < z.t0 + 5.0) for s in starts])
    bg1 = np.array([[np.ptp(r[s:s + one]) for s in starts] for r in sig])[:, far]
    assert max(sp.values()) >= 1.1 * bg1.max() and max(sp.values()) >= 3.0 * np.median(bg1), (max(sp.values()), bg1.max())
    assert sp["Cz-Pz"] >= 0.6 * max(sp.values()), sp
    sos = sps.butter(4, [15, 30], btype="band", fs=fs, output="sos")
    pre = (t > z.t0 - 2.2) & (t < z.t0 - 0.2)
    on = (t > z.t0 + 0.1) & (t < z.t0 + z.duration_s)
    for ch in ("C3-P3", "P3-O1", "Cz-Pz"):
        y = sps.sosfiltfilt(sos, sig[names.index(ch)])
        assert np.std(y[on]) >= 2.0 * np.std(y[pre]), ch
    post = (t > z.t0 + z.duration_s + 0.3) & (t < z.t0 + z.duration_s + 2.8)
    ratio = np.median([np.std(s[post]) / np.std(s[pre]) for s in sig])
    assert 0.3 <= ratio <= 0.75, ratio


def test_spasm_on_hypsarrhythmia_towers_over_the_chaos():
    """atlas-infantile-spasm-ii: on a hypsarrhythmic background the spasm slow wave still dominates Cz-Pz."""
    ev = {"type": "spasm_cluster", "onset_min": 2.05, "interval_s": 12.0, "count": 6}
    syn, t, sig, names, z = _spasm_page(926002, HYPS, ev, 120.0)
    m = (t > z.t0 - 0.1) & (t < z.t0 + z.duration_s + 0.2)
    y = sig[names.index("Cz-Pz")]
    assert np.ptp(y[m]) >= 1.5 * np.median(_p2p(sig.ravel(), int(syn.fs)))


# ---------------------------------------------------------------- partition independence of the v3 features

@pytest.mark.parametrize("case", ["periodic", "polyspike", "spasm_hyps", "polydelta"])
def test_v3_epileptiform_features_are_window_independent(case):
    if case == "periodic":
        seed, bg, ev, _ = PD_CASES["C26"]
        spec, a = _spec(seed, "adult", bg, [ev]), 310.0
    elif case == "polyspike":
        spec, a = _spec(517604, "child", CHILD, [_sed("C4", 900, 100.0, "polyspike")], dur=30), 200.0
    elif case == "spasm_hyps":
        spec, a = _spec(926002, "infant", HYPS, [{"type": "spasm_cluster", "onset_min": 2.05, "interval_s": 12.0,
                                                   "count": 6}], dur=30), 125.0
    else:
        spec, a = _spec(515804, "adult", dict(ADULT_PDR, asymmetry={"side": "left", "attenuation_pct": 30,
                                                                    "slowing_hz": 4.0}), [], dur=30), 200.0
    syn = Synthesizer(spec, 600.0)
    t1, x1 = syn.segment(a - 5.0, a + 10.0)
    t2, x2 = syn.segment(a, a + 4.0)
    i = int(round(5.0 * syn.fs))
    assert np.allclose(x1[:, i:i + x2.shape[1]], x2, atol=1e-6)
