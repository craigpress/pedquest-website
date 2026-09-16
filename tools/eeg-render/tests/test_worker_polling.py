"""Worker polling (2026-09-16): one claim request per poll, idle back-off, ordering."""
from __future__ import annotations

import importlib.util
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import unquote

RENDERER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RENDERER))


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, RENDERER / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


lab = _load("lab_worker")
qb = _load("worker")

NOW = datetime(2026, 9, 16, 21, 0, 0, tzinfo=timezone.utc)


def test_candidate_filter_is_one_or_clause_with_both_branches():
    f = unquote(lab._candidate_filter(NOW))
    assert f.startswith("or=(") and f.count("status.eq.pending") == 1 and f.count("status.eq.running") == 1
    assert "lease_expires_at.lt.2026-09-16T21:00:00Z" in f
    assert "created_at" not in f   # no age filter when min_age_s is 0


def test_candidate_filter_applies_min_age_to_pending_only():
    f = unquote(lab._candidate_filter(NOW, min_age_s=120))
    assert "and(status.eq.pending,created_at.lt.2026-09-16T20:58:00Z)" in f
    assert "and(status.eq.running,lease_expires_at.lt.2026-09-16T21:00:00Z)" in f


def test_candidates_makes_a_single_request_and_orders_pending_first():
    calls = []

    class FakeDb:
        def request(self, path, *a, **k):
            calls.append(path)
            return [
                {"id": "r1", "status": "running", "created_at": "2026-09-16T20:00:00Z"},
                {"id": "p2", "status": "pending", "created_at": "2026-09-16T20:30:00Z"},
                {"id": "p1", "status": "pending", "created_at": "2026-09-16T20:10:00Z"},
            ]

    rows = lab._candidates(FakeDb(), min_age_s=120)
    assert len(calls) == 1 and "stage=eq.export" in calls[0] and "or=(" in unquote(calls[0])
    assert [r["id"] for r in rows] == ["p1", "p2", "r1"]


def test_backoff_doubles_to_ceiling_and_resets():
    for mod in (lab, qb):
        b = mod.Backoff(30, 120)
        assert [b.next_idle() for _ in range(5)] == [30, 60, 120, 120, 120]
        b.reset()
        assert b.next_idle() == 30
        flat = mod.Backoff(10)            # no ceiling given: fixed interval
        assert [flat.next_idle() for _ in range(3)] == [10, 10, 10]
        assert mod.Backoff(10, 5).idle_max == 10   # ceiling never below base
