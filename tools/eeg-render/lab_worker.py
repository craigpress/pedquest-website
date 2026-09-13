"""Claim ``stage='export'`` EEG Teaching Lab jobs and write the recordings.

Runs on the render host (moltbot, VM 200) as ``eeg-lab-export-worker``. Polls
``public.eeg_lab_jobs`` with the service-role key, runs ``eeg-render export``
for each claimed job, and writes the artifacts to the homelab recording store
-- the OMV shared folder ``eeg-lab`` mounted at ``EEG_LAB_DIR`` -- **not** to
Supabase Storage. Recordings are large and Craig wants them in a plain folder
he can open directly; the site serves them through eeglab.presshome.net with
expiring signed URLs (tools/eeglab-host/).

Artifact paths are recorded as ``eeglab://<recording_id>/<file>``; the
download route recognises the scheme and mints a secure_link URL for it, and
still signs Supabase paths for rows written before this worker existed.

Lease and retry semantics follow tools/persyst-bridge/worker.py: claimed rows
carry ``claimed_by`` + ``lease_expires_at`` and are heartbeated; a transient
failure releases to ``pending``; a malformed job goes straight to ``error``.
Policy from src/lib/lab/types.ts is enforced here, where it matters:
``--embed-answers`` is never passed, and ``--answers`` only when the job asked
for the separate key.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

log = logging.getLogger("eeg-lab-export")

JOB_COLUMNS = (
    "id,stage,status,spec,duration_s,formats,options,recording_id,spec_hash,"
    "renderer_version,attempts,max_attempts,claimed_by,lease_expires_at,parent_job_id,created_at"
)
STAMP = "SYNTHETIC — NOT A PATIENT RECORDING"


class PermanentError(RuntimeError):
    """The job cannot succeed however many times it is retried."""


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(moment: datetime) -> str:
    return moment.isoformat().replace("+00:00", "Z")


def _q(value: Any) -> str:
    return quote(str(value), safe="")


# --------------------------------------------------------------------------
# Supabase (PostgREST only -- no storage)
# --------------------------------------------------------------------------

class Supabase:
    def __init__(self) -> None:
        self.base = (os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL") or "").rstrip("/")
        self.key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SECRET_KEY") or ""
        if not self.base or not self.key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")

    def request(self, path: str, method: str = "GET", body: Any = None,
                extra: dict[str, str] | None = None, timeout: float = 60.0) -> Any:
        payload = None if body is None else json.dumps(body).encode("utf-8")
        headers = {"apikey": self.key, "Authorization": f"Bearer {self.key}",
                   "Content-Type": "application/json", **(extra or {})}
        req = Request(f"{self.base}{path}", data=payload, headers=headers, method=method)
        try:
            with urlopen(req, timeout=timeout) as response:
                data = response.read()
                return json.loads(data) if data else None
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase {method} returned {error.code}: {detail[:300]} ({path[:120]})") from error


# --------------------------------------------------------------------------
# lease
# --------------------------------------------------------------------------

class Lease:
    def __init__(self, db: Supabase, job_id: str, worker_id: str, seconds: float) -> None:
        self.db, self.job_id, self.worker_id, self.seconds = db, job_id, worker_id, seconds
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def __enter__(self) -> "Lease":
        self._thread.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        self._stop.set()
        self._thread.join(timeout=5)

    def _run(self) -> None:
        while not self._stop.wait(self.seconds / 3):
            try:
                self.db.request(
                    f"/rest/v1/eeg_lab_jobs?id=eq.{_q(self.job_id)}&claimed_by=eq.{_q(self.worker_id)}",
                    "PATCH", {"lease_expires_at": iso(utcnow() + timedelta(seconds=self.seconds))},
                )
            except Exception:
                log.warning("heartbeat for %s failed", self.job_id, exc_info=True)


def _candidates(db: Supabase, limit: int = 5, min_age_s: float = 0.0) -> list[dict]:
    """Pending jobs oldest first, then running jobs whose lease has expired.

    ``min_age_s`` > 0 makes this worker a fallback: it only takes pending jobs
    that have sat unclaimed that long. With the CraigsRig pool polling every
    30 s and moltbot at 120 s, a website request goes to the fast host whenever
    it is up and to moltbot two minutes later when it is not. Expired leases are
    always eligible - a stalled job should be rescued by whoever is free.
    """
    base = f"/rest/v1/eeg_lab_jobs?stage=eq.export&select={JOB_COLUMNS}&order=created_at.asc&limit={limit}"
    age_filter = f"&created_at=lt.{_q(iso(utcnow() - timedelta(seconds=min_age_s)))}" if min_age_s > 0 else ""
    pending = db.request(f"{base}&status=eq.pending{age_filter}") or []
    expired = db.request(f"{base}&status=eq.running&lease_expires_at=lt.{_q(iso(utcnow()))}") or []
    return list(pending) + list(expired)


def claim_job(db: Supabase, worker_id: str, lease_seconds: float, min_age_s: float = 0.0) -> dict | None:
    for job in _candidates(db, min_age_s=min_age_s):
        attempts = int(job.get("attempts") or 0)
        max_attempts = int(job.get("max_attempts") or 5)
        if attempts >= max_attempts:
            db.request(f"/rest/v1/eeg_lab_jobs?id=eq.{_q(job['id'])}&status=eq.{job['status']}", "PATCH",
                       {"status": "error", "error": f"exhausted {attempts} of {max_attempts} attempts",
                        "lease_expires_at": None})
            log.error("job %s exhausted its %d attempts", job["id"], max_attempts)
            continue
        if job["status"] == "pending":
            where = f"id=eq.{_q(job['id'])}&status=eq.pending"
        else:
            lease = job.get("lease_expires_at")
            if not lease:
                continue
            where = f"id=eq.{_q(job['id'])}&status=eq.running&lease_expires_at=eq.{_q(lease)}"
        rows = db.request(
            f"/rest/v1/eeg_lab_jobs?{where}", "PATCH",
            {"status": "running", "claimed_by": worker_id,
             "lease_expires_at": iso(utcnow() + timedelta(seconds=lease_seconds)),
             "attempts": attempts + 1, "error": None, "last_exit_code": None},
            extra={"Prefer": "return=representation"},
        )
        if rows:
            claimed = job | rows[0]
            log.info("claimed %s (attempt %d/%d)", claimed["id"], attempts + 1, max_attempts)
            return claimed
    return None


def _release(db: Supabase, job: dict, worker_id: str, *, status: str, error: str,
             exit_code: int | None) -> None:
    patch: dict[str, Any] = {"status": status, "error": error[:2000], "lease_expires_at": None,
                             "last_exit_code": exit_code}
    if status == "pending":
        patch["claimed_by"] = None
    try:
        db.request(f"/rest/v1/eeg_lab_jobs?id=eq.{_q(job['id'])}&claimed_by=eq.{_q(worker_id)}", "PATCH", patch)
    except Exception:
        log.exception("could not record the failure of %s", job["id"])


# --------------------------------------------------------------------------
# the export
# --------------------------------------------------------------------------

def _parse_cli_report(stdout: str) -> dict:
    """Pick the numbers out of ``eeg-render export``'s human output."""
    report: dict[str, Any] = {}
    for line in stdout.splitlines():
        s = line.strip()
        if s.startswith("lay ") and "clipped" in s:
            try:
                report["peakUv"] = float(s.split("peak")[1].split("uV")[0])
                report["clippedSamples"] = int(s.split("clipped")[1].split()[0])
            except (IndexError, ValueError):
                pass
        elif s.startswith("edf ") and "clipped" in s:
            try:
                report["clippedSamples"] = max(int(report.get("clippedSamples", 0)),
                                               int(s.split("clipped")[1].split()[0]))
                report["paddedSamples"] = int(s.split("padded")[1].split()[0])
            except (IndexError, ValueError):
                pass
        elif s.startswith("recording "):
            parts = s.split()
            try:
                report["sampleRate"] = int(parts[parts.index("@") + 1])
                report["channels"] = int(parts[parts.index("ch") - 1])
            except (ValueError, IndexError):
                pass
        elif s.startswith("baseline:"):
            report["baseline"] = {"ok": False, "reasons": []}
        elif s.startswith("- ") and isinstance(report.get("baseline"), dict):
            report["baseline"]["reasons"].append(s[2:])
    report.setdefault("baseline", {"ok": True})
    return report


