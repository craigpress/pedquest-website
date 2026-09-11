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
from scipy.ndimage import uniform_filter  # noqa: E402

from .trends import Trends, compute_trends  # noqa: E402

LEFT = 0.225
RIGHT_MARGIN = 0.016
TOP_HEADER = 0.052
ANNOT_BAND = 0.052
BOTTOM = 0.072
GAP = 0.0115


class PanelGeometry:
    """Where each panel and the time axis ended up, in image fractions."""

    def __init__(self, width: int, height: int, duration_min: float):
        self.width = width
        self.height = height
        self.duration_min = duration_min
        self.panels: List[Dict[str, float | str]] = []
        #: dB window each spectrogram panel was drawn with, for the sidecar
        self.db_ranges: Dict[str, List[float]] = {}
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
            _draw_panel(ax, name, trends, theme, duration_min, spec, st, last,
                        db_sink=geo.db_ranges)

        _draw_header(fig, spec, theme, st, header_note, rx, ry, rw, rh)
        _draw_cursor_caption(axes, spec, theme, duration_min, st)
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
        ax.set_xticklabels(labels, fontsize=10.0)
        ax.set_xlabel(S.axis_title(duration_min, spec["time_axis"]),
                      fontsize=11.0, color=theme.muted, labelpad=3)
    else:
        ax.set_xticklabels([])
    ax.grid(axis="x", color=theme.grid, linewidth=0.5, alpha=0.55)
    for sp in ax.spines.values():
        sp.set_color(theme.spine)
    ax.tick_params(labelsize=9.6)
    ax.tick_params(axis="y", pad=2.0, labelsize=8.8, length=2.0)


#: Panel titles are the first thing a reader needs and the thing most often
#: read at less than full size (the review console and the learner page both
#: scale a 1600 px render into ~700 px).  Size them for that, not for 1:1.
PANEL_LABEL_SIZE = 13.0


def _label(ax, name: str, theme: S.Theme, text: Optional[str] = None) -> None:
    label = text or S.PANEL_LABELS.get(name, name)
    # A short panel cannot hold a three-line label at full size - the
    # suppression-ratio pair ("Suppression / ratio L (%) / <5 uV", weight
    # 0.85) ran into each other once the labels grew.  Cap the size at what
    # the panel is actually tall enough for.
    fig = ax.get_figure()
    height_pt = ax.get_position().height * fig.get_figheight() * 72.0
    n_lines = label.count("\n") + 1
    size = max(8.0, min(PANEL_LABEL_SIZE, height_pt / (n_lines * 1.5)))
    # -0.048 clears the y tick labels, which grow leftward from 0 and are now
    # large enough ("100", "-50 L") to collide with a label sitting at -0.018.
    ax.text(-0.048, 0.5, label, transform=ax.transAxes,
            ha="right", va="center", fontsize=size, fontweight="semibold",
            color=theme.text, linespacing=1.25)


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
    ax.set_yticklabels(labels, fontsize=8.8)
    ax.grid(axis="x", color="#ffffff" if light_grid else "#000000",
            linewidth=0.35, alpha=0.12)


#: Integration window for the relative-asymmetry spectrogram.
_ASYM_SMOOTH_HZ = 1.0
_ASYM_SMOOTH_S = 30.0


def _smooth_field(field, freqs, t_s, hz: float, seconds: float):
    """Box-average a time-frequency field over a window given in Hz and
    seconds, converted to bins from the axes actually present."""
    if field.size == 0:
        return field
    d_hz = float(np.median(np.diff(freqs))) if len(freqs) > 1 else hz
    d_s = float(np.median(np.diff(t_s))) if len(t_s) > 1 else seconds
    n_f = max(1, int(round(hz / d_hz))) if d_hz > 0 else 1
    n_t = max(1, int(round(seconds / d_s))) if d_s > 0 else 1
    if n_f <= 1 and n_t <= 1:
        return field
    return uniform_filter(field, size=(n_f, n_t), mode="nearest")


def _fft_db_range(st: Dict, tr: Trends, db) -> Tuple[float, float]:
    """The dB window a spectrogram panel is drawn with.

    ``style.fft_db_range`` pins it, which is what makes colour mean the same
    thing in every item - the convention the published atlas uses. Otherwise
    it is fitted to this record, which maximises contrast within one image at
    the cost of comparability between two.
    """
    rng = st.get("fft_db_range")
    if rng and len(rng) == 2:
        return float(rng[0]), float(rng[1])
    pool = db if db is not None else 10.0 * np.log10(np.maximum(
        np.concatenate([tr.psd["left"], tr.psd["right"]], axis=1), 1e-4))
    vmin = float(np.percentile(pool, 12))
    vmax = float(np.percentile(pool, 99.6))
    if vmax - vmin < 22:
        vmax = vmin + 22
    return vmin, vmax


