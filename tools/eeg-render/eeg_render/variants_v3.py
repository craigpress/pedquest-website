"""0.5.0 (spec_version 3) normal variants: scheduled bursts, side independence, arciform polarity, smooth fields.

Feature review 2026-09-26 (normal-variants.md, Craig's B5 notes): every authored variant was a constant sinusoid
filling its whole window, identical on both sides; mu and wickets had the sharp phase surface-POSITIVE; the HV, RMTD
and FAR fields were sparse dicts defaulting to 0, which gave false maxima at the chain ends and flat links;
hypnagogic hypersynchrony and posterior slow waves of youth were broad in-phase fields that cancelled on the bipolar
chain (Craig rejected both); POSTS came once per page as a merged 4-5 Hz run.

Everything here is drawn once per record (``substream`` keyed by the spec event index or variant name), never per
requested window.  A schedule is a list of plain dicts; the row builders are pure functions of time.

Sign convention: generator values are surface potentials (positive = surface-positive).  The page draws negative-up.
"""
from __future__ import annotations

from typing import Dict, List, Sequence, Tuple

import numpy as np

from . import montage as mt
from .rng import substream

# ---------------------------------------------------------------- fields --
# Full 19-electrode tables, LEFT hemisphere version (midline listed at the value each side contributes).  A side's
# field is its table; the right side mirrors the names.  Every electrode is listed, so no neighbour sits at an
# implicit 0 (the false-peak / flat-link failure the review measured on HV, RMTD and FAR).
_MIRROR = {"Fp1": "Fp2", "F7": "F8", "F3": "F4", "T3": "T4", "C3": "C4", "T5": "T6", "P3": "P4", "O1": "O2", "T1": "T2"}
_MIRROR.update({v: k for k, v in list(_MIRROR.items())})

