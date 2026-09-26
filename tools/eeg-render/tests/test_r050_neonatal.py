"""0.5.0 neonatal generator fixes (spec_version 3; feature review 2026-09-26, neonatal.md).

References (cached under research/eeg-atlas/references/cache/, internal comparison only):
  ACNS-2a/2c  Tsuchida et al. 2013, ACNS neonatal terminology, Figs. 2a (trace discontinu with brushes) and 2c
              (excessive discontinuity), and the text definitions (TA interburst 25-50 uV of mixed theta/delta,
              TA gone by 46 w, seizures 10 s-46 min with median 1 min and 75 % <= 2.5 min, status >= 50 %/h).
  LE-33wED    learningeeg 33-w excessive discontinuity (brushes riding the delta waves of the burst).
  LE-QS4d     learningeeg 4-day term quiet sleep (TA: IBI of mixed low-voltage theta/delta).
  LE-text     learningeeg.com/neonatal: longest acceptable IBI 20 s at 28-33 w, 10 s at 34-36 w, 6 s at 37-40 w;
              brush = 8-20 Hz fast activity riding the delta wave.
  S22         Castro Conde 2017: term day 3 and first six hours of life (max IBI 3.7 s / 5.75 s).
Candidates mirrored from research/eeg-atlas/p7/batch1_candidates.py, batch4_candidates.py and p5_candidates.py.
"""
from functools import lru_cache

import numpy as np
import pytest
from scipy import signal as sps

from eeg_render import montage as mt
from eeg_render.render_page import apply_filters, build_filters
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer


def _neo(seed, bg_type, amp, pma, **extra):
    bg = {"type": bg_type, "pma_weeks": pma, "amplitude_uv": amp, "dominant_hz": 2.0, "slow_fraction": 0.8,
          "reactivity": "present", "channel_gain_max": 1.5, "delta_brushes": "riding"}
    bg.update(extra)
    return bg


CASES = {
    "B1-01": (517101, _neo(517101, "continuous", 45.0, 40.0, state_cycle="term", hours_of_life=60.0), [], 60),
    "B1-04": (517102, _neo(517102, "continuous", 45.0, 40.0, state_cycle="term", hours_of_life=3.0), [], 60),
    "B1-06": (517103, _neo(517103, "discontinuous", 50.0, 40.0, dysmature_pma_weeks=34.0, state_cycle="term",
                           hours_of_life=60.0), [], 60),
    "B1-09": (517106, _neo(517106, "continuous", 45.0, 43.0, state_cycle="term", hours_of_life=200.0), [], 60),
    "B1-10": (517107, _neo(517107, "discontinuous", 50.0, 37.0, state_cycle="term", hours_of_life=60.0), [], 60),
    "C01": (515101, _neo(515101, "continuous", 45.0, 40.0), [], 30),
    "C06": (515202, _neo(515202, "excessively_discontinuous", 40.0, 39.0), [], 30),
    "C07": (515203, _neo(515203, "discontinuous", 40.0, 39.0, burst_suppression={"ibi_s": 6.0, "ibi_floor": 0.2}), [], 30),
    "C09": (515301, _neo(515301, "continuous", 40.0, 39.0), [], 30),
    "C33": (515299, _neo(515299, "discontinuous", 60.0, 32.0), [], 30),
}


def _cluster(onset_min, count, interval_s, dur, region):
    return {"type": "seizure_cluster", "start_min": onset_min, "end_min": onset_min + (count - 1) * interval_s / 60.0,
            "interval_min": interval_s / 60.0, "muscle": "none",
            "seizure": {"duration_s": dur, "onset_region": region, "spread": "none",
                        "evolution": {"start_hz": 3.0, "end_hz": 1.5, "amplitude_start_uv": 40, "amplitude_end_uv": 120}}}


CASES["B4-05"] = (517405, _neo(517405, "continuous", 40.0, 40.0), [_cluster(1.0, 35, 100.0, 60, "left_central")], 60)
CASES["B4-06"] = (517406, _neo(517406, "continuous", 40.0, 40.0), [_cluster(3.0, 12, 300.0, 60, "right_temporal")], 60)


