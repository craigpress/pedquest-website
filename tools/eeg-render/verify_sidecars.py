"""Verify local question images before importing their metadata into Supabase."""

import json
import sys
from pathlib import Path

from PIL import Image

from eeg_render import RENDERER_VERSION
from eeg_render.spec import load_question, normalize, spec_hash

ROOT = Path(__file__).resolve().parents[2]


def verify(question_path: Path, image_dir: Path) -> None:
    question = load_question(question_path)
    normalized = normalize(question.image)
    png = image_dir / f"{question.ident}.png"
    sidecar = json.loads(png.with_suffix('.json').read_text(encoding='utf-8'))
    expected = {
        'id': question.ident,
        'kind': normalized['kind'],
        'renderer_version': RENDERER_VERSION,
        'spec_hash': spec_hash(normalized),
    }
    for field, value in expected.items():
        if sidecar.get(field) != value:
            raise ValueError(f"{question.ident}: image {field} does not match the current question/renderer")
    with Image.open(png) as image:
        if image.size != (sidecar.get('width'), sidecar.get('height')):
            raise ValueError(f"{question.ident}: image dimensions do not match the sidecar")
        image.verify()


if __name__ == '__main__':
    try:
        for filename in sys.argv[1:]:
            verify(Path(filename), ROOT / 'public/images/qbank')
    except (ValueError, OSError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
    print(f"Verified {len(sys.argv) - 1} image/sidecar pairs.")
