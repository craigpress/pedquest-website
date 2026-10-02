import numpy as np
import pytest

from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer


def make(state="awake", reactivity="present", background="continuous"):
    image = {"kind": "eeg_page", "license": "synthetic-original", "attribution": None,
             "spec": {"spec_version": 3, "seed": 30100123, "age_group": "adult", "duration_min": 4,
                      "background": {"type": background, "clinical_state": state,
                                     "amplitude_uv": 40, "reactivity": reactivity, "blink_rate_per_min": 0},
                      "events": []}}
    return Synthesizer(normalize(image)["spec"], 240)


def muscle(syn, start=60, end=100):
    t = np.arange(int(start * syn.fs), int(end * syn.fs)) / syn.fs
    return syn._tonic_muscle_rows_v3(t, int(start * syn.fs), t.size,
                                   np.ones(t.size), np.full(t.size, 37), np.ones(t.size), None)


@pytest.mark.parametrize("reactivity", ["present", "absent"])
def test_nonmyoclonic_burst_suppression_has_no_tonic_muscle(reactivity):
    syn = make(reactivity=reactivity, background="burst_suppression")
    assert np.count_nonzero(muscle(syn)) == 0
    assert np.max(np.abs(syn.segment(60, 100)[1])) > 10


def test_awake_muscle_does_not_use_cerebral_reactivity_or_gain():
    present, absent = make(), make(reactivity="absent")
    np.testing.assert_array_equal(muscle(present), muscle(absent))
    before = muscle(present)
    present.amp_rms *= 10
    present.gain_asym *= 0.1
    np.testing.assert_array_equal(before, muscle(present))
    assert np.std(before[present._idx["T3"]]) > 0.5


def test_coma_and_blockade_silence_tonic_muscle():
    assert np.count_nonzero(muscle(make("comatose"))) == 0
    syn = make()
    syn.spec["neuromuscular_blockade"] = "complete"
    assert np.count_nonzero(muscle(syn)) == 0


def test_tonic_muscle_partition_independence():
    syn = make()
    full = muscle(syn)
    parts = np.concatenate([muscle(syn, 60, 72.3125), muscle(syn, 72.3125, 100)], axis=1)
    np.testing.assert_array_equal(full, parts)
