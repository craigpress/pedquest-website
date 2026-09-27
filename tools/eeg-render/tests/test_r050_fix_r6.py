"""r6 generator fixes (spec_version 3 only): hypnagogic hypersynchrony, the fast activity of an infantile spasm, and
the term tracé-alternant cycle.  Open items of r5-background.md ("HH comb", "TA contrast") and focal-fix.md /
r5-seizures.md ("spasm riding fast regularity: partly").  Before / after numbers (29fb4d2 vs this branch) are in
research/eeg-atlas/feature-review-20260926/r6-fix.md, harness renders/phaseB/r6/r6check.py and hhprobe.py.
"""
import copy

import numpy as np
import pytest
from scipy import signal as sps

from eeg_render import montage as mt
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer

import test_r050_neonatal as N
from test_r050_sleep import FS, _disp, _mk, _p2p_1s


def _bp(x, lo, hi):
    return sps.sosfiltfilt(sps.butter(4, [lo, hi], "band", fs=FS, output="sos"), x, axis=-1)


# ------------------------------------------------------------------------------- hypnagogic hypersynchrony --
@pytest.fixture(scope="module")
def HH():
    return _mk("infant", minutes=40, seed=515151, variants={"hypnagogic_hypersynchrony": {"enabled": True}})


def _hh_runs(S, min_s=0.0):
    return [r for nm, r in S._variants_v3 if nm == "hypnagogic_hypersynchrony" and r["t0"] > 60
            and r["t1"] - r["t0"] >= min_s]


def test_hh_runs_are_paroxysmal_bursts_of_1_to_10_s(HH):
    """Paroxysmal runs of 1-10 s (29fb4d2: 5-15 s, max 12.5 s on this record)."""
    d = np.array([r["t1"] - r["t0"] for r in _hh_runs(HH)])
    assert d.size >= 8 and d.min() >= 1.0 and d.max() <= 10.0 and 4.0 <= np.median(d) <= 8.0, d


def test_hh_is_maximal_fronto_central(HH):
    """HH is maximal fronto-centrally.  Component RMS at F3/F4/C3/C4/Fz/Cz over P3/P4/O1/O2/T5/T6 (29fb4d2: 1.30)."""
    el = list(HH.electrodes)
    fc = [el.index(e) for e in ("F3", "F4", "C3", "C4", "Fz", "Cz")]
    po = [el.index(e) for e in ("P3", "P4", "O1", "O2", "T5", "T6")]
    ratios = []
    for r in _hh_runs(HH, 3.0)[:6]:
        t = np.arange(int(r["t0"] * FS), int(r["t1"] * FS)) / FS
        rms = np.sqrt(np.mean(HH._variant_rows(t) ** 2, axis=1))
        ratios.append(rms[fc].mean() / rms[po].mean())
    assert np.median(ratios) >= 2.0, np.round(ratios, 2)


def test_hh_cycles_jitter_and_wax_and_wane(HH):
    """Rhythmic 3-5 Hz waves with cycle-to-cycle jitter in period and amplitude and a waxing / waning envelope, not a
    comb.  On the F3 / C4 component (1-15 Hz, 1 s after onset to 0.5 s before the end), 29fb4d2 had a 6-15 Hz rider
    share of 0.086 and neighbouring waves alternating in size (lag-1 autocorrelation of per-cycle p2p -0.13): the
    interference of a 0.55x sub-harmonic, a 2x harmonic and a 7-9 Hz rider.  Here: waves of related but unequal size
    (autocorrelation >= 0.3, CV >= 0.2), period CV >= 0.10, rider share <= 0.04, zero-crossing rate 3-5 Hz."""
    el = list(HH.electrodes)
    zf, hi, pcv, acv, aac = [], [], [], [], []
    for r in _hh_runs(HH, 3.0)[:8]:
        a, b = r["t0"] + 1.0, r["t1"] - 0.5
        t = np.arange(int((a - 3) * FS), int((b + 3) * FS)) / FS
        rows = HH._variant_rows(t)
        k = (t >= a) & (t < b)
        for e in ("F3", "C4"):
            y = _bp(rows[el.index(e)], 1.0, 15.0)[k]
            zc = np.nonzero((y[:-1] < 0) & (y[1:] >= 0))[0]
            per = np.diff(zc) / FS
            amp = np.array([np.ptp(y[i:j]) for i, j in zip(zc[:-1], zc[1:])])
            zf.append(zc.size / (y.size / FS))
            f, p = sps.welch(y, FS, nperseg=min(y.size, 2 * FS))
            hi.append(p[(f > 6) & (f < 15)].sum() / p[(f >= 1) & (f < 15)].sum())
            pcv.append(per.std() / per.mean())
            acv.append(amp.std() / amp.mean())
            aac.append(np.corrcoef(amp[:-1], amp[1:])[0, 1])
    assert 3.0 <= np.median(zf) <= 5.0, np.median(zf)
    assert np.median(hi) <= 0.04, np.median(hi)
    assert np.median(pcv) >= 0.10, np.median(pcv)
    assert np.median(acv) >= 0.20 and np.median(aac) >= 0.30, (np.median(acv), np.median(aac))


