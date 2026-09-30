"""0.5.0 phase D (spec_version 3): ACNS 2021 critical-care rhythmic and periodic patterns.

Review: research/eeg-atlas/feature-review-20260926/acns-review.md.  Before this module the generator accepted
``sharpness``, ``"triphasic"``, ``+R``, ``evolving`` and ``SIRPIDs`` and ignored them; ``BIRDs`` went down the
bilateral-independent (BIPD) path; ``+F`` was a 9x harmonic of the repetition rate; a ``stimulation`` could only raise
amplitude and beta.

Definitions implemented (Hirsch et al., J Clin Neurophysiol 2021;38:1-29, PMC8135051):
* SI-: pattern reproducibly brought about by an alerting stimulus -> runs are scheduled after each ``stimulation``.
* Evolving: >= 2 consecutive frequency changes in the same direction by >= 0.5 Hz, each level >= 3 cycles; an RPP
  that evolves for >= 10 s is an electrographic seizure (criterion B).  Fluctuating: >= 3 changes <= 1 min apart
  (by >= 0.5 Hz) not qualifying as evolving.  Voltage change alone is neither.
* ESz criterion A: epileptiform discharges averaging > 2.5 Hz for >= 10 s.  IIC: PD/SW > 1 and <= 2.5 Hz; PD/SW
  0.5-1 Hz with a plus modifier or fluctuation; lateralized RDA > 1 Hz with a plus modifier or fluctuation.
* BIRDs: focal or generalized rhythmic activity > 4 Hz, >= 6 waves, 0.5 to < 10 s; definite if evolving,
  possible if only sharply contoured.
* Plus: +F (theta or faster, PDs or RDA), +R (rhythmic delta not time-locked, PDs only), +S (sharp waves, RDA only);
  +FR / +FS allowed.  EDB: abundant or continuous RDA+F with the fast activity stereotyped to the delta wave.
* Triphasic morphology: negative-positive-negative, each phase longer than the one before, phase 2 the largest;
  PDs/SW only.  A-P (or P-A) lag: > 100 ms from the most anterior to the most posterior derivation.
* Sharpness of the dominant phase measured at the EEG baseline: spiky < 70 ms, sharp 70-200 ms, sharply contoured,
  blunt.
* Prevalence continuous >= 90 / abundant 50-89 / frequent 10-49 / occasional 1-9 / rare < 1 %; duration very long
  >= 1 h / long 10-59 min / intermediate 1-9.9 min / brief 10-59 s / very brief < 10 s.

Everything is drawn once per record (``substream(seed, "rpp3", event index, ...)``); the row builders are pure
functions of absolute time, so any window of the record sees the same discharges.  Sign convention: generator values
are surface potentials (positive = surface-positive); the page draws negative-up.
"""
from __future__ import annotations

import math
from typing import Dict, List, Optional, Tuple

import numpy as np

from . import montage as mt
from .rng import substream

#: sharpness -> width multiplier of the discharge's dominant (sharp) phase; measured on the displayed bipolar
#: signal (tests/test_r050_acns.py): spiky < 70 ms at baseline, sharp 70-200 ms, contoured / blunt wider
#: r050-fix-acns: spiky 0.42 -> 0.22 (acns-independent.md: 74 ms at referential T3 after the page chain; a
#: small lead-in from the neighbouring generators' lag counts toward the baseline width, so 0.28 still measured 70)
SHARPNESS_WIDTH = {"spiky": 0.22, "sharp": 1.0, "sharply_contoured": 2.0, "blunt": 3.4}
SHARPNESS_ALIASES = {"sharply contoured": "sharply_contoured", "sharply-contoured": "sharply_contoured",
                     "spike": "spiky", "sharp_wave": "sharp", "smooth": "blunt"}
PREVALENCE = {"continuous": 0.95, "abundant": 0.70, "frequent": 0.30, "occasional": 0.05, "rare": 0.006}
DURATION_RANGE = {"very_brief": (3.0, 9.0), "brief": (10.0, 59.0), "intermediate": (60.0, 590.0),
                  "long": (600.0, 3540.0), "very_long": (3600.0, 7200.0)}
STIMULI = ["auditory", "light_tactile", "patient_care", "noxious", "suction", "sternal_rub", "nailbed_pressure",
           "nostril_tickle", "trapezius_squeeze", "other"]
RESPONSES = ["increase", "attenuation", "paradoxical", "none"]

#: 0.5.0 phase D: frontally predominant field of a generalized RPP (peak 1.0).  epileptiform-v3.md (C26): the flat
#: GENERALIZED_FIELD reached the bipolar chain only through inter-electrode lag (GPDs 20-30 uV on the page, a quarter
#: of the references' dominance: gpds-ty, triphasic-gpds, ncse-gpds, gpds-plus-f).  A real A-P gradient survives it.
#: A monotonic anterior-to-posterior decline: a flat Fp=F plateau cancelled Fp1-F3 (0.3x background on the first
#: render) and an Fp < F dip put a false phase reversal at F3/F4.
FIELD_FRONTAL = {"Fp1": 1.00, "Fp2": 1.00, "F7": 0.76, "F3": 0.85, "Fz": 0.85, "F4": 0.85, "F8": 0.76,
                 "T3": 0.45, "C3": 0.55, "Cz": 0.57, "C4": 0.55, "T4": 0.45,
                 "T5": 0.28, "P3": 0.32, "Pz": 0.32, "P4": 0.32, "T6": 0.28, "O1": 0.18, "O2": 0.18}
#: amplitude_uv of a generalized RPP means the ACNS voltage: the discharge in the longitudinal-bipolar channel where it
#: is most readily appreciated.  DISPLAY_CAL (4.4 periodic / 2.9 rda) was measured on focal LPD/LRDA, whose field
#: survives the chain; a generalized field loses more.  Measured delivered/requested on the max derivation with
#: FIELD_FRONTAL (renders/phaseD/acns/measure.py): the correction below brings it back to about 1.0.
# merge with the generalized family (its per-electrode GPD discharge raised the bipolar peak 1.26x): periodic 3.4 -> 2.7
GEN_BIPOLAR_GAIN = {"periodic": 2.7, "periodic_lag": 2.05, "rda": 4.45, "ictal": 3.0}
#: r050-fix-acns (acns-independent.md: an 80-uV LRDA request displayed 30 uV p-p, 0.85x the background; LPDs 58-70 uV
#: for 100): amplitude_uv of a LATERALIZED (and midline) v3 RPP is also the p-p on its maximal longitudinal-bipolar
#: derivation, as GEN_BIPOLAR_GAIN does for generalized ones.  1 / (delivered / requested) measured per region type
#: (left side, 3 seeds, phase-B and phase-D paths averaged; renders/phaseB/fix-acns/calib_lat.py), sawtooth RDA.
LAT_BIPOLAR_GAIN = {
    "rda": {"temporal": 2.17, "frontal": 1.56, "central": 2.43, "parietal": 2.0, "occipital": 2.17,
            "hemisphere": 1.67, "mesial_temporal": 2.22, "midline": 2.54},
    "periodic": {"temporal": 1.32, "frontal": 1.30, "central": 1.49, "parietal": 1.60, "occipital": 1.45,
                 "hemisphere": 1.13, "mesial_temporal": 1.57, "midline": 1.56},
}