def run_job(db: Supabase, job: dict, cfg: argparse.Namespace) -> None:
    spec = job.get("spec")
    if not isinstance(spec, dict) or "kind" not in spec or "spec" not in spec:
        raise PermanentError("job spec is not an image block ({kind, spec})")
    duration_s = float(job.get("duration_s") or 0)
    if duration_s <= 0:
        raise PermanentError("job has no duration_s")
    formats = [f for f in (job.get("formats") or ["lay"]) if f in ("lay", "edf")]
    if not formats:
        raise PermanentError("job requests no exportable format")
    options = job.get("options") or {}
    recording_id = job.get("recording_id") or f"LAB-{job['id'][:8].upper()}"

    store = Path(cfg.store)
    if not store.is_dir():
        raise RuntimeError(f"recording store {store} is not mounted")  # transient: NFS may be down
    dest = store / recording_id
    work = Path(tempfile.mkdtemp(prefix="eeglab-", dir=cfg.workdir))
    try:
        spec_path = work / f"{recording_id}.json"
        block = dict(spec)
        block["id"] = recording_id
        spec_path.write_text(json.dumps(block), encoding="utf-8")

        cmd = [cfg.eeg_render, "export", str(spec_path), "--out", str(work / "out"),
               "--duration", f"{duration_s:g}", "--format", ",".join(formats)]
        if options.get("includeAnswers"):
            cmd.append("--answers")
        if cfg.render_jobs > 1:
            cmd += ["--jobs", str(cfg.render_jobs)]
        if options.get("ekgChannel") is False:
            cmd.append("--no-ekg")
        # Never --embed-answers: realized events must not enter the learner file.
        log.info("job %s: %s", job["id"], " ".join(cmd[1:]))
        env = dict(os.environ, OPENBLAS_NUM_THREADS="1", OMP_NUM_THREADS="1")
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=cfg.timeout, env=env)
        if proc.returncode != 0:
            tail = (proc.stderr or proc.stdout)[-1500:]
            raise RuntimeError(f"eeg-render export exited {proc.returncode}: {tail}")
        report = _parse_cli_report(proc.stdout)

        out = work / "out"
        produced = {p.suffix.lstrip(".").lower(): p for p in out.iterdir() if p.is_file()}
        artifacts: dict[str, str] = {}
        # A folder left by an interrupted attempt (host reboot mid-copy) holds
        # files this host may not be able to replace: the Windows NFS client
        # cannot overwrite or delete root-owned files. Clear it where we can;
        # otherwise write this attempt beside it. The artifact paths carry the
        # folder, and the download route signs any path under the store.
        folder = recording_id
        if dest.exists() and any(dest.iterdir()):
            try:
                shutil.rmtree(dest)
                log.warning("job %s: replaced a stale %s folder from an interrupted attempt", job["id"], recording_id)
            except OSError:
                folder = f"{recording_id}-a{int(job.get('attempts') or 0)}"
                dest = store / folder
                log.warning("job %s: %s exists and cannot be replaced from this host; writing %s",
                            job["id"], recording_id, folder)
        dest.mkdir(parents=True, exist_ok=True)
        mapping = {"lay": "lay", "dat": "dat", "edf": "edf"}
        for ext, key in mapping.items():
            src = produced.get(ext)
            if src:
                _copy_to_store(src, dest / src.name)
                artifacts[key] = f"eeglab://{folder}/{src.name}"
        # qEEG trends sidecar: the viewer's own engine (tools/trend-sidecar,
        # bundled to trend-sidecar.mjs) run once here, so no browser has to walk
        # the whole recording again. Computed from the LOCAL export output, not
        # the copy in the store: faster, and the Windows worker pool can write to
        # the NFS store but not read from it. Best effort: a failure logs and the
        # job still completes; the viewer falls back to computing.
        recording_local = next((produced[e] for e in ("edf", "lay") if e in produced), None)
        if recording_local and os.path.exists(cfg.trend_sidecar):
            try:
                side = subprocess.run(
                    ["node", cfg.trend_sidecar, str(recording_local), "--force"],
                    capture_output=True, text=True, timeout=cfg.sidecar_timeout, env=env, check=True,
                )
                info = json.loads(side.stdout.strip().splitlines()[-1])
                sidecar = Path(info["path"])
                _copy_to_store(sidecar, dest / sidecar.name)
                artifacts["trends"] = f"eeglab://{folder}/{sidecar.name}"
                log.info("job %s: trends sidecar %s (%d epochs, %d bytes)",
                         job["id"], sidecar.name, info.get("nT", 0), info.get("bytes", 0))
            except Exception as error:  # noqa: BLE001 - never fail the export over the sidecar
                log.warning("job %s: trends sidecar failed: %s", job["id"], str(error)[:400])

        key_file = out / f"{recording_id}.answers.json"
        if key_file.exists():
            # The instructor copy sits beside the recording but is only ever
            # handed out through the editor-gated download route.
            _copy_to_store(key_file, dest / key_file.name)
            artifacts["answers"] = f"eeglab://{folder}/{key_file.name}"
        (dest / "README.txt").write_text(
            f"{STAMP}\nrecording_id: {recording_id}\njob: {job['id']}\nspec_hash: {job.get('spec_hash')}\n"
            f"exported: {iso(utcnow())} by {socket.gethostname()}\n"
            "Generated by PedQuEST eeg-render for qEEG teaching. Not for clinical use.\n",
            encoding="utf-8")

        if not artifacts:
            raise RuntimeError("export produced no files")

        db.request(
            f"/rest/v1/eeg_lab_jobs?id=eq.{_q(job['id'])}&claimed_by=eq.{_q(cfg.worker_id)}", "PATCH",
            {"status": "done", "artifacts": artifacts, "report": report, "error": None,
             "lease_expires_at": None, "last_exit_code": 0,
             "renderer_version": _renderer_version(cfg.eeg_render)},
        )
        log.info("job %s done -> %s (%s)", job["id"], dest, ", ".join(sorted(artifacts)))

        if options.get("runPersyst") and "lay" in artifacts:
            db.request("/rest/v1/eeg_lab_jobs", "POST", {
                "stage": "persyst", "status": "pending", "spec": spec, "duration_s": duration_s,
                "formats": formats, "options": options, "recording_id": recording_id,
                "spec_hash": job.get("spec_hash"), "parent_job_id": job["id"],
                "artifacts": {k: v for k, v in artifacts.items() if k in ("lay", "dat")},
                "requested_by": None,
            })
            log.info("job %s: queued persyst stage", job["id"])
    finally:
        shutil.rmtree(work, ignore_errors=True)


