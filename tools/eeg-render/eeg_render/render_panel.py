"""Persyst-style multi-trend qEEG panel."""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.ticker import FixedLocator  # noqa: E402

from . import style as S  # noqa: E402
from .synth import Synthesizer  # noqa: E402
from .trends import Trends, compute_trends  # noqa: E402

LEFT = 0.128
RIGHT_MARGIN = 0.016
TOP_HEADER = 0.052
ANNOT_BAND = 0.052
BOTTOM = 0.072
GAP = 0.0065


class PanelGeometry:
    """Where each panel and the time axis ended up, in image fractions."""

    def __init__(self, width: int, height: int, duration_min: float):
        self.width = width
        self.height = height
        self.duration_min = duration_min
        self.panels: List[Dict[str, float | str]] = []
        self.x0 = LEFT
        self.x1 = 1.0 - RIGHT_MARGIN

    def add(self, name: str, rect_y: float, rect_h: float) -> None:
        """``rect_y``/``rect_h`` are matplotlib figure fractions (y up from the
        bottom); the sidecar reports image fractions (y down from the top)."""
        self.panels.append({
            "name": name,
            "y0": round(1.0 - (rect_y + rect_h), 6),
            "y1": round(1.0 - rect_y, 6),
            "x0": round(self.x0, 6),
            "x1": round(self.x1, 6),
        })

    def x_of_min(self, minutes: float) -> float:
        frac = np.clip(minutes / max(self.duration_min, 1e-9), 0.0, 1.0)
        return float(self.x0 + frac * (self.x1 - self.x0))

    def panel(self, name: str) -> Optional[Dict[str, float | str]]:
        for p in self.panels:
            if p["name"] == name:
                return p
        return None


def render_qeeg_panel(
    spec: Dict,
    out_png: str,
    trends: Optional[Trends] = None,
    synth: Optional[Synthesizer] = None,
    header_note: str = "",
    fig=None,
    rect: Tuple[float, float, float, float] = (0.0, 0.0, 1.0, 1.0),
) -> Tuple[PanelGeometry, Trends]:
    """Render the trend panel.  Pass ``fig``/``rect`` to embed in a composite."""
    st = spec["style"]
    theme = S.theme_for(st["theme"])
    duration_min = float(spec["duration_min"])
    duration_s = duration_min * 60.0

    if synth is None:
        synth = Synthesizer(spec, duration_s)
    if trends is None:
        trends = compute_trends(synth, duration_s, spec)

    own_fig = fig is None
    with plt.rc_context(S.apply_rc(theme)):
        if own_fig:
            fig = plt.figure(figsize=(st["width"] / st["dpi"], st["height"] / st["dpi"]),
                             dpi=st["dpi"])
        rx, ry, rw, rh = rect
        right_margin = 0.06 if st.get("show_colorbar") else RIGHT_MARGIN
        geo = PanelGeometry(st["width"], st["height"], duration_min)
        geo.x0 = rx + LEFT * rw
        geo.x1 = rx + (1.0 - right_margin) * rw

        panels = list(spec["panels"])
        weights = [S.PANEL_WEIGHT.get(p, 1.0) for p in panels]
        usable = 1.0 - TOP_HEADER - ANNOT_BAND - BOTTOM - GAP * (len(panels) - 1)
        unit = usable / max(sum(weights), 1e-9)

        axes: List[Tuple[str, plt.Axes]] = []
        y = 1.0 - TOP_HEADER - ANNOT_BAND
        for name, w in zip(panels, weights):
            h = unit * w
            y -= h
            ax = fig.add_axes([rx + LEFT * rw, ry + y * rh,
                               (1.0 - LEFT - right_margin) * rw, h * rh])
            axes.append((name, ax))
            geo.add(name, ry + y * rh, h * rh)
            y -= GAP

        for i, (name, ax) in enumerate(axes):
            last = i == len(axes) - 1
            _draw_panel(ax, name, trends, theme, duration_min, spec, st, last)

        _draw_header(fig, spec, theme, st, header_note, rx, ry, rw, rh)
        _draw_annotations(fig, axes, spec, theme, duration_min, rx, ry, rw, rh)

        if own_fig:
            fig.savefig(out_png, dpi=st["dpi"], facecolor=theme.figure,
                        metadata=S.PNG_METADATA)
            plt.close(fig)
    return geo, trends


