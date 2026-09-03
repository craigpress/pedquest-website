"""JSON Schema for the ``image.spec`` DSL of content/qbank/IMAGE_SPEC.md.

The question-level schema (content/qbank/schema/question.schema.json) only
requires ``spec.seed``; this schema is the renderer's stricter reading of the
same document and is what ``eeg-render validate`` checks.
"""

from __future__ import annotations

from typing import Any, Dict

AGE_GROUPS = ["neonate", "infant", "child", "adolescent"]
BACKGROUND_TYPES = [
    "continuous", "discontinuous", "burst_suppression", "suppressed",
    "low_voltage", "excessively_discontinuous", "trace_alternant",
]
REGIONS = [
    "left_temporal", "right_temporal", "left_frontal", "right_frontal",
    "left_central", "right_central", "left_occipital", "right_occipital",
    "left_hemisphere", "right_hemisphere", "generalized", "midline",
]
SPREAD = ["none", "hemispheric", "generalized", "contralateral"]
ARTIFACTS = [
    "emg_chewing", "patting", "chest_pt", "ventilator", "ecmo_pump",
    "electrode_pop", "sixty_hz", "ecg", "movement", "sweat", "eye_blink",
]
AGENTS = ["propofol", "midazolam", "pentobarbital", "dexmedetomidine", "ketamine"]
#: panel names from IMAGE_SPEC.md ...
PANELS = [
    "seizure_probability", "rhythmicity_L", "rhythmicity_R", "fft_L", "fft_R",
    "asymmetry_relative", "asymmetry_index", "aeeg_L", "aeeg_R",
    "suppression_ratio_L", "suppression_ratio_R",
]
#: ... plus the additional Persyst/Benedetti-2023 trends the question bank uses.
EXTRA_PANELS = [
    "envelope_L", "envelope_R",
    "total_power_L", "total_power_R",
    "alpha_delta_ratio_L", "alpha_delta_ratio_R",
]
ALL_PANELS = PANELS + EXTRA_PANELS

RPP_PATTERNS = [
    "LRDA", "GRDA", "BIRDA", "LPD", "GPD", "BIPD", "LPDs", "GPDs", "SIRPIDs",
    "BIRDs", "triphasic",
]
AEEG_PATTERNS = ["CNV", "DNV", "BS", "CLV", "FT"]
MONTAGES = ["longitudinal_bipolar", "referential", "average", "neonatal_reduced"]
DATASETS = ["chb-mit", "helsinki-neonatal", "physionet-neonatal-eeg"]

_num = {"type": "number"}
_pos = {"type": "number", "exclusiveMinimum": 0}

_EVOLUTION = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "start_hz": {"type": "number", "minimum": 0.2, "maximum": 30},
        "end_hz": {"type": "number", "minimum": 0.2, "maximum": 30},
        "amplitude_start_uv": _pos,
        "amplitude_end_uv": _pos,
    },
}

#: ``rhythmic_pattern`` writes ``evolution: none`` as a *string* - an ACNS
#: pattern is defined partly by the absence of evolution - so both shapes pass.
_EVOLUTION_OR_NONE = {"oneOf": [_EVOLUTION, {"enum": ["none", None]}]}

_SEIZURE_CORE = {
    "duration_s": _pos,
    "onset_region": {"enum": REGIONS},
    "evolution": _EVOLUTION_OR_NONE,
    "spread": {"enum": SPREAD},
    "postictal_attenuation_s": {"type": "number", "minimum": 0},
}

