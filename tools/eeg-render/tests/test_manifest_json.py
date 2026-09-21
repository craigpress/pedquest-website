"""0.4.4: the answer key must be plain JSON for every row kind (a state row carried numpy bools since 0.4.2)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from eeg_render.export.manifest import _summary, realized_events  # noqa: E402
from eeg_render.spec import normalize  # noqa: E402
from eeg_render.synth import Synthesizer  # noqa: E402


def _walk(o, out):
    if isinstance(o, dict):
        for v in o.values():
            _walk(v, out)
    elif isinstance(o, list):
        for v in o:
            _walk(v, out)
    elif isinstance(o, np.generic):
        out.append(type(o).__name__)


def test_manifest_rows_are_plain_json_with_state_change_variants_and_discharges():
    spec = {"seed": 27960625, "age_group": "child", "sample_rate": 256, "channels": "standard_19", "duration_min": 30,
            "background": {"type": "continuous", "amplitude_uv": 50.0, "dominant_hz": 7.5, "slow_fraction": 0.35,
                           "variants": {"posts": {}}},
            "events": [{"type": "state_change", "at_min": 5.0, "to": "sleep"},
                       {"type": "stimulation", "at_min": 3.0},
                       {"type": "sporadic_discharges", "focus": "T3", "rate_per_h": 120, "amplitude_uv": 90},
                       {"type": "seizure", "onset_min": 20.0, "duration_s": 40, "onset_region": "right_temporal", "spread": "none",
                        "evolution": {"start_hz": 4.0, "end_hz": 1.5, "amplitude_start_uv": 55, "amplitude_end_uv": 150}}]}
    syn = Synthesizer(normalize({"kind": "eeg_page", "license": "synthetic-original", "spec": spec})["spec"], 1800.0)
    rows = realized_events(syn, 1800.0)
    kinds = {r["kind"] for r in rows}
    assert {"state", "stimulation", "sporadic_discharge", "normal_variant", "seizure"} <= kinds
    bad: list = []
    _walk(rows, bad)
    _walk(_summary(syn, 1800.0), bad)
    assert bad == [], bad
    json.dumps({"events": rows, "summary": _summary(syn, 1800.0)})
