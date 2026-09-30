"""r9 (0.5.1 -> 0.5.2) ACNS rhythmic / periodic fixes (research/eeg-atlas/gallery-20260929/ISSUES.json).

Same measurement as tests/test_r050_fix_acns.py: longitudinal bipolar (or referential) through the causal 1-70 Hz page
chain; a pattern's own contribution is the record minus the same record without it.
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
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer

FS = 256
FILT = {"lf_hz": 1.0, "hf_hz": 70.0}
ICU = dict(type="continuous", amplitude_uv=20.0, dominant_hz=3.0, slow_fraction=0.8, reactivity="absent",
           channel_gain_max=1.5, blink_rate_per_min=0)


def _img(events, bg=ICU, age="child", version=3, seed=29264001, dur=30):
    return {"kind": "qeeg_panel", "license": "synthetic-original", "attribution": None,
            "spec": {"sample_rate": FS, "channels": "standard_19", "seed": seed, "spec_version": version,
                     "age_group": age, "duration_min": dur, "background": dict(bg), "events": events}}


def _syn(events, horizon=1200.0, **kw):
    return Synthesizer(normalize(_img(copy.deepcopy(events), **kw))["spec"], horizon)


def _rpp(pattern, hz, amp, region, periodic, **extra):
    e = dict(type="rhythmic_pattern", pattern=pattern, frequency_hz=hz, amplitude_uv=amp, onset_region=region,
             periodic=periodic, onset_min=2.0, duration_min=18.0, prevalence="continuous")
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


CASES = {
    "spiky": ([_rpp("LPDs", 1.0, 100, "left_temporal", True, sharpness="spiky")], {}),
    "spiky2": ([_rpp("LPDs", 1.0, 100, "left_temporal", True, sharpness="spiky")], dict(seed=518101)),
    "blunt": ([_rpp("LPDs", 1.0, 100, "left_temporal", True, sharpness="blunt")], {}),
    "blunt2": ([_rpp("LPDs", 1.0, 100, "left_temporal", True, sharpness="blunt")], dict(seed=518101)),
    "grda_f": ([_rpp("GRDA", 2.0, 100, "generalized", False, predominance="frontal")], {}),
    "grda_o": ([_rpp("GRDA", 3.0, 100, "generalized", False, predominance="occipital")], {}),
    "grda_o2": ([_rpp("GRDA", 3.0, 100, "generalized", False, predominance="occipital")], dict(seed=5150)),
    "lrda": ([_rpp("LRDA", 1.5, 100, "left_temporal", False)], dict(seed=29264013)),
    "lrda_f": ([_rpp("LRDA", 1.5, 100, "left_temporal", False, plus_modifier="+F")], dict(seed=29264013)),
}


@lru_cache(maxsize=None)
def _case(key):
    ev, kw = CASES[key]
    return _syn(ev, **kw), _syn([], **kw)


@lru_cache(maxsize=None)
def _pattern(key, t0=600.0, t1=630.0, ref=False):
    a, b = _case(key)
    (A, names), (B, _) = _disp(a, t0, t1, ref), _disp(b, t0, t1, ref)
    return A - B, B, A, names


# ----------------------------------------------------------------------------------------------- realized rate

@pytest.mark.parametrize("ev", [
    _rpp("LPDs", 1.0, 100, "left_temporal", True, sharpness="sharp"),                 # continuous single run (v3)
    _rpp("LPDs", 1.0, 100, "left_temporal", True, prevalence=None, run_duration_s=30.0),  # phase-B path
    _rpp("LPDs", 1.0, 100, "left_temporal", True, sharpness="sharp", prevalence="frequent", run_duration_s=30.0),
    _rpp("GPDs", 2.5, 100, "generalized", True, sharpness="sharp", prevalence="abundant", run_duration_s=30.0),
    _rpp("LRDA", 1.5, 80, "left_temporal", False, prevalence=None, run_duration_s=30.0),
])
@pytest.mark.parametrize("seed", [29264001, 29264009, 771203])
def test_realized_rate_matches_the_request(ev, seed):
    """gallery-20260929 global: realized LPD rates 0.75-0.9 Hz for 1.0 authored (rate_jitter 0.10 drawn once for a
    continuous run; at a rate ON an ACNS cutoff every upward draw was folded down).  The duration-weighted mean rate
    of the runs is within 5 % of frequency_hz; a single continuous run keeps it exactly."""
    ev = {k: v for k, v in ev.items() if v is not None}
    s = _syn([ev], horizon=1800.0, seed=seed)
    runs = s.rhythmic_patterns
    f = np.array([0.5 * (z.start_hz + z.end_hz) for z in runs])
    d = np.array([z.duration_s for z in runs])
    mean = float(np.sum(f * d) / np.sum(d))
    assert abs(mean / ev["frequency_hz"] - 1.0) <= 0.05, (mean, len(runs))
    if len(runs) == 1:
        assert mean == pytest.approx(ev["frequency_hz"])


@pytest.mark.parametrize("pattern,extra", [("BIPDs", dict(sharpness="sharp")), ("BIPDs", dict(prevalence=None))])
def test_bipd_clocks_stay_distinct_and_near_the_request(pattern, extra):
    """keep_rate_side folded the 1.12x side of 1.0-Hz BIPDs onto 0.88x, so both "independent" clocks ran at 0.88 Hz.
    Now the pair is shifted into the authored bin: the sides differ by >= 2 % (8 % before jitter) and average within 7 % of 1.0 Hz (both
    must stay <= 1.0 Hz, so the pair cannot centre on it)."""
    ev = _rpp(pattern, 1.0, 100, "left_temporal", True, run_duration_s=30.0, **extra)
    ev = {k: v for k, v in ev.items() if v is not None}
    s = _syn([ev], horizon=1800.0)
    side = {}
    for z in s.rhythmic_patterns:
        side.setdefault(z.onset_region, []).append(0.5 * (z.start_hz + z.end_hz))
    m = {k: float(np.mean(v)) for k, v in side.items()}
    assert len(m) == 2
    lo, hi = sorted(m.values())
    assert hi / lo >= 1.02 and hi <= 1.0 + 1e-9
    assert abs(0.5 * (lo + hi) - 1.0) <= 0.07


def test_pair_muls_keep_spacing_inside_the_bin():
    assert rpp_v3.pair_muls(1.0, (0.96, 1.04)) == pytest.approx((0.92, 1.0))
    assert rpp_v3.pair_muls(1.5, (0.96, 1.04)) == pytest.approx((0.96, 1.04))
    lo, hi = rpp_v3.pair_muls(1.02, (0.96, 1.04))
    assert 1.02 * lo > 1.0 and 1.02 * (hi - lo) == pytest.approx(0.08 * 1.02)


# --------------------------------------------------------------------------------------- GRDA predominance

@pytest.mark.parametrize("key,chains", [("grda_f", ("Fp1-F7", "Fp2-F8", "Fp1-F3", "Fp2-F4")),
                                        ("grda_o", ("T5-O1", "T6-O2", "P3-O1", "P4-O2")),
                                        ("grda_o2", ("T5-O1", "T6-O2", "P3-O1", "P4-O2"))])
def test_grda_predominance_survives_the_bipolar_chain(key, chains):
    """gallery-20260929 acn-grda-frontal (largest frontocentral) / acn-grda-occipital (read centroparietal): the four
    Fp-F (P-O / T-O) links carry the largest GRDA, at least 1.5x any other link, and amplitude_uv is the p-p there."""
    pat, _, _, names = _pattern(key)
    pp = np.median(_sec_ptp(pat), -1)
    top = [pp[names.index(c)] for c in chains]
    rest = [pp[i] for i, n in enumerate(names) if n not in chains]
    assert min(top) >= 1.5 * max(rest), (dict(zip(names, np.round(pp))))
    assert 0.85 * 100 <= max(top) <= 1.2 * 100, max(top)


def test_grda_referential_maximum_is_at_the_predominant_pole():
    pat, _, _, names = _pattern("grda_f", ref=True)
    pp = np.median(_sec_ptp(pat), -1)
    assert {names[i] for i in np.argsort(-pp)[:2]} == {"Fp1", "Fp2"}
    pat, _, _, names = _pattern("grda_o", ref=True)
    pp = np.median(_sec_ptp(pat), -1)
    assert {names[i] for i in np.argsort(-pp)[:2]} == {"O1", "O2"}


# ------------------------------------------------------------------------------------------- spiky / blunt

def _avg_discharge(key, chan="T3-T5", half=0.45):
    pat, _, _, names = _pattern(key)
    y = pat[names.index(chan)]
    pk, _ = sps.find_peaks(np.abs(y), height=0.5 * np.abs(y).max(), distance=int(0.6 * FS))
    w = int(half * FS)
    return np.mean([y[p - w:p + w] for p in pk if w <= p < y.size - w], axis=0), y, pk


@pytest.mark.parametrize("key", ["spiky", "spiky2"])
def test_spiky_lpds_are_one_spike_with_an_after_going_slow_wave(key):
    """gallery-20260929 acn-lpds-spiky: needle doublets / triplets with little after-going slow wave.  One discharge per
    cycle (no second sharp peak within 150 ms of the main one at half its height), dominant phase < 70 ms at the
    baseline, and a slow wave 150-350 ms after the spike (< 6 Hz) at >= 0.3x the spike's p-p."""
    avg, y, pk = _avg_discharge(key)
    pat, _, _, names = _pattern(key)
    y = pat[names.index("T3-T5")]
    hp = sps.sosfiltfilt(sps.butter(4, 12.0, btype="high", fs=FS, output="sos"), y)
    pk, _ = sps.find_peaks(np.abs(hp), height=0.2 * np.abs(hp).max(), distance=int(0.5 * FS))
    assert 0.9 <= pk.size / 30.0 <= 1.1, pk.size
    doublets, w = 0, int(0.15 * FS)
    for p in pk:
        if p < w or p + w > hp.size:
            continue
        seg = np.sign(hp[p]) * hp[p - w:p + w]        # same-polarity sharp peaks around the main one
        sub, _ = sps.find_peaks(seg, height=0.5 * seg[w], distance=int(0.01 * FS))
        doublets += int(np.any(np.abs(sub - w) > int(0.03 * FS)))
    assert doublets <= 0.2 * pk.size, (doublets, pk.size)
    c = avg.size // 2
    slow = sps.sosfiltfilt(sps.butter(4, 6.0, fs=FS, output="sos"), avg)
    wave = slow[c + int(0.15 * FS):c + int(0.35 * FS)]
    assert np.abs(wave - slow[:int(0.1 * FS)].mean()).max() >= 0.3 * np.ptp(avg[c - int(0.05 * FS):c + int(0.05 * FS)])


