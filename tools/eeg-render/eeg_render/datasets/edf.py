"""Minimal EDF / EDF+ reader.

Both permitted datasets ship EDF, and EDF is simple enough that reading it
directly removes the need for ``mne`` or ``wfdb`` on the render path - they
stay optional extras.  Only what the renderer needs is implemented: header
metadata, per-signal calibration, and a time-range read.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

import numpy as np


@dataclass
class EdfHeader:
    n_signals: int
    n_records: int
    record_duration_s: float
    labels: List[str]
    phys_min: np.ndarray
    phys_max: np.ndarray
    dig_min: np.ndarray
    dig_max: np.ndarray
    samples_per_record: np.ndarray
    units: List[str]
    header_bytes: int

    @property
    def sample_rates(self) -> np.ndarray:
        return self.samples_per_record / self.record_duration_s

    @property
    def duration_s(self) -> float:
        return self.n_records * self.record_duration_s


def read_header(path: str | Path) -> EdfHeader:
    with open(path, "rb") as fh:
        raw = fh.read(256)
        if len(raw) < 256:
            raise ValueError(f"{path}: too short to be EDF")
        n_records = int(raw[236:244].decode("ascii", "replace").strip() or -1)
        record_duration = float(raw[244:252].decode("ascii", "replace").strip() or 1.0)
        ns = int(raw[252:256].decode("ascii", "replace").strip() or 0)
        if ns <= 0:
            raise ValueError(f"{path}: EDF header declares {ns} signals")

        def field(width: int) -> List[str]:
            block = fh.read(width * ns).decode("ascii", "replace")
            return [block[i * width:(i + 1) * width].strip() for i in range(ns)]

        labels = field(16)
        field(80)                      # transducer
        units = field(8)
        pmin = np.array([float(v) for v in field(8)])
        pmax = np.array([float(v) for v in field(8)])
        dmin = np.array([float(v) for v in field(8)])
        dmax = np.array([float(v) for v in field(8)])
        field(80)                      # prefiltering
        spr = np.array([int(v) for v in field(8)])
        field(32)                      # reserved
        header_bytes = 256 + 256 * ns

    if n_records < 0:                  # unknown record count: infer from file size
        size = Path(path).stat().st_size - header_bytes
        n_records = int(size // (int(spr.sum()) * 2))
    return EdfHeader(ns, n_records, record_duration, labels, pmin, pmax, dmin, dmax,
                     spr, units, header_bytes)


def read_signals(
    path: str | Path,
    start_s: float = 0.0,
    duration_s: Optional[float] = None,
    channels: Optional[Sequence[str]] = None,
) -> Tuple[np.ndarray, float, List[str]]:
    """Read a time range as ``(data uV, fs, labels)``.

    All requested channels must share a sample rate (true for both permitted
    datasets); a mixed-rate file raises rather than silently resampling.
    """
    hdr = read_header(path)
    idx = list(range(hdr.n_signals))
    if channels:
        wanted = {c.strip().lower(): i for i, c in enumerate(hdr.labels)}
        idx = []
        for c in channels:
            j = wanted.get(c.strip().lower())
            if j is None:
                raise KeyError(f"{path}: no channel {c!r} (have {hdr.labels})")
            idx.append(j)
    rates = hdr.sample_rates[idx]
    if len(set(np.round(rates, 6))) != 1:
        raise ValueError(f"{path}: mixed sample rates {sorted(set(rates))}")
    fs = float(rates[0])

    rec_n = int(hdr.samples_per_record.sum())
    offsets = np.concatenate([[0], np.cumsum(hdr.samples_per_record)]).astype(int)

    r0 = int(np.floor(start_s / hdr.record_duration_s))
    total = hdr.duration_s - start_s if duration_s is None else duration_s
    r1 = min(hdr.n_records, int(np.ceil((start_s + total) / hdr.record_duration_s)))
    r0 = max(0, min(r0, hdr.n_records))
    if r1 <= r0:
        raise ValueError(f"{path}: requested range {start_s}..{start_s + total} s "
                         f"is outside the {hdr.duration_s:g} s record")

    with open(path, "rb") as fh:
        fh.seek(hdr.header_bytes + r0 * rec_n * 2)
        blob = np.frombuffer(fh.read((r1 - r0) * rec_n * 2), dtype="<i2")
    blob = blob[: (r1 - r0) * rec_n].reshape(r1 - r0, rec_n)

    out = []
    for j in idx:
        chunk = blob[:, offsets[j]:offsets[j + 1]].reshape(-1).astype(np.float64)
        span_d = hdr.dig_max[j] - hdr.dig_min[j]
        span_p = hdr.phys_max[j] - hdr.phys_min[j]
        gain = span_p / span_d if span_d else 1.0
        chunk = (chunk - hdr.dig_min[j]) * gain + hdr.phys_min[j]
        if hdr.units[j].strip().lower() in ("mv",):
            chunk *= 1000.0
        elif hdr.units[j].strip().lower() in ("v",):
            chunk *= 1e6
        out.append(chunk)
    data = np.asarray(out)

    skip = int(round((start_s - r0 * hdr.record_duration_s) * fs))
    keep = int(round(total * fs))
    data = data[:, skip:skip + keep]
    return data, fs, [hdr.labels[j] for j in idx]


def write_edf(path: str | Path, data: np.ndarray, fs: float,
              labels: Sequence[str], phys_range: float = 500.0) -> None:
    """Write a minimal EDF (used by the loader tests; not a general writer)."""
    data = np.asarray(data, dtype=float)
    ns, n = data.shape
    spr = int(round(fs))
    n_records = n // spr
    data = data[:, : n_records * spr]

    def pad(s: str, w: int) -> bytes:
        return f"{s:<{w}}"[:w].encode("ascii", "replace")

    hdr = b""
    hdr += pad("0", 8) + pad("X", 80) + pad("X", 80)
    hdr += pad("01.01.00", 8) + pad("00.00.00", 8)
    hdr += pad(str(256 + 256 * ns), 8) + pad("EDF+C", 44)
    hdr += pad(str(n_records), 8) + pad("1", 8) + pad(str(ns), 4)
    hdr += b"".join(pad(l, 16) for l in labels)
    hdr += b"".join(pad("", 80) for _ in labels)
    hdr += b"".join(pad("uV", 8) for _ in labels)
    hdr += b"".join(pad(f"{-phys_range:g}", 8) for _ in labels)
    hdr += b"".join(pad(f"{phys_range:g}", 8) for _ in labels)
    hdr += b"".join(pad("-32768", 8) for _ in labels)
    hdr += b"".join(pad("32767", 8) for _ in labels)
    hdr += b"".join(pad("", 80) for _ in labels)
    hdr += b"".join(pad(str(spr), 8) for _ in labels)
    hdr += b"".join(pad("", 32) for _ in labels)

    dig = np.clip(np.round(data / phys_range * 32767.0), -32768, 32767).astype("<i2")
    body = dig.reshape(ns, n_records, spr).transpose(1, 0, 2).reshape(-1)
    with open(path, "wb") as fh:
        fh.write(hdr)
        fh.write(body.tobytes())
