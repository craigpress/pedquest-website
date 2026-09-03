"""Neonatal amplitude-integrated EEG (CFM-style), single or dual channel."""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.ticker import FixedLocator  # noqa: E402

from . import montage as mt  # noqa: E402
from . import style as S  # noqa: E402
from .render_page import apply_filters, build_filters  # noqa: E402
from .synth import Synthesizer  # noqa: E402
from .trends import aeeg_margins, pick_aeeg_derivation  # noqa: E402

LEFT = 0.075
RIGHT = 0.016
TOP = 0.070
BOTTOM = 0.082
GAP = 0.055
GAP_TIGHT = 0.030

def _smooth(v: np.ndarray, k: int = 3) -> np.ndarray:
    """Light median smoothing of an aEEG margin (removes single-bin spikes
    without flattening the genuine bandwidth)."""
    from scipy import ndimage
    return ndimage.median_filter(v, size=k, mode="nearest")


def synth_spec_for_aeeg(spec: Dict) -> Dict:
    """The aeeg block's ``seizures[]`` expressed as synthesizer events.

    ``spec.events`` keeps the writer's own indices (``point_to_feature``
    references them), so the converted seizures are appended rather than
    merged in.
    """
    out = dict(spec)
    events = list(spec.get("events") or [])
    by_index = (spec.get("style") or {}).get("seizure_onset_region_by_index") or []
    for zi, z in enumerate(spec.get("seizures") or []):
        region = z.get("onset_region") or (by_index[zi] if zi < len(by_index) else None)
        dur_s = float(z["duration_min"]) * 60.0
        events.append({
            "type": "seizure",
            "onset_min": float(z["onset_h"]) * 60.0,
            "duration_s": dur_s,
            "onset_region": region or "left_central",
            "evolution": {"start_hz": 2.2, "end_hz": 1.4,
                          "amplitude_start_uv": 90.0, "amplitude_end_uv": 150.0},
            "spread": "none",
            "postictal_attenuation_s": min(120.0, dur_s * 0.5),
        })
    out["events"] = events
    return out


def aeeg_derivations(spec: Dict, synth: Synthesizer) -> List[Tuple[str, str]]:
    wanted = list(spec.get("aeeg_channels") or ["C3-P3", "C4-P4"])
    single = (spec.get("style") or {}).get("single_channel")
    if single:
        wanted = [single]
    out: List[Tuple[str, str]] = []
    for i, item in enumerate(wanted[:4]):
        side = "any"
        if isinstance(item, str) and "-" in item:
            a = item.split("-", 1)[0]
            side = mt.side_of(a) if mt.side_of(a) != "midline" else "any"
        out.append(pick_aeeg_derivation(synth, [item], side))
    return out


def render_aeeg(
    spec: Dict,
    out_png: str,
    synth: Optional[Synthesizer] = None,
    header_note: str = "",
) -> Tuple[Dict, Synthesizer]:
    st = spec["style"]
    theme = S.theme_for(st["theme"])
    duration_h = float(spec["duration_h"])
    duration_s = duration_h * 3600.0

    if synth is None:
        synth = Synthesizer(synth_spec_for_aeeg(spec), duration_s)
    pairs = aeeg_derivations(spec, synth)

    bin_s = float(np.clip(duration_s / 900.0, 10.0, 40.0))
    margins = []
    for pair in pairs:
        t, lo, hi = aeeg_margins(synth, duration_s, pair, bin_s=bin_s)
        margins.append((t, _smooth(lo), _smooth(hi)))

    raw_at = spec.get("raw_strip_at_h")
    n_rows = len(pairs)
    strip = raw_at is not None

    geo: Dict[str, object] = {"width": st["width"], "height": st["height"],
                              "panels": [], "duration_h": duration_h,
                              "x0": LEFT, "x1": 1.0 - RIGHT}

    with plt.rc_context(S.apply_rc(theme)):
        fig = plt.figure(figsize=(st["width"] / st["dpi"], st["height"] / st["dpi"]),
                         dpi=st["dpi"])
        gap = GAP if n_rows <= 2 else GAP_TIGHT
        usable = 1.0 - TOP - BOTTOM - gap * (n_rows - 1 + (1 if strip else 0))
        strip_frac = (0.26 if n_rows <= 2 else 0.20) if strip else 0.0
        row_h = (usable - strip_frac) / n_rows

        y = 1.0 - TOP
        semilog = st.get("aeeg_axis", "semilog") != "linear"
        grid_uv = [float(v) for v in (st.get("aeeg_gridlines_uv") or [5, 10, 25, 50, 100])]
        vmax = max(grid_uv)
        fwd = lambda a: S.aeeg_forward(a, semilog, vmax)  # noqa: E731

        for i, ((a, b), (t, lo, hi)) in enumerate(zip(pairs, margins)):
            y -= row_h
            ax = fig.add_axes([LEFT, y, 1.0 - LEFT - RIGHT, row_h])
            t_h = t / 3600.0
            ax.fill_between(t_h, fwd(lo), fwd(hi), color=theme.aeeg_fill,
                            alpha=0.9, linewidth=0)
            ax.plot(t_h, fwd(hi), color=theme.aeeg, linewidth=0.55)
            ax.plot(t_h, fwd(lo), color=theme.aeeg, linewidth=0.55)
            for ref, style_ in ((5.0, (0, (4, 3))), (10.0, (0, (4, 3)))):
                ax.axhline(float(fwd(ref)), color=theme.muted, linewidth=0.6,
                           linestyle=style_, alpha=0.8)
            ax.set_ylim(0.0, 1.0)
            ax.set_xlim(0.0, duration_h)
            ax.yaxis.set_major_locator(FixedLocator([float(fwd(v)) for v in grid_uv]))
            ax.set_yticklabels([f"{v:g}" for v in grid_uv], fontsize=7)
            ax.grid(axis="y", color=theme.grid, linewidth=0.4, alpha=0.45)
            ax.grid(axis="x", color=theme.grid, linewidth=0.5, alpha=0.5)
            step = 1.0 if duration_h <= 12 else 2.0
            ax.xaxis.set_major_locator(FixedLocator(list(np.arange(0, duration_h + 1e-6, step))))
            if i == n_rows - 1:
                ax.set_xlabel("Elapsed (h)", fontsize=8, color=theme.muted, labelpad=2)
                ax.tick_params(labelsize=7)
            else:
                ax.set_xticklabels([])
            ax.text(-0.010, 0.5, f"aEEG  {a}-{b}\n(uV)", transform=ax.transAxes,
                    ha="right", va="center", fontsize=7.6, color=theme.text,
                    linespacing=1.3)
            for sp in ax.spines.values():
                sp.set_color(theme.spine)
            _annotate(ax, spec, theme, duration_h, i == 0)
            geo["panels"].append({"name": f"aeeg_{a}-{b}", "y0": round(1.0 - (y + row_h), 6),
                                  "y1": round(1.0 - y, 6), "x0": LEFT, "x1": 1.0 - RIGHT})
            y -= gap

        if strip:
            y -= max(0.0, strip_frac - row_h) * 0.0
            ax = fig.add_axes([LEFT, y - strip_frac + gap, 1.0 - LEFT - RIGHT,
                               strip_frac - gap])
            _raw_strip(ax, spec, synth, pairs[0], float(raw_at), theme, st)
            geo["panels"].append({
                "name": "raw_strip",
                "y0": round(1.0 - (y - gap), 6),
                "y1": round(1.0 - (y - strip_frac + gap), 6),
                "x0": LEFT, "x1": 1.0 - RIGHT,
            })

        _header(fig, spec, theme, st, header_note)
        fig.savefig(out_png, dpi=st["dpi"], facecolor=theme.figure,
                    metadata=S.PNG_METADATA)
        plt.close(fig)
    return geo, synth