FIELDS_LEFT: Dict[str, Dict[str, float]] = {
    "midline_theta": {"Cz": 1.0, "Fz": 0.55, "Pz": 0.25, "C3": 0.12, "C4": 0.12,
                      "F3": 0.06, "F4": 0.06, "P3": 0.05, "P4": 0.05},
    # central: C3 max, reversal F3-C3 / C3-P3, some Cz, a little temporal (Mu-IV, very-nice-Mu)
    "mu": {"Fp1": 0.05, "F7": 0.08, "F3": 0.30, "Fz": 0.12, "T3": 0.30, "C3": 1.0, "Cz": 0.35, "T5": 0.10,
           "P3": 0.40, "Pz": 0.12, "O1": 0.05},
    # mid-temporal: T3 max with F7/T5 shoulders (Wickets_1, Wickets-III)
    "wicket": {"Fp1": 0.08, "F7": 0.45, "F3": 0.15, "Fz": 0.04, "T3": 1.0, "C3": 0.30, "Cz": 0.05, "T5": 0.50,
               "P3": 0.15, "Pz": 0.04, "O1": 0.10},
    # occipital positive (lambda-waves-at-10uV-2): O max, T5/P3 shoulders
    # phase D (re-review: T3-T5 / T4-T6 at or above T5-O1 because T5 0.60 against T3 0.10): a steeper occipital
    # field, so the lambda is largest in P3-O1 / T5-O1 and small in the mid-temporal link
    "lambda": {"Fp1": 0.02, "F7": 0.02, "F3": 0.03, "Fz": 0.02, "T3": 0.05, "C3": 0.08, "Cz": 0.04, "T5": 0.32,
               "P3": 0.40, "Pz": 0.20, "O1": 1.0},
    # broad posterior (14-and-6 at 10 uV, 6-Hz positive spikes 4): posterior temporal max, parietal and occipital
    # phase D (re-review: invisible on bipolar, T5-O1 0.4x background): P3 = O1 = 0.60 cancelled P3-O1 and left
    # T5-O1 0.4; posterior temporal maximum with a steeper fall to O1 / P3 / T3
    "fourteen_and_six": {"Fp1": 0.03, "F7": 0.08, "F3": 0.08, "Fz": 0.05, "T3": 0.30, "C3": 0.20, "Cz": 0.10,
                         "T5": 1.0, "P3": 0.45, "Pz": 0.20, "O1": 0.45},
    # mid-temporal theta (RMTD_1, RMTD-on-the-right): smooth, T3 max
    # phase B (variants-neonatal-r3 V110-05: Fp1-F7 83 = T3-T5 85 uV, fronto-temporal-to-occipital on the page): a
    # mid-temporal maximum with steep shoulders, so F7-T3 / T3-T5 carry it (reversing at T3) and Fp1-F7 / T5-O1 less
    "rmtd": {"Fp1": 0.12, "F7": 0.40, "F3": 0.15, "Fz": 0.04, "T3": 1.0, "C3": 0.30, "Cz": 0.05, "T5": 0.45,
             "P3": 0.20, "Pz": 0.05, "O1": 0.22},
    # temporo-parietal (Westmoreland & Klass description)
    "sreda": {"Fp1": 0.06, "F7": 0.20, "F3": 0.20, "Fz": 0.08, "T3": 0.55, "C3": 0.50, "Cz": 0.20, "T5": 1.0,
              "P3": 0.80, "Pz": 0.35, "O1": 0.45},
    # frontal (White & Tharp description), smooth
    "frontal_arousal_rhythm": {"Fp1": 0.80, "F7": 0.50, "F3": 1.0, "Fz": 0.50, "T3": 0.20, "C3": 0.40,
                               "Cz": 0.25, "T5": 0.10, "P3": 0.15, "Pz": 0.08, "O1": 0.05},
    # photic driving: occipital, some parietal / posterior temporal
    # phase D (re-review: T3-T5 / C3-P3 at or above P3-O1 / T5-O1, so the maximum did not read occipital): the
    # occipital maximum stands alone (learningeeg photic-driving: P3-O1, T5-O1, P4-O2, T6-O2)
    "photic_driving": {"Fp1": 0.02, "F7": 0.03, "F3": 0.04, "Fz": 0.02, "T3": 0.06, "C3": 0.06, "Cz": 0.03,
                       "T5": 0.30, "P3": 0.25, "Pz": 0.15, "O1": 1.0},
    # HV buildup (hv-slowing): diffuse, frontal maximum, temporal chains included
    "hyperventilation_buildup": {"Fp1": 0.80, "F7": 0.80, "F3": 1.0, "Fz": 0.50, "T3": 0.70, "C3": 0.85,
                                 "Cz": 0.45, "T5": 0.60, "P3": 0.65, "Pz": 0.32, "O1": 0.60},
    # hypnagogic / hypnopompic hypersynchrony: broad, every chain incl. temporal (Hypnapompic-Hypersynchrony)
    # r6 (r5-background open item; hypnagogic hypersynchrony is maximal fronto-centrally): F3/C3/Fz/Cz carry the
    # maximum, the frontopolar, temporal and posterior leads fall off (the 0.5.0 table had P3 0.75 / O1 0.50 against
    # F3 0.95 and the midline at 0.50, a fronto-central / posterior RMS ratio of 1.3).  T5 stays 0.45 over O1 0.15 so
    # T5-O1 / T6-O2 still carry the run (B5-06: every chain involved)
    "hypnagogic_hypersynchrony": {"Fp1": 0.55, "F7": 0.55, "F3": 1.0, "Fz": 0.90, "T3": 0.60, "C3": 1.0,
                                  "Cz": 0.95, "T5": 0.45, "P3": 0.55, "Pz": 0.45, "O1": 0.15},
    # POSTS: occipital
    "posts": {"Fp1": 0.02, "F7": 0.02, "F3": 0.03, "Fz": 0.02, "T3": 0.06, "C3": 0.06, "Cz": 0.03, "T5": 0.35,
              "P3": 0.30, "Pz": 0.15, "O1": 1.0},
    # PSWY: occipital, T5 shoulder, little parietal (posterior-slow-waves-of-youth-again_1: P3-O1, T5-O1, T6-O2)
    "posterior_slow_waves_of_youth": {"Fp1": 0.02, "F7": 0.03, "F3": 0.04, "Fz": 0.02, "T3": 0.10, "C3": 0.08,
                                      "Cz": 0.04, "T5": 0.30, "P3": 0.28, "Pz": 0.14, "O1": 1.0},
}

#: seconds of phase lag per unit of y (front positive) so neighbouring derivations of a broad in-phase field do not
#: cancel (the review's HH fix: "40 ms x y-position")
LAG_S_PER_Y = {"hypnagogic_hypersynchrony": 0.040, "hyperventilation_buildup": 0.035}


def side_field(kind: str, electrodes: Sequence[str], side: str) -> np.ndarray:
    """One side's field over ``electrodes`` (``side`` 'left' or 'right')."""
    tab = FIELDS_LEFT[kind]
    out = np.zeros(len(electrodes))
    for i, e in enumerate(electrodes):
        name = e if side == "left" else _MIRROR.get(e, e)
        out[i] = mt.table_value(tab, name, 0.0)
    return out


#: kinds whose authored amplitude_uv (spec_version 3) is the peak-to-peak in the best longitudinal-bipolar
#: derivation, the voltage a reader measures; 14 & 6 is read referentially and HV carries its own calibration
DISPLAY_SCALED = ("mu", "wicket", "lambda", "rmtd", "sreda", "frontal_arousal_rhythm", "photic_driving", "midline_theta")


def bipolar_scale(kind: str, electrodes: Sequence[str]) -> float:
    """1 / the largest longitudinal-bipolar field difference of one side, so unit amplitude shows as unit p2p."""
    if kind not in DISPLAY_SCALED:
        return 1.0
    f = dict(zip(electrodes, side_field(kind, electrodes, "left")))
    diffs = [abs(f[a] - f[b]) for a, b in mt.montage_pairs("longitudinal_bipolar", electrodes)
             if b is not None and a in f and b in f]
    return 1.0 / max(max(diffs, default=1.0), 0.1)


