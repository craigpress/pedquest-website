"""Conforming EDF+C writer.

Deliberately a sibling of ``datasets.edf.write_edf`` rather than a patch of it.
That function is a test stub: it hardcodes one-second records and an integer
sample rate, stamps a fake start date, claims ``EDF+C`` in the reserved field
while writing **no annotation signal**, drops the trailing partial record, and
mixes a symmetric physical range with a division by 32767 while declaring
asymmetric digital bounds.  It has no callers.

What conformance actually requires, and what the in-repo reader does not check:

* an ``EDF Annotations`` signal **even when there are no annotations**, carrying a
  timekeeping TAL in *every* data record;
* that signal's digital bounds fixed at -32768/32767 (the general affine fix
  applied to ordinary signals must not be applied to it);
* ``patient`` and ``recording`` identification fields in EDF+ subfield form,
  including ``Startdate dd-MMM-yyyy``;
* a record duration for which ``sample_rate * duration`` is an integer.

Validate output against an independent implementation (EDFbrowser, pyedflib) --
``datasets.edf.read_signals`` rejects mixed sample rates, so a *correct* EDF+
export fails our own reader by design.
"""

from __future__ import annotations

import datetime as _dt
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

from ..synth import Synthesizer
from .manifest import Recording, iter_blocks

#: Physical range, in microvolts, declared in the header.  EDF fixes the scale
#: before any sample is written, so it cannot be derived per block; a
#: predetermined range plus an honest clipping count beats a two-pass read.
DEFAULT_PHYS_UV = 3300.0

_ANNOT_LABEL = "EDF Annotations"
_CANDIDATE_RECORD_S = (1.0, 2.0, 5.0, 10.0, 0.5, 0.25, 0.2, 0.1)
_MONTHS = ("JAN", "FEB", "MAR", "APR", "MAY", "JUN",
           "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")


class EdfExportError(RuntimeError):
    """The recording cannot be written as conforming EDF+."""


def _pad(text: str, width: int) -> bytes:
    raw = str(text).encode("ascii", errors="replace")[:width]
    if len(raw) > width:                       # pragma: no cover - sliced above
        raise EdfExportError(f"field overflow: {text!r}")
    return raw.ljust(width, b" ")


def _num(value: float, width: int) -> bytes:
    """Fixed-width numeric field that must not lose significance to truncation."""
    for text in (f"{value:g}", f"{value:.6f}", f"{value:.3f}", f"{int(round(value))}"):
        if len(text) <= width:
            return _pad(text, width)
    raise EdfExportError(f"cannot represent {value!r} in {width} characters")


def _edf_date(when: _dt.datetime) -> str:
    return f"{when.day:02d}-{_MONTHS[when.month - 1]}-{when.year:04d}"


def _record_duration(fs: int) -> float:
    for d in _CANDIDATE_RECORD_S:
        spr = fs * d
        if abs(spr - round(spr)) < 1e-9 and round(spr) >= 1:
            return d
    raise EdfExportError(
        f"no record duration in {_CANDIDATE_RECORD_S} gives an integer sample "
        f"count at {fs} Hz"
    )


def _tal(onset: float, duration: Optional[float], text: str) -> bytes:
    head = f"{onset:+.6f}".encode("ascii")
    if duration is not None:
        head += b"\x15" + f"{duration:.6f}".encode("ascii")
    return head + b"\x14" + text.encode("utf-8", errors="replace") + b"\x14\x00"


def _timekeeping(onset: float) -> bytes:
    return f"{onset:+.6f}".encode("ascii") + b"\x14\x14\x00"


