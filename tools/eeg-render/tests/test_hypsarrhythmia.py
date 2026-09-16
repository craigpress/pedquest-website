import numpy as np

from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer


def _synth(seed: int = 910022) -> Synthesizer:
    image = {
        "kind": "eeg_page", "license": "synthetic-original",
        "spec": {
            "seed": seed, "sample_rate": 256, "channels": "standard_19",
            "age_group": "infant", "background": {"type": "hypsarrhythmia"},
        },
    }
    return Synthesizer(normalize(image)["spec"], 240.0)


def test_default_hypsarrhythmia_has_discrete_multifocal_discharges():
    synth = _synth()
    events = synth._mf_spikes
    page = events[(events[:, 0] >= 120.0) & (events[:, 0] < 135.0)]
    assert 20 <= len(page) <= 30
    assert len(np.unique(page[:, 1])) >= 5


def test_multifocal_complex_uses_requested_peak_to_peak_amplitude():
    synth = _synth()
    event = synth._mf_spikes[10]
    t = np.arange(event[0], event[0] + 1.2, 1 / synth.fs)
    rows = synth._multifocal_spike_rows(t)
    focus = int(event[1])
    assert np.ptp(rows[focus]) >= event[3] * 0.95
    assert np.ptp(rows[focus]) <= event[3] * 1.05