def y_positions(electrodes: Sequence[str]) -> np.ndarray:
    return np.array([mt.POSITIONS.get(e, (0.0, 0.0))[1] for e in electrodes])


# ------------------------------------------------------------ schedules --
def intersect_intervals(intervals: Sequence[Tuple[float, float]],
                        allowed: Sequence[Tuple[float, float]]) -> List[Tuple[float, float]]:
    """Clip support without rescheduling a burst or resetting its phase/RNG."""
    pieces = sorted((max(a, x), min(b, y)) for a, b in intervals for x, y in allowed
                    if min(b, y) > max(a, x))
    out = []
    for a, b in pieces:
        if out and a <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


def interval_mask(t: np.ndarray, intervals: Sequence[Tuple[float, float]]) -> np.ndarray:
    """Half-open support evaluated at absolute times, independent of render windows."""
    live = np.zeros(t.shape, dtype=bool)
    for a, b in intervals:
        live |= (t >= a) & (t < b)
    return live


def _ln(rng: np.random.Generator, median: float, sigma: float, lo: float, hi: float) -> float:
    return float(np.clip(median * np.exp(rng.normal(0.0, sigma)), lo, hi))


def trains(rng: np.random.Generator, a: float, b: float, on: Tuple[float, float, float, float],
           off: Tuple[float, float, float, float], lead: Tuple[float, float] = (0.0, 1.5)) -> List[Tuple[float, float]]:
    """Alternating on/off intervals inside [a, b); ``on``/``off`` are (median, sigma, lo, hi) lognormal."""
    out = []
    t = a + float(rng.uniform(*lead))
    while t < b - 0.3:
        d = _ln(rng, *on)
        out.append((t, min(t + d, b)))
        t += d + _ln(rng, *off)
    return out


