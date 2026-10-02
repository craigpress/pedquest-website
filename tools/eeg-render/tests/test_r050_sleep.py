"""Phase D (sleep and state cycling, spec_version 3): sleep architecture by age and stage, state cycling, coma
patterns, and the normal-variants re-review items (14 & 6, photic, FAR, HV / SREDA duration, lambda).

References (review: research/eeg-atlas/feature-review-20260926/sleep-review.md):
- AASM Manual for the Scoring of Sleep and Associated Events (v2.6): spindle 11-16 Hz >= 0.5 s; K-complex a
  negative sharp wave immediately followed by a positive component, >= 0.5 s, frontal maximum; vertex sharp waves
  < 0.5 s, central; N3 > 20 % of the epoch in 0.5-2 Hz waves >= 75 uV (frontal); REM low-voltage mixed frequency,
  rapid eye movements, low chin EMG, sawtooth waves (2-6 Hz, central); arousal >= 3 s abrupt shift to alpha / theta
  / > 16 Hz.
- learningeeg.com normal-asleep (Spindles, Vertexes, arousal), pediatric (4-month-old asleep: long asynchronous
  spindle; 8-month-old drowsy), artifacts (REM-Sleep-ex-3, Bad-Fp1-electrode-during-SWS).
- eegatlas-online.com K-complex #113, sawtooth waves #2784, photic driving #010 (photic marker channel).
- ACNS 2013 neonatal terminology (Tsuchida et al., J Clin Neurophysiol 30:161): quiet sleep HVS / tracé alternant.
"""
import numpy as np
import pytest
from scipy import signal as sps

from eeg_render import montage as mt
from eeg_render.export.manifest import realized_events
from eeg_render.render_page import apply_filters, build_filters
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer
from eeg_render.trends import AEEG_PP_WIN_S, _pp_envelope, aeeg_filter, apply_fir

FS = 256
BG = {"infant": (5.5, 60), "child": (8.5, 50), "adolescent": (9.5, 40), "adult": (10.0, 30)}


def _mk(age="child", minutes=150, seed=27960625, events=None, **bg):
    hz, amp = BG.get(age, (8.5, 50))
    b = {"type": "continuous", "reactivity": "present", "dominant_hz": hz, "amplitude_uv": amp, "slow_fraction": 0.35}
    b.update(bg)
    img = {"kind": "qeeg_panel", "license": "synthetic-original", "attribution": None,
           "spec": {"sample_rate": FS, "channels": "standard_19", "seed": seed, "spec_version": 3, "age_group": age,
                    "duration_min": minutes, "background": b,
                    "events": events if events is not None else [{"type": "state_change", "at_min": 10, "to": "sleep"}]}}
    return Synthesizer(normalize(img)["spec"], minutes * 60.0)


def _chain(S, x):
    pairs = mt.montage_pairs("longitudinal_bipolar", S.scalp)
    d = apply_filters(S.derive(x, pairs, "longitudinal_bipolar"), build_filters(S.fs, {"lf_hz": 1.0, "hf_hz": 70.0}, True), True)
    return [f"{a}-{b}" for a, b in pairs], d


def _disp(S, t0, t1):
    _, x = S.segment(t0 - 10.0, t1)
    names, d = _chain(S, x)
    return names, d[:, int(10 * S.fs):]


def _comp(S, fn, t0, t1):
    t = np.arange(int((t0 - 10) * S.fs), int(t1 * S.fs)) / S.fs
    names, d = _chain(S, fn(t))
    return names, d[:, int(10 * S.fs):]


def _stage(S, st, minlen=150.0, k=0):
    ivs = [(a, b) for a, b, s in S._hypno if s == st and b - a >= minlen and a > 0]
    return ivs[min(k, len(ivs) - 1)]


def _p2p_1s(row, fs=FS):
    return np.array([np.ptp(row[i:i + fs]) for i in range(0, row.size - fs + 1, fs)])


def _sws_cover(row, fs=FS):
    """Share of time in 0.5-2 Hz half-wave pairs >= 75 uV peak-to-peak (AASM slow-wave criterion)."""
    s = sps.sosfiltfilt(sps.butter(3, [0.5, 2.0], "bandpass", fs=fs, output="sos"), row)
    zc = np.nonzero(np.diff(np.sign(s)) != 0)[0]
    cov = np.zeros(s.size, bool)
    for i in range(len(zc) - 2):
        a, b = zc[i], zc[i + 2]
        if 0.5 <= (b - a) / fs <= 2.0 and np.ptp(s[a:b]) >= 75.0:
            cov[a:b] = True
    return float(cov.mean())


