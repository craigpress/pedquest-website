"""Read back what Persyst produced.

A zero exit code from PSCLI does not mean the trends are meaningful.  Two
failures measured on 2026-09-11 are completely silent -- no warning, no ``NaN``,
clean stderr, exit 0:

* **VsBaseline all zero.**  No baseline window exists when the record is shorter
  than the MMX's ``AutoSearch`` window (adult ``StartTime=270`` + ``Duration=300``
  s, neonatal 300 + 600 s).  An all-zero VsBaseline column is indistinguishable
  from "signal equals baseline", so it is treated as *baseline unavailable*.
* **Heart Rate all zero.**  No channel name matched the MMX's ``AutoEKGChannels``.
  Adding a row literally named ``EKG`` took it from all-zero to 0-101.7 bpm.

Both were confirmed from the other direction in Phase 0c: with a baseline window
and a named EKG row, the same instruments produced real values.  That is what
makes the all-zero signature usable as a sentinel rather than a guess.

``Comment`` and ``Time`` are excluded from the sentinel: they are all-zero in
*both* a good export and a bad one, so they are never evidence of anything.

The ``.lay`` side parses the ``[Comments]`` block that ``/DetectSeizures`` writes
--  ``time,duration,state,type,text`` with text like
``@SeizureDetected(P14) p=0.949`` -- and tolerates ``/Process`` having renamed
every channel to ``<name>-Ref`` in ``[ChannelMap]``.
"""

from __future__ import annotations

import csv
import itertools
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Iterator, Sequence

#: ``I<instrument>_<subcolumn>`` in the CSV's code row.
_CODE_RE = re.compile(r"^I(\d+)_(\d+)$")

#: Structurally zero in every export measured, good or bad.  Never a sentinel.
_PSEUDO_INSTRUMENTS = {"comment", "time"}

#: Documented, not read from the ``.mmx`` (which is a proprietary binary we do
#: not parse).  ``(AutoSearch StartTime, Duration)`` in seconds.
AUTOSEARCH_WINDOWS = {"adult": (270.0, 300.0), "neonatal": (300.0, 600.0)}

_SECTION_RE = re.compile(r"^\[(.+)\]$")
_TAG_RE = re.compile(r"^(?P<kind>[A-Za-z][A-Za-z0-9_]*)\((?P<detector>[^)]*)\)\s*(?P<rest>.*)$")
_KV_RE = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)=([^\s,]+)")


# --------------------------------------------------------------------------
# exported trends CSV
# --------------------------------------------------------------------------

@dataclass
class Instrument:
    """One ``I<n>`` instrument, accumulated across every sub-column and row."""

    id: str
    description: str = ""
    columns: list[int] = field(default_factory=list)
    n: int = 0
    zeros: int = 0
    nonfinite: int = 0
    unparsed: int = 0
    minimum: float | None = None
    maximum: float | None = None

    @property
    def all_zero(self) -> bool:
        return self.n > 0 and self.zeros == self.n

    @property
    def pseudo(self) -> bool:
        return self.description.strip().lower() in _PSEUDO_INSTRUMENTS

    def observe(self, raw: str) -> None:
        text = (raw or "").strip()
        if not text:
            self.unparsed += 1
            return
        try:
            value = float(text)
        except ValueError:
            self.unparsed += 1
            return
        if not math.isfinite(value):
            self.nonfinite += 1
            return
        self.n += 1
        if value == 0.0:
            self.zeros += 1
        self.minimum = value if self.minimum is None else min(self.minimum, value)
        self.maximum = value if self.maximum is None else max(self.maximum, value)

    def as_report(self) -> dict:
        return {
            "id": self.id,
            "description": self.description,
            "sub_columns": len(self.columns),
            "n": self.n,
            "zeros": self.zeros,
            "min": None if self.minimum is None else round(self.minimum, 5),
            "max": None if self.maximum is None else round(self.maximum, 5),
        }


def _is_baseline(description: str) -> bool:
    return description.strip().lower().startswith("vsbaseline")


