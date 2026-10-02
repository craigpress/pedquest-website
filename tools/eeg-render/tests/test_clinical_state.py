import numpy as np
import pytest

from eeg_render.spec import normalize, SpecError
from eeg_render.synth import Synthesizer


def make(background=None, events=None, **extra):
    block = {"kind": "qeeg_panel", "license": "synthetic-original", "spec": {
        "spec_version": 3, "age_group": "child", "duration_min": 30, "seed": 991031,
        "sample_rate": 200, "background": {"type": "continuous", **(background or {})},
        "events": events or [], **extra,
    }}
    spec = normalize(block)["spec"]
    return Synthesizer(spec, spec["duration_min"] * 60)


def test_reactivity_does_not_determine_consciousness_or_sleep_architecture():
    syn = make({"reactivity": "absent", "clinical_state": "awake"})
    t = np.array([60., 600.])
    assert list(syn.clinical_state_at(t)) == ["awake", "awake"]
    assert list(syn.stage_at(t)) == ["W", "W"]
    assert np.all(syn._arch_w(t, np.zeros(t.shape)) == 1)


@pytest.mark.parametrize("pattern", ["spindle", "alpha"])
def test_coma_morphology_is_not_natural_nrem_and_can_recover(pattern):
    syn = make({"coma_pattern": pattern, "reactivity": "present"},
               [{"type": "state_change", "at_min": 10, "to": "wake"}])
    t = np.array([120., 599., 600., 900.])
    assert list(syn.clinical_state_at(t)) == ["comatose", "comatose", "awake", "awake"]
    assert list(syn.stage_at(t)) == ["NONE", "NONE", "W", "W"]
    assert syn.stage_intervals(("N1", "N2", "N3")) == []
    assert np.all(syn.stage_rate(t, 10, 5) == 10)
    if pattern == "spindle":
        assert syn._sp_t.size > 0
        assert syn._arch_w(np.array([120.]), np.zeros(1))[0] == 1


def test_anesthetic_n2_surrogate_does_not_activate_sleep_discharge_rates():
    syn = make(events=[{"type": "state_change", "at_min": 1, "to": "sleep"}],
               sedation={"agent": "propofol", "level": .8})
    t = np.array([120., 600., 1200.])
    assert list(syn.stage_at(t)) == ["NONE"] * 3
    assert syn.stage_intervals(("N2", "N3")) == []
    assert np.all(syn.stage_rate(t, 10, 5) == 10)
    assert np.all(syn._arch_w(t, syn._sed_v3_at("loc", t, 0)) == 0)
    assert not syn._arousals_v3


def test_genuine_nrem_with_obscured_architecture_still_activates():
    syn = make({"sleep_architecture": "absent", "reactivity": "absent", "clinical_state": "asleep"})
    t = np.array([600., 1200.])
    assert list(syn.stage_at(t)) == ["N2", "N2"]
    assert np.all(syn.stage_rate(t, 10, 5) == 50)
    assert np.all(syn._arch_w(t, np.zeros(t.shape)) == 0)


def test_authored_arousal_does_not_invent_preceding_sleep():
    syn = make(events=[{"type": "state_change", "at_min": 5, "to": "arousal"}])
    assert list(syn.stage_at(np.array([120., 299.]))) == ["W", "W"]
    assert syn.stage_intervals(("N1", "N2", "N3")) == []


def test_timed_clinical_state_clips_activation_at_boundary():
    syn = make({"clinical_state": "asleep", "sleep_staging": "static"},
               [{"type": "state_change", "at_min": 10, "to": "sedated"}])
    t = np.array([590., 599.999, 600., 600.001, 620.])
    rates = syn.stage_rate(t, 10, 5)
    assert np.all(rates[t >= 600] == 10)
    intervals = syn.stage_intervals(("N2",))
    assert intervals[0][0] == 0 and intervals[-1][1] == 600
    assert all(b <= 600 for a, b in intervals)
    assert syn.clinical_state_intervals(("sedated",)) == [(600., 1800.)]


