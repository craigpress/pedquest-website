import numpy as np

from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer


def test_neural_focal_attenuation_preserves_existing_muscle_floor():
    image = {"kind": "eeg_page", "license": "synthetic-original", "attribution": None,
             "spec": {"spec_version": 3, "seed": 30092631, "age_group": "child", "duration_min": 5,
                      "background": {"type": "continuous", "amplitude_uv": 45, "blink_rate_per_min": 0},
                      "events": [{"type": "seizure", "onset_min": 2, "duration_s": 40,
                                  "onset_region": "left_frontal", "onset_pattern": "electrodecrement",
                                  "muscle": "none", "spread": "none"}]}}
    syn = Synthesizer(normalize(image)["spec"], 300)
    original_muscle = syn._tonic_muscle_rows_v3
    original_attenuation = syn.postictal_rows_v3

    def floor(attenuated):
        syn.postictal_rows_v3 = original_attenuation if attenuated else lambda t: np.ones((syn.n_elec, t.size))
        syn._tonic_muscle_rows_v3 = original_muscle
        with_muscle = syn.segment(119, 128)[1]
        syn._tonic_muscle_rows_v3 = lambda t, *args: np.zeros((syn.n_elec, t.size))
        return with_muscle - syn.segment(119, 128)[1]

    attenuated = floor(True)
    unaffected = floor(False)
    assert np.max(np.abs(unaffected)) > 1
    np.testing.assert_allclose(attenuated, unaffected, rtol=0, atol=1e-9)
