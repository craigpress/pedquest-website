"""Unit tests for the two silent-failure detectors.  No Persyst needed.

The fixtures are miniatures of the real exports measured on 2026-09-11:

* ``docs/PSCLI_PHASE0A_RESULTS.md`` Finding 1 -- the 148 s sample exported 5,960
  zeros per VsBaseline instrument and 149 zeros of Heart Rate, at exit 0.
* Phase 0c -- the same instruments produced real values once a baseline window
  and a channel named ``EKG`` existed.

``Comment`` and ``Time`` are all-zero in *both* of those exports, which is why
they must never be treated as evidence.
"""

from __future__ import annotations

import csv
import io

import pytest

from persyst_bridge import pscli, readback

# --------------------------------------------------------------------------
# CSV fixtures
# --------------------------------------------------------------------------

METADATA = [
    ["File", r"C:\scratch\PQGEN01.DAT"],
    ["PatientName", "MyLastName", " MyFirstName"],  # unquoted comma, as Persyst writes it
    ["PatientID", "PQGEN01"],
    ["PatientBirthDate", "1900/01/30"],
    ["TestDate", "1900.01.31"],
    ["TestTime", "19:18:29"],
]

DESCRIPTIONS = [
    "", "",
    "Artifact Intensity",
    "Heart Rate",
    "VsBaseline, FFT Spectrogram, Left Hemisphere, 0 - 20 Hz", "",
    "VsBaseline, FFT Spectrogram, Right Hemisphere, 0 - 20 Hz",
    "Comment",
    "Time",
]

CODES = ["ClockDateTime", "Time", "I1_1", "I15_1", "I16_1", "I16_2", "I17_1", "I18_1", "I19_1"]


def build_csv(data_rows, *, metadata=METADATA, descriptions=DESCRIPTIONS, codes=CODES) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerows(metadata)
    writer.writerow(descriptions)
    writer.writerow(codes)
    writer.writerows(data_rows)
    return buffer.getvalue()


def inspect(text: str) -> dict:
    return readback.inspect_rows(csv.reader(io.StringIO(text, newline="")))


#: Phase 0a: no baseline window, no EKG channel.  Everything that depends on
#: either is zero; the instruments that do not are fine.
ZERO_BASELINE_ROWS = [
    ["32", "0", "8.43948", "0", "0", "0", "0", "0", "0"],
    ["32.00001", "1", "8.43948", "0", "0", "0", "0", "0", "0"],
    ["32.00002", "2", "7.11", "0", "0", "0", "0", "0", "0"],
]

#: Phase 0c: a baseline window exists and a channel is named EKG.
HEALTHY_ROWS = [
    ["32", "0", "8.43948", "84.2", "-3.6", "1.02", "2.11", "0", "0"],
    ["32.00001", "1", "8.43948", "88.0", "5.17", "0", "-4.05", "0", "0"],
    ["32.00002", "2", "7.11", "0", "1.4", "2.2", "3.31", "0", "0"],
]


# --------------------------------------------------------------------------
# all-zero sentinels
# --------------------------------------------------------------------------

def test_all_zero_vsbaseline_reports_unavailable():
    result = inspect(build_csv(ZERO_BASELINE_ROWS))
    assert result["baseline"] == "unavailable"
    assert result["baseline_instruments"] == ["I16", "I17"]


def test_all_zero_heart_rate_reports_unavailable():
    result = inspect(build_csv(ZERO_BASELINE_ROWS))
    assert result["heart_rate"] == "unavailable"


def test_values_present_report_ok():
    result = inspect(build_csv(HEALTHY_ROWS))
    assert result["baseline"] == "ok"
    assert result["heart_rate"] == "ok"
    assert result["warnings"] == []


def test_heart_rate_with_some_zero_seconds_is_still_ok():
    """0c measured 51 zero seconds out of 1,801.  Only *all* zero is a failure."""
    result = inspect(build_csv(HEALTHY_ROWS))
    heart = next(i for i in result["instruments"] if i["id"] == "I15")
    assert heart["zeros"] == 1 and heart["n"] == 3


def test_sub_columns_are_aggregated_into_one_instrument():
    result = inspect(build_csv(HEALTHY_ROWS))
    left = next(i for i in result["instruments"] if i["id"] == "I16")
    assert left["sub_columns"] == 2
    assert left["n"] == 6
    assert left["min"] == -3.6 and left["max"] == 5.17


