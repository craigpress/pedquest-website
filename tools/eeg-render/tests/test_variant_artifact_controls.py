from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import numpy as np
import pytest

RENDERER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RENDERER))

from eeg_render.export.manifest import realized_events
from eeg_render.spec import SpecError, normalize
from eeg_render.synth import Synthesizer

FS = 200


def _spec(age="child", events=None, **extra):
    spec = {"seed": 110, "spec_version": 2, "age_group": age, "sample_rate": FS,
            "channels": "standard_19", "duration_min": 10,
            "background": {"type": "continuous", "dominant_hz": 9.0,
                           "amplitude_uv": 40.0, "slow_fraction": 0.25,
                           "amplitude_reference": "referential", "blink_rate_per_min": 0.0},
            "events": events or []}
    spec.update(extra)
    return normalize({"kind": "eeg_page", "license": "synthetic-original", "spec": spec})["spec"]


def _variant(kind, at=2.0, duration=20.0, **extra):
    event = {"type": "normal_variant", "kind": kind, "at_min": at, "duration_s": duration}
    event.update(extra)
    return event


def _artifact(kind, **extra):
    event = {"type": "artifact", "kind": kind, "at_min": 2.0, "duration_s": 20.0,
             "intensity": "medium"}
    event.update(extra)
    return event


def _whole_and_chunks(syn, a=115.0, b=145.0):
    whole = syn.segment(a, b)[1]
    parts = np.concatenate([syn.segment(t, min(t + 7.0, b))[1]
                            for t in np.arange(a, b, 7.0)], axis=1)
    return whole, parts


def test_absent_controls_preserve_stacked_base_samples():
    x = Synthesizer(_spec(), 600.0).segment(120.0, 130.0)[1]
    assert hashlib.sha256(x.tobytes()).hexdigest() == "880d0b742d7ff87c1b4742949df95acf3644e29923fa3ca14fbd595a52aabe4f"


@pytest.mark.parametrize("kind", ["mu", "lambda", "wicket", "fourteen_and_six", "rmtd",
                                  "sreda", "frontal_arousal_rhythm", "photic_driving",
                                  "hyperventilation_buildup"])
def test_authored_variant_random_access_is_partition_independent(kind):
    age = "adult" if kind == "sreda" else "child"
    events = [_variant(kind)]
    if kind in ("wicket", "rmtd"):
        events = [{"type": "state_change", "at_min": 1.0, "to": "sleep"},
                  _variant(kind, at=1.5)]
    elif kind == "fourteen_and_six":
        events = [{"type": "state_change", "at_min": 0.0, "to": "sleep"}, _variant(kind)]
    elif kind == "frontal_arousal_rhythm":
        events = [{"type": "state_change", "at_min": 2.0, "to": "arousal"}, _variant(kind, duration=10.0)]
    syn = Synthesizer(_spec(age=age, events=events), 600.0)
    whole, parts = _whole_and_chunks(syn)
    assert np.max(np.abs(whole - parts)) < 1e-9


def test_teaching_age_and_state_gates_control_both_signal_and_key():
    child_sreda = Synthesizer(_spec(events=[_variant("sreda")]), 600.0)
    adult_sreda = Synthesizer(_spec(age="adult", events=[_variant("sreda")]), 600.0)
    assert not adult_sreda.authored_variant_runs() == []
    assert child_sreda.authored_variant_runs() == []
    adult_lambda = Synthesizer(_spec(age="adult", events=[_variant("lambda")]), 600.0)
    child_lambda = Synthesizer(_spec(events=[_variant("lambda")]), 600.0)
    assert adult_lambda.authored_variant_runs() == [] and child_lambda.authored_variant_runs()
    wrong_state = Synthesizer(_spec(events=[_variant("rmtd")]), 600.0)
    assert wrong_state.authored_variant_runs() == []
    assert not [r for r in realized_events(wrong_state, 600.0) if r.get("variant") == "rmtd"]


def test_context_cannot_bypass_state_and_full_event_must_be_eligible():
    bypass = Synthesizer(_spec(age="adult", events=[_variant("rmtd", context="adult_teaching")]), 600.0)
    assert bypass.authored_variant_runs() == []
    spanning = Synthesizer(_spec(events=[
        {"type": "state_change", "at_min": 2.2, "to": "sleep"},
        _variant("mu", at=2.0, duration=30.0),
    ]), 600.0)
    assert spanning.authored_variant_runs() == []


def test_fourteen_and_six_selects_one_positive_burst_frequency_and_mu_is_arciform():
    sleeping = [{"type": "state_change", "at_min": 0.0, "to": "sleep"}]
    v14 = Synthesizer(_spec(events=sleeping + [_variant("fourteen_and_six")]), 600.0)
    v6 = Synthesizer(_spec(events=sleeping + [_variant("fourteen_and_six", frequency_hz=6.0)]), 600.0)
    t = np.arange(120 * FS, 140 * FS) / FS
    x14 = v14._authored_variant_rows(t)[v14._idx["T5"]]
    x6 = v6._authored_variant_rows(t)[v6._idx["T5"]]
    assert np.min(x14) >= 0 and np.min(x6) >= 0
    assert not np.array_equal(x14, x6)
    mu = Synthesizer(_spec(events=[_variant("mu")]), 600.0)
    xm = mu._authored_variant_rows(t)[mu._idx["C3"]]
    assert xm.max() > 2 * abs(xm.min())