@pytest.mark.parametrize("key", ["blunt", "blunt2"])
def test_blunt_lpds_keep_an_interdischarge_interval(key):
    """gallery-20260929 acn-lpds-blunt: at 1 Hz the blunt complex filled the cycle and read as LRDA.  The complex (above
    15 % of its peak) lasts < 0.5 s, and at least 40 % of each cycle is near-flat (< 15 % of the peak)."""
    avg, _, _ = _avg_discharge(key, "F7-T3", half=0.5)
    v = np.abs(avg - np.median(avg[:int(0.08 * FS)]))
    on = np.flatnonzero(v > 0.15 * v.max())
    assert (on[-1] - on[0]) / FS < 0.5, (on[-1] - on[0]) / FS
    assert np.mean(v < 0.15 * v.max()) >= 0.4


@pytest.mark.parametrize("key", ["spiky", "blunt", "spiky2", "blunt2"])
def test_spiky_and_blunt_deliver_their_amplitude(key):
    """spiky and blunt delivered 0.79x / 0.72x on the max bipolar link (LAT_BIPOLAR_GAIN is the sharp kernel's)."""
    pat, bg, _, names = _pattern(key)
    pp = np.median(_sec_ptp(pat), -1)
    assert 0.85 * 100 <= pp.max() <= 1.2 * 100, pp.max()
    j = int(np.argmax(pp))
    assert pp[j] / np.median(_sec_ptp(bg[j])) >= 3.0


