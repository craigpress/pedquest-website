"""0.5.0 (spec_version 3) state model: sleep stages, eye state, and the transients they own.

Feature review 2026-09-26 (normal-variants.md, seizures-icu.md, sedation.md): a "sleep" record held one depth for
hours, spindles fired on a 3.7-s clock at 16/min all night, there were no vertex waves or K-complexes, posterior alpha
survived sleep, muscle vanished for the whole night, and awake records had no eyes-open / eyes-closed state, so the PDR
never attenuated and never showed best just after a blink.

Everything here is drawn once per record from the record seed (``substream``), never per requested window, so a page
and a whole-record export see the same stages, spindles and eye events (the window-dependent-synthesis rule).

Sources: stage definitions and spindle/K-complex/vertex-wave morphology follow the AASM Manual for the Scoring of
Sleep (spindle 11-16 Hz, >= 0.5 s; K-complex a sharp negative then positive wave >= 0.5 s, frontal maximum; vertex
sharp waves < 0.5 s, central maximum).  Cycle lengths (infant about 50-60 min, adult about 90 min) and the
first-cycles N3 / later-cycles REM distribution are standard sleep-architecture descriptions.  Spindle density is an
AUTHORED default (4/min in N2) pending a cited pediatric norm; ``style.spindle_rate_per_min`` overrides it.
"""
from __future__ import annotations

from typing import Dict, List, Sequence, Tuple

import numpy as np

from .rng import substream

Interval = Tuple[float, float, str]

#: per-stage weights; interpolated with a crossfade at stage boundaries
DEPTH = {"W": 0.0, "N1": 0.35, "N2": 0.65, "N3": 1.0, "R": 0.25}
EMG = {"W": 1.0, "N1": 0.6, "N2": 0.25, "N3": 0.2, "R": 0.05}
PDR = {"W": 1.0, "N1": 0.3, "N2": 0.0, "N3": 0.0, "R": 0.1}
SPINDLE = {"W": 0.0, "N1": 0.0, "N2": 1.0, "N3": 0.35, "R": 0.0}
VERTEX = {"W": 0.0, "N1": 1.0, "N2": 0.6, "N3": 0.0, "R": 0.0}
KCOMPLEX = {"W": 0.0, "N1": 0.0, "N2": 1.0, "N3": 0.3, "R": 0.0}
BLINK = {"W": 1.0, "N1": 0.0, "N2": 0.0, "N3": 0.0, "R": 0.0}
XFADE_S = 20.0

CYCLE_MIN = {"neonate": 50.0, "infant": 55.0, "child": 75.0, "adolescent": 90.0, "adult": 90.0}
#: pediatric slow-wave sleep is abundant in the first cycles
N3_FIRST_MIN = {"neonate": 25.0, "infant": 30.0, "child": 40.0, "adolescent": 32.0, "adult": 25.0}


def _lognorm(rng: np.random.Generator, sigma: float) -> float:
    return float(np.exp(rng.normal(0.0, sigma)))


def spans(t_grid: np.ndarray, asleep: np.ndarray) -> List[Tuple[float, float]]:
    """Contiguous True runs of ``asleep`` on a regular grid, as (start, end) seconds."""
    out, start = [], None
    for t, a in zip(t_grid, asleep):
        if a and start is None:
            start = float(t)
        elif not a and start is not None:
            out.append((start, float(t)))
            start = None
    if start is not None:
        out.append((start, float(t_grid[-1])))
    return out


def build_hypnogram(seed: int, sleep_spans: Sequence[Tuple[float, float]], age: str, horizon: float) -> List[Interval]:
    """Stage intervals over the record: W outside the sleep spans, cycling N1/N2/N3/N2/R inside them."""
    rng = substream(seed, "hypnogram")
    cyc0 = CYCLE_MIN.get(age, 90.0) * 60.0
    n3_0 = N3_FIRST_MIN.get(age, 25.0) * 60.0
    out: List[Interval] = []
    t_prev = -120.0
    for a, b in sleep_spans:
        if a > t_prev:
            out.append((t_prev, a, "W"))
        t, c = a, 0
        while t < b:
            cyc = cyc0 * _lognorm(rng, 0.12)
            n1 = (60.0 * rng.uniform(3.0, 7.0)) if c == 0 else 0.0
            n3 = max(0.0, n3_0 - c * 0.4 * n3_0) * rng.uniform(0.7, 1.3)
            rem = min(60.0 * (6.0 + 7.0 * c), 0.4 * cyc) * rng.uniform(0.7, 1.3)
            n2 = max(300.0, cyc - n1 - n3 - rem)
            parts = [("N1", n1), ("N2", 0.4 * n2), ("N3", n3), ("N2", 0.6 * n2), ("R", rem)]
            for stage, d in parts:
                if d <= 0 or t >= b:
                    continue
                out.append((t, min(t + d, b), stage))
                t += d
            c += 1
        t_prev = b
    if t_prev < horizon + 120.0:
        out.append((t_prev, horizon + 120.0, "W"))
    return out


