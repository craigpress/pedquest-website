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
from .spec import SpecError, load_question, normalize, spec_hash, spec_warnings, style_warnings, validate_image

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
            norm_q = normalize(q.image)
            for w in style_warnings(norm_q):
                print(f"  warn: {w}")
            for w in spec_warnings(norm_q):
                print(f"  acns: {w}")
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
        for w in spec_warnings(norm):
            print(f"  acns: {w}")
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


_DURATION_UNITS = {"s": 1.0, "m": 60.0, "h": 3600.0}


def _parse_duration(text: str) -> float:
    unit = _DURATION_UNITS.get(text[-1].lower())
    value = float(text[:-1]) if unit else float(text)
    return value * (unit or 1.0)


def _spec_duration_s(kind: str, spec: dict) -> float:
    if kind == "aeeg":
        return float(spec["duration_h"]) * 3600.0
    if kind == "eeg_page" and spec.get("duration_min") is None:
        return float(spec["at_min"]) * 60.0 + float(spec["window_s"]) + 60.0
    return float(spec["duration_min"]) * 60.0


def cmd_export(args) -> int:
    from .export import (baseline_advisory, build_manifest, ekg_row,
                         write_edf_plus, write_lay_dat)
    from .export.manifest import recording_for
    from .synth import Synthesizer

    path = Path(args.file)
    q = load_question(path)          # also accepts a bare spec file
    image = q.image
    norm = normalize(image)
    kind = norm["kind"]
    if kind == "composite":
        # The page is a window into the panel's own recording, so the panel's
        # spec is the recording.
        norm = {"kind": "qeeg_panel", "spec": norm["spec"]["qeeg_panel"]}
        kind = "qeeg_panel"
    spec = norm["spec"]

    duration_s = (_parse_duration(args.duration) if args.duration
                  else _spec_duration_s(kind, spec))
    ident = q.ident or path.stem
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    synth = Synthesizer(spec, duration_s)
    extra_rows = {}
    extra_names = []
    if not args.no_ekg:
        # A row literally named EKG is what switches on Persyst's heart-rate
        # engine; ECG carried on A1/A2 is not recognised.
        extra_rows["EKG"] = ekg_row(synth, duration_s)
        extra_names.append("EKG")
    recording = recording_for(image, synth, duration_s, extra_channels=extra_names)
    formats = {f.strip().lower() for f in args.format.split(",") if f.strip()}
    unknown = formats - {"lay", "edf"}
    if unknown:
        print(f"unknown format(s): {', '.join(sorted(unknown))}", file=sys.stderr)
        return 1

    manifest = build_manifest(synth, recording)
    # Embedding is a separate, louder opt-in than writing the key file. Annotations
    # inside the recording travel with it: a learner scrolling the timeline reads
    # the answer off the file no matter what the surrounding page withholds.
    events = manifest["events"] if args.embed_answers else []
    lay_events = [(e["onset_s"], max(0.0, e["offset_s"] - e["onset_s"]),
                   f"@{e['kind']} {e.get('onset_region') or e.get('label') or ''}".strip())
                  for e in events]
    edf_events = [(e["onset_s"], max(0.0, e["offset_s"] - e["onset_s"]),
                   f"{e['kind']} {e.get('onset_region') or e.get('label') or ''}".strip())
                  for e in events]

    files, clipped = {}, 0
    lay_kw = {"events": lay_events, "extra_rows": extra_rows}
    if args.calibration is not None:
        lay_kw["calibration"] = args.calibration
    edf_kw = {"events": edf_events, "extra_rows": extra_rows}

    # One block stream for the whole export. --jobs > 1 synthesizes the blocks
    # on that many cores (export/parallel.py); the writers see the same
    # sequence either way.
    jobs = max(1, int(args.jobs or 1))
    if jobs > 1:
        from .export.parallel import iter_blocks_parallel
        block_stream = iter_blocks_parallel(spec, duration_s, synth.fs, recording.n_samples, jobs)
        print(f"  synth  {jobs} processes")
    else:
        from .export.manifest import iter_blocks
        block_stream = iter_blocks(synth, recording.n_samples)

    reports: dict = {}
    if formats == {"lay", "edf"}:
        # Both formats from ONE pass over the synthesizer: the writers each used
        # to pull iter_blocks themselves, so a two-format export synthesized the
        # whole recording twice (the dominant cost of a lab export).
        import threading
        from .export.tee import tee_blocks

        lay_blocks, edf_blocks = tee_blocks(block_stream, 2)

        def run_edf() -> None:
            try:
                reports["edf"] = write_edf_plus(out_dir / ident, synth, recording, blocks=edf_blocks, **edf_kw)
            except BaseException as error:  # noqa: BLE001 - re-raised below
                reports["edf"] = error
                for _ in edf_blocks:      # release the tee so the .lay side is not blocked
                    pass

        worker = threading.Thread(target=run_edf, name="eeg-render-edf", daemon=True)
        worker.start()
        try:
            reports["lay"] = write_lay_dat(out_dir / ident, synth, recording, blocks=lay_blocks, **lay_kw)
        except BaseException as error:  # noqa: BLE001
            reports["lay"] = error
            for _ in lay_blocks:
                pass
        worker.join()
        for name in ("lay", "edf"):
            if isinstance(reports[name], BaseException):
                raise reports[name]
    else:
        if "lay" in formats:
            reports["lay"] = write_lay_dat(out_dir / ident, synth, recording, blocks=block_stream, **lay_kw)
        if "edf" in formats:
            reports["edf"] = write_edf_plus(out_dir / ident, synth, recording, blocks=block_stream, **edf_kw)

    if "lay" in reports:
        report = reports["lay"]
        files["lay"], files["dat"] = report["lay"], report["dat"]
        clipped = max(clipped, report["clipped_samples"])
        print(f"  lay  {report['lay']}  {report['samples']:,} samples x "
              f"{report['channels']} ch  peak {report['peak_uv']} uV  "
              f"clipped {report['clipped_samples']}")
    if "edf" in reports:
        report = reports["edf"]
        files["edf"] = report["edf"]
        clipped = max(clipped, report["clipped_samples"])
        print(f"  edf  {report['edf']}  {report['records']:,} records x "
              f"{report['record_duration_s']}s  clipped {report['clipped_samples']}  "
              f"padded {report['padded_samples']}")

    if args.answers or args.embed_answers:
        manifest = build_manifest(synth, recording, clipped_samples=clipped, files=files)
        key = out_dir / f"{ident}.answers.json"
        key.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        print(f"  key  {key}  {len(manifest['events'])} realized events")

    print(f"  recording {recording.recording_id}  {duration_s / 60:.1f} min @ "
          f"{recording.sample_rate} Hz  {len(recording.channels)} ch")
    if args.embed_answers:
        print("  *** INSTRUCTOR COPY: realized events are embedded in the recording "
              "itself. Do not hand this file to a learner. ***")
    elif args.answers:
        print("  instructor copy: answer key written alongside; the recording itself "
              "carries no ground truth")
    else:
        print("  learner copy: no answer key, no embedded ground truth")

    # A recording too short for the MMX baseline window produces VsBaseline
    # trends that are silently all zero -- exit 0, no warning.  Say so here,
    # where it is still cheap to fix, rather than letting it look like a result.
    advisory = baseline_advisory(synth, duration_s)
    if not advisory["ok"]:
        print("  baseline: NOT USABLE by Persyst's stock auto-search")
        for reason in advisory["reasons"]:
            print(f"    - {reason}")
    return 0


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

    ex = add("export", help="write a reviewable recording (.lay/.dat and/or EDF+)")
    ex.add_argument("file", help="question or bare spec YAML")
    ex.add_argument("--out", default="exports")
    ex.add_argument("--duration", default=None,
                    help="override the spec's horizon, e.g. 30m, 4h, 900s. "
                         "Duration is part of a recording's identity, not a view "
                         "option: changing it changes the waveform everywhere.")
    ex.add_argument("--format", default="lay",
                    help="comma-separated: lay, edf")
    ex.add_argument("--calibration", type=float, default=None,
                    help="microvolts per count for .dat (default 0.1)")
    # Two separate opt-ins, because they leak differently. The key file can be
    # withheld by whoever distributes the recording; annotations inside the
    # recording cannot -- they travel with the file.
    ex.add_argument("--answers", action="store_true",
                    help="write the answer-key JSON beside the recording "
                         "(instructor artifact). The recording itself still "
                         "carries no ground truth. Off by default.")
    ex.add_argument("--embed-answers", action="store_true",
                    help="ALSO write realized events into the recording's "
                         "annotations. Anyone who opens the file can read the "
                         "answer off the timeline. Implies --answers.")
    ex.add_argument("--jobs", type=int, default=1,
                    help="synthesize blocks on this many cores (output is identical; default 1)")
    ex.add_argument("--no-ekg", action="store_true",
                    help="omit the dedicated EKG channel. It is included by "
                         "default because Persyst finds ECG by channel NAME "
                         "(AutoEKGChannels); without a row called EKG the "
                         "heart-rate engine silently returns all zeros.")
    ex.set_defaults(func=cmd_export)
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