_version_cache: dict[str, str] = {}


def _copy_to_store(src: Path, dst: Path) -> None:
    """Copy bytes into the recording store; timestamps are nice-to-have.

    shutil.copy2 = copyfile + copystat, and copystat (chmod/utime on the
    destination) is refused by the Windows NFS client, which cannot even read
    back the files it creates. The bytes are what matter.
    """
    shutil.copyfile(src, dst)
    try:
        shutil.copystat(src, dst)
    except OSError:
        pass


def _renderer_version(exe: str) -> str | None:
    if exe not in _version_cache:
        try:
            out = subprocess.run([exe, "--help"], capture_output=True, text=True, timeout=30).stdout
            _version_cache[exe] = out.split("renderer")[-1].split()[0] if "renderer" in out else ""
        except Exception:
            _version_cache[exe] = ""
    return _version_cache[exe] or None


def process_one(db: Supabase, cfg: argparse.Namespace) -> bool:
    job = claim_job(db, cfg.worker_id, cfg.lease, cfg.min_age)
    if not job:
        return False
    try:
        with Lease(db, job["id"], cfg.worker_id, cfg.lease):
            run_job(db, job, cfg)
    except PermanentError as error:
        log.error("job %s is malformed: %s", job["id"], error)
        _release(db, job, cfg.worker_id, status="error", error=str(error), exit_code=None)
    except subprocess.TimeoutExpired:
        _release(db, job, cfg.worker_id, status="pending", error="export timed out", exit_code=None)
    except Exception as error:  # transient: back to pending for another attempt
        log.exception("job %s failed", job["id"])
        _release(db, job, cfg.worker_id, status="pending", error=str(error), exit_code=None)
    return True


