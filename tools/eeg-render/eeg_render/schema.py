"""JSON Schema for the ``image.spec`` DSL of content/qbank/IMAGE_SPEC.md.

The question-level schema (content/qbank/schema/question.schema.json) only
requires ``spec.seed``; this schema is the renderer's stricter reading of the
same document and is what ``eeg-render validate`` checks.
"""

from __future__ import annotations

from typing import Any, Dict

AGE_GROUPS = ["neonate", "infant", "child", "adolescent", "adult"]
BACKGROUND_TYPES = [
    "continuous", "discontinuous", "burst_suppression", "suppressed",
    "low_voltage", "excessively_discontinuous", "trace_alternant",
    # infantile epileptic spasms syndrome: very high voltage, chaotic,
    # asynchronous slow with multifocal spikes; fragments in NREM sleep
    "hypsarrhythmia",
]
MUSCLE_LEVELS = ["none", "modest", "clinical"]
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
AGENTS = ["propofol", "midazolam", "pentobarbital", "dexmedetomidine", "ketamine", "remifentanil"]
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
    # Four-region spectrograms (left/right x lateral/parasagittal), the split
    # the published atlas displays. A hemisphere-pooled panel averages a
    # temporal focus with the parasagittal chain that cannot see it.
    "fft_LL", "fft_LP", "fft_RP", "fft_RL",
    # Paired trends: both sides on ONE plot, left blue and right red. Two
    # stacked single-side panels cost twice the height and still make the
    # reader compare across a gap, which is the whole point of these trends.
    "alpha_delta_ratio", "theta_delta_ratio",
    "alpha_delta_ratio_lateral", "alpha_delta_ratio_parasagittal",
    "theta_delta_ratio_lateral", "theta_delta_ratio_parasagittal",
    "theta_delta_ratio_L", "theta_delta_ratio_R",
    "suppression_ratio", "suppression_ratio_global",
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
        # sweep: one log-frequency glide (0.3.x); recruit (0.4.0): low-voltage fast
        # onset, stepwise slowing with amplitude build-up, late clonic bursting
        "profile": {"enum": ["sweep", "recruit"]},
    },
}

#: ``rhythmic_pattern`` writes ``evolution: none`` as a *string* - an ACNS
#: pattern is defined partly by the absence of evolution - so both shapes pass.
_EVOLUTION_OR_NONE = {"oneOf": [_EVOLUTION, {"enum": ["none", None]}]}