def authored_schedule(seed: int, index: int, run: Dict) -> List[Dict]:
    """Bursts for one authored variant run.  Each burst: t0, t1, hz, amp (uV at the field max), side ('left' /
    'right' / 'both'), ph0 and kind-specific extras.  Side-independent kinds draw each hemisphere separately."""
    kind, a, b = run["variant"], run["t0"], run["t1"]
    f, amp, side = float(run["frequency_hz"]), float(run["amplitude_uv"]), run.get("side", "both")
    out: List[Dict] = []

    if kind == "midline_theta":
        rng = substream(seed, "v3-authored", index, kind)
        for t0, t1 in trains(rng, a, b, (9.0, 0.25, 5.0, 18.0), (3.0, 0.3, 1.5, 5.0)):
            out.append({"t0": t0, "t1": t1, "hz": f, "amp": amp,
                        "side": "left", "ph0": float(rng.uniform(0, 2 * np.pi))})
    elif kind in ("mu", "wicket", "rmtd", "frontal_arousal_rhythm"):
        # independent trains per hemisphere (Mu-IV, Wickets_1, RMTD-on-the-right)
        prm = {"mu": ((1.6, 0.5, 0.5, 4.0), (1.2, 0.5, 0.5, 3.0), (-0.5, 0.5)),
               "wicket": ((1.2, 0.5, 0.3, 3.0), (1.8, 0.6, 0.5, 5.0), (-0.8, 0.8)),
               "rmtd": ((3.5, 0.5, 1.5, 10.0), (2.5, 0.6, 1.0, 8.0), (-0.3, 0.3)),
               # phase B (variants-neonatal-r3 V110-08: 1.3-2 s trains read as the spindles before them): trains of
               # 3 s or more (White & Tharp 1974: prolonged 7-10 Hz frontal trains), starting after the arousal burst
               "frontal_arousal_rhythm": ((4.5, 0.35, 3.0, 9.0), (1.0, 0.4, 0.4, 2.5), (-0.5, 0.5))}[kind]
        on, off, dhz = prm
        if kind == "mu" and run.get("train_duration_s") is not None:
            length = float(run["train_duration_s"])
            on = (length, 0.15, 0.8 * length, 1.2 * length)
        for k, sd in enumerate(("left", "right")):
            rng = substream(seed, "v3-authored", index, kind, sd)
            lead = (0.0, 1.5) if k == 0 else (0.5, 3.0)
            if kind == "frontal_arousal_rhythm":
                lead = (1.0, 1.8) if k == 0 else (1.2, 2.4)
            iv = trains(rng, a, b, on, off, lead=lead)
            if kind == "wicket":
                # plus scattered single wickets between trains
                singles = []
                for _ in range(int(rng.integers(1, 4))):
                    s0 = float(rng.uniform(a, b - 0.2))
                    singles.append((s0, s0 + 1.0 / f))
                iv = sorted(iv + singles)
            for t0, t1 in iv:
                a_side = 1.0 if side in ("both", sd) else 0.12
                out.append({"t0": t0, "t1": t1, "hz": float(np.clip(f + rng.uniform(*dhz), 1.0, 30.0)),
                            "amp": amp * a_side * float(np.exp(rng.normal(0, 0.2))), "side": sd,
                            "ph0": float(rng.uniform(0, 2 * np.pi))})
    elif kind == "fourteen_and_six":
        # isolated 0.5-1 s bursts, 14 Hz (70 %) or 6-7 Hz (30 %) unless the author chose 6; one side or both
        rng = substream(seed, "v3-authored", index, kind)
        t = a + float(rng.uniform(0.3, 2.0))
        while t < b - 0.5:
            d = float(rng.uniform(0.5, 1.0))
            if f < 10.0:
                hz = float(rng.uniform(6.0, 7.0))
            else:
                six = not rng.random() < 0.7
                if len(out) >= 1 and not any(b["hz"] < 10.0 for b in out):
                    six = True     # phase D (re-review: the 6-Hz arm never fired): the second burst is the 6-Hz arm
                hz = float(rng.uniform(6.0, 7.0)) if six else 14.0 + float(rng.uniform(-0.5, 0.5))
            sd = side if side in ("left", "right") else ("left", "right", "both")[int(rng.integers(0, 3))]
            for s2 in (("left", "right") if sd == "both" else (sd,)):
                out.append({"t0": t, "t1": min(t + d, b), "hz": hz, "amp": amp * float(np.exp(rng.normal(0, 0.2))),
                            "side": s2, "ph0": 0.0})
            t += d + _ln(rng, 5.0, 0.5, 2.0, 15.0)
    elif kind == "lambda":
        # saccade-locked: one lambda 80 ms after each saccade, 2-4 per second, bilateral with a small asymmetry
        rng = substream(seed, "v3-authored", index, kind)
        asym = float(rng.uniform(-0.15, 0.15))
        t, gaze = a + float(rng.uniform(0.1, 0.4)), 1.0
        while t < b - 0.3:
            gaze = -gaze
            s = float(np.exp(rng.normal(0, 0.2)))
            for sd, g in (("left", 1.0 - asym), ("right", 1.0 + asym)):
                out.append({"t0": t + 0.08, "t1": t + 0.08 + 0.33, "hz": 0.0, "amp": amp * s * g, "side": sd,
                            "ph0": 0.0, "saccade": t, "gaze": gaze})
            t += _ln(rng, 0.33, 0.35, 0.18, 0.9)
    elif kind == "photic_driving":
        rng = substream(seed, "v3-authored", index, kind)
        for sd in ("left", "right"):
            # phase D (re-review: left 71 / right 39 uV, a > 50 % asymmetry read as abnormal): side gain within +-10 %
            g = (1.0 if side in ("both", sd) else 0.12) * float(np.clip(np.exp(rng.normal(0, 0.15)), 0.9, 1.1))
            out.append({"t0": a, "t1": b, "hz": f, "amp": amp * g, "side": sd, "ph0": 0.0,
                        "jit": rng.normal(0.0, 0.004, int(np.ceil((b - a) * f)) + 2).tolist()})
    elif kind == "sreda":
        rng = substream(seed, "v3-authored", index, kind)
        lead = ("left", "right")[int(rng.integers(0, 2))]
        onset = min(float(rng.uniform(5.0, 10.0)), 0.4 * (b - a))
        for sd in ("left", "right"):
            g = 1.0 if sd == lead else float(rng.uniform(0.55, 0.85))
            out.append({"t0": a, "t1": b, "hz": f, "amp": amp * g, "side": sd, "ph0": float(rng.uniform(0, 6.28)),
                        "onset": onset, "lag": 0.0 if sd == lead else float(rng.uniform(0.03, 0.12))})
    elif kind == "hyperventilation_buildup":
        rng = substream(seed, "v3-authored", index, kind)
        ncomp = 14
        comps = {"f_off": rng.uniform(-0.8, 0.8, ncomp).tolist(), "ph": rng.uniform(0, 2 * np.pi, ncomp).tolist(),
                 "w": np.exp(rng.normal(0, 0.4, ncomp)).tolist()}
        for sd in ("left", "right"):
            own = {"f_off": rng.uniform(-0.8, 0.8, ncomp).tolist(), "ph": rng.uniform(0, 2 * np.pi, ncomp).tolist(),
                   "w": np.exp(rng.normal(0, 0.4, ncomp)).tolist()}
            g = 1.0 if side in ("both", sd) else 0.12
            out.append({"t0": a, "t1": b, "hz": f, "amp": amp * g, "side": sd, "ph0": 0.0,
                        "common": comps, "own": own})
    return out


# ------------------------------------------------------------ waveforms --
def _arc_raw(ph: np.ndarray) -> np.ndarray:
    s = np.sin(ph)
    return 0.8 * np.maximum(s, 0.0) ** 0.5 - np.maximum(-s, 0.0) ** 2.2


def _spiky_raw(ph: np.ndarray) -> np.ndarray:
    s = np.sin(ph)
    return np.maximum(s, 0.0) ** 2.2 - 0.35 * np.maximum(-s, 0.0) ** 0.8