def write_edf_plus(path: str | Path, synth: Synthesizer, recording: Recording,
                   *, phys_uv: float = DEFAULT_PHYS_UV,
                   start: Optional[_dt.datetime] = None,
                   extra_rows: Optional[Dict[str, np.ndarray]] = None,
                   events: Sequence[Tuple[float, Optional[float], str]] = (),
                   ) -> Dict:
    """Stream ``synth`` to a conforming EDF+C file.

    ``events`` become annotations.  Pass none for a learner copy.
    """
    path = Path(path).with_suffix(".edf")
    fs = int(recording.sample_rate)
    rec_s = _record_duration(fs)
    spr = int(round(fs * rec_s))
    n_expected = recording.n_samples
    n_records = int(np.ceil(n_expected / spr))

    extra_rows = dict(extra_rows or {})
    extra_order = [c for c in recording.channels if c in extra_rows]
    labels = list(recording.channels)
    n_sig = len(labels)

    # Annotations are placed in the record that contains their onset; the first
    # TAL of every record is the timekeeping one, present even when empty.
    per_record: List[List[bytes]] = [[] for _ in range(n_records)]
    for onset, dur, text in events:
        idx = int(onset // rec_s)
        if 0 <= idx < n_records:
            per_record[idx].append(_tal(float(onset), dur, str(text)))
    payloads: List[bytes] = []
    for i in range(n_records):
        payloads.append(_timekeeping(i * rec_s) + b"".join(per_record[i]))
    annot_bytes = max(max((len(p) for p in payloads), default=0), 16)
    if annot_bytes % 2:
        annot_bytes += 1
    annot_spr = annot_bytes // 2

    start = start or _dt.datetime(2026, 1, 1, 0, 0, 0)
    gain = 65535.0 / (2.0 * phys_uv)
    offset = 32767.0 - gain * phys_uv          # exact affine map onto -32768..32767

    header = bytearray()
    header += _pad("0", 8)
    header += _pad("X X X SYNTHETIC_NOT_A_PATIENT", 80)
    header += _pad(f"Startdate {_edf_date(start)} X PedQuEST eeg_render "
                   f"{recording.renderer_version}", 80)
    header += _pad(f"{start:%d.%m.%y}", 8)
    header += _pad(f"{start:%H.%M.%S}", 8)
    header += _pad(str(256 * (n_sig + 2)), 8)
    header += _pad("EDF+C", 44)
    header += _pad(str(n_records), 8)
    header += _num(rec_s, 8)
    header += _pad(str(n_sig + 1), 4)

    def each(fn) -> bytes:
        return b"".join(fn(i) for i in range(n_sig)) + fn(None)

    header += each(lambda i: _pad(labels[i] if i is not None else _ANNOT_LABEL, 16))
    header += each(lambda i: _pad("" if i is None else "AgAgCl electrode", 80))
    header += each(lambda i: _pad("" if i is None else "uV", 8))
    header += each(lambda i: _num(-1 if i is None else -phys_uv, 8))
    header += each(lambda i: _num(1 if i is None else phys_uv, 8))
    header += each(lambda i: _pad("-32768", 8))
    header += each(lambda i: _pad("32767", 8))
    header += each(lambda i: _pad("" if i is None else "HP:0.16s LP:70Hz", 80))
    header += each(lambda i: _pad(str(annot_spr if i is None else spr), 8))
    header += each(lambda i: _pad("", 32))

    if len(header) != 256 * (n_sig + 2):
        raise EdfExportError(f"header is {len(header)} bytes, expected {256 * (n_sig + 2)}")

    clipped = 0
    peak = 0.0
    written = 0
    rec_i = 0
    pending = np.zeros((n_sig, 0), dtype=np.float64)

    with path.open("wb") as fh:
        fh.write(bytes(header))

        def flush(buf: np.ndarray, final: bool) -> np.ndarray:
            nonlocal clipped, peak, rec_i
            while buf.shape[1] >= spr or (final and buf.shape[1] > 0):
                take = buf[:, :spr]
                if take.shape[1] < spr:        # pad the trailing partial record
                    take = np.pad(take, ((0, 0), (0, spr - take.shape[1])))
                peak = max(peak, float(np.abs(take).max()))
                d = np.rint(take * gain + offset)
                clipped += int(np.count_nonzero((d < -32768) | (d > 32767)))
                fh.write(np.clip(d, -32768, 32767).astype("<i2").tobytes(order="C"))
                payload = payloads[rec_i] if rec_i < len(payloads) else _timekeeping(rec_i * rec_s)
                fh.write(payload.ljust(annot_bytes, b"\x00"))
                rec_i += 1
                buf = buf[:, spr:]
                if buf.shape[1] == 0:
                    break
            return buf

        for start_sample, block in iter_blocks(synth, n_expected):
            if extra_order:
                block = np.vstack([block] + [
                    extra_rows[c][start_sample:start_sample + block.shape[1]][None, :]
                    for c in extra_order
                ])
            if not np.all(np.isfinite(block)):
                raise EdfExportError(f"non-finite sample at {start_sample / fs:.3f}s")
            written += block.shape[1]
            pending = flush(np.concatenate([pending, block], axis=1), final=False)
        pending = flush(pending, final=True)

    if written != n_expected:
        raise EdfExportError(f"wrote {written} samples, expected {n_expected}")
    if rec_i != n_records:
        raise EdfExportError(f"wrote {rec_i} records, header declares {n_records}")

    return {
        "edf": str(path),
        "samples": written,
        "signals": n_sig + 1,
        "records": n_records,
        "record_duration_s": rec_s,
        "physical_range_uv": phys_uv,
        "clipped_samples": clipped,
        "peak_uv": round(peak, 3),
        "annotations": len(events),
        # The trailing partial record is zero-padded rather than dropped, so the
        # file is longer than the recording; say by how much instead of leaving
        # unlabelled time at the end.
        "padded_samples": n_records * spr - n_expected,
    }
