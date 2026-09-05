"""Load / validate / normalize an ``image`` block and hash it canonically."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

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
}

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
    bg.setdefault("dominant_hz", ad["dominant_hz"])
    bg.setdefault("amplitude_uv", ad["amplitude_uv"])
    bg.setdefault("slow_fraction", ad["slow_fraction"])
    bg.setdefault("reactivity", "present")
    bg.setdefault("delta_brushes", bool(ad["delta_brushes"]))
    bg.setdefault("baseline_ecg_uv", float(ad["baseline_ecg_uv"]))
    preset = BACKGROUND_PRESETS[bg["type"]]
    bs = dict(bg.get("burst_suppression", {}) or {})
    if bg["type"] == "burst_suppression":
        bs.setdefault("burst_s", 2.0)
        bs.setdefault("ibi_s", 8.0)
    else:
        cyc = preset["cycle_s"]
        bs.setdefault("burst_s", cyc * (1.0 - preset["suppression_fraction"]))
        bs.setdefault("ibi_s", cyc * preset["suppression_fraction"])
    bs.setdefault("ibi_floor", preset["ibi_floor"])
    bg["burst_suppression"] = {k: float(v) for k, v in bs.items()}
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
    if kind == "seizure":
        e.setdefault("onset_min", 0.0)
        for k, v in DEFAULT_SEIZURE.items():
            if k == "evolution":
                evo = dict(v)
                evo.update(e.get("evolution", {}) or {})
                e["evolution"] = evo
            else:
                e.setdefault(k, v)
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
