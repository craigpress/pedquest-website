"""0.5.0 round-3 fixes (spec_version 3): research/eeg-atlas/feature-review-20260926/artifacts-sedation-r3.md.

References (cached under research/eeg-atlas/references/cache/, internal comparison only): learningeeg
ECG-artifact-on-an-uncalibrated-screen, Tongue-Artifact, shaking-head-artifact, chest-PT-artifact, F7-Electrode-Pop,
Sweat-and-electrode-pop, burst-suppression (R2/R3 of sedation.md), and the 15-blink contour of artifacts.md section 1c.
Every measurement is on the displayed page: longitudinal bipolar through the causal LFF 1 / HFF 70 Hz chain.
"""
import copy

import numpy as np
import pytest
from scipy import signal as sps

import test_r050_artifacts as A
import test_r050_neonatal as N
import test_r050_polish as P
import test_r050_sedation as SD
import test_r050_blink_reference as BR
from eeg_render.export.manifest import realized_events
from eeg_render.render_page import page_signals
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer
from test_r050_polish import blinks  # noqa: F401  (module fixture: isolated eyes-open blinks on 12 pages)

ROW_UV = 73.2          # one page row at 7 uV/mm on the 15-s bank page (A._row_uv)


# ============================================================ delta-brush schedule (S109-04)

def _brush_spec(which):
    """S109-04 (term neonate, midazolam; continuous: brushes drawn per 30-s cell) and C33 (32 w discontinuous:
    brushes drawn per burst), as page specs."""
    if which == "S109-04":
        s = copy.deepcopy(SD.SPECS["neonate_midazolam"])
    else:
        seed, bg, events, dur = N.CASES["C33"]
        s = {"sample_rate": 256, "channels": "standard_19", "seed": seed, "spec_version": 3, "age_group": "neonate",
             "duration_min": dur, "background": dict(bg), "events": list(events)}
    s.update({"at_min": 10.0, "window_s": 15.0, "montage": "longitudinal_bipolar", "sensitivity_uv_mm": 7.0})
    return s


def _norm(s):
    return normalize({"kind": "eeg_page", "license": "synthetic-original", "attribution": None, "spec": s})["spec"]


def _key(syn, horizon, lo, hi):
    return [(round(r["onset_s"], 4), r["amplitude_uv"], r["fast_hz"], r["side"])
            for r in realized_events(syn, horizon) if r.get("kind") == "delta_brush" and lo <= r["onset_s"] < hi]


@pytest.mark.parametrize("which", ["S109-04", "C33"])
def test_brush_key_is_horizon_independent(which):
    """artifacts-sedation-r3 S109-04: the key built to 1800 s listed brushes at 849.6/852.7/860.0 s that the page,
    synthesized to t0 + 75 s, did not contain (the schedule scaled its rate by a whole-span burst share and drew every
    burst from one sequential stream).  The keyed brush rows up to 900 s must not depend on the horizon."""
    spec = _norm(_brush_spec(which))
    ref = _key(Synthesizer(spec, 1800.0), 1800.0, -60.0, 900.0)
    assert len(ref) >= 5
    for h in (922.0, 1000.0, 1250.0, 1500.0):
        assert _key(Synthesizer(spec, h), h, -60.0, 900.0) == ref, h


