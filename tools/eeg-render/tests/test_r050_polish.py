"""0.5.0 phase D "polish": the remaining items of the v3 re-reviews for artifacts, neonatal and sedation.

Re-reviews (exact values): research/eeg-atlas/feature-review-20260926/artifacts-v3.md, neonatal-v3.md, sedation-v3.md.
Every measurement is on the displayed page (longitudinal bipolar through the causal display chain, or the neonatal
double banana at LFF 0.5 Hz), reusing each family's r050 test helpers so the page and the reference numbers match the
earlier families.  References are cached under research/eeg-atlas/references/cache/ (internal comparison only).
"""
import numpy as np
import pytest
from scipy import signal as sps

import test_r050_artifacts as A
import test_r050_neonatal as N
import test_r050_sedation as SD
from eeg_render.export.manifest import delta_brush_summary, realized_events
from eeg_render.render_page import page_signals
from eeg_render.spec import normalize


def _p2p_1s(d, fs):
    m = d.shape[1] // fs
    return np.ptp(d[:, : m * fs].reshape(d.shape[0], m, fs), axis=2)


# =============================================================================================== artifacts

def test_ecg_spike_concentrates_posteriorly():
    """ECG-artifact-on-an-uncalibrated-screen and Sweat-and-electrode-pop: sharp QRS-locked spikes concentrated in
    P3-O1, T5-O1 and Cz-Pz, none in the frontal chains.  artifacts-v3 A110-04: the linear 0.5x - 0.9y field drew the
    same 14-25 uV spike in 16 of 18 chains (largest relative to background in Fp2-F8/F4-C4)."""
    spec, synth, t, art, sig0, lab = A._page("ecg")
    fs = synth.fs
    beats = synth._beat_times(t[0], t[-1])
    beats = beats[(beats > t[0] + 0.2) & (beats < t[-1] - 0.5)]

    def spike(name):
        x = art[lab[name]]
        return float(np.median([np.ptp(x[int((b - 0.05 - t[0]) * fs):int((b + 0.08 - t[0]) * fs)]) for b in beats]))
    amp = {n: spike(n) for n in lab}
    post = [amp[n] for n in ("P3-O1", "T5-O1", "Cz-Pz")]
    frontal = [amp[n] for n in ("Fp1-F7", "Fp2-F8", "Fp1-F3", "Fp2-F4")]
    assert min(post) >= 18.0, amp                                     # 20-30 uV spikes (review: P3-O1 ~25, T5-O1 ~20)
    assert max(frontal) <= 3.0, amp                                   # none frontally
    assert np.median(post) >= 1.8 * np.median(list(amp.values())), amp     # was ~1.0: the same spike everywhere
    assert max(amp, key=amp.get) in ("P3-O1", "T5-O1", "Cz-Pz", "T3-T5")


def test_glossokinetic_reaches_the_parasagittal_chains_in_rolling_runs():
    """Tongue-Artifact: the rolling 1-2 Hz waves are as clear in C3-P3/P3-O1/P4-O2 and Fz-Cz/Cz-Pz as in the temporal
    chains, as near-continuous runs.  artifacts-v3 A110-11: parasagittal 0.25 rows (0.3-0.5x bg) and isolated 0.3-0.6 s
    single waves."""
    spec, synth, t, art, sig0, lab = A._page("glosso")
    row = A._row_uv(spec)
    para = ["C3-P3", "P3-O1", "C4-P4", "P4-O2", "Fz-Cz", "Cz-Pz"]
    temporal = ["F7-T3", "T3-T5", "F8-T4", "T4-T6"]
    p = {n: A._p2p(art[lab[n]]) for n in lab}
    assert min(p[n] for n in para) >= 0.8 * row, {n: round(p[n] / row, 2) for n in para}
    assert min(p[n] for n in para) >= 1.0 * A._bg(sig0, lab, "P3-O1")
    assert min(p[n] for n in para) >= 0.5 * np.mean([p[n] for n in temporal])
    sched = next(v for k, v in synth._art_events_v3.items() if k[1] == "glosso")
    a0, a1 = t[0], t[-1]
    on = sum(max(0.0, min(s[0] + s[1], a1) - max(s[0], a0)) for s in sched)
    assert on / (a1 - a0) >= 0.6                                      # near-continuous
    runs = np.array([s[1] for s in sched])
    assert np.median(runs) >= 1.0                                     # trains, not single waves
    cyc = np.concatenate([s[2][:, 1] for s in sched])
    assert 1.4 <= 1.0 / np.median(cyc) <= 2.6                         # 1.5-2.5 Hz


