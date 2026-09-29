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
#: sporadic ``generalized_frontocentral`` table).  r5 (generalized-fix.md open item): C 0.45 / P 0.40 / O 0.10 put
#: P3-O1 (0.37-0.81) above C3-P3 (0.12-0.30), a non-monotonic chain; eeg0094 has P3-O1 about equal to F3-C3 and
#: myoclonic-jerk-examples a front-to-back decline.  An even fall F 1.0 / C 0.68 / P 0.42 / O 0.22 makes the
#: parasagittal links decline F3-C3 > C3-P3 > P3-O1 (0.32 / 0.26 / 0.20 before jitter), Fp1-F3 below F3-C3, and the
#: temporal links stay small (Fp1-F7 0.17, F7-T3 0.10, T3-T5 0.13).
_FC_FIELD = {"F3": 1.0, "F4": 1.0, "Fz": 0.95, "Fp1": 0.72, "Fp2": 0.72, "C3": 0.68, "C4": 0.68, "Cz": 0.65,
             "P3": 0.42, "P4": 0.42, "Pz": 0.40, "F7": 0.55, "F8": 0.55, "T3": 0.45, "T4": 0.45,
             "T5": 0.32, "T6": 0.32, "O1": 0.22, "O2": 0.22}
#: eyelid myoclonia (independent re-review; PMC8610539 Fig 1 E/F, Jeavons syndrome: polyspikes largest bioccipitally
#: right after each eye closure; PMC12593124 Fig 2: generalized PSW after closure).  Occipital maximum falling steeply
#: to the parietal and posterior temporal rows, so P3-O1 / T5-O1 carry the largest share of the longitudinal chain
#: (a gentle O 1.0 / P 0.9 gradient cancels there); frontal rows keep a share (the discharge stays generalized).
_POST_FIELD = {"O1": 1.0, "O2": 1.0, "P3": 0.50, "P4": 0.50, "Pz": 0.50, "T5": 0.50, "T6": 0.50, "C3": 0.32,
               "C4": 0.32, "Cz": 0.32, "T3": 0.25, "T4": 0.25, "F3": 0.22, "F4": 0.22, "Fz": 0.22, "F7": 0.16,
               "F8": 0.16, "Fp1": 0.12, "Fp2": 0.12}
#: atonic seizure (independent re-review: on the Fp->O slow-wave gradient the complex peaked at Fp1-F7 / P3-O1 and read
#: as the blink 7 s later; ILAE: generalized (poly)spike-and-slow-wave, vertex / frontocentral maximum).  Vertex maximum:
#: phase reversals around C3 / Cz / C4 in the parasagittal and midline chains, the frontal-pole and
#: temporal links (where a blink is largest) small.
_VTX_FIELD = {"Cz": 1.0, "C3": 0.80, "C4": 0.80, "Fz": 0.60, "Pz": 0.50, "F3": 0.42, "F4": 0.42, "P3": 0.32,
              "P4": 0.32, "T3": 0.30, "T4": 0.30, "F7": 0.22, "F8": 0.22, "Fp1": 0.15, "Fp2": 0.15, "T5": 0.18,
              "T6": 0.18, "O1": 0.10, "O2": 0.10}
#: LGS generalized paroxysmal fast activity in sleep (independent re-review; tonic-seizure-ii onset, ILAE LGS):
#: bifrontal maximum falling monotonically backwards, weighted for the chain.  In phase across the head, the fast
#: activity reaches the bipolar chain only through this gradient (the Fp->O slow-wave gradient put its largest link at
#: P3-O1).
_GPFA_FIELD = {"F3": 1.0, "F4": 1.0, "Fz": 1.0, "Fp1": 0.60, "Fp2": 0.60, "F7": 0.60, "F8": 0.60, "C3": 0.55,
               "C4": 0.55, "Cz": 0.60, "T3": 0.35, "T4": 0.35, "P3": 0.30, "P4": 0.30, "Pz": 0.30, "T5": 0.20,
               "T6": 0.20, "O1": 0.10, "O2": 0.10}
#: r8 GTC muscle (REFERENCE_TARGETS s1, PubMed 41830894: scalp EMG in bilateral tonic-clonic seizures is largest at T3/T4
#: and "masks all derivations except those from the vertex"): temporal / frontal-pole maximum, the midline electrodes
#: ~0.2 so Fz-Cz / Cz-Pz carry about 0.2-0.3x the temporal chains' muscle.  ``_EMG_FIELD`` stays as it is for the
#: accepted myoclonic features.
_EMG_FIELD_GTC = {"T3": 1.0, "T4": 1.0, "F7": 0.95, "F8": 0.95, "T5": 0.80, "T6": 0.80, "Fp1": 0.85, "Fp2": 0.85,
                  "F3": 0.45, "F4": 0.45, "C3": 0.35, "C4": 0.35, "P3": 0.35, "P4": 0.35, "O1": 0.50, "O2": 0.50,
                  "Fz": 0.20, "Cz": 0.15, "Pz": 0.20}
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
        if name in ("eses", "fc", "post", "vtx", "gpfa"):
            tab = {"eses": _ESES_FIELD, "fc": _FC_FIELD, "post": _POST_FIELD, "vtx": _VTX_FIELD,
                   "gpfa": _GPFA_FIELD}[name]
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


def _dome(tau: np.ndarray, c: float, s: float, p: float = 3.0) -> np.ndarray:
    """Flat-topped dome (generalized Gaussian of order ``p``): half maximum at |tau - c| = 1.115 s for p = 3."""
    return np.exp(-0.5 * np.abs((tau - c) / s) ** p)


def k_sw(tau: np.ndarray, period: float, width: float = 1.0, double: bool = False) -> Tuple[np.ndarray, np.ndarray]:
    """3-Hz spike-and-wave: spike (rise 10 / fall 18 ms), optional second spike 48 ms later (spike/polyspike and
    waves, absence-seizure-at-20uV), a small positive transient, then the dominant surface-negative slow wave.

    Independent re-review (generalized-independent.md): the old Gaussian wave (centre 0.45 x period capped at 0.22 s,
    sigma 0.18 x period capped at 90 ms) was 35-42 % of the cycle at half maximum, so the page read spike-dominated.  In
    atlas-absence-seizure/p1 and Commons Spike-waves.png the negative dome is the largest deflection and fills ~70 %
    of the cycle, rising straight out of the spike.  The wave is now a flat-topped dome centred at 0.55 x period with
    its half maximum over ~0.6 x period (no caps), gain 1.4."""
    sp = _g(tau, 0.010 * width, 0.018 * width)
    tl = 0.045 * width
    if double:
        sp = sp + 0.8 * _g(tau - 0.048 * width, 0.008 * width, 0.014 * width)
        tl += 0.048 * width
    sp = sp - 0.25 * np.exp(-0.5 * ((tau - tl) / 0.020) ** 2)
    return sp, 1.6 * _dome(tau, 0.55 * period, 0.29 * period)


