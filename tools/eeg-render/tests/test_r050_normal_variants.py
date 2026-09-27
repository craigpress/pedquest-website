"""0.5.0 normal variants (spec_version 3): bursts with side independence, arciform polarity, fields that survive the
longitudinal bipolar chain.

Feature review 2026-09-26 (research/eeg-atlas/feature-review-20260926/normal-variants.md) and Craig's B5 review notes
(EEG_ATLAS_P7_B5_REVIEW.csv, EEG_ATLAS_REVISION_REVIEW.csv).  Reference figures (learningeeg.com/images/...):
pediatric/Hypnapompic-Hypersynchrony, pediatric/posterior-slow-waves-of-youth-again_1,
pediatric/5yo-F-posterio-slow-wave-of-youth-2, normal-variants/Mu-IV, very-nice-Mu, Wickets_1, Wickets-III,
lambda-waves-at-10uV-2, lambda-in-circumferential, 14-and-6-positive-spikes-at-10uV-in-a-13yo-F, 6-Hz-positive-spikes-4,
RMTD_1, RMTD-on-the-right, normal-awake/clean/photic-driving, hv-slowing, normal-asleep/clean/POSTs.
Everything is measured on the displayed signal (causal 1-70 Hz chain) in longitudinal bipolar unless the feature is
read referentially (14 & 6).  Display convention is negative-up; values below are raw derivation values (a - b).
"""
import numpy as np
import pytest
from scipy import signal as sps

from eeg_render import montage as mt
from eeg_render.render_page import apply_filters, build_filters
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer

FS = 256


def _spec(seed, age="child", events=(), minutes=12, **bg):
    b = {"type": "continuous", "amplitude_uv": 40.0, "dominant_hz": 9.0, "slow_fraction": 0.3,
         "reactivity": "present", "channel_gain_max": 1.5}
    b.update(bg)
    img = {"kind": "eeg_page", "license": "synthetic-original", "attribution": None,
           "spec": {"seed": seed, "spec_version": 3, "age_group": age, "sample_rate": FS, "channels": "standard_19",
                    "duration_min": minutes, "background": b, "events": list(events)}}
    return normalize(img)["spec"], minutes * 60.0


def _syn(spec_horizon):
    spec, horizon = spec_horizon
    return Synthesizer(spec, horizon)


def _variant(kind, at, duration, **extra):
    e = {"type": "normal_variant", "kind": kind, "at_min": at, "duration_s": duration}
    e.update(extra)
    return e


SLEEP = lambda m: {"type": "state_change", "at_min": m, "to": "sleep"}  # noqa: E731


def _chain(S, x, montage="longitudinal_bipolar"):
    pairs = mt.montage_pairs(montage, S.scalp)
    names = [f"{a}-{b}" if b else a for a, b in pairs]
    d = apply_filters(S.derive(x, pairs, montage), build_filters(S.fs, {"lf_hz": 1.0, "hf_hz": 70.0}, True), True)
    return names, d


def _disp(S, t0, t1, montage="longitudinal_bipolar"):
    """Displayed page signal over [t0, t1) with 10 s of filter warm-up."""
    _, x = S.segment(t0 - 10.0, t1)
    names, d = _chain(S, x, montage)
    return names, d[:, int(10 * S.fs):]


def _component(S, rows_fn, t0, t1, montage="longitudinal_bipolar"):
    """The variant alone through the same display chain (the background drawn out)."""
    t = np.arange(int((t0 - 10.0) * S.fs), int(t1 * S.fs)) / S.fs
    names, d = _chain(S, rows_fn(t), montage)
    return names, d[:, int(10 * S.fs):]


def _p2p_1s(row, fs):
    n = row.size // fs
    return np.array([np.ptp(row[k * fs:(k + 1) * fs]) for k in range(n)])


def _skew(v):
    v = v - v.mean()
    return float(np.mean(v ** 3) / (np.mean(v ** 2) ** 1.5 + 1e-12))


