"""0.5.3 (Craig 2026-09-30, gallery review): regional focal slowing and a visible neonatal midazolam effect.

- background.asymmetry.region confines the attenuation and polymorphic delta to a region (spec_version 3 only);
- neonatal midazolam lowers the voltage to about half at full level and damps the sleep-wake cycle.
"""
import numpy as np
import pytest
import scipy.signal as sps

from eeg_render import montage as mt
from eeg_render.render_page import apply_filters, build_filters
from eeg_render.spec import SpecError, normalize
from eeg_render.synth import Synthesizer

FILT = {"lf_hz": 1.0, "hf_hz": 70.0, "notch_hz": 60.0}


def _spec(bg, events=(), age="child", version=3, seed=5301, dur=30, **extra):
    img = {"kind": "qeeg_panel", "license": "synthetic-original", "attribution": None,
           "spec": {"sample_rate": 256, "channels": "standard_19", "seed": seed, "spec_version": version,
                    "age_group": age, "duration_min": dur, "background": bg, "events": list(events), **extra}}
    return normalize(img)["spec"]


def _delta(syn, t0, t1):
    t, x = syn.segment(t0 - 5.0, t1)
    pairs = mt.montage_pairs("longitudinal_bipolar", syn.scalp)
    sig = apply_filters(syn.derive(x, pairs), build_filters(syn.fs, FILT, True), True)[:, t >= t0]
    names = [f"{a}-{b}" for a, b in pairs]
    sos = sps.butter(4, [1.0, 3.5], "bandpass", fs=syn.fs, output="sos")
    return {n: float(np.sqrt(np.mean(sps.sosfiltfilt(sos, s) ** 2))) for n, s in zip(names, sig)}


CHILD = dict(type="continuous", amplitude_uv=40.0, dominant_hz=9.0, slow_fraction=0.3, reactivity="present",
             blink_rate_per_min=0, channel_gain_max=1.5)


def test_regional_slowing_stays_in_the_region():
    """Left temporal polymorphic delta: the left temporal chain carries it (>= 1.8x its right homologue) while the
    left parasagittal chain stays within 1.35x of the right one (hemispheric slowing moves both)."""
    bg = dict(CHILD, asymmetry={"side": "left", "attenuation_pct": 0, "slowing_hz": 3.0, "region": "left_temporal"})
    d = _delta(Synthesizer(_spec(bg), 1800.0), 600.0, 660.0)
    temporal = (d["F7-T3"] + d["T3-T5"]) / (d["F8-T4"] + d["T4-T6"])
    parasag = (d["F3-C3"] + d["C3-P3"]) / (d["F4-C4"] + d["C4-P4"])
    assert temporal >= 1.8, d
    assert parasag <= 1.35, d


def test_regional_slowing_accepts_an_electrode_list_and_needs_spec_version_3():
    bg = dict(CHILD, asymmetry={"side": "right", "slowing_hz": 3.0, "region": ["F8", "T4"]})
    assert _spec(bg)["background"]["asymmetry"]["region"] == ["F8", "T4"]
    with pytest.raises(SpecError):
        _spec(dict(CHILD, asymmetry={"side": "right", "slowing_hz": 3.0, "region": ["F8", "Q9"]}))
    with pytest.raises(SpecError):
        _spec(dict(CHILD, asymmetry={"side": "right", "slowing_hz": 3.0, "region": "right_temporal"}), version=2)


def test_neonatal_midazolam_halves_the_voltage_and_damps_cycling():
    """Level 1.0 neonatal midazolam: page RMS <= 0.65x the untreated record (was ~0.7x at the amplitude only, lost in
    the ~1.45x quiet-sleep swing) and the sleep-wake cycle's depth factor falls to 0.4."""
    bg = dict(type="continuous", pma_weeks=40, amplitude_uv=25.0, dominant_hz=2.5, slow_fraction=0.6,
              reactivity="present", channel_gain_max=1.5)
    base = Synthesizer(_spec(bg, age="neonate", seed=5311, dur=60), 3600.0)
    sed = Synthesizer(_spec(bg, age="neonate", seed=5311, dur=60, sedation={"agent": "midazolam", "level": 1.0}),
                      3600.0)
    rms = []
    for syn in (base, sed):
        _t, x = syn.segment(1200.0, 1260.0)
        rms.append(float(np.sqrt(np.mean(x[:19] ** 2))))
    assert rms[1] <= 0.65 * rms[0], rms
    tt = np.array([1200.0])
    assert sed._sed_v3_at("swc", tt, 1.0)[0] == pytest.approx(0.4)
    assert base._sed_v3_at("swc", tt, 1.0)[0] == pytest.approx(1.0)