def test_hh_is_high_voltage_on_the_page(HH):
    """100-200+ uV: median 1-s p2p in the best longitudinal-bipolar derivation 150-400 uV (29fb4d2: 316)."""
    best = []
    for r in _hh_runs(HH, 2.5)[:6]:
        names, d = _disp(HH, r["t0"] + 0.8, r["t1"] - 0.3)
        best.append(max(np.median(_p2p_1s(row)) for row in d))
    assert 150.0 <= np.median(best) <= 400.0, np.round(best)


def test_hh_is_window_independent(HH):
    r = _hh_runs(HH, 3.0)[0]
    a = np.floor(r["t0"]) - 3.0
    b = a + 2.0 * np.ceil((r["t1"] + 3.0 - a) / 2.0)
    whole = HH.segment(a, b)[1]
    parts = np.concatenate([HH.segment(t, t + 2.0)[1] for t in np.arange(a, b - 1e-9, 2.0)], axis=1)
    assert np.max(np.abs(whole - parts)) < 1e-9


# ------------------------------------------------------------------------------------ spasm fast activity --
INFANT = dict(type="continuous", amplitude_uv=60.0, dominant_hz=6.0, slow_fraction=0.5)


def _spasm_syn(version=3):
    img = {"kind": "eeg_page", "license": "synthetic-original", "attribution": None,
           "spec": {"sample_rate": FS, "channels": "standard_19", "seed": 926004, "spec_version": version,
                    "age_group": "infant", "duration_min": 5, "background": copy.deepcopy(INFANT),
                    "events": [dict(type="spasm_cluster", onset_min=2.0, interval_s=9.0, count=8)]}}
    return Synthesizer(normalize(img)["spec"], 300.0)


@pytest.fixture(scope="module")
def SP():
    return _spasm_syn()


def _spasm_fast(syn, n=6):
    pairs = mt.montage_pairs("longitudinal_bipolar", syn.scalp)
    names = [f"{a}-{b}" for a, b in pairs]
    for z in sorted([q for q in syn.seizures if q.kind == "spasm"], key=lambda q: q.t0)[:n]:
        t = np.arange(int((z.t0 - 2) * FS), int((z.t0 + z.duration_s + z.decrement_s + 2) * FS)) / FS
        d = syn.derive(syn._spasm_rows_v3(z, t), pairs)
        yield z, t - z.t0, d, names


