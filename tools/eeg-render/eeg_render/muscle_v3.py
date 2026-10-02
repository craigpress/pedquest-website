"""Regional tonic muscle carriers; clinical tone/state gains belong to the caller.

Fields and envelope constants are engineering defaults, not pediatric norms.
Unlike cerebral streams, these sources have no head-wide Gaussian smoothing.
"""
from __future__ import annotations

from typing import Callable, Sequence

import numpy as np
from scipy.signal import lfilter

from .rng import substream


class RegionalMuscle:
    """Mix unit-RMS, absolute-time noise into source-specific electrode rows.

    ``noise(band, n_rows)`` must return independent fixed-normalized carrier
    rows for the requested sample indices, e.g. the synthesizer's ``_oa``.
    Output has the same units as those carriers: approximately unit source RMS
    at a region's field maximum, before the caller applies a microvolt gain.
    """

    SHARED_VARIANCE = 0.25
    STEP_S = 0.25
    PAD_S = 120.0
    _COMPONENTS = ((9.0, 0.35), (1.8, 0.35), (0.35, 0.20))

    def __init__(self, seed: int, electrodes: Sequence[str], duration_s: float,
                 posterior: bool = False):
        self.seed = int(seed)
        self.electrodes = tuple(electrodes)
        self.bands = {"frontal": (20.0, 55.0), "temporal": (20.0, 95.0)}
        if posterior:
            self.bands["posterior"] = (20.0, 95.0)
        self.row_counts = {band: len(self.electrodes) + 2 for band in self.bands}
        self._times = np.arange(-self.PAD_S, duration_s + self.PAD_S + self.STEP_S,
                                self.STEP_S)
        self._fields = {}
        self._envelopes = {}
        log_variance = sum(sigma * sigma for _, sigma in self._COMPONENTS) + 0.15 ** 2
        # E[(floor + exp(Z))**2], for stationary zero-mean Gaussian Z.
        floor = 0.18
        norm = np.sqrt(floor ** 2 + 2 * floor * np.exp(log_variance / 2)
                       + np.exp(2 * log_variance))
        for band in self.bands:
            shared = self._ou(band + "/paired", 6.0, 0.15)
            fields, envelopes = [], []
            for side in ("left", "right"):
                name = band + "/" + side
                z = shared.copy()
                for component, (tau, sigma) in enumerate(self._COMPONENTS):
                    z += self._ou(name + "/" + str(component), tau, sigma)
                envelopes.append((floor + np.exp(z)) / norm)
                fields.append(self._field(band, side))
            self._fields[band] = np.asarray(fields)
            self._envelopes[band] = np.asarray(envelopes)

    def _ou(self, name: str, tau: float, sigma: float) -> np.ndarray:
        rng = substream(self.seed, "regional-muscle-envelope", name)
        alpha = np.exp(-self.STEP_S / tau)
        out = np.empty(self._times.size)
        out[0] = rng.normal(0.0, sigma)
        out[1:], _ = lfilter([sigma * np.sqrt(1.0 - alpha ** 2)], [1.0, -alpha],
                            rng.standard_normal(out.size - 1), zi=[alpha * out[0]])
        return out

    def _field(self, band: str, side: str) -> np.ndarray:
        left = {
            "frontal": {"Fp1": 1.0, "Fp2": 0.08, "F3": 0.40, "F4": 0.04,
                        "F7": 0.35, "F8": 0.03, "Fz": 0.22, "T3": 0.08,
                        "C3": 0.05, "Cz": 0.025, "A1": 0.03},
            "temporal": {"T3": 1.0, "F7": 0.90, "T5": 0.45, "Fp1": 0.15,
                         "F3": 0.12, "C3": 0.08, "P3": 0.04, "O1": 0.04,
                         "A1": 0.15, "Fz": 0.02, "Cz": 0.015},
            "posterior": {"O1": 0.25, "T5": 0.15, "P3": 0.075, "A1": 0.10,
                          "T3": 0.025, "Pz": 0.025, "C3": 0.0125},
        }[band]
        mirror = {"Fp1": "Fp2", "Fp2": "Fp1", "F3": "F4", "F4": "F3",
                  "F7": "F8", "F8": "F7", "T3": "T4", "T5": "T6",
                  "C3": "C4", "P3": "P4", "O1": "O2", "A1": "A2"}
        weights = left if side == "left" else {mirror.get(e, e): w for e, w in left.items()}
        return np.asarray([weights.get(e, 0.0) for e in self.electrodes])

    def envelopes(self, t: np.ndarray) -> dict[str, np.ndarray]:
        """Positive continuous regional envelopes, independent of clinical state."""
        return {band: np.asarray([np.interp(t, self._times, row) for row in rows])
                for band, rows in self._envelopes.items()}

    def sample(self, t: np.ndarray,
               noise: Callable[[str, int], np.ndarray]) -> np.ndarray:
        out = np.zeros((len(self.electrodes), t.size))
        rho = self.SHARED_VARIANCE
        for band, envelope in self.envelopes(t).items():
            rows = noise(band, self.row_counts[band])
            field = self._fields[band]
            # Two source rows retain within-region covariance; independent
            # electrode residuals represent the remaining local variance.
            shared = (field.T @ (envelope * rows[:2])) * np.sqrt(rho)
            local_gain = np.sqrt((field ** 2).T @ (envelope ** 2))
            out += shared + np.sqrt(1.0 - rho) * local_gain * rows[2:]
        return out