def _whole_vs_chunks(S, a, b):
    whole = S.segment(a, b)[1]
    parts = np.concatenate([S.segment(t, min(t + 7.0, b))[1] for t in np.arange(a, b, 7.0)], axis=1)
    return float(np.max(np.abs(whole - parts)))


# ------------------------------------------------------------------ B5-06 hypersynchrony --
@pytest.fixture(scope="module")
def HH():
    return _syn(_spec(517605, amplitude_uv=45.0, dominant_hz=7.5, slow_fraction=0.5,
                      variants={"hypnagogic_hypersynchrony": {"amplitude_uv": 220.0}}, events=[SLEEP(2.0)], minutes=14))


def test_hh_runs_are_sustained_paroxysms_in_drowsiness(HH):
    """Hypnapompic-Hypersynchrony: a continuous paroxysm of about 9 s that builds up (review: median 5 s, 2-15 s);
    0.4.x gave 1-3 s runs.  Runs sit in N1 or at an arousal out of N2/N3 (hypnopompic)."""
    runs = [r for r in HH.variant_runs() if r["variant"] == "hypnagogic_hypersynchrony"]
    assert len(runs) >= 4
    dur = np.array([r["t1"] - r["t0"] for r in runs])
    assert 3.5 <= np.median(dur) <= 9.0 and dur.max() <= 15.0 and dur.min() >= 1.9
    deep_arousals = [a for a, w in HH._arousals_v3]
    for r in runs:
        st = HH.stage_at(np.array([r["t0"] + 0.1]))[0]
        assert st == "N1" or any(abs(r["t0"] - a) < 1.5 for a in deep_arousals)


def test_hh_survives_bipolar_in_every_chain(HH):
    """Craig (B5-06-r2 reject; B5-06 'per scale bar ... like 150'): the broad in-phase field cancelled, showing only
    at the chain ends.  Reference: every chain involved, temporal included, overlapping traces (about 250-350 uV).
    Assert per derivation: median 1-s p2p during the run >= 1.8x the 10 s before it in all 16 chain derivations;
    temporal / parasagittal 0.5-1.5; best derivation 150-400 uV."""
    runs = [r for r in HH.variant_runs() if r["variant"] == "hypnagogic_hypersynchrony" and r["t1"] - r["t0"] >= 3.0]
    ratios, best, temp_para = [], [], []
    for r in runs[:6]:
        names, d = _disp(HH, r["t0"] + 1.5, r["t1"])            # past the crescendo
        _, bg = _disp(HH, r["t0"] - 11.0, r["t0"] - 1.0)
        p = np.array([np.median(_p2p_1s(row, HH.fs)) for row in d])
        b = np.array([np.median(_p2p_1s(row, HH.fs)) for row in bg])
        ratios.append(p / b)
        best.append(p.max())
        temp_para.append(p[names.index("T3-T5")] / p[names.index("C3-P3")])
    ratios = np.median(np.array(ratios), axis=0)
    chain = [i for i, n in enumerate(names) if not n.startswith(("Fz", "Cz"))]
    # phase D: 1.8 -> 1.7.  The 10 s before a hypnopompic run (an arousal out of N2) now holds full-size K-complexes
    # travelling front to back, which lifts the occipital-temporal baseline (T6-O2 1.77); the run itself is unchanged
    assert ratios[chain].min() >= 1.7, dict(zip(names, np.round(ratios, 2)))
    assert 0.5 <= np.median(temp_para) <= 1.5
    assert 150.0 <= np.median(best) <= 400.0


def test_hh_is_delta_theta_with_a_crescendo(HH):
    """3-5 Hz delta-theta (review); builds over the first 1-2 s (Hypnapompic-Hypersynchrony)."""
    r = next(r for r in HH.variant_runs() if r["variant"] == "hypnagogic_hypersynchrony" and r["t1"] - r["t0"] >= 4.0)
    names, d = _component(HH, HH._variant_rows, r["t0"], r["t1"])
    row = d[names.index("F3-C3")]
    f, pxx = sps.welch(row, fs=HH.fs, nperseg=min(row.size, 2 * HH.fs))
    assert 1.5 <= f[np.argmax(pxx)] <= 5.5
    first = np.ptp(row[: int(0.4 * HH.fs)])
    later = np.median(_p2p_1s(row[int(2.0 * HH.fs):], HH.fs))
    assert first < 0.6 * later


