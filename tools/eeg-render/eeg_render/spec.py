"""Load / validate / normalize an ``image`` block and hash it canonically."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import jsonschema
import yaml

from . import RENDERER_VERSION
from .schema import HONOURED_STYLE_KEYS, IMAGE_SCHEMA, spec_schema_for

DEFAULT_PANELS: List[str] = [
    "seizure_probability",
    "rhythmicity_L",
    "rhythmicity_R",
    "fft_L",
    "fft_R",
    "asymmetry_relative",
    "asymmetry_index",
    "aeeg_L",
    "aeeg_R",
    "suppression_ratio_L",
    "suppression_ratio_R",
]

#: age-group background presets (dominant_hz, amplitude_uv, slow_fraction)
AGE_DEFAULTS: Dict[str, Dict[str, Any]] = {
    "neonate": {"dominant_hz": 1.5, "amplitude_uv": 60.0, "slow_fraction": 0.80,
                "type": "discontinuous", "delta_brushes": True, "baseline_ecg_uv": 3.5},
    "infant": {"dominant_hz": 5.5, "amplitude_uv": 55.0, "slow_fraction": 0.55,
               "type": "continuous", "delta_brushes": False, "baseline_ecg_uv": 2.5},
    "child": {"dominant_hz": 8.0, "amplitude_uv": 45.0, "slow_fraction": 0.40,
              "type": "continuous", "delta_brushes": False, "baseline_ecg_uv": 2.0},
    "adolescent": {"dominant_hz": 9.5, "amplitude_uv": 35.0, "slow_fraction": 0.30,
                   "type": "continuous", "delta_brushes": False, "baseline_ecg_uv": 2.0},
}

#: how each background type maps onto the unified burst/interburst engine.
#: ``suppression_fraction`` is the fraction of time spent below the burst
#: envelope; ``ibi_floor`` is the residual envelope during the interburst.
BACKGROUND_PRESETS: Dict[str, Dict[str, float]] = {
    "continuous":                {"suppression_fraction": 0.00, "cycle_s": 12.0, "ibi_floor": 1.00, "amp_scale": 1.00},
    "discontinuous":             {"suppression_fraction": 0.35, "cycle_s": 16.0, "ibi_floor": 0.22, "amp_scale": 1.00},
    "excessively_discontinuous": {"suppression_fraction": 0.70, "cycle_s": 22.0, "ibi_floor": 0.10, "amp_scale": 1.00},
    "trace_alternant":           {"suppression_fraction": 0.48, "cycle_s": 11.0, "ibi_floor": 0.42, "amp_scale": 1.00},
    "burst_suppression":         {"suppression_fraction": 0.75, "cycle_s": 10.0, "ibi_floor": 0.005, "amp_scale": 1.10},
    "suppressed":                {"suppression_fraction": 0.00, "cycle_s": 12.0, "ibi_floor": 1.00, "amp_scale": 0.06},
    "low_voltage":               {"suppression_fraction": 0.00, "cycle_s": 12.0, "ibi_floor": 1.00, "amp_scale": 0.28},
    # awake hypsarrhythmia is continuous; NREM fragmentation comes from the
    # synthesizer's sleep-driven suppression fraction, floor 0.30
    "hypsarrhythmia":            {"suppression_fraction": 0.00, "cycle_s": 9.0, "ibi_floor": 0.30, "amp_scale": 1.00},
}

#: Hypsarrhythmia defaults when the author gives none (Gibbs & Gibbs: random
#: high-voltage slow waves and spikes, >200 uV, varying in duration and
#: location, asynchronous; StatPearls NBK537251 and the Medscape/Wyllie
#: description "mountainous, chaotic, disorganized rhythms with superimposed
#: multifocal spikes").  amplitude_uv is the spec's background amplitude.
HYPSARRHYTHMIA_DEFAULTS = {"amplitude_uv": 260.0, "dominant_hz": 1.5, "slow_fraction": 0.95,
                           "multifocal_spikes": {"rate_per_s": 1.4, "amplitude_uv": 160.0}}

#: Maturation of neonatal discontinuity by postmenstrual age (weeks).  Columns:
#: mean interburst interval (s), log-normal spread of the IBI, mean burst
#: length (s), interburst floor as a fraction of burst amplitude, burst
#: amplitude (uV, the spec's ``amplitude_uv`` when the author gave none).
#:
#: Sources (EndNote record numbers): the longest ACCEPTABLE single IBI by
#: conceptional age is 46 s at 26 w, 36 s at 27 w, 27 s at 28 w, 20 s at
#: 31-33 w, 10 s at 34-36 w and 6 s at 37-40 w, with an average IBI of
#: 6-12 s below 30 w and a quiescent interburst under 25 uV (Laoprasert,
#: Atlas of Pediatric EEG, rec 2446, citing Hahn 1989 and Selton 2000).
#: Trace alternant (36-38 w, waning by 40-44 w): bursts 50-300 uV between
#: interburst activity of 25-50 uV - the distinction from trace discontinu
#: IS the interburst amplitude, >25 uV vs <25 uV (rec 2446).  At term, IBI
#: <=6 s is normal, >6 s excessively discontinuous, and normal awake voltage
#: is 25-50 uV peak-to-peak (Wusthoff 2017, rec 4156; Nash 2011, rec 4282).
#: With increasing PMA the aEEG minimum rises, the maximum falls, and both
#: the share of time in IBI and the longest IBI shorten (Vesoulis 2015,
#: rec 1251; Zhang 2011, rec 1320).
#:
#: The mean IBI, spread and burst length are chosen so that the log-normal
#: draw's ~99th percentile lands on the published maximum while the mean
#: stays in the published average; burst lengths are not tabulated in
#: these sources and are set so the cycle stays plausible.  This is a
#: measuring stick from the literature, not a fit to patient data.
PMA_TABLE: List[Tuple[float, float, float, float, float, float]] = [
    # pma,  ibi_s, ibi_sigma, burst_s, ibi_floor, amplitude_uv
    (26.0, 11.0, 0.60, 4.0, 0.06, 130.0),
    (28.0,  9.0, 0.50, 5.5, 0.08, 120.0),
    (30.0,  7.5, 0.45, 7.0, 0.10, 110.0),
    (32.0,  6.0, 0.40, 9.0, 0.14, 100.0),
    (34.0,  5.0, 0.32, 11.0, 0.20, 90.0),
    (36.0,  4.5, 0.28, 12.0, 0.28, 80.0),
    (38.0,  4.0, 0.25, 8.0, 0.40, 70.0),
    (40.0,  3.5, 0.22, 7.0, 0.48, 65.0),
    (42.0,  3.0, 0.20, 7.0, 0.62, 60.0),
    (44.0,  2.5, 0.20, 8.0, 0.85, 55.0),
]


#: Neonatal graphoelements by postmenstrual age: element -> (pma, rate per
#: minute, peak-to-peak amplitude uV) breakpoints, linearly interpolated and
#: zero outside the listed span.  Windows and amplitudes follow the atlas
#: (rec 2446, ch. 3): delta brushes 24-26 w to 44 w (handled by
#: ``delta_brushes``); monorhythmic occipital delta 0.3-1.5 Hz, 50-250 uV,
#: appears 23-24 w, peaks 31-33 w, fades by 35 w, runs of 2-60 s (long at
#: 28-31 w); temporal theta bursts 4-6 Hz, 1-2 s, 20-200 uV, 26 w to
#: ~32 w, peak 29-32 w, replaced by temporal alpha bursts AT 33 w (gone by
#: 34 w); sharp theta on the occipitals of prematures 5-6 Hz, most at
#: 22-25 w, none near term; frontal sharp transients (encoches frontales)
#: 50->150 uV biphasic, maximal 35-36 w, diminished after 44 w, absent by
#: 48 w; anterior slow dysrhythmia 1.5-2 Hz, 50-100 uV frontal delta in
#: transitional sleep; rhythmic midline central theta 5-9 Hz, 50-200 uV,
#: a variant.  Rates per minute are NOT tabulated in the source and are set
#: so a 30 s page at the element's peak age usually shows one; tune per
#: element through ``background.graphoelements``.
GRAPHOELEMENT_PMA: Dict[str, List[Tuple[float, float, float]]] = {
    "occipital_delta": [(23.0, 0.8, 100.0), (28.0, 2.5, 150.0), (32.0, 3.0, 170.0), (34.0, 1.5, 130.0), (35.5, 0.0, 0.0)],
    "temporal_theta":  [(25.5, 0.0, 0.0), (26.0, 1.0, 60.0), (29.0, 3.0, 90.0), (32.0, 2.5, 80.0), (32.8, 0.0, 0.0)],
    "temporal_alpha":  [(32.6, 0.0, 0.0), (33.0, 2.5, 60.0), (33.9, 2.0, 60.0), (34.2, 0.0, 0.0)],
    "stop":            [(22.0, 2.0, 35.0), (25.0, 1.8, 35.0), (28.0, 0.5, 30.0), (31.0, 0.0, 0.0)],
    "frontal_sharp":   [(33.0, 0.0, 0.0), (34.0, 0.6, 70.0), (35.5, 2.5, 110.0), (40.0, 1.8, 100.0), (44.0, 0.6, 60.0), (48.0, 0.0, 0.0)],
    "anterior_slow":   [(33.0, 0.0, 0.0), (35.0, 0.8, 70.0), (38.0, 1.2, 80.0), (42.0, 0.6, 60.0), (46.0, 0.0, 0.0)],
    "midline_theta":   [(28.0, 0.25, 70.0), (40.0, 0.25, 70.0), (44.0, 0.0, 0.0)],
}

#: Fraction of quiet-sleep bursts that are interhemispherically synchronous
#: (within 1.5 s): "paradoxical hypersynchrony" below 30 w, ~70% at 31-32 w,
#: ~80% at 33-34 w, 100% after 37 w (rec 2446).
SYNCHRONY_PMA: List[Tuple[float, float]] = [
    (26.0, 1.0), (30.0, 0.98), (31.0, 0.70), (32.5, 0.70), (33.0, 0.80), (34.5, 0.80), (37.0, 1.0),
]


def graphoelement_defaults(pma: float) -> Dict[str, Dict[str, float]]:
    """Rate and amplitude of every graphoelement at ``pma`` weeks (zero outside its span)."""
    import numpy as _np
    out: Dict[str, Dict[str, float]] = {}
    for name, pts in GRAPHOELEMENT_PMA.items():
        xs = [p[0] for p in pts]
        if pma < xs[0] or pma > xs[-1]:
            out[name] = {"rate_per_min": 0.0, "amplitude_uv": 0.0}
            continue
        out[name] = {"rate_per_min": float(_np.interp(pma, xs, [p[1] for p in pts])),
                     "amplitude_uv": float(_np.interp(pma, xs, [p[2] for p in pts]))}
    return out


def synchrony_default(pma: float) -> float:
    import numpy as _np
    return float(_np.interp(pma, [p[0] for p in SYNCHRONY_PMA], [p[1] for p in SYNCHRONY_PMA]))


def pma_defaults(pma: float) -> Dict[str, float]:
    """Interpolate PMA_TABLE at ``pma`` weeks (clamped to the table)."""
    import numpy as _np
    xs = [r[0] for r in PMA_TABLE]
    keys = ("ibi_s", "ibi_sigma", "burst_s", "ibi_floor", "amplitude_uv")
    return {k: float(_np.interp(pma, xs, [r[i + 1] for r in PMA_TABLE]))
            for i, k in enumerate(keys)}


DEFAULT_SEIZURE = {
    "duration_s": 90.0,
    "onset_region": "left_temporal",
    "spread": "none",
    "postictal_attenuation_s": 0.0,
    "evolution": {"start_hz": 4.0, "end_hz": 1.5,
                  "amplitude_start_uv": 60.0, "amplitude_end_uv": 150.0},
}


class SpecError(ValueError):
    """Raised for a spec that cannot be rendered."""


# --------------------------------------------------------------------------
# loading
# --------------------------------------------------------------------------

@dataclass
class LoadedQuestion:
    """A question (or a bare spec file) plus its image block."""

    path: Optional[Path]
    ident: str
    image: Dict[str, Any]
    point_to_feature: Optional[Dict[str, Any]] = None
    question: Dict[str, Any] = field(default_factory=dict)


def _read_yaml(path: Path) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    if not isinstance(data, dict):
        raise SpecError(f"{path}: expected a YAML mapping at the top level")
    return data


def load_question(path: str | Path) -> LoadedQuestion:
    """Accept a full question file, a bare ``image:`` block, or a bare spec.

    A bare spec file must carry ``kind`` (or be recognisable from its keys) so
    that ``preview`` works on hand-written scratch specs.
    """
    path = Path(path)
    data = _read_yaml(path)

    if "image" in data and isinstance(data["image"], dict):
        image = dict(data["image"])
        ident = str(data.get("id") or path.stem)
        ptf = data.get("point_to_feature")
        return LoadedQuestion(path, ident, image, ptf, data)

    if "kind" in data and "spec" in data:
        image = dict(data)
        ptf = image.pop("point_to_feature", None)
        ident = str(image.pop("id", None) or path.stem)
        image.setdefault("license", "synthetic-original")
        return LoadedQuestion(path, ident, image, ptf, {})

    if "kind" in data:  # kind + inline spec keys
        image = {"kind": data.pop("kind"), "license": data.pop("license", "synthetic-original"),
                 "attribution": data.pop("attribution", None)}
        ptf = data.pop("point_to_feature", None)
        ident = str(data.pop("id", None) or path.stem)
        image["spec"] = data
        return LoadedQuestion(path, ident, image, ptf, {})

    raise SpecError(
        f"{path}: could not find an image block. Provide `image: {{kind, license, spec}}` "
        "or a top-level `kind:` + `spec:`."
    )


# --------------------------------------------------------------------------
# validation + normalization
# --------------------------------------------------------------------------

def validate_image(image: Dict[str, Any]) -> List[str]:
    """Return a list of human-readable problems ([] means valid)."""
    problems: List[str] = []
    validator = jsonschema.Draft202012Validator(IMAGE_SCHEMA)
    for err in sorted(validator.iter_errors(image), key=lambda e: list(e.path)):
        loc = "image" + "".join(f"[{p!r}]" for p in err.path)
        problems.append(f"{loc}: {err.message}")
    if problems:
        return problems

    kind = image["kind"]
    spec_validator = jsonschema.Draft202012Validator(spec_schema_for(kind))
    for err in sorted(spec_validator.iter_errors(image["spec"]), key=lambda e: list(e.path)):
        loc = "image.spec" + "".join(f"[{p!r}]" for p in err.path)
        problems.append(f"{loc}: {err.message}")

    problems.extend(_semantic_checks(kind, image["spec"]))
    return problems


def _semantic_checks(kind: str, spec: Dict[str, Any]) -> List[str]:
    out: List[str] = []
    if kind == "composite":
        for sub in ("qeeg_panel", "eeg_page"):
            if sub in spec:
                out.extend(_semantic_checks(sub, spec[sub]))
        return out

    horizon_min = {
        "qeeg_panel": float(spec.get("duration_min", 240)),
        "eeg_page": float(spec.get("duration_min", 0)) or None,
        "aeeg": float(spec.get("duration_h", 6)) * 60.0,
    }.get(kind)

    for i, ev in enumerate(spec.get("events", []) or []):
        t = ev.get("onset_min", ev.get("at_min", ev.get("start_min")))
        if t is None and ev.get("type") not in ("temperature_change",):
            out.append(f"image.spec.events[{i}]: needs onset_min / at_min / start_min")
        if horizon_min and t is not None and t > horizon_min:
            out.append(
                f"image.spec.events[{i}]: t={t} min is past the {horizon_min:g} min recording"
            )
        if ev.get("type") == "seizure_cluster":
            for req in ("start_min", "end_min", "interval_min"):
                if req not in ev:
                    out.append(f"image.spec.events[{i}]: seizure_cluster needs {req}")
        if ev.get("type") == "artifact" and "kind" not in ev:
            out.append(f"image.spec.events[{i}]: artifact needs kind")
    return out


def _default_age(kind: str, spec: Dict[str, Any]) -> str:
    if "age_group" in spec:
        return str(spec["age_group"])
    return "neonate" if kind == "aeeg" else "child"


def normalize(image: Dict[str, Any]) -> Dict[str, Any]:
    """Fill every default so the renderer never has to guess.

    The *normalized* spec is what gets hashed, so the hash is stable against
    a writer spelling out a value the renderer would have defaulted to anyway.
    """
    problems = validate_image(image)
    if problems:
        raise SpecError("invalid image spec:\n  - " + "\n  - ".join(problems))

    kind = image["kind"]
    out = {
        "kind": kind,
        "license": image.get("license", "synthetic-original"),
        "attribution": image.get("attribution"),
        "spec": _normalize_spec(kind, dict(image["spec"])),
    }
    return out


def _normalize_spec(kind: str, spec: Dict[str, Any]) -> Dict[str, Any]:
    if kind == "composite":
        seed = int(spec["seed"])
        out: Dict[str, Any] = {
            "seed": seed,
            "layout": spec.get("layout", "panel_over_page"),
            "style": _normalize_style(kind, spec.get("style", {})),
        }
        parent_common = {k: spec[k] for k in COMPOSITE_INHERIT if k in spec}
        panel_raw = {**parent_common, **dict(spec.get("qeeg_panel") or {})}
        for sub in ("qeeg_panel", "eeg_page"):
            if sub not in spec:
                continue
            child = {**parent_common, **dict(spec[sub])}
            child.setdefault("seed", seed)
            if sub == "eeg_page" and panel_raw:
                # a composite page is a window *into* the panel's recording
                for k in COMPOSITE_INHERIT:
                    if k not in child and k in panel_raw:
                        child[k] = panel_raw[k]
            out[sub] = _normalize_spec(sub, child)
        if "qeeg_panel" not in out and "eeg_page" not in out:
            raise SpecError("composite spec needs at least one of qeeg_panel / eeg_page")
        return out

    s = dict(spec)
    s["seed"] = int(s["seed"])
    age = _default_age(kind, s)
    s["age_group"] = age
    s["sample_rate"] = int(s.get("sample_rate", 256))

    # ---- channel set -------------------------------------------------
    aeeg_derivations = None
    if kind == "aeeg":
        raw = s.get("channels", s.get("aeeg_channels"))
        if isinstance(raw, list):
            aeeg_derivations = list(raw)
            s.pop("channels", None)
        elif isinstance(raw, str):
            s["channels"] = raw
        if aeeg_derivations is None:
            aeeg_derivations = s.get("aeeg_channels") or ["C3-P3", "C4-P4"]
        s["aeeg_channels"] = aeeg_derivations
    default_channels = "neonatal_9" if age == "neonate" else "standard_19"
    s["channels"] = s.get("channels", default_channels)
    if kind == "aeeg" and any(
        electrode in ("P3", "P4", "F3", "F4", "T5", "T6")
        for pair in s["aeeg_channels"] for electrode in pair.split("-")
    ):
        s["channels"] = "standard_19"
    if s["channels"] == "neonatal_reduced":
        s["channels"] = "neonatal_9"

    s["montage"] = s.get(
        "montage", "neonatal_reduced" if s["channels"] == "neonatal_9" else "longitudinal_bipolar"
    )

    # ---- background --------------------------------------------------
    ad = AGE_DEFAULTS[age]
    bg = dict(s.get("background", {}) or {})
    if kind == "aeeg":
        pat = s.get("pattern", "CNV")
        bg.setdefault("type", _aeeg_pattern_background(pat))
        bg.setdefault("amplitude_uv", AEEG_PATTERN_AMPLITUDE_UV.get(pat, 75.0))
    bg.setdefault("type", ad["type"])
    if bg["type"] == "hypsarrhythmia":
        for k in ("dominant_hz", "amplitude_uv", "slow_fraction"):
            bg.setdefault(k, HYPSARRHYTHMIA_DEFAULTS[k])
        ms = dict(bg.get("multifocal_spikes") or {})
        for k, v in HYPSARRHYTHMIA_DEFAULTS["multifocal_spikes"].items():
            ms.setdefault(k, v)
        bg["multifocal_spikes"] = {k: float(v) for k, v in ms.items()}
    else:
        ms = bg.get("multifocal_spikes")
        bg["multifocal_spikes"] = ({"rate_per_s": float(ms.get("rate_per_s", 0.0)),
                                    "amplitude_uv": float(ms.get("amplitude_uv", 150.0))}
                                   if ms else None)
    bg.setdefault("dominant_hz", ad["dominant_hz"])
    bg.setdefault("amplitude_uv", ad["amplitude_uv"])
    bg.setdefault("slow_fraction", ad["slow_fraction"])
    bg.setdefault("reactivity", "present")
    bg.setdefault("delta_brushes", bool(ad["delta_brushes"]))
    bg.setdefault("baseline_ecg_uv", float(ad["baseline_ecg_uv"]))
    preset = BACKGROUND_PRESETS[bg["type"]]
    bs = dict(bg.get("burst_suppression", {}) or {})
    pma = bg.get("pma_weeks")
    if pma is not None and age == "neonate" and bg["type"] in (
            "discontinuous", "excessively_discontinuous", "trace_alternant"):
        row = pma_defaults(float(pma))
        bs.setdefault("burst_s", row["burst_s"])
        bs.setdefault("ibi_s", row["ibi_s"])
        bs.setdefault("ibi_sigma", row["ibi_sigma"])
        bs.setdefault("ibi_floor", row["ibi_floor"])
        # AGE_DEFAULTS set amplitude_uv above; a PMA that was given overrides
        # that default (not an explicit author value) with the maturational one.
        if "amplitude_uv" not in (s.get("background") or {}):
            bg["amplitude_uv"] = row["amplitude_uv"]
    if bg["type"] == "burst_suppression":
        bs.setdefault("burst_s", 2.0)
        bs.setdefault("ibi_s", 8.0)
    else:
        cyc = preset["cycle_s"]
        bs.setdefault("burst_s", cyc * (1.0 - preset["suppression_fraction"]))
        bs.setdefault("ibi_s", cyc * preset["suppression_fraction"])
    bs.setdefault("ibi_floor", preset["ibi_floor"])
    bg["burst_suppression"] = {k: float(v) for k, v in bs.items()}
    # Neonatal graphoelements: defaults from the PMA table (all zero without a
    # PMA), each element's rate and amplitude overridable by the author.
    ge_in = dict(bg.get("graphoelements", {}) or {})
    ge = graphoelement_defaults(float(pma)) if (pma is not None and age == "neonate") else {
        name: {"rate_per_min": 0.0, "amplitude_uv": 0.0} for name in GRAPHOELEMENT_PMA}
    for name, row in ge_in.items():
        row = dict(row or {})
        if row.get("enabled") is False:
            ge[name] = {"rate_per_min": 0.0, "amplitude_uv": 0.0}
            continue
        ge.setdefault(name, {"rate_per_min": 0.0, "amplitude_uv": 0.0})
        for k in ("rate_per_min", "amplitude_uv"):
            if k in row and row[k] is not None:
                ge[name][k] = float(row[k])
    bg["graphoelements"] = ge
    if bg.get("synchrony") is None:
        bg["synchrony"] = synchrony_default(float(pma)) if (pma is not None and age == "neonate") else 1.0
    bg["synchrony"] = float(bg["synchrony"])
    if bg.get("asymmetry"):
        asym = dict(bg["asymmetry"])
        asym.setdefault("attenuation_pct", 40.0)
        asym.setdefault("slowing_hz", 0.0)
        bg["asymmetry"] = asym
    else:
        bg["asymmetry"] = None
    s["background"] = bg

    # ---- events ------------------------------------------------------
    s["events"] = [_normalize_event(e) for e in (s.get("events") or [])]
    s["annotations"] = [
        {"at_min": float(a["at_min"]), "label": str(a["label"])}
        for a in (s.get("annotations") or [])
    ]

    # ---- kind specifics ----------------------------------------------
    if kind == "qeeg_panel":
        s["duration_min"] = float(s.get("duration_min", 240.0))
        s["panels"] = list(s.get("panels") or DEFAULT_PANELS)
        s["hemisphere_channels"] = s.get("hemisphere_channels", "default")
        s["time_axis"] = s.get("time_axis", "elapsed")
        s["show_cursor_at_min"] = s.get("show_cursor_at_min")
    elif kind == "eeg_page":
        s["at_min"] = float(s.get("at_min", 0.0))
        s["window_s"] = float(s.get("window_s", 15.0))
        s["sensitivity_uv_mm"] = float(s.get("sensitivity_uv_mm", 7.0))
        f = dict(s.get("filters", {}) or {})
        f.setdefault("lf_hz", 1.0)
        f.setdefault("hf_hz", 70.0)
        f.setdefault("notch_hz", 60.0)
        s["filters"] = f
        s["highlight"] = None
        s.pop("duration_min", None)
    elif kind == "aeeg":
        s["duration_h"] = float(s.get("duration_h", 6.0))
        s["time_axis"] = s.get("time_axis", "elapsed")
        s["pattern"] = s.get("pattern", "CNV")
        s["sleep_wake_cycling"] = s.get("sleep_wake_cycling", "immature")
        s["seizures"] = [
            {
                "onset_h": float(z["onset_h"]),
                "duration_min": float(z.get("duration_min", 4.0)),
                **({"onset_region": z["onset_region"]} if z.get("onset_region") else {}),
                **({"evolution": dict(z["evolution"])} if z.get("evolution") else {}),
            }
            for z in (s.get("seizures") or [])
        ]
        s["raw_strip_at_h"] = s.get("raw_strip_at_h")
        s["raw_strip_window_s"] = float(s.get("raw_strip_window_s", 15.0))
        s["start_h"] = float(s.get("start_h", 0.0))

    if "source" in s and s["source"]:
        src = dict(s["source"])
        src.setdefault("start_s", 0.0)
        src.setdefault("duration_s", 60.0)
        s["source"] = src
    else:
        s.pop("source", None)

    s["style"] = _normalize_style(kind, s.get("style", {}))
    return s


#: background peak-to-peak amplitude implied by each aEEG pattern class, chosen
#: so the rendered margins land in the published bands (CNV lower 7-10 / upper
#: 25-50 uV; DNV lower <5; CLV continuous <5; FT essentially flat).
#: (fitted by measuring the rendered margins, not guessed)
AEEG_PATTERN_AMPLITUDE_UV: Dict[str, float] = {
    "CNV": 48.0,    # -> lower ~9, upper ~26 uV
    "DNV": 80.0,    # -> lower ~4, upper ~40 uV
    "BS": 115.0,    # -> lower ~1, upper ~47 uV
    "CLV": 45.0,    # -> lower ~2.5, upper ~7 uV (continuous, all under 10)
    "FT": 30.0,     # -> under 2 uV throughout
}


def _aeeg_pattern_background(pattern: str) -> str:
    return {
        "CNV": "continuous",
        "DNV": "discontinuous",
        "BS": "burst_suppression",
        "CLV": "low_voltage",
        "FT": "suppressed",
    }.get(pattern, "continuous")


DEFAULT_SIZES = {
    "qeeg_panel": (1600, 1000),
    "eeg_page": (1600, 900),
    "aeeg": (1600, 900),
    "composite": (1600, 1400),
}


def _normalize_style(kind: str, style: Dict[str, Any]) -> Dict[str, Any]:
    """Fill renderer defaults but keep every key the writer supplied.

    Unrecognized keys survive normalization (so they are hashed and visible in
    the sidecar) and are reported by :func:`style_warnings`; they never fail a
    render, because one new editorial key must not block a batch.
    """
    w, h = DEFAULT_SIZES.get(kind, (1600, 1000))
    st = dict(style or {})
    st.setdefault("theme", "dark")
    st.setdefault("width", w)
    st.setdefault("height", h)
    st.setdefault("spectrogram_cmap", "pedquest_power")
    st.setdefault("asymmetry_cmap", "asym_dark")
    st.setdefault("title", None)
    st.setdefault("start_clock", "21:40")
    st.setdefault("dpi", 100)
    # aliases the question writers used interchangeably
    if "amplitude_axis" in st and "aeeg_axis" not in st:
        st["aeeg_axis"] = st["amplitude_axis"]
    if "amplitude_gridlines_uv" in st and "aeeg_gridlines_uv" not in st:
        st["aeeg_gridlines_uv"] = st["amplitude_gridlines_uv"]
    if st.get("asymmetry_colorbar") == "blue_left_red_right":
        st.setdefault("asymmetry_cmap", "asym_dark")
    return st


def style_warnings(image: Dict[str, Any]) -> List[str]:
    """``style`` keys the renderer carries but does not draw."""
    out: List[str] = []
    for path, st in _iter_styles(image.get("spec") or {}, image.get("kind", "")):
        for k in sorted(st):
            if k not in HONOURED_STYLE_KEYS:
                out.append(f"{path}.{k}: recognised, carried in the spec hash, not rendered")
    return out


def _iter_styles(spec: Dict[str, Any], kind: str):
    if isinstance(spec.get("style"), dict):
        yield ("image.spec.style", spec["style"])
    for sub in ("qeeg_panel", "eeg_page", "aeeg"):
        if isinstance(spec.get(sub), dict):
            yield from _iter_styles(spec[sub], sub)


#: keys inherited by a composite's ``eeg_page`` from its ``qeeg_panel`` so the
#: page shows the *same* synthesized recording the trends were computed from.
COMPOSITE_INHERIT = (
    "age_group", "sample_rate", "channels", "background", "events",
    "annotations", "montage", "source",
)


def _normalize_event(ev: Dict[str, Any]) -> Dict[str, Any]:
    e = dict(ev)
    kind = e["type"]
    if kind in ("seizure", "seizure_cluster", "status_epilepticus"):
        e.setdefault("muscle", "modest")
    if kind == "seizure":
        e.setdefault("onset_min", 0.0)
        for k, v in DEFAULT_SEIZURE.items():
            if k == "evolution":
                evo = dict(v)
                evo.update(e.get("evolution", {}) or {})
                e["evolution"] = evo
            else:
                e.setdefault(k, v)
    elif kind in ("spasm", "spasm_cluster"):
        # Epileptic spasm (Kellaway 1979; Fusco & Vigevano 1993): a generalized
        # high-voltage slow-wave transient, vertex/frontocentral maximum,
        # 0.5-1 s, with a brief symmetric EMG burst, followed by a diffuse
        # electrodecrement of one to several seconds that may carry
        # low-voltage fast activity.  Spasms cluster every 5-30 s, tens per
        # cluster, typically on waking.
        e.setdefault("onset_min", 0.0)
        e.setdefault("duration_s", 0.8)
        e.setdefault("onset_region", "generalized")
        e.setdefault("spread", "none")
        e.setdefault("decrement_s", 2.5)
        e.setdefault("decrement_depth", 0.80)
        e.setdefault("fast_uv", 14.0)
        # modest: the brief phasic EMG must not bury the slow wave it rides on
        e.setdefault("muscle", "modest")
        e.setdefault("postictal_attenuation_s", 0.0)
        e.setdefault("morphology", "spasm")
        evo = {"start_hz": 1.0, "end_hz": 1.0, "amplitude_start_uv": 320.0, "amplitude_end_uv": 320.0}
        evo.update(e.get("evolution", {}) or {})
        e["evolution"] = evo
        if kind == "spasm_cluster":
            e.setdefault("interval_s", 12.0)
            e.setdefault("count", 12)
    elif kind == "tonic_seizure":
        # Tonic seizure: diffuse electrodecrement, then generalized paroxysmal
        # fast activity (15-25 Hz) building in amplitude with tonic EMG; brief
        # postictal slowing.
        e.setdefault("onset_min", 0.0)
        e.setdefault("duration_s", 12.0)
        e.setdefault("onset_region", "generalized")
        e.setdefault("spread", "generalized")
        e.setdefault("decrement_s", 1.5)
        e.setdefault("decrement_depth", 0.70)
        e.setdefault("muscle", "clinical")
        e.setdefault("postictal_attenuation_s", 20.0)
        e.setdefault("morphology", "ictal")
        evo = {"start_hz": 22.0, "end_hz": 15.0, "amplitude_start_uv": 15.0, "amplitude_end_uv": 110.0}
        evo.update(e.get("evolution", {}) or {})
        e["evolution"] = evo
    elif kind == "seizure_cluster":
        z = dict(e.get("seizure", {}) or {})
        for k, v in DEFAULT_SEIZURE.items():
            if k == "evolution":
                evo = dict(v)
                evo.update(z.get("evolution", {}) or {})
                z["evolution"] = evo
            else:
                z.setdefault(k, v)
        e["seizure"] = z
        e.setdefault("interval_min", 12.0)
    elif kind == "status_epilepticus":
        e.setdefault("onset_min", 0.0)
        e.setdefault("duration_min", 30.0)
        e.setdefault("onset_region", "generalized")
        evo = {"start_hz": 2.5, "end_hz": 1.6,
               "amplitude_start_uv": 120.0, "amplitude_end_uv": 90.0}
        evo.update(e.get("evolution", {}) or {})
        e["evolution"] = evo
        e.setdefault("spread", "generalized")
    elif kind == "sedation_change":
        e.setdefault("at_min", 0.0)
        e.setdefault("direction", "increase")
        e.setdefault("agent", "midazolam")
        inc = e["direction"] == "increase"
        # a *decrease* with no explicit target means "back toward no burden";
        # defaulting it to the increase target would add suppression on a wean.
        eff = {"suppression_ratio_target_pct": 25.0 if inc else 0.0,
               "beta_boost": inc, "ramp_min": 10.0}
        eff.update(e.get("effect", {}) or {})
        e["effect"] = eff
    elif kind == "attenuation_transient":
        e.setdefault("at_min", 0.0)
        e.setdefault("duration_min", 5.0)
        e.setdefault("side", "both")
        e.setdefault("depth_pct", 70.0)
        e.setdefault("ramp_min", 0.0)
        e.setdefault("delta_depth_pct", e["depth_pct"])
    elif kind == "temperature_change":
        e.setdefault("at_min", 0.0)
        e.setdefault("from_c", 36.5)
        e.setdefault("to_c", 36.5)
        e.setdefault("over_min", 60.0)
    elif kind == "stimulation":
        e.setdefault("at_min", 0.0)
    elif kind == "artifact":
        e.setdefault("at_min", 0.0)
        e.setdefault("duration_s", 60.0)
        e.setdefault("intensity", "medium")
        if "channels" not in e and "side" not in e:
            e["side"] = "all"
    elif kind == "state_change":
        e.setdefault("at_min", 0.0)
        e.setdefault("to", "sleep")
    elif kind == "rhythmic_pattern":
        # An ACNS rhythmic / periodic pattern.  Explicitly NOT a seizure: no
        # frequency or amplitude evolution, no post-event attenuation, and a
        # modest amplitude, so the aEEG margins and the heuristic seizure
        # probability should stay flat through it.  That contrast is the whole
        # teaching point of the items that use it.
        e.setdefault("onset_min", 0.0)
        e.setdefault("duration_min", 30.0)
        e.setdefault("pattern", "LRDA")
        e.setdefault("frequency_hz", 1.5)
        e.setdefault("run_duration_s", 60.0)
        e.setdefault("amplitude_uv", 60.0)
        e.setdefault("modifier", None)
        e.setdefault("plus_modifier", None)
        if e.get("evolution") in ("none", None):
            e["evolution"] = "none"
        pat = str(e["pattern"]).upper()
        e.setdefault("periodic", pat.startswith(("LPD", "GPD", "BIPD")) or "PD" in pat)
        if "onset_region" not in e:
            side = e.get("side")
            if side in ("left", "right"):
                e["onset_region"] = f"{side}_hemisphere"
            elif side in ("bilateral", "both"):
                e["onset_region"] = "generalized"
            else:
                e["onset_region"] = "generalized" if pat.startswith("G") else "left_hemisphere"
        e.setdefault("side", {"left_hemisphere": "left", "right_hemisphere": "right"}
                     .get(e["onset_region"], "both"))
    return e


# --------------------------------------------------------------------------
# hashing
# --------------------------------------------------------------------------

def canonical_json(obj: Any) -> str:
    """Stable JSON: sorted keys, no whitespace, floats normalized."""
    return json.dumps(_canon(obj), sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _canon(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {str(k): _canon(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_canon(v) for v in obj]
    if isinstance(obj, bool) or obj is None:
        return obj
    if isinstance(obj, float):
        if obj == int(obj) and abs(obj) < 1e15:
            return int(obj)
        return round(obj, 9)
    return obj


def spec_hash(normalized_image: Dict[str, Any]) -> str:
    payload = canonical_json(
        {"renderer": RENDERER_VERSION, "image": normalized_image}
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(payload).hexdigest()
