"""Claim ``stage='persyst'`` jobs from Supabase and run the PSCLI chain.

Outbound-only, like ``tools/eeg-render/worker.py``: the licensed Windows box
polls Supabase with the service-role key and opens no inbound port.

What differs from the render worker is the **failure semantics**, deliberately:

* every job is leased (``claimed_by`` + ``lease_expires_at``) and the lease is
  heartbeated, so a worker that dies does not strand a row in ``running``;
* a transient failure releases the job back to ``pending`` for another attempt
  instead of burning it to ``error`` on first contact;
* a malformed job (no input artifact, a preset that is not installed) goes
  straight to ``error`` without consuming the retry budget;
* and a clean exit is not treated as success.  Persyst can exit 0 having
  produced nothing but zeros, so the exported CSV is read back and the result
  is reported as ``baseline``/``heart_rate`` state, not as a bare "done".

The PSCLI order is fixed: ``/Process`` -> ``/DetectSeizures`` -> ``/ExportCSV``.
``/DetectSeizures`` writes its findings into the source ``.lay``'s
``[Comments]``; exporting the CSV first loses them.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import shutil
import socket
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from persyst_bridge import pscli, readback

DEFAULT_BUCKET = "eeg-lab"
DEFAULT_MMX = "Trend Settings Version P15.mmx"
DEFAULT_PANEL = "VsBaseline Comprehensive"
DEFAULT_ARTIFACT_REDUCTION = "Off"

#: Selected explicitly; ``spec`` is an export-stage concern and can be large.
JOB_COLUMNS = (
    "id,stage,status,duration_s,options,artifacts,recording_id,spec_hash,"
    "renderer_version,attempts,max_attempts,claimed_by,lease_expires_at,"
    "parent_job_id,created_at"
)

log = logging.getLogger("persyst-bridge")


class PermanentError(RuntimeError):
    """The job cannot succeed however many times it is retried."""


def load_env(path: str | None) -> None:
    if not path:
        return
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(moment: datetime) -> str:
    """ISO-8601 with a ``Z`` suffix.

    Never ``+00:00``: an unencoded ``+`` in a PostgREST query string is decoded
    as a space, which turns a lease filter into a silent no-match.
    """
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"


def _q(value: Any) -> str:
    return quote(str(value), safe="")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


class Supabase:
    def __init__(self, bucket: str = DEFAULT_BUCKET) -> None:
        self.base = (os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL") or "").rstrip("/")
        self.key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SECRET_KEY") or ""
        self.bucket = bucket
        if not self.base or not self.key:
            raise RuntimeError("Supabase URL and service-role key are required")

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        headers = {"apikey": self.key, "Authorization": f"Bearer {self.key}"}
        if extra:
            headers.update(extra)
        return headers

    def request(self, path: str, method: str = "GET", body: Any = None,
                extra: dict[str, str] | None = None, timeout: float = 60.0) -> Any:
        payload = None if body is None else json.dumps(body).encode("utf-8")
        headers = self._headers({"Content-Type": "application/json", **(extra or {})})
        req = Request(f"{self.base}{path}", data=payload, headers=headers, method=method)
        try:
            with urlopen(req, timeout=timeout) as response:
                data = response.read()
                return json.loads(data) if data else None
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase {method} {path} returned {error.code}: {detail[:500]}") from error

    def download(self, ref: str, dest: Path, timeout: float = 600.0) -> Path:
        """Fetch a private-bucket object (or an absolute URL) to ``dest``."""
        if ref.startswith("http://") or ref.startswith("https://"):
            url = ref
        else:
            path = ref.lstrip("/")
            prefix = f"{self.bucket}/"
            if path.startswith(prefix):
                path = path[len(prefix):]
            url = f"{self.base}/storage/v1/object/{self.bucket}/{quote(path, safe='/')}"
        req = Request(url, headers=self._headers(), method="GET")
        dest.parent.mkdir(parents=True, exist_ok=True)
        try:
            with urlopen(req, timeout=timeout) as response, open(dest, "wb") as handle:
                shutil.copyfileobj(response, handle)
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise PermanentError(f"download of {ref!r} returned {error.code}: {detail[:300]}") from error
        return dest

    def upload(self, object_path: str, source: Path, content_type: str,
               timeout: float = 600.0) -> str:
        data = Path(source).read_bytes()
        url = f"{self.base}/storage/v1/object/{self.bucket}/{quote(object_path, safe='/')}"
        headers = self._headers({"Content-Type": content_type, "x-upsert": "true"})
        req = Request(url, data=data, headers=headers, method="POST")
        try:
            with urlopen(req, timeout=timeout):
                pass
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"upload of {object_path} returned {error.code}: {detail[:300]}") from error
        # Private bucket: the storage path, not a URL.  Readers sign it.
        return f"{self.bucket}/{object_path}"


# --------------------------------------------------------------------------
# lease
# --------------------------------------------------------------------------

class Lease:
    """Hold ``lease_expires_at`` in the future for as long as the job runs.

    ``lost`` goes true if a heartbeat updates zero rows, which means another
    worker reclaimed the job (or an operator cancelled it).  The job then stops
    without writing results -- two workers writing one row is worse than a
    duplicated run.
    """

    def __init__(self, db: Supabase, job_id: str, worker_id: str, seconds: float) -> None:
        self.db = db
        self.job_id = job_id
        self.worker_id = worker_id
        self.seconds = seconds
        self.interval = max(15.0, seconds / 3.0)
        self.lost = False
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def _filter(self) -> str:
        return (f"id=eq.{_q(self.job_id)}&status=eq.running"
                f"&claimed_by=eq.{_q(self.worker_id)}")

    def renew(self) -> bool:
        rows = self.db.request(
            f"/rest/v1/eeg_lab_jobs?{self._filter}",
            "PATCH",
            {"lease_expires_at": iso(utcnow() + timedelta(seconds=self.seconds))},
            extra={"Prefer": "return=representation"},
        )
        if not rows:
            self.lost = True
            log.error("lease on %s was lost; another worker holds it", self.job_id)
            return False
        return True

    def _loop(self) -> None:
        while not self._stop.wait(self.interval):
            try:
                if not self.renew():
                    return
            except Exception:
                log.warning("lease heartbeat for %s failed; will retry", self.job_id)

    def __enter__(self) -> "Lease":
        self._thread = threading.Thread(target=self._loop, daemon=True,
                                        name=f"lease-{self.job_id[:8]}")
        self._thread.start()
        return self

    def __exit__(self, *_exc) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)

    def check(self) -> None:
        if self.lost:
            raise RuntimeError("lease lost mid-job; abandoning without writing results")


def _candidates(db: Supabase, limit: int = 5) -> list[dict]:
    """Oldest pending rows first, then rows whose lease has expired."""
    base = f"/rest/v1/eeg_lab_jobs?stage=eq.persyst&select={JOB_COLUMNS}&order=created_at.asc&limit={limit}"
    pending = db.request(f"{base}&status=eq.pending") or []
    expired = db.request(f"{base}&status=eq.running&lease_expires_at=lt.{_q(iso(utcnow()))}") or []
    return list(pending) + list(expired)


def claim_job(db: Supabase, worker_id: str, lease_seconds: float) -> dict | None:
    """Compare-and-swap a candidate into ``running``.

    PostgREST has no ``SELECT ... FOR UPDATE SKIP LOCKED``, so the claim is an
    ``UPDATE`` whose ``WHERE`` still names the state we read.  Postgres
    re-evaluates that predicate after taking the row lock, so a worker that
    loses the race updates zero rows and moves on.
    """
    for job in _candidates(db):
        attempts = int(job.get("attempts") or 0)
        max_attempts = int(job.get("max_attempts") or 5)
        if attempts >= max_attempts:
            _finish_exhausted(db, job, attempts, max_attempts)
            continue
        if job["status"] == "pending":
            where = f"id=eq.{_q(job['id'])}&status=eq.pending"
        else:
            lease = job.get("lease_expires_at")
            if not lease:
                continue  # a running row with no lease is not ours to reclaim
            where = (f"id=eq.{_q(job['id'])}&status=eq.running"
                     f"&lease_expires_at=eq.{_q(lease)}")
        rows = db.request(
            f"/rest/v1/eeg_lab_jobs?{where}",
            "PATCH",
            {
                "status": "running",
                "claimed_by": worker_id,
                "lease_expires_at": iso(utcnow() + timedelta(seconds=lease_seconds)),
                "attempts": attempts + 1,
                "error": None,
                "last_exit_code": None,
            },
            extra={"Prefer": "return=representation"},
        )
        if rows:
            claimed = job | rows[0]
            log.info("claimed %s (attempt %d/%d)", claimed["id"], attempts + 1, max_attempts)
            return claimed
    return None


def _finish_exhausted(db: Supabase, job: dict, attempts: int, max_attempts: int) -> None:
    where = f"id=eq.{_q(job['id'])}&status=eq.{job['status']}"
    db.request(
        f"/rest/v1/eeg_lab_jobs?{where}",
        "PATCH",
        {
            "status": "error",
            "error": f"exhausted {attempts} of {max_attempts} attempts",
            "lease_expires_at": None,
        },
    )
    log.error("job %s exhausted its %d attempts", job["id"], max_attempts)


def _release(db: Supabase, job: dict, worker_id: str, *, status: str,
             error: str, exit_code: int | None) -> None:
    patch: dict[str, Any] = {
        "status": status,
        "error": error[:2000],
        "lease_expires_at": None,
        "last_exit_code": None if exit_code is None else pscli.signed32(exit_code),
    }
    if status == "pending":
        patch["claimed_by"] = None
    try:
        db.request(
            f"/rest/v1/eeg_lab_jobs?id=eq.{_q(job['id'])}&claimed_by=eq.{_q(worker_id)}",
            "PATCH", patch,
        )
    except Exception:
        log.exception("could not record the failure of %s", job["id"])


# --------------------------------------------------------------------------
# the job itself
# --------------------------------------------------------------------------

def _option(options: dict, *names: str, default: Any = None) -> Any:
    for name in names:
        value = options.get(name)
        if value not in (None, ""):
            return value
    return default


def resolve_inputs(db: Supabase, job: dict) -> dict:
    """The ``.lay``/``.dat`` this stage consumes.

    Either on this row (an orchestrator copied them across) or on the export row
    named by ``parent_job_id``.
    """
    artifacts = dict(job.get("artifacts") or {})
    if not artifacts.get("lay") and job.get("parent_job_id"):
        rows = db.request(
            f"/rest/v1/eeg_lab_jobs?id=eq.{_q(job['parent_job_id'])}&select=artifacts,status&limit=1"
        ) or []
        if rows:
            artifacts = dict(rows[0].get("artifacts") or {})
    if not artifacts.get("lay"):
        raise PermanentError(
            "no input recording: neither this job's artifacts nor its parent's carry a 'lay' path"
        )
    return artifacts


def _dat_ref(lay_ref: str, lay_path: Path, artifacts: dict) -> str:
    """The ``.dat`` beside the ``.lay``.

    ``artifacts.dat`` if the export stage recorded one, otherwise the name the
    ``.lay`` itself declares in ``File=`` -- which is the name that must be on
    disk for Persyst to open the recording at all.
    """
    if artifacts.get("dat"):
        return str(artifacts["dat"])
    declared = ""
    for raw in lay_path.read_text(encoding="ascii", errors="replace").splitlines():
        if raw.strip().lower().startswith("file="):
            declared = raw.split("=", 1)[1].strip()
            break
    if not declared:
        raise PermanentError("the .lay declares no File= and artifacts carry no 'dat'")
    parent = lay_ref.rsplit("/", 1)[0] if "/" in lay_ref else ""
    return f"{parent}/{declared}" if parent else declared


def run_job(db: Supabase, job: dict, cfg: argparse.Namespace, exe: Path,
            licence: dict, lease: Lease) -> dict:
    job_id = str(job["id"])
    options = dict(job.get("options") or {})
    duration_s = float(job.get("duration_s") or 0.0)

    mmx = str(_option(options, "mmx", "mmx_preset", default=cfg.default_mmx))
    panel = str(_option(options, "panel", default=cfg.default_panel))
    artifact_reduction = str(_option(options, "artifact_reduction",
                                     default=DEFAULT_ARTIFACT_REDUCTION))
    try:
        mmx_path = pscli.resolve_mmx(mmx, cfg.persyst_data_dir)
    except pscli.PscliError as error:
        raise PermanentError(str(error)) from error

    artifacts = resolve_inputs(db, job)
    root = Path(cfg.work_root) / job_id
    if root.exists():
        shutil.rmtree(root, ignore_errors=True)
    source_dir = root / "source"
    source_dir.mkdir(parents=True)

    try:
        lay_ref = str(artifacts["lay"])
        lay_name = Path(lay_ref.replace("\\", "/")).name
        lay_src = db.download(lay_ref, source_dir / lay_name)
        dat_ref = _dat_ref(lay_ref, lay_src, artifacts)
        dat_name = Path(dat_ref.replace("\\", "/")).name
        dat_src = db.download(dat_ref, source_dir / dat_name)
        lease.check()

        lay, attempts = pscli.process_with_retry(
            exe, [lay_src, dat_src], root,
            mmx=mmx,
            timeout=pscli.step_timeout("process", duration_s),
            max_attempts=int(job.get("max_attempts") or 5),
            backoff=cfg.backoff,
            keep_failed=cfg.keep_scratch,
        )
        steps = list(attempts)
        lease.check()

        steps.append(pscli.detect_seizures(
            exe, lay, timeout=pscli.step_timeout("detect_seizures", duration_s),
            work_root=root,
        ))
        lease.check()

        out_csv = lay.with_suffix(".csv")
        steps.append(pscli.export_csv(
            exe, lay, out_csv,
            mmx=mmx, panel=panel, artifact_reduction=artifact_reduction,
            timeout=pscli.step_timeout("export_csv", duration_s),
            work_root=root,
        ))
        lease.check()

        trends = readback.inspect_trends_csv(out_csv)
        detections = readback.inspect_lay(lay)
        products = pscli.collect_products(lay)

        stem = lay.with_suffix("").name
        stored: dict[str, str] = {
            "trends_csv": db.upload(f"persyst/{job_id}/{stem}.csv", out_csv, "text/csv"),
            "processed_lay": db.upload(f"persyst/{job_id}/{lay.name}", lay, "text/plain"),
        }
        montages = products.pop("montages_xml", None)
        if montages:
            stored["montages_xml"] = db.upload(
                f"persyst/{job_id}/mg2.montages.xml", Path(montages), "application/xml"
            )

        warnings = list(trends.get("warnings") or []) + list(detections.get("lay_warnings") or [])
        baseline_reason = None
        if trends.get("baseline") == "unavailable":
            baseline_reason = readback.explain_missing_baseline(mmx, duration_s)
        if trends.get("heart_rate") == "unavailable":
            warnings.append(
                "Heart Rate is all zero: no channel name matched the MMX AutoEKGChannels list"
            )

        family, start, window = readback.autosearch_window(mmx)
        report = {
            "stage": "persyst",
            "worker": cfg.worker_id,
            "finished_at": iso(utcnow()),
            "pscli": licence,
            "mmx": mmx,
            "mmx_sha256": _sha256(mmx_path),
            "panel": panel,
            "artifact_reduction": artifact_reduction,
            "autosearch_window": {"family": family, "start_s": start, "duration_s": window},
            "duration_s": duration_s,
            "recording_id": job.get("recording_id"),
            "spec_hash": job.get("spec_hash"),
            "steps": [step.as_report() for step in steps],
            "process_attempts": len(attempts),
            "process_faults": sum(1 for step in attempts if step.faulted),
            "baseline": trends.get("baseline"),
            "baseline_reason": baseline_reason,
            "heart_rate": trends.get("heart_rate"),
            "csv_rows": trends.get("csv_rows"),
            "csv_metadata": trends.get("metadata"),
            "instruments": trends.get("instruments"),
            "detections": detections.get("detections"),
            "detector": detections.get("detector"),
            "channels": detections.get("channels"),
            "channels_renamed": detections.get("channels_renamed"),
            "products": products,
            "warnings": warnings,
        }

        lease.check()
        merged = dict(job.get("artifacts") or {}) | stored
        updated = db.request(
            f"/rest/v1/eeg_lab_jobs?id=eq.{_q(job_id)}&claimed_by=eq.{_q(cfg.worker_id)}",
            "PATCH",
            {
                "status": "done",
                "artifacts": merged,
                "report": report,
                "error": None,
                "last_exit_code": 0,
                "lease_expires_at": None,
            },
            extra={"Prefer": "return=representation"},
        )
        if not updated:
            raise RuntimeError("the job row changed hands before the result could be written")
        log.info(
            "job %s done: %d detection(s), baseline=%s heart_rate=%s, %d /Process attempt(s)",
            job_id, len(report["detections"] or []), report["baseline"],
            report["heart_rate"], report["process_attempts"],
        )
        return report
    finally:
        if cfg.keep_scratch:
            log.info("scratch kept at %s", root)
        else:
            shutil.rmtree(root, ignore_errors=True)


def process_one(db: Supabase, cfg: argparse.Namespace, exe: Path, licence: dict) -> bool:
    job = claim_job(db, cfg.worker_id, cfg.lease_seconds)
    if not job:
        return False
    lease = Lease(db, str(job["id"]), cfg.worker_id, cfg.lease_seconds)
    try:
        with lease:
            run_job(db, job, cfg, exe, licence, lease)
        return True
    except PermanentError as error:
        log.error("job %s cannot succeed: %s", job["id"], error)
        _release(db, job, cfg.worker_id, status="error", error=str(error), exit_code=None)
    except pscli.PscliError as error:
        code = error.result.exit_code if error.result else None
        status = "error" if error.permanent else "pending"
        log.error("job %s PSCLI failure (%s): %s", job["id"], status, error)
        _release(db, job, cfg.worker_id, status=status, error=str(error), exit_code=code)
    except KeyboardInterrupt:
        _release(db, job, cfg.worker_id, status="pending",
                 error="worker interrupted; released for another attempt", exit_code=None)
        raise
    except Exception as error:  # transient: network, storage, a lost lease
        log.exception("job %s failed", job["id"])
        if lease.lost:
            log.error("not releasing %s: the lease is held by another worker", job["id"])
        else:
            _release(db, job, cfg.worker_id, status="pending", error=str(error), exit_code=None)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file")
    parser.add_argument("--poll", type=float, default=15.0)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--log")
    parser.add_argument("--bucket", default=os.getenv("PERSYST_BUCKET", DEFAULT_BUCKET))
    parser.add_argument("--pscli", default=os.getenv("PERSYST_PSCLI"))
    parser.add_argument("--persyst-data-dir",
                        default=os.getenv("PERSYST_DATA_DIR", str(pscli.DEFAULT_DATA_DIR)))
    parser.add_argument("--work-root",
                        default=os.getenv("PERSYST_WORK_ROOT",
                                          str(Path(tempfile.gettempdir()) / "pedquest-persyst")))
    parser.add_argument("--worker-id", default=f"{socket.gethostname()}:{os.getpid()}")
    parser.add_argument("--lease-seconds", type=float, default=900.0)
    parser.add_argument("--backoff", type=float, default=5.0,
                        help="first /Process retry delay; doubles per fault")
    parser.add_argument("--default-mmx", default=os.getenv("PERSYST_MMX", DEFAULT_MMX))
    parser.add_argument("--default-panel", default=os.getenv("PERSYST_PANEL", DEFAULT_PANEL))
    parser.add_argument("--keep-scratch", action="store_true",
                        help="keep the per-job working directories for diagnosis")
    args = parser.parse_args()

    load_env(args.env_file)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        filename=args.log,
    )
    Path(args.work_root).mkdir(parents=True, exist_ok=True)

    exe = pscli.find_pscli(args.pscli)
    db = Supabase(args.bucket)
    log.info("PedQuEST Persyst worker %s started (PSCLI: %s)", args.worker_id, exe)

    unhealthy = 0
    while True:
        # The licence is refetched every 48 h and has previously lapsed into a
        # modal dialog.  Probing before each claim costs well under a second and
        # keeps a dead licence from eating the retry budget of every queued job.
        licence = pscli.probe_licence(exe)
        if not licence["ok"]:
            unhealthy += 1
            log.error("PSCLI licence probe unhealthy (%s); not claiming work", licence)
            if args.once:
                return 2
            time.sleep(min(600.0, args.poll * min(unhealthy, 20)))
            continue
        unhealthy = 0

        try:
            worked = process_one(db, args, exe, licence)
        except KeyboardInterrupt:
            log.info("interrupted; exiting")
            return 0
        except Exception:
            log.exception("poll failed")
            worked = False
        if args.once:
            return 0
        if not worked:
            time.sleep(max(1.0, args.poll))


if __name__ == "__main__":
    raise SystemExit(main())