def test_spasm_decrement_fast_activity_waxes_and_wanes_irregularly(SP):
    """S1 (infantile-spasm-craig-20260926): the low-voltage fast activity comes in irregular bursts.  29fb4d2: two
    beating sines per electrode, an even ripple at page scale.  On the spasm component (Cz-Pz, F3-C3, C3-P3, P4-O2,
    14-30 Hz, the decrement 0.4 s after the wave to 0.3 s before its end): Hilbert-envelope CV 0.48 and the CV of
    its 0.25-s moving average 0.24 before; now >= 0.6 and >= 0.4."""
    cv, slow = [], []
    for z, tt, d, names in _spasm_fast(SP):
        k = (tt >= z.duration_s + 0.4) & (tt < z.duration_s + z.decrement_s - 0.3)
        for c in ("Cz-Pz", "F3-C3", "C3-P3", "P4-O2"):
            env = np.abs(sps.hilbert(_bp(d[names.index(c)], 14, 30)))[k]
            cv.append(env.std() / env.mean())
            sm = np.convolve(env, np.ones(FS // 4) / (FS // 4), mode="valid")
            slow.append(sm.std() / sm.mean())
    assert np.median(cv) >= 0.6 and np.median(slow) >= 0.4, (np.median(cv), np.median(slow))


def test_spasm_fast_activity_keeps_its_band_and_irregular_period(SP):
    """Beta, not a sinusoid: the decrement's 14-30 Hz peak stays at 15-23 Hz, half-period CV >= 0.12 on the decrement
    and >= 0.10 on the wave (0.2-0.8 x the spasm duration), instantaneous-frequency CV >= 0.08."""
    pk, hp_d, hp_w, ifc = [], [], [], []
    for z, tt, d, names in _spasm_fast(SP):
        for c in ("Cz-Pz", "F3-C3", "C3-P3"):
            y = _bp(d[names.index(c)], 14, 30)
            for store, a, b in ((hp_w, 0.2 * z.duration_s, 0.8 * z.duration_s),
                                (hp_d, z.duration_s + 0.4, z.duration_s + z.decrement_s - 0.3)):
                w = y[(tt >= a) & (tt < b)]
                h = np.diff(np.nonzero(np.diff(np.signbit(w)))[0])
                store.append(h.std() / h.mean())
            k = (tt >= z.duration_s + 0.4) & (tt < z.duration_s + z.decrement_s - 0.3)
            f, p = sps.welch(y[k], FS, nperseg=FS, nfft=4 * FS)
            pk.append(f[np.argmax(p)])
            inst = sps.medfilt(np.diff(np.unwrap(np.angle(sps.hilbert(y))))[k[1:]] * FS / (2 * np.pi), 9)
            ifc.append(inst.std() / inst.mean())
    assert 15.0 <= np.median(pk) <= 23.0, pk
    assert np.median(hp_d) >= 0.12 and np.median(hp_w) >= 0.10, (np.median(hp_d), np.median(hp_w))
    assert np.median(ifc) >= 0.08, np.median(ifc)


def test_spasm_fast_is_window_independent(SP):
    z = sorted([q for q in SP.seizures if q.kind == "spasm"], key=lambda q: q.t0)[1]
    a = np.floor(z.t0) - 1.0
    b = a + 1.5 * np.ceil((z.t0 + z.duration_s + z.decrement_s + 1.0 - a) / 1.5)
    whole = SP.segment(a, b)[1]
    parts = np.concatenate([SP.segment(t, t + 1.5)[1] for t in np.arange(a, b - 1e-9, 1.5)], axis=1)
    assert np.max(np.abs(whole - parts)) < 1e-9


# ------------------------------------------------------------------------------------- term tracé alternant --
@pytest.fixture(scope="module")
def TA():
    return N.S("B1-01")


def test_term_trace_alternant_cycle(TA):
    """Term TA: bursts 3-8 s alternating with 4-8-s interbursts (29fb4d2 B1-01: scheduled IBI median 2.9 s, max 5.4 s).
    Scheduled quiet-sleep IBIs (the HVS opening excluded): median 4-7 s, 10th percentile >= 3 s, max <= 8 s, CV >= 0.15;
    burst median 3-8 s."""
    ibi = N._sched_ibis(TA, "quiet_sleep")
    st, en = TA._burst_start, TA._burst_end
    mid = 0.5 * (st + en)
    keep = (mid > 0) & (mid < TA.duration_s) & (TA.state_at(mid) == "quiet_sleep")
    for a, b in getattr(TA, "_hvs", []):
        keep &= ~((mid >= a - 10.0) & (mid < b + 10.0))
    bur = (en - st)[keep]
    assert ibi.size >= 40
    assert 4.0 <= np.median(ibi) <= 7.0 and np.percentile(ibi, 10) >= 3.0 and ibi.max() <= 8.0, np.median(ibi)
    assert ibi.std() / ibi.mean() >= 0.15
    assert 3.0 <= np.median(bur) <= 8.0 and np.percentile(bur, 10) >= 2.5, np.median(bur)


def test_term_trace_alternant_interburst_on_the_page(TA):
    """On the neonatal page: the envelope-derived interburst (normalized envelope < 0.5) lasts 4-8 s (29fb4d2: 2.8 s)
    and the pure interburst stays 25-50 uV (median over derivations of the 1-s p2p), not flat."""
    t0 = N._first_state(TA, "quiet_sleep", minlen=120)
    for a, b in getattr(TA, "_hvs", []):
        if a - 1.0 <= t0 < b:
            t0 = float(np.ceil(b + 15.0))
    d, _ = N._display(TA, t0, t0 + 120.0)
    tt = t0 + np.arange(d.shape[1]) / FS
    fl = TA._ibi_floor_at(tt)
    e = (TA.burst_envelope(tt) - fl) / np.maximum(1 - fl, 1e-6)
    low = e < 0.5
    edges = np.diff(np.r_[0, low.astype(int), 0])
    runs = ((np.nonzero(edges == -1)[0] - np.nonzero(edges == 1)[0]) / FS)[1:-1]
    assert runs.size >= 5 and 4.0 <= np.median(runs) <= 8.0, runs
    ib = [np.median(np.ptp(d[:, k:k + FS], axis=1)) for k in range(0, d.shape[1] - FS + 1, FS) if e[k:k + FS].max() < 0.1]
    assert len(ib) >= 10 and 25.0 <= np.median(ib) <= 50.0, np.median(ib)


def test_version_gates():
    """spec_version 2 keeps the 0.4.x term quiet-sleep cycle; 43 w (quiet sleep becoming continuous) keeps the day-3
    values under version 3."""
    def bs(version, pma, hours=60.0):
        img = N._image("B1-01", version)
        img["spec"]["background"] = dict(img["spec"]["background"], pma_weeks=pma, hours_of_life=hours)
        return normalize(img)["spec"]["background"]["burst_suppression"]
    assert bs(2, 40.0)["ibi_s"] == 3.5 and bs(2, 40.0)["burst_s"] == 4.5
    assert bs(3, 40.0)["ibi_s"] == 5.5 and bs(3, 40.0)["ibi_max_s"] == 8.0
    b43 = bs(3, 43.0, 200.0)
    assert (b43["ibi_s"], b43["burst_s"], b43["ibi_sigma"], b43["ibi_max_s"]) == (3.0, 4.5, 0.25, 6.0)
    assert bs(3, 40.0, 3.0)["ibi_s"] == 3.2          # first hours of life unchanged
