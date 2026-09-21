"""0.4.4 (Craig, PQ-G-002): per-electrode scalp gain is smoothed over the head and capped at 1.5 by default, so no
chain electrode can sit at 2-3x both neighbours and turn its two derivations into mirror images."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from eeg_render.spec import normalize  # noqa: E402
from eeg_render.synth import Synthesizer  # noqa: E402

CHAINS = [("Fp1", "F7", "T3"), ("F7", "T3", "T5"), ("T3", "T5", "O1"), ("Fp2", "F8", "T4"), ("F8", "T4", "T6"), ("T4", "T6", "O2"),
          ("Fp1", "F3", "C3"), ("F3", "C3", "P3"), ("C3", "P3", "O1"), ("Fp2", "F4", "C4"), ("F4", "C4", "P4"), ("C4", "P4", "O2"),
          ("Fz", "Cz", "Pz")]


def _syn(seed, version=None):
    spec = {"seed": seed, "age_group": "child", "sample_rate": 256, "channels": "standard_19", "duration_min": 10,
            "background": {"type": "continuous", "amplitude_uv": 50.0, "dominant_hz": 7.5, "slow_fraction": 0.35}, "events": []}
    if version:
        spec["spec_version"] = version
    return Synthesizer(normalize({"kind": "eeg_page", "license": "synthetic-original", "spec": spec})["spec"], 600.0)


def test_pq_g_002_seed_no_longer_mirrors():
    syn = _syn(27960625)
    g = syn._ch_gain
    i = syn._idx
    assert g[[i[e] for e in syn.scalp]].max() <= 1.5 + 1e-9
    # the worst middle-vs-neighbour step over every chain triple stays modest
    steps = [g[i[b]] / min(g[i[a]], g[i[c]]) for a, b, c in CHAINS]
    assert max(steps) < 1.9, max(steps)
    t, x = syn.segment(300.0, 320.0)
    r_temporal = np.corrcoef(x[i["T3"]] - x[i["T5"]], x[i["T5"]] - x[i["O1"]])[0, 1]
    r_vertex = np.corrcoef(x[i["Fz"]] - x[i["Cz"]], x[i["Cz"]] - x[i["Pz"]])[0, 1]
    assert r_temporal > -0.6 and r_vertex > -0.6, (r_temporal, r_vertex)   # was -0.84 / -0.81 at 0.4.3


def test_version_1_gain_untouched():
    g1 = _syn(27960625, version=1)._ch_gain
    assert g1.max() > 1.6                      # legacy draw keeps its tail (no cap, no smoothing)


def test_cluster_without_spread_recruits_no_muscle():
    ev = {"type": "seizure_cluster", "start_min": 2.0, "end_min": 6.0, "interval_min": 2.0,
          "seizure": {"duration_s": 30, "onset_region": "right_temporal", "spread": "none",
                      "evolution": {"start_hz": 4.0, "end_hz": 1.5, "amplitude_start_uv": 55, "amplitude_end_uv": 150}}}
    img = {"kind": "eeg_page", "license": "synthetic-original",
           "spec": {"seed": 1, "age_group": "child", "sample_rate": 256, "channels": "standard_19", "duration_min": 10,
                    "background": {"type": "continuous", "amplitude_uv": 50.0, "dominant_hz": 7.5, "slow_fraction": 0.35}, "events": [ev]}}
    assert normalize(img)["spec"]["events"][0]["muscle"] == "none"
    ev2 = dict(ev, seizure=dict(ev["seizure"], spread="hemispheric"))
    img["spec"]["events"] = [ev2]
    assert normalize(img)["spec"]["events"][0]["muscle"] == "modest"
