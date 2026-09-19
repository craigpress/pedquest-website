"""Measure delivered / requested amplitude on the display montage (0.4.0 ``amplitude_reference: display``).

Prints, for each canonical case, the 1-s peak-to-peak (median over the relevant
derivations, 0.5-30 Hz) the page shows against the number the spec asked for.
Used to set and check ``synth.DISPLAY_CAL``; tests/test_display_calibration.py
asserts the same cases stay within tolerance.

    python calibrate_display.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from scipy import signal

RENDERER = Path(__file__).resolve().parent
sys.path.insert(0, str(RENDERER))

from eeg_render import montage as mt
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer

FS = 256


def _bp(y, fs=FS, band=(0.5, 30.0)):
    sos = signal.butter(4, band, btype="bandpass", fs=fs, output="sos")
    return signal.sosfiltfilt(sos, y, axis=-1)


def p2p_1s(rows, fs=FS):
    n = int(fs); m = rows.shape[1] // n
    w = rows[:, : m * n].reshape(rows.shape[0], m, n)
    return np.ptp(w, axis=2)


def derive(synth, raw, pairs):
    return synth.derive(raw, [(a, b) for a, b in pairs])


def measure_background(spec, pairs=None, duration_s=1200.0, window_s=60.0):
    """Median 1-s p2p of the background over the whole record, read the way a reader reads it.

    The background waxes and wanes by +-24 % (log-normal slow AM on a ~30 s time
    constant), so a handful of windows is a noisy sample of it: six windows read
    1.10-1.14x on records whose whole-record median was 1.01-1.06x.  Every
    ``window_s`` block of the record is measured instead (about 4 s for 20 min).
    Seconds that carry a spontaneous blink are dropped and the frontopolar
    derivations are left out: a reader measures background voltage between
    blinks and away from the eyes, and the synthesizer's own calibration
    (``Synthesizer._calibrate_display``) is background-only for the same reason.
    """
    norm = normalize({"kind": "eeg_page", "license": "synthetic-original", "spec": spec})["spec"]
    synth = Synthesizer(norm, duration_s)
    pairs = pairs or [p for p in mt.montage_pairs(norm["montage"], synth.electrodes)
                      if p[1] and not any(str(e).upper().startswith("FP") for e in p)]
    blinks = np.asarray(getattr(synth, "_blink_t", np.empty(0)), dtype=float)
    chunks = []
    t0 = 0.0
    while t0 + window_s <= duration_s + 1e-9:
        _, raw = synth.segment(t0, t0 + window_s)
        p2p = p2p_1s(_bp(derive(synth, raw, pairs)))
        if blinks.size:
            starts = t0 + np.arange(p2p.shape[1])
            # a 160 uV blink lasts ~0.4 s and the band-pass rings a little either side
            hit = np.array([bool(np.any((blinks > s - 0.6) & (blinks < s + 1.6))) for s in starts])
            p2p = p2p[:, ~hit]
        if p2p.shape[1]:
            chunks.append(p2p)
        t0 += window_s
    return float(np.median(np.concatenate(chunks, axis=1)))


def measure_event_end(spec, onset_s, dur_s, pairs, u0=0.70, u1=0.82):
    norm = normalize({"kind": "eeg_page", "license": "synthetic-original", "spec": spec})["spec"]
    synth = Synthesizer(norm, onset_s + dur_s + 120.0)
    _, raw = synth.segment(onset_s + u0 * dur_s, onset_s + u1 * dur_s)
    rows = _bp(derive(synth, raw, pairs))
    return float(np.median(p2p_1s(rows).max(axis=0)))    # maximal derivation per second


def measure_rpp(spec, onset_s, run_s, pairs):
    norm = normalize({"kind": "eeg_page", "license": "synthetic-original", "spec": spec})["spec"]
    synth = Synthesizer(norm, onset_s + 600.0)
    _, raw = synth.segment(onset_s + 2.0, onset_s + run_s - 2.0)
    rows = _bp(derive(synth, raw, pairs))
    return float(np.median(p2p_1s(rows).max(axis=0)))


def cases():
    child = {"seed": 515900, "age_group": "child", "sample_rate": FS, "channels": "standard_19", "duration_min": 20,
             "background": {"type": "continuous", "dominant_hz": 9.0, "amplitude_uv": 40.0, "slow_fraction": 0.4}, "events": []}
    neo = {"seed": 515901, "age_group": "neonate", "sample_rate": FS, "channels": "neonatal_9", "duration_min": 20,
           "background": {"type": "continuous", "pma_weeks": 40.0, "amplitude_uv": 45.0, "dominant_hz": 2.0, "slow_fraction": 0.8}, "events": []}
    adult_lv = {"seed": 515902, "age_group": "adult", "sample_rate": FS, "channels": "standard_19", "duration_min": 20,
                "background": {"type": "low_voltage", "dominant_hz": 4.0, "amplitude_uv": 15.0, "slow_fraction": 0.7, "reactivity": "absent"}, "events": []}
    sz = dict(child, seed=515903, events=[{"type": "seizure", "onset_min": 5.0, "duration_s": 60.0, "onset_region": "left_temporal",
                                            "spread": "none", "evolution": {"start_hz": 5.0, "end_hz": 2.5, "amplitude_start_uv": 60.0, "amplitude_end_uv": 150.0}}])
    lpd = dict(child, seed=515904, age_group="adult", events=[{"type": "rhythmic_pattern", "pattern": "LPD", "frequency_hz": 1.0, "amplitude_uv": 120.0,
                                                                "run_duration_s": 60.0, "min_cycles": 6, "onset_min": 5.0, "duration_min": 10.0, "side": "left"}])
    lrda = dict(child, seed=515905, age_group="adult", events=[{"type": "rhythmic_pattern", "pattern": "LRDA", "frequency_hz": 2.0, "amplitude_uv": 60.0,
                                                                 "run_duration_s": 60.0, "min_cycles": 6, "onset_min": 5.0, "duration_min": 10.0, "side": "left"}])
    left_temporal = [("F7", "T3"), ("T3", "T5")]
    return [
        ("background child continuous 40", lambda: measure_background(child), 40.0),
        ("background neonate continuous 45", lambda: measure_background(neo), 45.0),
        ("background adult low_voltage 15", lambda: measure_background(adult_lv), 15.0),
        ("seizure amplitude_end 150 (left temporal, u 0.70-0.82)", lambda: measure_event_end(sz, 300.0, 60.0, left_temporal), 150.0),
        ("LPD 120 (T3-T5 / F7-T3)", lambda: measure_rpp(lpd, 300.0, 60.0, left_temporal), 120.0),
        ("LRDA 60 (T3-T5 / F7-T3)", lambda: measure_rpp(lrda, 300.0, 60.0, left_temporal), 60.0),
    ]


def main() -> int:
    for name, fn, req in cases():
        got = fn()
        print(f"{name:58s} requested {req:6.1f}  delivered {got:6.1f}  ratio {got / req:5.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