_EVENT = {
    "type": "object",
    "required": ["type"],
    "properties": {
        "type": {
            "enum": [
                "seizure", "seizure_cluster", "status_epilepticus",
                "sedation_change", "attenuation_transient", "temperature_change",
                "stimulation", "artifact", "state_change", "rhythmic_pattern",
            ]
        },
        "label": {"type": "string"},
        # rhythmic_pattern (ACNS rhythmic / periodic pattern - NOT a seizure)
        "pattern": {"type": "string"},
        "frequency_hz": {"type": "number", "minimum": 0.2, "maximum": 6.0},
        "amplitude_uv": _pos,
        "run_duration_s": _pos,
        "modifier": {"type": ["string", "null"]},
        "plus_modifier": {"type": ["string", "null"]},
        "periodic": {"type": "boolean"},
        "sharpness": {"type": "string"},
        # seizure
        "onset_min": _num,
        **_SEIZURE_CORE,
        # cluster
        "start_min": _num,
        "end_min": _num,
        "interval_min": _pos,
        "seizure": {
            "type": "object",
            "additionalProperties": False,
            "properties": dict(_SEIZURE_CORE),
        },
        # status
        "duration_min": _pos,
        # sedation
        "at_min": _num,
        "direction": {"enum": ["increase", "decrease"]},
        "agent": {"enum": AGENTS},
        "effect": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "suppression_ratio_target_pct": {"type": "number", "minimum": 0, "maximum": 100},
                "beta_boost": {"type": "boolean"},
                "ramp_min": {"type": "number", "minimum": 0},
                "amplitude_pct": {"type": "number", "minimum": 0, "maximum": 400},
            },
        },
        # attenuation transient
        "side": {"enum": ["both", "left", "right", "all"]},
        "depth_pct": {"type": "number", "minimum": 0, "maximum": 100},
        # temperature
        "from_c": _num,
        "to_c": _num,
        "over_min": {"type": "number", "minimum": 0},
        # artifact
        "kind": {"enum": ARTIFACTS},
        "duration_s": _pos,
        "channels": {"type": "array", "items": {"type": "string"}},
        "intensity": {"enum": ["low", "medium", "high"]},
        # state change
        "to": {"enum": ["sleep", "wake", "arousal"]},
    },
    "additionalProperties": False,
}

_ANNOTATION = {
    "type": "object",
    "required": ["at_min", "label"],
    "additionalProperties": False,
    "properties": {"at_min": _num, "label": {"type": "string", "maxLength": 60}},
}

_BACKGROUND = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "type": {"enum": BACKGROUND_TYPES},
        "dominant_hz": {"type": "number", "minimum": 0.3, "maximum": 20},
        "amplitude_uv": _pos,
        "slow_fraction": {"type": "number", "minimum": 0, "maximum": 1},
        "reactivity": {"enum": ["present", "absent"]},
        "delta_brushes": {"type": "boolean"},
        "baseline_ecg_uv": {"type": "number", "minimum": 0, "maximum": 30},
        "asymmetry": {
            "type": "object",
            "required": ["side"],
            "additionalProperties": False,
            "properties": {
                "side": {"enum": ["left", "right"]},
                "attenuation_pct": {"type": "number", "minimum": 0, "maximum": 100},
                "slowing_hz": {"type": "number", "minimum": 0, "maximum": 10},
            },
        },
        "burst_suppression": {
            "type": "object",
            "additionalProperties": False,
            "properties": {"burst_s": _pos, "ibi_s": _pos, "ibi_floor": {"type": "number", "minimum": 0, "maximum": 1}},
        },
    },
}

_RANGE = {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}