def test_comment_and_time_pseudo_instruments_are_never_sentinels():
    """Both are all-zero in a good export as well as a bad one."""
    result = inspect(build_csv(HEALTHY_ROWS))
    comment = next(i for i in result["instruments"] if i["id"] == "I18")
    assert comment["zeros"] == comment["n"] > 0
    assert result["warnings"] == []  # their zeros raise nothing


def test_one_zero_baseline_hemisphere_is_partial_not_ok():
    rows = [row[:] for row in HEALTHY_ROWS]
    for row in rows:
        row[6] = "0"  # I17 flat, I16 alive
    result = inspect(build_csv(rows))
    assert result["baseline"] == "partial"
    assert any("I17" in warning for warning in result["warnings"])


def test_every_instrument_zero_is_called_out():
    rows = [["32", "0"] + ["0"] * 7]
    result = inspect(build_csv(rows))
    assert any("every instrument is all zero" in w for w in result["warnings"])


def test_panel_without_baseline_reports_absent_not_ok():
    codes = ["ClockDateTime", "Time", "I1_1"]
    descriptions = ["", "", "Artifact Intensity"]
    result = inspect(build_csv([["32", "0", "1.5"]], descriptions=descriptions, codes=codes))
    assert result["baseline"] == "absent"
    assert result["heart_rate"] == "absent"
    assert len(result["warnings"]) == 2


def test_no_data_rows_is_unavailable_not_ok():
    result = inspect(build_csv([]))
    assert result["baseline"] == "unavailable"
    assert result["heart_rate"] == "unavailable"
    assert result["csv_rows"] == 0


def test_code_row_is_located_by_shape_not_by_index():
    """A different panel changes the metadata block's length."""
    metadata = METADATA + [["ExtraHeaderRow", "something"], ["AndAnother", "1"]]
    result = inspect(build_csv(HEALTHY_ROWS, metadata=metadata))
    assert result["baseline"] == "ok"
    assert result["metadata"]["AndAnother"] == "1"


def test_metadata_rejoins_an_unquoted_comma():
    result = inspect(build_csv(HEALTHY_ROWS))
    assert result["metadata"]["PatientName"] == "MyLastName, MyFirstName"
    assert result["metadata"]["TestDate"] == "1900.01.31"


def test_non_numeric_cells_do_not_count_as_zero():
    rows = [["32", "0", "", "n/a", "0", "0", "0", "0", "0"]]
    result = inspect(build_csv(rows))
    artifact = next(i for i in result["instruments"] if i["id"] == "I1")
    assert artifact["n"] == 0 and artifact["zeros"] == 0


def test_a_csv_with_no_instrument_codes_is_rejected():
    text = "File,x\r\nfoo,bar\r\n1,2\r\n"
    with pytest.raises(ValueError):
        inspect(text)


# --------------------------------------------------------------------------
# why the baseline is missing
# --------------------------------------------------------------------------

def test_short_record_explains_a_missing_adult_baseline():
    reason = readback.explain_missing_baseline("Trend Settings Version P15.mmx", 148.48)
    assert reason and "570" in reason and "adult" in reason


def test_neonatal_window_is_longer():
    preset = "Trend Settings P15 neonatal.mmx"
    assert readback.autosearch_window(preset) == ("neonatal", 300.0, 600.0)
    assert readback.explain_missing_baseline(preset, 700.0)          # 700 < 900
    assert readback.explain_missing_baseline(preset, 1000.0) is None


def test_long_record_gets_no_excuse():
    """A 30 min record is past the window, so an absent baseline is a real bug."""
    assert readback.explain_missing_baseline("Trend Settings Version P15.mmx", 1800.0) is None


# --------------------------------------------------------------------------
# [Comments] detections
# --------------------------------------------------------------------------

#: Verbatim from the Phase 0c run, plus the header Persyst rewrote with -Ref.
LAY_0C = (
    "[FileInfo]\r\n"
    "File=PQGEN01.DAT\r\n"
    "FileType=Interleaved\r\n"
    "SamplingRate=200\r\n"
    "\r\n"
    "[ChannelMap]\r\n"
    "Fp1-Ref=1\r\n"
    "Fp2-Ref=2\r\n"
    "EKG-Ref=22\r\n"
    "\r\n"
    "[Comments]\r\n"
    "0.000000,0.000000,0,65536,@Warning: Persyst is post processing. "
    "Detection notifications are turned OFF.\r\n"
    "0.500000,1799.000000,0,65536,@SeizuresProcessed(P14) v=2026.05.07 alg=5 p=0.10 d=2\r\n"
    "1083.000000,103.000000,0,65536,@SeizureDetected(P14) p=0.949\r\n"
)