#: r050-fix-r5-seizures: lateralized RDA+F (continuous carrier) delta correction, 1 / 0.84 (the +F delta below 5 Hz
#: against the plain LRDA's on T3-T5, seeds 771203 / 5150 / 90210, four runs each; lrda_probe2.py)
RDA_PLUS_F_GAIN = 1.19


def lateral_bipolar_gain(morph: str, region: str) -> float:
    tab = LAT_BIPOLAR_GAIN.get(morph)
    if tab is None:
        return 1.0
    base = region.split("_", 1)[1] if region.startswith(("left_", "right_")) else region
    return tab.get(base, tab["temporal"])


#: r9 (gallery-20260929 trd-lpds-vs-seizure): per-cycle phase warp of a lateralized v3 PD train, in cycles (interval CV
#: about 0.8x this), as r8 gave GPDs (synth._GPD_WARP).  The train had amplitude and width scatter but metronomic
#: intervals; with the realized rate now at the authored 1.0 Hz (fundamental inside the 1-4 Hz band of the heuristic
#: seizure trend's slow-rhythmic term) that perfect comb drove seizure probability to 0.8-1.
LPD_WARP = 0.10

#: r050-fix-acns: generator-lag spread that makes the measured Fp1 -> O1 cross-correlation lag equal lag_ms
LAG_FIELD_GAIN = 1.27
_FLIP = {"Fp1": "O1", "Fp2": "O2", "F7": "T5", "F8": "T6", "F3": "P3", "F4": "P4", "Fz": "Pz"}
_FLIP.update({v: k for k, v in list(_FLIP.items())})
FIELD_OCCIPITAL = {e: FIELD_FRONTAL[_FLIP.get(e, e)] for e in FIELD_FRONTAL}
#: r9 (gallery-20260929 acn-grda-frontal / acn-grda-occipital: frontal GRDA read largest in F3-C3 / Fz-Cz, occipital
#: GRDA centroparietal): an in-phase field shows on a longitudinal-bipolar link as the DIFFERENCE of its two ends, so
#: FIELD_FRONTAL's shallow Fp 1.0 -> F 0.85 step put the smallest frontal voltage in Fp1-F3 and the largest in F-C.
#: Rhythmic delta has no discharge-level lag to rescue it, so GRDA gets a field whose steepest step is Fp -> F (and
#: O -> P for the occipital mirror): halving per row keeps the maximum in the Fp-F (P-O) links, still monotonic (no
#: false phase reversal), with Fp / O the referential maximum.  GPDs keep FIELD_FRONTAL.
FIELD_FRONTAL_RDA = {"Fp1": 1.00, "Fp2": 1.00, "F7": 0.50, "F3": 0.52, "Fz": 0.52, "F4": 0.52, "F8": 0.50,
                     "T3": 0.26, "C3": 0.27, "Cz": 0.28, "C4": 0.27, "T4": 0.26,
                     "T5": 0.13, "P3": 0.13, "Pz": 0.14, "P4": 0.13, "T6": 0.13, "O1": 0.07, "O2": 0.07}
FIELD_OCCIPITAL_RDA = {e: FIELD_FRONTAL_RDA[_FLIP.get(e, e)] for e in FIELD_FRONTAL_RDA}
#: r9: GRDA on the steep fields above: 1 / (delivered / requested) on the max longitudinal-bipolar link (2-Hz frontal and
#: 3-Hz occipital, 3 seeds, ICU background; replaces GEN_BIPOLAR_GAIN["rda"] for them)
GEN_RDA_BIPOLAR_GAIN = {"frontal": 3.08, "occipital": 3.12}


#: r050-fix-acns: the ACNS 2021 rate cutoffs the key classifies on (PDs 0.5-1 Hz with a plus / fluctuation = IIC,
#: > 1 and <= 2.5 Hz = IIC, > 2.5 Hz = ESz A; lateralized RDA > 1 Hz with a plus = IIC).  Bins are [lo, hi] with the
#: cutoff value belonging to the lower bin, as the classifier reads it.  The 0.5-Hz floor is the ACNS band edge,
#: which the band clip already holds.
RATE_CUTOFFS = (1.0, 2.5)


#: r9 (gallery-20260929 global: realized LPD rates 0.75-0.9 Hz for 1.0 authored): spec_version 3 run-to-run rate
#: jitter SD cap (fraction of the rate).  The default rate_jitter 0.10 was drawn once for a continuous single run
#: (0.78 Hz for the whole record), and at an authored rate ON a cutoff (1.0, 2.5 Hz) keep_rate_side folds every upward
#: draw down, so the runs averaged 0.92x.  At 0.05 the folded mean stays within 4 % and a single run keeps f0.
RATE_JITTER_MAX = 0.05
#: r9: v3 BIPD / BIRDA per-side rate multipliers (were 0.88 / 1.12: at 1.0 Hz keep_rate_side folded 1.12 onto 0.88, so
#: both "independent" clocks ran at 0.88 Hz); shifted as a pair into the authored ACNS bin by pair_muls
BIPD_RATE_MUL = (0.96, 1.04)


def rate_bin(f0: float) -> Tuple[float, float]:
    """(lowest, highest) rate of the ACNS bin holding ``f0``; a cutoff belongs to the lower bin."""
    lo, hi = -math.inf, math.inf
    for c in RATE_CUTOFFS:
        if f0 <= c:
            hi = c
            break
        lo = c
    return (lo + 1e-3 if math.isfinite(lo) else lo), hi


def pair_muls(f0: float, muls: Tuple[float, ...]) -> Tuple[float, ...]:
    """Rate multipliers ``muls`` shifted together so every side stays in the authored ACNS bin, spacing kept."""
    lo, hi = rate_bin(f0)
    a, b = f0 * min(muls), f0 * max(muls)
    off = hi - b if b > hi else (lo - a if a < lo else 0.0)
    return tuple((f0 * m + off) / f0 for m in muls)


def keep_rate_side(f0: float, f: float) -> float:
    """Keep a jittered run rate ``f`` in the ACNS rate bin of the authored rate ``f0`` (acns-independent.md: authored
    2.5-Hz GPDs keyed ESz in 6 of 18 runs, 1.0-Hz LPDs keyed IIC in 6 of 18).  A draw across a cutoff is mirrored
    back about it, then clipped, so the runs keep their spread on the authored side."""
    lo_in, hi = rate_bin(f0)
    if f > hi:
        f = 2.0 * hi - f
    elif f < lo_in:
        f = 2.0 * lo_in - f
    return float(min(max(f, lo_in), hi))


def sharpness_key(val) -> Optional[str]:
    if val in (None, ""):
        return None
    v = str(val).strip().lower()
    v = SHARPNESS_ALIASES.get(v, v)
    return v if v in SHARPNESS_WIDTH else None


def parse_plus(plus: str) -> Tuple[bool, bool, bool]:
    """(+F, +R, +S) from an ACNS plus string ("+F", "+R", "+S", "+FR", "+FS", "fast", ...)."""
    p = str(plus or "").lower().replace(" ", "")
    f = "+f" in p or "fast" in p
    r = "+r" in p or "fr" in p.replace("+f", "f") or "rhythm" in p
    s = "+s" in p or "fs" in p.replace("+f", "f") or "sharp" in p
    return f, r, s