#: ``style`` is deliberately open: question writers use it to pin axis ranges,
#: thresholds and colour bars that the item's correct answer depends on, and
#: new keys appear faster than the renderer grows.  Unknown keys are reported
#: as warnings by ``eeg-render validate`` and ignored at render time - never a
#: hard failure, so one new key cannot block a whole batch render.
_STYLE = {
    "type": "object",
    "additionalProperties": True,
    "properties": {
        "theme": {"enum": ["dark", "light"]},
        "width": {"type": "integer", "minimum": 600, "maximum": 4000},
        "height": {"type": "integer", "minimum": 400, "maximum": 4000},
        "spectrogram_cmap": {"type": "string"},
        "asymmetry_cmap": {"type": "string"},
        "title": {"type": ["string", "null"]},
        "start_clock": {"type": "string", "pattern": r"^\d{1,2}:\d{2}$"},
        "dpi": {"type": "integer", "minimum": 50, "maximum": 300},
        # honoured overrides
        "time_axis": {"enum": ["clock", "elapsed"]},
        "panel_labels": {"enum": ["hidden", "shown"]},
        "spectrogram_hz_range": _RANGE,
        "spectrogram_ticks_hz": {"type": "array", "items": {"type": "number"}},
        "rhythmicity_hz_range": _RANGE,
        "asymmetry_spectrogram_hz_range": _RANGE,
        "asymmetry_index_axis_pct": _RANGE,
        "asymmetry_index_zero_line": {"type": "boolean"},
        "asymmetry_colorbar": {"type": "string"},
        "colorbar": {"type": "string"},
        "show_colorbar": {"type": "boolean"},
        "suppression_threshold_uv": {"type": "number", "minimum": 1, "maximum": 50},
        "suppression_ratio_axis_pct": _RANGE,
        "suppression_ratio_target_band_pct": _RANGE,
        "aeeg_axis": {"enum": ["semilog", "linear"]},
        "amplitude_axis": {"enum": ["semilog", "linear"]},
        "aeeg_gridlines_uv": {"type": "array", "items": {"type": "number"}},
        "amplitude_gridlines_uv": {"type": "array", "items": {"type": "number"}},
        "envelope_axis_uv": _RANGE,
        "envelope_statistic": {"enum": ["median", "mean", "p90"]},
        "total_power_axis": {"enum": ["log", "linear"]},
        "alpha_delta_ratio_axis": _RANGE,
        "show_trend_strip": {"type": "boolean"},
        "trend_strip_panels": {"type": "array", "items": {"type": "string"}},
        "trend_strip_duration_min": {"type": "number", "minimum": 5},
        "show_ecg_channel": {"type": "boolean"},
        "chain_order": {"type": "string"},
        "single_channel": {"type": "string"},
        "seizure_onset_region_by_index": {"type": "array", "items": {"enum": REGIONS}},
        "show_detector_event_strip": {"type": "boolean"},
        "detector_marks_at_min": {"type": "array", "items": {"type": "number"}},
    },
}

#: keys the renderer actively uses; everything else in ``style`` is carried
#: through, hashed, and reported by ``validate`` as "recognised, not rendered".
HONOURED_STYLE_KEYS = set(_STYLE["properties"])

_SOURCE = {
    "type": "object",
    "required": ["dataset", "record"],
    "additionalProperties": False,
    "properties": {
        "dataset": {"enum": DATASETS},
        "record": {"type": "string"},
        "start_s": {"type": "number", "minimum": 0},
        "duration_s": _pos,
        "license": {"type": "string"},
        "attribution": {"type": "string"},
    },
}

_COMMON = {
    "seed": {"type": "integer"},
    "age_group": {"enum": AGE_GROUPS},
    "sample_rate": {"type": "integer", "minimum": 100, "maximum": 1024},
    "channels": {"enum": list({"standard_19", "neonatal_9", "neonatal_reduced"})},
    "montage": {"enum": MONTAGES},
    "background": _BACKGROUND,
    "events": {"type": "array", "items": _EVENT},
    "annotations": {"type": "array", "items": _ANNOTATION},
    "style": _STYLE,
    "source": _SOURCE,
}

_QEEG_PANEL_SPEC = {
    "type": "object",
    "required": ["seed"],
    "additionalProperties": False,
    "properties": {
        **_COMMON,
        "duration_min": {"type": "number", "minimum": 30, "maximum": 2880},
        "panels": {"type": "array", "items": {"enum": ALL_PANELS}, "minItems": 1},
        "hemisphere_channels": {
            "oneOf": [
                {"const": "default"},
                {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "left": {"type": "array", "items": {"type": "string"}},
                        "right": {"type": "array", "items": {"type": "string"}},
                    },
                },
            ]
        },
        "time_axis": {"enum": ["clock", "elapsed"]},
        "show_cursor_at_min": {"type": ["number", "null"]},
    },
}

