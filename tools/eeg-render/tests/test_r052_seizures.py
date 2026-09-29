"""r9 (0.5.2) seizure fixes: what the EEG feature gallery build found (research/eeg-atlas/gallery-20260929/ISSUES.json).

Measured on the displayed signal (longitudinal bipolar, neonates the reduced montage, 1-70 Hz page chain); the ictal
component is the record minus the same record without the event.
  szf-hemispheric-spread / global  spread: generalized never reached the other hemisphere (~1.0-1.3x background)
  szf-mesial-temporal-left         rhythmic theta 0.7-1.2x background for 15 s at authored voltages
  szf-occipital/parietal-right     posterior onset drew low-voltage fast activity, not the guide's rhythmic spikes
  szf-spasm-cluster-hyps / global  the post-spasm electrodecrement was short and shallow
  szf-hypsarrhythmia               blocks of muscle-like fast activity above the default amplitude
  neo-seizure-rhythmic-temporal    a mid-run neonatal page read as a steady rhythm
"""
import copy
from functools import lru_cache

import numpy as np
import scipy.signal as sps

from eeg_render import montage as mt
from eeg_render.render_page import apply_filters, build_filters
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer

FS = 256
CHILD = dict(type="continuous", amplitude_uv=45.0, dominant_hz=9.0, slow_fraction=0.35, reactivity="present",
             channel_gain_max=1.5, blink_rate_per_min=4)
INFANT = dict(type="continuous", amplitude_uv=60.0, dominant_hz=6.0, slow_fraction=0.5, blink_rate_per_min=0)
HYPS = dict(type="hypsarrhythmia", blink_rate_per_min=0)
NEO = dict(type="continuous", pma_weeks=40.0, dominant_hz=2.0, slow_fraction=0.8, reactivity="present",
           channel_gain_max=1.5, delta_brushes="riding", amplitude_uv=40.0)


def _sz(region, dur, f0, f1, a0, a1, spread="none", **extra):
    e = dict(type="seizure", onset_min=5.0, duration_s=dur, onset_region=region, spread=spread, muscle="none",
             evolution=dict(start_hz=f0, end_hz=f1, amplitude_start_uv=a0, amplitude_end_uv=a1))
    e.update(extra)
    return e


CASES = {
    "bilateral": ("child", CHILD, [_sz("right_temporal", 110, 6.0, 2.0, 60, 260, spread="generalized")], 29260208),
    "mesial": ("child", CHILD, [dict(type="state_change", at_min=2.0, to="sleep"),
                                _sz("left_mesial_temporal", 70, 7.0, 3.0, 60, 160,
                                    clinical_correlate="behavioral_arrest")], 29260201),
    "occipital": ("child", CHILD, [_sz("right_occipital", 50, 8.0, 3.0, 50, 150)], 29260226),
    "parietal": ("child", CHILD, [_sz("right_parietal", 45, 7.0, 3.0, 50, 150)], 29260207),
    "spasm": ("infant", INFANT, [dict(type="spasm", onset_min=5.0)], 29260213),
    "spasm_hyps": ("infant", HYPS, [dict(type="spasm_cluster", onset_min=5.0, interval_s=10.0, count=4)], 29260213),
    "hyps": ("infant", HYPS, [], 29260212),
    "hyps_high": ("infant", dict(HYPS, amplitude_uv=400.0, multifocal_spikes={"rate_per_s": 3.0, "amplitude_uv": 500.0}),
                  [], 29260212),
    "neo": ("neonate", NEO, [_sz("right_temporal", 90, 3.0, 1.5, 40, 120)], 29260313),
}


def _image(case, version=3, events=True):
    age, bg, evs, seed = CASES[case]
    return {"kind": "eeg_page", "license": "synthetic-original", "attribution": None,
            "spec": {"sample_rate": FS, "channels": "standard_19", "seed": seed, "spec_version": version,
                     "age_group": age, "duration_min": 10, "background": copy.deepcopy(bg),
                     "events": copy.deepcopy(evs if events else [e for e in evs if e["type"] == "state_change"])}}


@lru_cache(maxsize=None)
def S(case, version=3, events=True):
    return Synthesizer(normalize(_image(case, version, events))["spec"], 600.0)