def is_triphasic(ev: Dict) -> bool:
    return (str(ev.get("pattern") or "").lower() == "triphasic"
            or "triphasic" in str(ev.get("modifier") or "").lower())


def wants_v3(ev: Dict) -> bool:
    """True when a rhythmic_pattern uses any phase-D feature (otherwise the phase-B path is kept unchanged)."""
    pat = str(ev.get("pattern") or "").upper()
    mod = str(ev.get("modifier") or "").lower()
    f, r, s = parse_plus(ev.get("plus_modifier"))
    return bool(pat in ("BIRDS", "EDB", "SIRPIDS", "TRIPHASIC") or ev.get("stimulus_induced")
                or "evolv" in mod or "fluctuat" in mod or "triphasic" in mod or isinstance(ev.get("evolution"), dict)
                or f or r or (s and ev.get("periodic")) or sharpness_key(ev.get("sharpness"))
                or ev.get("lag") not in (None, "none") or ev.get("prevalence") or ev.get("duration_category"))
    # r7: polarity no longer selects this path; both paths render it (resolve_polarity), so an authored polarity equal
    # to the default draws the same record as an omitted one


def main_term(ev: Dict) -> str:
    """ACNS main term 1 + 2 for the key (e.g. GPDs, LRDA, BIPDs, BIRDs, EDB)."""
    pat = str(ev.get("pattern") or "").upper()
    if pat == "BIRDS":
        return "BIRDs"
    if pat == "EDB":
        return "EDB"
    region = str(ev.get("onset_region") or "")
    if pat.startswith(("BIPD", "BIRDA")):
        return "BIPDs" if ev.get("periodic") else "BIRDA"
    loc = "G" if region == "generalized" else ("L" if region != "midline" else "G")
    return f"{loc}PDs" if ev.get("periodic") else f"{loc}RDA"


# ----------------------------------------------------------------- polarity --
# r7 (Craig; ACNS 2021 polarity = the dominant, highest-voltage phase, judged on a referential montage): "on
# referential the polarity is usually upward deflections with the maximum amplitude at the source" - surface-negative
# on the negative-up page - "though you can have some that have a dipole or phase reverse" (SeLECTS).  The kernels
# are surface-positive, so the default flips them.  Triphasic morphology is defined by its dominant POSITIVE phase 2
# and keeps it.  A dipole is tangential: the negative maximum at the source and a positive pole at a distinct
# electrode, DIPOLE_RATIO of the source's peak, so a referential page shows opposite deflections at the two poles.

#: positive pole of a dipole PD: frontopolar for a temporal / central / parietal / occipital / hemispheric source,
#: occipital for a frontal source, parietal midline for a generalized (frontally predominant) field
DIPOLE_POLE = {"left": ("Fp1", "O1"), "right": ("Fp2", "O2")}
DIPOLE_RATIO = 0.6


def default_polarity(ev: Dict) -> str:
    return "surface_positive" if is_triphasic(ev) else "surface_negative"


def resolve_polarity(ev: Dict, version: int) -> Optional[str]:
    """Polarity a periodic rhythmic_pattern renders with at ``version`` (None: RDA, or below spec_version 3)."""
    if version < 3 or not ev.get("periodic"):
        return None
    return str(ev.get("polarity") or default_polarity(ev))


def dipole_pole(region: str, electrodes) -> Optional[str]:
    side = "left" if region.startswith("left") else ("right" if region.startswith("right") else None)
    if side is None:
        pole = "Pz"
    else:
        pole = DIPOLE_POLE[side][1 if region.endswith("_frontal") else 0]
    return pole if pole in electrodes else None


def dipole_fields(syn, region: str, wsum: np.ndarray) -> Optional[Tuple[int, np.ndarray]]:
    """(source electrode index, positive-pole field peaking at 1) of a dipole run; a pure function of the region."""
    pole = dipole_pole(region, syn.electrodes)
    if pole is None:
        return None
    w = mt.monopole_weights(pole, syn.electrodes, falloff=mt.DEFAULT_FALLOFF, leak=0.0)
    field = np.array([w[e] for e in syn.electrodes])
    src = int(np.argmax(np.abs(wsum) * (field < 0.2)))
    return src, field


def apply_polarity(polarity: Optional[str], wv: np.ndarray) -> np.ndarray:
    """Sign of the surface-positive discharge kernel for ``polarity``."""
    return -wv if polarity in ("surface_negative", "dipole") else wv


def add_dipole_pole(syn, region: str, wsum: np.ndarray, onset: np.ndarray) -> np.ndarray:
    """The positive pole of a dipole run: -DIPOLE_RATIO x the source electrode's own (negative-dominant) trace."""
    df = dipole_fields(syn, region, wsum)
    if df is None:
        return onset
    src, field = df
    return onset + field[:, None] * (-DIPOLE_RATIO * onset[src])[None, :]


# ------------------------------------------------------------------ kernels --

def tri_kernel(tau: np.ndarray, width: float | np.ndarray = 1.0) -> np.ndarray:
    """Triphasic discharge, ``tau`` seconds from the phase-2 (positive) peak; surface potential.

    Phase 1 small negative (~50 ms), phase 2 dominant positive (~120 ms, blunt), phase 3 slower negative (~250 ms):
    each phase longer than the previous and phase 2 the largest (ACNS 2021 minor modifier; triphasic-gpds,
    periodic-triphasics: blunt 1.5-2 Hz complexes).
    """
    w = width
    p1 = -0.32 * np.exp(-0.5 * ((tau + 0.070 * w) / (0.020 * w)) ** 2)
    p2 = np.exp(-0.5 * (tau / np.where(tau < 0.0, 0.030 * w, 0.048 * w)) ** 2)
    p3 = -0.50 * np.exp(-0.5 * ((tau - 0.175 * w) / (0.080 * w)) ** 2)
    return p1 + p2 + p3


def _std_kernel(tau, width):
    from .synth import _pd_kernel
    return _pd_kernel(tau, width)


def _blunt_kernel(tau, width):
    """Blunt (smooth, near-sinusoidal) discharge: a symmetric rounded wave with a shallow after-going trough.

    r9 (gallery-20260929 acn-lpds-blunt: at 1 Hz the 0.7-s complex left no interval and read as LRDA): the wave
    narrows to sigma 66 ms (dominant phase still > 200 ms at the baseline) and the trough follows closer, so the
    complex is over in about 0.45 s and the rest of the cycle is flat - blunt, but periodic."""
    s = 0.066 * width
    return np.exp(-0.5 * (tau / s) ** 2) - 0.30 * np.exp(-0.5 * ((tau - 2.3 * s) / (1.2 * s)) ** 2)