@pytest.fixture(scope="module")
def CHILD():
    return _mk("child")


@pytest.fixture(scope="module")
def ADULT():
    return _mk("adult", seed=9091907)


@pytest.fixture(scope="module")
def INFANT():
    return _mk("infant", seed=5150301, minutes=100)


# ------------------------------------------------------------------ spindles --
def _spindle_measures(S, n_max=40):
    bp = sps.butter(4, [10, 16.5], "bandpass", fs=S.fs, output="sos")
    out = []
    a, b = _stage(S, "N2", 300)
    t0, t1 = a + 30, min(b - 5, a + 330)
    names, d = _comp(S, S._spindle_rows_v3, t0, t1)
    env = np.abs(sps.hilbert(sps.sosfiltfilt(bp, d, axis=1), axis=1))
    tt = t0 + np.arange(d.shape[1]) / S.fs
    for k, ts in enumerate(S._sp_t):
        du = S._sp["dur"][k]
        if ts < t0 + 1 or ts + du > t1 - 1 or len(out) >= n_max:
            continue
        # skip overlapping spindles (a K-complex follower on a scheduled one)
        if np.any((np.abs(S._sp_t - ts) < du + 0.5) & (S._sp_t != ts)):
            continue
        m = (tt >= ts - 0.4) & (tt < ts + du + 0.4)
        e = env[:, m]
        ch = int(np.argmax(e.max(1)))
        row = e[ch]
        pk = (np.argmax(row) / S.fs - 0.4) / du
        seg = d[ch, m]
        zc = np.nonzero(np.diff(np.sign(seg)) != 0)[0]
        out.append({"vis": (row > 0.5 * row.max()).sum() / S.fs, "dur": du, "peak": pk, "slow": bool(S._sp["slow"][k]),
                    "hz": (len(zc) - 1) / 2 / ((zc[-1] - zc[0]) / S.fs),
                    "fc_cp": e[names.index("F3-C3")].max() / e[names.index("C3-P3")].max(),
                    "fc_po": e[names.index("F3-C3")].max() / e[names.index("P3-O1")].max()})
    return out


def test_spindles_wax_and_wane_over_their_whole_duration(CHILD, ADULT):
    """Re-review: sin^2 envelope, only about 0.4 s above half amplitude.  learningeeg Spindles and eegatlas-online
    #113: about 1-1.5 s visible, waxing then waning; AASM >= 0.5 s."""
    for S, lo, hi in ((CHILD, 0.8, 1.5), (ADULT, 0.7, 1.4)):
        m = _spindle_measures(S)
        assert len(m) >= 10
        vis = np.median([x["vis"] for x in m])
        assert lo <= vis <= hi, vis
        assert np.mean([x["vis"] >= 0.5 for x in m]) >= 0.9
        assert np.median([x["vis"] / x["dur"] for x in m]) >= 0.6       # visible for most of the packet
        assert 0.25 <= np.median([x["peak"] for x in m]) <= 0.55        # waxing to an early-middle peak


def test_slow_frontal_and_fast_centroparietal_spindles(CHILD):
    """De Gennaro & Ferrara 2003: slow 11-12 Hz frontal and fast 13-15 Hz centro-parietal spindles; the re-review
    found one 12-14.5 Hz population with the same field."""
    m = _spindle_measures(CHILD, 60)
    slow = [x for x in m if x["slow"]]
    fast = [x for x in m if not x["slow"]]
    assert 0.2 <= len(slow) / len(m) <= 0.6
    assert 10.5 <= np.median([x["hz"] for x in slow]) <= 12.7
    assert 12.7 <= np.median([x["hz"] for x in fast]) <= 15.2
    assert np.median([x["fc_cp"] for x in slow]) >= 1.5              # slow: F3-C3 larger than C3-P3
    assert np.median([x["fc_po"] for x in fast]) <= 0.9              # fast: P3-O1 larger than F3-C3


