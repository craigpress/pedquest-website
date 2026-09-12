"""Make ``persyst_bridge`` importable from ``tests/`` without an install."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
