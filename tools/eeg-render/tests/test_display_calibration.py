"""0.4.0 ``amplitude_reference: display``: what the spec asks for is what the page shows.

``amplitude_uv`` (background) and ``amplitude_end_uv`` / rhythmic-pattern
``amplitude_uv`` are the 1-s peak-to-peak a reader measures on the display
montage (EEG Atlas P6 plan, "Amplitude semantics").  The cases and estimators
are ``calibrate_display.py``'s, so this file and that script cannot disagree;
re-run the script after touching a waveform template and adjust
``synth.DISPLAY_CAL`` if an event case drifts.

Background delivery is self-calibrated per spec (``Synthesizer._calibrate_display``,
four envelope-normalised 60 s windows).  Measured whole-record it lands within a
few percent, so the tolerance below is generous to sampling noise, not to bias.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

RENDERER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RENDERER))

import calibrate_display as cd  # noqa: E402
from eeg_render.spec import normalize  # noqa: E402
from eeg_render.synth import Synthesizer  # noqa: E402

TOL = 0.15


@pytest.mark.parametrize("name,fn,requested", cd.cases(), ids=[c[0] for c in cd.cases()])
def test_delivered_within_tolerance_of_requested(name, fn, requested):
    delivered = fn()
    ratio = delivered / requested
    assert abs(ratio - 1.0) <= TOL, f"{name}: requested {requested}, delivered {delivered:.1f} (x{ratio:.2f})"


def test_background_calibration_is_a_fixed_scalar_and_self_consistent():
    """Re-running the calibration on a calibrated synthesizer changes nothing (window-independent scalar)."""
    child = {"seed": 515900, "age_group": "child", "sample_rate": cd.FS, "channels": "standard_19", "duration_min": 20,
             "background": {"type": "continuous", "dominant_hz": 9.0, "amplitude_uv": 40.0, "slow_fraction": 0.4},
             "events": []}
    norm = normalize({"kind": "eeg_page", "license": "synthetic-original", "spec": child})["spec"]
    assert norm["background"]["amplitude_reference"] == "display"
    s = Synthesizer(norm, 1200.0)
    first = s.display_scale
    assert 0.5 < first < 2.0
    s.display_scale = 1.0
    s._calibrate_display()
    assert abs(s.display_scale - 1.0) < 0.02
    # the background scales linearly with amp_rms, so the scalar is exact, not iterative
    a = s.amp_rms
    s.amp_rms = 2.0 * a
    s.display_scale = 1.0
    s._calibrate_display()
    assert abs(s.display_scale - 0.5) < 0.01
    s.amp_rms = a


def test_referential_reference_keeps_the_0_3_x_scale():
    """``amplitude_reference: referential`` (and every spec_version 1 spec) bypasses the calibration."""
    child = {"seed": 515900, "age_group": "child", "sample_rate": cd.FS, "channels": "standard_19", "duration_min": 20,
             "background": {"type": "continuous", "dominant_hz": 9.0, "amplitude_uv": 40.0, "slow_fraction": 0.4,
                            "amplitude_reference": "referential"},
             "events": []}
    s = Synthesizer(normalize({"kind": "eeg_page", "license": "synthetic-original", "spec": child})["spec"], 600.0)
    assert s.display_scale == 1.0 and s.amp_rms == pytest.approx(40.0 / 6.4)
    pinned = dict(child, spec_version=1)
    pinned["background"] = {k: v for k, v in child["background"].items() if k != "amplitude_reference"}
    s1 = Synthesizer(normalize({"kind": "eeg_page", "license": "synthetic-original", "spec": pinned})["spec"], 600.0)
    assert s1.display_scale == 1.0 and not s1.display_ref
