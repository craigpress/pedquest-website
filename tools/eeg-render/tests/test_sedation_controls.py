from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import numpy as np
import pytest

RENDERER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RENDERER))

from eeg_render.spec import SpecError, normalize
from eeg_render.synth import Synthesizer
from eeg_render.export.manifest import realized_events


def _spec(**extra):
    spec = {
        "seed": 109, "spec_version": 2, "age_group": "child",
        "sample_rate": 200, "channels": "standard_19", "duration_min": 10,
        "background": {"type": "continuous", "dominant_hz": 9.0,
                       "amplitude_uv": 40.0, "slow_fraction": 0.25,
                       "amplitude_reference": "referential",
                       "baseline_ecg_uv": 8.0},
        "events": [],
    }
    spec.update(extra)
    image = {"kind": "eeg_page", "license": "synthetic-original", "spec": spec}
    return normalize(image)["spec"]


def _signal(spec, a=120.0, b=180.0):
    return Synthesizer(spec, 600.0).segment(a, b)[1]


def _band_power(x, fs, lo, hi):
    f = np.fft.rfftfreq(x.shape[1], 1.0 / fs)
    p = np.abs(np.fft.rfft(x, axis=1)) ** 2
    return float(p[:, (f >= lo) & (f < hi)].mean())


def test_no_control_preserves_the_pre_pqw109_samples():
    x = _signal(_spec(), 120.0, 130.0)
    # Hash captured from c6e1332 under the suite's OPENBLAS_NUM_THREADS=1 contract.
    assert hashlib.sha256(x.tobytes()).hexdigest() == "896f074730c8d600b2fc8d834c5a48bb69492fedd38bd6391895cba1722c0962"


def test_agent_profiles_move_the_expected_spectral_bands():
    base = _signal(_spec())
    prop = _signal(_spec(sedation={"agent": "propofol", "level": 0.8}))
    dex = _signal(_spec(sedation={"agent": "dexmedetomidine", "level": 0.8}))
    mid = _signal(_spec(sedation={"agent": "midazolam", "level": 0.8}))
    ket = _signal(_spec(sedation={"agent": "ketamine", "level": 0.8}))
    remi = _signal(_spec(sedation={"agent": "remifentanil", "level": 0.8}))
    assert _band_power(prop, 200, 0.5, 4) > 1.15 * _band_power(base, 200, 0.5, 4)
    assert _band_power(prop, 200, 8, 13) > 1.10 * _band_power(base, 200, 8, 13)
    assert _band_power(dex, 200, 11, 15) > 1.10 * _band_power(base, 200, 11, 15)
    assert _band_power(mid, 200, 15, 25) > 1.20 * _band_power(base, 200, 15, 25)
    assert _band_power(ket, 200, 28, 42) > 1.20 * _band_power(base, 200, 28, 42)
    assert _band_power(remi, 200, 0.5, 4) > _band_power(base, 200, 0.5, 4)
    assert _band_power(remi, 200, 4, 13) < _band_power(base, 200, 4, 13)


def test_neonatal_midazolam_is_attenuation_not_adult_beta():
    neo = _spec(age_group="neonate", channels="neonatal_9")
    sed = _spec(age_group="neonate", channels="neonatal_9",
                sedation={"agent": "midazolam", "level": 1.0})
    a, b = _signal(neo), _signal(sed)
    assert np.std(b) < 0.8 * np.std(a)
    assert _band_power(b, 200, 15, 25) < _band_power(a, 200, 15, 25)


def test_ramp_is_monotonic_and_partition_independent():
    spec = _spec(events=[{"type": "sedation_change", "at_min": 2.0,
                          "direction": "increase", "agent": "midazolam", "level": 1.0,
                          "effect": {"ramp_min": 2.0, "suppression_ratio_target_pct": 0.0}}])
    syn = Synthesizer(spec, 600.0)
    assert syn._sed_beta[0] < syn._sed_beta[-1]
    _, whole = syn.segment(60.0, 300.0)
    chunks = np.concatenate([syn.segment(a, min(a + 37.0, 300.0))[1]
                             for a in np.arange(60.0, 300.0, 37.0)], axis=1)
    assert np.max(np.abs(whole - chunks)) < 1e-9


def test_legacy_sedation_event_preserves_pre_pqw109_samples():
    spec = _spec(seed=110, duration_min=20, events=[{
        "type": "sedation_change", "at_min": 2.0, "direction": "increase",
        "agent": "propofol", "effect": {"ramp_min": 2.0,
        "suppression_ratio_target_pct": 30.0, "beta_boost": True}}])
    x = Synthesizer(spec, 1200.0).segment(300.0, 310.0)[1]
    assert hashlib.sha256(x.tobytes()).hexdigest() == "f451b604cc12467e4bc145113d66a8845c44b3199404cdd8b9a129ce72df8dae"


def test_overlapping_sedation_ramps_are_rejected():
    with pytest.raises(SpecError, match="must not overlap"):
        _spec(events=[
            {"type": "sedation_change", "at_min": 1.0, "direction": "increase",
             "agent": "propofol", "level": 0.8, "effect": {"ramp_min": 3.0}},
            {"type": "sedation_change", "at_min": 2.0, "direction": "decrease",
             "agent": "propofol", "level": 0.2, "effect": {"ramp_min": 1.0}},
        ])


