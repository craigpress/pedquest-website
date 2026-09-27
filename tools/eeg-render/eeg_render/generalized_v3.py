"""0.5.0 (spec_version 3) generalized seizures and generalized interictal patterns (phase D, generalized family).

Feature review 2026-09-26 (research/eeg-atlas/feature-review-20260926/generalized-review.md).  Before this module a
generalized discharge was the focal machinery with the 19-generator ``generalized`` region: a nearly uniform field
that cancels in the longitudinal-bipolar chain.  A 250-uV 3-Hz spike-wave run measured 71-135 uV bipolar against a
42-100 uV background (1.3-2.4x) with the PDR and muscle running through it, a tonic seizure's fast activity was
invisible in every parasagittal derivation, and a generalized-onset GTC showed nothing for its first 12 s.  In the
references (learningeeg atlas-absence-seizure, absence-seizure-at-20uV, atlas-tonic-seizure-i/-ii, atlas-gtc-at-20uv,
eegatlas-online eeg0087/eeg0094/eeg0066, 4-6-Hz-spike-and-waves-with-JME, different-LGS-background, ESES-example)
every longitudinal chain carries the discharge at 4-10x the background, frontal maximum, with the background gone.

The model here is written per electrode, not as summed generators:
- a spike field peaking frontally at F3/Fz/F4 and a slow-wave field that falls linearly from Fp to O, so every
  longitudinal link sees a share (the linear front-to-back fall is what makes all four chains carry an absence);
- per-complex front-to-back lead (frontal first, up to ~15 ms), per-electrode amplitude jitter and a per-complex
  hemispheric asymmetry, which survive the bipolar subtraction because nothing averages them away;
- amplitudes authored as the peak-to-peak on the LARGEST longitudinal-bipolar derivation (the unjittered complex is
  normalized numerically), so a request means what a reader measures.

Everything is scheduled once per record from ``substream(seed, "gen-v3", event index, ...)`` and stored as discrete
complexes / segments; the row builders are pure functions of time (window independence).
Sign convention: rows are surface potentials; spikes and slow waves are surface-NEGATIVE (the page draws negative-up).
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

from . import montage as mt
from . import state_v3 as sv3
from .rng import substream

SEIZURE_TYPES = ("typical_absence", "atypical_absence", "myoclonic", "myoclonic_atonic", "myoclonic_tonic",
                 "tonic", "atonic", "gtc", "eyelid_myoclonia", "photoparoxysmal")
DISCHARGE_PATTERNS = ("spike_wave", "polyspike_wave", "slow_spike_wave", "gpfa", "eses")

#: key-only semiology per seizure type (never changes the signal)
SEMIOLOGY = {
    "typical_absence": "behavioral arrest and staring, abrupt onset and offset, no postictal state",
    "atypical_absence": "reduced responsiveness with gradual onset and offset, often with tone changes",
    "myoclonic": "brief bilateral myoclonic jerk, awareness preserved",
    "myoclonic_atonic": "myoclonic jerk followed by loss of tone (drop)",
    "myoclonic_tonic": "myoclonic jerk followed by tonic stiffening",
    "tonic": "bilateral tonic stiffening, often from sleep",
    "atonic": "sudden loss of postural tone (drop or head nod)",
    "gtc": "tonic phase, clonic phase with slowing jerks, postictal unresponsiveness",
    "eyelid_myoclonia": "eyelid jerking with upward eye deviation, provoked by eye closure",
    "photoparoxysmal": "photoparoxysmal response to intermittent photic stimulation",
}

# ------------------------------------------------------------------ fields --
_Y_TOP, _Y_BOT = 0.95, -0.95


def _pos(e: str) -> Tuple[float, float]:
    return mt.POSITIONS.get(e, (0.0, 0.0))


def _grad(y: float) -> float:
    """Slow-wave field: a fall from the frontal pole (1.0) to the occiput (0.08), convex (u ** 0.6) so the
    parieto-occipital links, which carry the PDR, keep a share as large as the frontal ones."""
    u = (min(max(y, _Y_BOT), _Y_TOP) - _Y_BOT) / (_Y_TOP - _Y_BOT)
    return 0.08 + 0.92 * u ** 0.6


def _spike_bump(y: float) -> float:
    """Spike field: frontal maximum at F3/Fz/F4, Fp 0.8, C 0.85, P 0.5, occiput 0.27 (broad enough that the
    parieto-occipital links carry the spike too, as in atlas-absence-seizure)."""
    return 0.15 + 0.85 * math.exp(-((y - 0.45) / 1.0) ** 2)


#: ESES / CSWS field (ESES-example-left-hemispheric-predominance-at-20uV: largest centro-parietal and at the vertex,
#: frontal pole and occiput smaller); ``side`` weights one hemisphere
_ESES_FIELD = {"C3": 1.0, "C4": 1.0, "Cz": 0.95, "T3": 0.70, "T4": 0.70, "P3": 0.75, "P4": 0.75, "Pz": 0.75,
               "F3": 0.55, "F4": 0.55, "Fz": 0.60, "F7": 0.40, "F8": 0.40, "T5": 0.50, "T6": 0.50,
               "Fp1": 0.22, "Fp2": 0.22, "O1": 0.30, "O2": 0.30}
#: myoclonic / JME polyspike-and-wave (eeg0094_db1, myoclonic-jerk-examples/p1, 4-6-Hz-spike-and-waves-with-JME):
#: bilateral frontal maximum, largest in F3-C3 / F4-C4 / Fz-Cz, Fp-F and P-O smaller, temporal chains small (the
#: sporadic ``generalized_frontocentral`` table)
_FC_FIELD = {"F3": 1.0, "F4": 1.0, "Fz": 0.95, "Fp1": 0.55, "Fp2": 0.55, "C3": 0.45, "C4": 0.45, "Cz": 0.45,
             "P3": 0.40, "P4": 0.40, "Pz": 0.35, "F7": 0.35, "F8": 0.35, "T3": 0.30, "T4": 0.30,
             "T5": 0.20, "T6": 0.20, "O1": 0.10, "O2": 0.10}
_PHOTIC_FIELD = {"O1": 1.0, "O2": 1.0, "P3": 0.45, "P4": 0.45, "Pz": 0.40, "T5": 0.40, "T6": 0.40}
#: broad scalp EMG of a convulsive seizure (atlas-gtc-at-20uv: every derivation saturated with muscle)
_EMG_FIELD = {"T3": 1.0, "T4": 1.0, "F7": 0.95, "F8": 0.95, "T5": 0.75, "T6": 0.75, "Fp1": 0.85, "Fp2": 0.85,
              "F3": 0.65, "F4": 0.65, "Fz": 0.55, "C3": 0.50, "C4": 0.50, "Cz": 0.40, "P3": 0.40, "P4": 0.40,
              "Pz": 0.35, "O1": 0.45, "O2": 0.45}


def fields(electrodes: Sequence[str], name: str = "gen", side: str = "both") -> Tuple[np.ndarray, np.ndarray]:
    """(spike field, slow-wave field) per electrode.  Reference electrodes (A1/A2) take 0.6x the field at y = 0."""
    sp, wv = [], []
    for e in electrodes:
        x, y = _pos(e)
        ref = e not in mt.POSITIONS or e in mt.REFERENCE_ELECTRODES
        if name in ("eses", "fc"):
            tab = _ESES_FIELD if name == "eses" else _FC_FIELD
            v = 0.6 * tab.get("T3", 0.3) if ref else tab.get(e, 0.3)
            s = w = v
        else:
            s = 0.6 * _spike_bump(0.0) if ref else _spike_bump(y)
            w = 0.6 * _grad(0.0) if ref else _grad(y)
        if side in ("left", "right") and not ref:
            own = (x < -1e-6) if side == "left" else (x > 1e-6)
            k = 1.0 if own else (0.75 if abs(x) < 1e-6 else 0.5)
            s, w = s * k, w * k
        sp.append(s)
        wv.append(w)
    return np.array(sp), np.array(wv)


def gpd_field_target(electrodes: Sequence[str]) -> Dict[str, float]:
    """C26 (epileptiform-v3.md): a steep anterior-posterior GPD field that survives the bipolar chain."""
    # proposed Fp/F 1.0, C 0.6, P 0.35, O 0.2, temporal 0.5; one step steeper so F3-C3 carries half of Fz without
    # the inter-electrode lag
    tab = {"Fp1": 1.0, "Fp2": 1.0, "F7": 1.0, "F8": 1.0, "F3": 1.0, "F4": 1.0, "Fz": 1.0,
           "C3": 0.5, "C4": 0.5, "Cz": 0.5, "T3": 0.45, "T4": 0.45, "P3": 0.25, "P4": 0.25, "Pz": 0.25,
           "T5": 0.15, "T6": 0.15, "O1": 0.05, "O2": 0.05}
    return {e: tab.get(e, 0.035) for e in electrodes}


# ----------------------------------------------------------------- kernels --

def _g(tau: np.ndarray, rise: float, fall: float) -> np.ndarray:
    return np.exp(-0.5 * (tau / np.where(tau < 0.0, rise, fall)) ** 2)


def k_sw(tau: np.ndarray, period: float, width: float = 1.0, double: bool = False) -> Tuple[np.ndarray, np.ndarray]:
    """3-Hz spike-and-wave: spike (rise 10 / fall 18 ms), optional second spike 48 ms later (spike/polyspike and
    waves, absence-seizure-at-20uV), a positive transient, then the dominant surface-negative slow wave."""
    sp = _g(tau, 0.010 * width, 0.018 * width)
    tl = 0.045 * width
    if double:
        sp = sp + 0.8 * _g(tau - 0.048 * width, 0.008 * width, 0.014 * width)
        tl += 0.048 * width
    sp = sp - 0.35 * np.exp(-0.5 * ((tau - tl) / 0.020) ** 2)
    c = min(max(0.45 * period, 0.12), 0.22)
    s = min(max(0.18 * period, 0.045), 0.09)
    return sp, 1.15 * np.exp(-0.5 * ((tau - c) / s) ** 2)


def k_ssw(tau: np.ndarray, period: float, wave_gain: float = 1.3) -> Tuple[np.ndarray, np.ndarray]:
    """Slow spike-and-wave (LGS, atypical absence): a sharp wave (FWHM ~95 ms) and a long slow wave."""
    sp = _g(tau, 0.030, 0.050) - 0.30 * np.exp(-0.5 * ((tau - 0.11) / 0.035) ** 2)
    c = min(max(0.5 * period, 0.20), 0.40)
    s = min(max(0.2 * period, 0.08), 0.14)
    return sp, wave_gain * np.exp(-0.5 * ((tau - c) / s) ** 2)


def k_psw(tau: np.ndarray, period: float, lags, gains, troughs, wave_gain: float = 2.2) -> Tuple[np.ndarray, np.ndarray]:
    """Polyspike-and-wave: irregular spikes (each a sharp negative peak with a small, broad positive trough), then a
    slow wave at least as large as the spikes (eeg0094_db1, myoclonic-jerk-examples/p1)."""
    sp = np.zeros_like(tau)
    for c, g, tr in zip(lags, gains, troughs):
        x = tau - c
        sp = sp + g * (_g(x, 0.007, 0.010) - tr * np.exp(-0.5 * ((x - 0.032) / 0.022) ** 2))
    wl = min(max(0.35 * period, 0.09), 0.18)
    s = min(max(0.18 * period, 0.04), 0.09)
    return sp, wave_gain * np.exp(-0.5 * ((tau - float(lags[-1]) - wl) / s) ** 2)


def polyspike_draw(rng: np.random.Generator, n_spikes: int, lo: int = 3, hi: int = 8):
    """Irregular polyspike (epileptiform-v3.md change 1): n-1..n+1 spikes, lognormal ISIs (CV ~0.35, median 72 ms,
    clipped 45-130 ms), spikes FWHM ~20 ms, unsorted heights uniform(0.5, 1.2) (first spike 1.0), troughs 0.2-0.35."""
    n = int(np.clip(n_spikes + int(rng.integers(-1, 2)), lo, hi))
    isi = np.clip(0.072 * np.exp(rng.normal(0.0, 0.40, n - 1)), 0.045, 0.130)
    lags = np.concatenate([[0.0], np.cumsum(isi)])
    gains = np.concatenate([[1.0], rng.uniform(0.5, 1.2, n - 1)])
    troughs = rng.uniform(0.20, 0.35, n)
    return lags, gains, troughs


def _cnoise(k: np.ndarray, salt: int) -> np.ndarray:
    from .synth import _cycle_noise          # lazy: synth imports this module
    return _cycle_noise(k, salt)


# ------------------------------------------------------------- the model --

class GeneralizedV3:
    """Schedule and rows for the ``generalized_seizure`` / ``generalized_discharges`` events of one record."""

    #: sample offset of the private EMG realizations (far past any record and the postictal-delta offset)
    EMG_OFFSET = 3_000_000_000

    def __init__(self, syn) -> None:
        self.syn = syn
        self.el = list(syn.electrodes)
        self.n_e = len(self.el)
        self.fs = syn.fs
        xy = np.array([_pos(e) for e in self.el])
        self.x, self.y = xy[:, 0], xy[:, 1]
        self.front = (_Y_TOP - np.clip(self.y, _Y_BOT, _Y_TOP)) / (_Y_TOP - _Y_BOT)      # 0 at Fp, 1 at O
        self.pairs = [(syn._idx[a], syn._idx[b]) for a, b in mt.montage_pairs("longitudinal_bipolar", syn.scalp)
                      if b is not None and a in syn._idx and b in syn._idx]
        self._fields: Dict[Tuple[str, str], Tuple[np.ndarray, np.ndarray]] = {}
        self._norm: Dict[tuple, float] = {}
        self.emg_field = np.array([_EMG_FIELD.get(e, 0.3) for e in self.el])
        self.photic_field = np.array([_PHOTIC_FIELD.get(e, 0.03) for e in self.el])
        # schedule
        self.cx_t: List[float] = []
        self.cx: List[dict] = []
        self.gpfa: List[dict] = []
        self.emg: List[tuple] = []           # (t0, t1, p2p uV, rise, fall, kind)
        self.emg_loss: List[tuple] = []      # (t0, t1, depth)
        self.bg: List[tuple] = []            # (t0, t1, depth, rise, fall)
        self.gates: List[tuple] = []         # absence gate (t0, t1)
        self.eye: List[tuple] = []           # (kind, t0, t1, amp, freq)
        self.photic: List[tuple] = []        # (t0, t1, flash hz, amp)
        self.key_rows: List[dict] = []
        for i, ev in enumerate(syn.spec["events"]):
            if ev["type"] == "generalized_seizure":
                getattr(self, "_sz_" + ev["seizure_type"])(i, ev, substream(syn.seed, "gen-v3", i))
            elif ev["type"] == "generalized_discharges":
                self._discharges(i, ev)
        for z in getattr(syn, "ictal", []):
            if z.kind == "tonic_seizure":
                # 0.5.0 phase D: the v3 tonic_seizure's fast activity (its harmonic stack cancelled on the parasagittal
                # chain); decrement, EMG and key stay with the tonic_seizure event
                self._add_gpfa(z.index, substream(syn.seed, "gen-v3-tonic", z.index), z.t0, z.t1, z.start_hz,
                               z.end_hz, max(z.amp_start, 0.3 * z.amp_end), z.amp_end)
        order = np.argsort(np.asarray(self.cx_t, float), kind="stable")
        self.cx = [self.cx[j] for j in order]
        self.cx_t = np.asarray(self.cx_t, float)[order] if len(order) else np.zeros(0)
        self.cx_end = np.array([c["t"] + c["span"] for c in self.cx]) if self.cx else np.zeros(0)
        self.cx_maxspan = float(max((c["span"] for c in self.cx), default=0.0))

    # ------------------------------------------------------------ helpers --
    def _field(self, name: str, side: str) -> Tuple[np.ndarray, np.ndarray]:
        key = (name, side)
        if key not in self._fields:
            self._fields[key] = fields(self.el, name, side)
        return self._fields[key]

    def _add_cx(self, t: float, kind: str, amp: float, period: float, salt: int, *, field: str = "gen",
                side: str = "both", width: float = 1.0, double: bool = False, ps=None, wave_gain: float = 1.3,
                asym: float = 0.0, lead: float = 0.012, jitter: float = 0.12) -> None:
        span = (float(ps[0][-1]) if ps is not None else 0.0) + 0.9
        self.cx_t.append(float(t))
        self.cx.append(dict(t=float(t), kind=kind, amp=float(amp), period=float(period), salt=int(salt),
                            field=field, side=side, width=float(width), double=bool(double), ps=ps,
                            wave_gain=float(wave_gain), asym=float(asym), lead=float(lead), jitter=float(jitter),
                            span=span))

    def _cx_fields(self, c: dict) -> Tuple[np.ndarray, np.ndarray]:
        sf, wf = self._field(c["field"], c["side"])
        # a slow spike-and-wave's sharp wave rides the slow wave's field (different-LGS-background: the sharp
        # component shows in every chain, not only centrally)
        return (wf, wf) if c["kind"] == "ssw" else (sf, wf)

    def _kernel(self, c: dict, tau: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        if c["kind"] == "sw":
            return k_sw(tau, c["period"], c["width"], c["double"])
        if c["kind"] == "ssw":
            return k_ssw(tau, c["period"], c["wave_gain"])
        lags, gains, troughs = c["ps"]
        return k_psw(tau, c["period"], lags, gains, troughs, c["wave_gain"])

    def _cx_norm(self, c: dict) -> float:
        """Largest longitudinal-bipolar peak-to-peak of the unjittered unit complex (numerical, cached)."""
        ps = c["ps"]
        key = (c["kind"], round(c["period"], 4), round(c["width"], 4), c["double"], c["field"], c["side"],
               round(c["wave_gain"], 3), None if ps is None else tuple(np.round(np.concatenate(ps), 5)))
        v = self._norm.get(key)
        if v is None:
            tau = np.arange(-0.2, c["span"], 1.0 / self.fs)
            sp, wv = self._kernel(c, tau)
            sf, wf = self._cx_fields(c)
            rows = sf[:, None] * sp[None, :] + wf[:, None] * wv[None, :]
            v = max(float(np.ptp(rows[a] - rows[b])) for a, b in self.pairs) or 1.0
            self._norm[key] = v
        return v

    def _row(self, kind: str, i: int, t0: float, t1: float, **detail) -> None:
        self.key_rows.append(dict(kind=kind, t0=float(t0), t1=float(t1), spec_event_index=int(i), **detail))

    @staticmethod
    def _glide(f0: float, f1: float, u: float) -> float:
        return f0 * (f1 / f0) ** u

    def _train(self, i: int, rng, t0: float, t1: float, f0: float, f1: float, amp: float, kind: str, *,
               salt0: int, jitter_f: float = 0.04, ramp_s: float = 0.0, ps_n: int = 0, p_double: float = 0.0,
               asym_amt: float = 0.08, **kw) -> int:
        """Complexes from t0 to t1 with a log-frequency glide f0 -> f1, per-cycle rate jitter and an amplitude ramp."""
        t, k = t0, 0
        dur = max(t1 - t0, 1e-6)
        while t < t1:
            u = (t - t0) / dur
            f = self._glide(f0, f1, u) * float(np.exp(rng.normal(0.0, jitter_f)))
            period = 1.0 / f
            a = amp * float(np.exp(rng.normal(0.0, 0.10)))
            if ramp_s > 0:
                a *= float(np.clip(min(t - t0, t1 - t) / ramp_s, 0.25, 1.0))
            ps = polyspike_draw(rng, ps_n, lo=2, hi=4) if ps_n else None
            self._add_cx(t, kind, a, period, salt0 + k, double=bool(rng.uniform() < p_double), ps=ps,
                         asym=float(rng.uniform(-asym_amt, asym_amt)), **kw)
            t += period
            k += 1
        return k

    # ----------------------------------------------------------- seizures --
    def _sz_typical_absence(self, i, ev, rng):
        """Typical absence (atlas-absence-seizure / absence-seizure-at-20uV; eeg0087): generalized ~3-Hz
        spike(-polyspike)-and-wave, 3.5 Hz at onset slowing to ~2.5 Hz, abrupt onset (full voltage by the 2nd complex)
        and offset, frontal maximum, every chain involved, background and blinks gone during the run."""
        t0 = float(ev["onset_min"]) * 60.0
        t1 = t0 + float(ev["duration_s"])
        f = float(ev["frequency_hz"])
        n = self._train(i, rng, t0, t1, 1.15 * f, 0.85 * f, float(ev["amplitude_uv"]), "sw", salt0=i * 1_000_003,
                        p_double=0.25, jitter_f=0.035, side=str(ev.get("side") or "both"))
        # first complex at 0.7 (onset within one cycle), last at 0.8
        first = len(self.cx) - n
        self.cx[first]["amp"] *= 0.7
        self.cx[-1]["amp"] *= 0.8
        self.gates.append((t0, t1))
        self.bg.append((t0, t1, 0.65, 0.15, 0.3))
        self._row("generalized_seizure", i, t0, t1, seizure_type="typical_absence", start_hz=round(1.15 * f, 3),
                  end_hz=round(0.85 * f, 3), n_complexes=n)

    def _sz_atypical_absence(self, i, ev, rng):
        """Atypical absence: slow (<2.5 Hz) spike-and-wave with gradual onset and offset, irregular rate, less
        symmetric; background slower (author the background slow_fraction)."""
        t0 = float(ev["onset_min"]) * 60.0
        t1 = t0 + float(ev["duration_s"])
        f = float(ev["frequency_hz"])
        ramp = float(ev.get("ramp_s", 2.5))
        n = self._train(i, rng, t0, t1, 1.05 * f, 0.9 * f, float(ev["amplitude_uv"]), "ssw", salt0=i * 1_000_003,
                        jitter_f=0.12, ramp_s=ramp, asym_amt=0.2, side=str(ev.get("side") or "both"))
        self.gates.append((t0, t1))
        self.bg.append((t0, t1, 0.4, ramp, ramp))
        self._row("generalized_seizure", i, t0, t1, seizure_type="atypical_absence", start_hz=round(1.05 * f, 3),
                  end_hz=round(0.9 * f, 3), n_complexes=n)

    def _jerks(self, i, ev, rng, label, after=None):
        """One or more myoclonic polyspike-and-wave complexes with a 50-150 ms EMG burst on the spikes."""
        t = float(ev["onset_min"]) * 60.0
        count = int(ev.get("count") or 1)
        step = float(ev.get("interval_s") or 3.0)
        amp = float(ev["amplitude_uv"])
        emg = float(ev.get("emg_uv", 150.0))
        for k in range(count):
            ps = polyspike_draw(rng, int(ev.get("n_spikes") or 5), lo=3, hi=8)
            a = amp * float(np.exp(rng.normal(0.0, 0.10)))
            self._add_cx(t, "psw", a, 0.5, i * 1_000_003 + k, ps=ps, wave_gain=2.4 * (1.4 if label == "myoclonic_atonic" else 1.0),
                         asym=float(rng.uniform(-0.08, 0.08)), lead=0.008, field="fc")
            e0 = t + float(rng.uniform(0.010, 0.030))
            e1 = e0 + float(np.clip(float(ps[0][-1]) + rng.uniform(0.03, 0.08), 0.05, 0.25))
            self.emg.append((e0, e1, emg * float(np.exp(rng.normal(0.0, 0.2))), 0.01, 0.03, "burst"))
            end = t + float(ps[0][-1]) + 0.45
            if after is not None:
                end = after(t, ps, end)
            self._row("generalized_seizure", i, t - 0.02, end, seizure_type=label, n_spikes=int(len(ps[0])),
                      jerk_ordinal=k)
            t += step * float(np.exp(rng.normal(0.0, 0.25))) if count > 1 else 0.0

    def _sz_myoclonic(self, i, ev, rng):
        """Myoclonic seizure: generalized polyspike-and-wave (4-8 irregular spikes) with a brief EMG burst."""
        self._jerks(i, ev, rng, "myoclonic")

    def _sz_myoclonic_atonic(self, i, ev, rng):
        """Myoclonic-atonic: the polyspike-and-wave's slow wave is larger and the tonic EMG falls silent."""
        dur = float(ev.get("atonic_s", 0.8))

        def after(t, ps, end):
            a0 = t + float(ps[0][-1]) + 0.08
            self.emg_loss.append((a0, a0 + dur, 0.92))
            return max(end, a0 + dur)
        self._jerks(i, ev, rng, "myoclonic_atonic", after)

    def _sz_myoclonic_tonic(self, i, ev, rng):
        """Myoclonic-tonic: the jerk runs into tonic EMG with a low-voltage fast decrement."""
        dur = float(ev.get("tonic_s", 2.0))

        def after(t, ps, end):
            a0 = t + float(ps[0][-1]) + 0.15
            self.emg.append((a0, a0 + dur, float(ev.get("emg_uv", 150.0)), 0.25, 0.4, "tonic"))
            self.bg.append((a0, a0 + dur, 0.6, 0.15, 0.4))
            self._add_gpfa(i, rng, a0, a0 + dur, 22.0, 16.0, 0.3 * float(ev["amplitude_uv"]) * 0.4,
                           0.3 * float(ev["amplitude_uv"]))
            return max(end, a0 + dur)
        self._jerks(i, ev, rng, "myoclonic_tonic", after)

    def _add_gpfa(self, i, rng, t0, t1, f0, f1, a0, a1, ramp=0.15, side="both"):
        self.gpfa.append(dict(t0=float(t0), t1=float(t1), f0=float(f0), f1=float(f1), a0=float(a0), a1=float(a1),
                              ramp=float(ramp), side=side, dphi=rng.uniform(-0.7, 0.7, self.n_e),
                              df=rng.normal(0.0, 0.6, self.n_e), am_f=rng.uniform(0.6, 1.6, self.n_e),
                              am_p=rng.uniform(0, 2 * np.pi, self.n_e), psi=float(rng.uniform(0, 2 * np.pi)),
                              lead=float(rng.uniform(0.004, 0.012))))

    def _sz_tonic(self, i, ev, rng):
        """Tonic seizure (atlas-tonic-seizure-i/-ii): diffuse electrodecrement, then generalized paroxysmal fast
        activity 10-25 Hz, frontally predominant, building in voltage as it slows, with tonic EMG."""
        t0 = float(ev["onset_min"]) * 60.0
        dec = float(ev.get("decrement_s", 1.0))
        t1 = t0 + float(ev["duration_s"])
        f0, f1 = float(ev.get("start_hz", 20.0)), float(ev.get("end_hz", 12.0))
        amp = float(ev["amplitude_uv"])
        self.bg.append((t0, t1, float(ev.get("decrement_depth", 0.7)), 0.2, 1.0))
        self._add_gpfa(i, rng, t0 + dec, t1, f0, f1, 0.3 * amp, amp)
        self.emg.append((t0 + 0.3 * dec, t1, float(ev.get("emg_uv", 120.0)), 1.5, 0.6, "tonic"))
        self._row("generalized_seizure", i, t0, t1, seizure_type="tonic", start_hz=f0, end_hz=f1,
                  decrement_s=dec)

    def _sz_atonic(self, i, ev, rng):
        """Atonic seizure: a generalized sharp/spike-and-slow-wave with abrupt loss of EMG tone."""
        t0 = float(ev["onset_min"]) * 60.0
        dur = float(ev["duration_s"])
        self._add_cx(t0, "ssw", float(ev["amplitude_uv"]), 0.7, i * 1_000_003, wave_gain=1.6,
                     asym=float(rng.uniform(-0.08, 0.08)))
        self.emg_loss.append((t0 + 0.05, t0 + dur, 0.92))
        self.bg.append((t0 + 0.3, t0 + dur, 0.35, 0.2, 0.4))
        self._row("generalized_seizure", i, t0 - 0.05, t0 + dur, seizure_type="atonic")

    def _sz_gtc(self, i, ev, rng):
        """Generalized tonic-clonic (atlas-gtc-at-20uv p1-p3): decrement with low-voltage fast activity, a recruiting
        ~10-Hz tonic rhythm building under heavy EMG, clonic polyspike-and-wave bursts whose silent intervals
        lengthen (EMG in bursts), then diffuse postictal suppression with no muscle."""
        t0 = float(ev["onset_min"]) * 60.0
        ton = float(ev.get("tonic_s", 12.0))
        clo = float(ev.get("clonic_s", 35.0))
        post = float(ev.get("postictal_attenuation_s", 60.0))
        amp = float(ev["amplitude_uv"])
        emg = float(ev.get("emg_uv", 300.0))
        tc, t1 = t0 + ton, t0 + ton + clo
        self.bg.append((t0, tc, 0.6, 0.3, 1.0))
        self._add_gpfa(i, rng, t0, t0 + 1.5, 25.0, 22.0, 0.15 * amp, 0.25 * amp, ramp=0.2)
        self._add_gpfa(i, rng, t0 + 1.2, tc, 11.0, 6.0, 0.3 * amp, 0.8 * amp, ramp=0.8)
        self.emg.append((t0 + 0.5, tc, emg, 1.5, 0.3, "tonic"))
        # clonic: bursts at ~3 Hz slowing to ~0.7 Hz; each burst a polyspike-and-wave with its own EMG burst
        t, k = tc, 0
        while t < t1:
            u = (t - tc) / clo
            period = 1.0 / self._glide(3.0, 0.7, u) * float(np.exp(rng.normal(0.0, 0.08)))
            ps = polyspike_draw(rng, 3, lo=2, hi=5)
            self._add_cx(t, "psw", amp * float(np.exp(rng.normal(0.0, 0.12))), period, i * 1_000_003 + k, ps=ps,
                         wave_gain=1.8, asym=float(rng.uniform(-0.08, 0.08)))
            self.emg.append((t, t + float(ps[0][-1]) + 0.08, emg * (1.0 - 0.4 * u), 0.01, 0.04, "burst"))
            t += period
            k += 1
        self.bg.append((tc, t1, 0.5, 0.5, 0.5))
        self.bg.append((t1, t1 + post, 0.85, 0.3, 0.35 * post))
        self.emg_loss.append((t1, t1 + post, 0.9))
        self._row("generalized_seizure", i, t0, t1, seizure_type="gtc", tonic_end_s=round(tc, 3),
                  clonic_end_s=round(t1, 3), postictal_s=post, n_clonic_bursts=k)

    def _sz_eyelid_myoclonia(self, i, ev, rng):
        """Eyelid myoclonia (Jeavons): eye closure, eyelid flutter at 5-6 Hz on the frontal poles, and a brief
        generalized 3-6 Hz polyspike-and-wave burst starting within 0.5 s of the closure."""
        t0 = float(ev["onset_min"]) * 60.0
        dur = float(ev["duration_s"])
        lat = float(rng.uniform(0.2, 0.5))
        f = float(ev["frequency_hz"])
        self.eye.append(("closure", t0, t0 + dur + 0.5, float(ev.get("eye_uv", 150.0)), 0.0))
        self.eye.append(("flutter", t0 + 0.1, t0 + 0.1 + min(2.0, dur), 0.35 * float(ev.get("eye_uv", 150.0)),
                         float(rng.uniform(5.0, 6.0))))
        n = self._train(i, rng, t0 + lat, t0 + lat + dur, 1.05 * f, 0.9 * f, float(ev["amplitude_uv"]), "psw",
                        salt0=i * 1_000_003, jitter_f=0.10, ps_n=3, wave_gain=2.0, field="fc")
        self._row("generalized_seizure", i, t0, t0 + lat + dur, seizure_type="eyelid_myoclonia",
                  closure_s=round(t0, 3), discharge_onset_s=round(t0 + lat, 3), n_complexes=n)

    def _sz_photoparoxysmal(self, i, ev, rng):
        """Photoparoxysmal response (eegatlas-online eeg0066, Waltz grade 4): occipital driving at the flash rate and,
        after 0.5-2 s, generalized irregular polyspike-and-wave that stops with the train (or outlasts it)."""
        t0 = float(ev["onset_min"]) * 60.0
        stim = float(ev["stimulus_s"])
        fl = float(ev["stimulus_frequency_hz"])
        lat = float(rng.uniform(0.5, 2.0))
        out = float(rng.uniform(1.0, 3.0)) if ev.get("outlasting") else float(rng.uniform(0.0, 0.3))
        f = float(ev["frequency_hz"])
        self.photic.append((t0, t0 + stim, fl, float(ev.get("driving_uv", 40.0))))
        self.bg.append((t0 + lat, t0 + stim + out, 0.5, 0.2, 0.3))
        n = self._train(i, rng, t0 + lat, t0 + stim + out, f, f, float(ev["amplitude_uv"]), "psw",
                        salt0=i * 1_000_003, jitter_f=0.15, ps_n=3, wave_gain=1.8, asym_amt=0.12)
        self._row("generalized_seizure", i, t0 + lat, t0 + stim + out, seizure_type="photoparoxysmal",
                  stimulus_onset_s=round(t0, 3), stimulus_offset_s=round(t0 + stim, 3), stimulus_frequency_hz=fl,
                  outlasting=bool(ev.get("outlasting")), n_complexes=n)

    # --------------------------------------------------------- discharges --
    _PATTERN = {  # kind, default Hz, burst median s, burst clip
        "spike_wave": ("sw", 3.5, 1.2, (0.3, 4.0)),
        "polyspike_wave": ("psw", 4.5, 1.5, (0.3, 4.0)),
        "slow_spike_wave": ("ssw", 2.0, 6.0, (2.0, 30.0)),
    }
    _BLOCK_S = 600.0

    def _discharges(self, i, ev):
        pat = str(ev["pattern"])
        amp = float(ev["amplitude_uv"])
        side = str(ev.get("side") or "both")
        a = float(ev["start_min"]) * 60.0 if ev.get("start_min") is not None else -60.0
        b = float(ev["end_min"]) * 60.0 if ev.get("end_min") is not None else self.syn.duration_s + 60.0
        if pat == "eses":
            return self._eses(i, ev, a, b, amp, side)
        if pat == "gpfa":
            return self._gpfa_sleep(i, ev, a, b, amp, side)
        kind, f_def, burst, clip = self._PATTERN[pat]
        f = float(ev.get("frequency_hz") or f_def)
        med = float(ev.get("burst_s") or burst)
        rate_h = float(ev["rate_per_h"])
        L = self._BLOCK_S
        for blk in range(int(np.ceil((b - a) / L))):
            rng = substream(self.syn.seed, "gen-v3-dis", i, blk)
            m = int(np.floor(rate_h * L / 3600.0 + rng.uniform()))
            times = np.sort(rng.uniform(0.0, L, m)) + a + blk * L
            for k, t0 in enumerate(times):
                d = float(np.clip(med * np.exp(rng.normal(0.0, 0.45)), *clip))
                fb = f * float(np.exp(rng.normal(0.0, 0.08)))
                ab = amp * float(np.exp(rng.normal(0.0, 0.15)))
                if t0 < a or t0 + d > b:
                    continue
                n = self._train(i, rng, t0, t0 + d, fb * 1.05, fb * 0.95, ab, kind,
                                salt0=(i * 1009 + blk) * 100_003 + k * 97,
                                jitter_f=0.12 if kind == "ssw" else 0.05, ps_n=3 if kind == "psw" else 0,
                                ramp_s=0.8 if kind == "ssw" else 0.0, asym_amt=0.15 if kind == "ssw" else 0.08,
                                side=side, wave_gain=2.0 if kind == "psw" else 1.3,
                                field="fc" if kind == "psw" else "gen")
                self._row("generalized_discharge", i, t0 - 0.03, t0 + d, pattern=pat, frequency_hz=round(fb, 3),
                          amplitude_uv=round(ab, 1), n_complexes=n)

    def _stage_groups(self, a: float, b: float, groups) -> List[Tuple[float, float, Tuple[str, ...]]]:
        """(start, end, stages) runs clipped to [a, b) from the shared state-gating hook (``Synthesizer.stage_intervals``,
        merged runs); without a v3 hypnogram the whole span counts as awake."""
        if not getattr(self.syn, "_hypno", None):
            return [(a, b, ("W",))] if ("W",) in groups else []
        out = []
        for g in groups:
            for x0, x1 in self.syn.stage_intervals(g):
                if x1 > a and x0 < b:
                    out.append((max(x0, a), min(x1, b), g))
        return sorted(out)

    def _stage_label(self, t: float) -> str:
        st = self.syn.stage_at(np.array([t]))[0] if getattr(self.syn, "_hypno", None) else "W"
        return str(st or "W")

    def _eses(self, i, ev, a, b, amp, side):
        """ESES / CSWS (ESES-example-left-hemispheric-predominance-at-20uV): near-continuous 1.5-2.5 Hz spike-and-wave
        covering ``swi_pct`` of N2/N3 (default 90 %, >= 85 %), fragmented in REM (30 %), N1 50 %, sparse awake
        (``wake_swi_pct``, default 10 %).  Coverage per stage comes from ``state_v3.stage_rate_table`` (waking base,
        explicit per-stage overrides) and the runs live in the merged stage windows of ``Synthesizer.stage_intervals``;
        each window's runs and gaps are keyed by its start, so a page and the whole record see the same schedule."""
        f = float(ev.get("frequency_hz") or 2.0)
        swi = float(ev.get("swi_pct", 90.0)) / 100.0
        cov = sv3.stage_rate_table(float(ev.get("wake_swi_pct", 10.0)) / 100.0,
                                   state_rates={"N1": 0.5, "N2": swi, "N3": swi, "R": 0.30})
        for x0, x1, grp in self._stage_groups(a, b, (("N2", "N3"), ("N1",), ("R",), ("W",))):
            c = float(np.clip(cov.get(grp[0], 0.1), 0.0, 0.99))
            if c <= 0 or x1 - x0 < 1.0:
                continue
            rng = substream(self.syn.seed, "gen-v3-eses", i, int(round(x0 * 10)))
            run_med = 12.0 if c >= 0.5 else 2.0
            t = x0 + float(rng.uniform(0.0, 1.0))
            k = 0
            while t < x1 - 0.5:
                run = float(np.clip(run_med * np.exp(rng.normal(0.0, 0.5)), 0.8, 60.0))
                run = min(run, x1 - t)
                fr = f * float(np.exp(rng.normal(0.0, 0.08)))
                n = self._train(i, rng, t, t + run, fr, fr, amp * float(np.exp(rng.normal(0.0, 0.1))), "sw",
                                salt0=(i * 7919 + int(round(x0 * 10))) * 1009 + k * 131, jitter_f=0.10,
                                field="eses", side=side, width=1.5, asym_amt=0.05, lead=0.006)
                self._row("generalized_discharge", i, t - 0.03, t + run, pattern="eses",
                          stage=self._stage_label(t + 0.5 * run), frequency_hz=round(fr, 3), n_complexes=n)
                gap = run * (1.0 - c) / c * float(np.exp(rng.normal(0.0, 0.4)))
                t += run + max(gap, 0.3)
                k += 1

    def _gpfa_sleep(self, i, ev, a, b, amp, side):
        """LGS generalized paroxysmal fast activity in NREM sleep: 1-10 s (median 3 s) bursts of 10-25 Hz, frontally
        predominant, abrupt onset, no EMG; ``rate_per_h`` applies inside the merged N2/N3 windows only
        (``Synthesizer.stage_intervals``), none awake or in REM."""
        rate_h = float(ev["rate_per_h"])
        f = float(ev.get("frequency_hz") or 15.0)
        med = float(ev.get("burst_s") or 3.0)
        for x0, x1, _grp in self._stage_groups(a, b, (("N2", "N3"),)):
            rng = substream(self.syn.seed, "gen-v3-gpfa", i, int(round(x0 * 10)))
            m = int(np.floor(rate_h * (x1 - x0) / 3600.0 + rng.uniform()))
            for t0 in np.sort(rng.uniform(x0, x1, m)):
                d = float(np.clip(med * np.exp(rng.normal(0.0, 0.45)), 1.0, 10.0))
                if t0 + d > x1:
                    continue
                fb = float(np.clip(f * np.exp(rng.normal(0.0, 0.15)), 10.0, 25.0))
                ab = amp * float(np.exp(rng.normal(0.0, 0.15)))
                self._add_gpfa(i, rng, t0, t0 + d, fb * 1.08, fb * 0.92, 0.6 * ab, ab, ramp=0.12, side=side)
                self.bg.append((t0, t0 + d, 0.5, 0.1, 0.3))
                self._row("generalized_discharge", i, t0, t0 + d, pattern="gpfa", stage=self._stage_label(t0 + 0.5 * d),
                          frequency_hz=round(fb, 2), amplitude_uv=round(ab, 1))

    # ---------------------------------------------------------------- rows --
    def _gpfa_rows(self, g: dict, t: np.ndarray) -> Optional[Tuple[slice, np.ndarray]]:
        lo, hi = g["t0"] - 0.1, g["t1"] + 0.6
        if t[-1] < lo or t[0] > hi:
            return None
        i0, i1 = np.searchsorted(t, lo), np.searchsorted(t, hi)
        tt = t[i0:i1] - g["t0"]
        dur = max(g["t1"] - g["t0"], 1e-3)
        u = np.clip(tt / dur, 0.0, 1.0)
        f0, f1 = g["f0"], g["f1"]
        r = f1 / f0
        if abs(r - 1.0) < 1e-6:
            ph = 2 * np.pi * f0 * tt
            fi = np.full_like(tt, f0)
        else:
            ph = 2 * np.pi * f0 * dur * (np.power(r, u) - 1.0) / math.log(r) + 2 * np.pi * f1 * np.maximum(tt - dur, 0.0)
            fi = f0 * np.power(r, u)
        env = (g["a0"] + (g["a1"] - g["a0"]) * u)
        env = env * np.clip(tt / g["ramp"], 0.0, 1.0) * (1.0 - np.clip((tt - dur) / 0.4, 0.0, 1.0))
        _, wf = self._field("gen", g["side"])
        lag = g["lead"] * self.front
        P = (ph[None, :] - 2 * np.pi * fi[None, :] * lag[:, None] + g["dphi"][:, None]
             + 2 * np.pi * g["df"][:, None] * tt[None, :])
        am = 1.0 + 0.35 * np.sin(2 * np.pi * g["am_f"][:, None] * tt[None, :] + g["am_p"][:, None])
        wave = (np.sin(P) + 0.25 * np.sin(2 * P + g["psi"])) * am
        key = ("gpfa", g["side"], round(g["lead"], 5))
        nv = self._norm.get(key)
        if nv is None:
            # unit template, 1 s at 15 Hz with this segment's phase offsets: median best-derivation p-p
            tau = np.arange(0.0, 1.0, 1.0 / self.fs)
            Pt = (2 * np.pi * 15.0 * (tau[None, :] - lag[:, None]) + g["dphi"][:, None])
            wt = (np.sin(Pt) + 0.25 * np.sin(2 * Pt + g["psi"])) * wf[:, None]
            nv = max(float(np.ptp(wt[a] - wt[b])) for a, b in self.pairs) or 1.0
            self._norm[key] = nv
        return slice(i0, i1), -(wf[:, None] * wave) * (env / nv)[None, :]

    def emg_rows(self, t: np.ndarray, i0: int) -> Optional[np.ndarray]:
        if not self.emg or t.size == 0:
            return None
        gain = np.zeros(t.size)
        for e0, e1, p2p, rise, fall, _kind in self.emg:
            if e1 + fall * 3 < t[0] or e0 > t[-1]:
                continue
            sh = np.clip((t - e0) / max(rise, 1e-3), 0.0, 1.0) * np.clip(1.0 - (t - e1) / max(fall, 1e-3), 0.0, 1.0)
            gain = np.maximum(gain, sh * p2p)
        if not gain.any():
            return None
        n = t.size
        noise = self.syn._oa(self.syn.st_muscle, i0 + self.EMG_OFFSET, n, self.n_e)
        # independent realizations of unit RMS; a bipolar pair of them runs about 6 x sqrt(2) RMS peak-to-peak in 1 s
        return noise * self.emg_field[:, None] * (gain / (6.0 * math.sqrt(2.0)))[None, :]

    def _eye_rows(self, t: np.ndarray) -> Optional[np.ndarray]:
        if not self.eye:
            return None
        prof = np.zeros(t.size)
        for kind, e0, e1, amp, f in self.eye:
            if e1 + 1.0 < t[0] or e0 > t[-1]:
                continue
            d = t - e0
            if kind == "closure":
                # lids close in ~0.25 s, the eyes roll up (cornea-positive at Fp) and stay until reopening
                prof += amp * np.clip(d / 0.25, 0.0, 1.0) * np.clip(1.0 - (t - e1) / 0.3, 0.0, 1.0)
            else:
                ph = np.mod(d * f, 1.0)
                live = (d >= 0) & (t <= e1)
                prof += amp * live * np.exp(-0.5 * ((ph - 0.3) / 0.12) ** 2)
        if not prof.any():
            return None
        return self.syn._blink_field()[:, None] * prof[None, :]

    def _photic_rows(self, t: np.ndarray) -> Optional[np.ndarray]:
        out = None
        for p0, p1, fl, amp in self.photic:
            if p1 + 0.5 < t[0] or p0 > t[-1]:
                continue
            k0 = max(0, int(np.floor((t[0] - 0.4 - p0) * fl)))
            k1 = int(np.floor((min(t[-1], p1) - p0) * fl))
            sig = np.zeros(t.size)
            for k in range(k0, k1 + 1):
                d = t - (p0 + k / fl)
                m = (d > 0.0) & (d < 0.3)
                dd = d[m]
                # a driving response per flash: occipital positivity ~70 ms, negativity ~110 ms
                sig[m] += amp * (0.8 * np.exp(-0.5 * ((dd - 0.070) / 0.014) ** 2)
                                 - np.exp(-0.5 * ((dd - 0.110) / 0.020) ** 2))
            r = self.photic_field[:, None] * sig[None, :]
            out = r if out is None else out + r
        return out

    def rows(self, t: np.ndarray, i0: int, extras: bool = True) -> np.ndarray:
        """Surface potentials (n_elec, n) in absolute microvolts: complexes, fast activity and (``extras``) the
        EMG, eye and photic rows."""
        out = np.zeros((self.n_e, t.size))
        if t.size == 0:
            return out
        if self.cx:
            lo = np.searchsorted(self.cx_t, t[0] - self.cx_maxspan)
            hi = np.searchsorted(self.cx_t, t[-1] + 0.25)
            for j in range(lo, hi):
                c = self.cx[j]
                if c["t"] + c["span"] < t[0]:
                    continue
                a0 = np.searchsorted(t, c["t"] - 0.25)
                a1 = np.searchsorted(t, c["t"] + c["span"])
                if a1 <= a0:
                    continue
                d = t[a0:a1] - c["t"]
                un = _cnoise(np.arange(self.n_e), c["salt"])
                ul = _cnoise(np.arange(self.n_e), c["salt"] + 17)
                uc = float(_cnoise(np.zeros(1), c["salt"] + 29)[0])
                lag = c["lead"] * (0.6 + 0.8 * uc) * self.front + 0.003 * (2 * ul - 1)
                sp, wv = self._kernel(c, d[None, :] - lag[:, None])
                sf, wf = self._cx_fields(c)
                jit = (1.0 + c["jitter"] * (2 * un - 1)) * (1.0 + c["asym"] * np.sign(self.x))
                out[:, a0:a1] -= (c["amp"] / self._cx_norm(c)) * jit[:, None] * (sf[:, None] * sp + wf[:, None] * wv)
        for g in self.gpfa:
            r = self._gpfa_rows(g, t)
            if r is not None:
                out[:, r[0]] += r[1]
        for extra in ((self.emg_rows(t, i0), self._eye_rows(t), self._photic_rows(t)) if extras else ()):
            if extra is not None:
                out += extra
        return out

    @staticmethod
    def _shape(t: np.ndarray, a: float, b: float, rise: float, fall: float) -> np.ndarray:
        return np.clip((t - a) / max(rise, 1e-3), 0.0, 1.0) * np.clip(1.0 - (t - b) / max(fall, 1e-3), 0.0, 1.0)

    def bg_factor(self, t: np.ndarray) -> np.ndarray:
        """Background multiplier: absences replace the background, tonic decrements, GTC postictal suppression."""
        f = np.ones(t.size)
        for a, b, depth, rise, fall in self.bg:
            if b + fall < t[0] or a > t[-1]:
                continue
            f *= 1.0 - depth * self._shape(t, a, b, rise, fall)
        return f

    def emg_factor(self, t: np.ndarray) -> np.ndarray:
        """Tonic-muscle multiplier: atonic loss of tone and the silent postictal period."""
        f = np.ones(t.size)
        for a, b, depth in self.emg_loss:
            if b + 0.5 < t[0] or a > t[-1]:
                continue
            f *= 1.0 - depth * self._shape(t, a, b, 0.03, 0.3)
        return f

    def absence_gate(self, t: np.ndarray) -> np.ndarray:
        g = np.zeros(t.size)
        for a, b in self.gates:
            if b + 0.5 < t[0] or a > t[-1]:
                continue
            g = np.maximum(g, self._shape(t, a, b, 0.2, 0.3))
        return g

    def events(self) -> List[dict]:
        return list(self.key_rows)
