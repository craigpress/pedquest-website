"""Auxiliary export channels and pre-flight advisories.

Both of these exist because of things Persyst did to a real generated file, not
because of anything in the schema -- see ``docs/PSCLI_PHASE0A_RESULTS.md``.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import numpy as np

from ..synth import Synthesizer

#: Amplitude of the dedicated ECG row, in microvolts.  Real scalp ECG
#: contamination is tens of microvolts; a *channel* carrying ECG is millivolt
#: scale, and Persyst's heart-rate engine expects the latter.
DEFAULT_EKG_UV = 900.0

#: How long a recording must be before Persyst's stock P15 baseline auto-search
#: can find anything: ``StartTime + Duration`` from each MMX's ``<Baselines>``.
#: A shorter recording yields VsBaseline instruments that are *silently* all
#: zero -- exit code 0, empty stderr, and indistinguishable from "signal equals
#: baseline".
BASELINE_WINDOW_S = {
    "neonate": (300.0, 900.0),      # neonatal P15: StartTime=300 Duration=600
    "default": (270.0, 570.0),      # adult P15:    StartTime=270 Duration=300
}


def ekg_row(synth: Synthesizer, duration_s: float,
            amplitude_uv: float = DEFAULT_EKG_UV) -> np.ndarray:
    """A dedicated ECG channel for the export.

    Persyst finds ECG by *channel name*, from the MMX's ``AutoEKGChannels`` list.
    The synthesizer's A1/A2 carry ECG contamination, but they are named A1/A2, so
    the heart-rate engine and the ``EKG Channel`` instrument silently produce
    nothing but zeros without a row actually called ``EKG``.

    ``Synthesizer._ecg`` returns the QRS train *projected onto the scalp*: each
    row is scaled by proximity to the neck and inverted over the left hemisphere
    (``prof * amplitude * near_neck * sign(x)``).  Taking row 0 would therefore
    hand Persyst a half-amplitude, negative-going Fp1 projection.  A dedicated
    lead wants the cleanest, largest, positive-going trace, so pick the row with
    the tallest R wave.

    ``amplitude_uv`` is a scale factor, not the realized peak -- the spatial
    weighting means the emitted row peaks lower.
    """
    n = int(round(duration_s * synth.fs))
    t = np.arange(n, dtype=np.float64) / synth.fs
    rows = synth._ecg(t, amplitude_uv)
    if rows.ndim == 1:
        return rows
    return rows[int(np.argmax(rows.max(axis=1)))]


def baseline_advisory(synth: Synthesizer, duration_s: float) -> Dict:
    """Will Persyst's stock baseline auto-search have anything to work with?

    **Advisory only.**  Acceptance is decided by Persyst's own detectors over the
    candidate window (artifact/EQ < 0.09, seizure probability < 0.1, chewing <
    0.35), which we cannot evaluate here -- and which ties baseline validity to
    how realistic the synthesis is.  This catches the one failure that is
    knowable up front: a recording too short for the window to exist at all, and
    events scheduled inside it.
    """
    age = synth.spec.get("age_group")
    start_s, need_s = BASELINE_WINDOW_S.get(age, BASELINE_WINDOW_S["default"])
    # The MMX presets are adult and neonatal; there is no "child" or "infant"
    # montage, so name the preset that will actually be used, not the age band.
    preset = "neonatal" if age == "neonate" else "adult"
    reasons: List[str] = []

    if duration_s < need_s:
        reasons.append(
            f"recording is {duration_s / 60:.1f} min; the {preset} P15 baseline "
            f"search runs {start_s / 60:.1f}-{need_s / 60:.1f} min, so no baseline "
            f"window exists and every VsBaseline trend will be silently zero"
        )

    end_s = min(need_s, duration_s)
    for inst in synth.seizures:
        if inst.t0 < end_s and inst.t1 > start_s:
            reasons.append(
                f"{inst.kind} at {inst.t0 / 60:.1f} min overlaps the baseline window"
            )
    for ev in getattr(synth, "artifacts", []):
        a0 = float(ev["at_min"]) * 60.0
        a1 = a0 + float(ev["duration_s"])
        if a0 < end_s and a1 > start_s:
            reasons.append(
                f"{ev.get('kind')} artifact at {a0 / 60:.1f} min overlaps the baseline window"
            )

    return {
        "window_s": [start_s, need_s],
        "age_group": age,
        "ok": not reasons,
        "reasons": reasons,
        "note": ("advisory only - Persyst decides acceptance with its own quality "
                 "thresholds over this window"),
    }