_CYCLE = np.linspace(0.0, 2 * np.pi, 4096, endpoint=False)
_ARC_MEAN = float(_arc_raw(_CYCLE).mean())
_SPIKY_MEAN = float(_spiky_raw(_CYCLE).mean())


def arciform_negative(ph: np.ndarray) -> np.ndarray:
    """Rounded surface-positive arch and a sharp surface-NEGATIVE phase (mu, wicket), zero-mean, unit p2p."""
    return (_arc_raw(ph) - _ARC_MEAN) / 1.8


def positive_spiky(ph: np.ndarray) -> np.ndarray:
    """Sharp surface-POSITIVE phase and a rounded negative (14 & 6), zero-mean, unit p2p."""
    return (_spiky_raw(ph) - _SPIKY_MEAN) / 1.35


def notched(ph: np.ndarray) -> np.ndarray:
    """RMTD / FAR: fundamental plus a quadrature second harmonic (flat-topped / notched), unit p2p."""
    return (np.sin(ph) + 0.35 * np.sin(2 * ph + np.pi / 2)) / 2.0


def _edge(t: np.ndarray, t0: float, t1: float, ramp: float) -> np.ndarray:
    r = max(1e-3, min(ramp, 0.5 * (t1 - t0)))
    u = np.clip(np.minimum(t - t0, t1 - t) / r, 0.0, 1.0)
    return np.sin(0.5 * np.pi * u) ** 2


def burst_wave(kind: str, burst: Dict, t: np.ndarray) -> np.ndarray:
    """One burst's waveform (uV at the field maximum of its side), zero outside the burst."""
    t0, t1, hz, amp = burst["t0"], burst["t1"], burst["hz"], burst["amp"]
    d = t - t0
    if kind == "midline_theta":
        ph = 2 * np.pi * hz * d + burst["ph0"]
        env = _edge(t, t0, t1, 0.6) * (1.0 + 0.15 * np.sin(2 * np.pi * d / max(t1 - t0, 1.0)))
        return 0.5 * amp * env * np.sin(ph)
    if kind in ("mu", "wicket", "rmtd", "frontal_arousal_rhythm", "fourteen_and_six"):
        live = (t >= t0) & (t < t1)
        if not live.any():
            return np.zeros(t.shape)
        ramp = {"mu": 0.25, "wicket": 0.12, "rmtd": 0.4, "frontal_arousal_rhythm": 0.3, "fourteen_and_six": 0.12}[kind]
        env = _edge(t, t0, t1, ramp) * live
        if kind in ("mu", "rmtd", "frontal_arousal_rhythm"):
            env *= 1.0 + 0.2 * np.sin(2 * np.pi * d / max(t1 - t0, 0.5) * 1.3 + burst["ph0"])   # wax and wane
        ph = 2 * np.pi * hz * d + burst["ph0"]
        shape = {"mu": arciform_negative, "wicket": arciform_negative, "rmtd": notched,
                 "frontal_arousal_rhythm": notched, "fourteen_and_six": positive_spiky}[kind]
        return amp * env * shape(ph)
    if kind == "lambda":
        # positive asymmetric triangle: 60 ms rise, 120 ms fall, then a -0.25 lobe over 150 ms
        w = np.zeros(t.shape)
        m1 = (d >= 0) & (d < 0.06)
        w[m1] = d[m1] / 0.06
        m2 = (d >= 0.06) & (d < 0.18)
        w[m2] = 1.0 - (d[m2] - 0.06) / 0.12
        m3 = (d >= 0.18) & (d < 0.33)
        w[m3] = -0.25 * np.sin(np.pi * (d[m3] - 0.18) / 0.15)
        return amp * w
    if kind == "photic_driving":
        # sum of flash-evoked occipital transients (positive then negative, about 80 ms) at the flash rate; full
        # response within about two flashes, abrupt offset with the last flash
        w = np.zeros(t.shape)
        jit = burst["jit"]
        n = int(np.floor((t1 - t0) * hz))
        k0 = max(0, int(np.floor((t[0] - t0 - 0.3) * hz)))
        k1 = min(n, int(np.ceil((t[-1] - t0) * hz)) + 1)
        for k in range(k0, k1):
            c = t0 + k / hz + 0.08 + jit[k]
            dd = t - c
            m = np.abs(dd) < 0.12
            if not m.any():
                continue
            g = 1.0 - np.exp(-(k + 1) / 1.2)
            x = dd[m] / 0.022
            w[m] += g * x * np.exp(0.5 * (1.0 - x * x)) * -1.0      # biphasic, positive lobe first
        return amp * 0.5 * w * (t >= t0)
    if kind == "sreda":
        live = (t >= t0) & (t < t1)
        if not live.any():
            return np.zeros(t.shape)
        dd = d - burst["lag"]
        onset = burst["onset"]
        # instantaneous rate: 1 Hz -> hz over the onset, then steady; phase is its integral (closed form)
        u = np.clip(dd / onset, 0.0, 1.0)
        f0 = 1.0
        ph_on = 2 * np.pi * onset * (f0 * u + 0.5 * (hz - f0) * u * u)
        ph = np.where(dd < onset, ph_on, 2 * np.pi * onset * (f0 + 0.5 * (hz - f0)) + 2 * np.pi * hz * (dd - onset))
        ph = ph + burst["ph0"]
        s = np.sin(ph)
        # onset: isolated sharp monophasic waves; steady: sharply contoured rhythm (sin + 0.3 sin 2phi)
        sharp = np.maximum(-s, 0.0) ** 2.5 - 0.25 * np.maximum(s, 0.0)
        steady = (s + 0.3 * np.sin(2 * ph)) / 1.3
        mix = np.clip((dd - 0.6 * onset) / (0.4 * onset), 0.0, 1.0)
        env = np.clip(0.8 + 0.2 * u, 0.0, 1.0) * np.clip((t1 - t) / 0.15, 0.0, 1.0) * np.clip(dd / 0.1, 0.0, 1.0)
        return amp * 0.5 * env * ((1 - mix) * sharp + mix * steady) * live
    raise ValueError(kind)


