"""Re-stamp sidecar renderer_version / spec_hash without re-rendering.

Only valid for a renderer bump that is provably pixel-identical — an additive
schema change, no geometry change. Prove it first by rendering a couple of
questions to a scratch dir and diffing the PNG bytes against
``public/images/qbank``; if a single byte differs, re-render instead.

Used for 0.3.2 -> 0.3.3 (adds attenuation_transient.ramp_min, allows a null
background.burst_suppression, restores the composite geometry class).

    python restamp_sidecars.py            # rewrite
    python restamp_sidecars.py --dry-run  # report only
"""

import json
import sys
from pathlib import Path

from eeg_render import RENDERER_VERSION
from eeg_render.spec import load_question, normalize, spec_hash

ROOT = Path(__file__).resolve().parents[2]
QUESTIONS = ROOT / "content/qbank/questions"
IMAGES = ROOT / "public/images/qbank"


def main(dry_run: bool) -> int:
    changed = 0
    for question_path in sorted(QUESTIONS.glob("*.yaml")):
        question = load_question(question_path)
        sidecar_path = IMAGES / f"{question.ident}.json"
        if not sidecar_path.exists():
            print(f"  missing sidecar: {question.ident}")
            continue
        sidecar = json.loads(sidecar_path.read_text(encoding="utf-8"))
        wanted = {
            "renderer_version": RENDERER_VERSION,
            "spec_hash": spec_hash(normalize(question.image)),
        }
        if all(sidecar.get(k) == v for k, v in wanted.items()):
            continue
        changed += 1
        print(f"  {question.ident}: {sidecar.get('renderer_version')} -> {RENDERER_VERSION}")
        if not dry_run:
            sidecar.update(wanted)
            sidecar_path.write_text(json.dumps(sidecar, indent=2) + "\n", encoding="utf-8")
    print(f"{'would restamp' if dry_run else 'restamped'} {changed} sidecar(s) to {RENDERER_VERSION}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main("--dry-run" in sys.argv))