def test_parses_the_measured_detection():
    result = readback.parse_lay(LAY_0C)
    assert len(result["detections"]) == 1
    detection = result["detections"][0]
    assert detection["onset_s"] == 1083.0
    assert detection["duration_s"] == 103.0
    assert detection["state"] == 0 and detection["type"] == 65536
    assert detection["kind"] == "SeizureDetected"
    assert detection["detector"] == "P14"
    assert detection["probability"] == pytest.approx(0.949)


def test_detector_provenance_records_the_applied_thresholds():
    """``alg=5 p=0.10 d=2`` -- d=2 came from persisted GUI state, not the CLI
    default of 1.0.  Recording it is the only way the run is reproducible."""
    detector = readback.parse_lay(LAY_0C)["detector"]
    assert detector == {"detector": "P14", "v": "2026.05.07", "alg": 5, "p": 0.10, "d": 2}


def test_the_post_processing_banner_is_a_warning_not_a_detection():
    result = readback.parse_lay(LAY_0C)
    assert result["detections"] and len(result["detections"]) == 1
    assert len(result["lay_warnings"]) == 1
    assert "post processing" in result["lay_warnings"][0]
    assert result["comment_lines"] == 3


def test_channel_rename_is_tolerated_and_reported():
    result = readback.parse_lay(LAY_0C)
    assert result["channels"] == ["Fp1", "Fp2", "EKG"]
    assert result["channels_renamed"] is True


def test_unprocessed_lay_reports_no_rename():
    text = "[ChannelMap]\r\nFp1=1\r\nFp2=2\r\n\r\n[Comments]\r\n"
    result = readback.parse_lay(text)
    assert result["channels"] == ["Fp1", "Fp2"]
    assert result["channels_renamed"] is False
    assert result["detections"] == [] and result["detector"] is None


def test_comment_text_may_contain_commas():
    text = "[Comments]\r\n12.000000,3.000000,0,65536,@SeizureDetected(P14) p=0.5, spread, bilateral\r\n"
    detection = readback.parse_lay(text)["detections"][0]
    assert detection["text"].endswith("p=0.5, spread, bilateral")
    assert detection["probability"] == pytest.approx(0.5)


def test_comment_lines_outside_the_section_are_ignored():
    text = (
        "[Patient]\r\n"
        "Comments1=0.0,0.0,0,65536,@SeizureDetected(P14) p=0.99\r\n"
        "\r\n"
        "[Comments]\r\n"
        "5.000000,1.000000,0,65536,@SeizureDetected(P14) p=0.80\r\n"
    )
    detections = readback.parse_lay(text)["detections"]
    assert len(detections) == 1 and detections[0]["onset_s"] == 5.0


def test_malformed_comment_lines_are_skipped():
    text = (
        "[Comments]\r\n"
        "not,enough,fields\r\n"
        "later,0.0,0,65536,@SeizureDetected(P14) p=0.9\r\n"
        "7.000000,1.000000,0,65536,@SeizureDetected(P14) p=0.91\r\n"
    )
    result = readback.parse_lay(text)
    assert result["comment_lines"] == 1
    assert len(result["detections"]) == 1


def test_free_text_comment_is_a_note_not_a_detection():
    text = "[Comments]\r\n30.000000,0.000000,0,1,Technician stepped out\r\n"
    result = readback.parse_lay(text)
    assert result["detections"] == []
    assert result["lay_notes"][0]["text"] == "Technician stepped out"


# --------------------------------------------------------------------------
# the retry predicate
# --------------------------------------------------------------------------

def test_access_violation_matches_either_sign_convention():
    assert pscli.is_access_violation(-1073741819)
    assert pscli.is_access_violation(3221225477)
    assert not pscli.is_access_violation(0)
    assert not pscli.is_access_violation(1)
    assert not pscli.is_access_violation(None)


def test_exit_codes_are_folded_into_int4_range():
    """``last_exit_code`` is an INT; the unsigned form overflows it."""
    assert pscli.signed32(3221225477) == -1073741819
    assert -2**31 <= pscli.signed32(3221225477) <= 2**31 - 1
    assert pscli.signed32(0) == 0
    assert pscli.signed32(-1) == -1