#: r9 (gallery-20260929 acn-lpds-spiky: needle doublets / triplets with little after-going slow wave): a spiky LPD is
#: ONE narrow spike per cycle (rise 13 / fall 20 ms: < 70 ms at the baseline on the page), a small opposite lead-in and
#: dip, and a clear after-going slow wave (0.9 of the raw spike, about half of it on the page; 80 ms sigma, peaking
#: 220 ms after it).  The standard kernel at
#: width 0.22 kept its 0.42 slow wave for a 1/4.5-width spike, and the region's generator offsets (+/-50 ms) split
#: the needle into two or three.
_SPIKY = dict(pre_lag=0.025, pre_sigma=0.010, pre_gain=0.12, rise=0.013, fall=0.020,
              dip_lag=0.040, dip_sigma=0.018, dip_gain=0.45, wave_lag=0.220, wave_sigma=0.080, wave_gain=0.90)


def _spiky_kernel(tau, width):
    k = _SPIKY
    sig = np.where(tau < 0.0, k["rise"], k["fall"]) * width
    return (np.exp(-0.5 * (tau / sig) ** 2)
            - k["pre_gain"] * np.exp(-0.5 * ((tau + k["pre_lag"] * width) / (k["pre_sigma"] * width)) ** 2)
            - k["dip_gain"] * np.exp(-0.5 * ((tau - k["dip_lag"] * width) / (k["dip_sigma"] * width)) ** 2)
            + k["wave_gain"] * np.exp(-0.5 * ((tau - k["wave_lag"]) / k["wave_sigma"]) ** 2))


#: r9: fraction of the phase-B generator offset (0.5 s per offset cycle, up to +/-50 ms) a v3 periodic run without an
#: authored lag keeps, by kernel shape: a 30-ms spike must not be split into one needle per generator
GEN_OFFSET_FRAC = {"spiky": 0.2}
#: r9: 1 / (delivered / requested) on the max bipolar link of the spiky / blunt kernels (sharp: 1.02 with
#: LAT_BIPOLAR_GAIN alone; 3 seeds, left temporal 1 Hz, ICU background)
SHAPE_GAIN = {"spiky": 1.37, "blunt": 1.43}


_KERNELS = {"standard": _std_kernel, "triphasic": tri_kernel, "blunt": _blunt_kernel, "spiky": _spiky_kernel}
_NORM: Dict[Tuple[str, float], Tuple[float, float]] = {}


def _kernel_norm(shape: str, width: float) -> Tuple[float, float]:
    """(area in s, peak-to-peak) of one discharge; cached, a pure function of the shape (partition-independent)."""
    key = (shape, round(float(width), 4))
    if key not in _NORM:
        tau = np.linspace(-1.5, 2.5, 16001)
        k = _KERNELS[shape](tau, width)
        _NORM[key] = (float(np.sum(k) * (tau[1] - tau[0])), float(np.ptp(k)) or 1.0)
    return _NORM[key]


def discharge_train(phase: np.ndarray, f_inst: np.ndarray, shape: str, width: float, salt: int) -> np.ndarray:
    """PD train normalized like the phase-B periodic template (peak-to-peak ``_PERIODIC_PTP``, zero mean)."""
    from .synth import _cycle_noise, _PD_AMP_VAR, _PD_WIDTH_VAR, _PERIODIC_PTP
    f = np.clip(f_inst, 0.2, 12.0)
    period = 1.0 / f
    cycles = phase / (2 * np.pi)
    k = np.floor(cycles + 0.5)
    tau = (cycles - k) * period
    out = np.zeros_like(tau)
    kern = _KERNELS[shape]
    for n in (-1, 0, 1, 2, 3):
        kk = k - n
        amp = 1.0 + (_cycle_noise(kk, salt + 131) - 0.5) * (2.0 * _PD_AMP_VAR)
        wid = width * (1.0 + (_cycle_noise(kk, salt + 137) - 0.5) * (2.0 * _PD_WIDTH_VAR))
        out = out + amp * kern(tau + n * period, wid)
    area, ptp = _kernel_norm(shape, width)
    return (out - area * f) / ptp * _PERIODIC_PTP


def fast_carrier(t: np.ndarray, hz: float, seed: int, tag: int) -> np.ndarray:
    """Independent fast activity around ``hz`` as a function of ABSOLUTE time (three detuned partials), peak <= 1."""
    r = substream(seed, "rpp3fast", tag)
    ph = r.uniform(0, 2 * np.pi, 3)
    mul = (0.91, 1.0, 1.13)
    return sum(np.sin(2 * np.pi * hz * m * t + p) for m, p in zip(mul, ph)) / 3.0


def fast_run(t: np.ndarray, hz: float, seed: int, tag: int) -> np.ndarray:
    """r9 (gallery-20260929 acn-lrda-plus-f: the fast activity came in brush-like bursts on each delta wave, EDB-like):
    continuous RDA+F fast activity as a function of ABSOLUTE time.  fast_carrier's partials 0.91 / 1.0 / 1.13x beat at
    1.2-1.7 Hz at 13 Hz - the LRDA's own rate - so its envelope looked phase-locked.  Here two partials 3 % apart (beat
    ~0.4 Hz at 13 Hz) with a slow +/-0.6-Hz frequency wander and a +/-25 % amplitude drift over 5-10 s: rhythmic fast
    activity running through the run, waxing and waning on its own clock.  Same RMS as fast_carrier (0.41)."""
    r = substream(seed, "rpp3fastrun", tag)
    ph = r.uniform(0, 2 * np.pi, 4)
    fm = r.uniform(0.12, 0.25, 2)
    am = r.uniform(0.10, 0.20)
    s1 = np.sin(2 * np.pi * hz * t + (0.6 / fm[0]) * np.sin(2 * np.pi * fm[0] * t + ph[2]) + ph[0])
    s2 = np.sin(2 * np.pi * hz * 1.03 * t + (0.6 / fm[1]) * np.sin(2 * np.pi * fm[1] * t + ph[3]) + ph[1])
    env = 1.0 + 0.25 * np.sin(2 * np.pi * am * t + ph[2] + ph[3])
    return 0.80 * env * (s1 + 0.6 * s2) / 1.6


# --------------------------------------------------------------- schedule --

def _steps_evolving(f_start: float, f_end: float, dur: float,
                    equal_cycles: bool = False) -> Tuple[List[Tuple[float, float]], float]:
    """Frequency levels from f_start to f_end, consecutive changes >= 0.5 Hz, each level >= 3 cycles.

    Equal-duration levels by default.  ``equal_cycles`` (r050-fix-acns, a run authored shorter than 10 s) gives every
    level the same number of cycles instead, which is the shortest layout that keeps >= 3 cycles per level: 1 -> 2 Hz
    fits in 7.2 s instead of 10.4 s, so "evolution for < 10 s is not a seizure" can be drawn."""
    if abs(f_end - f_start) < 1.0:
        f_end = f_start + math.copysign(1.0, (f_end - f_start) or 1.0)
    n = max(3, int(round(abs(f_end - f_start) / 0.5)) + 1)
    levels = np.linspace(f_start, f_end, n)
    if equal_cycles:
        per = 1.0 / levels
        dur = max(dur, 3.0 * float(per.sum()) * 1.1)
        hold = dur * per / float(per.sum())
        ts = np.concatenate([[0.0], np.cumsum(hold)[:-1]])
        return [(float(a), float(v)) for a, v in zip(ts, levels)], dur
    dur = max(dur, 3.0 * n / float(levels.min()) * 1.15)
    hold = dur / n
    return [(k * hold, float(v)) for k, v in enumerate(levels)], dur