def _is_heart_rate(description: str) -> bool:
    return " ".join(description.split()).lower() == "heart rate"


def _find_code_row(head: Sequence[Sequence[str]]) -> int:
    """Index of the ``ClockDateTime,Time,I1_1,...`` row.

    Measured at index 7 with descriptions at 6, but located by shape rather than
    hardcoded -- a different panel changes the metadata block's length.
    """
    for index, row in enumerate(head):
        if any(_CODE_RE.match((cell or "").strip()) for cell in row):
            return index
    raise ValueError("no instrument code row (I<n>_<m>) found in the CSV header")


def inspect_rows(rows: Iterable[Sequence[str]], *, head_limit: int = 32) -> dict:
    """Scan an exported trends CSV, row by row, without holding it in memory."""
    stream: Iterator[Sequence[str]] = iter(rows)
    head: list[Sequence[str]] = []
    for row in stream:
        head.append(list(row))
        if len(head) >= head_limit:
            break
    code_index = _find_code_row(head)
    code_row = head[code_index]
    desc_row = head[code_index - 1] if code_index else []

    metadata: dict[str, str] = {}
    for row in head[: max(0, code_index - 1)]:
        if row and (row[0] or "").strip():
            # PatientName is written unquoted as "Last, First" -- rejoin the tail.
            metadata[row[0].strip()] = ",".join(str(c) for c in row[1:]).strip()

    instruments: dict[str, Instrument] = {}
    column_owner: dict[int, str] = {}
    for column, cell in enumerate(code_row):
        match = _CODE_RE.match((cell or "").strip())
        if not match:
            continue
        ident = f"I{match.group(1)}"
        instrument = instruments.setdefault(ident, Instrument(id=ident))
        instrument.columns.append(column)
        column_owner[column] = ident
        if not instrument.description and column < len(desc_row):
            instrument.description = (desc_row[column] or "").strip()

    data_rows = 0
    for row in itertools.chain(head[code_index + 1:], stream):
        if not row or all(not (cell or "").strip() for cell in row):
            continue
        data_rows += 1
        for column, ident in column_owner.items():
            if column < len(row):
                instruments[ident].observe(row[column])

    return _summarize(list(instruments.values()), data_rows, metadata)


def _summarize(instruments: list[Instrument], data_rows: int, metadata: dict) -> dict:
    warnings: list[str] = []
    baselines = [i for i in instruments if _is_baseline(i.description)]
    hearts = [i for i in instruments if _is_heart_rate(i.description)]
    real = [i for i in instruments if not i.pseudo]

    if not data_rows:
        baseline_state = heart_state = "unavailable"
        warnings.append("the export contains no data rows")
    else:
        if not baselines:
            baseline_state = "absent"
            warnings.append("no VsBaseline instrument in this panel; baseline was not verified")
        elif all(i.all_zero for i in baselines):
            baseline_state = "unavailable"
        elif any(i.all_zero for i in baselines):
            baseline_state = "partial"
            warnings.append(
                "some VsBaseline instruments are all zero and some are not: "
                + ", ".join(i.id for i in baselines if i.all_zero)
            )
        else:
            baseline_state = "ok"

        if not hearts:
            heart_state = "absent"
            warnings.append("no Heart Rate instrument in this panel")
        elif all(i.all_zero for i in hearts):
            heart_state = "unavailable"
        else:
            heart_state = "ok"

    if real and all(i.all_zero for i in real):
        warnings.append(
            "every instrument is all zero -- the run exited 0 but produced no trends"
        )
    nonfinite = sum(i.nonfinite for i in instruments)
    if nonfinite:
        warnings.append(f"{nonfinite} non-finite values in the export")

    return {
        "csv_rows": data_rows,
        "metadata": metadata,
        "baseline": baseline_state,
        "heart_rate": heart_state,
        "baseline_instruments": [i.id for i in baselines],
        "heart_rate_instruments": [i.id for i in hearts],
        "instruments": [i.as_report() for i in instruments],
        "warnings": warnings,
    }