def test_movement_is_regional_and_page_sized():
    """shaking-head-artifact / chest-PT-artifact re-read (artifacts-v3 A110-08): 0.5-1.5 rows in the involved chains,
    posterior chains < 0.3 rows for a bifrontal or one-sided movement.  0.5.0 drew 3.4-5.8 rows in every chain."""
    spec, synth, t, art, sig0, lab = A._page("movement")
    row = A._row_uv(spec)
    lo = sps.sosfiltfilt(sps.butter(2, 8.0, "low", fs=synth.fs, output="sos"), art, axis=-1)
    sched = next(v for k, v in synth._art_events_v3.items() if k[1] == "move")
    tops = []
    for s in sched:
        if not (t[0] < s[0] and s[0] + s[2] < t[-1]):
            continue
        m = (t >= s[0]) & (t < s[0] + s[2] + 0.3)
        amp = {n: np.ptp(lo[i, m]) / row for n, i in lab.items()}
        tops.append(max(amp.values()))
        if s[8] in ("bifrontal", "left", "right"):
            assert max(amp[n] for n in ("P3-O1", "P4-O2", "T5-O1", "T6-O2", "Cz-Pz")) < 0.3
    assert 0.5 <= np.median(tops) <= 1.5 and max(tops) <= 2.0, tops
    # the whole page: no chain overrun by several rows any more
    assert max(A._p2p(art[i]) for i in lab.values()) <= 2.5 * row


BLINK_RECORDS = [(90511, "adult", 30.0, 10.0), (90512, "child", 50.0, 9.0), (90513, "child", 45.0, 8.5),
                 (90514, "adult", 35.0, 10.0), (90515, "infant", 60.0, 6.5), (90516, "child", 50.0, 9.0)]
MS = [-120, -100, -80, -60, -40, -20, 0, 20, 40, 60, 80, 100, 150, 200, 300, 400]


def _blink_page(seed, age, amp, dom, rate, at):
    bg = {"type": "continuous", "amplitude_uv": amp, "dominant_hz": dom, "slow_fraction": 0.3,
          "reactivity": "present", "blink_rate_per_min": rate}
    img = {"kind": "eeg_page", "license": "synthetic-original", "attribution": None,
           "spec": {"sample_rate": 256, "channels": "standard_19", "seed": seed, "spec_version": 3, "age_group": age,
                    "duration_min": 10, "at_min": at, "window_s": 30.0, "montage": "longitudinal_bipolar",
                    "sensitivity_uv_mm": 7.0, "background": bg, "events": []}}
    return page_signals(normalize(img)["spec"])