def _image(cid, version=3):
    seed, bg, events, dur = CASES[cid]
    return {"kind": "qeeg_panel", "license": "synthetic-original", "attribution": None,
            "spec": {"sample_rate": 256, "channels": "standard_19", "seed": seed, "spec_version": version,
                     "age_group": "neonate", "duration_min": dur, "background": dict(bg), "events": list(events)}}


@lru_cache(maxsize=None)
def S(cid, version=3):
    spec = normalize(_image(cid, version))["spec"]
    return Synthesizer(spec, float(spec["duration_min"]) * 60.0)


def _display(syn, t0, t1, montage="neonatal_reduced"):
    """The page a reader sees: bipolar derivation through the causal 0.5-70 Hz neonatal chain (10 s warm-up)."""
    _, x = syn.segment(t0 - 10.0, t1)
    pairs = mt.montage_pairs(montage, syn.scalp)
    d = apply_filters(syn.derive(x, pairs, montage), build_filters(syn.fs, {"lf_hz": 0.5, "hf_hz": 70.0}, True), True)
    return d[:, int(10 * syn.fs):], [f"{a}-{b}" for a, b in pairs]


def _first_state(syn, state, after=300.0, minlen=40.0):
    for a, b, lab in syn._state_intervals:
        if lab == state and b > after and b - max(a, after) >= minlen:
            return max(a, after)
    raise AssertionError(f"no {state} interval")


def _sched_ibis(syn, state=None):
    st, en = syn._burst_start, syn._burst_end
    ibi = st[1:] - en[:-1]
    mid = 0.5 * (st[1:] + en[:-1])
    keep = (mid > 0) & (mid < syn.duration_s)
    if state is not None:
        keep &= syn.state_at(mid) == state
    return ibi[keep]


def _bands(d, fs):
    f, p = sps.welch(d, fs=fs, nperseg=int(4 * fs), axis=1)
    pp = 10 ** np.log10(np.maximum(p, 1e-12)).mean(0)          # the card's log-mean spectrum over derivations
    tot = pp[(f >= 0.5) & (f < 30)].sum()
    return {k: pp[(f >= a) & (f < b)].sum() / tot for k, (a, b) in
            {"delta": (0.5, 4), "theta": (4, 8), "alpha": (8, 13), "beta": (13, 30)}.items()}


# ---------------------------------------------------------------------------- delta brushes