def test_mu_is_central_and_key_splits_around_movement_block():
    event = _variant("mu", at=2.0, duration=30.0, block_at_min=2.2, block_duration_s=6.0)
    syn = Synthesizer(_spec(events=[event]), 600.0)
    t = np.arange(120 * FS, 150 * FS) / FS
    rows = syn._authored_variant_rows(t)
    assert np.ptp(rows[syn._idx["C3"]]) > 3 * np.ptp(rows[syn._idx["O1"]])
    block = (t >= 132.0) & (t < 138.0)
    assert np.max(np.abs(rows[:, block])) == 0.0
    keys = [r for r in realized_events(syn, 600.0) if r.get("variant") == "mu"]
    assert [(r["onset_s"], r["offset_s"]) for r in keys] == [(120.0, 132.0), (138.0, 150.0)]


def test_lambda_is_positive_occipital_and_far_is_pending_not_benign():
    lam = Synthesizer(_spec(events=[_variant("lambda")]), 600.0)
    t = np.arange(120 * FS, 140 * FS) / FS
    rows = lam._authored_variant_rows(t)
    assert rows[lam._idx["O1"]].max() > 0
    assert rows[lam._idx["F3"]].max() < 0.5 * rows[lam._idx["O1"]].max()
    far_events = [{"type": "state_change", "at_min": 2.0, "to": "arousal"},
                  _variant("frontal_arousal_rhythm", duration=10.0)]
    far = Synthesizer(_spec(events=far_events), 600.0)
    key = next(r for r in realized_events(far, 600.0) if r.get("variant") == "frontal_arousal_rhythm")
    assert key["kind"] == "arousal_pattern_pending_review"
    assert key["clinical_classification"] == "pending_craig_review"


@pytest.mark.parametrize("kind", ["lateral_eye", "slow_roving_eye", "rem_eye_movements", "pulse", "glossokinetic"])
def test_new_artifacts_are_partition_independent_and_keyed(kind):
    context = "rem" if kind == "rem_eye_movements" else "drowsy" if kind == "slow_roving_eye" else "awake"
    event = _artifact(kind, context=context)
    events = ([{"type": "state_change", "at_min": 1.5, "to": "rem"}, event]
              if kind == "rem_eye_movements" else
              [{"type": "state_change", "at_min": 1.5, "to": "sleep"}, event]
              if kind == "slow_roving_eye" else [event])
    syn = Synthesizer(_spec(events=events), 600.0)
    whole, parts = _whole_and_chunks(syn)
    assert np.max(np.abs(whole - parts)) < 1e-9
    key = next(r for r in realized_events(syn, 600.0) if r.get("artifact_kind") == kind)
    if kind == "rem_eye_movements":
        assert key["staging_claim"] == "eye_movements_only_not_full_psg_stage"


def test_lateral_eye_has_opposed_frontal_field_and_ecg_differs_from_pulse():
    lateral = Synthesizer(_spec(events=[_artifact("lateral_eye", context="awake")]), 600.0)
    t = np.arange(120 * FS, 140 * FS) / FS
    x = lateral._artifact_block(t, 120 * FS)
    assert np.min(x[lateral._idx["Fp1"]] * x[lateral._idx["Fp2"]]) < 0
    ecg = Synthesizer(_spec(events=[_artifact("ecg")]), 600.0)._artifact_block(t, 120 * FS)
    pulse = Synthesizer(_spec(events=[_artifact("pulse")]), 600.0)._artifact_block(t, 120 * FS)
    assert not np.array_equal(ecg, pulse)


def test_complete_blockade_rejects_contradictory_active_motion_artifacts():
    with pytest.raises(SpecError, match="conflicts with active movement"):
        _spec(events=[_artifact("glossokinetic")], neuromuscular_blockade="complete")


def test_event_type_and_kind_contract_is_explicit():
    with pytest.raises(SpecError, match="normal_variant kind"):
        _spec(events=[{"type": "normal_variant", "kind": "ecg", "at_min": 1.0}])
    with pytest.raises(SpecError, match="artifact kind"):
        _spec(events=[{"type": "artifact", "kind": "mu", "at_min": 1.0}])


def test_eye_controls_require_matching_context_and_actual_state():
    wrong_context = Synthesizer(_spec(events=[_artifact("slow_roving_eye", context="awake")]), 600.0)
    assert not wrong_context.artifacts
    wrong_state = Synthesizer(_spec(events=[_artifact("slow_roving_eye", context="drowsy")]), 600.0)
    assert not wrong_state.artifacts
    nrem_only = Synthesizer(_spec(events=[
        {"type": "state_change", "at_min": 1.0, "to": "sleep"},
        _artifact("rem_eye_movements", context="rem"),
    ]), 600.0)
    assert not nrem_only.artifacts
    explicit_rem = Synthesizer(_spec(events=[
        {"type": "state_change", "at_min": 1.0, "to": "rem"},
        _artifact("rem_eye_movements", context="rem"),
    ]), 600.0)
    assert explicit_rem.artifacts