# --------------------------------------------------------------------------

def _fmt_axis(ax, theme: S.Theme, duration_min: float, spec: Dict, style: Dict,
              show_x: bool) -> None:
    ax.set_xlim(0.0, duration_min)
    vals, labels = S.time_ticks(duration_min, spec["time_axis"], style["start_clock"])
    ax.xaxis.set_major_locator(FixedLocator(vals))
    if show_x:
        ax.set_xticklabels(labels, fontsize=7.5)
        ax.set_xlabel(S.axis_title(duration_min, spec["time_axis"]),
                      fontsize=8, color=theme.muted, labelpad=2)
    else:
        ax.set_xticklabels([])
    ax.grid(axis="x", color=theme.grid, linewidth=0.5, alpha=0.55)
    for sp in ax.spines.values():
        sp.set_color(theme.spine)
    ax.tick_params(labelsize=7)
    ax.tick_params(axis="y", pad=1.5, labelsize=6.0, length=1.5)


def _label(ax, name: str, theme: S.Theme, text: Optional[str] = None) -> None:
    ax.text(-0.030, 0.5, text or S.PANEL_LABELS.get(name, name), transform=ax.transAxes,
            ha="right", va="center", fontsize=7.1, color=theme.text, linespacing=1.3)


def _hz_range(st: Dict, key: str, default=(0.0, 20.0)) -> Tuple[float, float]:
    rng = st.get(key)
    if not rng or len(rng) != 2:
        return default
    # the trend grids stop at 20 Hz, so a wider request is clipped rather than
    # silently stretching the data
    return float(max(0.0, rng[0])), float(min(20.0, rng[1]))


def _hz_ticks(st: Dict, lo: float, hi: float) -> List[float]:
    ticks = st.get("spectrogram_ticks_hz")
    if ticks:
        return [float(v) for v in ticks if lo <= float(v) <= hi]
    return [v for v in (0, 5, 10, 15, 20) if lo <= v <= hi]


def _spectrogram(ax, data: np.ndarray, freqs: np.ndarray, t_min: np.ndarray,
                 cmap, vmin: float, vmax: float, theme: S.Theme, st: Dict,
                 hz_key: str = "spectrogram_hz_range", light_grid: bool = True):
    lo, hi = _hz_range(st, hz_key)
    ax.imshow(data, aspect="auto", origin="lower", cmap=cmap, vmin=vmin, vmax=vmax,
              extent=[0.0, float(t_min[-1]), float(freqs[0]), float(freqs[-1])],
              interpolation="antialiased", rasterized=True)
    ax.set_ylim(lo, hi)
    ticks = _hz_ticks(st, lo, hi)
    ax.yaxis.set_major_locator(FixedLocator(ticks))
    labels = [f"{t:g}" for t in ticks]
    if labels and abs(ticks[-1] - hi) < 1e-6:
        labels[-1] = ""
    ax.set_yticklabels(labels, fontsize=6.0)
    ax.grid(axis="x", color="#ffffff" if light_grid else "#000000",
            linewidth=0.35, alpha=0.12)


def _line_panel(ax, t_min, v, color, theme: S.Theme, lo: float, hi: float,
                ticks, labels, log: bool = False, fill: bool = True):
    if log:
        v = np.maximum(v, max(lo, 1e-3))
    if fill:
        ax.fill_between(t_min, lo, np.clip(v, lo, hi), color=color, alpha=0.85, linewidth=0)
    ax.plot(t_min, np.clip(v, lo, hi), color=color, linewidth=0.7)
    if log:
        ax.set_yscale("log")
    ax.set_ylim(lo, hi)
    ax.yaxis.set_major_locator(FixedLocator(ticks))
    ax.set_yticklabels(labels, fontsize=6.0)
    ax.grid(axis="y", color=theme.grid, linewidth=0.4, alpha=0.5)