def hv_rows(burst: Dict, t: np.ndarray, field: np.ndarray, y: np.ndarray) -> np.ndarray:
    """HV buildup on one side: a band-limited (+/- 0.8 Hz) noise whose centre glides from 5 Hz down to the authored
    frequency as the envelope grows; per-electrode lag by y so the diffuse field survives the bipolar chain.
    Envelope: 15 % of the window before any change, rise to 70 %, full to the end, then about 20 s recovery."""
    t0, t1 = burst["t0"], burst["t1"]
    dur = t1 - t0
    rec = min(20.0, 0.5 * dur)
    rows = np.zeros((field.size, t.size))
    if t[-1] < t0 or t[0] > t1 + 3 * rec:
        return rows
    lag = LAG_S_PER_Y["hyperventilation_buildup"]
    for e in np.nonzero(field > 0.01)[0]:
        tt = t - lag * y[e]
        d = tt - t0
        env = np.where(d < dur, np.clip((d - 0.15 * dur) / (0.55 * dur), 0.0, 1.0), np.exp(-(d - dur) / (rec / 2.5)))
        env = np.where(d < 0, 0.0, env) ** 1.2
        # frequency glide with the envelope: 5 Hz -> authored hz; phase of each component integrates it
        f_hi, f_lo = 5.0, float(burst["hz"])
        # closed-form integral of f(d) = f_hi - (f_hi - f_lo) * g(d), g the clipped ramp (no recovery glide)
        r0, r1 = 0.15 * dur, 0.70 * dur
        dd = np.clip(d, 0.0, None)
        integ_g = np.where(dd < r0, 0.0, np.where(dd < r1, 0.5 * (dd - r0) ** 2 / (r1 - r0),
                                                  0.5 * (r1 - r0) + (dd - r1)))
        base_ph = 2 * np.pi * (f_hi * dd - (f_hi - f_lo) * integ_g)
        sig = np.zeros(t.size)
        for part, wgt in (("common", 0.8), ("own", 0.45)):
            c = burst[part]
            for fo, ph, w in zip(c["f_off"], c["ph"], c["w"]):
                # phase B (variants-neonatal-r3 V110-10: a pure 3.2-Hz sine, 156 ms up / 156 ms down): the components
                # spread over 0.4-1.1x the glide frequency (1.2-3.3 Hz at a 3-Hz authored buildup), so the buildup
                # is irregular polymorphic delta of varying period and amplitude (learningeeg hv-slowing)
                sig += wgt * w * np.sin(base_ph * float(np.exp(-0.42 + 0.62 * fo)) + ph)
        rows[e] = field[e] * burst["amp"] * env * sig / 4.2
    return rows


# ------------------------------------------- scheduled (background) variants --
def hh_schedule(seed: int, windows: Sequence[Tuple[float, float]], rate_per_min: float, amp: float,
                arousal_starts: Sequence[float]) -> List[Dict]:
    """Hypnagogic hypersynchrony runs in the drowsy windows (and hypnopompic runs at arousals from sleep), 3-5 Hz,
    crescendo over the first 0.6-1.5 s.  Phase B (sleep-fix, sleep-independent.md: runs of 2-5 s against a > 10-s
    paroxysmal run in learningeeg Hypnapompic-Hypersynchrony) set a median of 8 s (5-15 s).  r6: paroxysmal bursts of
    1-10 s (median 6 s, 2-10 s), each built cycle by cycle (``_hh_run``)."""
    rng = substream(seed, "v3-hh")
    out = []
    gap_med = 60.0 / max(rate_per_min, 1e-6)

    def dur():
        return _ln(rng, 6.0, 0.35, 2.0, 10.0)
    for a, b in windows:
        t = a + float(rng.uniform(0.0, min(0.5 * gap_med, max(0.0, b - a - 2.0))))
        while t < b - 2.0:
            d = min(dur(), b - t)
            out.append(_hh_run(rng, t, d, amp))
            t += d + _ln(rng, gap_med, 0.5, 2.0, 10 * gap_med)
    for a in arousal_starts:
        if rng.random() < 0.6:
            out.append(_hh_run(rng, a + float(rng.uniform(0.2, 1.0)), dur(), amp))
    out.sort(key=lambda r: r["t0"])
    return out


