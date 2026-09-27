"""Phase B sleep fix (spec_version 3): arousals, pediatric N2 / K-complexes, fast spindles, hypnagogic hypersynchrony,
neonatal LVI, propofol, FAR, RMTD, hyperventilation and the awake child background.

Reviews: research/eeg-atlas/feature-review-20260926/sleep-independent.md and variants-neonatal-r3.md; measurements
before / after in sleep-fix.md.  References are named in each test.
"""
import numpy as np
import pytest
from scipy import signal as sps

from eeg_render import montage as mt
from eeg_render.export.manifest import realized_events
from eeg_render.render_page import apply_filters, build_filters
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer

from test_r050_sleep import FS, _comp, _disp, _mk, _p2p_1s, _vsyn, _var


def _sos(lo, hi, o=4):
    return sps.butter(o, [lo, hi], "bandpass", fs=FS, output="sos")


def _ref(S, t0, t1, elecs, ref=("A1", "A2"), lf=0.3, hf=70.0):
    _, x = S.segment(t0 - 10, t1)
    d = apply_filters(S.derive(x, [(e, ref) for e in elecs], "x"), build_filters(FS, {"lf_hz": lf, "hf_hz": hf}, True), True)
    return d[:, 10 * FS:]


def _rms(v):
    return float(np.sqrt(np.mean(v ** 2)))


@pytest.fixture(scope="module")
def CHILD():
    return _mk("child", seed=314159)


@pytest.fixture(scope="module")
def INFANT():
    return _mk("infant", seed=141421)


