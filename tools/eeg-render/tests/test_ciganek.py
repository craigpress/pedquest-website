import numpy as np
import pytest
from scipy.signal import periodogram

from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer
from eeg_render.variants_v3 import posts_schedule


def synth(context="awake", sleep=False, side="both", seed=30092611):
    events = [{"type": "state_change", "at_min": 1, "to": "sleep"}] if sleep else []
    events.append({"type": "normal_variant", "kind": "midline_theta", "at_min": 1.5,
                   "duration_s": 20, "context": context, "side": side})
    image = {"kind": "eeg_page", "license": "synthetic-original", "attribution": None,
             "spec": {"spec_version": 3, "seed": seed, "age_group": "adult", "sample_rate": 256,
                      "duration_min": 5, "background": {"type": "continuous"}, "events": events}}
    return Synthesizer(normalize(image)["spec"], 300)


@pytest.mark.parametrize("seed", [30092611, 30092612, 30092613])
def test_ciganek_vertex_field_frequency_and_partition(seed):
    s = synth(seed=seed)
    t = np.arange(90 * s.fs, 110 * s.fs) / s.fs
    rows = s._authored_variant_rows(t)
    amp = dict(zip(s.electrodes, np.ptp(rows, axis=1)))
    assert amp["Cz"] > amp["Fz"] > amp["Pz"] > amp["C3"]
    assert amp["C3"] == amp["C4"]
    f, p = periodogram(rows[s.electrodes.index("Cz")], s.fs)
    assert 5.8 < f[np.argmax(p)] < 6.2
    np.testing.assert_array_equal(rows, np.concatenate([s._authored_variant_rows(t[:1500]),
                                                       s._authored_variant_rows(t[1500:])], axis=1))
    keys = s.authored_variant_runs()
    assert keys and all(r["variant"] == "midline_theta" for r in keys)
    assert all(90 <= r["t0"] < r["t1"] <= 110 for r in keys)
    whole = s.segment(90, 110)[1]
    chunks = np.concatenate([s.segment(90, 100)[1], s.segment(100, 110)[1]], axis=1)
    np.testing.assert_allclose(whole, chunks, atol=1e-9, rtol=0)


def test_ciganek_context_and_side_gates():
    assert synth(context="drowsy", sleep=True).authored_variant_runs()
    assert not synth(context="drowsy").authored_variant_runs()
    assert not synth(context="light_sleep", sleep=True).authored_variant_runs()
    assert not synth(side="left").authored_variant_runs()


def test_posts_opt_in_spacing_preserves_original_default():
    old = posts_schedule(29268205, [(600, 1800)], 70)
    explicit = posts_schedule(29268205, [(600, 1800)], 70, 0.5)
    assert old == explicit
    sparse = posts_schedule(29268205, [(600, 1800)], 70, 1.7)
    gaps = lambda runs: np.concatenate([np.diff(r["times"]) for r in runs])
    assert np.median(gaps(sparse)) > 2 * np.median(gaps(old))
