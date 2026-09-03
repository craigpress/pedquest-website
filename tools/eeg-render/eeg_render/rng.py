"""Deterministic, random-access RNG substreams.

Every stochastic element of the synthesis draws from a substream keyed by
``(seed, *tags)``.  Because the key is hashed (not consumed sequentially), a
frame of signal can be regenerated in isolation and will be bit-identical no
matter what order the renderer touched the recording in.  That is what makes
``segment(t0, t1)`` random-access *and* deterministic.
"""

from __future__ import annotations

import hashlib

import numpy as np


def key(seed: int, *tags: object) -> int:
    """Stable 64-bit integer derived from a seed and arbitrary tags."""
    payload = repr((int(seed),) + tuple(tags)).encode("utf-8")
    digest = hashlib.blake2b(payload, digest_size=8).digest()
    return int.from_bytes(digest, "little", signed=False)


def substream(seed: int, *tags: object) -> np.random.Generator:
    """A ``numpy`` Generator uniquely and reproducibly bound to ``tags``."""
    return np.random.default_rng(key(seed, *tags))