def k_sw_blend(tau: np.ndarray, period: float, width: float, double: bool,
               blend: float) -> Tuple[np.ndarray, np.ndarray]:
    """r8 ESES: spike-and-wave between the phase D kernel (Gaussian wave centred 0.45 x period, capped 0.12-0.22 s,
    positive transient 0.35) and the current flat-topped dome; ``blend`` 0 = phase D, 1 = current."""
    sp, dome = k_sw(tau, period, width, double)
    tl = 0.045 * width + (0.048 * width if double else 0.0)
    sp = sp - 0.10 * (1.0 - blend) * np.exp(-0.5 * ((tau - tl) / 0.020) ** 2)
    c = min(max(0.45 * period, 0.12), 0.22)
    s = min(max(0.18 * period, 0.045), 0.09)
    return sp, blend * dome + (1.0 - blend) * 1.15 * np.exp(-0.5 * ((tau - c) / s) ** 2)


def k_ssw8(tau: np.ndarray, period: float, width: float = 1.0) -> Tuple[np.ndarray, np.ndarray]:
    """r8 slow spike-and-wave (atypical absence, LGS): Craig's review read the ``k_ssw`` sharp wave, riding the rising
    slow wave on the same field, as a notched delta (Angelman-like).  Here a sharp wave (rise 26 / fall 42 ms, FWHM
    ~80 ms) on the frontal spike field, a brief return toward baseline (positive notch ~110 ms), then one broad
    surface-negative slow wave centred 0.14 + 0.30 x period (0.29 s at 2 Hz): a sharp-and-slow-wave complex, one per
    cycle.  ``width`` scales the sharp wave and the notch (per-cycle morphology jitter)."""
    sp = 0.75 * (_g(tau, 0.034 * width, 0.056 * width)
                 - 0.22 * np.exp(-0.5 * ((tau - 0.140 * width) / 0.035) ** 2))
    c = 0.15 + 0.30 * period
    s = 0.08 + 0.14 * period          # FWHM ~0.34 s at 2 Hz (REFERENCE_TARGETS s4: a 300-500 ms wave)
    return sp, 1.35 * _dome(tau, c, s, 2.4)


def k_ssw(tau: np.ndarray, period: float, wave_gain: float = 1.3) -> Tuple[np.ndarray, np.ndarray]:
    """Slow spike-and-wave (LGS, atypical absence, atonic): a sharp wave (FWHM ~95 ms) running straight into one long
    slow wave, one sharp-then-slow unit per cycle (different-LGS-background-at-10uV).

    Independent re-review: the 0.30 positive trough 110 ms after the sharp wave and a slow wave centred 0.20-0.40 s
    later split every cycle into two humps, so an authored 2-Hz run displayed a 4.1-4.25 Hz peak.  The trough is gone
    and a flat-topped slow wave starts on the sharp wave's falling limb (centre 0.34 x period, 0.17 s at 2 Hz; half
    maximum over ~0.38 x period): one negative excursion per cycle, then the return, so the fundamental carries >10x
    the power of the second harmonic (the proposed centre 0.23 s / sigma 0.12 s still left 2 and 4 Hz about equal)."""
    sp = _g(tau, 0.030, 0.050)
    c = min(max(0.34 * period, 0.14), 0.30)
    s = min(max(0.17 * period, 0.06), 0.13)
    return sp, wave_gain * (1.2 / 1.3) * _dome(tau, c, s)


def k_psw(tau: np.ndarray, period: float, lags, gains, troughs, wave_gain: float = 2.2,
          wave_s: Optional[Tuple[float, float]] = None) -> Tuple[np.ndarray, np.ndarray]:
    """Polyspike-and-wave: irregular spikes (each a sharp negative peak with a small, broad positive trough), then a
    slow wave at least as large as the spikes (eeg0094_db1, myoclonic-jerk-examples/p1).  ``wave_s`` = (lag after the
    last spike, sigma) of the slow wave in seconds (r8 GTC clonic: a slow wave that fills the lengthening interval)."""
    sp = np.zeros_like(tau)
    for c, g, tr in zip(lags, gains, troughs):
        x = tau - c
        sp = sp + g * (_g(x, 0.007, 0.010) - tr * np.exp(-0.5 * ((x - 0.032) / 0.022) ** 2))
    if wave_s is not None:
        wl, s = wave_s
    else:
        wl = min(max(0.35 * period, 0.09), 0.18)
        s = min(max(0.18 * period, 0.04), 0.09)
    return sp, wave_gain * np.exp(-0.5 * ((tau - float(lags[-1]) - wl) / s) ** 2)


