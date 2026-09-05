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


QUESTION = ROOT / "content/qbank/questions/PQ-A-001.yaml"
SOURCE_IMAGE = ROOT / "public/images/qbank/PQ-A-001.png"
SOURCE_SIDECAR = ROOT / "public/images/qbank/PQ-A-001.json"


@pytest.fixture
def pair(tmp_path):
    image_dir = tmp_path / "images"
    image_dir.mkdir()
    shutil.copy2(SOURCE_IMAGE, image_dir / "PQ-A-001.png")
    shutil.copy2(SOURCE_SIDECAR, image_dir / "PQ-A-001.json")
    question = tmp_path / "PQ-A-001.yaml"
    shutil.copy2(QUESTION, question)
    return question, image_dir


def mutate_sidecar(image_dir, **changes):
    path = image_dir / "PQ-A-001.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data.update(changes)
    path.write_text(json.dumps(data), encoding="utf-8")


def test_current_png_and_sidecar_verify(pair):
    question, image_dir = pair
    verify(question, image_dir)


def test_stale_question_spec_is_rejected(pair):
    question, image_dir = pair
    text = question.read_text(encoding="utf-8")
    question.write_text(text.replace("seed: 1", "seed: 999", 1), encoding="utf-8")
    with pytest.raises(ValueError, match="spec_hash"):
        verify(question, image_dir)


@pytest.mark.parametrize("field,value", [("id", "PQ-A-999"), ("kind", "eeg_page")])
def test_wrong_identity_is_rejected(pair, field, value):
    question, image_dir = pair
    mutate_sidecar(image_dir, **{field: value})
    with pytest.raises(ValueError, match="image (id|kind)"):
        verify(question, image_dir)


def test_dimensions_are_rejected(pair):
    question, image_dir = pair
    mutate_sidecar(image_dir, width=1)
    with pytest.raises(ValueError, match="dimensions"):
        verify(question, image_dir)


def test_missing_png_is_rejected(pair):
    question, image_dir = pair
    (image_dir / "PQ-A-001.png").unlink()
    with pytest.raises(FileNotFoundError):
        verify(question, image_dir)