def _record_db_range(sink: Optional[Dict], name: str, vmin: float, vmax: float) -> None:
    """Record the dB window this panel was drawn with, for the sidecar.

    The PNG holds colour; recovering dB from a pixel needs the vmin/vmax that
    produced it, so the sidecar has to carry it.

    This must NOT be written back into the spec. Doing that (the first cut of
    this) made spec_hash depend on the render output, so a freshly rendered
    image failed its own verification - the hash taken before drawing no
    longer matched the one taken after.
    """
    if sink is None:
        return
    sink[name] = [round(vmin, 3), round(vmax, 3)]


def _nice_ceiling(value: float) -> float:
    """Round up to the next 1/2/5 x 10^n, so an auto-scaled axis gets tick
    labels a reader can actually place (0.2, not 0.183)."""
    import math
    if value <= 0:
        return 1.0
    exp = math.floor(math.log10(value))
    frac = value / (10.0 ** exp)
    step = 1.0 if frac <= 1.0 else 2.0 if frac <= 2.0 else 5.0 if frac <= 5.0 else 10.0
    return step * (10.0 ** exp)


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
    ax.set_yticklabels(labels, fontsize=8.8)
    ax.grid(axis="y", color=theme.grid, linewidth=0.4, alpha=0.5)


RATIO_BANDS = {"alpha_delta_ratio": "adr", "theta_delta_ratio": "tdr"}
#: which regional chains a paired regional panel compares
REGION_PAIRS = {"lateral": ("LL", "RL"), "parasagittal": ("LP", "RP")}


def _ratio_axis(st: Dict, key: str, series) -> tuple:
    """Fit a shared y-window to every series drawn on a paired panel.

    Both traces must share one axis or the comparison the panel exists for is
    meaningless, and a fitted window is needed because a delta-dominant record
    lives near 0.05 where a fixed 0-2 axis shows a flat line on the floor.
    """
    rng = st.get(key)
    if rng and len(rng) == 2:
        return float(rng[0]), float(rng[1])
    both = np.concatenate([np.asarray(v) for v in series])
    top = float(np.percentile(both, 99.5))
    bottom = float(np.percentile(both, 0.5))
    hi = _nice_ceiling(max(top * 1.15, 0.05))
    lo = 0.0 if bottom < 0.35 * hi else max(0.0, bottom - 0.25 * (top - bottom))
    return lo, hi


def _paired_panel(ax, t_min, left, right, theme: S.Theme, lo: float, hi: float,
                  fmt: str = "{:.3g}", left_label: str = "L", right_label: str = "R") -> None:
    """Two traces on one axis: left blue, right red, with an inline legend.

    The legend is drawn in the panel rather than in the row label because the
    label column is narrow and the colours are the only thing telling a reader
    which side is which.
    """
    mid = (lo + hi) / 2.0
    for value, color in ((left, theme.asym_left), (right, theme.asym_right)):
        ax.plot(t_min, np.clip(value, lo, hi), color=color, linewidth=0.9)
    ax.set_ylim(lo, hi)
    ax.yaxis.set_major_locator(FixedLocator([lo, mid, hi]))
    ax.set_yticklabels([fmt.format(lo), fmt.format(mid), fmt.format(hi)], fontsize=8.8)
    ax.grid(axis="y", color=theme.grid, linewidth=0.4, alpha=0.5)
    ax.text(0.995, 0.93, right_label, transform=ax.transAxes, ha="right", va="top",
            fontsize=8.5, color=theme.asym_right, fontweight="bold")
    ax.text(0.995, 0.07, left_label, transform=ax.transAxes, ha="right", va="bottom",
            fontsize=8.5, color=theme.asym_left, fontweight="bold")