def _steps_fluctuating(f0: float, dur: float, rng, ceiling: float) -> Tuple[List[Tuple[float, float]], float]:
    """Alternate f0 and f0 +/- 0.5 Hz, holds 3 cycles..20 s (<= 60 s apart), at least 3 changes."""
    alt = f0 + 0.5 if f0 + 0.5 <= ceiling else f0 - 0.5
    lo_hold = 3.0 / min(f0, alt)
    dur = max(dur, 4.0 * lo_hold * 1.2)
    out, t, k = [], 0.0, 0
    while t < dur:
        out.append((t, float(f0 if k % 2 == 0 else alt)))
        t += float(np.clip(rng.uniform(lo_hold, max(lo_hold * 1.5, min(20.0, dur / 4.0))), lo_hold, 60.0))
        k += 1
    while len(out) < 4:                     # >= 3 changes inside the run
        out.append((out[-1][0] + lo_hold, float(f0 if len(out) % 2 == 0 else alt)))
    dur = max(dur, out[-1][0] + lo_hold)
    return out, dur


def schedule(syn, ev: Dict, i: int) -> List:
    """Runs of a phase-D rhythmic_pattern (see module docstring)."""
    from .synth import SeizureInstance, _RPP_BAND, _RPP_DRIFT, RPP_RAMP_S
    rng = substream(syn.seed, "rpp3", i)
    pat = str(ev.get("pattern") or "").upper()
    f0 = float(ev["frequency_hz"])
    amp = float(ev["amplitude_uv"])
    modifier = str(ev.get("modifier") or "").lower()
    periodic = bool(ev.get("periodic"))
    bird, edb = pat == "BIRDS", pat == "EDB"
    tri = is_triphasic(ev) and periodic
    has_f, has_r, has_s = parse_plus(ev.get("plus_modifier"))
    if edb:
        has_f = True
    advisories: List[str] = []
    if has_r and not periodic:
        advisories.append("+R applies to PDs only (ACNS 2021); ignored on RDA")
        has_r = False
    sharp = sharpness_key(ev.get("sharpness"))
    if has_s and periodic:
        advisories.append("+S applies to RDA only (ACNS 2021); on PDs it is rendered as sharpness 'spiky' and keyed so")
        has_s = False
        sharp = sharp or "spiky"
    if is_triphasic(ev) and not periodic:
        advisories.append("triphasic morphology applies to PDs/SW, not RDA (ACNS 2021); ignored")
    evo = ev.get("evolution") if isinstance(ev.get("evolution"), dict) else None
    evolving = "evolv" in modifier or (evo is not None and (evo.get("start_hz") is not None or evo.get("end_hz") is not None))
    fluct = ("fluctuat" in modifier) and not evolving
    si = bool(ev.get("stimulus_induced")) or pat == "SIRPIDS"
    ceiling = 30.0 if bird else _RPP_BAND[1]

    # waveform configuration
    shape = "triphasic" if tri else ("blunt" if sharp == "blunt" else "standard")
    width = 1.0 if tri and not sharp else SHARPNESS_WIDTH.get(sharp or "sharp", 1.0)
    if tri and sharp and sharp != "blunt":
        width = {"spiky": 0.6, "sharp": 0.8, "sharply_contoured": 1.0}.get(sharp, 1.0)
    if shape == "blunt":
        width = 1.0 if not tri else width
    if sharp == "spiky" and not tri and periodic:
        shape, width = "spiky", 1.0         # r9: _spiky_kernel is in seconds
    lag = str(ev.get("lag") or ("anterior_posterior" if tri else "none"))
    lag_s = float(ev.get("lag_ms", 120.0 if lag != "none" else 0.0)) / 1000.0
    if lag == "posterior_anterior":
        lag_s = -lag_s
    elif lag == "none":
        lag_s = 0.0
    fast = None
    if has_f:
        if edb:
            fast = {"mode": "brush", "hz": float(ev.get("fast_hz", 24.0)), "rel": 0.34}
        elif periodic:
            fast = {"mode": "pd_burst", "hz": float(ev.get("fast_hz", 14.0)), "rel": 0.60}
        else:
            fast = {"mode": "continuous", "hz": float(ev.get("fast_hz", 13.0)), "rel": 0.22}
    plus_r = None
    if has_r:
        fr = float(np.clip(f0 * 1.43 if f0 * 1.43 <= 2.4 else f0 * 0.62, 1.0, 2.4))
        plus_r = {"hz": fr, "rel": 1.2}
    # r050-fix-acns: the discharge kernels are surface-positive at the focus; r7 (Craig): the default is
    # surface-negative at the source (triphasic keeps its positive phase 2), "dipole" adds a positive pole
    polarity = resolve_polarity(ev, 3)
    if ev.get("polarity") and not periodic:
        advisories.append("polarity applies to periodic discharges, not RDA; ignored")
    region = ev["onset_region"]
    pred = str(ev.get("predominance") or ("frontal" if region == "generalized" else "none"))

    # run length / gap
    if bird:
        run_mean = float(np.clip(float(ev.get("run_duration_s") or 3.0), 0.5, 9.5))
    elif ev.get("duration_category"):
        a, b = DURATION_RANGE[str(ev["duration_category"])]
        run_mean = math.sqrt(a * b)
    else:
        run_mean = max(float(ev["run_duration_s"]), 4.0)
    if str(ev.get("prevalence") or "") == "continuous" and not ev.get("duration_category") and not bird and not si:
        # continuous (>= 90 %) without a duration category: one run over the whole epoch, not 30-s pieces
        run_mean = float(ev["duration_min"]) * 60.0
    single = run_mean == float(ev["duration_min"]) * 60.0 and str(ev.get("prevalence") or "") == "continuous"
    p = PREVALENCE.get(str(ev.get("prevalence") or ""))
    if p is not None:
        gap_mean, gap_min = run_mean * (1.0 - p) / p, 0.3
    elif bird:
        gap_mean, gap_min = 20.0, 2.0
    else:
        gap_mean, gap_min = run_mean * (0.55 if "intermittent" in modifier else 0.30), 3.0

    if pat.startswith(("BIPD", "BIRDA")):
        base = (region.replace("left", "right") if region.startswith("left") else region.replace("right", "left"))
        m_lo, m_hi = pair_muls(f0, BIPD_RATE_MUL)
        regions = [(base if region in ("left_hemisphere", "right_hemisphere", "left_temporal", "right_temporal")
                    else "left_temporal", m_lo),
                   (region if region in ("left_hemisphere", "right_hemisphere", "left_temporal", "right_temporal")
                    else "right_temporal", m_hi)]
    else:
        regions = [(region, 1.0)]

    start = float(ev["onset_min"]) * 60.0
    end = start + float(ev["duration_min"]) * 60.0
    stims = sorted(float(s["at_min"]) * 60.0 for s in syn.spec["events"] if s.get("type") == "stimulation")
    if si and not stims:
        advisories.append("stimulus_induced without a stimulation event: no runs are scheduled")
    rate_jitter = float(ev.get("rate_jitter", 0.0))
    fl_amp = float(ev.get("fluctuation", 0.45 if fluct else 0.15))
    spread = str(ev.get("spread") or "none") if evolving else "none"
    out = []
    for gi, (reg, fmul) in enumerate(regions):
        grng = substream(syn.seed, "rpp3", i, gi)
        slots: List[Tuple[float, Optional[int], float]] = []      # (t0, stimulus index, latency)
        if si:
            for j, a in enumerate(stims):
                if start <= a < end:
                    lat = float(grng.uniform(0.5, 3.0))
                    slots.append((a + lat, j, lat))
        k = 0
        t = start + (0.0 if gi == 0 else float(grng.uniform(0.0, run_mean * 0.5)))
        while k < 4000:
            if si:
                if k >= len(slots):
                    break
                t, sidx, lat = slots[k]
            else:
                sidx, lat = None, None
                if t >= end - 1.0:
                    break
            if ev.get("duration_category"):
                a, b = DURATION_RANGE[str(ev["duration_category"])]
                dur = float(math.exp(grng.uniform(math.log(a), math.log(b))))
            else:
                dur = run_mean * float(np.exp(grng.standard_normal() * 0.18)) if not single else end - t
            if bird:
                dur = float(np.clip(dur, max(0.5, 6.0 / max(f0, 4.1)), 9.5))
            # r9: jitter SD capped at RATE_JITTER_MAX, none on a single whole-epoch run (the draw is kept for the stream)
            fj = (float(np.clip(1.0 + min(rate_jitter, RATE_JITTER_MAX) * grng.normal(), 0.7, 1.3))
                  if rate_jitter > 0 else 1.0)
            if single:
                fj = 1.0
            f_run = f0 * fmul * fj
            if not bird and not fluct and f_run != f0:
                f_run = keep_rate_side(f0, f_run)
            if not bird and _RPP_BAND[0] <= f0 <= _RPP_BAND[1]:
                f_run = float(np.clip(f_run, _RPP_BAND[0] * (1.0 + _RPP_DRIFT) + 1e-6,
                                      _RPP_BAND[1] * (1.0 - _RPP_DRIFT) - 1e-6))
            if bird:
                f_run = max(f_run, 4.3)
            steps = None
            a0, a1 = amp, amp
            if evolving:
                fs_ = float((evo or {}).get("start_hz") or f_run)
                fe_ = float((evo or {}).get("end_hz") or (fs_ + 1.5 if fs_ + 1.5 <= ceiling else fs_ - 1.5))
                # r050-fix-acns (acns-independent.md: a 6-s evolving run was lengthened to 10.3-11.5 s and always keyed
                # ESz): a run authored under 10 s stays under 10 s when its levels fit, one authored at >= 10 s stays
                # at >= 10 s, so the ACNS 10-s boundary item keys the way it was written
                short = (not bird and not ev.get("duration_category") and not single
                         and float(ev.get("run_duration_s") or 0.0) < 10.0)
                if short:
                    dur = min(dur, 9.5)
                elif not bird and not ev.get("duration_category") and float(ev.get("run_duration_s") or 0.0) >= 10.0:
                    dur = max(dur, 10.5)
                steps, dur = _steps_evolving(fs_ * fmul, fe_ * fmul, dur, equal_cycles=short)
                if bird:
                    dur = min(dur, 9.5)
                elif short and dur >= 10.0 and k == 0:
                    advisories.append(f"evolution {fs_:g} -> {fe_:g} Hz needs {dur:.1f} s at 3 cycles per level, so "
                                      "the run lasts >= 10 s and is keyed a seizure (criterion B)")
                a0 = float((evo or {}).get("amplitude_start_uv") or amp)
                a1 = float((evo or {}).get("amplitude_end_uv") or amp * 1.5)
            elif fluct:
                steps, dur = _steps_fluctuating(f_run, dur, grng, ceiling)
            if si and k + 1 < len(slots):
                dur = min(dur, slots[k + 1][0] - t - 0.5)
            if not si and end - t < 2.0:
                break
            dur = min(dur, end - t) if not si else dur
            if dur <= 0.4:
                k += 1
                continue
            fr_ = [s[1] for s in steps] if steps else [f_run]
            cfg = {"shape": shape, "width": width, "lag_s": lag_s, "fast": fast, "plus_r": plus_r,
                   "steps": steps, "predominance": pred, "polarity": polarity, "bird": bird, "edb": edb, "sharpness": sharp,
                   # r050-fix-acns (epileptiform-icu-r3 C25/C26): full voltage within ~0.4 s; only an evolving run
                   # keeps the slow build-up
                   "ramp_s": 0.15 if bird else (min(0.14 * dur, 5.0) if evolving else RPP_RAMP_S),
                   "acns": {"main_term": main_term(ev), "stimulus_induced": si, "stimulus_index": sidx,
                            "stimulus_latency_s": None if lat is None else round(lat, 3),
                            "plus": ("+" + ("F" if has_f else "") + ("R" if has_r else "") + ("S" if has_s else ""))
                            if (has_f or has_r or has_s) else None,
                            "evolution": "evolving" if evolving else ("fluctuating" if fluct else "static"),
                            "min_hz": round(min(fr_), 3), "max_hz": round(max(fr_), 3),
                            "periodic": periodic, "triphasic": tri, "polarity": polarity,
                            "lag_ms": round(lag_s * 1000.0, 1) if lag_s else None,
                            "sharpness": sharp or ("blunt" if tri else None),
                            "predominance": pred if region == "generalized" else None,
                            "advisories": advisories or None}}
            out.append(SeizureInstance(
                t0=t, duration_s=dur, onset_region=reg,
                start_hz=fr_[0], end_hz=fr_[-1], amp_start=a0, amp_end=a1,
                spread=spread, postictal_s=0.0, index=i, ordinal=k * len(regions) + gi,
                kind="rhythmic_pattern", morph="ictal" if bird else ("periodic" if periodic else "rda"),
                fluctuate=fl_amp, plus_fast=0.0, plus_sharp=1.0 if (has_s and not periodic) else 0.0,
                predominance=pred, rpp=cfg,
            ))
            if not si:
                t += dur + max(gap_mean * float(np.exp(grng.standard_normal() * 0.3)), gap_min)
            k += 1
    return out