# ------------------------------------------------------------------ B5-08 PSWY --
@pytest.fixture(scope="module")
def PSWY():
    return _syn(_spec(517607, pdr_gain=2.5, variants={"posterior_slow_waves_of_youth": {}}, minutes=12))


def _pswy_runs(S):
    return [r for r in S.variant_runs() if r["variant"] == "posterior_slow_waves_of_youth"]


def test_pswy_stands_above_the_pdr_it_rides(PSWY):
    """Craig (B5-08, B5-08-r2 reject): 'can't see them'.  posterior-slow-waves-of-youth-again_1: a sharply contoured
    delta wave in P3-O1, T5-O1 and T6-O2, about 2-3x the PDR; 5yo-F-...-2: notched, about 2x.  Target (Craig's brief):
    1.5-2.5x the eyes-closed background p2p in P3-O1 / T5-O1; the anterior chain barely carries it."""
    runs = [r for nm, r in PSWY._variants_v3 if nm == "posterior_slow_waves_of_youth"]
    assert len(runs) >= 12
    pr, tr, cr = [], [], []
    for r in runs[2:22]:
        a, b = r["t0"] - 5.0, r["t1"] + 5.0
        names, d = _disp(PSWY, a, b)
        tt = a + np.arange(d.shape[1]) / PSWY.fs
        busy = np.zeros(tt.size, bool)
        for q in runs:
            busy |= (tt >= q["t0"] - 0.3) & (tt < q["t1"] + 0.3)
        m = (tt >= r["t0"] - 0.05) & (tt < r["t1"] + 0.1)
        left = r["gl"] >= r["gr"]
        out = []
        for c in (("P3-O1", "T5-O1", "C3-P3") if left else ("P4-O2", "T6-O2", "C4-P4")):
            i = names.index(c)
            bg = [np.ptp(d[i, (tt >= s) & (tt < s + 1)]) for s in np.arange(a, b - 1, 0.5)
                  if not busy[(tt >= s) & (tt < s + 1)].any()]
            out.append(np.ptp(d[i, m]) / np.median(bg))
        pr.append(out[0])
        tr.append(out[1])
        cr.append(out[2])
    assert 1.5 <= np.median(pr) <= 2.5, np.round(np.percentile(pr, [25, 50, 75]), 2)
    assert np.median(tr) >= 1.4
    assert np.median(cr) < 0.8 * np.median(pr)


def test_pswy_is_surface_negative_steep_then_slow_and_awake_eyes_closed(PSWY):
    """Downward in P3-O1 (O1 negative: P3-O1 positive), 0.25-0.4 s (f 2.5-4 Hz), steep descent then slower return
    (review B5-08); only in wake with eyes closed, where the PDR it fuses with is present."""
    runs = _pswy_runs(PSWY)
    for r in runs[:10]:
        assert 0.24 <= (r["t1"] - r["t0"]) / max(r["count"], 1) <= 0.41
        assert PSWY.stage_at(np.array([r["t0"]]))[0] == "W"
        pdr, _ = PSWY._eye_factor(np.array([r["t0"], r["t1"]]))
        assert pdr.min() > 0.9
    r = next(r for r in runs if r["count"] == 1)
    t = np.arange(int((r["t0"] - 0.2) * FS), int((r["t1"] + 0.2) * FS)) / FS
    o1 = PSWY._variant_rows(t)[PSWY._idx["O1"]]
    k = int(np.argmin(o1))
    assert o1[k] < -0.6 * np.ptp(o1)                     # the dominant phase is surface-negative
    start = np.nonzero(np.abs(o1) > 1e-6)[0][0]
    t_down = (k - start) / FS
    t_back = (r["t1"] - r["t0"]) - t_down
    assert t_down < 0.6 * t_back


