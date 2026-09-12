"""Waveform export: round-trip fidelity, EDF+ conformance, and answer-key truth.

The .lay round trip is checked against ``mne.io.read_raw_persyst`` when mne is
installed (it is a ``datasets`` extra, not on the render path) and against a
hand-written parser otherwise, so the suite is meaningful on the deploy venv too.
"""
from __future__ import annotations

import struct
import sys
from pathlib import Path

import numpy as np
import pytest

RENDERER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RENDERER))

from eeg_render import RENDERER_VERSION
from eeg_render.export import (Recording, build_manifest, iter_blocks,
                               write_edf_plus, write_lay_dat)
from eeg_render.export.manifest import recording_for
from eeg_render.export.persyst import DEFAULT_CALIBRATION
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer

FS = 200
DUR_S = 420.0        # 7 minutes: several 300 s blocks, so seams are exercised


def _build(events=None, seed=777):
    spec = {
        "seed": seed,
        "age_group": "child",
        "sample_rate": FS,
        "channels": "standard_19",
        "duration_min": 30,
        "background": {"type": "continuous", "dominant_hz": 7.0,
                       "amplitude_uv": 45, "baseline_ecg_uv": 5.0},
        "events": events if events is not None else [{
            "type": "seizure", "onset_min": 3.0, "duration_s": 90,
            "onset_region": "left_temporal",
            "evolution": {"start_hz": 4.0, "end_hz": 1.8,
                          "amplitude_start_uv": 60, "amplitude_end_uv": 150},
            "spread": "hemispheric", "postictal_attenuation_s": 45,
        }],
    }
    image = {"kind": "qeeg_panel", "license": "synthetic-original", "spec": spec}
    norm = normalize(image)
    syn = Synthesizer(norm["spec"], DUR_S)
    return image, syn, recording_for(image, syn, DUR_S)


# --------------------------------------------------------------------------
# streaming
# --------------------------------------------------------------------------

def test_iter_blocks_reconstructs_the_whole_recording():
    _, syn, rec = _build()
    parts = [b for _, b in iter_blocks(syn, rec.n_samples)]
    joined = np.concatenate(parts, axis=1)
    _, whole = syn.segment(0.0, DUR_S)
    assert joined.shape == whole.shape == (len(syn.electrodes), rec.n_samples)
    assert np.abs(joined - whole).max() < 1e-9


def test_margin_covers_the_one_seam_segment_cannot_fix():
    """Frequency-selective attenuation runs a zero-phase filter per request.

    ``sosfiltfilt`` settles against whatever block it is handed, so this is the
    one case ``segment`` cannot make window-independent on its own -- the margin
    in ``iter_blocks`` is what makes a chunked export match a whole render.
    A naive chunked read of the same spec must visibly disagree.
    """
    _, syn, rec = _build(events=[{
        "type": "attenuation_transient", "at_min": 2.0, "duration_min": 3.0,
        "side": "left", "depth_pct": 70, "delta_depth_pct": 20, "ramp_min": 1.0,
    }])
    _, whole = syn.segment(0.0, DUR_S)

    with_margin = np.concatenate([b for _, b in iter_blocks(syn, rec.n_samples)], axis=1)
    assert np.abs(with_margin - whole).max() < 1e-9

    naive = np.concatenate(
        [syn.segment(s / FS, min(s + 60 * FS, rec.n_samples) / FS)[1]
         for s in range(0, rec.n_samples, 60 * FS)], axis=1)
    assert np.abs(naive - whole).max() > 1e-9, \
        "if a marginless read now matches, the margin is no longer earning its cost"


def test_iter_blocks_starts_are_contiguous_in_samples():
    _, syn, rec = _build()
    expect = 0
    for start, block in iter_blocks(syn, rec.n_samples):
        assert start == expect
        expect += block.shape[1]
    assert expect == rec.n_samples


# --------------------------------------------------------------------------
# recording identity
# --------------------------------------------------------------------------

def test_duration_changes_recording_id():
    image, syn, rec = _build()
    other = Recording(rec.spec_hash, rec.renderer_version, DUR_S * 2,
                      rec.sample_rate, rec.channels)
    assert rec.recording_id != other.recording_id


def test_recording_id_covers_channel_order():
    _, _, rec = _build()
    swapped = Recording(rec.spec_hash, rec.renderer_version, rec.duration_s,
                        rec.sample_rate, tuple(reversed(rec.channels)))
    assert rec.recording_id != swapped.recording_id
    assert rec.renderer_version == RENDERER_VERSION


# --------------------------------------------------------------------------
# Persyst .lay / .dat
# --------------------------------------------------------------------------