def main() -> int:
    p = argparse.ArgumentParser(description="EEG Teaching Lab export worker")
    p.add_argument("--store", default=os.getenv("EEG_LAB_DIR", "/mnt/eeg-lab"),
                   help="mounted recording store (OMV shared folder eeg-lab)")
    p.add_argument("--workdir", default=os.getenv("EEG_LAB_WORKDIR", "/var/tmp"))
    p.add_argument("--eeg-render", default=os.getenv("EEG_RENDER_BIN", "eeg-render"))
    p.add_argument("--poll", type=float, default=float(os.getenv("POLL_INTERVAL_SECONDS", "10")))
    p.add_argument("--lease", type=float, default=600.0)
    p.add_argument("--timeout", type=float, default=float(os.getenv("EEG_LAB_EXPORT_TIMEOUT_S", "3600")))
    p.add_argument("--trend-sidecar", dest="trend_sidecar",
                   default=os.getenv("TREND_SIDECAR_MJS", "/opt/pedquest-eeg-render/trend-sidecar.mjs"),
                   help="bundled tools/trend-sidecar (node); skipped when the file is absent")
    p.add_argument("--sidecar-timeout", dest="sidecar_timeout", type=float,
                   default=float(os.getenv("TREND_SIDECAR_TIMEOUT_S", "5400")))
    p.add_argument("--render-jobs", dest="render_jobs", type=int,
                   default=int(os.getenv("EEG_RENDER_JOBS", "1")),
                   help="cores per export (eeg-render export --jobs); 1 = single process")
    p.add_argument("--min-age", dest="min_age", type=float,
                   default=float(os.getenv("EEG_LAB_CLAIM_MIN_AGE_S", "0")),
                   help="only claim pending jobs older than this many seconds (fallback host); 0 = any")
    p.add_argument("--worker-id", default=f"{socket.gethostname()}:{os.getpid()}")
    p.add_argument("--once", action="store_true", help="process at most one job and exit")
    cfg = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    db = Supabase()
    log.info("export worker %s; store %s; renderer %s", cfg.worker_id, cfg.store, cfg.eeg_render)
    while True:
        try:
            worked = process_one(db, cfg)
        except Exception as error:
            # A missing table (migration not applied) or an outage: say so once
            # a minute rather than once a poll.
            log.error("poll failed: %s", str(error)[:300])
            worked = False
            if not cfg.once:
                time.sleep(max(cfg.poll, 60.0))
                continue
        if cfg.once:
            return 0
        if not worked:
            time.sleep(cfg.poll)


if __name__ == "__main__":
    sys.exit(main())