def _draw_panel(ax, name: str, tr: Trends, theme: S.Theme, duration_min: float,
                spec: Dict, st: Dict, last: bool) -> None:
    t_min = tr.t / 60.0
    cmap = S.spectrogram_cmap(st["spectrogram_cmap"])
    side = "left" if name.endswith("_L") else "right"

    if name in ("fft_L", "fft_R"):
        db = 10.0 * np.log10(np.maximum(tr.psd[side], 1e-4))
        both = 10.0 * np.log10(np.maximum(np.concatenate(
            [tr.psd["left"], tr.psd["right"]], axis=1), 1e-4))
        vmin = float(np.percentile(both, 12))
        vmax = float(np.percentile(both, 99.6))
        if vmax - vmin < 22:
            vmax = vmin + 22
        _spectrogram(ax, db, tr.freqs, t_min, cmap, vmin, vmax, theme, st)
        if st.get("show_colorbar"):
            _mini_colorbar(ax, cmap, vmin, vmax, theme, "dB")

    elif name in ("rhythmicity_L", "rhythmicity_R"):
        _spectrogram(ax, np.power(tr.rhy[side], 1.4), tr.rhy_freqs, t_min, cmap,
                     0.0, 0.80, theme, st, hz_key="rhythmicity_hz_range")

    elif name == "asymmetry_relative":
        tot = tr.psd["left"] + tr.psd["right"]
        conf = tot / (tot + float(np.percentile(tot, 55)) + 1e-9)
        _spectrogram(ax, tr.asym_rel * conf, tr.freqs, t_min,
                     S.asymmetry_cmap(st["asymmetry_cmap"], theme), -85, 85, theme, st,
                     hz_key="asymmetry_spectrogram_hz_range", light_grid=False)

    elif name == "asymmetry_index":
        rng = st.get("asymmetry_index_axis_pct") or [-50, 50]
        lo, hi = float(rng[0]), float(rng[1])
        v = np.clip(tr.asym_idx, lo, hi)
        if st.get("asymmetry_index_zero_line", True):
            ax.axhline(0.0, color=theme.muted, linewidth=0.6, alpha=0.7)
        ax.fill_between(t_min, 0, np.clip(v, 0, None), color=theme.asym_right,
                        alpha=0.75, linewidth=0)
        ax.fill_between(t_min, np.clip(v, None, 0), 0, color=theme.asym_left,
                        alpha=0.75, linewidth=0)
        ax.plot(t_min, v, color=theme.text, linewidth=0.45, alpha=0.55)
        ax.set_ylim(lo, hi)
        ax.yaxis.set_major_locator(FixedLocator([lo, 0, hi]))
        ax.set_yticklabels([f"{lo:g} L", "0", f"+{hi:g} R"], fontsize=6.0)
        ax.grid(axis="y", color=theme.grid, linewidth=0.4, alpha=0.5)

    elif name in ("aeeg_L", "aeeg_R"):
        semilog = st.get("aeeg_axis", "semilog") != "linear"
        grid_uv = [float(v) for v in (st.get("aeeg_gridlines_uv") or S.AEEG_TICKS)]
        vmax = max(grid_uv + [S.AEEG_MAX if semilog else 100.0])
        fwd = lambda a: S.aeeg_forward(a, semilog, vmax)  # noqa: E731
        lo = fwd(np.maximum(tr.aeeg_lo[side], 0.0))
        hi = fwd(np.maximum(tr.aeeg_hi[side], 0.0))
        ax.fill_between(t_min, lo, hi, color=theme.aeeg_fill, alpha=0.85, linewidth=0)
        ax.plot(t_min, hi, color=theme.aeeg, linewidth=0.5)
        ax.plot(t_min, lo, color=theme.aeeg, linewidth=0.5)
        for ref in (5.0, 10.0):
            ax.axhline(float(fwd(ref)), color=theme.muted, linewidth=0.5,
                       linestyle=(0, (3, 3)), alpha=0.7)
        ax.set_ylim(0.0, 1.0)
        ax.yaxis.set_major_locator(FixedLocator([float(fwd(v)) for v in grid_uv]))
        ax.set_yticklabels([f"{v:g}" for v in grid_uv], fontsize=6.0)
        ax.grid(axis="y", color=theme.grid, linewidth=0.35, alpha=0.4)

    elif name in ("suppression_ratio_L", "suppression_ratio_R"):
        rng = st.get("suppression_ratio_axis_pct") or [0, 100]
        lo, hi = float(rng[0]), float(rng[1])
        band = st.get("suppression_ratio_target_band_pct")
        if band and len(band) == 2:
            ax.axhspan(float(band[0]), float(band[1]), color=theme.accent,
                       alpha=0.13, linewidth=0)
        v = np.clip(tr.sr[side], lo, hi)
        ax.fill_between(t_min, lo, v, color=theme.sr, alpha=0.85, linewidth=0)
        ax.plot(t_min, np.where(v > lo + 0.4, v, np.nan), color=theme.sr, linewidth=0.7)
        ax.set_ylim(lo, hi)
        mid = (lo + hi) / 2.0
        ax.yaxis.set_major_locator(FixedLocator([lo, mid, hi]))
        ax.set_yticklabels([f"{lo:g}", f"{mid:g}", f"{hi:g}"], fontsize=6.0)
        ax.grid(axis="y", color=theme.grid, linewidth=0.4, alpha=0.5)

    elif name in ("envelope_L", "envelope_R"):
        rng = st.get("envelope_axis_uv") or [0, 100]
        lo, hi = float(rng[0]), float(rng[1])
        mid = (lo + hi) / 2.0
        _line_panel(ax, t_min, tr.env[side], theme.aeeg, theme, lo, hi,
                    [lo, mid, hi], [f"{lo:g}", f"{mid:g}", f"{hi:g}"], fill=False)

    elif name in ("total_power_L", "total_power_R"):
        log = st.get("total_power_axis", "log") == "log"
        v = tr.total_power[side]
        if log:
            hi = max(float(np.percentile(v, 99.5)) * 2.5, 10.0)
            lo = max(hi / 1e3, 0.1)
            ticks = [lo, (lo * hi) ** 0.5, hi]
            _line_panel(ax, t_min, v, theme.accent, theme, lo, hi, ticks,
                        [f"{t:.3g}" for t in ticks], log=True)
        else:
            hi = max(float(np.percentile(v, 99.5)) * 1.2, 1.0)
            _line_panel(ax, t_min, v, theme.accent, theme, 0.0, hi,
                        [0, hi / 2, hi], ["0", f"{hi/2:.3g}", f"{hi:.3g}"])

    elif name in ("alpha_delta_ratio_L", "alpha_delta_ratio_R"):
        rng = st.get("alpha_delta_ratio_axis") or [0, 2]
        lo, hi = float(rng[0]), float(rng[1])
        mid = (lo + hi) / 2.0
        _line_panel(ax, t_min, tr.adr[side], theme.asym_left, theme, lo, hi,
                    [lo, mid, hi], [f"{lo:g}", f"{mid:g}", f"{hi:g}"])

    elif name == "seizure_probability":
        v = np.clip(tr.szprob, 0, 1)
        ax.fill_between(t_min, 0, v, color=theme.seizure, alpha=0.9, linewidth=0)
        ax.plot(t_min, np.where(v > 0.02, v, np.nan), color=theme.seizure, linewidth=0.7)
        ax.set_ylim(0, 1.05)
        ax.yaxis.set_major_locator(FixedLocator([0, 0.5, 1.0]))
        ax.set_yticklabels(["0", ".5", "1"], fontsize=6.0)
        ax.grid(axis="y", color=theme.grid, linewidth=0.4, alpha=0.5)
        if st.get("show_detector_event_strip"):
            for m in (st.get("detector_marks_at_min") or []):
                ax.plot([float(m)], [1.0], marker="v", markersize=3.2,
                        color=theme.cursor, clip_on=False, zorder=6)

    if st.get("panel_labels") != "hidden":
        text = None
        if name in ("aeeg_L", "aeeg_R") and tr.aeeg_derivation:
            text = f"aEEG {side.upper()}\n{tr.aeeg_derivation[side]}  (uV)"
        if name in ("suppression_ratio_L", "suppression_ratio_R"):
            text = (f"Suppression\nratio {side[0].upper()}  (%)\n"
                    f"<{tr.sr_threshold_uv:g} uV")
        _label(ax, name, theme, text)
    _fmt_axis(ax, theme, duration_min, spec, st, last)

    cursor = spec.get("show_cursor_at_min")
    if cursor is not None:
        ax.axvline(float(cursor), color=theme.cursor, linewidth=1.1, alpha=0.9)