def _read_lay_dat(lay_path: Path):
    """Minimal independent reader: sections, then interleaved int16 * calibration."""
    section, info, order = None, {}, []
    for raw in lay_path.read_text(encoding="ascii").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1].lower()
            continue
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        if section == "fileinfo":
            info[k.lower()] = v
        elif section == "channelmap":
            order.append((int(v), k))
    n_ch = int(info["waveformcount"])
    cal = float(info["calibration"])
    assert info["filetype"] == "Interleaved"
    assert int(info["datatype"]) == 0
    raw = (lay_path.parent / info["file"]).read_bytes()
    data = np.frombuffer(raw, dtype="<i2").reshape(-1, n_ch).T.astype(np.float64) * cal
    names = [name for _, name in sorted(order)]
    return names, data, float(info["samplingrate"])


def test_lay_dat_round_trip_is_sample_exact(tmp_path):
    _, syn, rec = _build()
    report = write_lay_dat(tmp_path / "CASE", syn, rec)
    assert report["clipped_samples"] == 0, report

    names, data, fs = _read_lay_dat(tmp_path / "CASE.LAY")
    assert fs == FS
    assert names == list(rec.channels)
    assert data.shape == (len(rec.channels), rec.n_samples)

    _, whole = syn.segment(0.0, DUR_S)
    err = np.abs(data - whole).max()
    assert err <= DEFAULT_CALIBRATION / 2 + 1e-9, f"max error {err} uV"


def test_lay_channel_map_is_contiguous_and_in_binary_order(tmp_path):
    _, syn, rec = _build()
    write_lay_dat(tmp_path / "CASE", syn, rec)
    text = (tmp_path / "CASE.LAY").read_text(encoding="ascii")
    body = text.split("[ChannelMap]")[1].split("[Patient]")[0]
    pairs = [ln.split("=") for ln in body.strip().splitlines() if "=" in ln]
    assert [int(v) for _, v in pairs] == list(range(1, len(rec.channels) + 1))
    assert [k for k, _ in pairs] == list(rec.channels)


def test_lay_uses_crlf_and_yyyy_mm_dd(tmp_path):
    """Both confirmed against the shipped Persyst sample, and both easy to get wrong."""
    _, syn, rec = _build()
    write_lay_dat(tmp_path / "CASE", syn, rec)
    raw = (tmp_path / "CASE.LAY").read_bytes()
    assert b"\r\n" in raw
    line = [l for l in raw.decode("ascii").splitlines() if l.startswith("TestDate=")][0]
    y, m, d = line.split("=", 1)[1].split("/")
    assert len(y) == 4 and len(m) == 2 and len(d) == 2


def test_learner_copy_carries_no_ground_truth(tmp_path):
    """Withholding the write-up does not blind a case if the file answers it."""
    _, syn, rec = _build()
    write_lay_dat(tmp_path / "LEARNER", syn, rec)                       # no events
    text = (tmp_path / "LEARNER.LAY").read_text(encoding="ascii")
    comments = text.split("[Comments]")[1].strip()
    assert comments == ""
    for leak in ("seizure", "Seizure", "left_temporal", "postictal"):
        assert leak not in text


def test_instructor_copy_carries_events(tmp_path):
    _, syn, rec = _build()
    report = write_lay_dat(tmp_path / "TEACH", syn, rec,
                           events=[(180.0, 90.0, "@Seizure left_temporal")])
    assert report["comments"] == 1
    comments = (tmp_path / "TEACH.LAY").read_text(encoding="ascii").split("[Comments]")[1]
    assert "180.000000,90.000000,0,65536,@Seizure left_temporal" in comments


def test_clipping_is_reported_not_hidden(tmp_path):
    _, syn, rec = _build()
    report = write_lay_dat(tmp_path / "CLIP", syn, rec, calibration=0.001)
    assert report["clipped_samples"] > 0
    assert report["peak_uv"] > 32.767


@pytest.mark.skipif(pytest.importorskip is None, reason="unreachable")
def test_lay_round_trip_via_mne_when_available(tmp_path):
    mne = pytest.importorskip("mne", reason="mne is a datasets extra, not on the render path")
    _, syn, rec = _build()
    write_lay_dat(tmp_path / "CASE", syn, rec)
    raw = mne.io.read_raw_persyst(str(tmp_path / "CASE.LAY"), preload=True, verbose="ERROR")
    got = raw.get_data() * 1e6                     # mne returns volts
    _, whole = syn.segment(0.0, DUR_S)
    assert got.shape == whole.shape
    assert np.abs(got - whole).max() <= DEFAULT_CALIBRATION / 2 + 1e-6


