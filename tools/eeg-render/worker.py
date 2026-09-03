"""Poll Supabase render jobs and publish deterministic qEEG images."""

from __future__ import annotations

import argparse
import json
import logging
import os
import tempfile
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from eeg_render.render import render_image


def load_env(path: str | None) -> None:
    if not path:
        return
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


class Supabase:
    def __init__(self) -> None:
        self.base = (os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL") or "").rstrip("/")
        self.key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_SECRET_KEY") or ""
        if not self.base or not self.key:
            raise RuntimeError("Supabase URL and service-role key are required")

    def request(self, path: str, method: str = "GET", body: Any = None, extra: dict[str, str] | None = None) -> Any:
        payload = None if body is None else json.dumps(body).encode("utf-8")
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }
        if extra:
            headers.update(extra)
        req = Request(f"{self.base}{path}", data=payload, headers=headers, method=method)
        try:
            with urlopen(req, timeout=60) as response:
                data = response.read()
                return json.loads(data) if data else None
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase {method} {path} returned {error.code}: {detail[:500]}") from error

    def upload_png(self, object_path: str, png: Path) -> str:
        data = png.read_bytes()
        path = "/storage/v1/object/eeg-cases/" + quote(object_path, safe="/")
        headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "image/png",
            "x-upsert": "true",
        }
        req = Request(f"{self.base}{path}", data=data, headers=headers, method="POST")
        try:
            with urlopen(req, timeout=120):
                pass
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Supabase image upload returned {error.code}: {detail[:500]}") from error
        return f"{self.base}/storage/v1/object/public/eeg-cases/{quote(object_path, safe='/')}"


def claim_job(db: Supabase) -> dict[str, Any] | None:
    rows = db.request(
        "/rest/v1/eeg_case_render_jobs?status=eq.pending&select=id,case_id,spec&order=created_at.asc&limit=1"
    )
    if not rows:
        return None
    job = rows[0]
    claimed = db.request(
        f"/rest/v1/eeg_case_render_jobs?id=eq.{quote(job['id'])}&status=eq.pending",
        method="PATCH",
        body={"status": "running", "error": None},
        extra={"Prefer": "return=representation"},
    )
    return claimed[0] | job if claimed else None


def process_one(db: Supabase) -> bool:
    job = claim_job(db)
    if not job:
        return False
    job_id = job["id"]
    case_id = job.get("case_id")
    try:
        if not case_id:
            raise RuntimeError("render job has no case_id")
        rows = db.request(
            f"/rest/v1/eeg_cases?id=eq.{quote(case_id)}&select=id,qbank_id,content&limit=1"
        )
        if not rows:
            raise RuntimeError("case not found")
        case = rows[0]
        content = case.get("content") or {}
        image = dict(content.get("image") or {})
        if not image.get("kind"):
            raise RuntimeError("case content has no image.kind")
        image["spec"] = job["spec"]
        ident = case.get("qbank_id") or f"case-{case_id[:8]}"
        point = content.get("point_to_feature") if content.get("question_type") == "point_to_feature" else None

        with tempfile.TemporaryDirectory(prefix="pedquest-render-") as directory:
            png, sidecar = render_image(ident, image, directory, point)
            public_url = db.upload_png(f"qbank/{ident}.png", png)

        sidecar["path"] = public_url
        case_patch: dict[str, Any] = {
            "image_url": public_url,
            "image_width": sidecar.get("width"),
            "image_height": sidecar.get("height"),
            "image_sidecar": sidecar,
        }
        if sidecar.get("answer_region") is not None:
            case_patch["correct_region"] = sidecar["answer_region"]
        db.request(f"/rest/v1/eeg_cases?id=eq.{quote(case_id)}", "PATCH", case_patch)
        db.request(
            f"/rest/v1/eeg_case_render_jobs?id=eq.{quote(job_id)}",
            "PATCH",
            {"status": "done", "image_url": public_url, "sidecar": sidecar, "error": None},
        )
        logging.info("rendered %s (%s)", ident, job_id)
    except Exception as error:
        logging.exception("render job %s failed", job_id)
        try:
            db.request(
                f"/rest/v1/eeg_case_render_jobs?id=eq.{quote(job_id)}",
                "PATCH",
                {"status": "error", "error": str(error)[:2000]},
            )
        except Exception:
            logging.exception("could not record render failure")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file")
    parser.add_argument("--poll", type=float, default=10.0)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--log")
    args = parser.parse_args()
    load_env(args.env_file)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        filename=args.log,
    )
    db = Supabase()
    logging.info("PedQuEST render worker started")
    while True:
        worked = process_one(db)
        if args.once:
            return 0
        if not worked:
            time.sleep(max(1.0, args.poll))


if __name__ == "__main__":
    raise SystemExit(main())