def step_phase(inst, uu: np.ndarray, dur: float) -> Tuple[np.ndarray, np.ndarray]:
    """Phase (rad) and frequency of a piecewise-constant frequency schedule at run fraction ``uu``."""
    steps = inst.rpp["steps"]
    ts = np.array([s[0] for s in steps] + [max(dur, steps[-1][0] + 1e-3)])
    fs = np.array([s[1] for s in steps])
    cum = np.concatenate([[0.0], np.cumsum(np.diff(ts) * fs)])
    tau = uu * dur
    k = np.clip(np.searchsorted(ts, tau, side="right") - 1, 0, fs.size - 1)
    return 2 * np.pi * (cum[k] + fs[k] * (tau - ts[k])), fs[k].astype(float)


# ------------------------------------------------------------------- rows --

def rda_field(syn, pred: str, morph: str) -> bool:
    """True when a generalized run takes the steep r9 GRDA field (spec_version 3 rhythmic delta, frontal / occipital)."""
    return syn.spec_version >= 3 and morph == "rda" and pred in ("frontal", "occipital")


def field_scale(syn, pred: str, morph: str = "periodic") -> np.ndarray:
    """Per-electrode scale that pins the generalized generators onto a predominance field (cached)."""
    cache = syn.__dict__.setdefault("_rpp3_fs", {})
    key = (pred, "rda") if rda_field(syn, pred, morph) else pred
    if key not in cache:
        if key != pred:
            target = FIELD_FRONTAL_RDA if pred == "frontal" else FIELD_OCCIPITAL_RDA
        else:
            target = (FIELD_FRONTAL if pred == "frontal" else FIELD_OCCIPITAL if pred == "occipital"
                      else mt.GENERALIZED_FIELD)
        base = np.asarray(syn._field_scale("generalized"))
        flat = np.array([mt.GENERALIZED_FIELD.get(e, 0.035) for e in syn.electrodes])
        want = np.array([target.get(e, 0.035) for e in syn.electrodes])
        cache[key] = base * want / np.maximum(flat, 1e-6)
    return cache[key]


