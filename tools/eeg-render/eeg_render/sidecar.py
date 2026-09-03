"""Sidecar JSON: panel geometry, provenance and the derived answer region.

Every coordinate is a fraction of image width/height with the origin at the
**top left**, matching the ``panels[]``/``answer_region`` example in
IMAGE_SPEC.md, so the region survives any resize the site applies.

The answer region is never hand-drawn.  For a ``point_to_feature`` question it
is computed from the spec event named by ``point_to_feature.target_event``
(an index into ``image.spec.events``) projected onto ``target_panel``:

* ``qeeg_panel`` - a narrow rect around the event's onset time on that panel,
  widened to at least ``tolerance`` so a reader clicking near the mark scores.
* ``eeg_page``  - the time window of the event intersected with the page, and
  the display rows carrying the electrodes the event's region projects onto.
* ``aeeg``      - the event's time window on the aEEG channel row.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from . import RENDERER_VERSION
from . import montage as mt
from .spec import spec_hash

DEFAULT_TOLERANCE = 0.04


def _event_time_min(ev: Dict[str, Any]) -> Optional[float]:
    for key in ("onset_min", "at_min", "start_min"):
        if key in ev:
            return float(ev[key])
    return None


def _event_duration_min(ev: Dict[str, Any]) -> float:
    if "duration_min" in ev:
        return float(ev["duration_min"])
    if "duration_s" in ev:
        return float(ev["duration_s"]) / 60.0
    if ev.get("type") == "seizure_cluster":
        return max(float(ev.get("end_min", 0)) - float(ev.get("start_min", 0)), 1.0)
    if ev.get("type") == "seizure" and "duration_s" in ev:
        return float(ev["duration_s"]) / 60.0
    return 1.0


def _event_region(ev: Dict[str, Any]) -> Optional[str]:
    if "onset_region" in ev:
        return str(ev["onset_region"])
    if isinstance(ev.get("seizure"), dict):
        return str(ev["seizure"].get("onset_region"))
    side = ev.get("side")
    if side in ("left", "right"):
        return f"{side}_hemisphere"
    return None


def panel_answer_region(geo, spec: Dict, ev: Dict[str, Any], target_panel: str,
                        tolerance: float) -> Optional[Dict[str, Any]]:
    panel = geo.panel(target_panel) or (geo.panels[0] if geo.panels else None)
    if panel is None:
        return None
    t0 = _event_time_min(ev)
    if t0 is None:
        return None
    dur = _event_duration_min(ev)
    x_lo = geo.x_of_min(t0)
    x_hi = geo.x_of_min(t0 + dur)
    # a 2 min seizure on a 4 h panel is ~4 px wide; widen to the click tolerance
    half = max(tolerance, 0.012)
    x0 = max(0.0, min(x_lo, x_hi) - half * 0.5)
    x1 = min(1.0, max(x_lo, x_hi) + half * 0.5)
    y0 = float(panel["y0"])
    y1 = float(panel["y1"])
    return {"kind": "rect", "x": round(x0, 6), "y": round(y0, 6),
            "w": round(x1 - x0, 6), "h": round(y1 - y0, 6),
            "panel": str(panel["name"])}


def page_answer_region(geo, spec: Dict, ev: Dict[str, Any],
                       tolerance: float, electrodes: List[str]) -> Optional[Dict[str, Any]]:
    t0 = _event_time_min(ev)
    if t0 is None:
        return None
    ev_t0 = t0 * 60.0
    ev_t1 = ev_t0 + _event_duration_min(ev) * 60.0
    page_t0 = geo.t0_s
    page_t1 = geo.t0_s + geo.window_s
    lo = max(ev_t0, page_t0)
    hi = min(ev_t1, page_t1)
    if hi <= lo:                     # the event is off-page: mark the whole page
        lo, hi = page_t0, page_t1
    x0 = geo.x_of_s(lo)
    x1 = geo.x_of_s(hi)
    rows = geo.rows_for(electrodes) or geo.rows
    y0 = min(float(r["y0"]) for r in rows)
    y1 = max(float(r["y1"]) for r in rows)
    pad = max(tolerance * 0.25, 0.004)
    return {"kind": "rect",
            "x": round(max(0.0, x0 - pad), 6), "y": round(max(0.0, y0 - pad), 6),
            "w": round(min(1.0, x1 + pad) - max(0.0, x0 - pad), 6),
            "h": round(min(1.0, y1 + pad) - max(0.0, y0 - pad), 6),
            "panel": "page",
            "channels": [str(r["label"]) for r in rows]}


def aeeg_answer_region(geo: Dict[str, Any], spec: Dict, ev: Dict[str, Any],
                       target_panel: str, tolerance: float) -> Optional[Dict[str, Any]]:
    panels = geo.get("panels") or []
    if not panels:
        return None
    panel = next((p for p in panels if p["name"] == target_panel), panels[0])
    t0 = _event_time_min(ev)
    if t0 is None:
        return None
    dur_h = _event_duration_min(ev) / 60.0
    total_h = float(geo["duration_h"])
    x_lo = geo["x0"] + (t0 / 60.0) / total_h * (geo["x1"] - geo["x0"])
    x_hi = geo["x0"] + ((t0 / 60.0 + dur_h) / total_h) * (geo["x1"] - geo["x0"])
    half = max(tolerance, 0.012)
    x0 = max(0.0, x_lo - half * 0.5)
    x1 = min(1.0, x_hi + half * 0.5)
    return {"kind": "rect", "x": round(x0, 6), "y": round(float(panel["y0"]), 6),
            "w": round(x1 - x0, 6),
            "h": round(float(panel["y1"]) - float(panel["y0"]), 6),
            "panel": str(panel["name"])}


def resolve_target_event(spec: Dict, ptf: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """``target_event`` indexes ``image.spec.events`` (composites: the panel's)."""
    events = spec.get("events")
    if events is None and isinstance(spec.get("qeeg_panel"), dict):
        events = spec["qeeg_panel"].get("events")
    if not events:
        # an aeeg block puts its ictal events in `seizures[]`
        zs = spec.get("seizures") or []
        idx = int(ptf.get("target_event", 0))
        if 0 <= idx < len(zs):
            z = dict(zs[idx])
            z["onset_min"] = float(z["onset_h"]) * 60.0
            return z
        return None
    idx = int(ptf.get("target_event", 0))
    if not (0 <= idx < len(events)):
        return None
    return events[idx]


def build_sidecar(
    ident: str,
    image: Dict[str, Any],
    geometry: Any,
    point_to_feature: Optional[Dict[str, Any]],
    electrodes: Optional[List[str]] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    spec = image["spec"]
    kind = image["kind"]
    if isinstance(geometry, dict):
        width, height = geometry["width"], geometry["height"]
        panels = geometry.get("panels", [])
    else:
        width, height = geometry.width, geometry.height
        panels = getattr(geometry, "panels", None) or getattr(geometry, "rows", [])

    answer = None
    if point_to_feature:
        tol = float(point_to_feature.get("tolerance", DEFAULT_TOLERANCE))
        target = point_to_feature.get("target_panel", "page")
        ev = resolve_target_event(spec, point_to_feature)
        if ev is not None:
            if kind == "eeg_page" or target == "page":
                region = _event_region(ev) or "generalized"
                elec = mt.electrodes_for_region(region, electrodes or mt.STANDARD_19)
                if hasattr(geometry, "rows"):
                    answer = page_answer_region(geometry, spec, ev, tol, elec)
            elif kind == "aeeg":
                answer = aeeg_answer_region(geometry, spec, ev, target, tol)
            elif hasattr(geometry, "panel"):
                answer = panel_answer_region(geometry, spec, ev, target, tol)

    out: Dict[str, Any] = {
        "id": ident,
        "kind": kind,
        "width": int(width),
        "height": int(height),
        "answer_region": answer,
        "panels": [
            {k: v for k, v in p.items() if k in ("name", "label", "y0", "y1", "x0", "x1")}
            for p in panels
        ],
        "license": image.get("license", "synthetic-original"),
        "attribution": image.get("attribution"),
        "renderer_version": RENDERER_VERSION,
        "spec_hash": spec_hash(image),
    }
    if extra:
        out.update(extra)
    return out