@pytest.fixture(scope="module")
def blinks():
    """Isolated eyes-open blinks on 12 awake v3 pages (6 records), Fp1-F3, as artifacts-v3 measured them."""
    peaks, ratios, shapes, hidden = [], [], [], 0
    for seed, age, amp, dom in BLINK_RECORDS:
        for at in (2.0, 5.0):
            synth, t, sig, pairs, _ = _blink_page(seed, age, amp, dom, 15.0, at)
            _, _, sig0, _, _ = _blink_page(seed, age, amp, dom, 0.0, at)
            r = next(i for i, p in enumerate(pairs) if tuple(p) == ("Fp1", "F3"))
            x, x0 = sig[r], sig0[r]
            bg = np.percentile(x0, 97.5) - np.percentile(x0, 2.5)
            fs = synth.fs
            pk = synth._blink_t + 0.10
            for i, p in enumerate(pk):
                if not (t[0] + 0.5 < p < t[-1] - 0.6):
                    continue
                if (i and p - pk[i - 1] < 0.7) or (i < len(pk) - 1 and pk[i + 1] - p < 0.7):
                    continue
                k = int(round((p - t[0]) * fs))
                k = k - int(0.05 * fs) + int(np.argmax(x[k - int(0.05 * fs):k + int(0.05 * fs)]))
                base = np.median(x[max(0, k - int(0.5 * fs)):k - int(0.2 * fs)])
                a = x[k] - base
                if a < 15.0:
                    hidden += 1
                    continue
                peaks.append(a / 73.2)
                ratios.append(a / bg)
                w = np.array([x[k + int(round(m / 1000 * fs))] for m in MS]) - base
                shapes.append(w / w[MS.index(0)])
    return np.array(peaks), np.array(ratios), np.array(shapes), hidden


def test_blink_amplitude_matches_the_reference_spacing(blinks):
    """artifacts-v3 blinks: eyes-open Fp1-F3 median 0.97 rows (3.5x bg) at 160 uV; reference 15 blinks in 6
    learningeeg figures: median 1.9 channel spacings (0.9-4.3) and 3-10x background."""
    peaks, ratios, _, _ = blinks
    assert peaks.size >= 30
    assert 1.5 <= np.median(peaks) <= 2.3, np.median(peaks)
    assert 3.0 <= np.median(ratios) <= 10.0, np.median(ratios)


def test_blink_fall_is_no_longer_slow(blinks):
    """Reference +40 ms median 0.43 (IQR 0.40-0.48, max 0.67); artifacts-v3 measured 0.66 with 42 % of blinks above the
    reference maximum, from a fall jitter U(0.8, 1.6) whose mean was 1.2."""
    _, _, shapes, _ = blinks
    at40 = shapes[:, MS.index(40)]
    assert np.median(at40) <= 0.60
    assert np.mean(at40 > 0.67) <= 0.30
    # the whole median contour stays inside the reference range (test_r050_blink_reference REF_LO/HI, +-0.05)
    import test_r050_blink_reference as BR
    med = np.median(shapes, axis=0)
    assert all(lo - 0.05 <= v <= hi + 0.05 for v, lo, hi in zip(med, BR.REF_LO, BR.REF_HI)), np.round(med, 2)


def test_blink_fall_jitter_is_centred_on_one():
    synth, *_ = _blink_page(90512, "child", 50.0, 9.0, 15.0, 2.0)
    j = synth._blink_sf / 0.045
    assert 0.95 <= j.mean() <= 1.12 and j.max() <= 1.6 + 1e-9


def test_no_blinks_behind_closed_eyes():
    """artifacts-v3: 64 of 128 blinks were 5-16 uV frontal V's drawn at 0.1 gain while the eyes were closed."""
    synth, *_ = _blink_page(90512, "child", 50.0, 9.0, 15.0, 2.0)
    closed = [bt for bt in synth._blink_t if 20 < bt < 580
              and float(synth._eye_factor(np.array([bt + 0.1]))[1][0]) == 0.0]
    assert len(closed) >= 3
    for bt in closed[:5]:
        tt = np.linspace(bt - 0.3, bt + 0.5, 200)
        _, gate = synth._eye_factor(tt)
        assert np.abs(synth.blink_rows(tt, gate)).max() < 1e-9