def inspect_trends_csv(path: str | Path, **kwargs) -> dict:
    with open(path, newline="", encoding="utf-8-sig", errors="replace") as handle:
        return inspect_rows(csv.reader(handle), **kwargs)


def autosearch_window(mmx_name: str) -> tuple[str, float, float]:
    """``(family, start_s, duration_s)`` for the preset's baseline auto-search."""
    family = "neonatal" if "neonatal" in (mmx_name or "").lower() else "adult"
    start, duration = AUTOSEARCH_WINDOWS[family]
    return family, start, duration


def explain_missing_baseline(mmx_name: str, duration_s: float | None) -> str | None:
    """Why a baseline is missing, when the recording length explains it."""
    if duration_s is None:
        return None
    family, start, window = autosearch_window(mmx_name)
    needed = start + window
    if float(duration_s) < needed:
        return (
            f"recording is {float(duration_s):.0f} s but the {family} MMX AutoSearch "
            f"window ends at {needed:.0f} s (StartTime={start:.0f} + Duration={window:.0f}), "
            "so no baseline window exists"
        )
    return None


# --------------------------------------------------------------------------
# .lay [Comments] and [ChannelMap]
# --------------------------------------------------------------------------

def _coerce(text: str):
    try:
        return int(text)
    except ValueError:
        pass
    try:
        return float(text)
    except ValueError:
        return text


def _iter_section_lines(text: str) -> Iterator[tuple[str, str]]:
    section = ""
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        match = _SECTION_RE.match(line)
        if match:
            section = match.group(1).strip().lower()
            continue
        yield section, line


def parse_lay(text: str) -> dict:
    """Parse a processed ``.lay``: detections, detector provenance, channels."""
    detections: list[dict] = []
    notes: list[dict] = []
    warnings: list[str] = []
    detector: dict | None = None
    channels: list[str] = []
    renamed = False
    comment_lines = 0

    for section, line in _iter_section_lines(text):
        if section == "comments":
            parsed = _parse_comment(line)
            if parsed is None:
                continue
            comment_lines += 1
            kind = parsed.get("kind") or ""
            if kind.endswith("Detected"):
                detections.append(parsed)
            elif kind == "SeizuresProcessed":
                detector = {
                    "detector": parsed.get("detector"),
                    **{k: v for k, v in parsed.get("attrs", {}).items()},
                }
            elif parsed["text"].lstrip("@").lower().startswith("warning"):
                warnings.append(parsed["text"].lstrip("@"))
            else:
                notes.append(parsed)
        elif section == "channelmap":
            name = line.split("=", 1)[0].strip()
            if not name:
                continue
            if name.lower().endswith("-ref"):
                renamed = True
                name = name[: -len("-Ref")]
            channels.append(name)

    return {
        "detections": detections,
        "detector": detector,
        "lay_warnings": warnings,
        "lay_notes": notes,
        "comment_lines": comment_lines,
        "channels": channels,
        "channels_renamed": renamed,
    }


def _parse_comment(line: str) -> dict | None:
    """``time,duration,state,type,text`` -- text may itself contain commas."""
    parts = line.split(",", 4)
    if len(parts) < 5:
        return None
    try:
        onset = float(parts[0])
        duration = float(parts[1])
    except ValueError:
        return None
    try:
        state = int(parts[2])
        type_code = int(parts[3])
    except ValueError:
        state, type_code = None, None

    text = parts[4].strip()
    entry: dict = {
        "onset_s": onset,
        "duration_s": duration,
        "state": state,
        "type": type_code,
        "text": text,
    }
    tag = _TAG_RE.match(text.lstrip("@"))
    if tag:
        attrs = {k: _coerce(v) for k, v in _KV_RE.findall(tag.group("rest"))}
        entry["kind"] = tag.group("kind")
        entry["detector"] = tag.group("detector") or None
        entry["attrs"] = attrs
        probability = attrs.get("p")
        if isinstance(probability, (int, float)):
            entry["probability"] = float(probability)
    return entry


def inspect_lay(path: str | Path) -> dict:
    return parse_lay(Path(path).read_text(encoding="ascii", errors="replace"))