def _hh_run(rng, t, d, amp):
    """One run, drawn once: a cycle list rather than a phase-modulated sine.

    r6 (r5-background open item "HH comb": a wandering sine with harmonics and a 7-9 Hz rider read as a dense, regular
    comb; learningeeg Hypnapompic-Hypersynchrony: high-voltage rounded 3-5 Hz waves that wax and wane): every cycle
    has its own period (lognormal, CV about 0.2, around a base frequency that drifts through the run), its own
    amplitude (AR(1) in log, so neighbouring waves are related but not equal) and its own crest shape (skew), and each
    hemisphere a partly independent amplitude sequence.  The waxing / waning envelope is two slow sinusoids of random
    rate and phase on top of the crescendo."""
    hz = float(rng.uniform(3.0, 4.6))
    n = int(np.ceil((d + 2.0) * 6.5)) + 4
    drift = hz * np.exp(0.12 * np.cumsum(rng.normal(0.0, 0.35, n)) / np.sqrt(np.arange(1, n + 1)))
    per = np.clip(np.exp(rng.normal(0.0, 0.2, n)) / np.clip(drift, 2.6, 5.2), 0.18, 0.5)
    la = np.zeros(n)
    z = rng.normal(0.0, 0.28, n)
    for k in range(n):
        la[k] = (0.55 * la[k - 1] if k else 0.0) + z[k]
    a = np.exp(la - la.mean())
    side = np.exp(rng.normal(0.0, 0.14, (2, n)))
    return {"t0": t, "t1": t + d, "hz": hz, "amp": amp * float(np.exp(rng.normal(0, 0.15))),
            "rise": float(rng.uniform(0.6, 1.5)), "asym": float(rng.uniform(-0.25, 0.25)),
            "bounds": np.concatenate([[0.0], np.cumsum(per)]) - float(rng.uniform(0.0, per[0])),
            "cyc_amp": a, "cyc_side": side, "cyc_skew": rng.uniform(-0.35, 0.35, n),
            "am_hz": rng.uniform(0.15, 0.6, 2), "am_ph": rng.uniform(0, 2 * np.pi, 2), "am_depth": float(rng.uniform(0.2, 0.4))}


def hh_rows(run: Dict, t: np.ndarray, electrodes: Sequence[str], y: np.ndarray, x_sign: np.ndarray) -> np.ndarray:
    fl, fr = side_field("hypnagogic_hypersynchrony", electrodes, "left"), \
        side_field("hypnagogic_hypersynchrony", electrodes, "right")
    field = np.where(x_sign < 0, fl, np.where(x_sign > 0, fr, 0.5 * (fl + fr)))
    field = field * (1.0 + run["asym"] * x_sign)
    lag = LAG_S_PER_Y["hypnagogic_hypersynchrony"]
    rows = np.zeros((len(electrodes), t.size))
    t0, t1 = run["t0"], run["t1"]
    bnd, ca, cs, sk = run["bounds"], run["cyc_amp"], run["cyc_side"], run["cyc_skew"]
    ctr = 0.5 * (bnd[:-1] + bnd[1:])
    n = ca.size
    for e in range(len(electrodes)):
        d = t - lag * y[e] - t0
        live = (d >= 0) & (d < t1 - t0)
        if not live.any():
            continue
        u = np.clip(d / run["rise"], 0.0, 1.0)
        env = (u * u * (3 - 2 * u) * np.clip((t1 - t0 - d) / 0.8, 0.0, 1.0)
               * (1.0 + run["am_depth"] * 0.5 * (np.sin(2 * np.pi * run["am_hz"][0] * d + run["am_ph"][0])
                                                 + np.sin(2 * np.pi * run["am_hz"][1] * d + run["am_ph"][1]))))
        k = np.clip(np.searchsorted(bnd, d, side="right") - 1, 0, n - 1)
        phi = np.clip((d - bnd[k]) / (bnd[k + 1] - bnd[k]), 0.0, 1.0)
        # per-cycle crest shape: skew the phase inside the cycle (sharper or broader surface-negative crest)
        phi = phi + sk[k] * np.sin(2 * np.pi * phi) / (2 * np.pi)
        sa = ca * (cs[0] if x_sign[e] < 0 else cs[1] if x_sign[e] > 0 else 0.5 * (cs[0] + cs[1]))
        amp = np.interp(d, ctr, sa)
        w = -np.sin(2 * np.pi * phi) * amp
        rows[e] = field[e] * env * live * w * 0.5 * run["amp"]
    return rows