def test_effective_minimum_ramps_cannot_create_a_nonmonotonic_timeline():
    with pytest.raises(SpecError, match="must not overlap"):
        _spec(events=[
            {"type": "sedation_change", "at_min": 1.0, "direction": "increase",
             "agent": "propofol", "level": 0.5, "effect": {"ramp_min": 0.0}},
            {"type": "sedation_change", "at_min": 1.1, "direction": "increase",
             "agent": "propofol", "level": 0.8, "effect": {"ramp_min": 0.0}},
        ])


def test_legacy_only_overlaps_keep_original_order_and_remain_valid():
    spec = _spec(events=[
        {"type": "sedation_change", "at_min": 2.0, "direction": "increase",
         "agent": "midazolam", "effect": {"ramp_min": 2.0}},
        {"type": "sedation_change", "at_min": 1.0, "direction": "decrease",
         "agent": "midazolam", "effect": {"ramp_min": 2.0}},
    ])
    syn = Synthesizer(spec, 600.0)
    assert syn._sed_t == [0.0, 120.0, 240.0, 60.0, 180.0]


def test_sedation_reduces_muscle_without_erasing_fast_cerebral_activity():
    base = _signal(_spec())
    sed = _signal(_spec(sedation={"agent": "ketamine", "level": 1.0}))
    assert _band_power(sed, 200, 28, 42) > _band_power(base, 200, 28, 42)
    plain = Synthesizer(_spec(), 600.0)
    drug = Synthesizer(_spec(sedation={"agent": "propofol", "level": 1.0}), 600.0)
    assert drug._sed_emg[0] < plain._sed_emg[0]


def test_complete_blockade_removes_emg_but_preserves_cerebral_ecg_and_ventilator():
    events = [{"type": "artifact", "kind": "ventilator", "at_min": 2.0,
               "duration_s": 60.0, "intensity": "high"}]
    plain = Synthesizer(_spec(events=events), 600.0)
    blocked = Synthesizer(_spec(events=events, neuromuscular_blockade="complete"), 600.0)
    t = np.arange(120 * 200, 180 * 200) / 200
    assert np.all(blocked._artifact_block(t, 120 * 200) == plain._artifact_block(t, 120 * 200))
    assert np.all(blocked._ecg(t, 8.0) == plain._ecg(t, 8.0))
    xb = blocked.segment(120, 180)[1]
    xp = plain.segment(120, 180)[1]
    assert _band_power(xb, 200, 20, 45) < _band_power(xp, 200, 20, 45)
    cerebral = _signal(_spec(sedation={"agent": "ketamine", "level": 0.8},
                            neuromuscular_blockade="complete"))
    assert _band_power(cerebral, 200, 28, 42) > _band_power(_signal(_spec()), 200, 28, 42)


def test_blockade_removes_emg_parts_of_mixed_artifacts_and_the_chewing_key():
    events = [
        {"type": "artifact", "kind": kind, "at_min": 2.0, "duration_s": 60.0,
         "intensity": "high"} for kind in ("chest_pt", "movement", "emg_chewing")
    ]
    plain = Synthesizer(_spec(events=events), 600.0)
    blocked = Synthesizer(_spec(events=events, neuromuscular_blockade="complete"), 600.0)
    xp = plain.segment(120.0, 180.0)[1]
    xb = blocked.segment(120.0, 180.0)[1]
    assert _band_power(xb, 200, 20, 45) < _band_power(xp, 200, 20, 45)
    assert not [r for r in realized_events(blocked, 600.0)
                if r["kind"] == "artifact" and r["artifact_kind"] == "emg_chewing"]


def test_manifest_uses_effective_ramp_and_legacy_shape():
    new = Synthesizer(_spec(events=[{"type": "sedation_change", "at_min": 2.0,
        "direction": "increase", "agent": "propofol", "level": 0.5,
        "effect": {"ramp_min": 0.0}}]), 600.0)
    row = next(r for r in realized_events(new, 600.0) if r["kind"] == "sedation_change")
    assert row["offset_s"] - row["onset_s"] == 30.0 and row["level"] == 0.5
    legacy = Synthesizer(_spec(events=[{"type": "sedation_change", "at_min": 2.0,
        "direction": "increase", "agent": "midazolam", "effect": {"ramp_min": 1.0}}]), 600.0)
    old_row = next(r for r in realized_events(legacy, 600.0) if r["kind"] == "sedation_change")
    assert "level" not in old_row


def test_composite_children_share_controls_and_manifest_reports_generated_state():
    image = {"kind": "composite", "license": "synthetic-original", "spec": {
        "seed": 109, "spec_version": 2, "age_group": "child",
        "sedation": {"agent": "propofol", "level": 0.6},
        "neuromuscular_blockade": "complete",
        "qeeg_panel": {"duration_min": 30, "panels": ["fft_L"]},
        "eeg_page": {"at_min": 5.0, "window_s": 10.0},
    }}
    spec = normalize(image)["spec"]
    for child in (spec["qeeg_panel"], spec["eeg_page"]):
        assert child["sedation"] == {"agent": "propofol", "level": 0.6}
        assert child["neuromuscular_blockade"] == "complete"
    syn = Synthesizer(spec["qeeg_panel"], 1800.0)
    rows = realized_events(syn, 1800.0)
    sedation = next(r for r in rows if r["kind"] == "sedation")
    blockade = next(r for r in rows if r["kind"] == "neuromuscular_blockade")
    assert sedation["agent"] == "propofol" and sedation["level"] == 0.6
    assert blockade["modeled_effect"] == "generated_emg_removed"
