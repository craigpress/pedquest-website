"""Persyst ``.lay`` / ``.dat`` writer.

The header below is not a guess.  It is the form that Persyst 15
(``15C3:2026.05.07``) processed, detected seizures in, and exported trends from
on 2026-09-11 -- see ``docs/PSCLI_PHASE0A_RESULTS.md``.  Two details are worth
keeping because the bundled sample does *not* demonstrate them:

* an **inline** ``[ChannelMap]`` works; the shipped sample references an external
  named map (``ChannelMap=CdwTrans19Map``) and we do not need one.
* ``TestDate`` is ``YYYY/MM/DD`` in the ``.lay`` -- not ``MM/DD/YYYY``.  (The CSV
  export then writes it back dot-separated, which is a different convention again.)

Omitted deliberately, all confirmed unnecessary: ``[SampleTimes]`` (its entries
are *seconds after midnight* keyed by sample index, not elapsed time, and MNE
ignores it, so a wrong one would silently mis-time comments for no benefit),
``Montage=``, ``Sensitivity=`` and the external ``ChannelMap=`` key.
"""

from __future__ import annotations

import datetime as _dt
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

from ..synth import Synthesizer
from .manifest import Recording, iter_blocks

#: Microvolts per count.  0.1 gives +/-3276.7 uV of headroom in int16, which is
#: finer than the 0.25 uV sensor floor and clears a 170 uV seizure with room to
#: spare.  Persyst's own sample ships ``Calibration=1`` -- 1 uV/LSB -- which
#: quantises a suppressed background coarsely.
DEFAULT_CALIBRATION = 0.1

_BANNER = "SYNTHETIC RECORDING - PedQuEST eeg_render - NOT A PATIENT RECORDING"


class ExportError(RuntimeError):
    """The recording cannot be written faithfully."""


def _lay_text(recording: Recording, dat_name: str, calibration: float,
              start: _dt.datetime, patient_id: str,
              comments: Sequence[Tuple[float, float, str]]) -> str:
    lines: List[str] = [
        "[FileInfo]",
        f"File={dat_name}",
        "FileType=Interleaved",
        f"SamplingRate={recording.sample_rate}",
        "HeaderLength=0",
        f"Calibration={calibration}",
        f"WaveformCount={len(recording.channels)}",
        "DataType=0",
        "MainsFrequency=60",
        "",
        "[ChannelMap]",
    ]
    # Binary channel order, contiguous 1-based indices.  Readers that take names
    # in insertion order and readers that take them by index must agree.
    lines += [f"{name}={i}" for i, name in enumerate(recording.channels, start=1)]
    lines += [
        "",
        "[Patient]",
        "First=SYNTHETIC",
        "Last=NOT-A-PATIENT",
        f"ID={patient_id}",
        f"TestDate={start:%Y/%m/%d}",
        f"TestTime={start:%H:%M:%S}",
        f"Comments1={_BANNER}",
        "Comments2=Generated for qEEG teaching. Not for clinical use.",
        "",
        "[Comments]",
    ]
    for onset, duration, text in comments:
        # time,duration,state,type,text -- the grammar Persyst itself writes.
        lines.append(f"{onset:.6f},{duration:.6f},0,65536,{text}")
    lines.append("")
    return "\r\n".join(lines)


def write_lay_dat(path: str | Path, synth: Synthesizer, recording: Recording,
                  *, calibration: float = DEFAULT_CALIBRATION,
                  start: Optional[_dt.datetime] = None,
                  extra_rows: Optional[Dict[str, np.ndarray]] = None,
                  events: Sequence[Tuple[float, float, str]] = (),
                  blocks: Optional[Iterable[Tuple[int, np.ndarray]]] = None,
                  ) -> Dict:
    """Stream ``synth`` to ``<path>.LAY`` + ``<path>.DAT``.

    ``blocks`` replaces the writer's own ``iter_blocks`` pull -- the CLI passes
    one arm of :func:`export.tee.tee_blocks` so a two-format export
    synthesizes the recording once.

    ``events`` are written into ``[Comments]``.  Pass none for a learner copy:
    ground truth in the header is ground truth in the learner's hands.

    Returns a small report including the clipping count, which is *reported*
    rather than silently saturated.
    """
    path = Path(path)
    stem = path.with_suffix("").name
    lay_path = path.with_suffix(".LAY")
    dat_path = path.with_suffix(".DAT")

    if calibration <= 0 or not np.isfinite(calibration):
        raise ExportError(f"calibration must be finite and positive, got {calibration!r}")

    n_channels = len(recording.channels)
    n_expected = recording.n_samples
    extra_rows = dict(extra_rows or {})
    extra_order = [c for c in recording.channels if c in extra_rows]
    n_synth = n_channels - len(extra_order)
    if n_synth != len(synth.electrodes):
        raise ExportError(
            f"recording declares {n_channels} channels with {len(extra_order)} supplied "
            f"externally, leaving {n_synth} for a synthesizer that produces "
            f"{len(synth.electrodes)}"
        )

    clipped = 0
    written = 0
    peak = 0.0
    source = blocks if blocks is not None else iter_blocks(synth, n_expected)
    with dat_path.open("wb") as fh:
        for start_sample, block in source:
            n = block.shape[1]
            if extra_order:
                rows = [block] + [
                    extra_rows[c][start_sample:start_sample + n][None, :]
                    for c in extra_order
                ]
                block = np.vstack(rows)
            if not np.all(np.isfinite(block)):
                raise ExportError(
                    f"non-finite sample in block at {start_sample / recording.sample_rate:.3f}s"
                )
            peak = max(peak, float(np.abs(block).max()))
            counts = np.rint(block / calibration)
            clipped += int(np.count_nonzero((counts < -32768) | (counts > 32767)))
            counts = np.clip(counts, -32768, 32767).astype("<i2")
            # sample-major interleave: ch1s0, ch2s0, ..., ch1s1, ...
            fh.write(counts.T.tobytes(order="C"))
            written += n

    if written != n_expected:
        raise ExportError(f"wrote {written} samples, expected {n_expected}")

    start = start or _dt.datetime(2026, 1, 1, 0, 0, 0)
    comments: List[Tuple[float, float, str]] = list(events)
    lay_path.write_text(
        _lay_text(recording, dat_path.name, calibration, start, stem, comments),
        encoding="ascii", newline="",
    )

    return {
        "lay": str(lay_path),
        "dat": str(dat_path),
        "samples": written,
        "channels": n_channels,
        "calibration_uv_per_count": calibration,
        "clipped_samples": clipped,
        "peak_uv": round(peak, 3),
        "comments": len(comments),
    }
