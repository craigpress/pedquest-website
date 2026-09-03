"""Electrode sets, montages and region -> electrode projection weights.

Coordinates are the conventional flattened 10-20 head projection with the nose
at +y and the left ear at -x, on a unit circle.  They are used for two things:
spatial smoothing of focal generators and picking which display rows an
``eeg_page`` answer region covers.
"""

from __future__ import annotations

from typing import Dict, List, Sequence, Tuple

# --------------------------------------------------------------------------
# electrodes
# --------------------------------------------------------------------------

# (x, y) with x < 0 = left hemisphere.  A1/A2 are the ear references; they are
# synthesized (they carry ECG) but never contribute to hemisphere trends.
POSITIONS: Dict[str, Tuple[float, float]] = {
    "Fp1": (-0.31, 0.95),
    "Fp2": (0.31, 0.95),
    "F7": (-0.81, 0.59),
    "F3": (-0.39, 0.51),
    "Fz": (0.00, 0.50),
    "F4": (0.39, 0.51),
    "F8": (0.81, 0.59),
    "T3": (-1.00, 0.00),
    "C3": (-0.50, 0.00),
    "Cz": (0.00, 0.00),
    "C4": (0.50, 0.00),
    "T4": (1.00, 0.00),
    "T5": (-0.81, -0.59),
    "P3": (-0.39, -0.51),
    "Pz": (0.00, -0.50),
    "P4": (0.39, -0.51),
    "T6": (0.81, -0.59),
    "O1": (-0.31, -0.95),
    "O2": (0.31, -0.95),
    "A1": (-1.15, 0.10),
    "A2": (1.15, 0.10),
}

STANDARD_19: List[str] = [
    "Fp1", "Fp2", "F7", "F3", "Fz", "F4", "F8",
    "T3", "C3", "Cz", "C4", "T4",
    "T5", "P3", "Pz", "P4", "T6",
    "O1", "O2",
]

#: ACNS neonatal reduced array (9 scalp electrodes).
NEONATAL_9: List[str] = ["Fp1", "Fp2", "T3", "C3", "Cz", "C4", "T4", "O1", "O2"]

REFERENCE_ELECTRODES: List[str] = ["A1", "A2"]

CHANNEL_SETS: Dict[str, List[str]] = {
    "standard_19": STANDARD_19,
    "neonatal_9": NEONATAL_9,
    "neonatal_reduced": NEONATAL_9,
}


def channel_set(name: str) -> List[str]:
    try:
        return list(CHANNEL_SETS[name])
    except KeyError as exc:  # pragma: no cover - guarded by schema
        raise ValueError(f"unknown channel set {name!r}") from exc


def side_of(electrode: str) -> str:
    x = POSITIONS[electrode][0]
    if x < -1e-6:
        return "left"
    if x > 1e-6:
        return "right"
    return "midline"


# --------------------------------------------------------------------------
# montages (display derivations)
# --------------------------------------------------------------------------

LONGITUDINAL_BIPOLAR: List[Tuple[str, str]] = [
    ("Fp1", "F7"), ("F7", "T3"), ("T3", "T5"), ("T5", "O1"),
    ("Fp2", "F8"), ("F8", "T4"), ("T4", "T6"), ("T6", "O2"),
    ("Fp1", "F3"), ("F3", "C3"), ("C3", "P3"), ("P3", "O1"),
    ("Fp2", "F4"), ("F4", "C4"), ("C4", "P4"), ("P4", "O2"),
    ("Fz", "Cz"), ("Cz", "Pz"),
]

#: ACNS-style neonatal montage (12 derivations over the 9-electrode array).
NEONATAL_BIPOLAR: List[Tuple[str, str]] = [
    ("Fp1", "T3"), ("T3", "O1"),
    ("Fp2", "T4"), ("T4", "O2"),
    ("Fp1", "C3"), ("C3", "O1"),
    ("Fp2", "C4"), ("C4", "O2"),
    ("T3", "C3"), ("C3", "Cz"), ("Cz", "C4"), ("C4", "T4"),
]

#: hemisphere chains used for the trend computation (Persyst-like: PSD is
#: computed per bipolar derivation, then pooled across the side's derivations).
TREND_CHAINS_19: Dict[str, List[Tuple[str, str]]] = {
    "left": [("Fp1", "F7"), ("F7", "T3"), ("T3", "T5"), ("T5", "O1"),
             ("Fp1", "F3"), ("F3", "C3"), ("C3", "P3"), ("P3", "O1")],
    "right": [("Fp2", "F8"), ("F8", "T4"), ("T4", "T6"), ("T6", "O2"),
              ("Fp2", "F4"), ("F4", "C4"), ("C4", "P4"), ("P4", "O2")],
}

TREND_CHAINS_NEONATAL: Dict[str, List[Tuple[str, str]]] = {
    "left": [("Fp1", "T3"), ("T3", "O1"), ("Fp1", "C3"), ("C3", "O1"), ("T3", "C3")],
    "right": [("Fp2", "T4"), ("T4", "O2"), ("Fp2", "C4"), ("C4", "O2"), ("C4", "T4")],
}