def _mini_colorbar(ax, cmap, vmin: float, vmax: float, theme: S.Theme, unit: str) -> None:
    """Small in-panel colour key, drawn only when ``style.show_colorbar``."""
    import matplotlib.colors as mcolors
    cax = ax.inset_axes([1.005, 0.06, 0.011, 0.88])
    grad = np.linspace(0, 1, 128).reshape(-1, 1)
    cax.imshow(grad, aspect="auto", origin="lower", cmap=cmap,
               norm=mcolors.Normalize(0, 1))
    cax.set_xticks([])
    cax.yaxis.tick_right()
    cax.set_yticks([0, 127])
    cax.set_yticklabels([f"{vmin:.0f}", f"{vmax:.0f} {unit}"], fontsize=5.2)
    cax.tick_params(length=1.0, pad=1.0, colors=theme.muted)
    for sp in cax.spines.values():
        sp.set_color(theme.spine)
        sp.set_linewidth(0.4)


def _draw_header(fig, spec: Dict, theme: S.Theme, st: Dict, note: str,
                 rx: float, ry: float, rw: float, rh: float) -> None:
    title = st.get("title") or "Quantitative EEG trends"
    dur = float(spec["duration_min"])
    y = ry + (1.0 - TOP_HEADER * 0.62) * rh
    fig.text(rx + LEFT * rw, y, title, fontsize=11.5, color=theme.text,
             va="center", ha="left", weight="bold")
    right = (f"SYNTHETIC - not patient data  |  {dur:g} min  |  "
             f"{spec['channels'].replace('_', ' ')}  |  seed {spec['seed']}")
    if note:
        right = note + "  |  " + right
    fig.text(rx + (1.0 - RIGHT_MARGIN) * rw, y, right, fontsize=8,
             color=theme.muted, va="center", ha="right")