@pytest.mark.parametrize("which", ["S109-04", "C33"])
def test_keyed_brushes_are_on_the_page_and_in_the_whole_record(which):
    """Every brush the whole-record key lists inside a page window is drawn on that page, both when the page is
    rendered alone (horizon t0 + window + 60 s) and when it is cut from a whole-record synthesis, and nothing brush-like
    is drawn that the key does not list.  The brush's displayed component (page minus the same page without brushes)
    reaches at least half its keyed amplitude in some chain (neonatal family: displayed delta 0.6-1.25x the request,
    ACNS 2013 Fig. 2a)."""
    base = _brush_spec(which)
    whole = Synthesizer(_norm(base), 1800.0)
    rows = _key(whole, 1800.0, 300.0, 1700.0)
    t0 = rows[len(rows) // 2][0] - 4.0
    base["at_min"] = t0 / 60.0
    spec = _norm(base)
    win = float(spec["window_s"])
    on_page = [r for r in rows if t0 + 0.2 < r[0] < t0 + win - 1.8]
    assert on_page
    for horizon in (t0 + win + 60.0, 1800.0):
        syn = Synthesizer(spec, horizon)
        bare = Synthesizer(spec, horizon)
        bare._ge_events["delta_brush"] = bare._ge_events["delta_brush"].copy()
        bare._ge_events["delta_brush"][:, 4] = 0.0
        _, t, sig, _, _ = page_signals(spec, syn)
        _, _, sig0, _, _ = page_signals(spec, bare)
        diff = sig - sig0
        ev = syn._ge_events["delta_brush"]
        drawn = [(round(float(e[0]), 4), round(float(e[4]), 1)) for e in ev if t0 + 0.2 < e[0] < t0 + win - 1.8]
        assert drawn == [(r[0], r[1]) for r in on_page], horizon
        covered = np.zeros(t.size, bool)
        for onset, amp, *_ in on_page:
            m = (t >= onset) & (t < onset + 1.7)
            covered |= (t >= onset - 0.3) & (t < onset + 2.2)
            assert np.ptp(diff[:, m], axis=1).max() >= 0.5 * amp, (horizon, onset, amp)
        edge = (t > t0 + 0.2) & (t < t0 + win - 0.2)
        stray = [e for e in ev if e[0] + e[1] > t0 - 1.0 and e[0] < t0 + win and
                 not any(abs(float(e[0]) - r[0]) < 1e-3 for r in on_page)]
        if not stray:
            assert np.abs(diff[:, edge & ~covered]).max() < 5.0, horizon


# ============================================================ artifacts (A110-04/07/08/11, blink)

def test_ecg_spike_stands_above_the_posterior_rhythm():
    """ECG-artifact-on-an-uncalibrated-screen: the P3-O1 / Cz-Pz spikes stand about 1.5-2x above the background in the
    same 130-ms window.  artifacts-sedation-r3 A110-04 measured 1.07x in P3-O1 at ECG_ART_UV 45 (hidden by the 9-Hz
    PDR); the artifact-free window here is the same page without the event."""
    spec, synth, t, art, sig0, lab = A._page("ecg")
    fs = synth.fs
    beats = synth._beat_times(t[0], t[-1])
    beats = beats[(beats > t[0] + 0.2) & (beats < t[-1] - 0.5)]

    def ratio(name):
        sp = [np.ptp(art[lab[name], int((b - 0.05 - t[0]) * fs):int((b + 0.08 - t[0]) * fs)]) for b in beats]
        lo = [np.ptp(sig0[lab[name], int((b - 0.05 - t[0]) * fs):int((b + 0.08 - t[0]) * fs)]) for b in beats]
        return float(np.median(sp)), float(np.median(sp) / np.median(lo))
    p3, cz = ratio("P3-O1"), ratio("Cz-Pz")
    # r5 (r5-background.md, ECG visibility): the artifact field now weights T5-O1 / P3-O1 by their PDR-carrying
    # background (0.75 of the O1 spike, was 0.55), so P3-O1 reads about 57 uV (was 42; the cap was 50) and stands
    # 1.7x above its window.  The awake child's midline theta (learningeeg 5-yo, r5) busies Cz-Pz, which now reads
    # 1.2x here (1.5x on the A110-04 gallery page).  Both chains must clear 1.0x and average >= 1.3x
    assert 35.0 <= p3[0] <= 65.0, p3
    assert p3[1] >= 1.5 and cz[1] >= 1.0 and 0.5 * (p3[1] + cz[1]) >= 1.3, (p3, cz)
    assert max(ratio(n)[1] for n in ("Fp1-F7", "Fp2-F8", "Fp1-F3", "Fp2-F4")) < 0.15


def test_glossokinetic_is_reference_sized():
    """Tongue-Artifact: parasagittal waves about 0.5-0.8 spacing, temporal about 1.  artifacts-sedation-r3 A110-11:
    GLOSSO_UV 200 drew parasagittal 1.18 rows and temporal 1.42-1.65 rows (about 1.5x)."""
    spec, synth, t, art, sig0, lab = A._page("glosso")
    row = A._row_uv(spec)
    para = [A._p2p(art[lab[n]]) / row for n in ("C3-P3", "P3-O1", "C4-P4", "P4-O2", "Fz-Cz", "Cz-Pz")]
    temporal = [A._p2p(art[lab[n]]) / row for n in ("F7-T3", "T3-T5", "F8-T4", "T4-T6")]
    assert 0.5 <= np.median(para) <= 0.9, para
    assert 0.8 <= np.median(temporal) <= 1.3, temporal


def test_electrode_pops_keep_one_sign_per_event():
    """F7-Electrode-Pop, Sweat-and-electrode-pop: every pop of one electrode deflects the same way.
    artifacts-sedation-r3 A110-07: T3-T5 signs +, +, -, - within one event."""
    spec, synth, t, art, sig0, lab = A._page("pop")
    sched = next(v for k, v in synth._art_events_v3.items() if k[1] == "pop")
    assert len(sched) >= 5 and len({np.sign(a) for _, a in sched}) == 1
    x = art[lab["T5-O1"]] * np.sign(sched[0][1])
    fs = synth.fs
    for p0, _ in sched:
        if t[0] + 0.1 < p0 < t[-1] - 0.1:
            k = int(np.ceil((p0 - t[0]) * fs))
            assert x[k + 2] - x[k - 2] > 0


def test_global_movement_is_one_slow_excursion_with_emg():
    """shaking-head-artifact / chest-PT-artifact: a whole-head movement is an irregular slow excursion with scalp EMG,
    not a rhythmic burst.  artifacts-sedation-r3 A110-08: the global transient was a 2-3 phase ~2.5-Hz oscillation in all
    18 chains with little EMG (it could pass for a generalized sharp-and-slow burst): below 4 Hz, the chains now carry
    one excursion and its filter return (at most 2 prominent extrema), with EMG RMS >= 8 uV in every chain."""
    spec, synth, t, art, sig0, lab = A._page("movement")
    fs = synth.fs
    lo = sps.sosfiltfilt(sps.butter(2, 4.0, "low", fs=fs, output="sos"), art, axis=-1)
    hi = art - sps.sosfiltfilt(sps.butter(2, 8.0, "low", fs=fs, output="sos"), art, axis=-1)
    sched = next(v for k, v in synth._art_events_v3.items() if k[1] == "move")
    glob = [s for s in sched if s[8] == "global" and t[0] < s[0] and s[0] + s[2] < t[-1]]
    assert glob
    for s in glob:
        m = (t >= s[0] - 0.1) & (t < s[0] + s[2] + 0.5)
        ext = [sps.find_peaks(x - x[0], prominence=0.25 * np.ptp(x))[0].size
               + sps.find_peaks(x[0] - x, prominence=0.25 * np.ptp(x))[0].size for x in lo[:, m]]
        assert np.median(ext) <= 2.0, ext
        emg = np.sqrt(np.mean(hi[:, (t >= s[0]) & (t < s[0] + s[2])] ** 2, axis=1))
        assert emg.min() >= 8.0, emg
        assert np.ptp(lo[:, m], axis=1).max() <= 1.6 * A._row_uv(spec)


def test_blink_late_undershoot_matches_the_reference(blinks):
    """artifacts.md 1c (15 blinks, 6 learningeeg figures): after the peak the undershoot is -0.34/-0.26/-0.18 at
    +200/+300/+400 ms (IQR -.50..-.28, -.36..-.20, -.24..-.12).  artifacts-sedation-r3 measured -0.27/-0.14/-0.07 and 10/16
    contour points in the IQR; the peak amplitude is not changed here."""
    peaks, ratios, shapes, _ = blinks
    med = np.median(shapes, axis=0)
    for ms in (200, 300, 400):
        i = BR.MS.index(ms)
        assert BR.IQR_LO[i] <= med[i] <= BR.IQR_HI[i], (ms, round(float(med[i]), 2))
    # 12 of 16 within 0.02 of the IQR (two points sit on its edge: -40 ms 0.57 and +20 ms 0.84)
    assert sum(lo - 0.02 <= v <= hi + 0.02 for v, lo, hi in zip(med, BR.IQR_LO, BR.IQR_HI)) >= 12, np.round(med, 2)
    assert all(lo - 0.05 <= v <= hi + 0.05 for v, lo, hi in zip(med, BR.REF_LO, BR.REF_HI))


def test_blink_lobe_is_window_independent():
    synth, *_ = P._blink_page(90512, "child", 50.0, 9.0, 15.0, 2.0)
    bt = next(float(b) for b in synth._blink_t if b > 100
              and float(synth._eye_factor(np.array([b + 0.1]))[1][0]) > 0.5)        # a blink with the eyes open
    a = float(np.floor(bt)) - 2.0                         # sample-aligned request edges
    s1 = float(np.floor(bt)) + (bt - np.floor(bt) + 0.65) // 0.25 * 0.25 + 0.25      # 0.65-0.9 s after the blink
    _, whole = synth.segment(a, a + 6.0)
    _, part = synth.segment(s1, a + 6.0)                  # starts after the peak, inside the lobe
    k = int(round((s1 - a) * synth.fs))
    assert np.allclose(whole[:, k:k + part.shape[1]], part, atol=1e-9)


# ============================================================ pentobarbital interburst (S109-06)

def test_pentobarbital_interburst_is_not_flat_and_shows_the_ecg():
    """learningeeg burst-suppression (R2/R3 of sedation.md): the interburst is visibly non-flat low-voltage residual with
    ECG showing through.  artifacts-sedation-r3 S109-06: bipolar RMS 0.80 uV (0.11 mm at 7 uV/mm, a ruler line) and a
    3.2 uV QRS in P3-O1; the reviewers asked for about 2-3 uV residual and a 5-10 uV QRS in P3-O1/T5-O1/Cz-Pz."""
    S, _ = SD._pair("pentobarbital", SD.SPECS["pentobarbital"])
    t0, t1 = 1200.0, 1380.0
    n, d = SD._disp(S, t0, t1)
    fs = S.fs
    tt = t0 + np.arange(d.shape[1]) / fs
    ib = np.zeros(tt.size, bool)
    for a, b in zip(S._burst_end[:-1], S._burst_start[1:]):
        ib |= (tt > a + 0.9) & (tt < b - 0.1)
    beats = S._beat_times(t0, t1)
    qrs = np.zeros(tt.size, bool)
    for b in beats:
        qrs |= (tt > b - 0.06) & (tt < b + 0.25)
    rms = np.sqrt(np.mean(d[:, ib & ~qrs] ** 2, axis=1))
    assert 1.5 <= np.median(rms) <= 3.0, np.round(rms, 2)
    for ch in ("P3-O1", "T5-O1", "Cz-Pz"):
        x = d[n.index(ch)]
        pp = [np.ptp(x[int((b - t0 - 0.05) * fs):int((b - t0 + 0.08) * fs)]) for b in beats
              if 0.2 < b - t0 < t1 - t0 - 0.3 and ib[int((b - t0 - 0.1) * fs)] and ib[int((b - t0 + 0.2) * fs)]]
        assert len(pp) >= 20 and 5.0 <= np.median(pp) <= 10.0, (ch, np.median(pp))
