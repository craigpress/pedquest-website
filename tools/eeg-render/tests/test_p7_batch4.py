"""EEG Atlas P7 batch 4 (0.4.2): keyed clinical correlate, seizure burden and status flags in the answer key."""
from __future__ import annotations

import sys
from pathlib import Path

RENDERER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RENDERER))

from eeg_render.export.manifest import realized_events, seizure_burden  # noqa: E402
from eeg_render.spec import normalize, validate_image  # noqa: E402
from eeg_render.synth import Synthesizer  # noqa: E402

FS = 256


def _img(events, age="adult", seed=517501, duration_min=60):
    bg = {"type": "continuous", "amplitude_uv": 35.0, "dominant_hz": 3.0, "slow_fraction": 0.8, "reactivity": "absent", "blink_rate_per_min": 0}
    if age == "neonate":
        bg = {"type": "continuous", "pma_weeks": 40.0, "amplitude_uv": 40.0, "dominant_hz": 2.0, "slow_fraction": 0.8}
    return {"kind": "eeg_page", "license": "synthetic-original",
            "spec": {"seed": seed, "age_group": age, "sample_rate": FS, "channels": "standard_19" if age != "neonate" else "neonatal_9",
                     "duration_min": duration_min, "background": bg, "events": events}}


def _sz(onset_min, dur, region, **extra):
    e = {"type": "seizure", "onset_min": onset_min, "duration_s": dur, "onset_region": region, "spread": "none",
         "evolution": {"start_hz": 5.0, "end_hz": 2.0, "amplitude_start_uv": 50, "amplitude_end_uv": 140}}
    e.update(extra)
    return e


def _cluster(onset_min, count, interval_s, dur, region, **extra):
    # the cluster schema nests the per-run parameters under ``seizure``; clinical_correlate rides on the event
    e = {"type": "seizure_cluster", "start_min": onset_min, "end_min": onset_min + (count - 1) * interval_s / 60.0,
         "interval_min": interval_s / 60.0,
         "seizure": {"duration_s": dur, "onset_region": region, "spread": "none",
                     "evolution": {"start_hz": 4.0, "end_hz": 2.0, "amplitude_start_uv": 50, "amplitude_end_uv": 140}}}
    e.update(extra)
    return e


def _burden(img):
    syn = Synthesizer(normalize(img)["spec"], 3600.0)
    rows = realized_events(syn, 3600.0)
    return rows, seizure_burden(rows, 3600.0, syn.age)


def test_clinical_correlate_is_keyed_and_electroclinical_derived():
    img = _img([_sz(10.0, 70, "left_frontal", clinical_correlate="focal_clonic")], age="child")
    assert validate_image(img) == []
    rows, _ = _burden(img)
    r = [x for x in rows if x["kind"] == "seizure"][0]
    assert r["clinical_correlate"] == "focal_clonic" and r["electroclinical"] is True
    rows2, _ = _burden(_img([_sz(10.0, 70, "left_frontal")], age="child"))
    r2 = [x for x in rows2 if x["kind"] == "seizure"][0]
    assert r2["clinical_correlate"] == "none" and r2["electroclinical"] is False


def test_status_by_duration_is_nonconvulsive_when_uncorrelated():
    _, b = _burden(_img([_sz(10.0, 720, "left_temporal", clinical_correlate="none")]))
    assert b["electrographic_status"] and b["status_basis"] == "duration" and b["nonconvulsive"]
    assert 700 < b["longest_s"] <= 720 and b["count"] == 1


def test_status_by_burden_and_below_threshold():
    _, b = _burden(_img([_cluster(1.0, 15, 240.0, 60, "right_temporal", clinical_correlate="subtle")]))
    assert b["electrographic_status"] and b["status_basis"] == "burden" and 0.20 <= b["max_hour_fraction"] <= 0.32
    assert not b["nonconvulsive"]
    _, low = _burden(_img([_cluster(8.0, 3, 900.0, 45, "left_temporal")], age="child"))
    assert not low["electrographic_status"] and low["count"] == 3 and low["max_hour_fraction"] < 0.1


def test_neonatal_status_threshold():
    _, hi = _burden(_img([_cluster(1.0, 30, 120.0, 60, "left_central", muscle="none")], age="neonate"))
    _, lo = _burden(_img([_cluster(3.0, 12, 300.0, 60, "right_temporal", muscle="none")], age="neonate"))
    assert hi["neonatal_status"] and hi["max_hour_fraction"] >= 0.45 and hi["status_basis"] == "burden_neonatal"
    assert hi["count"] == 30 and 55 <= hi["longest_s"] <= 80
    # a neonate is judged by the neonatal criterion only: 20 % of the hour is high burden, not status
    assert not lo["neonatal_status"] and not lo["electrographic_status"] and 0.15 <= lo["max_hour_fraction"] <= 0.25


def test_manifest_summary_block_present():
    from eeg_render.export.manifest import build_manifest
    syn = Synthesizer(normalize(_img([_sz(5.0, 60, "left_temporal")]))["spec"], 600.0)
    rows = realized_events(syn, 600.0)
    b = seizure_burden(rows, 600.0, syn.age)
    assert set(b) >= {"count", "total_s", "longest_s", "max_hour_fraction", "electrographic_status", "status_basis", "nonconvulsive", "neonatal_status"}