# --------------------------------------------------------------------------
# EDF+
# --------------------------------------------------------------------------

def _read_edf_header(path: Path):
    raw = path.read_bytes()
    n_sig = int(raw[252:256])
    hdr = {
        "version": raw[0:8].decode("ascii").strip(),
        "patient": raw[8:88].decode("ascii").strip(),
        "recording": raw[88:168].decode("ascii").strip(),
        "header_bytes": int(raw[184:192]),
        "reserved": raw[192:236].decode("ascii").strip(),
        "n_records": int(raw[236:244]),
        "record_s": float(raw[244:252]),
        "n_signals": n_sig,
    }
    off = 256
    def block(width):
        nonlocal off
        out = [raw[off + i * width: off + (i + 1) * width].decode("ascii").strip()
               for i in range(n_sig)]
        off += width * n_sig
        return out
    hdr["labels"] = block(16)
    block(80)                                     # transducer
    hdr["units"] = block(8)
    hdr["phys_min"] = [float(v) for v in block(8)]
    hdr["phys_max"] = [float(v) for v in block(8)]
    hdr["dig_min"] = [int(v) for v in block(8)]
    hdr["dig_max"] = [int(v) for v in block(8)]
    block(80)                                     # prefilter
    hdr["spr"] = [int(v) for v in block(8)]
    return hdr, raw


def test_edf_plus_is_structurally_conforming(tmp_path):
    _, syn, rec = _build()
    report = write_edf_plus(tmp_path / "CASE", syn, rec)
    hdr, raw = _read_edf_header(tmp_path / "CASE.edf")

    assert hdr["version"] == "0"
    assert hdr["reserved"] == "EDF+C"
    assert hdr["recording"].startswith("Startdate ")
    assert hdr["n_signals"] == len(rec.channels) + 1
    assert hdr["header_bytes"] == 256 * (hdr["n_signals"] + 1)
    # the annotation signal is required even with no annotations
    assert hdr["labels"][-1] == "EDF Annotations"
    assert hdr["dig_min"][-1] == -32768 and hdr["dig_max"][-1] == 32767
    assert hdr["units"][0] == "uV"

    body = 2 * sum(hdr["spr"]) * hdr["n_records"]
    assert len(raw) == hdr["header_bytes"] + body, "declared geometry must match file size"
    assert report["records"] == hdr["n_records"]


def test_every_record_has_a_timekeeping_annotation(tmp_path):
    _, syn, rec = _build()
    write_edf_plus(tmp_path / "CASE", syn, rec)
    hdr, raw = _read_edf_header(tmp_path / "CASE.edf")
    rec_bytes = 2 * sum(hdr["spr"])
    annot_bytes = 2 * hdr["spr"][-1]
    for i in range(hdr["n_records"]):
        off = hdr["header_bytes"] + i * rec_bytes + (rec_bytes - annot_bytes)
        tal = raw[off:off + annot_bytes]
        expect = f"{i * hdr['record_s']:+.6f}".encode("ascii") + b"\x14\x14\x00"
        assert tal.startswith(expect), f"record {i}: {tal[:24]!r}"


def test_edf_digital_mapping_is_a_consistent_affine(tmp_path):
    _, syn, rec = _build()
    write_edf_plus(tmp_path / "CASE", syn, rec)
    hdr, raw = _read_edf_header(tmp_path / "CASE.edf")
    pmin, pmax = hdr["phys_min"][0], hdr["phys_max"][0]
    dmin, dmax = hdr["dig_min"][0], hdr["dig_max"][0]
    gain = (pmax - pmin) / (dmax - dmin)

    rec_bytes = 2 * sum(hdr["spr"])
    spr = hdr["spr"][0]
    first = np.frombuffer(raw[hdr["header_bytes"]: hdr["header_bytes"] + 2 * spr],
                          dtype="<i2").astype(np.float64)
    got = (first - dmin) * gain + pmin
    _, whole = syn.segment(0.0, spr / FS)
    assert np.abs(got - whole[0, :spr]).max() < 2 * gain