def test_infant_spindles_are_long_and_asynchronous(INFANT):
    """learningeeg 4-month-old asleep: a 5-6 s spindle over one hemisphere while the other is quiet (asynchronous
    until about the second year)."""
    sp = INFANT._sp
    assert np.median(sp["dur"]) >= 2.5 and sp["dur"].max() >= 5.0
    one = np.isin(sp["side"], (-1.0, 1.0))
    assert one.mean() >= 0.6
    bp = sps.butter(4, [11, 15], "bandpass", fs=FS, output="sos")
    ratios = []
    for k in np.nonzero(one)[0][:25]:
        ts, du = INFANT._sp_t[k], sp["dur"][k]
        if np.any((np.abs(INFANT._sp_t - ts) < du + 1.0) & (INFANT._sp_t != ts)) or ts < 600:
            continue
        names, d = _comp(INFANT, INFANT._spindle_rows_v3, ts, ts + du)
        r = np.sqrt((sps.sosfiltfilt(bp, d, axis=1) ** 2).mean(1))
        L, R = r[names.index("C3-P3")] + r[names.index("F3-C3")], r[names.index("C4-P4")] + r[names.index("F4-C4")]
        ratios.append(max(L, R) / min(L, R))
    assert len(ratios) >= 5 and np.median(ratios) >= 3.0


# ------------------------------------------------------------ vertex / K-complex --
def test_vertex_waves_are_broader_and_parasagittal(CHILD):
    """Re-review: FWHM 78-90 ms and F3-C3 0.3 of the midline.  learningeeg Vertexes: sharp but not spiky, seen in
    F3-C3, C3-P3, F4-C4, C4-P4 and T3-T5 as well as the midline, phase reversal at Cz."""
    fw, par, tmp = [], [], []
    for tv in [t for t in CHILD._vx_t if t > 700][:25]:
        names, d = _comp(CHILD, CHILD._sleep_transient_rows, tv - 1.0, tv + 1.5)
        if np.any(np.abs(CHILD._kc_t - tv) < 2.0):
            continue
        cz = d[names.index("Cz-Pz")]            # Cz negative -> Cz-Pz negative
        k = int(np.argmin(cz))
        half = cz < 0.5 * cz[k]
        a = k
        while a > 0 and half[a - 1]:
            a -= 1
        b = k
        while b < cz.size - 1 and half[b + 1]:
            b += 1
        fw.append((b - a + 1) / FS * 1000)
        p = {n: np.ptp(d[names.index(n)]) for n in ("Fz-Cz", "Cz-Pz", "F3-C3", "C3-P3", "T3-T5")}
        par.append(p["F3-C3"] / p["Fz-Cz"])
        tmp.append(p["T3-T5"] / p["Fz-Cz"])
    assert 90 <= np.median(fw) <= 200, np.median(fw)
    assert np.median(par) >= 0.55
    assert np.median(tmp) >= 0.2


def test_k_complex_is_biphasic_long_the_largest_wave_and_often_followed_by_a_spindle(ADULT):
    """AASM: negative sharp wave immediately followed by a positive component, >= 0.5 s; eegatlas-online #113 (adult):
    about 0.75 s, the largest wave of the page, in every chain, a spindle riding the end.  Re-review: vertex-shaped."""
    fz = ADULT.electrodes.index("Fz")
    tot, negw, big, follow = [], [], [], []
    a, b = _stage(ADULT, "N2", 300)
    names, full = _disp(ADULT, a + 30, a + 150)
    bg = np.median(_p2p_1s(full[names.index("F3-C3")]))
    for tk in [t for t in ADULT._kc_t if t > 700][:20]:
        t = np.arange(int((tk - 1) * FS), int((tk + 2.5) * FS)) / FS
        r = ADULT._sleep_transient_rows(t)[fz]
        neg = -r
        on = np.nonzero(neg > 0.1 * neg.max())[0][0]
        pos = np.where(np.arange(r.size) > np.argmax(neg), r, 0.0)
        off = np.nonzero(pos > 0.1 * pos.max())[0][-1]
        tot.append((off - on) / FS)
        negw.append((neg > 0.5 * neg.max()).sum() / FS)
        nm, d = _comp(ADULT, ADULT._sleep_transient_rows, tk - 1, tk + 2)
        big.append(np.ptp(d[nm.index("F3-C3")]) / bg)
        follow.append(bool(np.any((ADULT._sp_t > tk) & (ADULT._sp_t < tk + 1.5))))
    assert np.median(tot) >= 0.5 and 0.18 <= np.median(negw) <= 0.4, (np.median(tot), np.median(negw))
    assert np.median(big) >= 2.5, np.median(big)
    assert 0.4 <= np.mean(follow) <= 0.9