def rows(syn, inst, t: np.ndarray) -> np.ndarray:
    """Scalp rows of one phase-D run (onset field, optional spread, +F, +R, lag)."""
    from .synth import _PERIODIC_PTP, smoothstep
    cfg = inst.rpp
    out = np.zeros((syn.n_elec, t.size))
    psi = substream(syn.seed, "szharm", inst.index).uniform(0, 2 * np.pi, 4)
    base = int(syn.seed) * 31 + inst.index * 1009 + inst.ordinal * 101
    region = inst.onset_region
    gens = mt.region_generators(region, syn.electrodes)
    fall = mt.generator_falloff(region)
    scale = field_scale(syn, cfg["predominance"], inst.morph) if region == "generalized" else np.asarray(syn._field_scale(region))
    lag_s = float(cfg["lag_s"] or 0.0)
    carrier = cfg["fast"] is not None
    spread = None
    if inst.spread not in (None, "none"):
        spread = syn._spread_region(inst)
    layers = [(gens, scale, fall, 0.0, None)]
    polarity = cfg.get("polarity") if inst.morph == "periodic" else None
    dipole = polarity == "dipole"
    onset = np.zeros_like(out) if dipole else out
    # the source electrode comes from the static onset field, never from which generators the window reaches
    wsum = sum(syn._gen_weights(f_, fall) * scale * ga_ for f_, ga_, _ in gens) if dipole else None
    if spread is not None:
        layers.append((mt.region_generators(spread, syn.electrodes),
                       np.asarray(field_scale(syn, "none") if spread == "generalized" else syn._field_scale(spread)),
                       mt.generator_falloff(spread), 0.18, spread))
    for gl, sc, fl, extra_lag, sp in layers:
        for gi, (focus, ga, gph) in enumerate(gl):
            y = mt.POSITIONS.get(focus, (0.0, 0.0))[1]
            # r050-fix-acns: generator lags are spread by LAG_FIELD_GAIN so the electrode-level Fp1 -> O1 lag equals
            # the keyed lag_ms (overlapping monopole fields compressed 120 ms to 90 ms, acns-independent.md)
            lg = lag_s * LAG_FIELD_GAIN
            d = extra_lag + (lg * (0.95 - y) / 1.9 if lg >= 0 else -lg * (y + 0.95) / 1.9)
            if not lag_s:
                # phase-B convention: 0.5 s per generator offset cycle (an authored lag replaces it); r9: a spiky
                # discharge keeps a fifth of it (GEN_OFFSET_FRAC)
                d += gph * 0.5 * (GEN_OFFSET_FRAC.get(cfg["shape"], 1.0) if inst.morph == "periodic" else 1.0)
            phase, u, amp, f_inst = syn._ictal_phase(inst, t - d)
            if phase is None:
                continue
            salt = base + (500_003 if sp else 0)
            gsalt = salt + 7919 * (gi + 1)
            if inst.morph == "periodic":
                wv = apply_polarity(polarity, discharge_train(phase, f_inst, cfg["shape"], cfg["width"], salt))
                unit = _PERIODIC_PTP
            else:
                wv = syn._wave(phase, psi, 0.0, inst.morph, 0.0, f_inst, salt, y, gsalt, True, inst.plus_sharp)
                unit = 2.83
            if carrier:
                fm = cfg["fast"]
                # the fast activity is generated per source with the source's own lag, so it survives the chain
                car = (fast_run if fm["mode"] == "continuous" else fast_carrier)(t - d, fm["hz"], syn.seed, inst.index)
                if fm["mode"] == "pd_burst":
                    cyc = phase / (2 * np.pi)
                    tau = (cyc - np.floor(cyc + 0.5)) / np.clip(f_inst, 0.2, 12.0)
                    gate = np.exp(-0.5 * ((tau - 0.06) / 0.075) ** 2)
                elif fm["mode"] == "brush":
                    gate = ((1.0 - np.sin(phase + psi[0])) / 2.0) ** 2.5
                else:
                    gate = 1.0
                wv = wv + fm["rel"] * unit * 0.5 * car * gate
            if cfg["plus_r"] is not None:
                pr = cfg["plus_r"]
                ph_r = 2 * np.pi * pr["hz"] * (t - d - inst.t0) + psi[2]
                wv = wv + pr["rel"] * _PERIODIC_PTP / 2.83 * syn._wave(ph_r, psi, 0.0, "rda", 0.0, None, salt + 77,
                                                                        y, gsalt + 77, True, 0.0)
            w = syn._gen_weights(focus, fl) * sc
            g = amp * ga
            if sp is not None:
                g = g * smoothstep((u - 0.35) / 0.30)
            elif spread is not None:
                g = g * (1.0 - 0.55 * smoothstep((u - 0.35) / 0.30))
            if sp is None:
                onset += w[:, None] * (wv * g)[None, :]
            else:
                out += w[:, None] * (wv * g)[None, :]
    if dipole:
        out += add_dipole_pole(syn, region, wsum, onset)
    return out


# -------------------------------------------------------------- stimulation --

def stimulus_rows(syn, x: np.ndarray, t: np.ndarray, i0: int, n: int) -> np.ndarray:
    """v3 reactivity (ACNS 2021 A5): increase (the 0.3.x response), attenuation, paradoxical, or none."""
    reactive = syn.bg.get("reactivity", "present") == "present"
    for j, ev in enumerate(syn.stimulations):
        at = float(ev["at_min"]) * 60.0
        resp = str(ev.get("response") or ("increase" if reactive else "none"))
        hold = float(ev.get("duration_s") or 6.0)
        if resp == "none" or at + hold + 25.0 < t[0] or at > t[-1]:
            continue
        if resp == "increase":
            shape = np.exp(-np.clip(t - at, 0, None) / 7.0) * (t >= at)
            x *= (1.0 + 0.55 * shape[None, :])
            x += (syn._stream_signal(syn.st_beta, i0 + 5551, n) * (syn.amp_rms * 0.55 * shape)[None, :])
            continue
        d = t - at
        env = np.clip(d / 0.4, 0.0, 1.0) * (d >= 0) * np.where(d <= hold, 1.0, np.exp(-np.clip(d - hold, 0, None) / 2.0))
        if resp == "attenuation":
            # generalized voltage attenuation of 55-65 % within 0.4 s, held for the stimulus, recovering over ~2 s
            x *= (1.0 - 0.62 * env)[None, :]
        elif resp == "paradoxical":
            # faster activity drops and diffuse high-voltage delta appears (arousal delta of the encephalopathic ICU
            # patient); 1.2-2 Hz stream at 2.2x the background RMS
            x *= (1.0 - 0.35 * env)[None, :]
            x += syn._stream_signal(syn.st_delta, i0 + 6007 + 13 * j, n) * (syn.amp_rms * 2.2 * env)[None, :]
    return x


