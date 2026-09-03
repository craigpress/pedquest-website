"""Command line interface.

    python -m eeg_render render     <question.yaml> [--out DIR]
    python -m eeg_render render-all <questions_dir> [--out DIR] [--only PQ-A]
    python -m eeg_render preview    <spec.yaml> [--out DIR]
    python -m eeg_render validate   <question.yaml|spec.yaml> ...
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from pathlib import Path
from typing import List, Optional

from . import RENDERER_VERSION
from .render import render_image
from .spec import SpecError, load_question, normalize, spec_hash, style_warnings, validate_image

DEFAULT_OUT = "public/images/qbank"


def _repo_default_out() -> str:
    """``public/images/qbank`` relative to the repo root, wherever we are run."""
    here = Path.cwd()
    for cand in [here] + list(here.parents):
        if (cand / "public").is_dir() and (cand / "content" / "qbank").is_dir():
            return str(cand / DEFAULT_OUT)
    return DEFAULT_OUT


def _write_sidecar(out_dir: Path, ident: str, sidecar: dict) -> Path:
    path = out_dir / f"{ident}.json"
    path.write_text(json.dumps(sidecar, indent=2, sort_keys=False) + "\n",
                    encoding="utf-8")
    return path


def cmd_render(args) -> int:
    out_dir = Path(args.out)
    ok = 0
    for src in args.files:
        try:
            q = load_question(src)
            png, sidecar = render_image(q.ident, q.image, out_dir, q.point_to_feature)
            _write_sidecar(out_dir, q.ident, sidecar)
            print(f"{q.ident}: {png}  ({sidecar['spec_hash'][:19]}...)")
            for w in style_warnings(normalize(q.image)):
                print(f"  warn: {w}")
            ok += 1
        except Exception as exc:
            print(f"ERROR {src}: {exc}", file=sys.stderr)
            if args.traceback:
                traceback.print_exc()
            return 1
    return 0 if ok else 1


def cmd_render_all(args) -> int:
    root = Path(args.directory)
    files = sorted(root.glob("*.yaml")) + sorted(root.glob("*.yml"))
    if args.only:
        files = [f for f in files if f.stem.startswith(tuple(args.only))]
    out_dir = Path(args.out)
    done: List[str] = []
    skipped: List[str] = []
    failed: List[str] = []

    for src in files:
        t0 = time.time()
        try:
            q = load_question(src)
        except SpecError as exc:
            skipped.append(f"{src.name}: {exc}")
            print(f"SKIP  {src.name}: {exc}", file=sys.stderr)
            continue

        problems = validate_image(q.image)
        if problems:
            # a schema failure is one item's problem, never the batch's
            skipped.append(f"{src.name}: {problems[0]}")
            print(f"SKIP  {src.name}: {len(problems)} schema problem(s)", file=sys.stderr)
            for p in problems[:4]:
                print(f"        {p}", file=sys.stderr)
            continue

        existing = out_dir / f"{q.ident}.json"
        if not args.force and existing.exists():
            try:
                prev = json.loads(existing.read_text(encoding="utf-8"))
                if (prev.get("spec_hash") == spec_hash(normalize(q.image))
                        and (out_dir / f"{q.ident}.png").exists()):
                    print(f"CACHE {q.ident}  (spec unchanged)")
                    done.append(q.ident)
                    continue
            except Exception:
                pass

        try:
            png, sidecar = render_image(q.ident, q.image, out_dir, q.point_to_feature)
            _write_sidecar(out_dir, q.ident, sidecar)
            done.append(q.ident)
            print(f"OK    {q.ident}  {time.time() - t0:5.1f}s  {png.name}")
            for w in style_warnings(normalize(q.image)):
                print(f"        warn: {w}")
        except Exception as exc:
            failed.append(f"{src.name}: {exc}")
            print(f"FAIL  {src.name}: {exc}", file=sys.stderr)
            if args.traceback:
                traceback.print_exc()

    print(f"\nrendered {len(done)}  skipped {len(skipped)}  failed {len(failed)}")
    for line in skipped:
        print(f"  skipped: {line}")
    for line in failed:
        print(f"  failed:  {line}")
    return 1 if failed else 0


def cmd_preview(args) -> int:
    out_dir = Path(args.out)
    for src in args.files:
        q = load_question(src)
        png, sidecar = render_image(q.ident, q.image, out_dir, q.point_to_feature)
        _write_sidecar(out_dir, q.ident, sidecar)
        print(f"{png}")
        for w in style_warnings(normalize(q.image)):
            print(f"  warn: {w}")
    return 0


def cmd_validate(args) -> int:
    bad = 0
    for src in args.files:
        try:
            q = load_question(src)
        except SpecError as exc:
            print(f"INVALID {src}: {exc}")
            bad += 1
            continue
        problems = validate_image(q.image)
        if problems:
            bad += 1
            print(f"INVALID {q.ident} ({src})")
            for p in problems:
                print(f"  - {p}")
            continue
        norm = normalize(q.image)
        print(f"OK      {q.ident}  {norm['kind']}  {spec_hash(norm)}")
        for w in style_warnings(norm):
            print(f"  warn: {w}")
        if q.point_to_feature:
            events = norm["spec"].get("events") or (
                norm["spec"].get("qeeg_panel", {}).get("events") if
                isinstance(norm["spec"].get("qeeg_panel"), dict) else None) or []
            idx = int(q.point_to_feature.get("target_event", 0))
            n = len(events) or len(norm["spec"].get("seizures") or [])
            if not (0 <= idx < n):
                print(f"  - point_to_feature.target_event={idx} is out of range (0..{n - 1})")
                bad += 1
    return 1 if bad else 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="eeg-render",
                                description=f"PedQuEST qEEG image renderer {RENDERER_VERSION}")
    p.add_argument("--traceback", action="store_true", help="print full tracebacks")
    sub = p.add_subparsers(dest="cmd", required=True)

    def add(name, **kw):
        sp = sub.add_parser(name, **kw)
        sp.add_argument("--traceback", action="store_true", default=None,
                        help="print full tracebacks")
        return sp

    default_out = _repo_default_out()

    r = add("render", help="render one or more question files")
    r.add_argument("files", nargs="+")
    r.add_argument("--out", default=default_out)
    r.set_defaults(func=cmd_render)

    ra = add("render-all", help="render a directory of question files")
    ra.add_argument("directory")
    ra.add_argument("--out", default=default_out)
    ra.add_argument("--only", nargs="*", help="only ids starting with these prefixes")
    ra.add_argument("--force", action="store_true",
                    help="re-render even when the spec hash is unchanged")
    ra.set_defaults(func=cmd_render_all)

    pv = add("preview", help="render a bare spec file to a scratch dir")
    pv.add_argument("files", nargs="+")
    pv.add_argument("--out", default="examples")
    pv.set_defaults(func=cmd_preview)

    v = add("validate", help="schema/semantic check without rendering")
    v.add_argument("files", nargs="+")
    v.set_defaults(func=cmd_validate)
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