def test_edf_annotations_appear_in_the_right_record(tmp_path):
    _, syn, rec = _build()
    write_edf_plus(tmp_path / "CASE", syn, rec,
                   events=[(180.0, 90.0, "Seizure left_temporal")])
    hdr, raw = _read_edf_header(tmp_path / "CASE.edf")
    rec_bytes = 2 * sum(hdr["spr"])
    annot_bytes = 2 * hdr["spr"][-1]
    idx = int(180.0 // hdr["record_s"])
    off = hdr["header_bytes"] + idx * rec_bytes + (rec_bytes - annot_bytes)
    assert b"Seizure left_temporal" in raw[off:off + annot_bytes]


def test_edf_reports_padding_rather_than_truncating(tmp_path):
    _, syn, rec = _build()
    report = write_edf_plus(tmp_path / "CASE", syn, rec)
    assert report["samples"] == rec.n_samples
    assert report["padded_samples"] >= 0
    assert report["records"] * FS * report["record_duration_s"] == \
        rec.n_samples + report["padded_samples"]


# --------------------------------------------------------------------------
# answer key
# --------------------------------------------------------------------------

def test_manifest_reports_realized_not_requested_events():
    _, syn, rec = _build()
    man = build_manifest(syn, rec)
    sz = [e for e in man["events"] if e["kind"] == "seizure"]
    assert len(sz) == 1
    ev = sz[0]
    assert ev["onset_sample"] == int(round(ev["onset_s"] * FS))
    assert abs(ev["onset_s"] - 180.0) < 30.0
    assert ev["onset_region"] == "left_temporal"
    assert ev["label_type"] == "commanded"
    assert man["synthetic"] is True


def test_manifest_expands_a_cluster_into_realized_instances():
    _, syn, rec = _build(events=[{
        "type": "seizure_cluster", "start_min": 1.0, "end_min": 6.0,
        "interval_min": 1.0,
        "seizure": {"duration_s": 40, "onset_region": "right_temporal",
                    "evolution": {"start_hz": 3.0, "end_hz": 1.5,
                                  "amplitude_start_uv": 55, "amplitude_end_uv": 140},
                    "spread": "hemispheric"},
    }])
    man = build_manifest(syn, rec)
    sz = [e for e in man["events"] if e["kind"] in ("seizure", "seizure_cluster")]
    assert len(sz) >= 3, "a cluster must appear as its realized members"
    onsets = [e["onset_s"] for e in sz]
    assert onsets == sorted(onsets)
    assert len({e["cluster_ordinal"] for e in sz}) > 1


def _write_spec(tmp_path) -> Path:
    import yaml
    spec = {
        "kind": "qeeg_panel", "license": "synthetic-original",
        "spec": {
            "seed": 5150, "age_group": "child", "sample_rate": 200,
            "channels": "standard_19", "duration_min": 30,
            "background": {"type": "continuous", "dominant_hz": 7.0,
                           "amplitude_uv": 45},
            "events": [{
                "type": "seizure", "onset_min": 1.0, "duration_s": 45,
                "onset_region": "left_temporal",
                "evolution": {"start_hz": 4.0, "end_hz": 1.8,
                              "amplitude_start_uv": 60, "amplitude_end_uv": 150},
                "spread": "hemispheric",
            }],
        },
    }
    p = tmp_path / "CASE.yaml"
    p.write_text(yaml.safe_dump(spec), encoding="utf-8")
    return p


def _run_export(tmp_path, *flags):
    from eeg_render.cli import main
    out = tmp_path / ("out_" + "_".join(f.strip("-") for f in flags) or "out")
    assert main(["export", str(_write_spec(tmp_path)), "--out", str(out),
                 "--duration", "2m", "--format", "lay", *flags]) == 0
    return {p.name for p in out.iterdir()}


def test_export_default_writes_no_answer_key(tmp_path):
    """The dangerous default: a 'learner copy' that ships the answers beside it.

    The key file is separable from the recording, so whoever distributes the
    folder can withhold it -- but only if it was never written by default.
    """
    files = _run_export(tmp_path)
    assert files == {"CASE.LAY", "CASE.DAT"}
    assert not any(f.endswith(".answers.json") for f in files)


def test_export_answers_writes_the_key_but_leaves_the_recording_clean(tmp_path):
    files = _run_export(tmp_path, "--answers")
    assert "CASE.answers.json" in files
    lay = (tmp_path / "out_answers" / "CASE.LAY").read_text(encoding="ascii")
    assert lay.split("[Comments]")[1].strip() == "", \
        "--answers must not put ground truth inside the recording"


def test_export_embed_answers_is_a_separate_louder_opt_in(tmp_path):
    files = _run_export(tmp_path, "--embed-answers")
    assert "CASE.answers.json" in files
    lay = (tmp_path / "out_embed-answers" / "CASE.LAY").read_text(encoding="ascii")
    comments = lay.split("[Comments]")[1].strip()
    assert comments, "--embed-answers must annotate the recording"
    assert "seizure" in comments.lower()


def test_manifest_clips_events_to_the_recording():
    _, syn, rec = _build()
    for ev in build_manifest(syn, rec)["events"]:
        assert 0.0 <= ev["onset_s"] <= rec.duration_s
        assert 0.0 <= ev["offset_s"] <= rec.duration_s