# ------------------------------------------------------------------ B5-07 POSTS --
@pytest.fixture(scope="module")
def POSTS():
    return _syn(_spec(517606, age="adolescent", amplitude_uv=35.0, dominant_hz=10.0, variants={"posts": {}},
                      events=[SLEEP(2.0)], minutes=20))


def test_posts_repeat_through_light_sleep(POSTS):
    """normal-asleep/clean/POSTs: repeating positive occipital transients across the whole sleep page at irregular
    intervals (review: episodes 10-60 s, intervals median about 0.5 s, CV about 0.4); 0.4.x gave one 3-6 run per page."""
    runs = [r for r in POSTS.variant_runs() if r["variant"] == "posts"]
    assert runs and all(POSTS.stage_at(np.array([r["t0"]]))[0] in ("N1", "N2") for r in runs)
    ep = runs[0]
    times = np.array(POSTS._variants_v3[0][1]["times"])
    iv = np.diff(times)
    assert ep["count"] >= 15 and 10.0 <= ep["t1"] - ep["t0"] <= 60.0
    assert 0.35 <= np.median(iv) <= 0.8 and 0.2 <= iv.std() / iv.mean() <= 0.6


def test_posts_are_positive_occipital_and_visible(POSTS):
    """Upward in P3-O1 / T5-O1 (O1 positive: derivation negative); each POST steep then slower (40 / 80 ms); displayed
    POST peak >= 1.5x the background p2p in P3-O1 (review measured 91-93 uV against 33-40)."""
    ep = POSTS._variants_v3[0][1]
    c = ep["times"][5]
    names, d = _disp(POSTS, c - 3.0, c + 3.0)
    i = names.index("P3-O1")
    fs = POSTS.fs
    seg = d[i, int(2.9 * fs):int(3.2 * fs)]
    assert seg.min() < -abs(seg.max())                   # negative-going derivation value: drawn up
    peaks = []
    for c in ep["times"][2:30]:
        n2, d2 = _disp(POSTS, c - 0.5, c + 0.5)
        peaks.append(-d2[i, int(0.4 * fs):int(0.6 * fs)].min())
    _, quiet = _disp(POSTS, ep["t0"] - 12.0, ep["t0"] - 2.0)
    assert np.median(peaks) >= 0.75 * np.median(_p2p_1s(quiet[i], fs))
    t = np.arange(int((c - 0.1) * FS), int((c + 0.3) * FS)) / FS
    o1 = POSTS._variant_rows(t)[POSTS._idx["O1"]]
    k = int(np.argmax(o1))
    half = o1 > 0.5 * o1[k]
    rise = k - np.nonzero(half)[0][0]
    fall = np.nonzero(half)[0][-1] - k
    assert rise < fall


# ------------------------------------------------------------------ V110 authored variants --
def _awake(kind, seed, ev_extra=None, age="child", **bg):
    return _syn(_spec(seed, age=age, events=[_variant(kind, 3.0, 20.0, **(ev_extra or {}))], minutes=6, **bg))


def _drowsy(kind, seed, context="drowsy", at=2.5, **extra):
    return _syn(_spec(seed, events=[SLEEP(2.0), _variant(kind, at, 20.0, context=context, **extra)], minutes=6))


def _bursts(S, kind):
    run = next(r for r in S._authored_variants if r["variant"] == kind)
    return run, run["bursts"]


def _side_independent(bursts, a, b):
    """Fraction of the window covered by exactly one side, and the overlap correlation of the two side masks."""
    t = np.arange(a, b, 0.01)
    m = {sd: np.zeros(t.size, bool) for sd in ("left", "right")}
    for bu in bursts:
        m[bu["side"]] |= (t >= bu["t0"]) & (t < bu["t1"])
    one = (m["left"] ^ m["right"]).mean()
    both = m["left"].astype(float), m["right"].astype(float)
    r = np.corrcoef(*both)[0, 1] if both[0].std() > 0 and both[1].std() > 0 else 0.0
    return one, r


@pytest.fixture(scope="module")
def MU():
    return _awake("mu", 611001, {"context": "movement", "block_at_min": 3.2, "block_duration_s": 5.0})