def trend_chains(channels: Sequence[str]) -> Dict[str, List[Tuple[str, str]]]:
    """Pick the hemisphere derivation lists that the electrode set supports."""
    present = set(channels)
    table = TREND_CHAINS_19 if "T5" in present and "P3" in present else TREND_CHAINS_NEONATAL
    return {
        side: [pair for pair in pairs if pair[0] in present and pair[1] in present]
        for side, pairs in table.items()
    }


def montage_pairs(montage: str, channels: Sequence[str]) -> List[Tuple[str, str | None]]:
    """Derivation list for an ``eeg_page`` montage.

    ``referential`` and ``average`` return ``(electrode, None)`` pairs; the
    renderer subtracts the appropriate reference itself.
    """
    present = set(channels)
    if montage == "longitudinal_bipolar":
        base = LONGITUDINAL_BIPOLAR if "T5" in present else NEONATAL_BIPOLAR
        return [p for p in base if p[0] in present and p[1] in present]
    if montage == "neonatal_reduced":
        return [p for p in NEONATAL_BIPOLAR if p[0] in present and p[1] in present]
    if montage in ("referential", "average"):
        order = [e for e in STANDARD_19 if e in present] or list(channels)
        return [(e, None) for e in order]
    raise ValueError(f"unknown montage {montage!r}")


def montage_label(pair: Tuple[str, str | None], montage: str) -> str:
    a, b = pair
    if b is not None:
        return f"{a}-{b}"
    if montage == "average":
        return f"{a}-Avg"
    return f"{a}-{'A1' if side_of(a) != 'right' else 'A2'}"


# --------------------------------------------------------------------------
# regions -> per-electrode weights
# --------------------------------------------------------------------------

#: focus electrodes per region name in the DSL.  A generator placed in a region
#: is projected onto every electrode with a weight that falls off with distance
#: from these foci, which is what makes a "left temporal" seizure actually show
#: up in the left temporal chain and only leak faintly elsewhere.
REGION_FOCI: Dict[str, List[str]] = {
    "left_temporal": ["T3", "T5", "F7"],
    "right_temporal": ["T4", "T6", "F8"],
    "left_frontal": ["F3", "F7", "Fp1"],
    "right_frontal": ["F4", "F8", "Fp2"],
    "left_central": ["C3", "P3"],
    "right_central": ["C4", "P4"],
    "left_occipital": ["O1", "T5"],
    "right_occipital": ["O2", "T6"],
    "left_hemisphere": ["F7", "T3", "C3", "P3", "T5", "F3", "O1", "Fp1"],
    "right_hemisphere": ["F8", "T4", "C4", "P4", "T6", "F4", "O2", "Fp2"],
    "generalized": list(STANDARD_19),
    "midline": ["Fz", "Cz", "Pz"],
}

#: An ictal generator is modelled as a set of monopolar sources, each
#: ``(focus electrode, relative amplitude, phase offset in cycles)``.
#: Two things depend on this being a *set* rather than a single smooth blob:
#: a field that plateaus across a region cancels in bipolar derivations, and
#: real regional seizures are several partially independent generators whose
#: small phase differences are what produce the propagation appearance and the
#: phase reversal at the focus.
REGION_GENERATORS: Dict[str, List[Tuple[str, float, float]]] = {
    "left_temporal":   [("T3", 1.00, 0.00), ("T5", 0.45, 0.10), ("F7", 0.40, -0.07)],
    "right_temporal":  [("T4", 1.00, 0.00), ("T6", 0.45, 0.10), ("F8", 0.40, -0.07)],
    "left_frontal":    [("F3", 1.00, 0.00), ("F7", 0.50, 0.08), ("Fp1", 0.45, -0.06)],
    "right_frontal":   [("F4", 1.00, 0.00), ("F8", 0.50, 0.08), ("Fp2", 0.45, -0.06)],
    "left_central":    [("C3", 1.00, 0.00), ("P3", 0.45, 0.09), ("F3", 0.35, -0.06)],
    "right_central":   [("C4", 1.00, 0.00), ("P4", 0.45, 0.09), ("F4", 0.35, -0.06)],
    "left_occipital":  [("O1", 1.00, 0.00), ("T5", 0.50, 0.09), ("P3", 0.45, -0.05)],
    "right_occipital": [("O2", 1.00, 0.00), ("T6", 0.50, 0.09), ("P4", 0.45, -0.05)],
    "left_hemisphere": [("F7", 0.85, 0.00), ("T3", 1.00, 0.06), ("C3", 0.90, 0.12),
                        ("P3", 0.80, 0.18), ("O1", 0.70, 0.24), ("F3", 0.75, 0.03)],
    "right_hemisphere": [("F8", 0.85, 0.00), ("T4", 1.00, 0.06), ("C4", 0.90, 0.12),
                         ("P4", 0.80, 0.18), ("O2", 0.70, 0.24), ("F4", 0.75, 0.03)],
    "generalized":     [("F3", 0.95, 0.00), ("F4", 0.95, 0.03), ("C3", 1.00, 0.07),
                        ("C4", 1.00, 0.05), ("T3", 0.75, 0.12), ("T4", 0.75, 0.10),
                        ("P3", 0.80, 0.15), ("P4", 0.80, 0.14), ("Fz", 0.85, 0.01)],
    "midline":         [("Cz", 1.00, 0.00), ("Fz", 0.55, 0.06), ("Pz", 0.50, 0.09)],
}


