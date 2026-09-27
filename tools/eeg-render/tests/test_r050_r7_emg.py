"""r7-fix (feature review B5-01, 2026-09-27): the scalp muscle floor does not scale with a child background voltage.

The muscle floor is mixed in background-RMS units before ``x *= amp_rms``, so the r7 90-uV child background (and child
pages authored above the 45-uV default) drew the temporalis EMG 2-2.25x (B5-01: F7-T3 EMG 46 -> 104 uV p-p).  At
spec_version 3 a child background above CHILD_EMG_REF_UV holds the muscle at its voltage on that background; lower
voltages, other ages and earlier spec versions are unchanged.
"""
import copy

import numpy as np
import pytest
import scipy.signal as sps

from eeg_render import synth as SY
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer

FS = 256
BG = dict(type="continuous", dominant_hz=9.0, slow_fraction=0.4, reactivity="present", channel_gain_max=1.5)


def _syn(amp=None, version=3, age="child", seed=517601):
    bg = copy.deepcopy(BG)
    if amp is not None:
        bg["amplitude_uv"] = amp
    spec = {"sample_rate": FS, "channels": "standard_19", "seed": seed, "spec_version": version, "age_group": age,
            "duration_min": 30, "background": bg, "events": []}
    spec = normalize({"kind": "qeeg_panel", "license": "synthetic-original", "attribution": None, "spec": spec})["spec"]
    return Synthesizer(spec, 1800.0)


def _emg_rms(syn, monkeypatch, t0=60.0, t1=300.0):
    """RMS above 20 Hz of the muscle contribution on F7-T3: the record minus the same record without the floor."""
    _, x = syn.segment(t0, t1)
    with monkeypatch.context() as m:
        m.setattr(SY, "EMG_FLOOR_W", 0.0)
        _, x0 = syn.segment(t0, t1)
    d = (x - x0)[syn._idx["F7"]] - (x - x0)[syn._idx["T3"]]
    return float(np.std(sps.sosfiltfilt(sps.butter(4, 20.0, "highpass", fs=FS, output="sos"), d)))


def test_child_default_90uv_keeps_the_45uv_muscle(monkeypatch):
    lo, hi = _syn(45.0), _syn(None)
    assert hi.bg["amplitude_uv"] == 90.0 and hi.emg_uv_scale == pytest.approx(0.5)
    r = _emg_rms(hi, monkeypatch) / _emg_rms(lo, monkeypatch)
    assert 0.85 < r < 1.15, r          # was 2.0 at r7


def test_authored_child_voltage_above_default_keeps_the_muscle(monkeypatch):
    r = _emg_rms(_syn(90.0), monkeypatch) / _emg_rms(_syn(40.0), monkeypatch)
    assert 1.0 < r < 1.3, r            # 45 / 40 = 1.125 (was 2.25)


@pytest.mark.parametrize("amp,version,age", [(40.0, 3, "child"), (90.0, 2, "child"), (90.0, 3, "adult")])
def test_unchanged_below_default_other_versions_and_ages(amp, version, age):
    assert _syn(amp, version, age).emg_uv_scale == 1.0