# ------------------------------------------------------------ answer key --

def classify(inst, ev: Optional[Dict] = None) -> Dict:
    """ACNS 2021 classification of one realized run (answer key); ``ev`` describes a phase-B (plain) run."""
    if inst.rpp:
        a = dict(inst.rpp["acns"])
    else:
        ev = ev or {}
        f, r, s = parse_plus(ev.get("plus_modifier"))
        s = s and not ev.get("periodic")
        a = {"main_term": main_term(ev), "stimulus_induced": False, "plus": ("+S" if s else None),
             "evolution": "static", "min_hz": round(float(inst.start_hz), 3), "max_hz": round(float(inst.end_hz), 3),
             "periodic": bool(ev.get("periodic")), "triphasic": False, "lag_ms": None, "sharpness": None,
             "predominance": inst.predominance or None,
             # r7: the dominant phase as rendered (classify is called for spec_version 3 records only)
             "polarity": resolve_polarity(ev, 3)}
    dur = float(inst.duration_s)
    steps = inst.rpp.get("steps") if inst.rpp else None
    if steps:
        ts = [s[0] for s in steps] + [dur]
        mean_hz = sum((ts[k + 1] - ts[k]) * steps[k][1] for k in range(len(steps))) / max(dur, 1e-9)
    else:
        mean_hz = 0.5 * (inst.start_hz + inst.end_hz)
    lateral = inst.onset_region not in ("generalized",)
    plus = bool(a.get("plus"))
    fluct = a.get("evolution") == "fluctuating"
    periodic = bool(a.get("periodic"))
    a["mean_hz"] = round(float(mean_hz), 3)
    a["duration_category"] = duration_category(dur)
    if inst.rpp and inst.rpp.get("bird"):
        cls = "BIRDs_definite" if a.get("evolution") == "evolving" else "BIRDs_possible"
        basis = ("> 4 Hz, 0.5-10 s, evolving" if cls.endswith("definite") else "> 4 Hz, 0.5-10 s, sharply contoured")
        if dur >= 10.0:
            cls, basis = "electrographic_seizure", "rhythmic > 4 Hz for >= 10 s"
    elif a.get("evolution") == "evolving" and dur >= 10.0:
        cls, basis = "electrographic_seizure", "criterion B: definite evolution for >= 10 s"
    elif periodic and mean_hz > 2.5 and dur >= 10.0:
        cls, basis = "electrographic_seizure", "criterion A: discharges averaging > 2.5 Hz for >= 10 s"
    elif periodic and 1.0 < mean_hz <= 2.5 and dur >= 10.0:
        cls, basis = "IIC", "PDs averaging > 1 and <= 2.5 Hz over 10 s"
    elif periodic and 0.5 <= mean_hz <= 1.0 and (plus or fluct) and dur >= 10.0:
        cls, basis = "IIC", "PDs 0.5-1 Hz with a plus modifier or fluctuation"
    elif (not periodic) and lateral and mean_hz > 1.0 and (plus or fluct) and dur >= 10.0:
        cls, basis = "IIC", "lateralized RDA > 1 Hz with a plus modifier or fluctuation"
    else:
        cls, basis = "RPP_interictal", None
    a["acns_classification"] = cls
    a["classification_basis"] = basis
    # r7: ACNS 2021 polarity category of the rendered dominant phase (referential montage)
    pol = a.get("polarity")
    a["polarity_acns"] = {"surface_negative": "negative", "surface_positive": "positive",
                          "dipole": "dipole"}.get(pol) if pol else None
    if pol == "dipole":
        a["dipole_positive_pole"] = dipole_pole(inst.onset_region, mt.POSITIONS)
    if a.get("stimulus_induced"):
        a["acns_label"] = "SI-" + (("ESz" if cls == "electrographic_seizure" else a["main_term"])
                                   + (a["plus"] or ""))
    else:
        a["acns_label"] = a["main_term"] + (a["plus"] or "") if not (inst.rpp and inst.rpp.get("edb")) else "EDB"
    return a


def duration_category(dur: float) -> str:
    if dur >= 3600.0:
        return "very_long"
    if dur >= 600.0:
        return "long"
    if dur >= 60.0:
        return "intermediate"
    if dur >= 10.0:
        return "brief"
    return "very_brief"


def prevalence_category(pct: float) -> str:
    if pct >= 90.0:
        return "continuous"
    if pct >= 50.0:
        return "abundant"
    if pct >= 10.0:
        return "frequent"
    if pct >= 1.0:
        return "occasional"
    return "rare" if pct > 0 else "none"


def event_summary(rows: List[Dict], events: List[Dict], duration_s: float) -> List[Dict]:
    """Per rhythmic_pattern event: realized prevalence, typical/longest duration and their ACNS categories; EDB
    definite/possible per Table 2."""
    out = []
    for i, ev in enumerate(events):
        if ev.get("type") != "rhythmic_pattern":
            continue
        rr = [r for r in rows if r["kind"] == "rhythmic_pattern" and r.get("spec_event_index") == i]
        if not rr:
            continue
        a0 = max(0.0, float(ev.get("onset_min", 0.0)) * 60.0)
        a1 = min(duration_s, a0 + float(ev.get("duration_min", 0.0)) * 60.0)
        # prevalence over the pattern's own epoch (ACNS: percent of record/epoch within the pattern)
        iv = sorted((r["onset_s"], r["offset_s"]) for r in rr)
        cov, cur = 0.0, None
        for s, e in iv:
            if cur is None or s > cur[1]:
                if cur:
                    cov += cur[1] - cur[0]
                cur = [s, e]
            else:
                cur[1] = max(cur[1], e)
        if cur:
            cov += cur[1] - cur[0]
        epoch = max(a1 - a0, 1e-9)
        pct = 100.0 * min(cov / epoch, 1.0)
        durs = sorted(r["offset_s"] - r["onset_s"] for r in rr)
        med = float(np.median(durs))
        s = {"spec_event_index": i, "acns_label": rr[0].get("acns_label"), "runs": len(rr),
             "prevalence_pct": round(pct, 2), "acns_prevalence": prevalence_category(pct),
             "typical_duration_s": round(med, 2), "acns_duration": duration_category(med),
             "longest_duration_s": round(durs[-1], 2)}
        if str(ev.get("pattern") or "").upper() == "EDB" or (rr[0].get("plus") and "F" in (rr[0].get("plus") or "")
                                                               and not rr[0].get("periodic")):
            stereotyped = str(ev.get("pattern") or "").upper() == "EDB"
            if pct >= 50.0:
                s["edb"] = "definite" if stereotyped else "possible"
            else:
                s["edb"] = "possible" if stereotyped else "no (RDA+F)"
        out.append(s)
    return out