def polyspike_draw(rng: np.random.Generator, n_spikes: int, lo: int = 3, hi: int = 8,
                   isi: Tuple[float, float, float] = (0.072, 0.045, 0.130)):
    """Irregular polyspike (epileptiform-v3.md change 1): n-1..n+1 spikes, lognormal ISIs (CV ~0.35, median 72 ms,
    clipped 45-130 ms; ``isi`` = (median, lo, hi)), spikes FWHM ~20 ms, unsorted heights uniform(0.5, 1.2) (first spike
    1.0), troughs 0.2-0.35."""
    n = int(np.clip(n_spikes + int(rng.integers(-1, 2)), lo, hi))
    isi = np.clip(isi[0] * np.exp(rng.normal(0.0, 0.40, n - 1)), isi[1], isi[2])
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
    #: independent re-review (atonic, myoclonic-atonic): the loss of tone fell from a ~4-uV scalp muscle floor and was
    #: invisible, so these seizure types put a polygraphic EMG row on the page (PMC12593124 Fig 2 carries EMG rows;
    #: negative motor phenomena are read on deltoid / neck polygraphy).  Resting tone ~15 uV RMS.
    EMG_ROW_TYPES = ("atonic", "myoclonic_atonic", "myoclonic_tonic", "tonic")
    EMG_ROW_REST_UV = 15.0
    EMG_ROW_OFFSET = 3_500_000_000

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
        self.emg_field_gtc = np.array([_EMG_FIELD_GTC.get(e, 0.3) for e in self.el])
        self.move: List[tuple] = []          # r8 GTC movement transients (t, sigma s, per-electrode uV)
        self.photic_field = np.array([_PHOTIC_FIELD.get(e, 0.03) for e in self.el])
        from .synth import BLINK_UV          # lazy: synth imports this module
        self._closure_blink_uv = float(syn.bg.get("blink_amplitude_uv", BLINK_UV))
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
        self.emg_row = any(ev["type"] == "generalized_seizure" and ev.get("seizure_type") in self.EMG_ROW_TYPES
                           for ev in syn.spec["events"])
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
                asym: float = 0.0, lead: float = 0.012, jitter: float = 0.12, x8: Optional[dict] = None) -> None:
        span = (float(ps[0][-1]) if ps is not None else 0.0) + 0.9
        if x8 is not None:
            span = max(span, float(x8.get("span", 0.0)))
        self.cx_t.append(float(t))
        self.cx.append(dict(t=float(t), kind=kind, amp=float(amp), period=float(period), salt=int(salt),
                            field=field, side=side, width=float(width), double=bool(double), ps=ps,
                            wave_gain=float(wave_gain), asym=float(asym), lead=float(lead), jitter=float(jitter),
                            span=span, **({"x8": x8} if x8 is not None else {})))

    def _cx_fields(self, c: dict) -> Tuple[np.ndarray, np.ndarray]:
        sf, wf = self._field(c["field"], c["side"])
        if c["kind"] == "ssw" and c.get("x8", {}).get("k") == "ssw8":
            return sf, wf            # r8: the sharp wave on the frontal spike field, distinct from the slow wave
        # a slow spike-and-wave's sharp wave rides the slow wave's field (different-LGS-background: the sharp
        # component shows in every chain, not only centrally)
        return (wf, wf) if c["kind"] == "ssw" else (sf, wf)

    def _kernel(self, c: dict, tau: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        x8 = c.get("x8")
        if x8 is not None:
            k = x8.get("k")
            if k == "ssw8":
                sp, wv = k_ssw8(tau, c["period"], c["width"])
            elif k == "sw_blend":
                sp, wv = k_sw_blend(tau, c["period"], c["width"], c["double"], x8["blend"])
            elif c["kind"] == "sw":
                sp, wv = k_sw(tau, c["period"], c["width"], c["double"])
            elif c["kind"] == "ssw":
                sp, wv = k_ssw(tau, c["period"], c["wave_gain"])
            else:
                lags, gains, troughs = c["ps"]
                sp, wv = k_psw(tau, c["period"], lags, gains, troughs, c["wave_gain"], x8.get("wave_s"))
            return x8["sg"] * sp, x8["wg"] * wv
        if c["kind"] == "sw":
            return k_sw(tau, c["period"], c["width"], c["double"])
        if c["kind"] == "ssw":
            return k_ssw(tau, c["period"], c["wave_gain"])
        lags, gains, troughs = c["ps"]
        return k_psw(tau, c["period"], lags, gains, troughs, c["wave_gain"])

    def _cx_norm(self, c: dict) -> float:
        """Largest longitudinal-bipolar peak-to-peak of the unjittered unit complex (numerical, cached).  An r8
        complex is normalized at its NOMINAL morphology (width, single spike, unit spike and wave gains), so the
        per-cycle morphology draws change the displayed voltage as they would on a real record."""
        x8 = c.get("x8")
        if x8 is not None:
            c = dict(c, width=x8["w0"], double=False, x8=dict(x8, sg=1.0, wg=1.0))
        ps = c["ps"]
        key = (c["kind"], round(c["period"], 4), round(c["width"], 4), c["double"], c["field"], c["side"],
               round(c["wave_gain"], 3), None if ps is None else tuple(np.round(np.concatenate(ps), 5)))
        if x8 is not None:
            key = key + ("x8", x8.get("k"), x8.get("blend"), x8.get("wave_s"))
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
               asym_amt: float = 0.08, amp_sd: float = 0.10, ps_range: Tuple[int, int] = (2, 4),
               ps_isi: Tuple[float, float, float] = (0.072, 0.045, 0.130), **kw) -> int:
        """Complexes from t0 to t1 with a log-frequency glide f0 -> f1, per-cycle rate jitter and an amplitude ramp."""
        t, k = t0, 0
        dur = max(t1 - t0, 1e-6)
        while t < t1:
            u = (t - t0) / dur
            f = self._glide(f0, f1, u) * float(np.exp(rng.normal(0.0, jitter_f)))
            period = 1.0 / f
            a = amp * float(np.exp(rng.normal(0.0, amp_sd)))
            if ramp_s > 0:
                a *= float(np.clip(min(t - t0, t1 - t) / ramp_s, 0.25, 1.0))
            ps = polyspike_draw(rng, ps_n, lo=ps_range[0], hi=ps_range[1], isi=ps_isi) if ps_n else None
            self._add_cx(t, kind, a, period, salt0 + k, double=bool(rng.uniform() < p_double), ps=ps,
                         asym=float(rng.uniform(-asym_amt, asym_amt)), **kw)
            t += period
            k += 1
        return k

    #: r8 (research/eeg-atlas/generalized-review-20260928, Craig's review and JITTER_AUDIT.md): whole-head cycle
    #: jitter.  Every draw belongs to the discharge, shared by all electrodes (the common source); per-electrode
    #: scatter cancels in the bipolar chain (why r5 stripped it from tonic fast activity), so the existing small
    #: per-electrode lag / amplitude / asymmetry stay as they are.
    #:   ioi_cv / rho  log-period noise, AR(1): period sd ~ioi_cv, cycle-to-cycle change ~ioi_cv x sqrt(1 - rho)
    #:   amp_cv        per-cycle lognormal amplitude sd;  drift  slow waxing / waning depth (two sinusoids, 2.5-6 s)
    #:   morph_cv      per-cycle spike / sharp-wave width sd;  wave_cv  per-cycle slow-wave gain sd
    #:   spk_cv        per-cycle spike gain sd;  p_double  per-cycle second spike
    #:   p_drop        per-cycle probability that the spike is nearly absent (x0.25)
    J8 = dict(ioi_cv=0.08, rho=0.3, amp_cv=0.13, drift=0.15, drift_s=(2.5, 6.0), morph_cv=0.12, wave_cv=0.10,
              spk_cv=0.0, p_double=0.0, p_drop=0.0, w0=1.0, width_lim=(0.6, 1.6))
    #: slow spike-and-wave (atypical absence, LGS): irregular (audit: CV 0.15-0.25), sharp wave +-20 %, wave +-15 %,
    #: 10 % of cycles with the sharp component nearly absent
    _J8_SSW = dict(ioi_cv=0.16, rho=0.3, amp_cv=0.15, drift=0.20, morph_cv=0.18, wave_cv=0.15, spk_cv=0.25,
                   p_drop=0.10, width_lim=(0.6, 1.7))

    def _train8(self, i: int, rng, t0: float, t1: float, f0: float, f1: float, amp: float, kind: str, *,
                salt0: int, j8: dict, ramp_s: float = 0.0, ps_n: int = 0, ps_range: Tuple[int, int] = (2, 4),
                ps_isi: Tuple[float, float, float] = (0.072, 0.045, 0.130), asym_amt: float = 0.08,
                x8: Optional[dict] = None, ps_n_end: Optional[int] = None, **kw) -> int:
        """``_train`` with the r8 whole-head jitter (``J8`` keys, overridden by ``j8``).  ``x8`` carries the kernel
        choice (``k``: ssw8 / sw_blend / None) and fixed extras (``blend``, ``wave_s``, ``span``); ``ps_n_end`` lets
        the polyspike count fall linearly across the run."""
        J = dict(self.J8, **j8)
        dur = max(t1 - t0, 1e-6)
        am_f = rng.uniform(1.0 / J["drift_s"][1], 1.0 / J["drift_s"][0], 2)
        am_p = rng.uniform(0.0, 2 * np.pi, 2)
        rho = float(J["rho"])
        e = float(rng.normal())
        t, k = t0, 0
        while t < t1:
            u = (t - t0) / dur
            e = rho * e + math.sqrt(1.0 - rho * rho) * float(rng.normal())
            cv = float(J["ioi_cv"](u) if callable(J["ioi_cv"]) else J["ioi_cv"])
            period = float(np.exp(cv * e)) / self._glide(f0, f1, u)
            slow = 1.0 + 0.5 * J["drift"] * float(np.sum(np.sin(2 * np.pi * am_f * (t - t0) + am_p)))
            a = amp * float(np.exp(rng.normal(0.0, J["amp_cv"]))) * slow
            if ramp_s > 0:
                a *= float(np.clip(min(t - t0, t1 - t) / ramp_s, 0.25, 1.0))
            width = J["w0"] * float(np.clip(np.exp(rng.normal(0.0, J["morph_cv"])), *J["width_lim"]))
            wg = float(np.exp(rng.normal(0.0, J["wave_cv"])))
            sg = float(np.exp(rng.normal(0.0, J["spk_cv"]))) if J["spk_cv"] > 0 else 1.0
            if rng.uniform() < J["p_drop"]:
                sg *= 0.25
            dbl = bool(rng.uniform() < J["p_double"])
            n_ps = ps_n if ps_n_end is None else int(round(ps_n + (ps_n_end - ps_n) * u))
            ps = polyspike_draw(rng, n_ps, lo=ps_range[0], hi=ps_range[1], isi=ps_isi) if ps_n else None
            self._add_cx(t, kind, a, period, salt0 + k, width=width, double=dbl, ps=ps,
                         asym=float(rng.uniform(-asym_amt, asym_amt)),
                         x8=dict(x8 or {}, sg=sg, wg=wg, w0=J["w0"]), **kw)
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
        # independent re-review: the references repeat nearly the same complex cycle after cycle, so a seizure is
        # either spike-and-wave or spike/polyspike-and-wave throughout (drawn once), with less per-electrode and
        # per-cycle amplitude scatter (0.05, was 0.12 / 0.10)
        dbl = 1.0 if rng.uniform() < 0.25 else 0.0
        n = self._train(i, rng, t0, t1, 1.15 * f, 0.85 * f, float(ev["amplitude_uv"]), "sw", salt0=i * 1_000_003,
                        p_double=dbl, jitter_f=0.035, amp_sd=0.05, jitter=0.05, side=str(ev.get("side") or "both"))
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
        # r8 (Craig: "reads as notched delta, Angelman-like"): the sharp-and-slow-wave kernel on the frontal spike
        # field, an irregular rate (AR(1) interval CV 0.16) and per-cycle sharp-wave width, height and slow-wave gain
        n = self._train8(i, rng, t0, t1, 1.05 * f, 0.9 * f, float(ev["amplitude_uv"]), "ssw", salt0=i * 1_000_003,
                         j8=self._J8_SSW, ramp_s=ramp, asym_amt=0.2, x8=dict(k="ssw8", span=1.3),
                         side=str(ev.get("side") or "both"))
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
            # r5 (generalized-independent: wave / first spike 1.8-2.9 on F3-ear; eeg0094_db1 and myoclonic-jerk-examples
            # show spikes as tall as or taller than the wave): wave_gain 2.4 -> 1.1 (myoclonic-atonic keeps its 1.4x)
            self._add_cx(t, "psw", a, 0.5, i * 1_000_003 + k, ps=ps, wave_gain=1.1 * (1.4 if label == "myoclonic_atonic" else 1.0),
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
                           0.3 * float(ev["amplitude_uv"]), **self._TONIC_FAST)
            return max(end, a0 + dur)
        self._jerks(i, ev, rng, "myoclonic_tonic", after)

    #: r5 (generalized-independent, tonic / myoclonic-tonic: waxing-waning packets read as spindles, homologous chains
    #: dephased, iso F3-C3/F4-C4 0.16-0.33; atlas-tonic-seizure-i/-ii: a continuous, monomorphic, bisynchronous rhythm
    #: under one crescendo): no per-electrode AM or frequency scatter, phase scatter +-0.7 -> +-0.05 rad, and the bifrontal
    #: GPFA field.  On the shallow slow-wave gradient any phase scatter between neighbours IS the bipolar signal (a
    #: +-0.15 rad draw still gave F3-C3/F4-C4 -0.2 to 0.5); on the steep field the link carries the rhythm itself.
    #: (The focal ``tonic_seizure`` event keeps the defaults: its reviewer asked for less, not more, regularity.)
    _TONIC_FAST = dict(am=0.0, df_sd=0.0, dphi=0.05, field="gpfa")

    def _add_gpfa(self, i, rng, t0, t1, f0, f1, a0, a1, ramp=0.15, side="both", am=0.35, df_sd=0.6, dphi=0.7,
                  field="gen", w8: Optional[dict] = None, off_s: float = 0.4):
        """``am`` per-electrode amplitude modulation depth, ``df_sd`` / ``dphi`` per-electrode frequency (Hz) and phase
        (rad) scatter; the draw count does not depend on them.

        r8 ``w8`` (whole-head, shared by every electrode; drawn from its own stream so ``rng`` is untouched):
        ``wander`` frequency wander sd as a fraction (sum of three sinusoids at ``nu`` Hz), ``cam`` common amplitude
        modulation depth (three sinusoids at ``mu`` Hz), ``cyc`` per-cycle height scatter (+-, uniform), ``harm``
        second-harmonic variation (morphology), ``hemi`` hemispheric gain sd.  ``off_s`` the offset taper (s)."""
        g = dict(t0=float(t0), t1=float(t1), f0=float(f0), f1=float(f1), a0=float(a0), a1=float(a1),
                 ramp=float(ramp), side=side, field=field, am=float(am),
                 dphi=rng.uniform(-dphi, dphi, self.n_e),
                 df=rng.normal(0.0, df_sd, self.n_e), am_f=rng.uniform(0.6, 1.6, self.n_e),
                 am_p=rng.uniform(0, 2 * np.pi, self.n_e), psi=float(rng.uniform(0, 2 * np.pi)),
                 lead=float(rng.uniform(0.004, 0.012)), off_s=float(off_s))
        if w8 is not None:
            r = substream(self.syn.seed, "gen-v3-r8-gpfa", i, int(round(t0 * 1000.0)))
            n = 3
            nu = r.uniform(*w8.get("nu", (0.2, 1.0)), n)
            mu = r.uniform(*w8.get("mu", (0.3, 1.2)), n)
            g["w8"] = dict(nu=nu, nu_p=r.uniform(0, 2 * np.pi, n),
                           dfr=float(w8.get("wander", 0.0)) * math.sqrt(2.0 / n) * r.uniform(0.6, 1.4, n),
                           mu=mu, mu_p=r.uniform(0, 2 * np.pi, n),
                           cam=float(w8.get("cam", 0.0)) * math.sqrt(2.0 / n) * r.uniform(0.6, 1.4, n),
                           harm=float(w8.get("harm", 0.0)), eta=float(r.uniform(0.4, 1.5)),
                           eta_p=float(r.uniform(0, 2 * np.pi)),
                           hemi=1.0 + float(w8.get("hemi", 0.0)) * float(r.normal()) * np.sign(self.x),
                           cyc=float(w8.get("cyc", 0.0)), salt=int(r.integers(0, 2 ** 31)))
        self.gpfa.append(g)

    def _sz_tonic(self, i, ev, rng):
        """Tonic seizure (atlas-tonic-seizure-i/-ii): diffuse electrodecrement, then generalized paroxysmal fast
        activity 10-25 Hz, frontally predominant, building in voltage as it slows, with tonic EMG."""
        t0 = float(ev["onset_min"]) * 60.0
        dec = float(ev.get("decrement_s", 1.0))
        t1 = t0 + float(ev["duration_s"])
        f0, f1 = float(ev.get("start_hz", 20.0)), float(ev.get("end_hz", 12.0))
        amp = float(ev["amplitude_uv"])
        # r8 (Craig: "a larger delta or sharp-wave onset before the electrodecrement; a little more frequency
        # jitter"): a generalized high-voltage sharp-and-slow wave (and, 60 %, a second slower delta wave) opens the
        # seizure, the decrement follows it, and the fast activity wanders +-6 % in frequency with a 0.18 common
        # amplitude modulation, still in phase across the head (r5 bisynchrony).  Drawn from a separate stream, so
        # ``rng`` (the fast-activity draws) is unchanged.
        r8 = substream(self.syn.seed, "gen-v3-r8-tonic", i)
        a_on = float(ev.get("onset_uv", 3.5 * amp)) * float(np.exp(r8.normal(0.0, 0.12)))
        self._add_cx(t0, "ssw", a_on, 0.7, i * 1_000_003 + 900_001, field="gen", jitter=0.08,
                     asym=float(r8.uniform(-0.1, 0.1)), x8=dict(k="ssw8", sg=float(r8.uniform(0.7, 1.2)), wg=1.0,
                                                               w0=1.0, span=1.3), width=float(r8.uniform(1.0, 1.4)))
        pre = 0.55
        if r8.uniform() < 0.6:
            p2 = float(r8.uniform(0.6, 0.9))
            self._add_cx(t0 + 0.7, "ssw", a_on * float(r8.uniform(0.45, 0.7)), p2, i * 1_000_003 + 900_002,
                         field="gen", jitter=0.08, x8=dict(k="ssw8", sg=0.3, wg=1.0, w0=1.0, span=1.4))
            pre = 0.7 + 0.6 * p2
        self.bg.append((t0 + pre, t1, float(ev.get("decrement_depth", 0.7)), 0.2, 1.0))
        self._add_gpfa(i, rng, t0 + pre + dec, t1, f0, f1, 0.3 * amp, amp, **self._TONIC_FAST,
                       w8=dict(wander=0.06, nu=(0.2, 1.0), cam=0.18, mu=(0.3, 1.2), harm=0.4, hemi=0.08))
        self.emg.append((t0 + pre + 0.3 * dec, t1, float(ev.get("emg_uv", 120.0)), 1.5, 0.6, "tonic"))
        self._row("generalized_seizure", i, t0, t1, seizure_type="tonic", start_hz=f0, end_hz=f1,
                  decrement_s=dec)

    def _sz_atonic(self, i, ev, rng):
        """Atonic seizure: a generalized sharp/spike-and-slow-wave with abrupt loss of EMG tone."""
        t0 = float(ev["onset_min"]) * 60.0
        dur = float(ev["duration_s"])
        self._add_cx(t0, "ssw", float(ev["amplitude_uv"]), 0.7, i * 1_000_003, wave_gain=1.6, field="vtx", jitter=0.05,
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
        # r8 (Craig: GTC onset "too monomorphic"): whole-head frequency wander +-8 %, common amplitude modulation
        # 0.25 and a varying second harmonic; the per-electrode scatter (which only dephased neighbours) reduced to
        # AM 0.15 / 0.2 Hz / +-0.25 rad
        gtc_fast = dict(am=0.15, df_sd=0.2, dphi=0.25)
        self._add_gpfa(i, rng, t0, t0 + 1.5, 25.0, 22.0, 0.15 * amp, 0.25 * amp, ramp=0.2, **gtc_fast,
                       w8=dict(wander=0.08, nu=(0.4, 1.5), cam=0.25, mu=(0.8, 2.5), harm=0.5))
        self._add_gpfa(i, rng, t0 + 1.2, tc, 11.0, 6.0, 0.3 * amp, 0.8 * amp, ramp=0.8, **gtc_fast,
                       w8=dict(wander=0.08, nu=(0.3, 1.2), cam=0.25, mu=(0.4, 1.5), harm=0.6, hemi=0.08))
        # r8 (Craig's reference, researchgate 369381411 fig 3A-B: from ~3 s after onset the tonic phase is muscle in
        # every derivation, continuous): tonic EMG 2x emg_uv
        self.emg.append((t0 + 0.5, tc, 2.0 * emg, 1.5, 0.3, "gtc_tonic"))
        # r8 clonic rebuild (Craig: "much more muscle and much larger EEG amplitude"; polyspike bursts separated by
        # slow waves, progressively slowing; REFERENCE_TARGETS s1-2, Bauer 2017, AES f72): bursts from ~4 Hz, the
        # interval growing exponentially to ~0.8 Hz with AR(1) lognormal scatter rising 0.10 -> 0.30, 2.5x the tonic
        # voltage, 5 -> 2 spikes per burst, a slow wave that fills the lengthening interval, a near-flat inter-burst
        # trace (background 0.9 suppressed, EMG silent), and an EMG burst 2.5x the tonic EMG locked to every polyspike,
        # lengthening through the phase.  The last 3-5 discharges are full size, 1.2 -> 2.9 s apart (x1.25 each, with
        # muscle), and either stop abruptly or (half of seizures, Craig's reference fig 3C) fade: each terminal discharge
        # and its EMG smaller than the last, down to ~0.35x.
        r8 = substream(self.syn.seed, "gen-v3-r8-clonic", i)
        a_cl = float(ev.get("clonic_uv", 2.5 * amp))
        fade = bool(r8.uniform() < 0.5)
        n_term = int(r8.integers(3, 6))
        gaps = [1.2 * 1.25 ** j * float(np.exp(r8.normal(0.0, 0.12))) for j in range(n_term - 1)]
        t_term = t1 - 0.3 - float(np.sum(gaps))
        t, k, e = tc, 0, float(r8.normal())
        while t < t_term:
            u = (t - tc) / max(t_term - tc, 1e-3)
            e = 0.5 * e + math.sqrt(0.75) * float(r8.normal())
            period = float(np.exp((0.10 + 0.20 * u) * e)) / self._glide(4.0, 0.8, u)
            n_sp = int(round(5 - 3 * u))
            ps = polyspike_draw(r8, n_sp, lo=2, hi=6, isi=(0.055, 0.035, 0.090))
            wl = min(0.08 + 0.10 * period, 0.22)
            ws = min(0.04 + 0.05 * period, 0.09)
            a = a_cl * float(np.exp(r8.normal(0.0, 0.15)))
            self._add_cx(t, "psw", a, period, i * 1_000_003 + k, ps=ps, wave_gain=1.4,
                         asym=float(r8.uniform(-0.12, 0.12)),
                         x8=dict(sg=1.0, wg=float(np.exp(r8.normal(0.0, 0.12))), w0=1.0, wave_s=(wl, ws),
                                 span=float(ps[0][-1]) + wl + 3.5 * ws))
            self.emg.append((t - 0.01, t + float(ps[0][-1]) + 0.06 + 0.10 * u + float(r8.uniform(0.0, 0.05)),
                             2.5 * emg * (1.0 - 0.3 * u) * float(np.exp(r8.normal(0.0, 0.2))), 0.01, 0.04,
                             "gtc_burst"))
            self._jerk_move(r8, t, 1.0 - 0.3 * u)
            t += period
            k += 1
        t = max(t, t_term)
        for j in range(n_term):
            g = 1.0 - 0.65 * (j + 1) / n_term if fade else 1.0
            ps = polyspike_draw(r8, 3, lo=2, hi=5, isi=(0.055, 0.035, 0.090))
            self._add_cx(t, "psw", a_cl * g * float(np.exp(r8.normal(0.0, 0.15))), 1.5, i * 1_000_003 + k, ps=ps,
                         wave_gain=1.4, asym=float(r8.uniform(-0.12, 0.12)),
                         x8=dict(sg=1.0, wg=1.0, w0=1.0, wave_s=(0.22, 0.09), span=float(ps[0][-1]) + 0.6))
            self.emg.append((t - 0.01, t + float(ps[0][-1]) + 0.18, 2.0 * emg * g, 0.01, 0.05, "gtc_burst"))
            self._jerk_move(r8, t, g)
            if j == n_term - 1:
                # the seizure ends with its last discharge (the main run can overshoot t_term by one period)
                t1 = max(t1, t + float(ps[0][-1]) + 0.3)
            else:
                t += gaps[j]
            k += 1
        self.bg.append((tc, t1, 0.9, 0.5, 0.5))
        # r8: postictal generalized suppression below ~10 uV (REFERENCE_TARGETS s2, PGES; was 0.85), reached at once,
        # low-level activity and some residual muscle kept (Craig's reference fig 3C: not a dead-flat line)
        self.bg.append((t1, t1 + post, 0.88, 0.1, 0.35 * post))
        self.emg_loss.append((t1, t1 + post, 0.75))
        self._row("generalized_seizure", i, t0, t1, seizure_type="gtc", tonic_end_s=round(tc, 3),
                  clonic_end_s=round(t1, 3), postictal_s=post, n_clonic_bursts=k)

    def _jerk_move(self, r8, t: float, g: float) -> None:
        """r8 (REFERENCE_TARGETS s1 [E], Craig: "muscle artifacts"): a clonic jerk tugs the electrodes - a slow
        (0.15-0.35-s sigma) deflection of 50-150 uV, random sign, on 20-40 % of electrodes, 30-120 ms after the burst
        onset.  Per electrode, so it survives the bipolar chain; drawn from the clonic stream in schedule order."""
        k = int(r8.integers(max(1, int(0.2 * self.n_e)), max(2, int(0.4 * self.n_e)) + 1))
        idx = r8.choice(self.n_e, size=k, replace=False)
        w = np.zeros(self.n_e)
        w[idx] = r8.uniform(50.0, 150.0, k) * np.where(r8.uniform(size=k) < 0.5, -1.0, 1.0) * g
        self.move.append((t + float(r8.uniform(0.03, 0.12)), float(r8.uniform(0.15, 0.35)), w))

    def _sz_eyelid_myoclonia(self, i, ev, rng):
        """Eyelid myoclonia (Jeavons): eye closure, eyelid flutter at 5-6 Hz on the frontal poles, and a brief
        generalized 3-6 Hz polyspike-and-wave burst starting within 0.5 s of the closure."""
        t0 = float(ev["onset_min"]) * 60.0
        dur = float(ev["duration_s"])
        # r8 (REFERENCE_TARGETS s7: the discharge starts 0.5-2 s after the closure; was 0.2-0.5 s)
        lat = float(rng.uniform(0.5, 1.2))
        f = float(ev["frequency_hz"])
        eye = float(ev.get("eye_uv", 150.0))
        fl_hz = float(rng.uniform(4.5, 6.0))
        self.eye.append(("closure", t0, t0 + lat + dur + 0.5, eye, 0.0))
        # r8 (Craig: start from the phase D version, frontocentral field; "more eyelid/blink artifact"): eyelid jerks
        # from the closure through the whole discharge, cornea-positive Fp deflections at 0.6 x eye_uv decaying to
        # 0.35 x (was a 0.35 x fixed-rate, fixed-height pulse train over 2 s), each with its own interval (CV 0.17) and
        # height (sd 0.25); two ordinary blinks in the seconds around the event and one as the eyes reopen.  Drawn
        # from a separate stream, so ``rng`` keeps its sequence.
        r8 = substream(self.syn.seed, "gen-v3-r8-eyelid", i)
        pulses, tp, t_end = [], t0 + 0.15, t0 + lat + dur + 0.2
        while tp < t_end:
            dec = 0.6 - 0.25 * (tp - t0) / (t_end - t0)
            pulses.append((tp, dec * eye * float(np.exp(r8.normal(0.0, 0.25)))))
            tp += float(np.exp(r8.normal(0.0, 0.17))) / fl_hz
        self.eye.append(("flutter", t0 + 0.15, t_end, 0.6 * eye, fl_hz, pulses))
        for tb in (t0 - float(r8.uniform(1.5, 3.5)), t_end + 0.3 + float(r8.uniform(0.0, 0.3)),
                   t_end + float(r8.uniform(1.5, 3.0))):
            self.eye.append(("blink", tb, tb + 0.4, float(r8.uniform(0.7, 1.0)) * self._closure_blink_uv, 0.0))
        n = self._train8(i, rng, t0 + lat, t0 + lat + dur, 1.05 * f, 0.9 * f, float(ev["amplitude_uv"]), "psw",
                         salt0=i * 1_000_003, j8=dict(ioi_cv=0.12, amp_cv=0.15, morph_cv=0.0, wave_cv=0.15),
                         ps_n=3, wave_gain=2.0, field="fc")
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
        # r5 (generalized-independent: a regular 3.5-Hz train with a uniform field, read as an absence; eeg0066 and
        # PMC8610539 Fig 1B show irregular polyspikes, posterior-predominant): per-cycle rate jitter 0.15 -> 0.30,
        # complex amplitude scatter 0.10 -> 0.25, 2-5 spikes per complex, and the posterior (eyelid-myoclonia) field
        # r8 rebuild (Craig: "should be generalized ~3-Hz spike-wave (photoparoxysmal response), not the current
        # train"): generalized spike-and-wave / polyspike-and-wave on the absence field (frontal maximum, every chain),
        # at the authored 3-4 Hz and NOT locked to the flashes, slowing a little across the run, with the r8
        # whole-head jitter (interval CV 0.10, 40 % of complexes double-spiked)
        n = self._train8(i, rng, t0 + lat, t0 + stim + out, 1.08 * f, 0.92 * f, float(ev["amplitude_uv"]), "sw",
                         salt0=i * 1_000_003, j8=dict(ioi_cv=0.10, amp_cv=0.15, morph_cv=0.12, wave_cv=0.12,
                                                      p_double=0.4),
                         asym_amt=0.12, jitter=0.10)
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
    #: r8: fraction of the scheduled GPFA bursts dropped in N3 (REFERENCE_TARGETS s5: 0-1 per 15-s page)
    _GPFA_N3_DROP = 0.5

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
        # independent re-review (JME, 4-6-Hz-spike-and-waves-with-JME): every chain carries the polyspike-and-wave
        # (generalized field; the frontocentral table left the temporal chains at 0.09-0.14 of Fz-Cz), and at >= 4 Hz a
        # complex has 1-2 spikes 35-60 ms apart (2-4 spikes at ~72 ms filled the 213-ms cycle and read as a fast rhythm)
        jme = ((2, (1, 2), (0.045, 0.035, 0.060)) if f >= 4.0 else (3, (2, 4), (0.072, 0.045, 0.130)))
        L = self._BLOCK_S
        for blk in range(int(np.ceil((b - a) / L))):
            rng = substream(self.syn.seed, "gen-v3-dis", i, blk)
            m = int(np.floor(rate_h * L / 3600.0 + rng.uniform()))
            times = np.sort(rng.uniform(0.0, L, m)) + a + blk * L
            last = -np.inf
            for k, t0 in enumerate(times):
                d = float(np.clip(med * np.exp(rng.normal(0.0, 0.45)), *clip))
                fb = f * float(np.exp(rng.normal(0.0, 0.08)))
                ab = amp * float(np.exp(rng.normal(0.0, 0.15)))
                if t0 < a or t0 + d > b:
                    continue
                if kind == "ssw":
                    if t0 < last + 0.5:
                        continue            # r8: overlapping runs doubled the complex rate (draws already made)
                    last = t0 + d
                    # r8 (Craig: LGS slow spike-wave "frequency and morphology wrong: needs a clearer spike/sharp-and-
                    # slow-wave complex"): the sharp-and-slow-wave kernel, 1.5-2.5 Hz, irregular, frontal
                    n = self._train8(i, rng, t0, t0 + d, fb * 1.05, fb * 0.95, ab, kind,
                                     salt0=(i * 1009 + blk) * 100_003 + k * 97, j8=self._J8_SSW, ramp_s=0.8,
                                     asym_amt=0.2, side=side, x8=dict(k="ssw8", span=1.3), field="gen")
                    self._row("generalized_discharge", i, t0 - 0.03, t0 + d, pattern=pat, frequency_hz=round(fb, 3),
                              amplitude_uv=round(ab, 1), n_complexes=n)
                    continue
                n = self._train(i, rng, t0, t0 + d, fb * 1.05, fb * 0.95, ab, kind,
                                salt0=(i * 1009 + blk) * 100_003 + k * 97,
                                jitter_f=0.12 if kind == "ssw" else 0.05, ps_n=jme[0] if kind == "psw" else 0,
                                ps_range=jme[1], ps_isi=jme[2],
                                ramp_s=0.8 if kind == "ssw" else 0.0, asym_amt=0.15 if kind == "ssw" else 0.08,
                                side=side, wave_gain=2.0 if kind == "psw" else 1.3,
                                field="gen")
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
                # r8 (Craig: "between phase D and current"; frequency too regular, morphology identical each cycle):
                # the kernel half-way between the phase D Gaussian wave and the current dome, AR(1) interval CV 0.12
                # with a +-4 % glide per run, per-cycle spike width 1.5 x (sd 0.15, 1.1-2.1), slow-wave gain sd 0.12,
                # spike height sd 0.18, 10 % double spikes, asymmetry +-0.2 (audit, REFERENCE_TARGETS s8).  Salt
                # stride 1000 per run (the old 131 repeated salts inside long runs).
                n = self._train8(i, rng, t, t + run, 1.04 * fr, 0.96 * fr, amp * float(np.exp(rng.normal(0.0, 0.1))),
                                 "sw", salt0=(i * 7919 + int(round(x0 * 10))) * 100_003 + k * 1000,
                                 j8=dict(ioi_cv=0.12, amp_cv=0.12, morph_cv=0.15, wave_cv=0.12, spk_cv=0.18,
                                         p_double=0.10, w0=1.5, width_lim=(0.73, 1.4)),
                                 x8=dict(k="sw_blend", blend=0.5), field="eses", side=side, asym_amt=0.2, lead=0.006)
                self._row("generalized_discharge", i, t - 0.03, t + run, pattern="eses",
                          stage=self._stage_label(t + 0.5 * run), frequency_hz=round(fr, 3), n_complexes=n)
                gap = run * (1.0 - c) / c * float(np.exp(rng.normal(0.0, 0.4)))
                t += run + max(gap, 0.3)
                k += 1

    def _gpfa_sleep(self, i, ev, a, b, amp, side):
        """LGS generalized paroxysmal fast activity in NREM sleep: 0.5-6 s (default median 1.5 s) bursts of 15-25 Hz, frontally
        predominant, abrupt onset, no EMG; ``rate_per_h`` applies inside the merged N2/N3 windows only
        (``Synthesizer.stage_intervals``), none awake or in REM.

        Independent re-review: 12-19 Hz with per-electrode waxing-waning read as a sleep spindle, and in N3 the bursts
        were only 1.5x the delta.  Now ~20 Hz (15-25), monomorphic and in phase across electrodes (no amplitude
        modulation or frequency scatter, phase scatter 0.05 rad, bifrontal field), 0.05-s onset, the background
        attenuated under the burst (tonic-seizure-ii onset, ILAE LGS: abrupt, monomorphic, with attenuation)."""
        rate_h = float(ev["rate_per_h"])
        f = float(ev.get("frequency_hz") or 20.0)
        med = float(ev.get("burst_s") or 1.5)
        for x0, x1, _grp in self._stage_groups(a, b, (("N2", "N3"),)):
            # a Poisson walk forward from the window start (the gaps from one stream, each burst from its own keyed
            # stream), so a page synthesizer whose horizon cuts the window sees the same bursts as the whole record
            key = int(round(x0 * 10))
            walk = substream(self.syn.seed, "gen-v3-gpfa", i, key)
            t0, last, k = x0, -np.inf, 0
            while True:
                t0 += float(walk.exponential(3600.0 / rate_h))
                if t0 >= x1:
                    break
                rng = substream(self.syn.seed, "gen-v3-gpfa-burst", i, key, k)
                k += 1
                d = float(np.clip(med * np.exp(rng.normal(0.0, 0.45)), 0.5, 6.0))
                if t0 + d > x1 or t0 < last + 1.0:
                    continue            # overlapping bursts beat against each other (waxing-waning): one at a time
                # r8 (Craig: N3 "bursts may be too frequent"): half the N2 rate in N3 (the walk is unchanged)
                if rng.uniform() < self._GPFA_N3_DROP and self._stage_label(t0 + 0.5 * d) == "N3":
                    continue
                last = t0 + d
                fb = float(np.clip(f * np.exp(rng.normal(0.0, 0.15)), 15.0, 25.0))
                ab = amp * float(np.exp(rng.normal(0.0, 0.30)))      # r8: burst-to-burst sd 0.30 (was 0.15)
                # r8 (Craig: less spindle-like than phase D, somewhat more abrupt onset / offset, much more frequency
                # and amplitude jitter, some evolution): in phase across the head as in r5, but a whole-head frequency
                # wander +-10 % (0.5-2 Hz) on a 1.12 -> 0.88 glide, per-cycle height scatter +-40 % (jagged; a 1-4 Hz
                # common modulation instead beaded the burst into spindle-like packets) and a slow 0.15 modulation on
                # a 0.75 -> 1.0 crescendo, a varying second harmonic, 25-ms onset and 80-ms offset
                self._add_gpfa(i, rng, t0, t0 + d, fb * 1.12, fb * 0.88, 0.75 * ab, ab, ramp=0.025, side=side,
                               am=0.0, df_sd=0.0, dphi=0.05, field="gpfa", off_s=0.08,
                               w8=dict(wander=0.10, nu=(0.5, 2.0), cam=0.15, mu=(0.3, 1.0), cyc=0.4, harm=0.6,
                                       hemi=0.06))
                self.bg.append((t0, t0 + d, 0.75, 0.03, 0.15))
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
        env = env * np.clip(tt / g["ramp"], 0.0, 1.0) * (1.0 - np.clip((tt - dur) / g["off_s"], 0.0, 1.0))
        w8 = g.get("w8")
        h2 = 0.25
        if w8 is not None:
            # r8 whole-head wander: a phase modulation whose derivative is the frequency deviation (a pure function of
            # time since onset), a common amplitude modulation and a slowly varying second harmonic
            fbar = math.sqrt(f0 * f1)
            arg = 2 * np.pi * w8["nu"][:, None] * tt[None, :] + w8["nu_p"][:, None]
            dev = (w8["dfr"][:, None] * np.cos(arg)).sum(0)
            ph = ph + fbar * (w8["dfr"][:, None] / w8["nu"][:, None]
                              * (np.sin(arg) - np.sin(w8["nu_p"])[:, None])).sum(0)
            fi = fi * (1.0 + dev)
            cm = 1.0 + (w8["cam"][:, None] * np.sin(2 * np.pi * w8["mu"][:, None] * tt[None, :]
                                                     + w8["mu_p"][:, None])).sum(0)
            env = env * np.clip(cm, 0.15, None)
            if w8["cyc"] > 0:
                # per-cycle height of the fast rhythm (keyed by the absolute cycle, smoothed across the cycle): a
                # jagged, irregular burst rather than a modulation envelope
                cyc = ph / (2 * np.pi)
                kf = np.floor(cyc)
                a_ = 2.0 * _cnoise(kf, w8["salt"]) - 1.0
                b_ = 2.0 * _cnoise(kf + 1.0, w8["salt"]) - 1.0
                x_ = cyc - kf
                env = env * (1.0 + w8["cyc"] * (a_ + (b_ - a_) * x_ * x_ * (3.0 - 2.0 * x_)))
            h2 = 0.25 * (1.0 + w8["harm"] * np.sin(2 * np.pi * w8["eta"] * tt + w8["eta_p"]))[None, :]
        _, wf = self._field(g["field"], g["side"])
        lag = g["lead"] * self.front
        P = (ph[None, :] - 2 * np.pi * fi[None, :] * lag[:, None] + g["dphi"][:, None]
             + 2 * np.pi * g["df"][:, None] * tt[None, :])
        am = 1.0 + g["am"] * np.sin(2 * np.pi * g["am_f"][:, None] * tt[None, :] + g["am_p"][:, None])
        if w8 is not None:
            am = am * w8["hemi"][:, None]
        wave = (np.sin(P) + h2 * np.sin(2 * P + g["psi"])) * am
        key = (("gpfa", g["side"], round(g["lead"], 5)) if g["field"] == "gen"
               else ("gpfa", g["field"], g["side"], round(g["lead"], 5), tuple(np.round(g["dphi"], 5))))
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
        gain_gtc = np.zeros(t.size)
        for e0, e1, p2p, rise, fall, kind in self.emg:
            if e1 + fall * 3 < t[0] or e0 > t[-1]:
                continue
            sh = np.clip((t - e0) / max(rise, 1e-3), 0.0, 1.0) * np.clip(1.0 - (t - e1) / max(fall, 1e-3), 0.0, 1.0)
            if kind.startswith("gtc_"):
                gain_gtc = np.maximum(gain_gtc, sh * p2p)
            else:
                gain = np.maximum(gain, sh * p2p)
        if not gain.any() and not gain_gtc.any():
            return None
        n = t.size
        noise = self.syn._oa(self.syn.st_muscle, i0 + self.EMG_OFFSET, n, self.n_e)
        # independent realizations of unit RMS; a bipolar pair of them runs about 6 x sqrt(2) RMS peak-to-peak in 1 s
        if not gain_gtc.any():
            return noise * self.emg_field[:, None] * (gain / (6.0 * math.sqrt(2.0)))[None, :]
        return noise * (self.emg_field[:, None] * gain[None, :]
                        + self.emg_field_gtc[:, None] * gain_gtc[None, :]) / (6.0 * math.sqrt(2.0))

    def _move_rows(self, t: np.ndarray) -> Optional[np.ndarray]:
        out = None
        for tm, sg, w in self.move:
            if tm + 4 * sg < t[0] or tm - 4 * sg > t[-1]:
                continue
            x = (t - tm) / sg
            r = w[:, None] * (np.exp(-0.5 * x ** 2) * (np.abs(x) < 4.0))[None, :]
            out = r if out is None else out + r
        return out

    def emg_channel(self, t: np.ndarray, i0: int) -> Optional[np.ndarray]:
        """Polygraphic EMG row (uV) for records with an atonic / myoclonic-atonic / myoclonic-tonic / tonic seizure:
        resting tone x ``emg_factor`` (the atonic silent period) plus the scheduled EMG bursts and tonic EMG; a pure
        function of absolute time (``i0`` = sample index of ``t[0]``)."""
        if not self.emg_row or t.size == 0:
            return None
        rms = self.EMG_ROW_REST_UV * self.emg_factor(t)
        for e0, e1, p2p, rise, fall, _kind in self.emg:
            if e1 + fall * 3 < t[0] or e0 > t[-1]:
                continue
            rms = np.maximum(rms, self._shape(t, e0, e1, rise, fall) * p2p / 6.0)
        return self.syn._oa(self.syn.st_muscle, i0 + self.EMG_ROW_OFFSET, t.size, 1)[0] * rms

    def _eye_rows(self, t: np.ndarray) -> Optional[np.ndarray]:
        if not self.eye:
            return None
        prof = np.zeros(t.size)
        for kind, e0, e1, amp, f, *pulses in self.eye:
            if e1 + 1.0 < t[0] or e0 > t[-1]:
                continue
            d = t - e0
            if pulses:
                # r8 eyelid jerks: one cornea-positive lid deflection per jerk (rise 30 / fall 55 ms)
                for tp, ap in pulses[0]:
                    if tp - 0.2 < t[-1] and tp + 0.4 > t[0]:
                        prof += ap * _g(t - tp, 0.030, 0.055)
                continue
            if kind == "blink":
                prof += amp * self.syn._blink_profile(t, np.array([e0]))
                continue
            if kind == "closure":
                # lids close in ~0.25 s, the eyes roll up (cornea-positive at Fp) and stay until reopening
                prof += amp * np.clip(d / 0.25, 0.0, 1.0) * np.clip(1.0 - (t - e1) / 0.3, 0.0, 1.0)
                # r5 (generalized-independent: the closure was ~5 mm at 15 uV/mm; PMC8610539 Fig 1E/F and PMC12593124
                # Fig 2 show a large closure transient): the lid closure itself is a blink-sized cornea-positive
                # deflection (the nominal v3 blink shape at 0.8 x the record's blink amplitude) before the sustained
                # shift; with the shift it peaks at about 1.0-1.4 x a nominal blink on Fp1-F3
                prof += 0.8 * self._closure_blink_uv * self.syn._blink_profile(t, np.array([e0]))
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
        for extra in ((self.emg_rows(t, i0), self._eye_rows(t), self._photic_rows(t), self._move_rows(t))
                      if extras else ()):
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