def _display(syn, t0, t1, pad=10.0):
    montage = "neonatal_reduced" if syn.age == "neonate" else "longitudinal_bipolar"
    pairs = [p for p in mt.montage_pairs(montage, syn.scalp) if p[1]]
    _, x = syn.segment(t0 - pad, t1)
    d = apply_filters(syn.derive(x, pairs), build_filters(FS, {"lf_hz": 1.0, "hf_hz": 70.0}, True), True)
    return d[:, int(round(pad * FS)):], [f"{a}-{b}" for a, b in pairs]


def _pair(case, t0, t1):
    A, names = _display(S(case), t0, t1)
    B, _ = _display(S(case, events=False), t0, t1)
    return A, B, A - B, names


def _peak_hz(y, lo=1.0, hi=40.0, nperseg=FS):
    f, p = sps.welch(y, fs=FS, nperseg=min(len(y), nperseg))
    k = (f >= lo) & (f <= hi)
    return float(f[k][np.argmax(p[k])])


# ------------------------------------------------------------------------------------------ focal-to-bilateral spread

def test_generalized_spread_recruits_the_other_hemisphere():
    z = S("bilateral").seizures[0]
    left = ("Fp1-F7", "F7-T3", "T3-T5", "Fp1-F3", "F3-C3", "C3-P3")
    A, B, _, names = _pair("bilateral", z.t0, z.t0 + 10.0)
    early = [np.std(A[names.index(c)]) / np.std(B[names.index(c)]) for c in left]
    assert np.median(early) < 1.5, early                                    # the focal onset stays on the right
    A, B, _, names = _pair("bilateral", z.t0 + 0.6 * z.duration_s, z.t0 + 0.85 * z.duration_s)
    late = {c: np.std(A[names.index(c)]) / np.std(B[names.index(c)]) for c in left}
    assert np.median(list(late.values())) >= 2.5, late                      # bilateral, and large
    right = [np.std(A[names.index(c)]) / np.std(B[names.index(c)]) for c in ("F8-T4", "T4-T6", "F4-C4", "C4-P4")]
    assert np.median(list(late.values())) >= 0.6 * np.median(right)


# ------------------------------------------------------------------------------------------------ mesial temporal

def test_mesial_temporal_theta_is_visible_within_seconds():
    """On a sleep page (background above amplitude_uv) at authored 60 -> 160 uV (relative mode)."""
    z = next(q for q in S("mesial").seizures if q.kind == "seizure")
    A, B, I, names = _pair("mesial", z.t0, z.t0 + 12.0)
    for c in ("Fp1-F7", "F7-T3"):
        j = names.index(c)
        for w0 in (1, 4, 8):
            seg = slice(w0 * FS, (w0 + 3) * FS)
            r = np.std(A[j, seg]) / np.std(B[j, seg])
            assert r >= 1.25, (c, w0, r)
        assert 5.0 <= _peak_hz(I[j, FS:4 * FS], 2.0, 20.0) <= 9.0
    j = names.index("F7-T3")
    assert np.std(I[j, 8 * FS:11 * FS]) > np.std(I[j, FS:4 * FS])           # building


# ---------------------------------------------------------------------------------------------- posterior onsets

