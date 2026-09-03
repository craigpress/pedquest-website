"""Top-level render entry point: image block -> PNG + sidecar dict."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from . import style as S  # noqa: E402
from .render_aeeg import render_aeeg, synth_spec_for_aeeg  # noqa: E402
from .render_page import render_eeg_page  # noqa: E402
from .render_panel import render_qeeg_panel  # noqa: E402
from .sidecar import build_sidecar  # noqa: E402
from .spec import normalize  # noqa: E402
from .synth import Synthesizer  # noqa: E402
from .trends import compute_trends  # noqa: E402


def attribution_note(image: Dict[str, Any]) -> str:
    if image.get("license") == "dataset-derived" and image.get("attribution"):
        return str(image["attribution"])
    return ""


def dataset_source(spec: Dict[str, Any], duration_s: float):
    """Build a :class:`DatasetSource` when the spec names an open dataset.

    Returns ``(source, attribution)`` or ``(None, None)``.  The source
    duck-types the synthesizer, so the trend pipeline is identical either way.
    """
    src = spec.get("source")
    if not src:
        return None, None
    from .datasets import DatasetSource, get_loader
    loader = get_loader(src["dataset"])
    rec = loader.load(
        src["record"],
        start_s=float(src.get("start_s", 0.0)),
        duration_s=float(src.get("duration_s", duration_s)),
    )
    return DatasetSource(rec, loader, spec), (src.get("attribution") or loader.attribution)


def _nominal_duration_s(kind: str, spec: Dict[str, Any]) -> float:
    if kind == "qeeg_panel":
        return float(spec.get("duration_min", 240)) * 60.0
    if kind == "aeeg":
        return float(spec.get("duration_h", 6)) * 3600.0
    if kind == "eeg_page":
        return float(spec.get("at_min", 0)) * 60.0 + float(spec.get("window_s", 15)) + 60.0
    return 240.0 * 60.0


def render_image(
    ident: str,
    image: Dict[str, Any],
    out_dir: str | Path,
    point_to_feature: Optional[Dict[str, Any]] = None,
) -> Tuple[Path, Dict[str, Any]]:
    """Render one *raw* (un-normalized) image block; returns (png, sidecar)."""
    norm = normalize(image)
    spec = norm["spec"]
    kind = norm["kind"]
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    png = out_dir / f"{ident}.png"
    note = attribution_note(norm)

    ds_source, ds_attr = dataset_source(spec, _nominal_duration_s(kind, spec))
    if ds_attr:
        note = ds_attr
        norm["attribution"] = ds_attr

    if kind == "qeeg_panel":
        geo, _ = render_qeeg_panel(spec, str(png), synth=ds_source, header_note=note)
        electrodes = ds_source.scalp if ds_source else None
    elif kind == "eeg_page":
        trends = None
        synth = ds_source
        if (spec["style"] or {}).get("show_trend_strip"):
            dur_min = float(spec["style"].get("trend_strip_duration_min", 240))
            synth = Synthesizer(spec, max(dur_min * 60.0,
                                          spec["at_min"] * 60.0 + spec["window_s"] + 60))
            trends = compute_trends(synth, dur_min * 60.0, spec)
        geo, synth = render_eeg_page(spec, str(png), synth=synth, trends=trends,
                                     header_note=note)
        electrodes = synth.scalp
    elif kind == "aeeg":
        geo, synth = render_aeeg(spec, str(png), synth=ds_source, header_note=note)
        electrodes = synth.scalp
    elif kind == "composite":
        geo, electrodes = _render_composite(spec, str(png), note)
    else:  # pragma: no cover - schema-guarded
        raise ValueError(f"unknown image kind {kind!r}")

    sidecar = build_sidecar(ident, norm, geo, point_to_feature, electrodes)
    sidecar["path"] = f"public/images/qbank/{ident}.png"
    return png, sidecar


# --------------------------------------------------------------------------
# composite
# --------------------------------------------------------------------------

class _CompositeGeometry:
    """Union of the sub-figure geometries, in whole-image fractions."""

    def __init__(self, width: int, height: int, panel_geo=None, page_geo=None):
        self.width = width
        self.height = height
        self.panel_geo = panel_geo
        self.page_geo = page_geo
        self.panels = []
        if panel_geo is not None:
            self.panels += list(panel_geo.panels)
        if page_geo is not None:
            self.panels += [{"name": f"page:{r['label']}", "y0": r["y0"], "y1": r["y1"],
                             "x0": page_geo.x0, "x1": page_geo.x1} for r in page_geo.rows]
        self.rows = list(page_geo.rows) if page_geo is not None else []
        self.t0_s = page_geo.t0_s if page_geo is not None else 0.0
        self.window_s = page_geo.window_s if page_geo is not None else 0.0

    # panel-style lookups
    def panel(self, name):
        for p in self.panels:
            if p["name"] == name:
                return p
        return self.panels[0] if self.panels else None

    def x_of_min(self, minutes):
        return self.panel_geo.x_of_min(minutes) if self.panel_geo else 0.5

    # page-style lookups
    def x_of_s(self, t_s):
        return self.page_geo.x_of_s(t_s) if self.page_geo else 0.5

    def rows_for(self, electrodes):
        return self.page_geo.rows_for(electrodes) if self.page_geo else []


def _render_composite(spec: Dict[str, Any], out_png: str, note: str):
    st = spec["style"]
    layout = spec.get("layout", "panel_over_page")
    panel_spec = spec.get("qeeg_panel")
    page_spec = spec.get("eeg_page")

    width, height = st["width"], st["height"]
    if layout == "side_by_side":
        width = max(width, 2000)
        height = 1000
    else:
        height = max(height, 1400)

    dpi = st["dpi"]
    fig = plt.figure(figsize=(width / dpi, height / dpi), dpi=dpi)
    theme = S.theme_for(st["theme"])
    fig.patch.set_facecolor(theme.figure)

    panel_geo = page_geo = None
    synth = None
    trends = None
    electrodes = None

    if panel_spec is not None:
        panel_spec = dict(panel_spec)
        panel_spec["style"] = dict(panel_spec["style"])
        panel_spec["style"].update({"width": width, "height": height, "dpi": dpi})
        dur_s = float(panel_spec["duration_min"]) * 60.0
        synth = Synthesizer(panel_spec, dur_s)
        trends = compute_trends(synth, dur_s, panel_spec)
        electrodes = synth.scalp

    if layout == "side_by_side":
        rects = ((0.0, 0.0, 0.5, 1.0), (0.5, 0.0, 0.5, 1.0))
    else:
        rects = ((0.0, 0.40, 1.0, 0.60), (0.0, 0.0, 1.0, 0.40))

    if panel_spec is not None:
        panel_geo, trends = render_qeeg_panel(panel_spec, out_png, trends=trends,
                                              synth=synth, header_note=note,
                                              fig=fig, rect=rects[0])
    if page_spec is not None:
        page_spec = dict(page_spec)
        page_spec["style"] = dict(page_spec["style"])
        page_spec["style"].update({"width": width, "height": height, "dpi": dpi})
        # the page is a window into the panel's own recording
        page_geo, psynth = render_eeg_page(page_spec, out_png, synth=synth,
                                           trends=trends, header_note=note,
                                           fig=fig, rect=rects[1])
        electrodes = electrodes or psynth.scalp
        # white page area behind the traces
        rx, ry, rw, rh = rects[1]
        fig.patches.append(plt.Rectangle((rx, ry), rw, rh, transform=fig.transFigure,
                                         facecolor="#ffffff", edgecolor="none",
                                         zorder=-5))

    fig.savefig(out_png, dpi=dpi, facecolor=theme.figure, metadata=S.PNG_METADATA)
    plt.close(fig)
    return _CompositeGeometry(width, height, panel_geo, page_geo), electrodes