# ------------------------------------------------------------------------------------------------------ LRDA+F

def test_lrda_plus_f_fast_activity_runs_through_the_delta():
    """gallery-20260929 acn-lrda-plus-f: the +F fast activity clustered per delta wave (EDB-like): fast_carrier's
    0.91 / 1.0 / 1.13x partials beat at 1.2-1.7 Hz, the LRDA's own rate.  The fast envelope (8-25 Hz) is flat across the
    delta phase (max / min of 12 phase bins < 1.1) and present in every second."""
    s, _ = _case("lrda_f")
    q, _ = _case("lrda")
    A, names = _disp(s, 600.0, 640.0)
    Q, _ = _disp(q, 600.0, 640.0)
    i = names.index("T3-T5")
    fast = sps.sosfiltfilt(sps.butter(4, [8.0, 25.0], btype="band", fs=FS, output="sos"), (A - Q)[i])
    env = np.abs(sps.hilbert(fast))
    delta = sps.sosfiltfilt(sps.butter(2, [0.8, 3.0], btype="band", fs=FS, output="sos"), Q[i])
    ph = np.angle(sps.hilbert(delta))
    idx = np.digitize(ph, np.linspace(-np.pi, np.pi, 13))
    prof = np.array([env[idx == k].mean() for k in range(1, 13)])
    assert prof.max() / prof.min() < 1.1, prof
    sec = env[: (env.size // FS) * FS].reshape(-1, FS).mean(1)
    assert sec.min() >= 0.4 * np.median(sec)


def test_fast_run_is_a_pure_function_of_absolute_time():
    t = np.arange(0.0, 20.0, 1.0 / FS)
    a = rpp_v3.fast_run(t, 13.0, 7, 2)
    b = np.concatenate([rpp_v3.fast_run(t[:1000], 13.0, 7, 2), rpp_v3.fast_run(t[1000:], 13.0, 7, 2)])
    assert np.array_equal(a, b)
    assert 0.35 <= a.std() <= 0.47


# ----------------------------------------------------------------------------------------- background voltage

def test_icu_background_voltage_follows_amplitude_uv():
    """gallery-20260929 acn-lpds-left-temporal: "background amplitude_uv 35 -> 20 changed little".  It does scale: the
    display calibration is one scalar (1.29 on this record, far from its 0.25-4 clip), so the displayed background
    tracks amplitude_uv; the patterns keep their own authored voltage."""
    med = {}
    for a in (35.0, 20.0):
        b = _syn([], bg=dict(ICU, amplitude_uv=a))
        B, _ = _disp(b, 600.0, 630.0)
        med[a] = float(np.median(_sec_ptp(B)))
    assert med[20.0] / med[35.0] == pytest.approx(20.0 / 35.0, rel=0.05)
    assert 0.9 * 20.0 <= med[20.0] <= 1.35 * 20.0


# ---------------------------------------------------------------------------------------- status epilepticus

SE = dict(type="status_epilepticus", onset_min=2.0, duration_min=20.0, onset_region="left_hemisphere", spread="none")


@lru_cache(maxsize=None)
def _se(version=3):
    return _syn([SE], horizon=1800.0, version=version, seed=29265008, dur=30,
                bg=dict(type="continuous", dominant_hz=4.0, amplitude_uv=60.0, slow_fraction=0.65, reactivity="present"))


def test_status_epilepticus_waxes_wanes_and_fluctuates():
    """gallery-20260929 trd-ese-trends: one perfectly rhythmic harmonic stack gliding 2.5 -> 1.6 Hz, no waxing / waning.
    Around the glide the instantaneous rate wanders (SD of the 30-s means about the log glide >= 5 %), the run voltage
    varies (CV of the 30-s means >= 10 %), and neighbouring cycles differ in voltage."""
    s = _se()
    z = s.ictal[0]
    t = np.arange(z.t0 + 30.0, z.t1 - 60.0, 1.0 / 32.0)
    _, u, amp, f = s._ictal_phase(z, t)
    glide = z.start_hz * (z.end_hz / z.start_hz) ** u
    n = (t.size // 960) * 960
    fr = (f[:n] / glide[:n]).reshape(-1, 960).mean(1)
    am = amp[:n].reshape(-1, 960).mean(1)
    assert np.std(np.log(fr)) >= 0.05, np.std(np.log(fr))
    assert np.std(am) / np.mean(am) >= 0.10
    assert abs(np.mean(fr) - 1.0) <= 0.08


def test_status_epilepticus_ends_gradually():
    """... and an abrupt stop: over the last 20-300 s (8 % of the run) the rate slows and the voltage breaks up and
    fades, so the final 30 s carries well under half the mid-run voltage but the run does not stop within 2 s."""
    s = _se()
    z = s.ictal[0]
    t = np.arange(z.t0, z.t1, 1.0 / 32.0)
    _, u, amp, f = s._ictal_phase(z, t)
    mid = np.median(amp[(t > z.t0 + 60.0) & (t < z.t1 - 150.0)])
    last = amp[t > z.t1 - 30.0].mean()
    before = amp[(t > z.t1 - 90.0) & (t < z.t1 - 60.0)].mean()
    assert last < 0.4 * mid and before > last and before > 0.15 * mid
    tail = min(max(0.08 * z.duration_s, 20.0), 300.0)
    pre = np.mean(f[(t > z.t1 - tail - 30.0) & (t < z.t1 - tail)])
    assert np.mean(f[t > z.t1 - 20.0]) < 0.9 * pre


def test_status_epilepticus_is_window_independent():
    s = _se()
    z = s.ictal[0]
    a = s._ictal_phase(z, np.arange(z.t0 + 300.0, z.t0 + 310.0, 1.0 / FS))
    b = s._ictal_phase(z, np.arange(z.t0 + 305.0, z.t0 + 310.0, 1.0 / FS))
    k = 5 * FS
    for x, y in zip(a, b):
        assert np.allclose(x[k:], y, rtol=0, atol=1e-9)


def test_status_epilepticus_below_v3_is_unchanged():
    s = _se(version=2)
    z = s.ictal[0]
    t = np.arange(z.t0 + 30.0, z.t1 - 30.0, 1.0)
    _, u, amp, f = s._ictal_phase(z, t)
    # v2: the 0.3.x log glide with its sub-second wander only
    glide = z.start_hz * (z.end_hz / z.start_hz) ** u
    assert np.max(np.abs(f / glide - 1.0)) < 0.25
    fr = (f / glide)[: (f.size // 30) * 30].reshape(-1, 30).mean(1)
    assert np.std(np.log(fr)) < 0.02                  # no minute-scale wander below v3