# ----------------------------------------------------------------------------------------------- arousals --
def test_arousal_gates_off_sleep_transients_and_is_an_abrupt_emg_alpha_burst(CHILD):
    """sleep-independent.md: slow waves, K-complexes and spindles ran on under the arousal (delta ratio up to 4.9) and
    the arousal was alpha plus modest EMG.  learningeeg normal-asleep arousal: an abrupt massive EMG / movement burst
    and the delta gone; AASM: an abrupt shift to alpha / theta / > 16 Hz for >= 3 s."""
    S = CHILD
    names = [f"{a}-{b}" for a, b in mt.montage_pairs("longitudinal_bipolar", S.scalp)]
    delta, emg, alpha, moved = [], [], [], []
    for a, w, _g, _tau, moves in S._aro_burst:
        if a < 700 or S.stage_at(np.array([a - 2.0]))[0] not in ("N2", "N3"):
            continue
        moved.append(bool(moves))
        _, d = _disp(S, a - 6, a + 6)
        i = 6 * FS
        e = sps.sosfiltfilt(_sos(30, 70), d[names.index("F7-T3")])
        al = sps.sosfiltfilt(_sos(8, 12), d[names.index("P3-O1")])
        emg.append(_rms(e[i:i + 3 * FS]) / _rms(e[:i - FS]))
        alpha.append(_rms(al[i:i + 3 * FS]) / _rms(al[:i - FS]))
        if not moves:          # the movement transient is not delta; score delta where there is none
            f4 = sps.sosfiltfilt(_sos(0.5, 2.0, 3), _ref(S, a - 6, a + 6, ["F4"], ref="A1", hf=35.0)[0])
            delta.append(_rms(f4[i + FS // 2:i + 3 * FS]) / _rms(f4[i - 3 * FS:i - FS // 2]))
    assert len(emg) >= 6 and len(delta) >= 3
    assert np.median(delta) <= 0.7 and max(delta) <= 1.3, delta
    assert np.median(emg) >= 4.0, emg
    assert np.median(alpha) >= 2.0, alpha
    assert 0.3 <= np.mean(moved) <= 0.9


def test_arousal_burst_is_window_independent(CHILD):
    a = next(x for x, _w, _g, _t, m in CHILD._aro_burst if x > 700 and m)
    _, x1 = CHILD.segment(a - 2.0, a + 6.0)
    _, x2 = CHILD.segment(a - 7.3, a + 9.0)
    k = int(round(5.3 * FS))
    assert np.allclose(x1, x2[:, k:k + x1.shape[1]], atol=1e-6)


# ------------------------------------------------------------------------------------- pediatric N2 / N3 --
def _aasm(S, st, max_epochs):
    """AASM N3 criterion per 30-s epoch on F4-A1 (0.3-35 Hz): > 20 % of the epoch in 0.5-2 Hz waves >= 75 uV."""
    lp = _sos(0.3, 2.5, 3)
    eps = []
    for a, b, s in S._hypno:
        if s != st or b - a < 90 or b < 60:
            continue
        a = max(a, 0.0)
        n = min(int((b - a - 10) // 30), max_epochs - len(eps))
        if n < 1:
            continue
        sig = sps.sosfiltfilt(lp, _ref(S, a + 5, a + 5 + 30 * n, ["F4"], ref="A1", hf=35.0)[0])
        zc = np.nonzero(np.diff(np.sign(sig)) != 0)[0]
        cov = np.zeros(sig.size, bool)
        for i in range(len(zc) - 2):
            if 0.5 <= (zc[i + 2] - zc[i]) / FS <= 2.0 and np.ptp(sig[zc[i]:zc[i + 2]]) >= 75.0:
                cov[zc[i]:zc[i + 2]] = True
        eps += [cov[j * 30 * FS:(j + 1) * 30 * FS].mean() for j in range(n)]
    return np.array(eps)


def test_pediatric_n2_rarely_scores_as_n3_while_n3_does(CHILD, INFANT):
    """sleep-independent.md: 44-64 % (child) and 34-72 % (infant) of N2 epochs met the AASM N3 criterion on an ear
    reference; target under 20 %, with N3 still well over 20 % (AASM; learningeeg Bad-Fp1-electrode-during-SWS)."""
    for S in (CHILD, INFANT):
        n2, n3 = _aasm(S, "N2", 60), _aasm(S, "N3", 20)
        assert n2.size >= 40 and np.mean(n2 > 0.2) < 0.2, np.mean(n2 > 0.2)
        assert np.mean(n3 > 0.2) >= 0.9


def _kc_sizes(S, n_max=12):
    others = np.concatenate([S._vx_t, S._kc_t])
    names = [f"{a}-{b}" for a, b in mt.montage_pairs("longitudinal_bipolar", S.scalp)]
    fz, fc = [], []
    for tt in S._kc_t:
        if (tt < 700 or len(fz) >= n_max or S.stage_at(np.array([tt]))[0] != "N2"
                or np.sum(np.abs(others - tt) < 2.0) > 1 or any(a - 2 < tt < a + w + 2 for a, w in S._arousals_v3)):
            continue
        fz.append(np.ptp(_ref(S, tt - 1, tt + 2, ["Fz"])[0]))
        _, d = _disp(S, tt - 1, tt + 2)
        fc.append(np.ptp(d[names.index("F3-C3")]))
    return np.median(fz), np.median(fc)


def test_k_complexes_are_pediatric_sized_and_the_adult_size_is_kept(CHILD, INFANT):
    """sleep-independent.md: Fz 650-900 uV referential in children (a KC overwrote four channels at 10 uV/mm); target
    a realistic pediatric 200-400 uV.  Adult kept at the eegatlas-online #113 size (about 150-200 uV bipolar)."""
    for S in (CHILD, INFANT):
        fz, _ = _kc_sizes(S)
        assert 200.0 <= fz <= 420.0, fz
    A = _mk("adult", seed=9091907)
    _, fc = _kc_sizes(A)
    assert 120.0 <= fc <= 230.0, fc


def test_fast_spindles_are_parietal(CHILD):
    """sleep-independent.md: fast group F3-C3 / P3-O1 0.69-0.87; learningeeg Spindles: the fast spindle is largest in
    P3-O1 / T5-O1 / T6-O2 with F3-C3 about 0.3-0.4 of that (De Gennaro & Ferrara 2003)."""
    S = CHILD
    bp = _sos(10, 16.5)
    a, b = next((a, b) for a, b, s in S._hypno if s == "N2" and b - a > 300 and a > 0)
    t0, t1 = a + 30, a + 330
    names, d = _comp(S, S._spindle_rows_v3, t0, t1)
    env = np.abs(sps.hilbert(sps.sosfiltfilt(bp, d, axis=1), axis=1))
    tt = t0 + np.arange(d.shape[1]) / FS
    r = []
    for k, ts in enumerate(S._sp_t):
        du = S._sp["dur"][k]
        if S._sp["slow"][k] or ts < t0 + 1 or ts + du > t1 - 1 or np.any((np.abs(S._sp_t - ts) < du + 0.5) & (S._sp_t != ts)):
            continue
        m = (tt >= ts - 0.4) & (tt < ts + du + 0.4)
        r.append(env[names.index("F3-C3"), m].max() / env[names.index("P3-O1"), m].max())
    assert len(r) >= 8 and 0.25 <= np.median(r) <= 0.5, np.median(r)


# ------------------------------------------------------------------------------- hypnagogic hypersynchrony --
def test_hypnagogic_hypersynchrony_runs_are_long_and_dominate_the_page():
    """sleep-independent.md: infant runs 2-5 s at about 2x background; learningeeg Hypnapompic-Hypersynchrony: a > 10-s
    paroxysmal run that dominates the page.  Target runs 5-15 s at about 3x background.  r6: paroxysmal bursts of 1-10 s
    (median 6 s, 2-10 s), so the median bound is 5-9 s and the 10th percentile >= 3 s."""
    S = _mk("infant", minutes=40, seed=515151, variants={"hypnagogic_hypersynchrony": {"enabled": True}})
    runs = [r for nm, r in S._variants_v3 if nm == "hypnagogic_hypersynchrony" and r["t0"] > 60]
    durs = np.array([r["t1"] - r["t0"] for r in runs])
    assert len(runs) >= 5 and 5.0 <= np.median(durs) <= 9.0 and np.percentile(durs, 10) >= 3.0, durs
    ratios = []
    for r in runs[:6]:
        _, d = _disp(S, r["t0"] - 6, r["t1"])
        k = 6 * FS
        ev = np.median([np.median(_p2p_1s(row[k + FS:-FS])) for row in d])
        pre = np.median([np.median(_p2p_1s(row[:k - FS])) for row in d])
        ratios.append(ev / pre)
    assert np.median(ratios) >= 2.7, ratios


# --------------------------------------------------------------------------------------------- neonatal LVI --
def _neo(seed=4242, minutes=120):
    img = {"kind": "qeeg_panel", "license": "synthetic-original", "attribution": None,
           "spec": {"sample_rate": FS, "channels": "standard_19", "seed": seed, "spec_version": 3, "age_group": "neonate",
                    "duration_min": minutes, "background": {"type": "continuous", "pma_weeks": 40, "state_cycle": "term"},
                    "events": []}}
    return Synthesizer(normalize(img)["spec"], minutes * 60.0)


def test_neonatal_active_sleep_has_low_voltage_irregular_stretches():
    """sleep-independent.md: no distinctly low-voltage irregular segment (AS 65-80 uV throughout).  ACNS 2013 neonatal
    terminology (Tsuchida 2013): LVI, low-voltage irregular activity clearly lower than the mixed activity, theta-rich;
    target about 0.5x the active-sleep voltage."""
    S = _neo()
    assert S._lvi
    pairs = mt.montage_pairs("neonatal_reduced", S.scalp)

    def meas(t0, t1):
        _, x = S.segment(t0 - 10, t1)
        d = apply_filters(S.derive(x, pairs, "neonatal_reduced"), build_filters(FS, {"lf_hz": 0.5, "hf_hz": 70}, True), True)
        d = d[:, 10 * FS:]
        f, P = sps.welch(d, FS, nperseg=2 * FS, axis=1)
        p = P.mean(0)
        return np.median([np.median(_p2p_1s(r)) for r in d]), p[(f >= 4) & (f < 8)].sum() / p[(f >= 0.5) & (f < 8)].sum()
    a, b = S._lvi[0]
    s0 = next(x0 for x0, x1, lab in S._state_intervals if lab == "active_sleep" and x0 <= a < x1)
    p_l, th_l = meas(a + 15, a + 75)
    p_a, th_a = meas(s0 + 20, s0 + 80)
    assert 0.35 <= p_l / p_a <= 0.65, (p_l, p_a)
    assert th_l >= th_a + 0.08, (th_l, th_a)
    rows = [r for r in realized_events(S, 7200.0) if r.get("label") == "active_sleep_low_voltage_irregular"]
    assert len(rows) == len([1 for x0, x1 in S._lvi if x0 < 7200.0])
    _, x1 = S.segment(a - 5.0, a + 15.0)
    _, x2 = S.segment(a - 12.5, a + 20.0)
    k = int(round(7.5 * FS))
    assert np.allclose(x1, x2[:, k:k + x1.shape[1]], atol=1e-6)


# ------------------------------------------------------------------------------------------------- propofol --
def test_propofol_replaces_sleep_architecture():
    """sleep-independent.md / sedation.md R6-R7: under propofol 0.8 the hypnogram still drew N1 -> N2 -> N3 and five
    arousals were scheduled and keyed.  A hypnotic replaces sleep architecture: no N3, no REM, no arousals."""
    S = _mk("child", minutes=60, seed=424243, amplitude_uv=50)
    img = {"kind": "qeeg_panel", "license": "synthetic-original", "attribution": None,
           "spec": {"sample_rate": FS, "channels": "standard_19", "seed": 424243, "spec_version": 3, "age_group": "child",
                    "duration_min": 60, "background": {"type": "continuous", "reactivity": "present", "amplitude_uv": 50},
                    "sedation": {"agent": "propofol", "level": 0.8},
                    "events": [{"type": "state_change", "at_min": 10, "to": "sleep"}]}}
    P = Synthesizer(normalize(img)["spec"], 3600.0)
    assert {st for _a, _b, st in S._hypno} >= {"N3"} and S._arousals_v3          # the same record undrugged
    assert not {st for _a, _b, st in P._hypno} & {"N3", "R"} and not P._arousals_v3
    rows = realized_events(P, 3600.0)
    assert not [r for r in rows if r["kind"] == "arousal"]
    assert not [r for r in rows if r["kind"] == "sleep_stage" and r["label"] in ("N3", "R")]


# ------------------------------------------------------------------------------------------ variants (r3) --
def test_frontal_arousal_rhythm_follows_a_marked_arousal_and_differs_from_spindles():
    """variants-neonatal-r3 V110-08: FAR read as the spindles before it (1.3-2 s frontal trains, 1.3x by eye) and the
    arousal onset was unmarked.  White & Tharp 1974: 7-10 Hz frontal trains after an arousal from sleep; r3 target: at
    least 2x background, trains of 3 s or more, an abrupt arousal (EMG / movement burst) at onset."""
    S = _vsyn(611008, [{"type": "state_change", "at_min": 5.0, "to": "arousal"},
                       _var("frontal_arousal_rhythm", 5.0, 15.0, context="arousal")])
    run = S._authored_variants[0]
    trains = [b for b in run["bursts"] if b["amp"] > 0.3 * run["amplitude_uv"]]
    assert np.median([b["t1"] - b["t0"] for b in trains]) >= 3.0
    assert all(7.0 <= b["hz"] <= 10.0 for b in trains)
    assert min(b["t0"] for b in trains) >= 300.0 + 1.0                     # after the arousal burst
    names, full = _disp(S, 292.0, 302.0)
    k = 8 * FS
    e = sps.sosfiltfilt(_sos(30, 70), full[names.index("F7-T3")])
    assert _rms(e[k:k + 2 * FS]) >= 2.5 * _rms(e[:k - FS])                   # arousal onset marked
    bg = np.median(_p2p_1s(full[names.index("F3-C3")][:k - FS]))
    nm, ev = _comp(S, S._authored_variant_rows, run["t0"], run["t1"])
    far = np.percentile(_p2p_1s(ev[nm.index("F3-C3")]), 90)
    assert 1.8 <= far / bg <= 3.2, far / bg
    assert np.ptp(ev[nm.index("F3-C3")]) > 2.0 * np.ptp(ev[nm.index("P3-O1")])     # frontal


def test_rmtd_is_mid_temporal_maximal():
    """variants-neonatal-r3 V110-05: Fp1-F7 83 = T3-T5 85 uV (front-heavy).  learningeeg RMTD_1 / RMTD-on-the-right:
    mid-temporal maximum, so F7-T3 / T3-T5 carry it and the end links less."""
    S = _vsyn(611005, [{"type": "state_change", "at_min": 5.0, "to": "sleep"},
                       _var("rmtd", 5.5, 15.0, context="drowsy")])
    run = S._authored_variants[0]
    nm, ev = _comp(S, S._authored_variant_rows, run["t0"], run["t1"])
    p = {n: np.percentile(_p2p_1s(ev[nm.index(n)]), 90) for n in nm}
    for mid, ends in ((("F7-T3", "T3-T5"), ("Fp1-F7", "T5-O1")), (("F8-T4", "T4-T6"), ("Fp2-F8", "T6-O2"))):
        assert min(p[c] for c in mid) >= 1.6 * max(p[c] for c in ends), p


def test_hyperventilation_buildup_is_irregular_polymorphic_delta():
    """variants-neonatal-r3 V110-10: a pure 3.2-Hz sine (half-waves 156 / 156 ms).  learningeeg hv-slowing: irregular
    high-voltage 1.5-3 Hz delta of varying period and amplitude."""
    S = _vsyn(611010, [_var("hyperventilation_buildup", 5.0, 30.0, context="hyperventilation")])
    nm, ev = _comp(S, S._authored_variant_rows, 300.0, 325.0)
    x = ev[nm.index("Fp1-F3")]
    f, P = sps.welch(x, FS, nperseg=4 * FS)
    band = (f >= 0.5) & (f <= 6.0)
    # before: 1 % of 0.5-6 Hz power in 1-2.5 Hz, peak 3.5 Hz, half-waves 133 / 156 / 184 ms (p10 / 50 / 90)
    assert P[(f >= 1.0) & (f < 2.5)].sum() / P[band].sum() >= 0.3
    assert 1.5 <= f[band][np.argmax(P[band])] <= 3.0
    lo = sps.sosfiltfilt(_sos(0.5, 6.0, 3), x)
    half = np.diff(np.nonzero(np.diff(np.sign(lo)) != 0)[0]) / FS
    assert np.median(half) >= 0.18 and np.percentile(half, 90) - np.percentile(half, 10) >= 0.09, half


def _awake_child():
    img = {"kind": "eeg_page", "license": "synthetic-original", "attribution": None,
           "spec": {"sample_rate": FS, "channels": "standard_19", "duration_min": 10, "seed": 515401, "age_group": "child",
                    "spec_version": 3, "events": [],
                    "background": {"type": "continuous", "amplitude_uv": 50.0, "dominant_hz": 9.0, "slow_fraction": 0.4,
                                   "reactivity": "present", "channel_gain_max": 1.5, "pdr_gain": 3.0}}}
    return Synthesizer(normalize(img)["spec"], 600.0)


def test_awake_child_background_is_polyrhythmic_with_intermittent_muscle():
    """variants-neonatal-r3 awake child vs learningeeg 5yo-F-posterior-slow-wave-of-youth-2 / posterior-slow-waves-of-
    youth-again: the PDR is broken up by theta, theta runs through the midline (pixel theta share 0.41-0.46), and fast
    activity is intermittent.  Before: eyes-closed P-O alpha 0.72 and midline theta 0.18 of 1-30 Hz power, temporal EMG
    continuous (1-s RMS CV 0.25)."""
    S = _awake_child()
    closed = [(a + 1.0, b - 0.5) for a, b, st in S._eyes if st == "closed" and b - a > 4.0 and a > 20.0][:6]
    po, mid = [], []
    for a, b in closed:
        names, d = _disp(S, a, b)
        f, P = sps.welch(d, FS, nperseg=2 * FS, axis=1)
        tot = lambda p: p[(f >= 1) & (f < 30)].sum()  # noqa: E731
        p = P[[names.index(c) for c in ("P3-O1", "P4-O2", "T5-O1", "T6-O2")]].mean(0)
        po.append(p[(f >= 8) & (f < 13)].sum() / tot(p))
        p = P[[names.index(c) for c in ("Fz-Cz", "Cz-Pz")]].mean(0)
        mid.append(p[(f >= 4) & (f < 8)].sum() / tot(p))
    assert len(closed) >= 3
    assert np.mean(po) <= 0.66, np.mean(po)
    assert np.mean(mid) >= 0.33, np.mean(mid)
    names, d = _disp(S, 120.0, 300.0)
    e = sps.sosfiltfilt(_sos(30, 70), d[names.index("F7-T3")])
    w = np.array([_rms(e[i:i + FS]) for i in range(0, e.size - FS, FS)])
    assert w.std() / w.mean() >= 0.45, w.std() / w.mean()
    _, x1 = S.segment(200.0, 210.0)
    _, x2 = S.segment(193.7, 215.0)
    k = int(round(6.3 * FS))
    assert np.allclose(x1, x2[:, k:k + x1.shape[1]], atol=1e-6)