def test_c16_chewing_no_longer_saturates():
    """P5 C16 ("high" chewing): Craig accepted it at 1.6-2.2 rows in the outer temporal chains (renderer 0.4.1);
    artifacts-v3 measured 11 rows (saturating) on the v3 chewing model.  chewing-artifact-2 shows several spacings in
    every chain, so the target is 1.5-4 rows temporal, visible parasagittally."""
    import copy
    base = {"type": "continuous", "amplitude_uv": 50.0, "dominant_hz": 9.0, "slow_fraction": 0.4,
            "reactivity": "present", "pdr_gain": 3.0, "channel_gain_max": 1.5}
    ev = {"type": "artifact", "kind": "emg_chewing", "at_min": 10.0, "duration_s": 30, "intensity": "high"}

    def sig(events):
        img = {"kind": "eeg_page", "license": "synthetic-original", "attribution": None,
               "spec": {"sample_rate": 256, "channels": "standard_19", "seed": 515404, "spec_version": 3,
                        "age_group": "child", "duration_min": 30, "at_min": (600 - 3) / 60.0, "window_s": 15.0,
                        "montage": "longitudinal_bipolar", "sensitivity_uv_mm": 7.0, "background": copy.deepcopy(base),
                        "events": events}}
        return page_signals(normalize(img)["spec"])
    _, t, a, pairs, _ = sig([ev])
    _, _, b, _, _ = sig([])
    names = [f"{x}-{y}" for x, y in pairs]
    rows = {n: A._p2p((a - b)[i]) / 73.2 for i, n in enumerate(names)}
    temporal = ["Fp1-F7", "F7-T3", "T3-T5", "T5-O1", "Fp2-F8", "F8-T4", "T4-T6", "T6-O2"]
    assert 1.5 <= min(rows[n] for n in temporal) and max(rows.values()) <= 4.0, rows
    assert min(rows[n] for n in ("C3-P3", "C4-P4")) >= 0.5


# =============================================================================================== neonatal

def _state_minutes(syn, label):
    return sum(max(0.0, min(b, syn.duration_s) - max(a, 0.0)) for a, b, lab in syn._state_intervals if lab == label) / 60.0


def _brush_rate(syn, label):
    ev = syn._ge_events["delta_brush"]
    tt = ev[(ev[:, 0] > 0) & (ev[:, 0] < syn.duration_s), 0]
    return float((syn.state_at(tt) == label).sum()) / max(_state_minutes(syn, label), 1e-9)


def test_brush_rate_follows_behavioural_state():
    """ACNS 2013: brushes maximal in active sleep up to 32 w, maximal in quiet sleep from 33 to 37 w.  neonatal-v3 B1-06
    (34 w dysmature): 7.3 / 6.9 / 7.2 per minute in quiet sleep / active sleep / wake, the wrong lesson on a page in
    active sleep; and 34 w (7.1/min) out-brushed the 32-w record (5.6/min)."""
    syn = N.S("B1-06")
    qs, as_, aw = (_brush_rate(syn, s) for s in ("quiet_sleep", "active_sleep", "awake"))
    assert qs >= 4.0                                         # most quiet-sleep bursts brushed at the 32-34 w peak
    assert as_ <= 0.5 * qs and aw <= 0.6 * qs, (qs, as_, aw)
    ev = syn._ge_events["delta_brush"]
    overall = ((ev[:, 0] > 0) & (ev[:, 0] < syn.duration_s)).sum() / (syn.duration_s / 60.0)
    c33 = N.S("C33")
    e33 = c33._ge_events["delta_brush"]
    r32 = ((e33[:, 0] > 0) & (e33[:, 0] < c33.duration_s)).sum() / (c33.duration_s / 60.0)
    assert r32 >= overall                                    # the 32-34 w peak is not outdone at 34 w overall
    # before 32 w active sleep carries the most
    w = syn._brush_state_w
    syn_early = N.S("C33")
    assert syn_early._brush_state_w(100.0) == 1.0            # no state cycle: no weighting
    assert w(float(next(a for a, b, l in syn._state_intervals if l == "active_sleep" and a > 0)) + 1.0) == pytest.approx(0.3)


