"""Display styling for the clinical panels.

IMAGE_SPEC.md's rendering conventions say "dark-on-light instrument style ...
may be overridden in ``style``".  Both are implemented: ``style.theme`` is
``dark`` by default (which is what most PICU/NICU review stations are set to
overnight) and ``light`` follows the familiar white clinical-review convention.  An
``eeg_page`` is always black traces on white regardless of the panel theme,
because that is the only way clinical raw EEG is ever read.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, List, Tuple

import numpy as np


@dataclass(frozen=True)
class Theme:
    figure: str
    axes: str
    grid: str
    text: str
    muted: str
    accent: str
    seizure: str
    asym_left: str
    asym_right: str
    aeeg: str
    aeeg_fill: str
    sr: str
    annotation: str
    cursor: str
    spine: str


DARK = Theme(
    figure="#0e1216", axes="#151b21", grid="#28313a", text="#dde5ec", muted="#8b98a5",
    accent="#4fc3f7", seizure="#ffb020", asym_left="#4fa3ff", asym_right="#ff6b6b",
    aeeg="#9ee37d", aeeg_fill="#4d7a3e", sr="#ff8f6b", annotation="#f2f2f2",
    cursor="#00e5ff", spine="#39424b",
)

LIGHT = Theme(
    figure="#ffffff", axes="#f6f7f9", grid="#d7dce2", text="#14181d", muted="#5b6570",
    accent="#0b6ea8", seizure="#c46b00", asym_left="#1f5fb0", asym_right="#c0392b",
    aeeg="#2e7d32", aeeg_fill="#a5d6a7", sr="#b3541e", annotation="#14181d",
    cursor="#0097a7", spine="#9aa4ae",
)


def theme_for(name: str) -> Theme:
    return LIGHT if name == "light" else DARK


def spectrogram_cmap(name: str):
    """Original clinical heat map: familiar cool-to-warm grammar, not vendor-matched."""
    import matplotlib
    from matplotlib.colors import LinearSegmentedColormap
    if name and name not in ("pedquest_power", "magma"):
        try:
            return matplotlib.colormaps[name]
        except (KeyError, ValueError):  # pragma: no cover - fall through
            pass
    return LinearSegmentedColormap.from_list(
        "pedquest_power",
        [
            (0.00, "#02040b"),
            (0.14, "#15103b"),
            (0.34, "#43206f"),
            (0.55, "#8f315f"),
            (0.73, "#df6248"),
            (0.88, "#f4ad59"),
            (1.00, "#fff1bd"),
        ],
    )


def asymmetry_cmap(name: str, theme: Theme):
    """Diverging map for the relative-asymmetry spectrogram.

    Anchored on WHITE at zero, on a white panel background.  Two earlier dark
    variants both failed: a wide dark core buried real asymmetry in black, and
    a narrow one turned the estimator's own +/-12% scatter into loud red and
    blue.  White-at-zero is also the convention a reader already has from
    bedside trend software - "no colour" reads as "no asymmetry" without
    having to be learned.

    Scale reference: after the 1 Hz x 30 s integration a record specified as
    symmetric scatters about +/-12% of the +/-85 axis, a real hemispheric
    asymmetry runs 30% or more.  The near-white core covers the former; the
    ramp saturates across the latter.
    """
    import matplotlib
    from matplotlib.colors import LinearSegmentedColormap
    if name and name not in ("asym_dark", "asym_white", "RdBu_r"):
        try:
            return matplotlib.colormaps[name]
        except (KeyError, ValueError):  # pragma: no cover - fall through
            pass
    return LinearSegmentedColormap.from_list(
        "asym_white",
        [
            (0.00, "#08306b"), (0.14, "#2171b5"), (0.28, "#6baed6"),
            (0.40, "#c6dbef"), (0.46, "#eaf2fb"),
            (0.50, "#ffffff"),
            (0.54, "#fdeee7"), (0.60, "#fcbba1"), (0.72, "#fb6a4a"),
            (0.86, "#cb181d"), (1.00, "#67000d"),
        ],
    )


#: The asymmetry panel is drawn on white regardless of the figure theme, so
#: that zero reads as blank paper rather than as a coloured block.
ASYM_PANEL_BG = "#ffffff"
ASYM_PANEL_INK = "#333b44"


# --------------------------------------------------------------------------
# panel metadata
# --------------------------------------------------------------------------

PANEL_LABELS: Dict[str, str] = {
    "seizure_probability": "Seizure prob.\n(heuristic)",
    "rhythmicity_L": "Rhythmicity\nLEFT",
    "rhythmicity_R": "Rhythmicity\nRIGHT",
    "fft_L": "FFT spectrogram\nLEFT",
    "fft_R": "FFT spectrogram\nRIGHT",
    "asymmetry_relative": "Rel. asymmetry\nR(+) / L(-)",
    "asymmetry_index": "Asymmetry index\n%  R(+) / L(-)",
    "aeeg_L": "aEEG\nLEFT  (uV)",
    "aeeg_R": "aEEG\nRIGHT  (uV)",
    "suppression_ratio_L": "Suppression\nratio L  (%)",
    "suppression_ratio_R": "Suppression\nratio R  (%)",
    # EXTRA_PANELS need labels too - without an entry the panel is titled
    # with its raw spec key ("total_power_L"), which is how it shipped.
    "envelope_L": "Envelope\nLEFT  (uV)",
    "envelope_R": "Envelope\nRIGHT  (uV)",
    "total_power_L": "Total power\nLEFT  (uV^2)",
    "total_power_R": "Total power\nRIGHT  (uV^2)",
    "alpha_delta_ratio_L": "Alpha/delta\nratio LEFT",
    "alpha_delta_ratio_R": "Alpha/delta\nratio RIGHT",
    "fft_LL": "FFT  LEFT\nlateral",
    "fft_LP": "FFT  LEFT\nparasagittal",
    "fft_RP": "FFT  RIGHT\nparasagittal",
    "fft_RL": "FFT  RIGHT\nlateral",
}

#: relative vertical weight of each panel
PANEL_WEIGHT: Dict[str, float] = {
    "seizure_probability": 0.82,
    "rhythmicity_L": 1.25,
    "rhythmicity_R": 1.25,
    "fft_L": 1.25,
    "fft_R": 1.25,
    "asymmetry_relative": 1.15,
    "asymmetry_index": 0.85,
    "aeeg_L": 1.12,
    "aeeg_R": 1.12,
    "suppression_ratio_L": 0.85,
    "suppression_ratio_R": 0.85,
    "envelope_L": 0.95,
    "envelope_R": 0.95,
    "total_power_L": 0.90,
    "total_power_R": 0.90,
    "alpha_delta_ratio_L": 0.90,
    "alpha_delta_ratio_R": 0.90,
    "fft_LL": 1.15,
    "fft_LP": 1.15,
    "fft_RP": 1.15,
    "fft_RL": 1.15,
}


# --------------------------------------------------------------------------
# aEEG semilog transform (linear 0-10 uV, log 10-100 uV)
# --------------------------------------------------------------------------

AEEG_LIN_FRACTION = 0.40   # share of the axis given to the 0-10 uV linear part
AEEG_MAX = 100.0


def aeeg_forward(v: np.ndarray | float, semilog: bool = True,
                 vmax: float = AEEG_MAX) -> np.ndarray:
    """Map uV onto the aEEG axis (0..1).  ``semilog`` is the CFM default."""
    v = np.asarray(v, dtype=float)
    if not semilog:
        return np.clip(v, 0.0, vmax) / vmax
    lin = np.clip(v, 0.0, 10.0) / 10.0 * AEEG_LIN_FRACTION
    hi = np.log10(np.clip(v, 10.0, vmax) / 10.0) / np.log10(vmax / 10.0)
    return np.where(v <= 10.0, lin, AEEG_LIN_FRACTION + hi * (1.0 - AEEG_LIN_FRACTION))


AEEG_TICKS = [5, 10, 25, 50]


# --------------------------------------------------------------------------
# time axis
# --------------------------------------------------------------------------

def tick_step_min(duration_min: float) -> float:
    """Only steps that land on whole/half hours once the record is long."""
    candidates = ((1, 2, 5, 10, 15, 20, 30, 60) if duration_min < 180
                  else (30, 60, 90, 120, 180, 240))
    for step in candidates:
        if duration_min / step <= 13:
            return float(step)
    return 360.0


def time_ticks(duration_min: float, axis: str, start_clock: str) -> Tuple[List[float], List[str]]:
    step = tick_step_min(duration_min)
    vals = list(np.arange(0.0, duration_min + 1e-6, step))
    if axis == "clock":
        hh, mm = (int(p) for p in start_clock.split(":"))
        t0 = datetime(2000, 1, 1, hh % 24, mm % 60)
        labels = [(t0 + timedelta(minutes=float(v))).strftime("%H:%M") for v in vals]
    else:
        labels = [_elapsed_label(v, duration_min) for v in vals]
    return vals, labels


def _elapsed_label(v: float, duration_min: float) -> str:
    if duration_min >= 180:
        return f"{int(v) // 60}:{int(v) % 60:02d}"
    return f"{v:g}"


def axis_title(duration_min: float, axis: str) -> str:
    return "Clock time" if axis == "clock" else (
        "Elapsed (h:mm)" if duration_min >= 180 else "Elapsed (min)"
    )


# --------------------------------------------------------------------------
# matplotlib setup
# --------------------------------------------------------------------------

def apply_rc(theme: Theme) -> Dict[str, object]:
    return {
        "figure.facecolor": theme.figure,
        "savefig.facecolor": theme.figure,
        "axes.facecolor": theme.axes,
        "axes.edgecolor": theme.spine,
        "axes.labelcolor": theme.text,
        "text.color": theme.text,
        "xtick.color": theme.muted,
        "ytick.color": theme.muted,
        "grid.color": theme.grid,
        "font.family": "DejaVu Sans",
        "font.size": 8.5,
        "axes.linewidth": 0.7,
        "xtick.major.size": 3.0,
        "ytick.major.size": 2.0,
        "path.simplify": True,
        "agg.path.chunksize": 20000,
    }


#: matplotlib writes a ``Software`` tag into PNGs by default; suppressing it
#: keeps the file byte-identical across runs and machines.
PNG_METADATA = {"Software": None}