def test_neonatal_unknown_state_is_not_awake_or_adult_nrem():
    syn = make(age_group="neonate")
    t = np.array([120., 600.])
    assert list(syn.clinical_state_at(t)) == ["indeterminate", "indeterminate"]
    assert list(syn.stage_at(t)) == ["", ""]
    assert not syn.natural_sleep_eligible(t).any()
    assert not syn._neo_emg_v3(t).any()
    awake = make({"clinical_state": "awake"}, age_group="neonate")
    assert list(awake.clinical_state_at(t)) == ["awake", "awake"]
    assert list(awake.stage_at(t)) == ["", ""]
    assert np.all(awake._neo_emg_v3(t) == .6)
    cycling = make({"state_cycle": "term", "pma_weeks": 40}, age_group="neonate", duration_min=120)
    a, b, _ = next(iv for iv in cycling._state_intervals if iv[2] == "indeterminate")
    sample = np.array([(a + b) / 2])
    assert cycling.clinical_state_at(sample)[0] == "indeterminate"
    assert cycling._neo_emg_v3(sample)[0] == 0


def test_new_clinical_controls_require_v3():
    for spec in [{"background": {"type": "continuous", "clinical_state": "asleep"}},
                 {"events": [{"type": "state_change", "at_min": 1, "to": "comatose"}]}]:
        with pytest.raises(SpecError, match="spec_version 3"):
            make(spec_version=2, **spec)


def test_coma_recovery_can_restore_natural_sleep_without_erasing_reactivity():
    syn = make({"clinical_state": "comatose", "reactivity": "present"}, [
        {"type": "state_change", "at_min": 5, "to": "wake"},
        {"type": "state_change", "at_min": 10, "to": "sleep"},
    ])
    t = np.array([120., 400., 1200.])
    assert list(syn.clinical_state_at(t))[:2] == ["comatose", "awake"]
    assert syn.stage_at(t)[0] == "NONE" and syn.stage_at(t)[1] == "W"
    assert syn.stage_at(t)[2] in ("N1", "N2", "N3", "R")
    assert list(syn._arch_w(t, np.zeros(t.shape)))[:2] == [0, 1]
    assert syn._arch_w(t, np.zeros(t.shape))[2] == 1
    assert syn.bg["reactivity"] == "present"


def test_awake_eye_behavior_is_independent_of_cerebral_reactivity():
    present = make({"clinical_state": "awake", "reactivity": "present"})
    absent = make({"clinical_state": "awake", "reactivity": "absent"})
    assert present.bg["blink_rate_per_min"] == absent.bg["blink_rate_per_min"] == 15
    assert present._eyes == absent._eyes
    np.testing.assert_array_equal(present.segment(60, 90)[1], absent.segment(60, 90)[1])


def test_coma_eye_timeline_recovers_after_authored_wake():
    syn = make({"coma_pattern": "spindle", "reactivity": "absent"},
               [{"type": "state_change", "at_min": 5, "to": "wake"}])
    assert syn.bg["blink_rate_per_min"] == 15
    t = np.array([120., 400.])
    assert list(syn.natural_sleep_eligible(t)) == [False, True]
    assert syn._eyes


def test_unreactive_unspecified_behavior_remains_indeterminate_until_authored_wake():
    syn = make({"reactivity": "absent"}, [{"type": "state_change", "at_min": 5, "to": "wake"}])
    t = np.array([120., 299., 300., 600.])
    assert list(syn.clinical_state_at(t)) == ["indeterminate", "indeterminate", "awake", "awake"]
    assert list(syn.stage_at(t)) == ["NONE", "NONE", "W", "W"]
    assert list(syn.natural_sleep_eligible(t)) == [False, False, True, True]
    assert syn.bg["reactivity"] == "absent"


@pytest.mark.parametrize("state", ["comatose", "sedated"])
def test_realized_sporadic_rates_return_to_baseline_across_clinical_gap(state):
    event = {"type": "sporadic_discharges", "focus": "right_centrotemporal",
             "rate_per_h": 60, "amplitude_uv": 120, "sleep_activation": 6}
    background = {"clinical_state": "asleep", "sleep_staging": "static"}
    def record(target):
        return make(background, [event,
                    {"type": "state_change", "at_min": 30, "to": target},
                    {"type": "state_change", "at_min": 60, "to": "wake"}], duration_min=90)
    syn = record(state)
    awake = record("wake")
    t = np.array([1800., 1800.001, 2400., 3599.999])
    assert list(syn.clinical_state_at(t)) == [state] * len(t)
    np.testing.assert_array_equal(syn.stage_rate(t, 60, 6), np.full(t.shape, 60))
    def discharges(record):
        return [(r["t0"], r["width"], r["amplitude_uv"]) for r in record.sporadic_events()
                if 1860 <= r["t0"] < 3540]
    assert discharges(syn) == discharges(awake)
    assert 10 <= len(discharges(syn)) <= 50
    sleeping = sum(60 <= r["t0"] < 1740 for r in syn.sporadic_events())
    assert sleeping > 4 * len(discharges(syn))
