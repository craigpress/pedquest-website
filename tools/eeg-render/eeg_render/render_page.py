"""Paper-style raw EEG page (black traces on white).

Physical scale is honoured: the page is laid out at the clinical 30 mm/s paper
speed, and ``sensitivity_uv_mm`` sets microvolts per millimetre against that
same millimetre.  So a 15 s page is 450 mm wide, and at 7 uV/mm a row that is
13 mm tall spans ~90 uV - the geometry a reader's eye is calibrated to.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from scipy import signal as sps  # noqa: E402

from . import montage as mt  # noqa: E402
from . import style as S  # noqa: E402
from .synth import Synthesizer  # noqa: E402

PAPER_MM_PER_S = 30.0

LEFT = 0.062
RIGHT = 0.010
TOP = 0.072
BOTTOM = 0.088

PAGE_BG = "#ffffff"
PAGE_INK = "#111111"
PAGE_GRID = "#e2b8b8"      # the faint red 1 s rule of clinical EEG paper
PAGE_GRID_MINOR = "#f0dada"
PAGE_MUTED = "#4a4a4a"


class PageGeometry:
    """Row positions and the time axis of a rendered page, in image fractions."""

    def __init__(self, width: int, height: int, t0_s: float, window_s: float):
        self.width = width
        self.height = height
        self.t0_s = t0_s
        self.window_s = window_s
        self.rows: List[Dict[str, object]] = []
        self.x0 = LEFT
        self.x1 = 1.0 - RIGHT
        self.y0 = 0.0
        self.y1 = 1.0

    def x_of_s(self, t_s: float) -> float:
        frac = np.clip((t_s - self.t0_s) / max(self.window_s, 1e-9), 0.0, 1.0)
        return float(self.x0 + frac * (self.x1 - self.x0))

    def rows_for(self, electrodes: List[str]) -> List[Dict[str, object]]:
        want = set(electrodes)
        return [r for r in self.rows if want & set(r["electrodes"])]


def build_filters(fs: int, filters: Dict) -> List[np.ndarray]:
    """SOS chain for the display filters (LF high-pass, HF low-pass, notch)."""
    nyq = fs / 2.0
    out: List[np.ndarray] = []
    lf = filters.get("lf_hz")
    hf = filters.get("hf_hz")
    notch = filters.get("notch_hz")
    if lf:
        out.append(sps.butter(2, min(float(lf) / nyq, 0.99), btype="high", output="sos"))
    if hf and float(hf) < nyq * 0.98:
        out.append(sps.butter(4, float(hf) / nyq, btype="low", output="sos"))
    if notch and 0 < float(notch) < nyq * 0.98:
        b, a = sps.iirnotch(float(notch), Q=30.0, fs=fs)
        out.append(sps.tf2sos(b, a))
    return out


def apply_filters(sig: np.ndarray, sos_chain: List[np.ndarray]) -> np.ndarray:
    for sos in sos_chain:
        sig = sps.sosfiltfilt(sos, sig, axis=-1)
    return sig


def page_signals(spec: Dict, synth: Optional[Synthesizer] = None,
                 pad_s: float = 4.0) -> Tuple[Synthesizer, np.ndarray, np.ndarray,
                                              List[Tuple[str, Optional[str]]], np.ndarray]:
    """Return (synth, t, filtered derivations, pairs, ecg) for the page window."""
    t0 = float(spec["at_min"]) * 60.0
    win = float(spec["window_s"])
    if synth is None:
        synth = Synthesizer(spec, t0 + win + 60.0)
    fs = synth.fs
    t_all, x = synth.segment(t0 - pad_s, t0 + win + pad_s)
    pairs = mt.montage_pairs(spec["montage"], synth.scalp)
    sig = synth.derive(x, pairs, spec["montage"])
    sig = apply_filters(sig, build_filters(fs, spec["filters"]))
    ecg = synth._ecg(t_all, amplitude=260.0)[synth._idx["A1"]] * 0.9
    keep = (t_all >= t0 - 1e-9) & (t_all < t0 + win - 1e-9)
    return synth, t_all[keep], sig[:, keep], pairs, ecg[keep]


def render_eeg_page(
    spec: Dict,
    out_png: str,
    synth: Optional[Synthesizer] = None,
    trends=None,
    header_note: str = "",
    fig=None,
    rect: Tuple[float, float, float, float] = (0.0, 0.0, 1.0, 1.0),
) -> Tuple[PageGeometry, Synthesizer]:
    st = spec["style"]
    t0 = float(spec["at_min"]) * 60.0
    win = float(spec["window_s"])
    sens = float(spec["sensitivity_uv_mm"])

    synth, t, sig, pairs, ecg = page_signals(spec, synth)
    labels = [mt.montage_label(p, spec["montage"]) for p in pairs]
    if st.get("show_ecg_channel"):
        sig = np.vstack([sig, ecg[None, :]])
        labels = labels + ["ECG"]
        pairs = list(pairs) + [("A1", "A2")]

    own_fig = fig is None
    rc = dict(S.apply_rc(S.LIGHT))
    rc.update({"figure.facecolor": PAGE_BG, "savefig.facecolor": PAGE_BG,
               "axes.facecolor": PAGE_BG, "axes.edgecolor": PAGE_MUTED,
               "text.color": PAGE_INK, "xtick.color": PAGE_MUTED,
               "ytick.color": PAGE_MUTED})
    with plt.rc_context(rc):
        if own_fig:
            fig = plt.figure(figsize=(st["width"] / st["dpi"], st["height"] / st["dpi"]),
                             dpi=st["dpi"])
            fig.patch.set_facecolor(PAGE_BG)
        rx, ry, rw, rh = rect

        strip_h = 0.0
        if st.get("show_trend_strip") and trends is not None:
            strip_h = 0.30

        ax_x = rx + LEFT * rw
        ax_w = (1.0 - LEFT - RIGHT) * rw
        ax_h = (1.0 - TOP - BOTTOM - strip_h) * rh
        ax_y = ry + (BOTTOM + strip_h) * rh
        ax = fig.add_axes([ax_x, ax_y, ax_w, ax_h])
        ax.set_facecolor(PAGE_BG)

        # --- physical scale ------------------------------------------------
        plot_w_px = ax_w * st["width"]
        plot_h_px = ax_h * st["height"]
        px_per_mm = plot_w_px / (win * PAPER_MM_PER_S)
        uv_per_px = sens / px_per_mm
        n_rows = len(labels)
        row_px = plot_h_px / (n_rows + 1.7)
        row_uv = row_px * uv_per_px
        total_uv = row_uv * (n_rows + 1.7)

        offsets = np.array([-(i + 0.8) * row_uv for i in range(n_rows)])

        # --- grid ----------------------------------------------------------
        for k in range(int(np.floor(win)) + 1):
            ax.axvline(t0 + k, color=PAGE_GRID, linewidth=0.7, zorder=0)
        for k in np.arange(0, win + 1e-9, 0.2):
            ax.axvline(t0 + k, color=PAGE_GRID_MINOR, linewidth=0.35, zorder=0)

        # --- traces ----------------------------------------------------------
        for i, (row, lbl) in enumerate(zip(sig, labels)):
            ax.plot(t, row + offsets[i], color=PAGE_INK, linewidth=0.52,
                    solid_joinstyle="round", zorder=3)
            ax.text(t0 - win * 0.006, offsets[i], lbl, ha="right", va="center",
                    fontsize=7.4, color=PAGE_INK, family="DejaVu Sans")

        ax.set_xlim(t0, t0 + win)
        ax.set_ylim(-total_uv + row_uv * 0.2, row_uv * 0.4)
        ax.set_yticks([])
        ax.set_xticks(np.arange(t0, t0 + win + 1e-9, 1.0))
        ax.set_xticklabels([f"{k}" for k in range(int(win) + 1)], fontsize=7)
        ax.set_xlabel(f"seconds from {_hhmmss(t0)} (elapsed)", fontsize=8, color=PAGE_MUTED,
                      labelpad=2)
        for sp in ("top", "right"):
            ax.spines[sp].set_visible(False)
        ax.spines["left"].set_color(PAGE_MUTED)
        ax.spines["bottom"].set_color(PAGE_MUTED)

        # --- calibration bar --------------------------------------------------
        cal_uv = 50.0
        cx = t0 + win * 0.012
        cy = -total_uv + row_uv * 0.75
        ax.plot([cx, cx], [cy, cy + cal_uv], color=PAGE_INK, linewidth=1.3, zorder=5)
        ax.plot([cx, cx + 1.0], [cy, cy], color=PAGE_INK, linewidth=1.3, zorder=5)
        ax.text(cx + win * 0.006, cy + cal_uv * 0.55, f"{cal_uv:g} uV", fontsize=7,
                color=PAGE_INK, va="center")
        ax.text(cx + 1.0 + win * 0.004, cy - row_uv * 0.12, "1 s", fontsize=7,
                color=PAGE_INK, va="top")

        geo = PageGeometry(st["width"], st["height"], t0, win)
        geo.x0 = ax_x
        geo.x1 = ax_x + ax_w
        geo.y0 = 1.0 - (ax_y + ax_h)
        geo.y1 = 1.0 - ax_y
        span = ax.get_ylim()[1] - ax.get_ylim()[0]
        for i, (pair, lbl) in enumerate(zip(pairs, labels)):
            centre_frac = (ax.get_ylim()[1] - offsets[i]) / span
            half = (row_uv * 0.5) / span
            geo.rows.append({
                "label": lbl,
                "electrodes": [e for e in pair if e],
                "y0": round(geo.y0 + (centre_frac - half) * (geo.y1 - geo.y0), 6),
                "y1": round(geo.y0 + (centre_frac + half) * (geo.y1 - geo.y0), 6),
            })

        _page_header(fig, spec, st, header_note, rx, ry, rw, rh, sens)

        if strip_h > 0:
            _trend_strip(fig, spec, st, trends, rx, ry, rw, rh, strip_h, t0, win)

        if own_fig:
            fig.savefig(out_png, dpi=st["dpi"], facecolor=PAGE_BG,
                        metadata=S.PNG_METADATA)
            plt.close(fig)
    return geo, synth


def _hhmmss(t_s: float) -> str:
    t = int(round(t_s))
    return f"{t // 3600:d}:{(t % 3600) // 60:02d}:{t % 60:02d}"


def _page_header(fig, spec: Dict, st: Dict, note: str, rx, ry, rw, rh, sens) -> None:
    f = spec["filters"]
    title = st.get("title") or "EEG"
    y = ry + (1.0 - TOP * 0.45) * rh
    fig.text(rx + LEFT * rw, y, title, fontsize=11.5, color=PAGE_INK,
             va="center", ha="left", weight="bold")
    bits = [
        f"{spec['montage'].replace('_', ' ')}",
        f"{sens:g} uV/mm",
        f"{PAPER_MM_PER_S:g} mm/s",
        f"LFF {f['lf_hz'] or '-'} Hz",
        f"HFF {f['hf_hz'] or '-'} Hz",
        f"notch {f['notch_hz'] or 'off'} Hz",
        f"seed {spec['seed']}",
    ]
    right = "SYNTHETIC - not patient data  |  " + "  |  ".join(bits)
    if note:
        right = note + "  |  " + right
    fig.text(rx + (1.0 - RIGHT) * rw, y, right, fontsize=7.6, color=PAGE_MUTED,
             va="center", ha="right")


def _trend_strip(fig, spec: Dict, st: Dict, trends, rx, ry, rw, rh, strip_h,
                 t0_s: float, win_s: float) -> None:
    """Compact trend context under a page, with a cursor on the page window."""
    from matplotlib.ticker import FixedLocator
    names = list(st.get("trend_strip_panels") or ["rhythmicity_L", "rhythmicity_R"])
    dur_min = float(st.get("trend_strip_duration_min", 240))
    theme = S.LIGHT
    n = len(names)
    pad = 0.012
    each = (strip_h - pad * (n + 1)) / max(n, 1)
    for i, name in enumerate(names):
        y = ry + (BOTTOM * 0.15 + pad + i * (each + pad)) * rh
        ax = fig.add_axes([rx + LEFT * rw, y, (1.0 - LEFT - RIGHT) * rw, each * rh])
        side = "left" if name.endswith("_L") else "right"
        t_min = trends.t / 60.0
        if name.startswith("rhythmicity"):
            data, freqs, vmin, vmax = np.power(trends.rhy[side], 1.4), trends.rhy_freqs, 0.0, 0.8
        else:
            data = 10.0 * np.log10(np.maximum(trends.psd[side], 1e-4))
            freqs, vmin, vmax = trends.freqs, float(np.percentile(data, 12)), float(np.percentile(data, 99.5))
        ax.imshow(data, aspect="auto", origin="lower",
                  cmap=S.spectrogram_cmap(st["spectrogram_cmap"]),
                  vmin=vmin, vmax=vmax, extent=[0, float(t_min[-1]), float(freqs[0]),
                                                float(freqs[-1])],
                  interpolation="antialiased", rasterized=True)
        ax.set_xlim(0, dur_min)
        ax.set_ylim(0, 20)
        ax.yaxis.set_major_locator(FixedLocator([0, 10, 20]))
        ax.set_yticklabels(["0", "10", ""], fontsize=5.6)
        ax.text(-0.022, 0.5, S.PANEL_LABELS.get(name, name),
                transform=ax.transAxes, ha="right", va="center", fontsize=6.1,
                linespacing=1.15, color=PAGE_INK)
        ax.axvline(t0_s / 60.0, color="#0097a7", linewidth=1.2)
        if i == 0:
            ax.set_xticks(np.arange(0, dur_min + 1e-6, S.tick_step_min(dur_min)))
            ax.tick_params(labelsize=6)
            ax.set_xlabel("Trend context - elapsed (min); cursor = page above",
                          fontsize=6.8, color=PAGE_MUTED, labelpad=1)
        else:
            ax.set_xticklabels([])
        for sp in ax.spines.values():
            sp.set_color(PAGE_MUTED)
            sp.set_linewidth(0.5)
