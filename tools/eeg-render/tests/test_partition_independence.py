"""The same absolute sample interval must yield the same samples however it was requested.

This is the invariant a chunked waveform export depends on: the file a learner
scrolls through has to be the recording the rendered image was drawn from.  Every
case below failed before 0.3.7 -- see the partition-independence note in
``synth.py``'s module docstring.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

RENDERER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RENDERER))

from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer

FS = 200
DUR_MIN = 6
DUR_S = DUR_MIN * 60.0


def _synth(**spec_over):
    spec = {
        "seed": 4242,
        "age_group": "child",
        "sample_rate": FS,
        "channels": "standard_19",
        "duration_min": 30,          # schema floor for qeeg_panel
        "background": {"type": "continuous", "dominant_hz": 7.0, "amplitude_uv": 45},
        "events": [],
    }
    spec.update(spec_over)
    image = {"kind": "qeeg_panel", "license": "synthetic-original", "spec": spec}
    norm = normalize(image)["spec"]
    return Synthesizer(norm, DUR_S)


def _chunked(syn, t0, t1, chunk_s):
    """Concatenate ``segment`` calls on integer-sample chunk boundaries."""
    out = []
    t = t0
    while t < t1 - 1e-12:
        nxt = min(t + chunk_s, t1)
        _, x = syn.segment(t, nxt)
        out.append(x)
        t = nxt
    return np.concatenate(out, axis=1)


def _assert_matches(syn, t0=0.0, t1=DUR_S, chunk_s=37.0, tol=1e-9):
    _, whole = syn.segment(t0, t1)
    parts = _chunked(syn, t0, t1, chunk_s)
    assert parts.shape == whole.shape, f"{parts.shape} != {whole.shape}"
    err = np.abs(parts - whole).max()
    assert err < tol, f"max |chunked - whole| = {err:.6g} uV (tol {tol:g})"


def test_plain_background_is_partition_independent():
    _assert_matches(_synth())


def test_baseline_ecg_is_partition_independent():
    """Every age band has a non-zero baseline_ecg_uv, so this covers every spec."""
    _assert_matches(_synth(background={
        "type": "continuous", "dominant_hz": 7.0, "amplitude_uv": 45,
        "baseline_ecg_uv": 6.0,
    }))


def test_chunk_boundary_offset_does_not_matter():
    """A boundary that lands mid-heartbeat must not move the heartbeat."""
    syn = _synth(background={
        "type": "continuous", "dominant_hz": 7.0, "amplitude_uv": 45,
        "baseline_ecg_uv": 6.0,
    })
    _, whole = syn.segment(0.0, DUR_S)
    a = _chunked(syn, 0.0, DUR_S, 37.0)
    b = _chunked(syn, 0.0, DUR_S, 60.0)
    assert np.abs(a - whole).max() < 1e-9
    assert np.abs(b - whole).max() < 1e-9
    assert np.abs(a - b).max() < 1e-9


@pytest.mark.parametrize("kind", ["electrode_pop", "eye_blink", "emg_chewing"])
def test_artifacts_are_partition_independent(kind):
    """Pops and blinks were drawn across the request; chewing was edge-padded."""
    # 150 s artifact deliberately straddling several 37 s chunk boundaries
    ev = {"type": "artifact", "kind": kind, "at_min": 1.0,
          "duration_s": 150.0, "intensity": "high"}
    if kind == "electrode_pop":
        ev["channels"] = ["T5"]
    _assert_matches(_synth(events=[ev]))


def test_postictal_envelope_is_partition_independent():
    _assert_matches(_synth(events=[{
        "type": "seizure", "onset_min": 2.0, "duration_s": 60,
        "onset_region": "left_temporal",
        "evolution": {"start_hz": 4.0, "end_hz": 1.8,
                      "amplitude_start_uv": 60, "amplitude_end_uv": 150},
        "spread": "hemispheric", "postictal_attenuation_s": 45,
    }]))


def test_burst_suppression_envelope_is_partition_independent():
    _assert_matches(_synth(background={
        "type": "burst_suppression", "dominant_hz": 3.0, "amplitude_uv": 40,
    }))


def test_neonatal_delta_brushes_are_partition_independent():
    """Brush amplitude was normalised by the requested window's own std."""
    spec = {
        "seed": 99, "age_group": "neonate", "sample_rate": FS,
        "channels": "neonatal_9", "duration_min": 30,
        "background": {"type": "discontinuous", "amplitude_uv": 40,
                       "delta_brushes": True},
        "events": [],
    }
    image = {"kind": "qeeg_panel", "license": "synthetic-original", "spec": spec}
    syn = Synthesizer(normalize(image)["spec"], DUR_S)
    _assert_matches(syn)


def test_duration_is_part_of_recording_identity():
    """Two synthesizers differing only in duration_s are different recordings.

    Not a defect -- the slow-AM grids normalise over the whole record -- but it
    is why an export must declare its duration alongside the spec.
    """
    a = _synth()
    b = _synth()
    b2 = Synthesizer(b.spec, DUR_S * 2)
    _, xa = a.segment(0.0, 60.0)
    _, xb = b2.segment(0.0, 60.0)
    assert np.abs(xa - xb).max() > 1e-6


def _sw_seizure(morphology):
    return [{
        "type": "seizure", "onset_min": 1.0, "duration_s": 120.0,
        "onset_region": "generalized", "spread": "generalized",
        "morphology": morphology, "postictal_attenuation_s": 30.0,
        "evolution": {"start_hz": 3.0, "end_hz": 1.5,
                      "amplitude_start_uv": 70, "amplitude_end_uv": 180},
    }]


def test_spike_wave_seizure_is_partition_independent():
    """The spike-wave kernel is a function of elapsed seconds inside a cycle.

    That timebase comes from an *analytic* instantaneous frequency.  Deriving it
    numerically from the sampled phase would use one-sided differences at the
    array edges and make the run depend on where the caller cut its chunk.
    """
    _assert_matches(_synth(events=_sw_seizure("spike_wave")))
