"""Feed one synthesized block stream to several writers.

``write_lay_dat`` and ``write_edf_plus`` each pull ``iter_blocks`` themselves,
so an export asking for both formats used to synthesize the whole recording
twice -- the single largest cost of a lab export (a 12 h recording is ~250 M
samples per pass).  :func:`tee_blocks` runs the synthesizer once in a producer
thread and hands every block to each consumer through a bounded queue, so the
two writers proceed in lock-step with at most a couple of 300 s blocks in
memory per consumer.

A consumer that stops early (exception, or simply not draining) is marked dead
and skipped; a producer failure is re-raised in every live consumer so neither
writer silently ends short.
"""
from __future__ import annotations

import queue
import threading
from typing import Iterable, Iterator, List, Tuple

import numpy as np

Block = Tuple[int, np.ndarray]

_END = object()


class _Consumer:
    def __init__(self, maxsize: int) -> None:
        self.q: "queue.Queue[object]" = queue.Queue(maxsize=maxsize)
        self.dead = False

    def __iter__(self) -> Iterator[Block]:
        try:
            while True:
                item = self.q.get()
                if item is _END:
                    return
                if isinstance(item, BaseException):
                    raise item
                yield item  # type: ignore[misc]
        finally:
            # whether we finished, failed, or were closed early: stop receiving
            self.dead = True
            # drain so a blocked producer put() can return
            while True:
                try:
                    self.q.get_nowait()
                except queue.Empty:
                    break


def tee_blocks(blocks: Iterable[Block], n: int, maxsize: int = 2) -> List[Iterator[Block]]:
    """Return ``n`` independent iterators over ``blocks``, synthesized once."""
    consumers = [_Consumer(maxsize) for _ in range(n)]

    def _put(c: _Consumer, item: object) -> None:
        # poll so a consumer that dies while we are blocked does not hang us
        while not c.dead:
            try:
                c.q.put(item, timeout=0.5)
                return
            except queue.Full:
                continue

    def produce() -> None:
        try:
            for item in blocks:
                for c in consumers:
                    if not c.dead:
                        _put(c, item)
                if all(c.dead for c in consumers):
                    return
        except BaseException as error:  # noqa: BLE001 - forwarded to the consumers
            for c in consumers:
                if not c.dead:
                    _put(c, error)
            return
        for c in consumers:
            if not c.dead:
                _put(c, _END)

    threading.Thread(target=produce, name="eeg-render-tee", daemon=True).start()
    return [iter(c) for c in consumers]
