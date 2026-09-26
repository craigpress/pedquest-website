"""Key-versus-visible contracts (0.5.0).

The answer key claims events; these checks measure whether a reader could see them on the displayed signal.
Feature review 2026-09-26: keyed seizures were invisible for their first 15 %, 10-s boundary runs showed for 7.5-9 s,
and ictal runs sat at background amplitude.  ``seizure_visibility`` renders the record with and without its events
(same seed, so the background is identical) through the page's display chain and, per keyed second, compares the
ictal signal with the background in every longitudinal-bipolar derivation.
"""
from __future__ import annotations

import copy
from typing import Dict, List

import numpy as np

from . import montage as mt
from .render_page import apply_filters, build_filters
from .spec import normalize
from .synth import Synthesizer

ICTAL_KINDS = ("seizure", "seizure_cluster", "status_epilepticus")


def _displayed(synth: Synthesizer, t0: float, t1: float, pairs, causal: bool) -> np.ndarray:
    _, x = synth.segment(max(0.0, t0 - 10.0), t1)
    sig = synth.derive(x, pairs, "longitudinal_bipolar")
    sig = apply_filters(sig, build_filters(synth.fs, {"lf_hz": 1.0, "hf_hz": 70.0}, causal), causal)
    return sig[:, int(round((t0 - max(0.0, t0 - 10.0)) * synth.fs)):]


def seizure_visibility(image: Dict, snr: float = 1.0) -> List[Dict]:
    """Per realized ictal run: keyed seconds, visible seconds and the per-second best-derivation SNR.

    A second is visible when, in at least one derivation, the 1-s RMS of (record - background) is at least
    ``snr`` times the 1-s RMS of the background.
    """
    spec = normalize(copy.deepcopy(image))["spec"]
    quiet = copy.deepcopy(spec)
    quiet["events"] = [e for e in quiet["events"] if e.get("type") not in ICTAL_KINDS]
    horizon = float(spec.get("duration_min", 30)) * 60.0
    with_sz = Synthesizer(spec, horizon)
    without = Synthesizer(quiet, horizon)
    pairs = mt.montage_pairs("longitudinal_bipolar", with_sz.scalp)
    causal = int(spec.get("spec_version") or 1) >= 3
    fs = with_sz.fs
    out = []
    for z in with_sz.seizures:
        if z.kind not in ICTAL_KINDS:
            continue
        t0, t1 = z.t0, min(z.t0 + z.duration_s, horizon)
        a = _displayed(with_sz, t0, t1, pairs, causal)
        b = _displayed(without, t0, t1, pairs, causal)
        n = int((t1 - t0) // 1)
        ratios = []
        for k in range(n):
            s = slice(k * fs, (k + 1) * fs)
            ict = np.sqrt(np.mean((a[:, s] - b[:, s]) ** 2, axis=1))
            bg = np.sqrt(np.mean(b[:, s] ** 2, axis=1)) + 1e-9
            ratios.append(float(np.max(ict / bg)))
        r = np.array(ratios)
        out.append({"kind": z.kind, "t0": t0, "keyed_s": z.duration_s, "visible_s": int((r >= snr).sum()),
                    "first_visible_s": int(np.argmax(r >= snr)) if (r >= snr).any() else None,
                    "median_snr": float(np.median(r)) if r.size else 0.0})
    return out