_SEIZURE_CORE = {
    "duration_s": _pos,
    # seizure_cluster only: the length of the LAST run in the cluster. Each
    # run is interpolated between duration_s and this, so a cluster can
    # escalate (or shorten after treatment) instead of repeating one length.
    "duration_end_s": _pos,
    "onset_region": {"enum": REGIONS},
    "evolution": _EVOLUTION_OR_NONE,
    "spread": {"enum": SPREAD},
    "postictal_attenuation_s": {"type": "number", "minimum": 0},
    # Waveform family of the ictal run. ``ictal`` (default) is the harmonic
    # stack; ``spike_wave`` is a true spike-and-slow-wave complex whose spike
    # keeps its millisecond width as the repetition rate evolves.
    # ``spike`` / ``sharp_wave`` / ``polyspike`` belong to sporadic_discharges
    "morphology": {"enum": ["ictal", "spike_wave", "rda", "spike", "sharp_wave", "polyspike", None]},
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
                # epileptic spasm: high-voltage generalized slow wave, brief EMG,
                # then a diffuse electrodecrement with low-voltage fast activity
                "spasm", "spasm_cluster",
                # tonic seizure: electrodecrement, then generalized paroxysmal
                # fast activity building in amplitude with tonic EMG
                "tonic_seizure",
                # neonatal brief rhythmic discharge: evolving rhythmic activity
                # shorter than the 10-s seizure minimum (ACNS neonatal)
                "brd",
                # P7 batch 5: sporadic (non-periodic) interictal epileptiform
                # discharges from one focus, keyed one by one with the ACNS
                # prevalence category (abundant / frequent / occasional / rare)
                "sporadic_discharges",
            ]
        },
        # how much scalp muscle an ictal run recruits: none (electrographic /
        # paralysed), modest (default, the 0.3.8 behaviour), clinical
        "muscle": {"enum": MUSCLE_LEVELS},
        # sporadic_discharges: the electrode of maximal negativity, discharges per hour of
        # record, and whether each spike carries an after-going slow wave
        "focus": {"type": "string"},
        "rate_per_h": {"type": "number", "minimum": 0, "maximum": 3600},
        "aftergoing_slow": {"type": "boolean"},
        # P7 batch 4: the time-locked clinical correlate of an ictal run, keyed on the seizure row
        # (ACNS ECSz needs one; "none" = electrographic-only).  Non-EEG: it never changes the signal.
        "clinical_correlate": {"enum": ["none", "subtle", "focal_clonic", "focal_tonic", "generalized_tonic_clonic",
                                        "autonomic", "behavioral_arrest", "unknown"]},
        # spasm / tonic_seizure: seconds of diffuse voltage attenuation
        "decrement_s": {"type": "number", "minimum": 0, "maximum": 30},
        # spasm: depth of the decrement (fraction of background removed) and
        # the low-voltage fast activity riding it
        "decrement_depth": {"type": "number", "minimum": 0, "maximum": 1},
        "fast_uv": {"type": "number", "minimum": 0, "maximum": 100},
        # spasm: cerebral beta riding the slow-wave deflection itself
        "wave_fast_uv": {"type": "number", "minimum": 0, "maximum": 150},
        # spasm_cluster: mean seconds between spasms and how many
        "interval_s": {"type": "number", "minimum": 2, "maximum": 300},
        "count": {"type": "integer", "minimum": 1, "maximum": 400},
        "label": {"type": "string"},
        # rhythmic_pattern (ACNS rhythmic / periodic pattern - NOT a seizure)
        "pattern": {"type": "string"},
        "frequency_hz": {"type": "number", "minimum": 0.2, "maximum": 30.0},
        "amplitude_uv": _pos,
        "run_duration_s": _pos,
        "modifier": {"type": ["string", "null"]},
        "plus_modifier": {"type": ["string", "null"]},
        "periodic": {"type": "boolean"},
        # rhythmic_pattern, opt-in: every run lasts at least this many cycles
        # (ACNS needs six); run_duration_s alone is a mean with spread
        "min_cycles": {"type": "integer", "minimum": 1, "maximum": 100},
        # 0.4.0: amplitude waxing/waning of a run (0.15 was the 0.3.x constant) and
        # run-to-run repetition-rate wander as a fraction of frequency_hz
        "fluctuation": {"type": "number", "minimum": 0, "maximum": 1},
        "rate_jitter": {"type": "number", "minimum": 0, "maximum": 0.5},
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
        # Unitless authored simulation intensity. It is deliberately not a
        # dose or concentration conversion.
        "level": {"type": "number", "minimum": 0, "maximum": 1},
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
        # minutes over which the attenuation builds to depth_pct; 0 = the
        # abrupt onset of an acute event, larger = a gradual evolution such as
        # a developing infarct.  (Sedation ramps live in effect.ramp_min.)
        "ramp_min": {"type": "number", "minimum": 0},
        # Depth applied to delta (<4 Hz) when the loss is frequency-selective.
        # Defaults to depth_pct (a flat, broadband attenuation). Set it LOWER
        # than depth_pct for ischemia, which takes fast activity first and
        # spares delta - that is what makes alpha/delta and theta/delta move.
        "delta_depth_pct": {"type": "number", "minimum": 0, "maximum": 100},
        # temperature
        "from_c": _num,
        "to_c": _num,
        "over_min": {"type": "number", "minimum": 0},
        # artifact
        "kind": {"enum": ARTIFACTS},
        "duration_s": _pos,
        "channels": {"type": "array", "items": {"type": "string"}},
        "intensity": {"enum": ["low", "medium", "high"]},
        # artifact waveform model: 1 = 0.3.x, 2 = 0.4.0 (patting in bouts, atlas-style chewing)
        "model": {"type": "integer", "minimum": 1, "maximum": 2},
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
        "amplitude_gain_at_h": {"type": "array", "items": {"type": "array", "items": _num, "minItems": 2, "maxItems": 2}},
        "ibi_floor_at_h": {"type": "array", "items": {"type": "array", "items": _num, "minItems": 2, "maxItems": 2}},
        "reactivity": {"enum": ["present", "absent", "unknown", "unclear"]},
        # EEG Atlas P5 (0.3.11), opt-in: spontaneous blinks per minute (0 = none;
        # absent = the 15/min awake default).  A suppressed or low-voltage
        # record never engages the burst-envelope blink gate, so an
        # unresponsive patient needs this set explicitly.
        "blink_rate_per_min": {"type": "number", "minimum": 0, "maximum": 60},
        # 0.4.0: peak blink voltage at Fp (0.3.x fixed 95; version-2 default 160)
        "blink_amplitude_uv": {"type": "number", "minimum": 0, "maximum": 500},
        # 0.4.0: what amplitude_uv (and the events' amplitudes) mean - the referential
        # synthesis scale (0.3.x) or the peak-to-peak a reader measures on the display montage
        "amplitude_reference": {"enum": ["referential", "display"]},
        # 0.4.0: posterior dominant rhythm field - broad (0.3.x) or focal (occipital-parietal)
        "pdr_field": {"enum": ["broad", "focal"]},
        # 0.4.0 (Craig, P5 C05): interburst interval as a [lo, hi] range in seconds and the
        # interburst voltage in absolute microvolts; both override the PMA/preset values
        "ibi_range_s": {"type": "array", "items": _pos, "minItems": 2, "maxItems": 2},
        "ibi_floor_uv": {"type": "number", "minimum": 0, "maximum": 200},
        # EEG Atlas P5 (0.3.11), opt-in: multiplier on the posterior dominant
        # rhythm stream (1.0 = the 0.3.10 mix, which leaves the spectral peak
        # in the delta band whatever dominant_hz asks).
        "pdr_gain": {"type": "number", "minimum": 0, "maximum": 8},
        # EEG Atlas P5 (0.3.11), opt-in: cap on the per-electrode gain draw relative
        # to the median scalp electrode.  The 0.3.10 draw has a log-sd 0.5 high
        # tail anchored on all 19 scalp electrodes, so a 9-electrode neonatal
        # montage can land entirely in the tail (P5 seed sweep: 27-160 uV for one
        # 40-uV request).  2.0 keeps a hot electrode; absent = unchanged.
        "channel_gain_max": {"type": "number", "minimum": 1, "maximum": 10},
        # true/false: the 0.3.10 delta-gated fast stream; "riding" (0.3.12): discrete
        # delta-wave brushes scheduled by PMA (spec.DELTA_BRUSH_PMA)
        "delta_brushes": {"anyOf": [{"type": "boolean"}, {"const": "riding"}]},
        "baseline_ecg_uv": {"type": "number", "minimum": 0, "maximum": 30},
        # neonates only: postmenstrual age drives the discontinuity defaults
        # (interburst interval, its spread, burst length, interburst floor,
        # burst voltage) from the maturational tables - see spec.PMA_TABLE.
        "pma_weeks": {"type": "number", "minimum": 23, "maximum": 48},
        # P7 batch 1 (0.4.2), neonates: a term sleep-wake cycle that is EMITTED (state rows in the answer
        # key) and drives continuity (quiet sleep = trace alternant); hours of life for the first-day
        # state (Castro Conde 2017, S22); dysmaturity = patterns drawn from a younger PMA than stated
        "state_cycle": {"enum": ["term"]},
        "hours_of_life": {"type": "number", "minimum": 0, "maximum": 720},
        "dysmature_pma_weeks": {"type": "number", "minimum": 23, "maximum": 48},
        # P7 batch 2 (0.4.2): anteroposterior gradient on/off; cyclic alternating pattern of
        # encephalopathy (ACNS: >= 6 cycles of two alternating backgrounds, each phase >= 10 s);
        # breach effect (regional amplitude and fast-activity gain over a skull defect)
        "ap_gradient": {"enum": ["present", "absent"]},
        "cape": {"type": "object", "additionalProperties": False, "required": ["period_s"],
                 "properties": {"period_s": {"type": "number", "minimum": 20, "maximum": 240},
                                "depth": {"type": "number", "minimum": 0.2, "maximum": 0.9},
                                "cycles": {"type": "integer", "minimum": 2, "maximum": 400},
                                "at_min": {"type": "number", "minimum": 0},
                                "slowing": {"type": "boolean"}}},
        "breach": {"type": "object", "additionalProperties": False, "required": ["focus"],
                   "properties": {"focus": {"type": "string"},
                                  "gain": {"type": "number", "minimum": 1, "maximum": 5},
                                  "fast_gain": {"type": "number", "minimum": 1, "maximum": 8}}},
        # neonates: per-element rate / amplitude overrides of the PMA table
        # (spec.GRAPHOELEMENT_PMA); `enabled: false` silences one.
        "graphoelements": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                name: {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "rate_per_min": {"type": "number", "minimum": 0, "maximum": 60},
                        "amplitude_uv": {"type": "number", "minimum": 0, "maximum": 500},
                        "enabled": {"type": "boolean"},
                    },
                }
                for name in ("occipital_delta", "temporal_theta", "temporal_alpha", "stop",
                             "frontal_sharp", "anterior_slow", "midline_theta", "delta_brush", "sharp_transient")
            },
        },
        # fraction of bursts that are interhemispherically synchronous
        "synchrony": {"type": "number", "minimum": 0, "maximum": 1},
        # hypsarrhythmia (or any background): independent multifocal spikes
        # and sharp waves, rate over the whole head per second
        # P7 batch 5: pediatric normal variants (developmental EEG chapter, S06).  Each is
        # emitted only in its state (hypnagogic hypersynchrony in drowsiness, POSTS in sleep,
        # posterior slow waves of youth awake) and keyed as ``normal_variant`` rows.
        "variants": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                name: {"type": ["object", "null"], "additionalProperties": False,
                       "properties": {"enabled": {"type": "boolean"},
                                      "amplitude_uv": {"type": "number", "minimum": 0, "maximum": 600},
                                      "rate_per_min": {"type": "number", "minimum": 0, "maximum": 60}}}
                for name in ("hypnagogic_hypersynchrony", "posts", "posterior_slow_waves_of_youth")
            },
        },
        "multifocal_spikes": {
            "type": ["object", "null"],
            "additionalProperties": False,
            "properties": {
                "rate_per_s": {"type": "number", "minimum": 0, "maximum": 20},
                "amplitude_uv": {"type": "number", "minimum": 0, "maximum": 600},
            },
        },
        "asymmetry": {
            "type": "object",
            "required": ["side"],
            "additionalProperties": False,
            "properties": {
                "side": {"enum": ["left", "right"]},
                "attenuation_pct": {"type": "number", "minimum": 0, "maximum": 100},
                "slowing_hz": {"type": "number", "minimum": 0, "maximum": 10},
                # gradient: scales with distance from the midline (0.3.x); hemispheric:
                # full attenuation on every electrode of that side (0.4.0, Craig P5 C04)
                "profile": {"enum": ["gradient", "hemispheric"]},
            },
        },
        "burst_suppression": {
            # explicit null means "no burst-suppression block", which is what a
            # generator writing every key tends to emit
            "type": ["object", "null"],
            "additionalProperties": False,
            "properties": {
                "burst_s": _pos, "ibi_s": _pos,
                # log-normal spread of interburst intervals; the maturational
                # tables have the longest acceptable IBI at 4-5x the mean in
                # extreme prematurity and ~1.5x at term
                "ibi_sigma": {"type": "number", "minimum": 0, "maximum": 1.5},
                "ibi_floor": {"type": "number", "minimum": 0, "maximum": 1},
                "epileptiform_discharges": {"type": "integer", "minimum": 2, "maximum": 20},
                "highly_epileptiform_fraction": {"type": "number", "minimum": 0, "maximum": 1},
                "interpeak_latency_s": _pos,
                "phases": {"type": "integer", "minimum": 2, "maximum": 12},
            },
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
        "suppression_min_duration_s": {"type": "number", "minimum": 0.5, "maximum": 10},
        # fixed dB window for the FFT spectrogram; [-10, 25] is the published
        # atlas convention and makes colour comparable across items
        "fft_db_range": _RANGE,
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
        "theta_delta_ratio_axis": _RANGE,
        "show_trend_strip": {"type": "boolean"},
        "trend_strip_panels": {"type": "array", "items": {"type": "string"}},
        "trend_strip_duration_min": {"type": "number", "minimum": 5},
        "show_ecg_channel": {"type": "boolean"},
        "chain_order": {"type": "string"},
        "single_channel": {"type": "string"},
        "layout": {"enum": ["side_by_side_single_vs_multichannel"]},
        "show_reference_seizure_strip": {"type": "boolean"},
        "spindle_hz": {"type": "number", "minimum": 10, "maximum": 16},
        "spindle_train_s": {"type": "number", "minimum": 30, "maximum": 600},
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

_SEDATION = {
    "type": "object",
    "required": ["agent", "level"],
    "additionalProperties": False,
    "properties": {
        "agent": {"enum": AGENTS},
        "level": {"type": "number", "minimum": 0, "maximum": 1},
    },
}

_COMMON = {
    "seed": {"type": "integer"},
    # which DEFAULTS an omitted key gets: 1 = 0.3.x (the committed bank is pinned to it), 2 = 0.4.0
    "spec_version": {"type": "integer", "minimum": 1, "maximum": 2},
    "age_group": {"enum": AGE_GROUPS},
    "sample_rate": {"type": "integer", "minimum": 100, "maximum": 1024},
    "channels": {"enum": list({"standard_19", "neonatal_9", "neonatal_reduced"})},
    "montage": {"enum": MONTAGES},
    "background": _BACKGROUND,
    "sedation": _SEDATION,
    # Evidence supports modeling complete blockade as removal of generated
    # scalp EMG. It does not attenuate cerebral or device-origin signals.
    "neuromuscular_blockade": {"enum": ["complete"]},
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
                    "evolution": _EVOLUTION,
                },
            },
        },
        "raw_strip_at_h": {"type": ["number", "null"], "minimum": 0},
        "raw_strip_window_s": {"type": "number", "minimum": 10, "maximum": 60},
        "start_h": {"type": "number", "minimum": 0},
        "time_axis": {"enum": ["clock", "elapsed", "hours_of_life"]},
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
