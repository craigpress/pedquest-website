"""Synthesize export blocks on several cores.

The synthesizer is a random-access generator: any window comes back identical
whatever the partition (tests/test_partition_independence.py), so the 300 s
blocks :func:`manifest.iter_blocks` walks can be computed in any order on any
core.  :func:`iter_blocks_parallel` does exactly that with a process pool and
yields them in sequence, so the writers (and the export tee) see the same
stream they always did -- byte for byte.

Each worker process builds its own ``Synthesizer`` once (the constructor is
~0.04 s; a block is ~3.5 s at 256 Hz); a block crosses the process boundary
as ~13 MB of float64, negligible against its compute.  Lookahead is bounded
so memory stays at a few blocks per job.
"""
from __future__ import annotations

from concurrent.futures import Future, ProcessPoolExecutor
from typing import Dict, Iterator, List, Tuple

import numpy as np

from .manifest import BLOCK_S, MARGIN_S

_SYNTH = None


def _init(spec: Dict, duration_s: float) -> None:
    global _SYNTH
    from ..synth import Synthesizer
    _SYNTH = Synthesizer(spec, duration_s)


def _block(lo: int, hi: int, start: int, stop: int) -> np.ndarray:
    assert _SYNTH is not None
    fs = _SYNTH.fs
    _, wide = _SYNTH.segment(lo / fs, hi / fs)
    if wide.shape[1] != hi - lo:          # segment rounds independently
        wide = wide[:, : hi - lo]
    return np.ascontiguousarray(wide[:, start - lo: stop - lo])


def block_plan(fs: int, duration_s: float, n_samples: int,
               block_s: float = BLOCK_S, margin_s: float = MARGIN_S) -> List[Tuple[int, int, int, int]]:
    """The same (lo, hi, start, stop) sequence iter_blocks walks, precomputed."""
    block_n = max(1, int(round(block_s * fs)))
    margin_n = max(0, int(round(margin_s * fs)))
    total_n = int(round(duration_s * fs))
    plan = []
    start = 0
    while start < n_samples:
        stop = min(start + block_n, n_samples)
        plan.append((max(0, start - margin_n), min(total_n, stop + margin_n), start, stop))
        start = stop
    return plan


def iter_blocks_parallel(spec: Dict, duration_s: float, fs: int, n_samples: int, jobs: int,
                         block_s: float = BLOCK_S, margin_s: float = MARGIN_S,
                         lookahead: int | None = None) -> Iterator[Tuple[int, np.ndarray]]:
    """Yield ``(start_sample, block)`` exactly like ``iter_blocks``, computed on ``jobs`` cores."""
    plan = block_plan(fs, duration_s, n_samples, block_s, margin_s)
    if jobs <= 1 or len(plan) <= 1:
        # nothing to parallelise; keep one code path for the caller anyway
        _init(spec, duration_s)
        for lo, hi, start, stop in plan:
            yield start, _block(lo, hi, start, stop)
        return

    jobs = min(jobs, len(plan))
    ahead = lookahead if lookahead is not None else 2 * jobs
    with ProcessPoolExecutor(max_workers=jobs, initializer=_init, initargs=(spec, duration_s)) as pool:
        pending: List[Tuple[int, Future]] = []
        nxt = 0
        while nxt < len(plan) or pending:
            while nxt < len(plan) and len(pending) < ahead:
                lo, hi, start, stop = plan[nxt]
                pending.append((start, pool.submit(_block, lo, hi, start, stop)))
                nxt += 1
            start, fut = pending.pop(0)
            yield start, fut.result()