def region_generators(region: str, channels: Sequence[str]) -> List[Tuple[str, float, float]]:
    """Generators for ``region``, dropping foci the electrode array lacks."""
    present = set(channels)
    gens = [g for g in REGION_GENERATORS[region] if g[0] in present]
    if gens:
        return gens
    # reduced arrays (e.g. neonatal) may lack every listed focus - fall back to
    # the nearest available electrode to the region's first focus
    target = REGION_GENERATORS[region][0][0]
    tx, ty = POSITIONS[target]
    best = min(
        (e for e in channels if e in POSITIONS),
        key=lambda e: (POSITIONS[e][0] - tx) ** 2 + (POSITIONS[e][1] - ty) ** 2,
    )
    return [(best, 1.0, 0.0)]


def monopole_weights(focus: str, channels: Sequence[str],
                     falloff: float = 0.42, leak: float = 0.03) -> Dict[str, float]:
    """Field of a single source at ``focus``: ``exp(-(d/falloff)^2)``."""
    fx, fy = POSITIONS[focus]
    out: Dict[str, float] = {}
    for ch in channels:
        if ch not in POSITIONS:
            out[ch] = leak
            continue
        cx, cy = POSITIONS[ch]
        d = ((cx - fx) ** 2 + (cy - fy) ** 2) ** 0.5
        out[ch] = max(leak, float(pow(2.718281828459045, -((d / falloff) ** 2))))
    return out


CONTRALATERAL: Dict[str, str] = {
    "left_temporal": "right_temporal",
    "right_temporal": "left_temporal",
    "left_frontal": "right_frontal",
    "right_frontal": "left_frontal",
    "left_central": "right_central",
    "right_central": "left_central",
    "left_occipital": "right_occipital",
    "right_occipital": "left_occipital",
    "left_hemisphere": "right_hemisphere",
    "right_hemisphere": "left_hemisphere",
    "generalized": "generalized",
    "midline": "midline",
}

HEMISPHERE_OF_REGION: Dict[str, str] = {
    "left_temporal": "left", "left_frontal": "left", "left_central": "left",
    "left_occipital": "left", "left_hemisphere": "left",
    "right_temporal": "right", "right_frontal": "right", "right_central": "right",
    "right_occipital": "right", "right_hemisphere": "right",
    "generalized": "both", "midline": "both",
}


def region_weights(
    region: str,
    channels: Sequence[str],
    falloff: float = 0.38,
    leak: float = 0.035,
) -> Dict[str, float]:
    """Weight per electrode for a generator in ``region`` (peak 1.0).

    Weight = max over foci of ``exp(-(d/falloff)^2)``, floored at ``leak`` so
    that a focal discharge still produces the faint far-field seen clinically.
    ``generalized`` is flat with a mild frontal/central emphasis.

    ``falloff`` is deliberately shorter than the 10-20 inter-electrode spacing
    (~0.5 in these units).  A field that decays more slowly than the electrode
    spacing cancels in a bipolar derivation, which is precisely why a smoothly
    interpolated "blob" model produces focal seizures that are invisible on a
    double-banana montage.
    """
    foci = REGION_FOCI[region]
    if region == "generalized":
        return {
            ch: 1.0 if ch in ("Fz", "Cz", "F3", "F4", "C3", "C4") else 0.85
            for ch in channels
        }
    out: Dict[str, float] = {}
    for ch in channels:
        if ch not in POSITIONS:
            out[ch] = leak
            continue
        cx, cy = POSITIONS[ch]
        best = 0.0
        for f in foci:
            if f not in POSITIONS:
                continue
            fx, fy = POSITIONS[f]
            d = ((cx - fx) ** 2 + (cy - fy) ** 2) ** 0.5
            best = max(best, float(pow(2.718281828459045, -((d / falloff) ** 2))))
        out[ch] = max(leak, best)
    return out


def electrodes_for_region(region: str, channels: Sequence[str], top: int = 4) -> List[str]:
    """The electrodes a reader should point at for a generator in ``region``."""
    w = region_weights(region, channels)
    ranked = sorted(w.items(), key=lambda kv: -kv[1])
    keep = [ch for ch, val in ranked if val > 0.45]
    return keep[:top] if keep else [ranked[0][0]]