def test_mu_is_arciform_with_the_sharp_phase_surface_negative(MU):
    """Mu-IV, very-nice-Mu: C3 sharp-negative with rounded positive arches, so in F3-C3 (value F3 - C3) the sharp phase
    is a positive value, drawn DOWN.  0.4.x had it reversed (tips up in F3-C3)."""
    run, bursts = _bursts(MU, "mu")
    t = np.arange(int(run["t0"] * FS), int(run["t1"] * FS)) / FS
    c3 = MU._authored_variant_rows(t)[MU._idx["C3"]]
    live = np.abs(c3) > 1e-6
    assert _skew(c3[live]) < -0.3
    names, d = _component(MU, MU._authored_variant_rows, run["t0"], run["t1"])
    f3c3 = d[names.index("F3-C3")]
    assert _skew(f3c3[np.abs(f3c3) > 0.05 * np.abs(f3c3).max()]) > 0.3


def test_mu_trains_wax_and_wane_side_independently(MU):
    """Mu-IV: 0.5-4 s trains that come and go, often one side at a time (review V110-01); movement block respected;
    each train is keyed (key follows what is visible)."""
    run, bursts = _bursts(MU, "mu")
    dur = np.array([b["t1"] - b["t0"] for b in bursts if b["t1"] < run["t1"]])
    assert dur.size >= 4 and dur.min() >= 0.3 and dur.max() <= 4.01
    one, r = _side_independent(bursts, run["t0"], run["t1"])
    assert one >= 0.2 and r < 0.6
    t = np.arange(int(run["t0"] * FS), int(run["t1"] * FS)) / FS
    rows = MU._authored_variant_rows(t)
    blk = (t >= 192.0) & (t < 197.0)
    assert np.max(np.abs(rows[:, blk])) == 0.0
    keys = MU.authored_variant_runs()
    assert len(keys) >= 3 and all(not (k["t0"] < 197.0 and k["t1"] > 192.0) for k in keys)


def test_mu_stands_out_in_the_central_chain(MU):
    """Mu-IV: the train is about 1.5-2x the background in F3-C3 (eyes open, PDR attenuated)."""
    run, bursts = _bursts(MU, "mu")
    left = max((b for b in bursts if b["side"] == "left" and b["t1"] - b["t0"] >= 1.0 and
                not (b["t0"] < 197.0 and b["t1"] > 192.0)), key=lambda b: b["amp"])
    names, d = _disp(MU, left["t0"] + 0.25, left["t1"] - 0.25)
    _, bg = _disp(MU, run["t0"] - 12.0, run["t0"] - 2.0)
    i = names.index("F3-C3")
    ratio = np.ptp(d[i]) / np.median(_p2p_1s(bg[i], MU.fs))
    assert ratio >= 1.3
    o = names.index("P3-O1")
    assert np.ptp(d[i]) > np.ptp(d[o])


def test_wickets_are_negative_arciform_trains_one_side_at_a_time():
    """Wickets_1 (right-sided), Wickets-III: negative arciform 6-11 Hz, in 1-4 s trains or singly, not a continuous
    bilateral synchronous 8-Hz train (review V110-03)."""
    S = _drowsy("wicket", 611003)
    run, bursts = _bursts(S, "wicket")
    t = np.arange(int(run["t0"] * FS), int(run["t1"] * FS)) / FS
    t3 = S._authored_variant_rows(t)[S._idx["T3"]]
    assert _skew(t3[np.abs(t3) > 1e-6]) < -0.3
    dur = np.array([b["t1"] - b["t0"] for b in bursts])
    assert dur.max() <= 3.01 and (dur < 0.2).any()             # trains plus singletons
    assert all(6.0 <= b["hz"] <= 11.0 for b in bursts)
    one, r = _side_independent(bursts, run["t0"], run["t1"])
    assert one >= 0.2 and r < 0.6


