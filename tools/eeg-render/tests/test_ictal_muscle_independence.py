"""Authored focal motor activity survives replacement of the tonic muscle carrier."""
import copy

import numpy as np
import pytest
import scipy.signal as sps

from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer

FS = 256


def _image(age, muscle, background="continuous"):
    return {"kind": "eeg_page", "license": "synthetic-original", "spec": {
        "spec_version": 3, "sample_rate": FS, "channels": "standard_19", "seed": 517403,
        "age_group": age, "duration_min": 15, "at_min": 10, "window_s": 15,
        "background": {"type": background, "amplitude_uv": 40, "dominant_hz": 9,
                       "slow_fraction": .4, "reactivity": "present", "channel_gain_max": 1.5,
                       "blink_rate_per_min": 0, "clinical_state": "awake"},
        "events": [{"type": "seizure", "onset_min": 10, "duration_s": 70,
                    "onset_region": "left_frontal", "spread": "none", "muscle": muscle,
                    "clinical_correlate": "focal_clonic",
                    "evolution": {"start_hz": 6, "end_hz": 2.5,
                                  "amplitude_start_uv": 60, "amplitude_end_uv": 160}}],
    }}


@pytest.mark.parametrize("age", ["child", "adult"])
def test_authored_clonic_motor_survives_a_zero_tonic_carrier(age):
    motor = Synthesizer(normalize(_image(age, "modest"))["spec"], 900)
    quiet = Synthesizer(normalize(_image(age, "none"))["spec"], 900)
    for syn in (motor, quiet):
        syn._tonic_muscle_rows_v3 = lambda t, i0, n, *args: np.zeros((syn.n_elec, n))
    t, x = motor.segment(590, 685)
    _, y = quiet.segment(590, 685)
    delta = x - y
    np.testing.assert_array_equal(delta[:, t < 600], 0)
    np.testing.assert_array_equal(delta[:, t >= 670], 0)
    assert np.max(np.abs(delta)) > 20
    d = motor.derive(delta, [("F7", "T3")])[0]
    carrier = sps.sosfiltfilt(sps.butter(4, [30, 70], btype="bandpass", fs=FS, output="sos"), d)
    envelope = np.abs(sps.hilbert(carrier))
    n = (envelope.size // 13) * 13
    b = envelope[:n].reshape(-1, 13).mean(1)
    tb = 590 + (np.arange(b.size) + .5) * 13 / FS
    mask = (tb > 600 + .75 * 70) & (tb < 600 + .97 * 70)
    _, _, _, hz, phase = motor._recruit_breakpoints(motor.seizures[0])
    pulse = (.5 + .5 * np.cos(2 * np.pi * hz * (tb[mask] - 600) + phase)) ** 4
    f, power = sps.periodogram(b[mask] - b[mask].mean(), FS / 13)
    band = (f > .8) & (f < 4)
    assert abs(f[band][np.argmax(power[band])] - hz) <= .2
    assert np.corrcoef(b[mask], pulse)[0, 1] >= .6
    assert np.percentile(b[mask], 90) / np.percentile(b[mask], 10) >= 3
    _, chunk = motor.segment(651.25, 662.5)
    i0 = int((651.25 - 590) * FS)
    np.testing.assert_allclose(x[:, i0:i0 + chunk.shape[1]], chunk, rtol=0, atol=1e-9)


def test_nonmyoclonic_burst_suppression_reads_no_tonic_or_legacy_motor_carrier():
    image = copy.deepcopy(_image("adult", "none", "burst_suppression"))
    image["spec"]["background"].update(reactivity="absent", clinical_state="comatose")
    image["spec"]["events"] = []
    syn = Synthesizer(normalize(image)["spec"], 900)
    original = syn._stream_signal

    def reject_muscle(stream, *args):
        assert stream is not syn.st_muscle
        return original(stream, *args)

    syn._stream_signal = reject_muscle
    t, x = syn.segment(240, 270)
    np.testing.assert_array_equal(syn.ictal_gate(t), 0)
    zeros = syn._tonic_muscle_rows_v3(t, int(t[0] * FS), t.size, np.ones(t.size),
                                      np.full(t.size, 36.5), np.ones(t.size), None)
    np.testing.assert_array_equal(zeros, 0)
    assert np.isfinite(x).all() and np.max(np.abs(x)) > 1