_EEG_PAGE_SPEC = {
    "type": "object",
    "required": ["seed"],
    "additionalProperties": False,
    "properties": {
        **_COMMON,
        "at_min": {"type": "number", "minimum": 0},
        "window_s": {"type": "number", "minimum": 5, "maximum": 30},
        "sensitivity_uv_mm": {"type": "number", "minimum": 1, "maximum": 100},
        "filters": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "lf_hz": {"type": ["number", "null"], "minimum": 0},
                "hf_hz": {"type": ["number", "null"], "minimum": 1},
                "notch_hz": {"type": ["number", "null"]},
            },
        },
        "highlight": {"type": "null"},
        "duration_min": {"type": "number", "minimum": 0},
    },
}

_AEEG_SPEC = {
    "type": "object",
    "required": ["seed"],
    "additionalProperties": False,
    "properties": {
        **_COMMON,
        "duration_h": {"type": "number", "minimum": 1, "maximum": 24},
        "aeeg_channels": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 4},
        "pattern": {"enum": AEEG_PATTERNS},
        "sleep_wake_cycling": {"enum": ["mature", "immature", "absent"]},
        "seizures": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["onset_h"],
                "additionalProperties": False,
                "properties": {
                    "onset_h": {"type": "number", "minimum": 0},
                    "duration_min": _pos,
                    "onset_region": {"enum": REGIONS},
                },
            },
        },
        "raw_strip_at_h": {"type": ["number", "null"], "minimum": 0},
        "time_axis": {"enum": ["clock", "elapsed"]},
    },
}

# ``channels`` in the aeeg block of IMAGE_SPEC.md is a derivation list, not an
# electrode-set name, so the aeeg schema accepts either shape for that key.
_AEEG_SPEC["properties"]["channels"] = {
    "oneOf": [
        {"enum": ["standard_19", "neonatal_9", "neonatal_reduced"]},
        {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 4},
    ]
}

def _COMPOSITE_CHILD(schema: Dict[str, Any]) -> Dict[str, Any]:
    """A composite's children inherit ``seed`` (and the recording) from the
    parent, so they must not be required to repeat it."""
    child = dict(schema)
    child["required"] = []
    return child


_COMPOSITE_SPEC = {
    "type": "object",
    "required": ["seed"],
    "additionalProperties": False,
    "properties": {
        **_COMMON,
        "layout": {"enum": ["panel_over_page", "side_by_side"]},
        "qeeg_panel": _COMPOSITE_CHILD(_QEEG_PANEL_SPEC),
        "eeg_page": _COMPOSITE_CHILD(_EEG_PAGE_SPEC),
        "style": _STYLE,
    },
}

SPEC_SCHEMAS: Dict[str, Dict[str, Any]] = {
    "qeeg_panel": _QEEG_PANEL_SPEC,
    "eeg_page": _EEG_PAGE_SPEC,
    "aeeg": _AEEG_SPEC,
    "composite": _COMPOSITE_SPEC,
}

IMAGE_SCHEMA: Dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "PedQuEST image block (renderer view)",
    "type": "object",
    "required": ["kind", "license", "spec"],
    "properties": {
        "kind": {"enum": list(SPEC_SCHEMAS)},
        "license": {
            "enum": [
                "synthetic-original", "dataset-derived", "consortium",
                "cc0", "cc-by", "cc-by-sa", "public-domain",
            ]
        },
        "attribution": {"type": ["string", "null"]},
        "spec": {"type": "object"},
        "rendered": {"type": "object"},
    },
    "allOf": [
        {
            "if": {"properties": {"license": {"const": "dataset-derived"}}, "required": ["license"]},
            "then": {"properties": {"attribution": {"type": "string", "minLength": 4}},
                     "required": ["attribution"]},
        }
    ],
}


def spec_schema_for(kind: str) -> Dict[str, Any]:
    try:
        return SPEC_SCHEMAS[kind]
    except KeyError as exc:
        raise ValueError(f"unknown image kind {kind!r}") from exc