def posts_schedule(seed: int, windows: Sequence[Tuple[float, float]], amp: float, interval_s: float = 0.5) -> List[Dict]:
    """POSTS episodes through N1-N2 (10-60 s), each a train of discrete transients at lognormal intervals
    (median 0.5 s, CV about 0.4), bilateral with a per-transient left/right jitter."""
    rng = substream(seed, "v3-posts")
    out = []
    for a, b in windows:
        t = a + _ln(rng, 20.0, 0.6, 2.0, 90.0)
        while t < b - 5.0:
            d = min(_ln(rng, 25.0, 0.5, 10.0, 60.0), b - t)
            times, s = [], t
            while s < t + d:
                times.append(s)
                s += _ln(rng, interval_s, 0.38, 0.44 * interval_s, 3.0 * interval_s)
            n = len(times)
            out.append({"t0": t, "t1": t + d, "times": times, "amp": amp,
                        "gl": np.exp(rng.normal(0, 0.2, n)).tolist(), "gr": np.exp(rng.normal(0, 0.2, n)).tolist(),
                        "g": np.exp(rng.normal(0, 0.2, n)).tolist()})
            t += d + _ln(rng, 40.0, 0.6, 10.0, 240.0)
    return out


def posts_wave(d: np.ndarray) -> np.ndarray:
    """One POST: steep surface-positive phase (about 40 ms), slower return (about 80 ms), small negative after-wave."""
    w = np.zeros(d.shape)
    m1 = (d >= -0.04) & (d < 0.0)
    w[m1] = 1.0 + d[m1] / 0.04
    m2 = (d >= 0.0) & (d < 0.08)
    w[m2] = 1.0 - d[m2] / 0.08
    m3 = (d >= 0.08) & (d < 0.23)
    w[m3] = -0.18 * np.sin(np.pi * (d[m3] - 0.08) / 0.15)
    return w


def posts_rows(run: Dict, t: np.ndarray, fl: np.ndarray, fr: np.ndarray) -> np.ndarray:
    wl = np.zeros(t.size)
    wr = np.zeros(t.size)
    for k, c in enumerate(run["times"]):
        if c < t[0] - 0.3 or c > t[-1] + 0.1:
            continue
        w = posts_wave(t - c) * run["amp"] * run["g"][k]
        wl += w * run["gl"][k]
        wr += w * run["gr"][k]
    return np.outer(fl, wl) + np.outer(fr, wr)


def pswy_schedule(seed: int, windows: Sequence[Tuple[float, float]], rate_per_min: float, amp: float,
                  pdr_hz: float) -> List[Dict]:
    """Posterior slow waves of youth while awake with eyes closed: one wave per event (two in about 20 %),
    period 1/f with f 2.5-4 Hz, one side, the other or both."""
    rng = substream(seed, "v3-pswy")
    out = []
    gap = 60.0 / max(rate_per_min, 1e-6)
    for a, b in windows:
        t = a + float(rng.uniform(0.5, min(gap, max(0.6, b - a))))
        while t < b - 0.6:
            cnt = 2 if rng.random() < 0.2 else 1
            f = float(rng.uniform(2.5, 4.0))
            which = rng.random()
            gl, gr = (1.0, float(rng.uniform(0.6, 0.95))) if which < 0.5 else (float(rng.uniform(0.6, 0.95)), 1.0)
            out.append({"t0": t, "t1": t + cnt / f, "hz": f, "count": cnt, "amp": amp * float(np.exp(rng.normal(0, 0.15))),
                        "gl": gl, "gr": gr, "pdr_hz": pdr_hz})
            t += cnt / f + _ln(rng, gap, 0.5, 1.5, 6 * gap)
    return out


def pswy_wave(run: Dict, t: np.ndarray) -> np.ndarray:
    """Surface-negative occipital slow wave: steep descent (25 % of the period) to a sharply contoured negative peak,
    slower return, with one PDR-frequency wave fused on the return limb (the notch of 'two melded PDR waves')."""
    w = np.zeros(t.shape)
    T = 1.0 / run["hz"]
    for k in range(run["count"]):
        d = t - run["t0"] - k * T
        m = (d >= 0) & (d < T)
        if not m.any():
            continue
        u = d[m] / T
        down = u < 0.25
        slow = np.where(down, -np.sin(0.5 * np.pi * np.clip(u / 0.25, 0.0, 1.0)) ** 1.3,
                        -np.cos(0.5 * np.pi * np.clip((u - 0.25) / 0.75, 0.0, 1.0)) ** 1.6)
        # alpha crest (surface positive) on the return limb, at about 60-75 % of the period
        pdr = run["pdr_hz"]
        pa = 2 * np.pi * pdr * (d[m] - 0.55 * T)
        crest = 0.38 * np.cos(pa) * np.exp(-0.5 * ((u - 0.68) / 0.10) ** 2)
        w[m] += slow + crest
    return run["amp"] * w