def _annotate(ax, spec: Dict, theme: S.Theme, duration_h: float, labelled: bool) -> None:
    for k, ann in enumerate(spec.get("annotations") or []):
        at_h = float(ann["at_min"]) / 60.0
        if at_h < 0 or at_h > duration_h:
            continue
        ax.axvline(at_h, color=theme.annotation, linewidth=0.75, alpha=0.55,
                   linestyle=(0, (5, 3)), zorder=5)
        if labelled:
            ax.annotate(ann["label"], xy=(at_h, 1.0), xycoords=("data", "axes fraction"),
                        xytext=(at_h, 1.06 + 0.30 * (k % 2)),
                        textcoords=("data", "axes fraction"),
                        fontsize=7.2, color=theme.annotation, ha="center", va="bottom",
                        annotation_clip=False,
                        arrowprops=dict(arrowstyle="-", color=theme.annotation,
                                        alpha=0.6, linewidth=0.6),
                        bbox=dict(boxstyle="round,pad=0.22", facecolor=theme.axes,
                                  edgecolor=theme.spine, linewidth=0.5, alpha=0.92))


def _raw_strip(ax, spec: Dict, synth: Synthesizer, pair: Tuple[str, str],
               at_h: float, theme: S.Theme, st: Dict, window_s: float = 20.0) -> None:
    t0 = at_h * 3600.0
    t, x = synth.segment(t0 - 2.0, t0 + window_s + 2.0)
    sig = synth.derive(x, [pair])
    sig = apply_filters(sig, build_filters(synth.fs, {"lf_hz": 0.5, "hf_hz": 70.0,
                                                      "notch_hz": 60.0}))[0]
    keep = (t >= t0) & (t < t0 + window_s)
    ax.plot(t[keep] - t0, sig[keep], color=theme.text, linewidth=0.55)
    ax.set_xlim(0, window_s)
    lim = max(60.0, float(np.percentile(np.abs(sig[keep]), 99.7)) * 1.35)
    ax.set_ylim(-lim, lim)
    ax.set_yticks([])
    ax.set_xticks(np.arange(0, window_s + 1e-6, 2.0))
    ax.tick_params(labelsize=6.5)
    ax.set_xlabel(f"raw {pair[0]}-{pair[1]} at {at_h:g} h  (s)", fontsize=7.4,
                  color=theme.muted, labelpad=1)
    ax.grid(axis="x", color=theme.grid, linewidth=0.4, alpha=0.5)
    for sp in ax.spines.values():
        sp.set_color(theme.spine)
    # calibration
    ax.plot([window_s * 0.012, window_s * 0.012], [-25, 25], color=theme.accent,
            linewidth=1.5, zorder=6)
    ax.text(window_s * 0.020, 0, "50 uV", fontsize=6.6, color=theme.accent,
            ha="left", va="center")


def _header(fig, spec: Dict, theme: S.Theme, st: Dict, note: str) -> None:
    title = st.get("title") or "Amplitude-integrated EEG"
    fig.text(LEFT, 1.0 - TOP * 0.45, title, fontsize=11.5, color=theme.text,
             va="center", ha="left", weight="bold")
    bits = [
        f"{spec['duration_h']:g} h",
        f"pattern {spec['pattern']}",
        f"cycling {spec['sleep_wake_cycling']}",
        f"seed {spec['seed']}",
    ]
    right = "SYNTHETIC - not patient data  |  " + "  |  ".join(bits)
    if note:
        right = note + "  |  " + right
    fig.text(1.0 - RIGHT, 1.0 - TOP * 0.45, right, fontsize=8, color=theme.muted,
             va="center", ha="right")
