"""0.5.0 (spec_version 3): the page display filter is a causal single-pole high-pass, like a review station."""
import numpy as np

from eeg_render.render_page import apply_filters, build_filters, causal_filters, filter_warmup_s

FS = 256


def _run(x, filters, causal):
    return apply_filters(x[None, :], build_filters(FS, filters, causal), causal)[0]


def test_version_gate():
    assert not causal_filters({"spec_version": 2})
    assert not causal_filters({})
    assert causal_filters({"spec_version": 3})


def test_causal_chain_has_no_pre_event_ringing():
    t = np.arange(0, 20, 1 / FS)
    blink = np.where((t > 10) & (t < 10.4), np.sin(np.pi * (t - 10) / 0.4), 0.0) * 100.0
    f = {"lf_hz": 1.0, "hf_hz": 70.0, "notch_hz": None}
    causal = _run(blink, f, True)
    zero_phase = _run(blink, f, False)
    before = (t > 9.5) & (t < 10.0)
    assert np.abs(causal[before]).max() < 1e-6
    assert zero_phase[before].min() < -5.0          # the v1/v2 artefact this release removes


def test_single_pole_gain_on_slow_waves():
    t = np.arange(0, 60, 1 / FS)
    f = {"lf_hz": 1.0, "hf_hz": None, "notch_hz": None}
    for hz in (0.25, 0.4):
        y = _run(np.sin(2 * np.pi * hz * t), f, True)
        gain = np.sqrt(2) * y[t > 20].std()
        expected = (hz / 1.0) / np.sqrt(1 + (hz / 1.0) ** 2)
        assert abs(gain - expected) < 0.02, (hz, gain, expected)


def test_warmup_covers_eight_time_constants():
    assert filter_warmup_s({"lf_hz": 1.0}) == 4.0
    assert abs(filter_warmup_s({"lf_hz": 0.1}) - 8 / (2 * np.pi * 0.1)) < 1e-9
    assert filter_warmup_s({}) == 4.0