def build_arousals(seed: int, hypno: Sequence[Interval]) -> List[Tuple[float, float]]:
    """Brief arousals (start, duration): about one per 12 min of N2/N3, 5-15 s, when muscle and alpha return."""
    rng = substream(seed, "arousals")
    out = []
    for a, b, stage in hypno:
        if stage not in ("N2", "N3"):
            continue
        t = a + rng.exponential(720.0)
        while t < b - 15.0:
            out.append((t, float(rng.uniform(5.0, 15.0))))
            t += rng.exponential(720.0)
    return out


def build_eye_timeline(seed: int, hypno: Sequence[Interval]) -> List[Interval]:
    """Within wake: alternating eyes-closed (median 25 s) and eyes-open (median 15 s) epochs."""
    rng = substream(seed, "eyes")
    out: List[Interval] = []
    for a, b, stage in hypno:
        if stage != "W":
            continue
        t, state = a, ("closed" if rng.random() < 0.5 else "open")
        while t < b:
            d = (25.0 if state == "closed" else 15.0) * _lognorm(rng, 0.45)
            out.append((t, min(t + d, b), state))
            t += d
            state = "open" if state == "closed" else "closed"
    return out


def weight(t: np.ndarray, intervals: Sequence[Interval], table: Dict[str, float], xfade: float = XFADE_S,
           default: float = 0.0) -> np.ndarray:
    """Per-sample weight from labelled intervals, raised-cosine crossfaded across each boundary."""
    w = np.full(t.shape, default, dtype=float)
    if not intervals:
        return w
    starts = np.array([iv[0] for iv in intervals])
    vals = np.array([table.get(iv[2], default) for iv in intervals])
    k = np.clip(np.searchsorted(starts, t, side="right") - 1, 0, len(intervals) - 1)
    w = vals[k].astype(float)
    if xfade > 0 and len(intervals) > 1:
        for j in range(1, len(intervals)):
            b = starts[j]
            m = (t > b - xfade / 2) & (t < b + xfade / 2)
            if m.any():
                s = 0.5 - 0.5 * np.cos(np.pi * (t[m] - (b - xfade / 2)) / xfade)
                w[m] = vals[j - 1] * (1 - s) + vals[j] * s
    return w


def arousal_gate(t: np.ndarray, arousals: Sequence[Tuple[float, float]]) -> np.ndarray:
    g = np.zeros(t.shape)
    for a, d in arousals:
        if a + d + 3 < t[0] or a - 3 > t[-1]:
            continue
        g = np.maximum(g, np.clip(np.minimum((t - a) / 1.0, (a + d - t) / 2.0), 0.0, 1.0))
    return g


def schedule_transients(seed: int, tag: str, hypno: Sequence[Interval], table: Dict[str, float],
                        rate_per_min: float, refractory_s: float = 2.0) -> np.ndarray:
    """Poisson event times at ``rate_per_min`` x the stage weight (thinned), with a refractory gap."""
    rng = substream(seed, tag)
    times: List[float] = []
    for a, b, stage in hypno:
        r = rate_per_min * table.get(stage, 0.0) / 60.0
        if r <= 0:
            continue
        t = a + rng.exponential(1.0 / r)
        while t < b:
            if not times or t - times[-1] > refractory_s:
                times.append(float(t))
            t += rng.exponential(1.0 / r)
    return np.asarray(times)


def spindle_params(seed: int, n: int, age: str) -> Dict[str, np.ndarray]:
    """Per-spindle duration (s), carrier (Hz) and amplitude factor, drawn once per record."""
    rng = substream(seed, "spindle-shape")
    dur = np.clip(0.8 * np.exp(rng.normal(0.0, 0.35, n)), 0.5, 2.0)
    if age == "infant":
        dur = np.clip(dur * 1.6, 0.6, 3.0)       # infant spindles run long
    return {"dur": dur, "hz": rng.uniform(12.0, 14.5, n), "amp": np.exp(rng.normal(0.0, 0.3, n)),
            "ph": rng.uniform(0.0, 2 * np.pi, n)}


def packets(t: np.ndarray, times: np.ndarray, dur: np.ndarray, hz: np.ndarray, amp: np.ndarray,
            ph: np.ndarray) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Spindle carrier pieces: returns (envelope, cos(phase), sin(phase)) summed over the packets touching ``t``.

    The caller builds each electrode's signal as env * (cos * cos(lag) - sin * sin(lag)), so a per-electrode phase
    lag (traveling spindle) costs one pass.
    """
    env = np.zeros(t.shape)
    c = np.zeros(t.shape)
    s = np.zeros(t.shape)
    if times.size == 0:
        return env, c, s
    sel = np.nonzero((times + dur > t[0]) & (times < t[-1]))[0]
    for k in sel:
        m = (t >= times[k]) & (t < times[k] + dur[k])
        if not m.any():
            continue
        u = (t[m] - times[k]) / dur[k]
        e = amp[k] * np.sin(np.pi * u) ** 2 * (1.0 + 0.25 * np.sin(np.pi * u))     # waxing-waning, slightly late peak
        phase = 2 * np.pi * hz[k] * (t[m] - times[k]) + ph[k]
        env[m] += e
        c[m] += e * np.cos(phase)
        s[m] += e * np.sin(phase)
    return env, c, s