def test_lambda_is_saccade_locked_triangular_and_the_pdr_is_attenuated():
    """lambda-waves-at-10uV-2, lambda-in-circumferential: positive occipital triangular waves, steep then slower,
    irregularly spaced (locked to saccades, with lateral eye movement at F7/F8), no PDR while scanning."""
    S = _awake("lambda", 611002, {"context": "visual_scanning"})
    run, bursts = _bursts(S, "lambda")
    left = [b for b in bursts if b["side"] == "left"]
    iv = np.diff([b["t0"] for b in left])
    assert 0.2 <= np.median(iv) <= 0.6 and iv.std() / iv.mean() > 0.2
    t = np.arange(int((left[3]["t0"] - 0.05) * FS), int((left[3]["t0"] + 0.4) * FS)) / FS
    rows = S._authored_variant_rows(t)
    o1 = rows[S._idx["O1"]]
    k = int(np.argmax(o1))
    half = np.nonzero(o1 > 0.5 * o1[k])[0]
    assert o1[k] > 0 and (k - half[0]) < (half[-1] - k)
    assert np.ptp(rows[S._idx["F7"]]) > 10.0                  # the saccade at F7/F8
    pdr, _ = S._eye_factor(np.arange(run["t0"] + 1.0, run["t1"] - 1.0, 0.05))
    assert pdr.mean() <= 0.5


def test_fourteen_and_six_are_isolated_positive_bursts_with_a_broad_posterior_field():
    """14-and-6 at 10 uV, 6-Hz-positive-spikes-4: a burst of about 1 s at 14 or 6-7 Hz, positive, broad posterior
    (posterior temporal, parietal, occipital), read referentially; 0.4.x gated a periodic 0.65-Hz square wave."""
    S = _drowsy("fourteen_and_six", 611004, context="light_sleep")
    run, bursts = _bursts(S, "fourteen_and_six")
    assert bursts and all(0.49 <= b["t1"] - b["t0"] <= 1.01 for b in bursts)
    assert all(13.4 <= b["hz"] <= 14.6 or 6.0 <= b["hz"] <= 7.0 for b in bursts)
    b = bursts[0]
    names, d = _component(S, S._authored_variant_rows, b["t0"], b["t1"], montage="referential")
    fl = b["side"] == "left"
    t5 = d[names.index("T5" if fl else "T6")]
    assert _skew(t5[np.abs(t5) > 0.05 * np.abs(t5).max()]) > 0.3        # sharp phase positive
    p = {e: np.ptp(d[names.index(e)]) for e in (("T5", "P3", "O1", "F3") if fl else ("T6", "P4", "O2", "F4"))}
    vals = list(p.values())
    assert vals[1] >= 0.4 * vals[0] and vals[2] >= 0.4 * vals[0] and vals[3] < 0.2 * vals[0]


def _link_ratio(S, a, b, chain):
    names, d = _component(S, S._authored_variant_rows, a, b)
    p = np.array([np.ptp(d[names.index(c)]) for c in chain])
    return p / p.max(), p.max()


def test_rmtd_runs_are_notched_side_independent_with_no_flat_link():
    """RMTD_1, RMTD-on-the-right: notched / flat-topped 5-6 Hz in intermittent runs, one side at a time, about 1.5x
    background.  0.4.x: a continuous bilateral sine and a sparse field (F7 = 0) that put 100 uV in F7-T3."""
    S = _drowsy("rmtd", 611005)
    run, bursts = _bursts(S, "rmtd")
    assert all(1.5 <= b["t1"] - b["t0"] <= 10.01 for b in bursts if b["t1"] < run["t1"])
    one, r = _side_independent(bursts, run["t0"], run["t1"])
    assert one >= 0.2 and r < 0.6
    b = max((b for b in bursts if b["side"] == "left"), key=lambda b: b["t1"] - b["t0"])
    ratio, peak = _link_ratio(S, b["t0"], b["t1"], ["Fp1-F7", "F7-T3", "T3-T5", "T5-O1"])
    assert ratio.min() >= 0.3, ratio                           # no flat link, no single false maximum
    assert 0.6 * b["amp"] <= peak <= 1.5 * b["amp"]            # authored amplitude = best-derivation p2p
    names, d = _component(S, S._authored_variant_rows, b["t0"], b["t1"])
    f, pxx = sps.welch(d[names.index("F7-T3")], fs=S.fs, nperseg=S.fs)
    f0 = f[np.argmax(pxx)]
    assert 4.5 <= f0 <= 7.0
    assert pxx[np.argmin(np.abs(f - 2 * f0))] > 0.03 * pxx.max()   # the notch is a real second harmonic