# --------------------------------------------------------------------- N3 --
def test_n3_slow_waves_show_on_the_bipolar_chain(CHILD, ADULT):
    """Re-review: N3 indistinguishable from N2 on the page (0-1 % of N3 in 0.5-2 Hz waves >= 75 uV on Fp1-F3 /
    F3-C3).  AASM N3 > 20 %; children 30-60 % (learningeeg Bad-Fp1-electrode-during-SWS: slow waves in every
    anterior chain)."""
    for S, lo in ((CHILD, 0.3), (ADULT, 0.2)):
        frac = {}
        for st in ("N2", "N3"):
            a, b = _stage(S, st, 200)
            names, d = _disp(S, a + 30, a + 150)
            frac[st] = np.mean([_sws_cover(d[names.index(c)]) for c in ("Fp1-F3", "F3-C3", "Fz-Cz")])
        assert frac["N3"] >= lo and frac["N2"] < 0.2 and frac["N3"] > 2 * frac["N2"], frac


# -------------------------------------------------------------------- REM --
def test_rem_has_sawtooth_waves_rapid_eye_movements_and_atonia(CHILD):
    """AASM REM: rapid eye movements, low EMG, sawtooth waves (2-6 Hz, central, before REM bursts);
    learningeeg REM-Sleep-ex-3 (opposed Fp1-F7 / Fp2-F8 deflections), eegatlas-online #2784 (Cz-Pz trains)."""
    S = CHILD
    ra, rb = _stage(S, "R", 120)
    saw = S._saw["t"]
    assert saw.size and np.all([S.stage_at(np.array([x]))[0] == "R" for x in saw])
    tr = next(x for x in saw if ra + 15 < x < rb - 15)
    names, d = _comp(S, S._rem_rows, tr - 1, tr + 4)
    _, full = _disp(S, tr - 20, tr - 2)
    band = sps.butter(4, [1.5, 5.0], "bandpass", fs=FS, output="sos")
    cz = sps.sosfiltfilt(band, d[names.index("Cz-Pz")])
    bgcz = sps.sosfiltfilt(band, full[names.index("Cz-Pz")])
    assert np.sqrt((cz[FS:3 * FS] ** 2).mean()) >= 1.3 * np.sqrt((bgcz ** 2).mean())
    steps = [s for s in S._rem_steps if ra < s[0] < rb and s[3] != 0.0]
    assert len(steps) / ((rb - ra) / 60.0) >= 5.0                    # saccades per minute of REM
    s0 = steps[len(steps) // 2][0]
    names, d = _comp(S, S._rem_rows, s0 - 0.5, s0 + 0.5)
    l, r = d[names.index("Fp1-F7")], d[names.index("Fp2-F8")]
    assert np.ptp(l) >= 60.0 and np.corrcoef(l, r)[0, 1] < -0.5      # opposed frontal eye-movement field
    assert not [s for s in S._rem_steps if S.stage_at(np.array([s[0]]))[0] not in ("R", "")]
    # phase B: 40-70 Hz (was 30-70; the delta stream's broadband tail reaches 30-40 Hz, and phase B cut N2 delta,
    # which moved the old ratio from 0.598 to 0.601 without any change in muscle)
    hp = sps.butter(4, [40, 70], "bandpass", fs=FS, output="sos")
    emg = {}
    for st in ("N2", "R"):
        a, b = _stage(S, st, 120)
        def tonic(t):
            return S._tonic_muscle_rows_v3(t, int(round(t[0] * FS)), t.size,
                                           np.ones(t.size), np.full(t.size, 36.5), np.ones(t.size), None)
        names, d = _comp(S, tonic, a + 30, a + 60)
        emg[st] = np.sqrt((sps.sosfiltfilt(hp, d[names.index("T3-T5")]) ** 2).mean())
    assert emg["R"] < 0.6 * emg["N2"]


def test_n1_slow_eye_movements_and_arousals(CHILD):
    """AASM N1: slow eye movements; arousal: abrupt alpha / fast activity >= 3 s, often after a K-complex
    (learningeeg arousal)."""
    a, b = _stage(CHILD, "N1", 120)
    names, d = _disp(CHILD, a + 20, a + 80)
    lp = sps.butter(2, [0.2, 0.8], "bandpass", fs=FS, output="sos")
    eye = sps.sosfiltfilt(lp, d[names.index("F7-T3")] + d[names.index("Fp1-F7")] - d[names.index("Fp2-F8")] - d[names.index("F8-T4")])
    wa, wb = next((x, y) for x, y, s in CHILD._hypno if s == "W")
    _, dw = _disp(CHILD, wb - 70, wb - 10)
    eyew = sps.sosfiltfilt(lp, dw[names.index("F7-T3")] + dw[names.index("Fp1-F7")] - dw[names.index("Fp2-F8")] - dw[names.index("F8-T4")])
    assert eye.std() > 1.5 * eyew.std()
    ar = [(x, w) for x, w in CHILD._arousals_v3 if CHILD.stage_at(np.array([x - 2.0]))[0] in ("N2", "N3")]
    assert ar and all(w >= 3.0 for _x, w in ar)
    heralded = [x for x, _w in ar if np.any((CHILD._kc_t > x - 1.0) & (CHILD._kc_t < x))]
    assert 0.2 <= len(heralded) / len(ar) <= 0.8


# ---------------------------------------------------------- state and cycling --
def test_drawn_sleep_starts_at_the_keyed_state_change():
    """Re-review B2-07 / B5-07: keyed 8:00, drawn N1 from 8:30 (the voltage ramp's half-way point)."""
    S = _mk("adult", minutes=30, seed=2070, events=[{"type": "state_change", "at_min": 8.0, "to": "sleep"}])
    first = next(a for a, b, st in S._hypno if st != "W")
    assert abs(first - 480.0) < 1e-6
    rows = [r for r in realized_events(S, 1800.0) if r["kind"] == "state" and r["label"] in ("drowsy", "asleep")]
    assert rows and abs(rows[0]["onset_s"] - 480.0) < 0.01


def test_answer_key_lists_stages_and_their_transients(CHILD):
    rows = realized_events(CHILD, 150 * 60.0)
    st = [r for r in rows if r["kind"] == "sleep_stage"]
    assert {"W", "N1", "N2", "N3", "R"} <= {r["label"] for r in st}
    n3 = [r for r in st if r["label"] == "N3"]
    times = CHILD._sws["t"]
    expected = ((CHILD.stage_at(times) == "N3") & (CHILD._arch_w(times, CHILD._sed_v3_at("loc", times, 0.0)) > 0.5)).sum()
    assert sum(r["slow_waves"] for r in n3) == expected and expected > 100
    rem = [r for r in st if r["label"] == "R"]
    assert sum(r["sawtooth_trains"] for r in rem) >= 1 and sum(r["rapid_eye_movements"] for r in rem) >= 10
    assert all(r["spindles"] == 0 for r in rem)
    assert any(r["kind"] == "arousal" for r in rows)


def test_encephalopathy_and_a_hypnotic_remove_sleep_architecture():
    """ACNS 2021 / ICU EEG: sleep transients and state cycling are lost in encephalopathy; a hypnotic abolishes
    natural spindles, K-complexes and REM (dexmedetomidine spindles are separate)."""
    E = _mk("child", minutes=60, seed=9101, reactivity="absent", sleep_architecture="absent", slow_fraction=0.7)
    assert {st for _a, _b, st in E._hypno} <= {"W", "N2"} and not E._arousals_v3
    a, b = _stage(E, "N2", 300)
    names, d = _comp(E, lambda t: E._spindle_rows_v3(t) * E._arch_w(t, np.zeros(t.size))[None, :], a + 60, a + 120)
    assert np.abs(d).max() == 0.0
    assert all(r["spindles"] == 0 for r in realized_events(E, 3600.0) if r["kind"] == "sleep_stage")
    img = {"kind": "qeeg_panel", "license": "synthetic-original", "attribution": None,
           "spec": {"sample_rate": FS, "channels": "standard_19", "seed": 9102, "spec_version": 3, "age_group": "child",
                    "duration_min": 60, "background": {"type": "continuous", "reactivity": "present", "amplitude_uv": 50},
                    "sedation": {"agent": "propofol", "level": 0.8},
                    "events": [{"type": "state_change", "at_min": 10, "to": "sleep"}]}}
    P = Synthesizer(normalize(img)["spec"], 3600.0)
    t = np.arange(900.0, 3500.0, 5.0)
    assert P._arch_w(t, P._sed_v3_at("loc", t, 0.0)).max() < 0.3
    assert not [r for r in realized_events(P, 3600.0) if r["kind"] == "sleep_stage" and r["label"] in ("N1", "N2", "N3", "R")]


def test_spindle_coma_and_alpha_coma():
    """Spindle coma: unreactive, N2-like spindles / vertex waves / K-complexes with no cycling; alpha coma:
    unreactive, diffuse frontally predominant monotonous alpha with no posterior dominant rhythm (Kaplan 1999)."""
    SC = _mk("child", minutes=30, seed=9201, events=[], coma_pattern="spindle", reactivity="absent")
    assert SC._hypno == [(-120.0, 1920.0, "N2")] and not SC._arousals_v3 and not SC._eyes
    assert SC._sp_t.size / 30.0 >= 3.0
    AC = _mk("child", minutes=30, seed=9202, events=[], coma_pattern="alpha", reactivity="absent")
    names, d = _disp(AC, 300, 360)
    ab = sps.butter(4, [8, 12], "bandpass", fs=FS, output="sos")
    r = {n: np.sqrt((sps.sosfiltfilt(ab, d[names.index(n)]) ** 2).mean()) for n in ("F3-C3", "Fp1-F3", "P3-O1")}
    assert r["F3-C3"] > 1.3 * r["P3-O1"] and r["Fp1-F3"] > r["P3-O1"]
    v = _p2p_1s(sps.sosfiltfilt(ab, d[names.index("F3-C3")]))
    assert v.std() / v.mean() < 0.35                                   # monotonous
    rows = [r for r in realized_events(AC, 1800.0) if r["kind"] == "sleep_stage"]
    assert rows and rows[0]["label"] == "alpha_coma"


def test_neonatal_quiet_sleep_opens_with_high_voltage_slow():
    """ACNS 2013: term quiet sleep is HVS (continuous 50-150 uV, 0.5-4 Hz) and tracé alternant; before phase D every
    QS epoch was TA only."""
    img = {"kind": "qeeg_panel", "license": "synthetic-original", "attribution": None,
           "spec": {"sample_rate": FS, "channels": "standard_19", "seed": 4242, "spec_version": 3, "age_group": "neonate",
                    "duration_min": 90, "background": {"type": "continuous", "pma_weeks": 40, "state_cycle": "term"},
                    "events": []}}
    S = Synthesizer(normalize(img)["spec"], 5400.0)
    h0, h1 = next((a, b) for a, b in S._hvs if a > 300)
    qs_end = next(b for a, b, lab in S._state_intervals if lab == "quiet_sleep" and a == h0)
    pairs = mt.montage_pairs("neonatal_reduced", S.scalp)

    def p2p(t0, t1):
        _, x = S.segment(t0 - 10, t1)
        d = apply_filters(S.derive(x, pairs, "neonatal_reduced"), build_filters(FS, {"lf_hz": 0.5, "hf_hz": 70}, True), True)
        return np.median(np.array([_p2p_1s(r) for r in d[:, 10 * FS:]]), 0)
    hvs, ta = p2p(h0 + 20, h1 - 10), p2p(h1 + 20, qs_end - 10)
    assert 50 <= np.median(hvs) <= 150 and np.percentile(hvs, 10) >= 40      # continuous high voltage
    assert np.percentile(ta, 10) < 0.6 * np.percentile(hvs, 10)              # TA has its interbursts
    assert any(r["kind"] == "state_detail" for r in realized_events(S, 5400.0))


def _aeeg(S, t0, t1, pair=("C3", "C4")):
    _, x = S.segment(t0 - 5, t1 + 5)
    f = apply_fir(S.derive(x, [pair])[0], aeeg_filter(FS))
    pp = _pp_envelope(f, FS, AEEG_PP_WIN_S)[5 * FS:-5 * FS]
    return np.percentile(pp, 5), np.percentile(pp, 95)


def test_sleep_wake_cycling_shows_on_the_aeeg(CHILD):
    """Neonatal aEEG sleep-wake cycling: the band broadens in quiet sleep (lower margin falls); in older children
    NREM slow-wave sleep lifts the band (ICU aEEG cycling).  Measured over whole states in
    renders/phaseD/sleep/aeeg_swc.json: neonate QS lower 21 vs AS 35 uV; child N3 upper 94 vs W 51 uV."""
    img = {"kind": "qeeg_panel", "license": "synthetic-original", "attribution": None,
           "spec": {"sample_rate": FS, "channels": "standard_19", "seed": 4242, "spec_version": 3, "age_group": "neonate",
                    "duration_min": 90, "background": {"type": "continuous", "pma_weeks": 40, "state_cycle": "term"},
                    "events": []}}
    N = Synthesizer(normalize(img)["spec"], 5400.0)
    qa, qb = next((a, b) for a, b, lab in N._state_intervals if lab == "quiet_sleep" and a > 300)
    ha = next(b for a, b in N._hvs if a == qa)
    aa, ab_ = next((a, b) for a, b, lab in N._state_intervals if lab == "active_sleep" and a > 300 and b - a > 200)
    lo_q, _ = _aeeg(N, ha + 20, min(qb - 10, ha + 200))
    lo_a, _ = _aeeg(N, aa + 20, aa + 200)
    assert lo_q < 0.8 * lo_a
    w = next((a, b) for a, b, st in CHILD._hypno if st == "W")
    n3 = _stage(CHILD, "N3", 300)
    _, up_w = _aeeg(CHILD, max(w[0], 0.0) + 30, max(w[0], 0.0) + 230)
    _, up_n3 = _aeeg(CHILD, n3[0] + 60, n3[0] + 260)
    assert up_n3 > 1.4 * up_w


def test_new_sleep_elements_are_window_independent(CHILD):
    for st in ("N3", "R", "N2"):
        a, _ = _stage(CHILD, st, 150)
        t0 = a + 50
        _, x1 = CHILD.segment(t0, t0 + 20)
        _, x2 = CHILD.segment(t0 - 6.5, t0 + 33)
        k = int(round(6.5 * FS))
        assert np.allclose(x1, x2[:, k:k + x1.shape[1]], atol=1e-6), st


# -------------------------------------------------- normal-variants re-review --
def _var(kind, at, dur, **extra):
    e = {"type": "normal_variant", "kind": kind, "at_min": at, "duration_s": dur}
    e.update(extra)
    return e


def _vsyn(seed, events, age="child", minutes=12, background=None):
    img = {"kind": "eeg_page", "license": "synthetic-original", "attribution": None,
           "spec": {"seed": seed, "spec_version": 3, "age_group": age, "sample_rate": FS, "channels": "standard_19",
                    "duration_min": minutes, "events": events,
                    "background": {"type": "continuous", "amplitude_uv": 40.0, "dominant_hz": 9.0, "slow_fraction": 0.3,
                                   "reactivity": "present", "blink_rate_per_min": 0.0, "channel_gain_max": 1.5,
                                   **(background or {})}}}
    return Synthesizer(normalize(img)["spec"], minutes * 60.0)


def test_fourteen_and_six_read_on_the_bipolar_chain_and_the_six_hz_arm_fires():
    """Re-review V110-04: T5-O1 event 0.4x background, invisible on the bipolar page; all bursts 14 Hz.
    learningeeg 14-and-6 at 10 uV: the burst stands out in the posterior bipolar chains."""
    S = _vsyn(611004, [{"type": "state_change", "at_min": 5.0, "to": "sleep"},
                       _var("fourteen_and_six", 7.0, 30.0, context="light_sleep")])
    run = S._authored_variants[0]
    assert any(b["hz"] < 10 for b in run["bursts"]) and any(b["hz"] > 10 for b in run["bursts"])
    ratios = []
    for b in run["bursts"]:
        ch = "T5-O1" if b["side"] == "left" else "T6-O2"
        names, ev = _comp(S, S._authored_variant_rows, b["t0"], b["t1"])
        _, pre = _disp(S, b["t0"] - 4.0, b["t0"] - 0.5)
        ratios.append(np.ptp(ev[names.index(ch)]) / np.median(_p2p_1s(pre[names.index(ch)])))
    assert np.median(ratios) >= 1.5, ratios


def test_photic_driving_has_a_flash_marker_an_occipital_maximum_and_symmetric_sides():
    """Re-review V110-09: no stimulus marker; T3-T5 / C3-P3 at or above P3-O1; left 71 / right 39 uV.
    eegatlas-online #010 (photic channel), learningeeg photic-driving (P-O and T-O maximum, symmetric)."""
    from eeg_render.render_page import render_eeg_page  # noqa: F401  (the marker row is drawn from photic_flashes)
    S = _vsyn(611009, [_var("photic_driving", 5.0, 15.0, context="photic", stimulus_frequency_hz=12)])
    fl = S.photic_flashes(300.0, 315.0)
    assert abs(len(fl) - 12 * 15) <= 1 and np.allclose(np.diff(fl), 1 / 12.0)
    names, d = _comp(S, S._authored_variant_rows, 302.0, 314.0)
    p = {n: np.ptp(d[names.index(n)]) for n in names}
    for side in (("P3-O1", "T5-O1", "T3-T5", "C3-P3"), ("P4-O2", "T6-O2", "T4-T6", "C4-P4")):
        assert min(p[side[0]], p[side[1]]) > 1.5 * max(p[side[2]], p[side[3]]), p
    assert 0.8 <= p["P4-O2"] / p["P3-O1"] <= 1.25
    rows = [r for r in realized_events(S, 720.0) if r.get("variant") == "photic_driving"]
    assert rows and rows[0].get("stimulus_marker")


def test_frontal_arousal_rhythm_follows_sleep_and_stays_modest():
    """Re-review V110-08: the hypnogram was awake all record (no sleep before the arousal) and FAR was 4.9x the
    background.  White & Tharp: arousal from sleep; a subtle pattern (target <= about 2x)."""
    S = _vsyn(611008, [{"type": "state_change", "at_min": 1.0, "to": "sleep"},
                       {"type": "state_change", "at_min": 5.0, "to": "arousal"},
                       _var("frontal_arousal_rhythm", 5.0, 15.0, context="arousal")],
              background={"sleep_staging": "static"})
    before = S.stage_at(np.array([300.0 - 60.0, 300.0 - 1.0]))
    assert list(before) == ["N2", "N2"] and S.stage_at(np.array([305.0]))[0] == "W"
    run = S._authored_variants[0]
    names, ev = _comp(S, S._authored_variant_rows, run["t0"], run["t1"])
    _, full = _disp(S, run["t0"], run["t1"])
    bg = np.median(_p2p_1s(full[names.index("F3-C3")]))
    far = np.percentile(_p2p_1s(ev[names.index("F3-C3")]), 90)
    assert 0.8 <= far / bg <= 2.2, far / bg


def test_hyperventilation_and_sreda_run_for_their_clinical_durations():
    """Re-review: HV 30 s authored (real 180-300 s); SREDA 15 s (real 40-80 s).  A short authored window becomes the
    end of a minimum-length run, so the authored page keeps the peak."""
    S = _vsyn(611010, [_var("hyperventilation_buildup", 5.0, 30.0, context="hyperventilation")])
    run = S._authored_variants[0]
    assert run["t1"] == pytest.approx(330.0) and run["t1"] - run["t0"] >= 180.0 - 1e-6
    A = _vsyn(611006, [_var("sreda", 5.0, 15.0, context="adult_teaching")], age="adult")
    run = A._authored_variants[0]
    assert run["t1"] - run["t0"] >= 40.0 - 1e-6 and run["t1"] == pytest.approx(315.0)


def test_lambda_is_occipital_and_its_saccade_shows():
    """Re-review V110-02: T3-T5 / T4-T6 at or above T5-O1; the timing saccade 15-17 uV at F7-T3
    (lambda-waves-at-10uV-2: obvious)."""
    S = _vsyn(611002, [_var("lambda", 5.0, 15.0, context="visual_scanning")])
    names, d = _comp(S, S._authored_variant_rows, 302.0, 313.0)
    p = {n: np.percentile(_p2p_1s(d[names.index(n)]), 75) for n in names}
    assert p["T5-O1"] > 1.5 * p["T3-T5"] and p["T6-O2"] > 1.5 * p["T4-T6"]
    assert max(p["F7-T3"], p["Fp1-F7"]) >= 35.0
