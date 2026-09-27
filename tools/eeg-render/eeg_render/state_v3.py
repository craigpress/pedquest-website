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


#: phase D (sleep family): share of N2 spindles in the slow FRONTAL group (11-12.5 Hz, Fz/F3/F4 maximum); the rest
#: are fast centro-parietal (12.5-15 Hz).  Slow frontal spindles dominate young children and wane with age (De
#: Gennaro & Ferrara 2003, Sleep Med Rev 7:423; Shinomiya 1999); infant spindles are one central 12-14 Hz comb.
SLOW_SPINDLE_FRAC = {"infant": 0.0, "child": 0.4, "adolescent": 0.3, "adult": 0.25}
#: median spindle duration (s): AASM >= 0.5 s, most 0.5-2 s (learningeeg Spindles about 1.3-1.5 s visible); infant
#: spindles 3-9 months run several seconds (learningeeg 4-month-old: a 5-6 s asynchronous spindle)
SPINDLE_DUR = {"infant": (3.5, 0.4, 1.5, 8.0), "child": (1.25, 0.3, 0.6, 2.6), "adolescent": (1.15, 0.3, 0.6, 2.4),
               "adult": (1.05, 0.3, 0.55, 2.2)}


def spindle_params(seed: int, n: int, age: str, v3d: bool = False) -> Dict[str, np.ndarray]:
    """Per-spindle duration (s), carrier (Hz) and amplitude factor, drawn once per record.

    ``v3d`` (phase D): age-scaled durations, a slow frontal / fast centro-parietal split (``slow`` flag), and for
    infants a hemisphere per spindle (``side`` -1 left, +1 right, 0 both): infant spindles are asynchronous until
    about the second year (learningeeg 4-month-old asleep; Ellingson 1982).
    """
    rng = substream(seed, "spindle-shape")
    if not v3d:
        dur = np.clip(0.8 * np.exp(rng.normal(0.0, 0.35, n)), 0.5, 2.0)
        if age == "infant":
            dur = np.clip(dur * 1.6, 0.6, 3.0)       # infant spindles run long
        return {"dur": dur, "hz": rng.uniform(12.0, 14.5, n), "amp": np.exp(rng.normal(0.0, 0.3, n)),
                "ph": rng.uniform(0.0, 2 * np.pi, n)}
    med, sig, lo, hi = SPINDLE_DUR.get(age, SPINDLE_DUR["adult"])
    dur = np.clip(med * np.exp(rng.normal(0.0, sig, n)), lo, hi)
    slow = rng.random(n) < SLOW_SPINDLE_FRAC.get(age, 0.25)
    hz = np.where(slow, rng.uniform(11.0, 12.5, n), rng.uniform(12.5, 15.0, n))
    if age == "infant":
        hz = rng.uniform(12.0, 14.0, n)
    side = np.zeros(n)
    if age == "infant":
        side = rng.choice([-1.0, 1.0, 0.0], size=n, p=[0.4, 0.4, 0.2])
    return {"dur": dur, "hz": hz, "amp": np.exp(rng.normal(0.0, 0.3, n)), "ph": rng.uniform(0.0, 2 * np.pi, n),
            "slow": slow, "side": side, "peak": rng.uniform(0.3, 0.5, n)}


def spindle_envelope(u: np.ndarray, peak: float) -> np.ndarray:
    """Phase D waxing-waning spindle envelope on u in [0, 1): a raised-sine rise to ``peak`` (0.3-0.5 of the duration)
    and a longer fall, flattened (power 0.6) so about 70 % of the scheduled duration stands above half amplitude.
    The 0.5.0 sin^2 envelope held only 0.4 s above half amplitude (normal-variants re-review)."""
    w = np.where(u < peak, 0.5 * u / peak, 0.5 + 0.5 * (u - peak) / (1.0 - peak))
    return np.sin(np.pi * np.clip(w, 0.0, 1.0)) ** 0.6


def packets(t: np.ndarray, times: np.ndarray, dur: np.ndarray, hz: np.ndarray, amp: np.ndarray,
            ph: np.ndarray, peak: np.ndarray = None) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Spindle carrier pieces: returns (envelope, cos(phase), sin(phase)) summed over the packets touching ``t``.

    The caller builds each electrode's signal as env * (cos * cos(lag) - sin * sin(lag)), so a per-electrode phase
    lag (traveling spindle) costs one pass.  ``peak`` (phase D) selects the asymmetric envelope.
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
        if peak is None:
            e = amp[k] * np.sin(np.pi * u) ** 2 * (1.0 + 0.25 * np.sin(np.pi * u))
        else:
            e = amp[k] * spindle_envelope(u, float(peak[k]))
        phase = 2 * np.pi * hz[k] * (t[m] - times[k]) + ph[k]
        env[m] += e
        c[m] += e * np.cos(phase)
        s[m] += e * np.sin(phase)
    return env, c, s


# ---------------------------------------------------------------------------------------------------------------
# 0.5.0 phase D (montage family): state-dependent event rates.  A shared hook for anything whose rate depends on the
# sleep stage - sporadic interictal discharges now; the generalized family's ESES / DEE-SWAS gating can use the same
# three functions.  Stage labels are the hypnogram's: W, N1, N2, N3, R.
# ---------------------------------------------------------------------------------------------------------------

