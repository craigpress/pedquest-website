import json
import shutil
import sys
from pathlib import Path

import pytest
from PIL import Image

RENDERER = Path(__file__).resolve().parents[1]
ROOT = RENDERER.parents[1]
sys.path.insert(0, str(RENDERER))

from verify_sidecars import verify
from eeg_render import RENDERER_VERSION
from eeg_render.spec import load_question, normalize, spec_hash


QUESTION = ROOT / "content/qbank/questions/PQ-A-001.yaml"
SOURCE_IMAGE = ROOT / "public/images/qbank/PQ-A-001.png"
SOURCE_SIDECAR = ROOT / "public/images/qbank/PQ-A-001.json"


def _copy(tmp_path):
    image_dir = tmp_path / "images"
    image_dir.mkdir()
    shutil.copy2(SOURCE_IMAGE, image_dir / "PQ-A-001.png")
    shutil.copy2(SOURCE_SIDECAR, image_dir / "PQ-A-001.json")
    question = tmp_path / "PQ-A-001.yaml"
    shutil.copy2(QUESTION, question)
    return question, image_dir


@pytest.fixture
def pair(tmp_path):
    """The repo's real image and sidecar, exactly as committed."""
    return _copy(tmp_path)


@pytest.fixture
def current_pair(tmp_path):
    """The same pair, restamped as though it had just been rendered.

    Every test below except the staleness canary is checking one specific
    rejection.  ``verify`` raises on the first mismatching field, so while the
    committed images are stale a version mismatch pre-empts the thing each test
    is actually about, and they pass or fail for the wrong reason.
    """
    question, image_dir = _copy(tmp_path)
    path = image_dir / "PQ-A-001.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["renderer_version"] = RENDERER_VERSION
    data["spec_hash"] = spec_hash(normalize(load_question(question).image))
    path.write_text(json.dumps(data), encoding="utf-8")
    return question, image_dir


def mutate_sidecar(image_dir, **changes):
    path = image_dir / "PQ-A-001.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data.update(changes)
    path.write_text(json.dumps(data), encoding="utf-8")


def test_current_png_and_sidecar_verify(pair):
    """Every committed image verifies against its question and this renderer.

    This was a strict xfail from 0.3.7 through 0.3.9's development while the
    committed images were deliberately stale; render-all at 0.3.9 (2026-09-12)
    made them current again.  If it fails, either a spec changed without a
    re-render or the renderer version moved - run render-all, do not mark it.
    """
    question, image_dir = pair
    verify(question, image_dir)


def test_a_freshly_rendered_pair_verifies(current_pair):
    """The verifier itself still accepts a current pair."""
    question, image_dir = current_pair
    verify(question, image_dir)


def test_stale_question_spec_is_rejected(current_pair):
    question, image_dir = current_pair
    text = question.read_text(encoding="utf-8")
    question.write_text(text.replace("seed: 1", "seed: 999", 1), encoding="utf-8")
    with pytest.raises(ValueError, match="spec_hash"):
        verify(question, image_dir)


@pytest.mark.parametrize("field,value", [("id", "PQ-A-999"), ("kind", "eeg_page")])
def test_wrong_identity_is_rejected(current_pair, field, value):
    question, image_dir = current_pair
    mutate_sidecar(image_dir, **{field: value})
    with pytest.raises(ValueError, match="image (id|kind)"):
        verify(question, image_dir)


def test_dimensions_are_rejected(current_pair):
    question, image_dir = current_pair
    mutate_sidecar(image_dir, width=1)
    with pytest.raises(ValueError, match="dimensions"):
        verify(question, image_dir)


def test_missing_png_is_rejected(current_pair):
    question, image_dir = current_pair
    (image_dir / "PQ-A-001.png").unlink()
    with pytest.raises(FileNotFoundError):
        verify(question, image_dir)
