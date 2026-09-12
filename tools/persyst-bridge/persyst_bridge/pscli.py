"""Run Persyst's ``PSCLI.exe`` unattended.

Everything encoded here was measured on 2026-09-11/12 against Persyst 15
(``15C3:2026.05.07``) -- see ``docs/PSCLI_PHASE0A_RESULTS.md``.  The parts that
are easy to get wrong:

* ``/Process`` faults with ``0xC0000005`` (access violation) on roughly one run
  in three -- five faults in eighteen runs on *unchanged bytes*.  That one exit
  code is retryable.  Every other non-zero exit is a real failure and blanket
  retrying it would hide bugs.
* A faulted run leaves partial ``<name>.Persyst\\`` products behind, so every
  attempt gets a **fresh** working directory rather than reusing a dirty one.
* Unspecified flags come from persisted GUI state (the 0c run applied ``d=2``
  where the CLI help documents ``1.0``), so ``/MMX``, ``/Panel`` and
  ``/ArtifactReduction`` are always passed explicitly.
* The licence is refetched every 48 h and a April 2026 log shows a modal
  "License Expired" dialog.  A modal turns any step into an infinite hang, so
  every call carries a hard timeout and the process tree is killed on expiry.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Sequence

#: The install probed on CraigsRig.  Override with ``PERSYST_PSCLI``.
DEFAULT_PSCLI = Path(r"C:\Program Files (x86)\Persyst\Insight\PSCLI.exe")

#: Where the stock and research MMX presets live.  They are referenced **by
#: name** and never copied -- redistribution rights are unestablished.
DEFAULT_DATA_DIR = Path(r"C:\ProgramData\Persyst")

#: STATUS_ACCESS_VIOLATION.  Python reports Windows exit codes unsigned on some
#: builds and signed on others, so compare through :func:`is_access_violation`.
ACCESS_VIOLATION = 0xC0000005

CREATE_NO_WINDOW = 0x08000000

#: Characters that would turn a ``/SourceFile`` into a pattern.  This machine
#: mounts real patient recordings on other drives; a wildcard that escaped the
#: job scratch directory could hand them to Persyst.
_WILDCARDS = '*?"<>|'

_VERSION_RE = re.compile(r"\b\d+[A-Za-z]?\d*:\d{4}\.\d{2}\.\d{2}\b")

log = logging.getLogger(__name__)


class PscliError(RuntimeError):
    """A PSCLI call failed, or was refused before it was made.

    ``permanent`` separates a real failure -- a missing preset, a source path
    outside the scratch root, any non-zero exit that is *not* the known
    intermittent fault -- from a run that may well succeed next time: the
    ``0xC0000005`` fault, and a timeout (which is what an expired licence's
    modal dialog looks like, and the licence is refetched every 48 h).
    Only the latter is worth another claim.
    """

    def __init__(self, message: str, result: "StepResult | None" = None,
                 permanent: bool = False) -> None:
        super().__init__(message)
        self.result = result
        self.permanent = permanent


def signed32(code: int) -> int:
    """Fold a Windows exit code into ``int4`` range.

    ``eeg_lab_jobs.last_exit_code`` is an ``INT``.  An access violation read as
    unsigned is 3,221,225,477 -- which overflows ``int4`` and would make the
    status update fail at the exact moment we are trying to record a failure.
    """
    return ((int(code) + 2**31) % 2**32) - 2**31


def is_access_violation(code: int | None) -> bool:
    """True for ``0xC0000005`` in either sign convention."""
    return code is not None and (int(code) & 0xFFFFFFFF) == ACCESS_VIOLATION


def find_pscli(override: str | os.PathLike[str] | None = None) -> Path:
    candidates: list[Path] = []
    if override:
        candidates.append(Path(override))
    env = os.getenv("PERSYST_PSCLI")
    if env:
        candidates.append(Path(env))
    candidates.append(DEFAULT_PSCLI)
    on_path = shutil.which("PSCLI.exe") or shutil.which("PSCLI")
    if on_path:
        candidates.append(Path(on_path))
    for candidate in candidates:
        if candidate.is_file():
            return candidate.resolve()
    raise PscliError(
        f"PSCLI.exe not found (looked in: {', '.join(str(c) for c in candidates)})",
        permanent=True,
    )


def resolve_mmx(name: str, data_dir: str | os.PathLike[str] | None = None) -> Path:
    """Check an MMX preset is installed and return its path *for hashing only*.

    The name -- never the path -- is what goes on the command line.  Presets are
    referenced from the local install; they are not copied or vendored.
    """
    if not name:
        raise PscliError(
            "no MMX preset given; unspecified flags fall back to persisted GUI state",
            permanent=True,
        )
    if "/" in name or "\\" in name:
        raise PscliError(
            f"MMX presets are referenced by name, not by path: {name!r}", permanent=True
        )
    directory = Path(data_dir or os.getenv("PERSYST_DATA_DIR") or DEFAULT_DATA_DIR)
    path = directory / name
    if not path.is_file():
        raise PscliError(
            f"MMX preset {name!r} is not installed in {directory}", permanent=True
        )
    return path


def guard_source(path: str | os.PathLike[str], root: str | os.PathLike[str]) -> Path:
    """Refuse any ``/SourceFile`` that is not a real file inside ``root``."""
    resolved = Path(path).resolve()
    scope = Path(root).resolve()
    text = str(resolved)
    if any(ch in text for ch in _WILDCARDS):
        raise PscliError(f"refusing a wildcard /SourceFile: {text}", permanent=True)
    if not resolved.is_relative_to(scope):
        raise PscliError(
            f"refusing a /SourceFile outside the job scratch root {scope}: {text}",
            permanent=True,
        )
    if resolved.parent == Path(resolved.anchor):
        raise PscliError(f"refusing a /SourceFile at a drive root: {text}", permanent=True)
    if not resolved.is_file():
        raise PscliError(f"/SourceFile does not exist: {text}", permanent=True)
    return resolved


@dataclass
class StepResult:
    step: str
    exit_code: int
    seconds: float
    attempt: int = 1
    timed_out: bool = False
    output: str = ""
    args: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return self.exit_code == 0 and not self.timed_out

    @property
    def faulted(self) -> bool:
        return is_access_violation(self.exit_code)

    def as_report(self) -> dict:
        row: dict = {
            "step": self.step,
            "exit_code": signed32(self.exit_code),
            "seconds": round(self.seconds, 2),
            "attempt": self.attempt,
        }
        if self.timed_out:
            row["timed_out"] = True
        if self.faulted:
            row["fault"] = "0xC0000005"
        return row


def _kill_tree(proc: subprocess.Popen) -> None:
    if os.name == "nt":
        try:
            subprocess.run(
                ["taskkill", "/T", "/F", "/PID", str(proc.pid)],
                capture_output=True, timeout=30, check=False,
            )
            return
        except Exception:  # taskkill missing or itself wedged
            log.warning("taskkill failed for pid %s; falling back to kill()", proc.pid)
    try:
        proc.kill()
    except Exception:
        pass


def run(exe: Path, args: Sequence[str], *, step: str, timeout: float,
        cwd: str | os.PathLike[str] | None = None, attempt: int = 1) -> StepResult:
    """Run one PSCLI call with a hard timeout.  Never raises on a bad exit."""
    argv = [str(exe), *args]
    creationflags = CREATE_NO_WINDOW if os.name == "nt" else 0
    log.info("pscli %s: %s (timeout %.0fs)", step, " ".join(args), timeout)
    started = time.monotonic()
    proc = subprocess.Popen(
        argv,
        cwd=str(cwd) if cwd else None,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=creationflags,
        shell=False,  # no shell means no glob expansion of any argument
    )
    timed_out = False
    try:
        output, _ = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        _kill_tree(proc)
        try:
            output, _ = proc.communicate(timeout=30)
        except Exception:
            output = ""
        log.error("pscli %s timed out after %.0fs and was killed", step, timeout)
    seconds = time.monotonic() - started
    return StepResult(
        step=step,
        exit_code=proc.returncode if proc.returncode is not None else -1,
        seconds=seconds,
        attempt=attempt,
        timed_out=timed_out,
        output=(output or "")[-2000:],
        args=list(args),
    )


def probe_licence(exe: Path, timeout: float = 60.0) -> dict:
    """``PSCLI /Version`` as a licence-health check.

    The licence is refetched every 48 h.  When it has lapsed the observed
    failure mode is a modal dialog, which shows up here as a timeout rather than
    a non-zero exit -- so a timeout is treated as "unhealthy", not "slow".

    The exit-code convention of ``/Version`` itself is not documented; a version
    string in the output is accepted as healthy even if the exit code is not 0.
    """
    result = run(exe, ["/Version"], step="version", timeout=timeout)
    text = (result.output or "").strip()
    match = _VERSION_RE.search(text)
    return {
        "ok": bool(match) or result.ok,
        "version": match.group(0) if match else None,
        "exit_code": signed32(result.exit_code),
        "timed_out": result.timed_out,
        "output": text[:200],
    }


def process_with_retry(exe: Path, sources: Sequence[Path], work_root: Path, *,
                       mmx: str, timeout: float, max_attempts: int = 5,
                       backoff: float = 5.0, keep_failed: bool = False,
                       sleep: Callable[[float], None] = time.sleep,
                       ) -> tuple[Path, list[StepResult]]:
    """``/Process`` the recording, retrying **only** on ``0xC0000005``.

    Each attempt copies ``sources`` into a brand-new ``attempt-N`` directory
    under ``work_root``: a faulted run leaves partial ``<name>.Persyst\\``
    products behind, and re-processing over them is not the same experiment.

    Returns the ``.lay`` inside the attempt directory that succeeded, plus one
    :class:`StepResult` per attempt.
    """
    if not sources:
        raise PscliError("no source files to process", permanent=True)
    work_root = Path(work_root)
    attempts: list[StepResult] = []
    max_attempts = max(1, int(max_attempts))

    for attempt in range(1, max_attempts + 1):
        attempt_dir = work_root / f"attempt-{attempt}"
        if attempt_dir.exists():
            shutil.rmtree(attempt_dir, ignore_errors=True)
        attempt_dir.mkdir(parents=True)
        staged = [Path(shutil.copy2(src, attempt_dir / Path(src).name)) for src in sources]
        lay = guard_source(staged[0], work_root)

        result = run(
            exe, [f"/SourceFile={lay}", "/Process", f"/MMX={mmx}"],
            step="process", timeout=timeout, cwd=attempt_dir, attempt=attempt,
        )
        attempts.append(result)
        if result.ok:
            return lay, attempts

        if result.timed_out:
            raise PscliError(
                f"/Process timed out after {timeout:.0f}s on attempt {attempt} "
                "(a modal licence dialog looks exactly like this)",
                result,
            )
        if not result.faulted:
            raise PscliError(
                f"/Process failed with exit code {signed32(result.exit_code)} "
                "-- not the retryable access violation, so not retried",
                result,
                permanent=True,
            )

        log.warning("/Process faulted with 0xC0000005 on attempt %d/%d", attempt, max_attempts)
        if not keep_failed:
            shutil.rmtree(attempt_dir, ignore_errors=True)
        if attempt < max_attempts:
            sleep(backoff * (2 ** (attempt - 1)))

    raise PscliError(
        f"/Process faulted with 0xC0000005 on all {max_attempts} attempts",
        attempts[-1],
    )


def detect_seizures(exe: Path, lay: Path, *, timeout: float, work_root: Path) -> StepResult:
    """``/DetectSeizures``.  **Must run before the CSV export** -- it writes its
    findings into the source ``.lay``'s ``[Comments]``, and ``/ExportCSV`` does
    not carry them.
    """
    lay = guard_source(lay, work_root)
    result = run(exe, [f"/SourceFile={lay}", "/DetectSeizures"],
                 step="detect_seizures", timeout=timeout, cwd=lay.parent)
    if not result.ok:
        raise PscliError(
            f"/DetectSeizures failed with exit code {signed32(result.exit_code)}"
            + (" (timed out)" if result.timed_out else ""),
            result,
            permanent=not result.timed_out,
        )
    return result


def export_csv(exe: Path, lay: Path, out_csv: Path, *, mmx: str, panel: str,
               artifact_reduction: str, timeout: float, work_root: Path) -> StepResult:
    """``/ExportCSV``.  All three of ``/MMX``, ``/Panel`` and
    ``/ArtifactReduction`` are passed explicitly; omitting any of them means the
    run inherits persisted GUI state and is not reproducible.
    """
    lay = guard_source(lay, work_root)
    out_csv = Path(out_csv)
    result = run(
        exe,
        [
            f"/SourceFile={lay}",
            "/ExportCSV",
            f"/MMX={mmx}",
            f"/Panel={panel}",
            f"/OutputFile={out_csv}",
            f"/ArtifactReduction={artifact_reduction}",
        ],
        step="export_csv", timeout=timeout, cwd=lay.parent,
    )
    if not result.ok:
        raise PscliError(
            f"/ExportCSV failed with exit code {signed32(result.exit_code)}"
            + (" (timed out)" if result.timed_out else ""),
            result,
            permanent=not result.timed_out,
        )
    if not out_csv.is_file():
        raise PscliError("/ExportCSV exited 0 but wrote no output file", result, permanent=True)
    return result


def step_timeout(step: str, duration_s: float) -> float:
    """Hard timeouts, scaled off the recording length.

    Measured throughput was ~31x real time for ``/Process`` (57 s for a 30 min
    record) and far faster for the other two.  These bounds are deliberately an
    order of magnitude looser than that: they exist to break a modal-dialog hang,
    not to police performance.
    """
    duration_s = max(0.0, float(duration_s or 0.0))
    if step == "process":
        return max(600.0, duration_s)
    if step == "detect_seizures":
        return max(300.0, duration_s / 2.0)
    if step == "export_csv":
        return max(300.0, duration_s / 10.0)
    return 60.0


def collect_products(lay: Path) -> dict:
    """Products Persyst left next to the recording, for provenance.

    ``<name>.Persyst\\mg2.montages.xml`` is the montage configuration actually
    used -- the record to keep alongside the MMX hash.
    """
    lay = Path(lay)
    stem = lay.with_suffix("").name
    products: dict = {}
    persyst_dir = lay.parent / f"{stem}.Persyst"
    if persyst_dir.is_dir():
        products["persyst_dir_files"] = len(list(persyst_dir.iterdir()))
        montages = persyst_dir / "mg2.montages.xml"
        if montages.is_file():
            products["montages_xml"] = str(montages)
    for suffix in (".mg2", ".sd4"):
        candidate = lay.with_suffix(suffix)
        if candidate.is_file():
            products[suffix.lstrip(".")] = candidate.stat().st_size
    return products