def test_posterior_onsets_are_rhythmic_spikes_not_fast_activity():
    """Lab guide (src/lib/lab/guide-content.ts): rhythmic alpha-beta onset with a sharp transient on every cycle."""
    for case, chains in (("occipital", ("P4-O2", "T6-O2")), ("parietal", ("P4-O2", "C4-P4"))):
        z = S(case).seizures[0]
        assert z.onset_pattern == "rhythmic_spikes" and z.plus_sharp > 0
        A, B, I, names = _pair(case, z.t0, z.t0 + 4.0)
        j = max((names.index(c) for c in chains), key=lambda q: np.std(I[q, :2 * FS]))
        pk = _peak_hz(I[j, :2 * FS], 2.0, 40.0)
        assert 10.0 <= pk <= 16.0, (case, pk)
        seg = slice(FS // 2, 5 * FS // 2)
        assert np.std(A[j, seg]) / np.std(B[j, seg]) >= 1.4, case            # not low voltage


# -------------------------------------------------------------------------------------------- spasm decrement

def _decrement_ratio(case):
    syn = S(case)
    out = []
    for z in [q for q in syn.seizures if q.kind == "spasm"][:4]:
        d, _ = _display(syn, z.t0 - 4.0, z.t0 + 5.0)
        lo = sps.sosfiltfilt(sps.butter(4, [1.0, 12.0], btype="band", fs=FS, output="sos"), d, axis=1)
        pre = np.median(np.std(lo[:, : int(3.5 * FS)], axis=1))
        dec = np.median(np.std(lo[:, int(5.5 * FS): int(7.5 * FS)], axis=1))       # 1.5-3.5 s after onset
        fast = sps.sosfiltfilt(sps.butter(4, [14.0, 30.0], btype="band", fs=FS, output="sos"), d, axis=1)
        out.append((dec / pre, np.median(np.std(fast[:, int(5.5 * FS): int(7.5 * FS)], axis=1))))
    return np.array(out)


def test_spasm_decrement_is_deep_on_normal_and_hypsarrhythmic_backgrounds():
    for case in ("spasm", "spasm_hyps"):
        r = _decrement_ratio(case)
        assert np.all(r[:, 0] <= 0.3), (case, r[:, 0])
        assert np.all(r[:, 1] > 0.5), (case, r[:, 1])                           # low-voltage fast activity rides it


def test_spasm_decrement_default_is_v3_only():
    assert S("spasm").seizures[0].decrement_depth == 0.85
    assert S("spasm", version=2).seizures[0].decrement_depth == 0.95


# ------------------------------------------------------------------------------------------------ hypsarrhythmia

def test_hypsarrhythmia_muscle_floor_does_not_grow_with_the_background():
    """Above 35 Hz the page is muscle; at 400 uV it drew blocks of it in the temporal chains."""
    def hf(case):
        d, names = _display(S(case, events=False), 300.0, 330.0)
        h = sps.sosfiltfilt(sps.butter(4, 35.0, btype="high", fs=FS, output="sos"), d, axis=1)
        return np.array([np.std(h[names.index(c)]) for c in ("F7-T3", "T3-T5", "F8-T4", "T4-T6")]), d, names
    h_def, _, _ = hf("hyps")
    h_hi, d_hi, names = hf("hyps_high")
    ref, _ = _display(S("spasm", events=False), 200.0, 230.0)
    h_ref = np.std(sps.sosfiltfilt(sps.butter(4, 35.0, btype="high", fs=FS, output="sos"), ref, axis=1)[1:4], axis=1)
    assert np.median(h_hi) <= 2.5 * np.median(h_ref), (h_hi, h_ref)
    assert np.median(h_hi) <= 1.5 * np.median(h_def)
    # still chaotic high-voltage slow activity: 1-4 Hz dominates every temporal chain
    for c in ("F7-T3", "F8-T4"):
        assert _peak_hz(d_hi[names.index(c)], 0.5, 30.0) <= 4.0


def test_hypsarrhythmia_emg_scale_is_v3_only():
    assert S("hyps_high")._hyps_emg_scale() < 0.2
    assert S("hyps_high", version=2)._hyps_emg_scale() == 1.0
    assert S("spasm")._hyps_emg_scale() == 1.0


# ------------------------------------------------------------------------------------------ neonatal evolution

def test_neonatal_seizure_evolves_within_a_page():
    syn = S("neo")
    z = syn.seizures[0]
    assert syn._neo_evolution(z) is not None
    for p0 in (20.0, 35.0, 50.0):
        _, _, I, names = _pair("neo", z.t0 + p0, z.t0 + p0 + 20.0)
        j = int(np.argmax(np.std(I, axis=1)))
        seg = I[j].reshape(5, 4 * FS)
        amp = np.std(seg, axis=1)
        hz = [_peak_hz(s, 0.5, 8.0, nperseg=4 * FS) for s in seg]
        assert amp.max() >= 1.6 * amp.min(), (p0, amp)
        assert max(hz) >= 1.3 * min(hz), (p0, hz)


def test_neonatal_evolution_is_v3_and_long_runs_only():
    assert S("neo", version=2)._neo_evolution(S("neo", version=2).seizures[0]) is None
