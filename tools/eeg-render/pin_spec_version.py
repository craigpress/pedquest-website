"""Pin every committed question to ``spec_version: 1`` (renderer 0.4.0 upgrade).

0.4.0 changes the DEFAULTS an omitted key receives (see spec.normalize).  The
committed bank was authored against the 0.3.x defaults, so each YAML gets an
explicit ``spec_version: 1`` under ``image.spec`` and keeps normalizing to the
dictionary it always had (plus the version key), and therefore keeps its pixels.
Migrating a question to the new defaults is then a deliberate edit of that line.

    python pin_spec_version.py           # edit in place
    python pin_spec_version.py --check   # report only
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
QUESTIONS = ROOT / "content" / "qbank" / "questions"


def pin(text: str) -> tuple[str, str]:
    """Insert ``spec_version: 1`` as the first key of ``image.spec``; returns (new_text, status)."""
    lines = text.split("\n")
    in_image = False
    for i, line in enumerate(lines):
        if re.match(r"^image:\s*$", line):
            in_image = True
            continue
        if in_image and re.match(r"^\S", line):      # left the image block
            in_image = False
        if in_image and re.match(r"^  spec:\s*$", line):
            nxt = lines[i + 1] if i + 1 < len(lines) else ""
            indent = re.match(r"^(\s*)", nxt).group(1) or "    "
            if re.match(rf"^{indent}spec_version:", nxt):
                return text, "already pinned"
            lines.insert(i + 1, f"{indent}spec_version: 1")
            return "\n".join(lines), "pinned"
    return text, "no image.spec block"


def main() -> int:
    check = "--check" in sys.argv
    counts: dict[str, int] = {}
    for path in sorted(QUESTIONS.glob("*.yaml")):
        text = path.read_text(encoding="utf-8")
        new, status = pin(text)
        counts[status] = counts.get(status, 0) + 1
        if status == "pinned" and not check:
            path.write_text(new, encoding="utf-8")
    print(("would pin" if check else "pinned") + ":", counts)
    return 0 if counts.get("no image.spec block", 0) == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