#: how much of an authored NREM activation factor each stage gets (0 = wake rate, 1 = full factor).  Interictal
#: discharges are activated by drowsiness and all NREM stages and return towards the waking rate in REM (SeLECTS:
#: ILAE 2022 syndrome definition, "activated in drowsiness and sleep"; ESES/DEE-SWAS: NREM-activated, REM-fragmented).
#: The per-stage split is AUTHORED (N1 partial, N2 = N3 full, REM near wake) pending a cited stage-by-stage norm.
NREM_ACTIVATION = {"W": 0.0, "N1": 0.6, "N2": 1.0, "N3": 1.0, "R": 0.1}
NREM_STAGES = ("N1", "N2", "N3")


def stage_rate_table(base: float, sleep_activation: "float | None" = None,
                     state_rates: "Dict[str, float] | None" = None) -> Dict[str, float]:
    """Rate per stage: ``base x (1 + (activation - 1) x NREM_ACTIVATION[stage])``, then any explicit
    ``state_rates`` entry overrides its stage.  Units are whatever ``base`` is (per hour for discharges)."""
    k = 1.0 if sleep_activation is None else float(sleep_activation)
    out = {st: float(base) * (1.0 + (k - 1.0) * w) for st, w in NREM_ACTIVATION.items()}
    for st, r in (state_rates or {}).items():
        out[str(st)] = float(r)
    return out


def rate_at(t: np.ndarray, hypno: Sequence[Interval], table: Dict[str, float], default: float) -> np.ndarray:
    """Per-time rate from the hypnogram, raised-cosine crossfaded across stage boundaries (``weight``)."""
    if not hypno:
        return np.full(np.shape(t), float(default))
    return weight(np.asarray(t, float), hypno, table, default=float(default))


def stage_intervals(hypno: Sequence[Interval], stages: Sequence[str] = NREM_STAGES) -> List[Tuple[float, float]]:
    """(start, end) runs of the given stages, adjacent runs merged: the NREM windows a continuous pattern lives in."""
    out: List[Tuple[float, float]] = []
    for a, b, st in hypno:
        if st not in stages or b <= a:
            continue
        if out and abs(out[-1][1] - a) < 1e-9:
            out[-1] = (out[-1][0], b)
        else:
            out.append((a, b))
    return out


# ------------------------------------------------------------------ phase D (sleep family) --
#: slow waves per minute by stage: AASM N3 needs > 20 % of the epoch in 0.5-2 Hz waves >= 75 uV (frontal); N2 holds
#: a few isolated ones
SWS_RATE = {"N2": 1.5, "N3": 70.0}
#: REM: sawtooth trains (AASM: trains of sharply contoured or triangular, often serrated, 2-6 Hz waves, central
#: maximum, often preceding a burst of rapid eye movements; eegatlas-online sawtooth waves #2784)
SAWTOOTH_RATE = {"R": 2.0}
#: rapid eye movements: clusters per minute in REM (phasic REM; learningeeg REM-Sleep-ex-3)
REM_CLUSTER_RATE = {"R": 4.0}


def schedule_slow_waves(seed: int, hypno: Sequence[Interval], age: str) -> Dict[str, np.ndarray]:
    """Individual slow waves (the slow oscillation) in N3 and a few in N2: onset, surface-negative half-wave duration
    (0.25-0.75 s, i.e. 0.7-2 Hz), amplitude factor (lognormal) and the relative size of the positive rebound."""
    times = schedule_transients(seed, "sws-waves", hypno, SWS_RATE, 1.0, 0.45)
    rng = substream(seed, "sws-shape")
    n = times.size
    return {"t": times, "half": np.clip(0.45 * np.exp(rng.normal(0.0, 0.3, n)), 0.3, 0.9),
            "amp": np.exp(rng.normal(0.0, 0.3, n)), "pos": rng.uniform(0.4, 0.8, n)}


def schedule_sawtooth(seed: int, hypno: Sequence[Interval]) -> Dict[str, np.ndarray]:
    """Sawtooth trains in REM: onset, wave count (3-8), frequency (2-4 Hz), amplitude factor."""
    times = schedule_transients(seed, "sawtooth", hypno, SAWTOOTH_RATE, 1.0, 4.0)
    rng = substream(seed, "sawtooth-shape")
    n = times.size
    return {"t": times, "n": rng.integers(3, 9, n), "hz": rng.uniform(2.0, 4.0, n), "amp": np.exp(rng.normal(0.0, 0.25, n))}


def rem_saccades(seed: int, hypno: Sequence[Interval], saw_t: np.ndarray) -> List[Tuple[float, float, float, float]]:
    """Rapid eye movements in REM as gaze steps ``(start, rise_s, from, to)``: clusters of 2-5 saccades in 1-2 s, rise
    40-150 ms, alternating direction (REM-Sleep-ex-3), a cluster after each sawtooth train plus Poisson clusters;
    the gaze drifts back to centre between clusters."""
    rng = substream(seed, "rem-saccades")
    starts = list(schedule_transients(seed, "rem-clusters", hypno, REM_CLUSTER_RATE, 1.0, 3.0))
    starts += [float(s) + float(rng.uniform(0.8, 2.0)) for s in saw_t]
    steps: List[Tuple[float, float, float, float]] = []
    pos, side = 0.0, 1.0
    for c0 in sorted(starts):
        if steps and c0 < steps[-1][0] + steps[-1][1] + 0.3:
            continue
        tt = c0
        for _ in range(int(rng.integers(2, 6))):
            to = side * float(rng.uniform(0.4, 1.0))
            rise = float(rng.uniform(0.04, 0.15))
            steps.append((tt, rise, pos, to))
            pos = to
            side = -side if rng.random() < 0.8 else side
            tt += rise + float(rng.uniform(0.15, 0.5))
        steps.append((tt + 0.3, 0.7, pos, 0.0))             # slow drift back to centre after the cluster
        pos = 0.0
    return steps
