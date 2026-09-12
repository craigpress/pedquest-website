"""The EKG row and the baseline advisory.

Both exist because of measured Persyst behaviour, not schema requirements:
a channel not named EKG leaves the heart-rate engine at zero, and a recording
shorter than the MMX baseline window leaves every VsBaseline trend at zero --
in both cases with exit code 0 and no warning.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

RENDERER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RENDERER))

from eeg_render.export import baseline_advisory, ekg_row
from eeg_render.export.channels import BASELINE_WINDOW_S, DEFAULT_EKG_UV
from eeg_render.export.manifest import Recording
from eeg_render.export.persyst import write_lay_dat
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer

FS = 200


def _synth(duration_s, *, age="child", events=None, channels="standard_19"):
    spec = {
        "seed": 31337, "age_group": age, "sample_rate": FS, "channels": channels,
        "duration_min": 30,
        "background": {"type": "continuous", "dominant_hz": 7.0, "amplitude_uv": 45},
        "events": events or [],
    }
    norm = normalize({"kind": "qeeg_panel", "license": "synthetic-original",
                      "spec": spec})["spec"]
    return Synthesizer(norm, duration_s)


# --------------------------------------------------------------------------
# EKG row
# --------------------------------------------------------------------------

def test_ekg_row_is_positive_going_and_periodic():
    syn = _synth(120.0)
    row = ekg_row(syn, 120.0)
    assert row.shape == (int(120.0 * FS),)
    # A dedicated lead should have an upright R wave. _ecg inverts over the left
    # hemisphere, so naively taking row 0 gives a negative-going Fp1 projection.
    assert row.max() > abs(row.min()), "R wave should be the dominant deflection"
    # roughly one QRS per second at a child's ~100 bpm
    peaks = np.flatnonzero(row > 0.5 * row.max())
    beats = 1 + np.count_nonzero(np.diff(peaks) > FS // 4)
    assert 150 < beats < 250, f"{beats} beats in 120 s"


def test_ekg_row_picks_the_largest_projection_not_row_zero():
    syn = _synth(60.0)
    t = np.arange(int(60.0 * FS), dtype=np.float64) / FS
    rows = syn._ecg(t, DEFAULT_EKG_UV)
    chosen = ekg_row(syn, 60.0)
    assert chosen.max() >= rows.max(axis=1).max() - 1e-9
    assert chosen.max() > rows[0].max(), "row 0 is a half-amplitude inverted Fp1"


def test_ekg_row_fits_the_int16_range_at_default_calibration():
    """0.1 uV/count spans +/-3276.7 uV; a clipped ECG would be reported, not silent."""
    syn = _synth(60.0)
    assert np.abs(ekg_row(syn, 60.0)).max() < 3276.7


def test_ekg_row_is_partition_independent():
    """It is built from _ecg, which was one of the window-dependent defects."""
    syn = _synth(300.0)
    whole = ekg_row(syn, 300.0)
    half = ekg_row(syn, 150.0)
    assert np.abs(whole[: half.size] - half).max() < 1e-9


def test_exported_recording_carries_a_channel_named_ekg(tmp_path):
    syn = _synth(60.0)
    chans = tuple(list(syn.electrodes) + ["EKG"])
    rec = Recording("h", "v", 60.0, FS, chans)
    write_lay_dat(tmp_path / "CASE", syn, rec,
                  extra_rows={"EKG": ekg_row(syn, 60.0)})
    text = (tmp_path / "CASE.LAY").read_text(encoding="ascii")
    body = text.split("[ChannelMap]")[1].split("[Patient]")[0]
    names = [ln.split("=")[0] for ln in body.strip().splitlines() if "=" in ln]
    assert names[-1] == "EKG"
    assert f"WaveformCount={len(chans)}" in text


def test_extra_row_lands_in_the_right_channel(tmp_path):
    """A misplaced auxiliary row would corrupt an EEG channel silently."""
    syn = _synth(30.0)
    marker = np.full(int(30.0 * FS), 500.0)
    chans = tuple(list(syn.electrodes) + ["EKG"])
    rec = Recording("h", "v", 30.0, FS, chans)
    write_lay_dat(tmp_path / "CASE", syn, rec, extra_rows={"EKG": marker})
    raw = np.frombuffer((tmp_path / "CASE.DAT").read_bytes(), dtype="<i2")
    data = raw.reshape(-1, len(chans)).T.astype(float) * 0.1
    assert np.allclose(data[-1], 500.0, atol=0.05)
    assert np.abs(data[:-1]).max() < 400.0


# --------------------------------------------------------------------------
# baseline advisory
# --------------------------------------------------------------------------

def test_short_recording_is_flagged_as_having_no_baseline_window():
    syn = _synth(300.0)
    adv = baseline_advisory(syn, 300.0)
    assert adv["ok"] is False
    assert any("no baseline window exists" in r for r in adv["reasons"])


def test_long_enough_adult_recording_passes():
    syn = _synth(1200.0)
    assert baseline_advisory(syn, 1200.0)["ok"] is True


def test_neonatal_window_is_longer_than_adult():
    """Neonatal AutoSearch is StartTime=300 Duration=600, so it needs 15 min."""
    assert BASELINE_WINDOW_S["neonate"][1] > BASELINE_WINDOW_S["default"][1]
    syn = _synth(720.0, age="neonate", channels="neonatal_9")
    adv = baseline_advisory(syn, 720.0)
    assert adv["ok"] is False, "12 min clears the adult window but not the neonatal one"
    assert adv["window_s"] == [300.0, 900.0]
    assert any("neonatal P15" in r for r in adv["reasons"])


def test_advisory_names_the_preset_not_the_age_band():
    """There is no child or infant MMX; saying so would send someone hunting one."""
    adv = baseline_advisory(_synth(120.0, age="child"), 120.0)
    assert any("adult P15" in r for r in adv["reasons"])
    assert not any("child P15" in r for r in adv["reasons"])


def test_event_inside_the_baseline_window_is_flagged():
    syn = _synth(1200.0, events=[{
        "type": "seizure", "onset_min": 6.0, "duration_s": 60,
        "onset_region": "left_temporal",
        "evolution": {"start_hz": 4.0, "end_hz": 1.8,
                      "amplitude_start_uv": 60, "amplitude_end_uv": 150},
        "spread": "hemispheric",
    }])
    adv = baseline_advisory(syn, 1200.0)
    assert adv["ok"] is False
    assert any("overlaps the baseline window" in r for r in adv["reasons"])


def test_event_outside_the_window_is_not_flagged():
    syn = _synth(1800.0, events=[{
        "type": "seizure", "onset_min": 20.0, "duration_s": 60,
        "onset_region": "left_temporal",
        "evolution": {"start_hz": 4.0, "end_hz": 1.8,
                      "amplitude_start_uv": 60, "amplitude_end_uv": 150},
        "spread": "hemispheric",
    }])
    assert baseline_advisory(syn, 1800.0)["ok"] is True


def test_advisory_says_it_is_only_advisory():
    """Persyst decides with its own quality thresholds; we cannot evaluate those."""
    adv = baseline_advisory(_synth(1200.0), 1200.0)
    assert "advisory only" in adv["note"]