def _draw_annotations(fig, axes, spec: Dict, theme: S.Theme, duration_min: float,
                      rx: float, ry: float, rw: float, rh: float) -> None:
    anns = spec.get("annotations") or []
    if not anns:
        return
    top_ax = axes[0][1]
    for k, ann in enumerate(sorted(anns, key=lambda a: a["at_min"])):
        at = float(ann["at_min"])
        if at < 0 or at > duration_min:
            continue
        for _, ax in axes:
            ax.axvline(at, color=theme.annotation, linewidth=0.75, alpha=0.5,
                       linestyle=(0, (5, 3)), zorder=5)
        tier = k % 2
        ypos = 1.06 + 0.60 * tier
        top_ax.annotate(
            ann["label"], xy=(at, 1.0), xycoords=("data", "axes fraction"),
            xytext=(at, ypos), textcoords=("data", "axes fraction"),
            fontsize=7.3, color=theme.annotation, ha="center", va="bottom",
            rotation=0, annotation_clip=False,
            arrowprops=dict(arrowstyle="-", color=theme.annotation, alpha=0.6,
                            linewidth=0.6, shrinkA=0, shrinkB=1),
            bbox=dict(boxstyle="round,pad=0.22", facecolor=theme.axes,
                      edgecolor=theme.spine, linewidth=0.5, alpha=0.92),
        )