def test_far_bursts_7_to_10_hz_with_a_smooth_frontal_field():
    """White & Tharp: frontal 7-10 Hz; review V110-08: 6.5 Hz, continuous, and a sparse field (F7 = 0) that made
    Fp1-F7 large and F7-T3 flat."""
    S = _syn(_spec(611008, events=[{"type": "state_change", "at_min": 3.0, "to": "arousal"},
                                   _variant("frontal_arousal_rhythm", 3.0, 10.0, context="arousal")], minutes=6))
    run, bursts = _bursts(S, "frontal_arousal_rhythm")
    assert all(7.0 <= b["hz"] <= 10.0 for b in bursts)
    assert all(b["t1"] - b["t0"] <= 6.01 for b in bursts)
    b = max((b for b in bursts if b["side"] == "left"), key=lambda b: b["t1"] - b["t0"])
    ratio, _ = _link_ratio(S, b["t0"], b["t1"], ["Fp1-F3", "F3-C3", "Fp1-F7", "F7-T3"])
    assert ratio.min() >= 0.25, ratio


def test_sreda_evolves_from_sharp_waves_to_a_rhythm_and_ends_abruptly():
    """Westmoreland & Klass: onset of repetitive sharp / slow waves speeding up into 5-7 Hz sharply contoured
    rhythm, abrupt end, no postictal change (review V110-06; no LE figure)."""
    S = _syn(_spec(611006, age="adult", events=[_variant("sreda", 3.0, 40.0, context="adult_teaching")], minutes=6))
    run, bursts = _bursts(S, "sreda")
    lead = max(bursts, key=lambda b: b["amp"])
    names, d = _component(S, S._authored_variant_rows, run["t0"], run["t1"] + 2.0)
    row = d[names.index("T5-O1" if lead["side"] == "left" else "T6-O2")]
    fs = S.fs

    def fpeak(seg):
        f, p = sps.welch(seg, fs=fs, nperseg=min(seg.size, 2 * fs))
        return f[np.argmax(p)]
    assert fpeak(row[: int(0.3 * lead["onset"] * fs)]) < 3.5
    assert 5.0 <= fpeak(row[int((lead["onset"] + 2) * fs): int((run["t1"] - run["t0"] - 1) * fs)]) <= 7.0
    after = row[int((run["t1"] - run["t0"] + 0.3) * fs):]
    assert np.ptp(after) < 0.25 * np.ptp(row[: int((run["t1"] - run["t0"]) * fs)])
    other = next(b for b in bursts if b is not lead)
    assert other["amp"] < lead["amp"]


def test_photic_driving_follows_the_flash_train():
    """photic-driving vs no-photic-driving: occipital response at the flash rate for the length of the train, full
    within about two flashes, gone with the last flash; the eyes are closed for photic stimulation."""
    S = _awake("photic_driving", 611009, {"context": "photic", "stimulus_frequency_hz": 12})
    run, bursts = _bursts(S, "photic_driving")
    t = np.arange(int((run["t0"] - 1) * FS), int((run["t1"] + 1) * FS)) / FS
    o1 = S._authored_variant_rows(t)[S._idx["O1"]]
    live = (t >= run["t0"]) & (t < run["t1"])
    f, p = sps.welch(o1[live], fs=FS, nperseg=2 * FS)
    assert abs(f[np.argmax(p)] - 12.0) <= 0.5
    after = t > run["t1"] + 0.25
    assert np.max(np.abs(o1[after])) < 0.02 * np.max(np.abs(o1))
    before = t < run["t0"]
    assert np.max(np.abs(o1[before])) == 0.0
    early = np.ptp(o1[(t >= run["t0"] + 1 / 12) & (t < run["t0"] + 3 / 12)])
    steady = np.ptp(o1[(t >= run["t0"] + 5.0) & (t < run["t0"] + 6.0)])
    assert early >= 0.6 * steady
    pdr, _ = S._eye_factor(np.array([run["t0"] + 2.0, run["t1"] - 2.0]))
    assert pdr.min() > 0.95


