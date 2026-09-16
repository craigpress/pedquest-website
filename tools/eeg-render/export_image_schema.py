"""Write the renderer's complete image schema for TypeScript/Ajv consumers."""

from __future__ import annotations

import copy
import json
from pathlib import Path

from eeg_render.schema import IMAGE_SCHEMA, SPEC_SCHEMAS


def main() -> None:
    schema = copy.deepcopy(IMAGE_SCHEMA)
    schema["allOf"].append({
        "oneOf": [
            {
                "properties": {
                    "kind": {"const": kind},
                    "spec": spec_schema,
                },
                "required": ["kind", "spec"],
            }
            for kind, spec_schema in SPEC_SCHEMAS.items()
        ]
    })
    target = Path(__file__).parents[2] / "content" / "qbank" / "schema" / "render-image.schema.json"
    target.write_text(json.dumps(schema, separators=(",", ":")) + "\n", encoding="utf-8")
    print(target)


if __name__ == "__main__":
    main()
