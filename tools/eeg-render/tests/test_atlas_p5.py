"""EEG Atlas P5 (0.3.11): additive controls stay opt-in and legacy specs keep their hash.

Every new control passes through only when supplied, so a spec that does not
mention it normalizes to the same dict (and therefore the same spec_hash and
the same samples) as under 0.3.10.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

RENDERER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RENDERER))

from eeg_render.export.manifest import realized_events
from eeg_render.spec import SpecError, normalize, spec_hash, spec_warnings, validate_image
from eeg_render.synth import Synthesizer
from eeg_render import montage as mt

FS = 256


def _image(spec):
    # spec_version 1: these tests pin the 0.3.x defaults (0.4.0 gives an unversioned spec new ones)
    base = {"seed": 4242, "spec_version": 1, "age_group": "child", "sample_rate": FS, "channels": "standard_19",
            "duration_min": 30, "background": {"type": "continuous", "dominant_hz": 9.0,
                                                "amplitude_uv": 40, "slow_fraction": 0.4}, "events": []}
    base.update(spec)
    return {"kind": "qeeg_panel", "license": "synthetic-original", "spec": base}


def _p2p_rows(y, fs, win_s=1.0):
    n = int(win_s * fs); m = y.shape[1] // n
    w = y[:, : m * n].reshape(y.shape[0], m, n)
    return w.max(axis=2) - w.min(axis=2)


# ---------------------------------------------------------------- hashes --
def test_new_controls_do_not_enter_a_spec_that_omits_them():
    norm = normalize(_image({}))["spec"]
    for key in ("blink_rate_per_min", "pdr_gain"):
        assert key not in norm["background"]
    norm2 = normalize(_image({"events": [{"type": "rhythmic_pattern", "pattern": "LRDA", "frequency_hz": 1.5,
                                           "amplitude_uv": 60, "run_duration_s": 60, "onset_min": 5}]}))["spec"]
    assert "min_cycles" not in norm2["events"][0]


def test_omitted_controls_synthesize_identically_to_explicit_defaults():
    a = Synthesizer(normalize(_image({}))["spec"], 600.0)
    b_img = _image({}); b_img["spec"]["background"]["pdr_gain"] = 1.0
    b = Synthesizer(normalize(b_img)["spec"], 600.0)
    _, xa = a.segment(100.0, 130.0); _, xb = b.segment(100.0, 130.0)
    assert np.array_equal(xa, xb)


# ------------------------------------------------------------------ adult --
def test_adult_age_group_validates_and_synthesizes():
    img = _image({"age_group": "adult"})
    assert validate_image(img) == []
    norm = normalize(img)["spec"]
    assert norm["age_group"] == "adult"
    syn = Synthesizer(norm, 300.0)
    _, x = syn.segment(0.0, 10.0)
    assert x.shape == (21, 10 * FS) and np.isfinite(x).all()
    assert any("adult" in w for w in spec_warnings(normalize(img)))


def test_adult_defaults_apply_when_background_omitted():
    img = _image({"age_group": "adult"}); del img["spec"]["background"]
    bg = normalize(img)["spec"]["background"]
    assert bg["dominant_hz"] == 10.0 and bg["type"] == "continuous"


# -------------------------------------------------------------- reactivity --
@pytest.mark.parametrize("value", ["unknown", "unclear"])
def test_reactivity_unknown_and_unclear_are_accepted_and_advised(value):
    img = _image({"background": {"type": "continuous", "dominant_hz": 9.0, "amplitude_uv": 40,
                                 "slow_fraction": 0.4, "reactivity": value}})
    assert validate_image(img) == []
    assert any("reactivity" in w for w in spec_warnings(normalize(img)))


# -------------------------------------------------------------------- brd --
def test_brd_is_realized_as_its_own_kind_with_advisory():
    img = _image({"age_group": "neonate",
                  "background": {"type": "continuous", "pma_weeks": 39, "amplitude_uv": 40,
                                 "dominant_hz": 2.0, "slow_fraction": 0.8},
                  "events": [{"type": "brd", "onset_min": 5.0, "duration_s": 6.0, "onset_region": "left_central",
                              "evolution": {"start_hz": 2.5, "end_hz": 1.8, "amplitude_start_uv": 40, "amplitude_end_uv": 80}}]})
    assert validate_image(img) == []
    syn = Synthesizer(normalize(img)["spec"], 900.0)
    ev = [e for e in realized_events(syn, 900.0) if e["kind"] == "brd"]
    assert len(ev) == 1
    assert ev[0]["onset_s"] == 300.0 and abs(ev[0]["offset_s"] - 306.0) < 1e-6
    assert "brief rhythmic discharge" in ev[0]["acns_advisory"]
    # the run is audible on the signal: left-central power rises against the preceding background
    pairs = mt.montage_pairs("longitudinal_bipolar", syn.scalp)
    _, x_pre = syn.segment(290.0, 296.0); _, x_ev = syn.segment(300.0, 306.0)
    r = [i for i, p in enumerate(pairs) if p == ("C3", "P3")][0]
    pre = syn.derive(x_pre, pairs)[r]; run = syn.derive(x_ev, pairs)[r]
    assert run.std() > 1.5 * pre.std()


def test_short_neonatal_seizure_is_accepted_but_advised_in_manifest():
    img = _image({"age_group": "neonate",
                  "background": {"type": "continuous", "pma_weeks": 39, "amplitude_uv": 40,
                                 "dominant_hz": 2.0, "slow_fraction": 0.8},
                  "events": [{"type": "seizure", "onset_min": 5.0, "duration_s": 7.0,
                              "onset_region": "left_central", "spread": "none"}]})
    assert validate_image(img) == []
    assert any("10-s" in w for w in spec_warnings(normalize(img)))
    syn = Synthesizer(normalize(img)["spec"], 900.0)
    ev = [e for e in realized_events(syn, 900.0) if e["kind"] == "seizure"][0]
    assert "10-s" in ev["acns_advisory"]


# ------------------------------------------------------------------- blinks --
def test_blink_rate_zero_removes_frontal_transients_in_a_suppressed_record():
    def build(extra):
        bg = {"type": "suppressed", "dominant_hz": 3.0, "amplitude_uv": 8, "slow_fraction": 0.7, "reactivity": "absent"}
        bg.update(extra)
        return Synthesizer(normalize(_image({"age_group": "adolescent", "background": bg}))["spec"], 900.0)
    with_blinks, without = build({}), build({"blink_rate_per_min": 0})
    pairs = mt.montage_pairs("longitudinal_bipolar", with_blinks.scalp)
    r = pairs.index(("Fp1", "F7"))
    _, xa = with_blinks.segment(60.0, 360.0); _, xb = without.segment(60.0, 360.0)
    pa = _p2p_rows(with_blinks.derive(xa, pairs)[r:r + 1], FS)[0]
    pb = _p2p_rows(without.derive(xb, pairs)[r:r + 1], FS)[0]
    assert (pa > 25).mean() > 0.1, "0.3.10 default: blinks push Fp1-F7 over 25 uV in >10% of seconds"
    assert (pb > 25).mean() == 0.0
    assert any("blink" in w for w in spec_warnings(normalize(_image({"age_group": "adolescent", "background": {
        "type": "suppressed", "dominant_hz": 3.0, "amplitude_uv": 8, "slow_fraction": 0.7, "reactivity": "absent"}}))))


# --------------------------------------------------------------------- pdr --
def test_pdr_gain_moves_the_spectral_peak_to_the_requested_dominant_hz():
    from scipy.signal import welch
    def peak_and_alpha(gain):
        bg = {"type": "continuous", "dominant_hz": 9.0, "amplitude_uv": 40, "slow_fraction": 0.4}
        if gain is not None:
            bg["pdr_gain"] = gain
        syn = Synthesizer(normalize(_image({"background": bg}))["spec"], 900.0)
        pairs = mt.montage_pairs("longitudinal_bipolar", syn.scalp)
        _, x = syn.segment(60.0, 360.0)
        y = syn.derive(x, pairs)
        post = [i for i, p in enumerate(pairs) if p[1] in ("O1", "O2")]
        f, P = welch(y[post], fs=FS, nperseg=4 * FS, axis=-1)
        m = (f >= 0.5) & (f <= 30); f, P = f[m], P[:, m].mean(axis=0)
        alpha = P[(f >= 8) & (f <= 13)].sum() / P.sum()
        return float(f[np.argmax(P)]), float(alpha)
    peak0, alpha0 = peak_and_alpha(None)
    peak3, alpha3 = peak_and_alpha(3.0)
    assert peak0 < 4.0, "0.3.10 baseline: the peak sits in the delta band"
    assert alpha3 > 2 * alpha0
    assert 7.5 <= peak3 <= 10.5


# ------------------------------------------------------------ channel gain --
def test_channel_gain_max_tames_the_hot_seed_and_leaves_others_alone():
    def neo_p2p(seed, extra):
        bg = {"type": "continuous", "pma_weeks": 39, "amplitude_uv": 40, "dominant_hz": 2.0, "slow_fraction": 0.8}
        bg.update(extra)
        syn = Synthesizer(normalize(_image({"seed": seed, "age_group": "neonate", "background": bg}))["spec"], 1800.0)
        pairs = [("F4", "C4"), ("C4", "O2"), ("F3", "C3"), ("C3", "O1"), ("T4", "C4"), ("C4", "Cz"), ("Cz", "C3"), ("C3", "T3")]
        _, x = syn.segment(60.0, 360.0)
        return float(np.median(_p2p_rows(syn.derive(x, pairs), FS))), syn
    hot, syn_hot = neo_p2p(515302, {})
    capped, syn_cap = neo_p2p(515302, {"channel_gain_max": 2.0})
    assert hot > 100, "0.3.10 default: this seed lands the neonatal electrodes in the gain tail"
    assert capped < 0.5 * hot
    assert float(syn_cap._ch_gain[[syn_cap._idx[e] for e in syn_cap.scalp]].max()) <= 2.0 + 1e-9
    ordinary, _ = neo_p2p(515301, {})
    ordinary_capped, _ = neo_p2p(515301, {"channel_gain_max": 2.0})
    assert abs(ordinary_capped - ordinary) / ordinary < 0.35
    assert "channel_gain_max" not in normalize(_image({}))["spec"]["background"]


# --------------------------------------------------------------------- rpp --
def test_min_cycles_guarantees_six_cycles_per_run():
    def runs(extra):
        ev = {"type": "rhythmic_pattern", "pattern": "LPD", "periodic": True, "frequency_hz": 1.0,
              "amplitude_uv": 120, "run_duration_s": 6, "onset_min": 5.0, "duration_min": 3.0,
              "onset_region": "left_temporal"}
        ev.update(extra)
        syn = Synthesizer(normalize(_image({"age_group": "adolescent", "events": [ev]}))["spec"], 900.0)
        return [e["offset_s"] - e["onset_s"] for e in realized_events(syn, 900.0) if e["kind"] == "rhythmic_pattern"]
    free, floored = runs({}), runs({"min_cycles": 6})
    assert len(free) >= 5 and min(free) < 6.0, "0.3.10: run_duration_s is a mean with spread"
    assert min(floored) >= 6.0 - 1e-9
    assert any("six cycles" in w for w in spec_warnings(normalize(_image({"age_group": "adolescent", "events": [{
        "type": "rhythmic_pattern", "pattern": "LPD", "periodic": True, "frequency_hz": 0.5, "amplitude_uv": 120,
        "run_duration_s": 4, "onset_min": 5.0, "duration_min": 1.0}]}))))


def test_rpp_advisories_for_frequency_and_pattern_vocabulary():
    w = spec_warnings(normalize(_image({"age_group": "adolescent", "events": [{
        "type": "rhythmic_pattern", "pattern": "XYZ", "periodic": True, "frequency_hz": 30.0, "amplitude_uv": 100,
        "run_duration_s": 60, "onset_min": 5.0}]})))
    assert any("outside the ACNS" in s for s in w) and any("not an ACNS main term" in s for s in w)
    assert spec_warnings(normalize(_image({"age_group": "adolescent", "events": [{
        "type": "rhythmic_pattern", "pattern": "LRDA", "periodic": False, "frequency_hz": 1.5, "amplitude_uv": 60,
        "run_duration_s": 60, "onset_min": 5.0}]}))) == []