def _brushes(syn, t0, t1):
    """Per brush inside [t0, t1]: displayed delta p-p (< 3 Hz) and fast p-p (8-25 Hz) in the longitudinal-bipolar
    derivation where the delta is largest, and the surrounding burst delta (1.4-s windows within 6 s, outside brushes)."""
    d, names = _display(syn, t0, t1, "longitudinal_bipolar")
    fs = syn.fs
    lo = sps.sosfiltfilt(sps.butter(4, 3.0, "lowpass", fs=fs, output="sos"), d, axis=1)
    hi = sps.sosfiltfilt(sps.butter(4, [8.0, 25.0], "bandpass", fs=fs, output="sos"), d, axis=1)
    ev = syn._ge_events["delta_brush"]
    tt = t0 + np.arange(d.shape[1]) / fs
    busy = np.zeros(tt.size, bool)
    for e in ev:
        busy |= (tt >= e[0] - 0.3) & (tt < e[0] + e[1] + 0.3)
    env = syn.burst_envelope(tt)
    out = []
    for e in ev:
        a, b = e[0], e[0] + e[1]
        if a < t0 + 1 or b > t1 - 1:
            continue
        m = (tt >= a) & (tt < b)
        k = int(np.argmax(lo[:, m].max(1) - lo[:, m].min(1)))
        delta = lo[k, m].max() - lo[k, m].min()
        idx = np.nonzero((tt > a - 6) & (tt < b + 6) & ~busy & (env > 0.9))[0]
        w = int(1.4 * fs)
        bg = [np.ptp(lo[k, idx[s:s + w]]) for s in range(0, idx.size - w, w // 2) if idx[s + w - 1] - idx[s] == w - 1]
        out.append((e[4], delta, np.ptp(hi[k, m]), np.median(bg) if bg else np.nan))
    return np.array(out)


@pytest.mark.parametrize("cid", ["B1-06", "C33"])
def test_brush_delta_wave_is_the_largest_wave_with_fast_riding_it(cid):
    """ACNS-2a, LE-33wED: the brush's delta wave is the largest wave of the burst and the 8-20 Hz fast activity
    rides on it at ~1/3-1/2 of its voltage.  0.4.x: delta 0.2 x the request, 0.82x the background, fast/delta 0.78."""
    syn = S(cid)
    t0 = _first_state(syn, "quiet_sleep") if syn._state_intervals else 300.0
    r = _brushes(syn, t0, t0 + 240.0)
    assert len(r) >= 10
    req, delta, fast, bg = r.T
    assert 0.6 <= np.median(delta / req) <= 1.25          # drawn at the requested amplitude on the display
    assert np.nanmedian(delta / bg) >= 1.8                # clearly larger than the surrounding delta
    assert 0.25 <= np.median(fast / delta) <= 0.55        # the fast rides the wave, it does not dominate it


def test_brush_field_reverses_at_the_temporal_electrode():
    """ACNS-2a: an occipito-temporal brush phase-reverses at T4 (Fp2-T4 against T4-O2).  0.4.x: O1/T3/T5 at
    1.0/0.85/0.8 cancelled in T3-O1.  Measured on the neonatal page: the delta in Fp-T and T-O has opposite sign
    and T-O keeps at least 40 % of Fp-T."""
    syn = S("C33")
    ev = syn._ge_events["delta_brush"]
    ev = ev[(ev[:, 0] > 310) & (ev[:, 0] < 600)]
    d, names = _display(syn, 300.0, 610.0)
    lo = sps.sosfiltfilt(sps.butter(4, 3.0, "lowpass", fs=syn.fs, output="sos"), d, axis=1)
    tt = 300.0 + np.arange(d.shape[1]) / syn.fs
    ratios = []
    for t0, dur, _, side, *_ in ev:
        fp, to = ("Fp1-T3", "T3-O1") if side < 0 else ("Fp2-T4", "T4-O2")
        m = (tt >= t0 + 0.3 * dur) & (tt < t0 + 0.7 * dur)        # the trough
        a, b = lo[names.index(fp), m].mean(), lo[names.index(to), m].mean()
        ratios.append(-b / a if abs(a) > 1e-6 else 0.0)
    ratios = np.array(ratios)
    assert np.mean(ratios > 0) >= 0.8
    assert np.median(ratios) >= 0.4


def test_dysmature_record_reads_the_dysmature_pma():
    """B1-06: stated 40 w with 34-w patterns.  The brush settings (dense brushing, occipito-temporal field) read the
    dysmature PMA, temporal alpha (a 33-w pattern with no delta wave) is gone at 34 w, and quiet sleep keeps the 34-w
    interburst floor instead of the term trace-alternant 0.42 (LE-text: TA from 34 w at the earliest)."""
    syn = S("B1-06")
    assert syn._pma_eff() == 34.0
    assert syn.bg["graphoelements"]["temporal_alpha"]["rate_per_min"] == 0.0
    ev = syn._ge_events["delta_brush"]
    rate = ((ev[:, 0] > 0) & (ev[:, 0] < syn.duration_s)).sum() / (syn.duration_s / 60.0)
    assert rate >= 4.0                                   # 34 w: most bursts carry more than one brush
    t = _first_state(syn, "quiet_sleep")
    assert syn._ibi_floor_at(np.array([t]))[0] == pytest.approx(0.20)


def test_brush_rows_are_window_independent():
    syn = S("C33")
    _, a = syn.segment(300.0, 340.0)
    _, b = syn.segment(312.0, 330.0)
    i0 = int(12.0 * syn.fs)
    assert np.allclose(a[:, i0:i0 + b.shape[1]], b, atol=1e-9)


# ---------------------------------------------------------------------------- interburst intervals

def test_first_hours_ibi_honours_the_published_maximum():
    """S22 first six hours: max IBI 5.75 s (0.4.x drew the maximum as the mean and stretched it: median 6.5, max 13.4)."""
    ibi = _sched_ibis(S("B1-04"), "quiet_sleep")
    assert ibi.size >= 20
    assert ibi.max() <= 5.75 and 2.5 <= np.median(ibi) <= 4.0


@pytest.mark.parametrize("cid", ["B1-01", "B1-10"])
def test_term_quiet_sleep_ibi_at_most_6_s(cid):
    """LE-text: 6 s is the longest acceptable IBI at 37-40 w (0.4.x: B1-01 max 8.0 s, B1-10 max 8.9 s)."""
    ibi = _sched_ibis(S(cid), "quiet_sleep")
    assert ibi.size >= 30
    assert ibi.max() <= 6.0
    assert 2.5 <= np.median(ibi) <= 5.0


def test_authored_ibi_is_not_stretched():
    """C07 asks for the 6-s term ceiling (ibi_s 6).  0.4.x stretched it to a 7.5-s median and 13.2-s maximum."""
    ibi = _sched_ibis(S("C07"))
    assert ibi.max() <= 6.0 and 4.0 <= np.median(ibi) <= 6.0


def test_excessively_discontinuous_does_not_inherit_the_normal_row():
    """ACNS-2c / LE-text: excessive discontinuity = IBI too long for the PMA with a near-flat interburst.  0.4.x C06
    got the normal 39-w row (IBI median 4.2 s, floor 0.44).  Displayed interburst voltage must stay under 25 uV."""
    syn = S("C06")
    ibi = _sched_ibis(syn)
    assert np.median(ibi) > 6.0 and np.percentile(ibi, 90) >= 10.0
    assert syn._ibi_floor0 <= 0.10
    d, _ = _display(syn, 300.0, 420.0)
    tt = 300.0 + np.arange(d.shape[1]) / syn.fs
    quiet = np.zeros(tt.size, bool)
    for a, b in zip(syn._burst_end[:-1], syn._burst_start[1:]):
        if b - a > 4.0:
            quiet |= (tt > a + 1.5) & (tt < b - 1.5)
    w = syn.fs
    pp = [np.ptp(d[:, i:i + w], axis=1).max() for i in range(0, d.shape[1] - w, w) if quiet[i:i + w].all()]
    assert len(pp) >= 10 and np.median(pp) < 25.0


def test_ibi_schedule_is_drawn_once():
    a = S("B1-04")
    spec = normalize(_image("B1-04"))["spec"]
    b = Synthesizer(spec, 1800.0)
    n = np.searchsorted(a._burst_start, 1500.0)
    assert np.array_equal(a._burst_start[:n], b._burst_start[:n])


# ---------------------------------------------------------------------------- state cycle and blinks

def test_post_term_quiet_sleep_is_continuous_slow_wave_sleep():
    """ACNS 2013: TA is minimal by 42 w and replaced by continuous 50-150 uV delta/theta by 46 w.  0.4.x: 43-w quiet
    sleep was day-3 TA (IBI median 4.1 s, floor 0.42).  Term day 3 keeps TA."""
    old, term = S("B1-09"), S("B1-01")
    ibi = _sched_ibis(old, "quiet_sleep")
    assert np.median(ibi) <= 1.5
    assert old._ibi_floor_at(np.array([_first_state(old, "quiet_sleep")]))[0] >= 0.6
    assert np.median(_sched_ibis(term, "quiet_sleep")) >= 2.5
    assert term._ibi_floor_at(np.array([_first_state(term, "quiet_sleep")]))[0] == pytest.approx(0.42)

    def p2p(state):
        t0 = _first_state(old, state)
        d, _ = _display(old, t0, t0 + 30.0)
        return np.median([np.ptp(d[:, i:i + old.fs], axis=1).mean() for i in range(0, d.shape[1] - old.fs, old.fs)])
    assert p2p("quiet_sleep") >= p2p("active_sleep")     # slow-wave sleep is the high-voltage state


def test_neonatal_blinks_only_while_awake():
    """Neonatal item 4: 15/min 160-uV blinks on TD, encephalopathy and seizure pages.  v3: none without a state
    cycle; with one, a low rate and only in the awake state."""
    assert S("C09").bg["blink_rate_per_min"] == 0.0 and S("C09")._blink_t.size == 0
    syn = S("B1-01")
    assert 0 < syn.bg["blink_rate_per_min"] <= 4.0
    bare = Synthesizer(normalize(_image("B1-01"))["spec"], syn.duration_s)
    bare._blink_t = np.empty(0)
    lab = syn.state_at(syn._blink_t)
    inside = (syn._blink_t > 20) & (syn._blink_t < syn.duration_s - 20)
    asleep = syn._blink_t[inside & (lab != "awake")][:5]
    awake = syn._blink_t[inside & (lab == "awake")][:5]
    assert asleep.size and awake.size
    for bt in asleep:
        assert np.allclose(syn.segment(bt - 1, bt + 1)[1], bare.segment(bt - 1, bt + 1)[1])
    fp = syn._idx["Fp1"]
    for bt in awake:
        diff = syn.segment(bt - 1, bt + 1)[1][fp] - bare.segment(bt - 1, bt + 1)[1][fp]
        assert np.ptp(diff) > 20.0
    assert S("C09", 2).bg["blink_rate_per_min"] == 15.0          # version 2 unchanged


# ---------------------------------------------------------------------------- background composition

@pytest.mark.parametrize("cid,state", [("C01", None), ("B1-01", "quiet_sleep"), ("C33", None)])
def test_background_is_not_pure_delta(cid, state):
    """Neonatal item 5: every 0.4.x card read rel delta 0.93-0.96 and rel alpha <= 0.01, while ACNS-2a/2b and
    LE-QS4d/LE-TA bursts are dense with theta and superimposed fast activity.  Displayed 0.5-30 Hz relative power:
    delta 0.70-0.88, theta >= 0.10, alpha + beta >= 0.015 (0.4.x: 0.009-0.019)."""
    syn = S(cid)
    t0 = _first_state(syn, state, minlen=60) if state else 300.0
    d, _ = _display(syn, t0, t0 + 60.0)
    b = _bands(d, syn.fs)
    assert 0.70 <= b["delta"] <= 0.88, b
    assert b["theta"] >= 0.10, b
    assert b["alpha"] + b["beta"] >= 0.015, b


def test_trace_alternant_interburst_is_mixed_theta_delta():
    """ACNS 2013: the TA interburst is 25-50 uV of mixed theta and delta, not a scaled copy of the burst: relative
    theta is higher in the interburst than in the bursts."""
    syn = S("B1-01")
    t0 = _first_state(syn, "quiet_sleep", minlen=120)
    d, _ = _display(syn, t0, t0 + 120.0)
    tt = t0 + np.arange(d.shape[1]) / syn.fs
    env = syn.burst_envelope(tt)
    th = sps.sosfiltfilt(sps.butter(4, [4.0, 8.0], "bandpass", fs=syn.fs, output="sos"), d, axis=1)
    de = sps.sosfiltfilt(sps.butter(4, [0.5, 4.0], "bandpass", fs=syn.fs, output="sos"), d, axis=1)
    ib, bu = env < 0.5, env > 0.95
    r_ib = (th[:, ib] ** 2).mean() / (de[:, ib] ** 2).mean()
    r_bu = (th[:, bu] ** 2).mean() / (de[:, bu] ** 2).mean()
    assert r_ib > 1.15 * r_bu


# ---------------------------------------------------------------------------- seizure clusters

def _cluster_stats(syn):
    z = [q for q in syn.seizures if q.kind == "seizure_cluster"]
    d = np.array([q.duration_s for q in z])
    g = np.diff([q.t0 for q in z])
    tt = np.arange(0.0, 3600.0, 0.25)
    cov = np.zeros(tt.size, bool)
    for q in z:
        cov |= (tt >= q.t0) & (tt < q.t0 + q.duration_s)
    return d, g, cov.mean(), z


@pytest.mark.parametrize("cid,burden", [("B4-05", (0.5, 0.75)), ("B4-06", (0.12, 0.35))])
def test_neonatal_seizure_clusters_vary(cid, burden):
    """ACNS 2013: neonatal seizures last 10 s to 46 min (median 1 min, 75 % <= 2.5 min); 0.4.x clusters were clones
    (duration CV 0.1, onset-gap CV 4-6 %).  The hourly burden stays on its side of the 50 % status line."""
    d, g, b, z = _cluster_stats(S(cid))
    assert d.min() >= 10.0 and d.max() <= 600.0
    assert d.std() / d.mean() >= 0.4 and d.max() / d.min() >= 3.0
    assert g.std() / g.mean() >= 0.2
    assert burden[0] <= b <= burden[1]
    hz = np.array([q.start_hz for q in z])
    assert hz.std() / hz.mean() >= 0.08