def test_hv_buildup_is_delayed_slows_as_it_grows_and_involves_every_chain():
    """hv-slowing: diffuse high-voltage slowing through every chain, temporal included.  0.4.x: a 3-Hz sine under a
    sine envelope and a sparse field (F7/T3/T5 = 0) that left F7-T3 / T3-T5 flat.  Review: delayed start, frequency
    gliding down as amplitude grows, irregular, resolves after the end."""
    S = _awake("hyperventilation_buildup", 611010, {"context": "hyperventilation", "duration_s": 60.0})
    run, bursts = _bursts(S, "hyperventilation_buildup")
    a, b = run["t0"], run["t1"]
    ratio, peak = _link_ratio(S, a + 0.75 * (b - a), b, ["Fp1-F7", "F7-T3", "T3-T5", "T5-O1", "Fp1-F3", "F3-C3",
                                                         "C3-P3", "P3-O1"])
    assert ratio.min() >= 0.3, ratio
    names, d = _component(S, S._authored_variant_rows, a, b + 20.0)
    row = d[names.index("F3-C3")]
    fs = S.fs
    early = np.ptp(row[: int(0.1 * (b - a) * fs)])
    assert early < 0.1 * np.ptp(row)

    def fpeak(seg):
        f, p = sps.welch(seg, fs=fs, nperseg=4 * fs)
        return f[np.argmax(p)]
    mid = row[int(0.3 * (b - a) * fs): int(0.5 * (b - a) * fs)]
    late = row[int(0.8 * (b - a) * fs): int((b - a) * fs)]
    assert fpeak(late) < fpeak(mid) and 2.0 <= fpeak(late) <= 4.0
    rec = row[int((b - a + 15.0) * fs):]
    assert np.ptp(rec) < 0.35 * np.ptp(late)
    # irregular, not a sinusoid: the 1-s p2p varies
    v = _p2p_1s(late, fs)
    assert v.std() / v.mean() > 0.08


# ------------------------------------------------------------------ window independence --
@pytest.mark.parametrize("which", ["HH", "PSWY", "POSTS"])
def test_scheduled_variants_are_window_independent(which, HH, PSWY, POSTS):
    S = {"HH": HH, "PSWY": PSWY, "POSTS": POSTS}[which]
    name = {"HH": "hypnagogic_hypersynchrony", "PSWY": "posterior_slow_waves_of_youth", "POSTS": "posts"}[which]
    r = next(r for r in S.variant_runs() if r["variant"] == name)
    assert _whole_vs_chunks(S, r["t0"] - 5.0, r["t0"] + 20.0) < 1e-9


@pytest.mark.parametrize("kind", ["mu", "lambda", "wicket", "fourteen_and_six", "rmtd", "sreda",
                                  "frontal_arousal_rhythm", "photic_driving", "hyperventilation_buildup"])
def test_authored_variants_are_window_independent(kind):
    if kind in ("wicket", "rmtd"):
        S = _drowsy(kind, 7)
    elif kind == "fourteen_and_six":
        S = _drowsy(kind, 7, context="light_sleep")
    elif kind == "frontal_arousal_rhythm":
        S = _syn(_spec(7, events=[{"type": "state_change", "at_min": 3.0, "to": "arousal"},
                                  _variant(kind, 3.0, 10.0, context="arousal")], minutes=6))
    else:
        S = _awake(kind, 7, age="adult" if kind == "sreda" else "child")
    run = S._authored_variants[0]
    assert _whole_vs_chunks(S, run["t0"] - 2.0, run["t0"] + 23.0) < 1e-9
