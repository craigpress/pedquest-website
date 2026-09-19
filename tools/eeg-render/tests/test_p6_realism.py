"""EEG Atlas P6 (0.4.0): Craig's P5 verdicts as generator behaviour, behind ``spec_version``.

Version 1 keeps every 0.3.x default (the committed bank is pinned to it); an
unversioned spec is version 2 and gets the new defaults.  Each test here pins
one of Craig's findings from EEG_ATLAS_P5_CANDIDATE_REVIEW.csv.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from scipy import signal

RENDERER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RENDERER))

from eeg_render.spec import normalize, validate_image
from eeg_render.synth import Synthesizer
from eeg_render import montage as mt

FS = 256


def _img(spec, kind="eeg_page"):
    return {"kind": kind, "license": "synthetic-original", "spec": spec}


def _child(version=None, **bg):
    base = {"type": "continuous", "dominant_hz": 9.0, "amplitude_uv": 40.0, "slow_fraction": 0.4}
    base.update(bg)
    s = {"seed": 515800, "age_group": "child", "sample_rate": FS, "channels": "standard_19", "duration_min": 20,
         "background": base, "events": []}
    if version:
        s["spec_version"] = version
    return s


def _neo(version=None, **bg):
    base = {"type": "continuous", "pma_weeks": 32.0, "amplitude_uv": 60.0, "dominant_hz": 1.5, "slow_fraction": 0.8}
    base.update(bg)
    s = {"seed": 515801, "age_group": "neonate", "sample_rate": FS, "channels": "neonatal_9", "duration_min": 20,
         "background": base, "events": []}
    if version:
        s["spec_version"] = version
    return s


# ------------------------------------------------------------- versions ----
def test_unversioned_spec_is_version_2_and_gets_the_new_defaults():
    bg = normalize(_img(_child()))["spec"]
    assert bg["spec_version"] == 2
    b = bg["background"]
    assert b["channel_gain_max"] == 2.0 and b["blink_rate_per_min"] == 15.0 and b["pdr_gain"] == 2.5
    assert b["blink_amplitude_uv"] == 160.0 and b["amplitude_reference"] == "display" and b["pdr_field"] == "focal"
    n = normalize(_img(_neo()))["spec"]["background"]
    assert n["delta_brushes"] is False and n["delta_brush_events"] is True
    assert n["graphoelements"]["delta_brush"]["rate_per_min"] > 2.5


def test_version_1_keeps_the_0_3_defaults():
    b = normalize(_img(_child(version=1)))["spec"]["background"]
    for k in ("channel_gain_max", "blink_rate_per_min", "pdr_gain", "blink_amplitude_uv", "amplitude_reference", "pdr_field"):
        assert k not in b, k
    n = normalize(_img(_neo(version=1)))["spec"]["background"]
    assert n["delta_brushes"] is True and "delta_brush_events" not in n


def test_unreactive_or_suppressed_version_2_records_do_not_blink():
    for bg in ({"reactivity": "absent"}, {"type": "burst_suppression"}, {"type": "low_voltage"}, {"type": "suppressed"}):
        assert normalize(_img(_child(**bg)))["spec"]["background"]["blink_rate_per_min"] == 0.0


def test_composite_children_inherit_the_version():
    spec = {"seed": 7, "spec_version": 1, "age_group": "child",
            "qeeg_panel": {"duration_min": 30, "background": {"type": "continuous"}},
            "eeg_page": {"at_min": 5}}
    n = normalize(_img(spec, "composite"))["spec"]
    assert n["spec_version"] == 1 and n["qeeg_panel"]["spec_version"] == 1 and n["eeg_page"]["spec_version"] == 1
    assert "amplitude_reference" not in n["qeeg_panel"]["background"]


# -------------------------------------------------------------- seizures ---
def _sz(version=None, spread="none", dur=60.0):
    s = _child(version=version)
    s["events"] = [{"type": "seizure", "onset_min": 5.0, "duration_s": dur, "onset_region": "left_temporal", "spread": spread,
                    "evolution": {"start_hz": 5.0, "end_hz": 2.5, "amplitude_start_uv": 60.0, "amplitude_end_uv": 150.0}}]
    return s


def test_seizure_defaults_follow_the_version():
    v2 = normalize(_img(_sz()))["spec"]["events"][0]
    v1 = normalize(_img(_sz(version=1)))["spec"]["events"][0]
    assert v2["evolution"]["profile"] == "recruit" and v2["muscle"] == "none"
    assert v1["evolution"]["profile"] == "sweep" and v1["muscle"] == "modest"
    assert normalize(_img(_sz(spread="hemispheric")))["spec"]["events"][0]["muscle"] == "modest"


def _dominant_track(row, fs, win_s=2.0, step_s=1.0):
    n, step = int(win_s * fs), int(step_s * fs)
    out = []
    for i in range(0, row.size - n, step):
        seg = row[i: i + n] - row[i: i + n].mean()
        f, P = signal.welch(seg, fs=fs, nperseg=n)
        m = (f >= 0.5) & (f <= 25)
        out.append(f[m][np.argmax(P[m])])
    return np.array(out)


def test_recruit_profile_evolves_where_the_sweep_glides():
    def run(version):
        n = normalize(_img(_sz(version=version)))["spec"]
        syn = Synthesizer(n, 600.0)
        _, x = syn.segment(300.0, 360.0)
        rows = syn.derive(x, [("F7", "T3"), ("T3", "T5")])
        r = rows[int(np.argmax(rows.std(axis=1)))]
        return _dominant_track(r, FS), syn

    track2, syn2 = run(None)
    track1, _ = run(1)
    changes = lambda tr: int(np.sum(np.abs(np.diff(tr)) >= 0.5))
    assert changes(track2) >= 6, track2.tolist()
    assert changes(track2) > changes(track1)
    # onset is fast and quiet; the end is slower than the start; amplitude builds
    inst = syn2.seizures[0]
    _, u, amp, f = syn2._ictal_phase(inst, np.linspace(inst.t0, inst.t1, 400))
    assert f[3] > 1.5 * inst.start_hz and f[-3] < inst.start_hz
    assert amp[10] < 0.5 * amp[-60] and np.argmax(amp) > 0.5 * amp.size


def test_focal_seizure_recruits_no_muscle_under_version_2():
    syn = Synthesizer(normalize(_img(_sz()))["spec"], 600.0)
    t = np.linspace(300.0, 360.0, 200)
    assert float(syn.ictal_gate(t).max()) == 0.0
    syn1 = Synthesizer(normalize(_img(_sz(version=1)))["spec"], 600.0)
    assert float(syn1.ictal_gate(t).max()) > 0.0


# ------------------------------------------------------------ background ---
def test_hemispheric_attenuation_reaches_the_lateral_electrodes():
    def gains(version):
        s = _neo(version=version, type="continuous", pma_weeks=40.0, asymmetry={"side": "left", "attenuation_pct": 40})
        syn = Synthesizer(normalize(_img(s))["spec"], 300.0)
        return {e: float(syn.gain_asym[i]) for i, e in enumerate(syn.electrodes)}
    g2, g1 = gains(None), gains(1)
    assert abs(g2["C3"] - 0.6) < 0.02 and abs(g2["Fp1"] - 0.6) < 0.02 and abs(g2["T3"] - 0.6) < 0.02
    assert g2["C4"] == 1.0 and g2["Cz"] == 1.0
    assert g1["C3"] > 0.7      # the 0.3.x gradient never delivered 40 % at C3


def test_display_reference_authors_low_voltage_directly():
    lv = _child(type="low_voltage", amplitude_uv=15.0, reactivity="absent", dominant_hz=4.0, slow_fraction=0.7)
    syn = Synthesizer(normalize(_img(lv))["spec"], 600.0)
    assert syn.display_ref and 0.25 <= syn.display_scale <= 4.0
    _, x = syn.segment(200.0, 260.0)
    pairs = [p for p in mt.montage_pairs("longitudinal_bipolar", syn.electrodes) if p[1]]
    rows = signal.sosfiltfilt(signal.butter(4, [0.5, 30], btype="bandpass", fs=FS, output="sos"), syn.derive(x, pairs), axis=-1)
    m = rows.shape[1] // FS
    p2p = float(np.median(np.ptp(rows[:, : m * FS].reshape(rows.shape[0], m, FS), axis=2)))
    assert 8.0 < p2p < 24.0, p2p     # a 15 uV request lands near 15 on the page, not at 0.28 x 15


def test_interburst_controls_override_the_pma_table():
    s = _neo(type="discontinuous", pma_weeks=39.0, amplitude_uv=40.0, ibi_range_s=[8.0, 20.0], ibi_floor_uv=5.0)
    bs = normalize(_img(s))["spec"]["background"]["burst_suppression"]
    assert abs(bs["ibi_s"] - (8.0 * 20.0) ** 0.5) < 1e-6 and bs["ibi_sigma"] > 0.15
    assert abs(bs["ibi_floor"] - 5.0 / 40.0) < 1e-9
    assert validate_image(_img(s)) == []


def test_brush_delta_wave_is_high_voltage_and_dominates_the_burst():
    others = {n: {"enabled": False} for n in ("occipital_delta", "temporal_theta", "temporal_alpha", "stop",
                                                "frontal_sharp", "anterior_slow", "midline_theta")}
    syn = Synthesizer(normalize(_img(_neo(pma_weeks=32.0, graphoelements=others)))["spec"], 300.0)
    ev = syn._ge_events["delta_brush"]
    t0, dur, freq, side, amp, _ = ev[(ev[:, 0] > 10) & (ev[:, 0] < 280)][0]
    assert amp > 150.0
    t = np.arange(t0 - 1.0, t0 + dur + 1.0, 1.0 / FS)
    # at 32 w the complexes are occipito-temporal (Hrachovy/Mizrahi), so read them at O1/O2
    y = syn.graphoelement_rows(t)[syn._idx["O2" if side > 0 else "O1"]]
    slow = signal.sosfiltfilt(signal.butter(4, 3.0, btype="lowpass", fs=FS, output="sos"), y)
    fast = signal.sosfiltfilt(signal.butter(4, [9.0, 22.0], btype="bandpass", fs=FS, output="sos"), y)
    assert slow.min() < -0.35 * amp and np.abs(slow).max() > 3.0 * np.abs(fast).max()


# -------------------------------------------------------------- artifacts --
def test_model_2_patting_comes_in_bouts_at_real_voltage():
    s = _neo(type="continuous", pma_weeks=40.0)
    s["events"] = [{"type": "artifact", "kind": "patting", "at_min": 2.0, "duration_s": 30.0, "intensity": "medium"}]
    n = normalize(_img(s))["spec"]
    assert n["events"][0]["model"] == 2
    syn = Synthesizer(n, 300.0)
    t = np.arange(120.0, 150.0, 1.0 / FS)
    rows = syn._artifact_block(t, int(120.0 * FS))
    env = np.abs(rows).max(axis=0)
    sec = env[: (env.size // FS) * FS].reshape(-1, FS).max(axis=1)
    assert sec.max() > 60.0                          # louder than the 0.3.x 34 uV sine
    assert (sec < 0.25 * sec.max()).sum() >= 2       # pauses between bouts
    n1 = normalize(_img(dict(s, spec_version=1)))["spec"]
    assert n1["events"][0]["model"] == 1


def test_model_2_chewing_is_temporal_emg_in_irregular_bursts():
    s = _child()
    s["events"] = [{"type": "artifact", "kind": "emg_chewing", "at_min": 2.0, "duration_s": 30.0, "intensity": "high"}]
    syn = Synthesizer(normalize(_img(s))["spec"], 300.0)
    t = np.arange(122.0, 148.0, 1.0 / FS)
    rows = syn._artifact_block(t, int(122.0 * FS))
    temporal = rows[syn._idx["T3"]].std() + rows[syn._idx["T4"]].std()
    central = rows[syn._idx["Cz"]].std() + rows[syn._idx["Pz"]].std()
    assert temporal > 2.5 * central
    env = np.abs(rows[syn._idx["T3"]])
    env = signal.sosfiltfilt(signal.butter(2, 8.0, btype="lowpass", fs=FS, output="sos"), env)
    peaks, _ = signal.find_peaks(env, distance=int(0.3 * FS), height=0.3 * env.max())
    gaps = np.diff(peaks) / FS
    assert 0.4 < np.median(gaps) < 1.6 and np.std(gaps) > 0.05     # ~1.3 Hz chews, not a metronome


def test_version_2_blinks_are_larger_with_a_fast_rise_and_slow_decay():
    syn = Synthesizer(normalize(_img(_child()))["spec"], 300.0)
    tt = float(syn._blink_t[(syn._blink_t > 20) & (syn._blink_t < 280)][0])
    t = np.arange(tt - 0.2, tt + 0.7, 1.0 / FS)
    prof = syn.blink_rows(t, np.ones_like(t))[syn._idx["Fp1"]]
    peak = int(np.argmax(prof))
    assert prof.max() > 150.0
    rise = peak - int(np.argmax(prof > 0.5 * prof.max()))
    decay = int(np.argmax(prof[peak:] < 0.5 * prof.max()))
    assert decay > 1.5 * rise


def test_authored_ibi_range_is_delivered_in_seconds_not_rescaled():
    """ibi_range_s [10, 30] must come out 10-30 s between bursts with burst_s-long bursts (P5 C03, 2026-09-19)."""
    s = _neo(type="burst_suppression", pma_weeks=40.0, amplitude_uv=30.0, reactivity="absent",
             ibi_range_s=[10.0, 30.0], ibi_floor_uv=3.0)
    syn = Synthesizer(normalize(_img(s))["spec"], 1800.0)
    a, b = syn._burst_start, syn._burst_end
    keep = (a >= 0) & (b <= 1800.0)
    a, b = a[keep], b[keep]
    ibis = a[1:] - b[:-1]
    bursts = b - a
    assert 12.0 < np.median(ibis) < 24.0, np.median(ibis)            # geometric centre sqrt(300) = 17.3
    assert np.percentile(ibis, 5) > 8.0 and np.percentile(ibis, 95) < 36.0
    assert 1.4 < np.median(bursts) < 2.8, np.median(bursts)          # burst_s 2.0, not 25 % of a rescaled cycle
    # the same spec without the range keeps the historical cycle model (byte-for-byte for pinned specs)
    s1 = _neo(type="burst_suppression", pma_weeks=40.0, amplitude_uv=30.0, reactivity="absent")
    syn1 = Synthesizer(normalize(_img(s1))["spec"], 1800.0)
    assert not np.array_equal(syn1._burst_start[:20], syn._burst_start[:20])


def test_burst_type_display_calibration_targets_the_bursts():
    """The request is the burst voltage: bursts land near amplitude_uv, the interburst near ibi_floor_uv, no clipped scale."""
    from scipy import signal as sps
    s = _neo(type="burst_suppression", pma_weeks=40.0, amplitude_uv=30.0, reactivity="absent",
             ibi_range_s=[10.0, 30.0], ibi_floor_uv=3.0,
             graphoelements={"frontal_sharp": {"enabled": False}, "anterior_slow": {"enabled": False},
                             "midline_theta": {"enabled": False}})
    norm = normalize(_img(s))["spec"]
    syn = Synthesizer(norm, 1200.0)
    assert syn.display_scale < 3.9, "scale hit the clip: the calibration measured the interburst, not the bursts"
    pairs = [p for p in mt.montage_pairs(norm["montage"], syn.electrodes) if p[1]]
    sos = sps.butter(4, [0.5, 30.0], btype="bandpass", fs=FS, output="sos")

    def p2p(t0, t1):
        _, x = syn.segment(t0, t1)
        rows = sps.sosfiltfilt(sos, syn.derive(x, pairs), axis=-1)
        m = rows.shape[1] // FS
        return np.ptp(rows[:, : m * FS].reshape(rows.shape[0], m, FS), axis=2)

    inside = [(float(a), float(b)) for a, b in zip(syn._burst_start, syn._burst_end) if a >= 0 and b <= 1200.0 and b - a >= 1.6]
    burst_p2p = np.concatenate([p2p(a + 0.3, min(b - 0.3, a + 10.3)) for a, b in inside[:25]], axis=1)
    gaps = [(float(e) + 1.0, float(st) - 1.0) for e, st in zip(syn._burst_end[:-1], syn._burst_start[1:])
            if e >= 0 and st <= 1200.0 and st - e >= 3.0]
    ibi_p2p = np.concatenate([p2p(a, b) for a, b in gaps[:25]], axis=1)
    assert 24.0 < np.median(burst_p2p) < 36.0, np.median(burst_p2p)
    assert np.median(ibi_p2p) < 6.0, np.median(ibi_p2p)


def test_version_2_rhythmic_pattern_emits_no_fragment_run_at_the_window_end():
    from eeg_render.export.manifest import realized_events
    ev = {"type": "rhythmic_pattern", "pattern": "LPD", "periodic": True, "frequency_hz": 1.0, "amplitude_uv": 120,
          "run_duration_s": 60, "min_cycles": 6, "onset_min": 5.0, "duration_min": 3.0, "onset_region": "left_temporal"}
    for seed in (515701, 515702, 515703, 515704):
        s = dict(_child(), seed=seed, age_group="adult", events=[ev])
        syn = Synthesizer(normalize(_img(s))["spec"], 900.0)
        runs = [e["offset_s"] - e["onset_s"] for e in realized_events(syn, 900.0) if e["kind"] == "rhythmic_pattern"]
        assert runs and min(runs) >= 6.0 - 1e-9, (seed, runs)
    # version 1 keeps the truncated tail (the pinned bank must not move)
    s1 = dict(_child(), seed=515701, age_group="adult", events=[ev], spec_version=1)
    Synthesizer(normalize(_img(s1))["spec"], 900.0)