def test_brush_key_reports_the_realized_rate():
    """neonatal-v3: the key said 2.2/min while 7.1/min was realized (B1-06), 0.9 vs 0.25 (B1-10).  Every v3 brush is
    now a key row with its state, and the summary carries the realized rate overall and per state."""
    for cid in ("B1-06", "B1-10"):
        syn = N.S(cid)
        rows = realized_events(syn, syn.duration_s)
        br = [r for r in rows if r["kind"] == "delta_brush"]
        ev = syn._ge_events["delta_brush"]
        assert len(br) == int(((ev[:, 0] + ev[:, 1] >= 0) & (ev[:, 0] <= syn.duration_s)).sum())
        s = delta_brush_summary(rows, syn.duration_s, syn)
        assert s["per_minute"] == pytest.approx(len(br) / (syn.duration_s / 60.0), abs=1e-3)
        assert s["by_state"]["quiet_sleep"]["per_minute"] == pytest.approx(_brush_rate(syn, "quiet_sleep"), rel=0.05)
        assert all(r["state"] in ("quiet_sleep", "active_sleep", "awake", "indeterminate") for r in br)
    v2 = N.S("B1-06", 2)
    assert not [r for r in realized_events(v2, v2.duration_s) if r["kind"] == "delta_brush"]


def _ta(syn, t0, t1):
    d, _ = N._display(syn, t0, t1)
    fs = syn.fs
    tt = t0 + np.arange(d.shape[1]) / fs
    env = syn.burst_envelope(tt)
    pp = _p2p_1s(d, fs)
    esec = env[: pp.shape[1] * fs].reshape(-1, fs).mean(1)
    lo = sps.sosfiltfilt(sps.butter(4, 1.5, "lowpass", fs=fs, output="sos"), d, axis=1)
    big = []
    for a, b in zip(syn._burst_start, syn._burst_end):
        if a < t0 + 1 or b > t1 - 1:
            continue
        m = np.nonzero((tt >= a) & (tt < b))[0]
        w = int(0.8 * fs)
        best = max((np.ptp(lo[:, m[i:i + w]], axis=1).max() for i in range(0, max(1, m.size - w), fs // 8)), default=0.0)
        big.append(best >= 100.0)
    return np.median(pp[:, esec > 0.95]), np.median(pp[:, esec < 0.5]), np.mean(big)


def test_trace_alternant_bursts_carry_high_voltage_slow_waves():
    """ACNS 2013 Fig. 2b and learningeeg 4-day term quiet sleep: bursts carry isolated 100+ uV slow waves over a visibly
    flatter interburst (25-50 uV).  neonatal-v3 B1-01: burst 66 / interburst 30 uV (2.2x) and the bursts were the same
    theta/delta texture turned up."""
    syn = N.S("B1-01")
    t0 = N._first_state(syn, "quiet_sleep", minlen=120)
    burst, ibi, big = _ta(syn, t0, t0 + 120.0)
    assert burst >= 3.0 * ibi, (burst, ibi)
    assert 25.0 <= ibi <= 50.0
    assert big >= 0.5


def test_mature_quiet_sleep_is_high_voltage_delta():
    """ACNS 2013: past term, quiet sleep is continuous 50-150 uV slow-wave sleep, largely < 1.5 Hz.  neonatal-v3 B1-09
    (43 w): the quiet-sleep page read 30-45 uV continuous 2-4 Hz activity, like active sleep."""
    syn = N.S("B1-09")
    fs = syn.fs

    def state(label):
        a = N._first_state(syn, label, after=120.0, minlen=70)
        d, _ = N._display(syn, a, a + 60.0)
        f, p = sps.welch(d, fs=fs, nperseg=4 * fs, axis=1)
        pm = p.mean(0)
        return np.median(_p2p_1s(d, fs).mean(0)), pm[(f >= 0.5) & (f < 1.5)].sum() / pm[(f >= 0.5) & (f < 4)].sum()
    qv, qlow = state("quiet_sleep")
    av, alow = state("active_sleep")
    assert qv >= 2.0 * av and 50.0 <= qv <= 150.0, (qv, av)
    assert qlow >= 0.55 and qlow > alow + 0.1, (qlow, alow)


@pytest.mark.parametrize("cid", ["B1-01", "B1-04"])
def test_awake_voltage_does_not_exceed_quiet_sleep(cid):
    """ACNS 2013: wake (activite moyenne) is continuous 25-50 uV mixed activity; quiet sleep (high-voltage slow /
    trace alternant) carries the highest voltage of the term cycle.  The fixed-window calibration read two quiet-sleep
    minutes out of four, so wake came out above quiet sleep."""
    syn = N.S(cid)
    fs = syn.fs

    def level(label):
        vals = []
        for a, b, lab in syn._state_intervals:
            a, b = max(a, 60.0), min(b, syn.duration_s - 10.0)
            if lab != label or b - a < 40:
                continue
            d, _ = N._display(syn, a + 5, min(b - 5, a + 65))
            vals.append(np.median(_p2p_1s(d, fs).mean(0)))
        return np.median(vals)
    assert level("awake") <= level("quiet_sleep")


def test_quiet_sleep_slow_waves_are_window_independent():
    syn = N.S("B1-01")
    t0 = N._first_state(syn, "quiet_sleep")
    _, whole = syn.segment(t0, t0 + 20.0)
    _, a = syn.segment(t0, t0 + 7.3)
    _, b = syn.segment(t0 + 7.3, t0 + 20.0)
    assert np.allclose(whole, np.hstack([a, b]), atol=1e-9)


# =============================================================================================== sedation

def test_ketamine_gamma_is_continuous_low_voltage_fast_activity():
    """Purdon 2015 Fig 9C (ketamine raw trace): continuous low-amplitude fast activity riding slow drift, not gated
    wave packets.  sedation-v3 S109-05: discrete 1-1.5 s near-sinusoidal 28 Hz packets, 20-40 uV p2p on bipolar, gated
    3.95:1."""
    S, _ = SD._pair("ketamine", SD.SPECS["ketamine"])
    n, d = SD._disp(S, 540, 720)
    fs = S.fs
    y = sps.sosfiltfilt(sps.butter(4, [22, 34], "bandpass", fs=fs, output="sos"), d, axis=1)
    env = np.sqrt(np.convolve((y ** 2).mean(0), np.ones(fs // 2) / (fs // 2), "same"))
    assert np.percentile(env, 10) / np.percentile(env, 90) >= 0.35       # present throughout (was 0.19)
    p2p = np.median([np.ptp(y[:, i:i + fs], axis=1).mean() for i in range(0, y.shape[1] - fs, fs)])
    assert p2p <= 20.0                                                    # low voltage (was 32 uV)
    assert p2p <= 0.35 * SD._p2p(d, fs)


def test_dexmedetomidine_spindles_are_frontal():
    """Akeju 2014 / Purdon 2015 (R7): dexmedetomidine spindles with frontal predominance.  sedation-v3 S109-02: as large
    in P3-O1, P4-O2 and T5-O1 as in F3-C3 (front/back 1.5)."""
    S, _ = SD._pair("dexmedetomidine", SD.SPECS["dexmedetomidine"])
    n, d = SD._disp(S, 540, 720)
    fs = S.fs
    y = sps.sosfiltfilt(sps.butter(4, [11, 15], "bandpass", fs=fs, output="sos"), d, axis=1)
    tt = 540 + np.arange(y.shape[1]) / fs
    ins = np.zeros(tt.size, bool)
    for a, du in zip(S._dsp["t"], S._dsp["dur"]):
        ins |= (tt >= a) & (tt < a + du)
    r = {c: np.sqrt(max((y[i, ins] ** 2).mean() - (y[i, ~ins] ** 2).mean(), 0.0)) for i, c in enumerate(n)}
    front = np.mean([r[c] for c in ("Fp1-F3", "F3-C3", "Fp2-F4", "F4-C4")])
    back = np.mean([r[c] for c in ("P3-O1", "P4-O2", "T5-O1", "T6-O2")])
    assert front >= 2.5 * back, (front, back)


def test_midazolam_beta_is_diffuse():
    """learningeeg 'background after benzos' (R1): the beta is full size in the posterior chains too.  sedation-v3
    S109-03: P3-O1/P4-O2/T5-O1/T6-O2 clearly quieter (posterior/frontal beta excess 0.45)."""
    S, S0 = SD._pair("midazolam", SD.SPECS["midazolam"])
    n, d = SD._disp(S, 600, 660)
    _, d0 = SD._disp(S0, 600, 660)
    b = dict(zip(n, SD._bp(d, S.fs, 13, 30) - SD._bp(d0, S.fs, 13, 30)))
    assert np.mean([b[c] for c in SD.OCC]) >= 0.7 * np.mean([b[c] for c in SD.FRONT])


@pytest.fixture(scope="module")
def pento_page():
    S, _ = SD._pair("pentobarbital", SD.SPECS["pentobarbital"])
    t0, t1 = 900.0, 1500.0
    n, d = SD._disp(S, t0, t1)
    return S, t0, t1, n, d


def test_pentobarbital_bursts_carry_sharp_and_fast_components(pento_page):
    """learningeeg burst-suppression pages R2/R3: bursts of polyphasic sharp and slow waves with fine superimposed fast
    activity.  sedation-v3 S109-06: bursts were smooth slow humps (relative beta 0.00, 13-30 Hz share 0.003)."""
    S, t0, t1, n, d = pento_page
    fs = S.fs
    env = np.convolve(np.max(np.abs(d), axis=0), np.ones(fs // 2) / (fs // 2), "same")
    b = d[:, env >= 5.0]
    b = b[:, : (b.shape[1] // fs) * fs]
    rel = lambda a, c: SD._bp(b, fs, a, c).sum() / SD._bp(b, fs, 1, 30).sum()
    assert 0.03 <= rel(13, 30) <= 0.12                     # fast present, slow still dominant (rel 1-8 > 0.85 elsewhere)
    assert rel(8, 13) < 0.05
    slope = np.median(np.percentile(np.abs(np.diff(b, axis=1)) * fs / 1000.0, 99.5, axis=1))
    assert slope >= 2.0                                      # sharp components (uV/ms; was 1.55)


def test_pentobarbital_offset_tail_is_reduced(pento_page):
    """sedation-v3 S109-06: every burst offset left a slow exponential baseline tail (the 1 Hz LFF step response of
    burst delta with half its weight at DC); measured as the < 3 Hz RMS 0.25-0.9 s after each offset over the late
    interburst RMS, 2.1x before."""
    S, t0, t1, n, d = pento_page
    fs = S.fs
    lo = sps.sosfiltfilt(sps.butter(4, 3.0, "lowpass", fs=fs, output="sos"), d, axis=1)
    ratio = []
    for e, nx in zip(S._burst_end[:-1], S._burst_start[1:]):
        if e < t0 + 1 or nx > t1 - 1 or nx - e < 1.8:
            continue
        tail = lo[:, int((e + 0.25 - t0) * fs):int((e + 0.9 - t0) * fs)]
        late = lo[:, int((e + 1.2 - t0) * fs):int((nx - 0.2 - t0) * fs)]
        ratio.append(np.sqrt((tail ** 2).mean()) / np.sqrt((late ** 2).mean()))
    assert len(ratio) >= 30 and np.median(ratio) <= 1.8, np.median(ratio)