def _draw_panel(ax, name: str, tr: Trends, theme: S.Theme, duration_min: float,
                spec: Dict, st: Dict, last: bool,
                db_sink: Optional[Dict] = None) -> None:
    t_min = tr.t / 60.0
    cmap = S.spectrogram_cmap(st["spectrogram_cmap"])
    side = "left" if name.endswith("_L") else "right"

    if name in ("fft_LL", "fft_LP", "fft_RP", "fft_RL"):
        region = name.split("_", 1)[1]
        data = tr.psd_region.get(region)
        if data is None:
            return
        db = 10.0 * np.log10(np.maximum(data, 1e-4))
        # One scale across ALL regions. Scaling each panel to its own data
        # would make the four regions look alike no matter how different they
        # are, which is the opposite of what a regional comparison is for.
        pooled = 10.0 * np.log10(np.maximum(
            np.concatenate(list(tr.psd_region.values()), axis=1), 1e-4))
        vmin, vmax = _fft_db_range(st, tr, pooled)
        _spectrogram(ax, db, tr.freqs, t_min, cmap, vmin, vmax, theme, st)
        _record_db_range(db_sink, name, vmin, vmax)
        if st.get("show_colorbar"):
            _mini_colorbar(ax, cmap, vmin, vmax, theme, "dB")

    elif name in ("fft_L", "fft_R"):
        db = 10.0 * np.log10(np.maximum(tr.psd[side], 1e-4))
        # A FIXED dB window makes colour mean the same thing in every item,
        # which is what a teaching atlas needs - the reference implementation
        # for "A Primer on EEG Spectrograms" (bdsp-core/eeg-spectrogram-atlas,
        # Ng/Jing/Westover, J Clin Neurophysiol 2022) hard-codes [-10, 25] dB
        # for exactly that reason.  Per-record percentiles (the default here)
        # maximise contrast within one image but make two images
        # incomparable.  Opt in per item with style.fft_db_range.
        vmin, vmax = _fft_db_range(st, tr, None)
        _spectrogram(ax, db, tr.freqs, t_min, cmap, vmin, vmax, theme, st)
        _record_db_range(db_sink, name, vmin, vmax)
        if st.get("show_colorbar"):
            _mini_colorbar(ax, cmap, vmin, vmax, theme, "dB")

    elif name in ("rhythmicity_L", "rhythmicity_R"):
        _spectrogram(ax, np.power(tr.rhy[side], 1.4), tr.rhy_freqs, t_min, cmap,
                     0.0, 0.80, theme, st, hz_key="rhythmicity_hz_range")

    elif name == "asymmetry_relative":
        tot = tr.psd["left"] + tr.psd["right"]
        conf = tot / (tot + float(np.percentile(tot, 55)) + 1e-9)
        # Per-bin L-vs-R ratios are dominated by estimator noise: on a record
        # specified as symmetric the raw field still scatters with a standard
        # deviation near 11% of the +/-85 scale, so the panel reads as busy
        # shifting asymmetry that is not in the data.  Clinical trend software
        # integrates before displaying; do the same over a fixed physical
        # window (1 Hz x 30 s) rather than a fixed bin count, so the smoothing
        # does not change with the record's duration or frequency resolution.
        # 30 s still resolves a focal seizure while cutting scatter ~8-fold.
        field = _smooth_field(tr.asym_rel * conf, tr.freqs, tr.t,
                              hz=_ASYM_SMOOTH_HZ, seconds=_ASYM_SMOOTH_S)
        ax.set_facecolor(S.ASYM_PANEL_BG)
        _spectrogram(ax, field, tr.freqs, t_min,
                     S.asymmetry_cmap(st["asymmetry_cmap"], theme), -85, 85, theme, st,
                     hz_key="asymmetry_spectrogram_hz_range", light_grid=False)
        # Only the frame is dark.  The tick LABELS sit outside the panel, on
        # the dark figure, so they keep the theme colour - painting them dark
        # grey (the first attempt) made the whole x axis disappear.
        for _sp in ax.spines.values():
            _sp.set_color(S.ASYM_PANEL_INK)
            _sp.set_linewidth(0.7)

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
        ax.set_yticklabels([f"{lo:g} L", "0", f"+{hi:g} R"], fontsize=8.8)
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
        ax.set_yticklabels([f"{v:g}" for v in grid_uv], fontsize=8.8)
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
        ax.set_yticklabels([f"{lo:g}", f"{mid:g}", f"{hi:g}"], fontsize=8.8)
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
            import math
            # Decade bounds and decade ticks.  The earlier geometric-mean tick
            # gave labels like "31.1" between "0.319" and "319" - three
            # crowded, hard-to-place numbers on a short panel.
            hi = 10.0 ** math.ceil(math.log10(max(float(np.percentile(v, 99.5)) * 2.5, 10.0)))
            lo = hi / 1e3
            ticks = [lo, lo * 10.0, lo * 100.0, hi]
            _line_panel(ax, t_min, v, theme.accent, theme, lo, hi, ticks,
                        [f"{t:g}" for t in ticks], log=True)
        else:
            hi = max(float(np.percentile(v, 99.5)) * 1.2, 1.0)
            _line_panel(ax, t_min, v, theme.accent, theme, 0.0, hi,
                        [0, hi / 2, hi], ["0", f"{hi/2:.3g}", f"{hi:.3g}"])

    elif name in ("alpha_delta_ratio", "theta_delta_ratio"):
        series = tr.adr if name == "alpha_delta_ratio" else tr.tdr
        lo, hi = _ratio_axis(st, f"{name}_axis", [series["left"], series["right"]])
        _paired_panel(ax, t_min, series["left"], series["right"], theme, lo, hi)

    elif name.endswith(("_lateral", "_parasagittal")) and name.startswith(
            ("alpha_delta_ratio", "theta_delta_ratio")):
        base, _, region_key = name.rpartition("_")
        left_key, right_key = REGION_PAIRS[region_key]
        series = tr.adr_region if base == "alpha_delta_ratio" else tr.tdr_region
        left, right = series.get(left_key), series.get(right_key)
        if left is None or right is None:
            return
        lo, hi = _ratio_axis(st, f"{base}_axis", [left, right])
        _paired_panel(ax, t_min, left, right, theme, lo, hi)

    elif name in ("suppression_ratio", "suppression_ratio_global"):
        rng = st.get("suppression_ratio_axis_pct") or [0, 100]
        lo, hi = float(rng[0]), float(rng[1])
        band = st.get("suppression_ratio_target_band_pct")
        if band and len(band) == 2:
            ax.axhspan(float(band[0]), float(band[1]), color=theme.accent,
                       alpha=0.13, linewidth=0)
        if name == "suppression_ratio_global":
            # whole brain: one trace, the mean of the two hemispheres
            mean = 0.5 * (tr.sr["left"] + tr.sr["right"])
            mid = (lo + hi) / 2.0
            _line_panel(ax, t_min, np.clip(mean, lo, hi), theme.sr, theme, lo, hi,
                        [lo, mid, hi], [f"{lo:g}", f"{mid:g}", f"{hi:g}"])
        else:
            _paired_panel(ax, t_min, tr.sr["left"], tr.sr["right"], theme, lo, hi, fmt="{:g}")

    elif name in ("theta_delta_ratio_L", "theta_delta_ratio_R"):
        lo, hi = _ratio_axis(st, "theta_delta_ratio_axis", [tr.tdr["left"], tr.tdr["right"]])
        mid = (lo + hi) / 2.0
        _line_panel(ax, t_min, tr.tdr[side], theme.asym_left, theme, lo, hi,
                    [lo, mid, hi], [f"{lo:.3g}", f"{mid:.3g}", f"{hi:.3g}"], fill=False)

    elif name in ("alpha_delta_ratio_L", "alpha_delta_ratio_R"):
        v = tr.adr[side]
        rng = st.get("alpha_delta_ratio_axis")
        if rng and len(rng) == 2:
            lo, hi = float(rng[0]), float(rng[1])
        else:
            # The old fixed 0-2 default flattened every real trace onto the
            # x-axis: a delta-dominant or suppressed record runs near 0.05, so
            # 97% of the panel was empty.  Fit the axis to the data instead,
            # and scale both hemispheres together so L and R stay comparable.
            both = np.concatenate([tr.adr["left"], tr.adr["right"]])
            top = float(np.percentile(both, 99.5))
            bottom = float(np.percentile(both, 0.5))
            hi = _nice_ceiling(max(top * 1.15, 0.05))
            # Anchor at zero only when the trace actually uses that range;
            # a record living between 0.08 and 0.11 needs a fitted window or
            # every change disappears into a solid block.
            lo = 0.0 if bottom < 0.35 * hi else max(0.0, bottom - 0.25 * (top - bottom))
        mid = (lo + hi) / 2.0
        _line_panel(ax, t_min, v, theme.asym_left, theme, lo, hi,
                    [lo, mid, hi], [f"{lo:.3g}", f"{mid:.3g}", f"{hi:.3g}"],
                    fill=False)

    elif name == "seizure_probability":
        v = np.clip(tr.szprob, 0, 1)
        ax.fill_between(t_min, 0, v, color=theme.seizure, alpha=0.9, linewidth=0)
        ax.plot(t_min, np.where(v > 0.02, v, np.nan), color=theme.seizure, linewidth=0.7)
        ax.set_ylim(0, 1.05)
        ax.yaxis.set_major_locator(FixedLocator([0, 0.5, 1.0]))
        ax.set_yticklabels(["0", ".5", "1"], fontsize=8.8)
        ax.grid(axis="y", color=theme.grid, linewidth=0.4, alpha=0.5)
        if st.get("show_detector_event_strip"):
            for m in (st.get("detector_marks_at_min") or []):
                ax.plot([float(m)], [1.0], marker="v", markersize=3.2,
                        color=theme.cursor, clip_on=False, zorder=6)

    if st.get("panel_labels") != "hidden":
        text = None
        if name in ("aeeg_L", "aeeg_R") and tr.aeeg_derivation:
            text = f"aEEG {side.upper()}\n{tr.aeeg_derivation[side]}  (uV)"
        if name in ("suppression_ratio", "suppression_ratio_global"):
            sides = "L vs R  " if name == "suppression_ratio" else ""
            text = f"Suppression ratio\n{sides}(%) <{tr.sr_threshold_uv:g} uV"
        if name in ("suppression_ratio_L", "suppression_ratio_R"):
            # Threshold on the same line as the unit, not a third line: the
            # panel is short, and three lines forced the label down to a size
            # that could not be read at page scale.
            text = (f"Suppression ratio {side[0].upper()}\n"
                    f"(%) <{tr.sr_threshold_uv:g} uV")
        _label(ax, name, theme, text)
    _fmt_axis(ax, theme, duration_min, spec, st, last)

    cursor = spec.get("show_cursor_at_min")
    if cursor is not None:
        ax.axvline(float(cursor), color=theme.cursor, linewidth=1.4, alpha=0.95,
                   zorder=6)


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
    cax.set_yticklabels([f"{vmin:.0f}", f"{vmax:.0f} {unit}"], fontsize=7.6)
    cax.tick_params(length=1.0, pad=1.0, colors=theme.muted)
    for sp in cax.spines.values():
        sp.set_color(theme.spine)
        sp.set_linewidth(0.4)


def _draw_header(fig, spec: Dict, theme: S.Theme, st: Dict, note: str,
                 rx: float, ry: float, rw: float, rh: float) -> None:
    title = st.get("title") or "Quantitative EEG trends"
    dur = float(spec["duration_min"])
    y = ry + (1.0 - TOP_HEADER * 0.62) * rh
    fig.text(rx + LEFT * rw, y, title, fontsize=16.0, color=theme.text,
             va="center", ha="left", weight="bold")
    right = (f"SYNTHETIC - not patient data  |  {dur:g} min  |  "
             f"{spec['channels'].replace('_', ' ')}  |  seed {spec['seed']}")
    if note:
        right = note + "  |  " + right
    fig.text(rx + (1.0 - RIGHT_MARGIN) * rw, y, right, fontsize=10.6,
             color=theme.muted, va="center", ha="right")


def _draw_cursor_caption(axes, spec: Dict, theme: S.Theme, duration_min: float,
                         st: Dict) -> None:
    """Name what the cursor line marks.

    On a composite the cursor is where the raw page below was taken from, and a
    bare vertical line does not say so - the reader has to guess whether it is
    an event, an annotation or a drug.
    """
    cursor = spec.get("show_cursor_at_min")
    if cursor is None or not axes:
        return
    at = float(cursor)
    if at < 0 or at > duration_min:
        return
    label = st.get("cursor_label") or "raw page below"
    # Annotations occupy the band just above the top panel.  If one sits near
    # the cursor the two captions overlap into an unreadable pile, so step up
    # to the annotations' second tier when that would happen.
    near = any(
        abs(float(a["at_min"]) - at) < 0.10 * max(duration_min, 1e-9)
        for a in (spec.get("annotations") or [])
    )
    ypos = 1.70 if near else 1.05
    axes[0][1].annotate(
        label, xy=(at, 1.0), xycoords=("data", "axes fraction"),
        xytext=(at, ypos), textcoords=("data", "axes fraction"),
        fontsize=9.4, color=theme.cursor, ha="center", va="bottom",
        annotation_clip=False, zorder=7,
        arrowprops=dict(arrowstyle="-", color=theme.cursor, alpha=0.7,
                        linewidth=0.6, shrinkA=0, shrinkB=1),
        bbox=dict(boxstyle="round,pad=0.22", facecolor=theme.axes,
                  edgecolor=theme.cursor, linewidth=0.6, alpha=0.95),
    )


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
            fontsize=9.6, color=theme.annotation, ha="center", va="bottom",
            rotation=0, annotation_clip=False,
            arrowprops=dict(arrowstyle="-", color=theme.annotation, alpha=0.6,
                            linewidth=0.6, shrinkA=0, shrinkB=1),
            bbox=dict(boxstyle="round,pad=0.22", facecolor=theme.axes,
                      edgecolor=theme.spine, linewidth=0.5, alpha=0.92),
        )
