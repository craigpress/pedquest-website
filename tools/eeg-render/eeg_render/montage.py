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
    # 0.5.0 (spec_version 3, montage family): Silverman subtemporal electrodes, one third of the way from the
    # external auditory meatus to the lateral canthus and 1 cm up, i.e. below the F7-T3 line.  In this flattened
    # projection that is just outside the rim between F7 and T3, towards the ear.  Present only in the
    # ``standard_19_t1t2`` channel set, so the 19-electrode arrays (and every v1/v2 page) are unchanged.
    "T1": (-1.06, 0.33),
    "T2": (1.06, 0.33),
}

#: Subtemporal electrodes take the mean of their two scalp neighbours from any per-electrode table that does not
#: list them (background and artifact fields), so a T1 row is not a hole in the chain.  Focal generators use the
#: real position above and are unaffected.
SUBTEMPORAL_PROXY: Dict[str, Tuple[str, str]] = {"T1": ("F7", "T3"), "T2": ("F8", "T4")}


def table_value(table: Dict[str, float], electrode: str, default: float) -> float:
    """``table[electrode]``, else the subtemporal proxy mean, else ``default`` (0.5.0)."""
    v = table.get(electrode)
    if v is not None:
        return v
    px = SUBTEMPORAL_PROXY.get(electrode)
    if px is not None and (px[0] in table or px[1] in table):
        return 0.5 * (table.get(px[0], default) + table.get(px[1], default))
    return default

STANDARD_19: List[str] = [
    "Fp1", "Fp2", "F7", "F3", "Fz", "F4", "F8",
    "T3", "C3", "Cz", "C4", "T4",
    "T5", "P3", "Pz", "P4", "T6",
    "O1", "O2",
]

#: ACNS neonatal reduced array (9 scalp electrodes).
NEONATAL_9: List[str] = ["Fp1", "Fp2", "T3", "C3", "Cz", "C4", "T4", "O1", "O2"]

REFERENCE_ELECTRODES: List[str] = ["A1", "A2"]

#: 0.5.0 (spec_version 3): the 10-20 array plus the T1/T2 subtemporal pair, for the "longitudinal with T1/T2"
#: montage (learningeeg montages/normal-bipolar-t1t2).  Appended after O2 so the 19 keep their order.
STANDARD_19_T1T2: List[str] = STANDARD_19 + ["T1", "T2"]

CHANNEL_SETS: Dict[str, List[str]] = {
    "standard_19": STANDARD_19,
    "neonatal_9": NEONATAL_9,
    "neonatal_reduced": NEONATAL_9,
    "standard_19_t1t2": STANDARD_19_T1T2,
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


#: Four-region split: left/right x lateral (temporal) / parasagittal.
#:
#: This is what the published teaching atlas displays - "A Primer on EEG
#: Spectrograms" (Ng, Jing, Westover, J Clin Neurophysiol 2022) plots four
#: spectrograms labelled LL / LP / RP / RL rather than two hemispheres - and
#: it is the Persyst convention too.  Pooling a whole hemisphere averages a
#: temporal focus together with the parasagittal chain that does not see it,
#: which is exactly the contrast a localisation question needs to survive.
TREND_REGIONS_19: Dict[str, List[Tuple[str, str]]] = {
    "LL": [("Fp1", "F7"), ("F7", "T3"), ("T3", "T5"), ("T5", "O1")],
    "LP": [("Fp1", "F3"), ("F3", "C3"), ("C3", "P3"), ("P3", "O1")],
    "RL": [("Fp2", "F8"), ("F8", "T4"), ("T4", "T6"), ("T6", "O2")],
    "RP": [("Fp2", "F4"), ("F4", "C4"), ("C4", "P4"), ("P4", "O2")],
}

#: The 9-electrode neonatal array has no F7/T5, so each region is the two
#: derivations of that chain the array can actually support.
TREND_REGIONS_NEONATAL: Dict[str, List[Tuple[str, str]]] = {
    "LL": [("Fp1", "T3"), ("T3", "O1")],
    "LP": [("Fp1", "C3"), ("C3", "O1")],
    "RL": [("Fp2", "T4"), ("T4", "O2")],
    "RP": [("Fp2", "C4"), ("C4", "O2")],
}

#: display order, matching the atlas figures (left over right, lateral first)
TREND_REGION_NAMES = ("LL", "LP", "RP", "RL")


def trend_regions(channels: Sequence[str]) -> Dict[str, List[Tuple[str, str]]]:
    """Regional derivation lists the electrode set supports."""
    present = set(channels)
    table = TREND_REGIONS_19 if "T5" in present and "P3" in present else TREND_REGIONS_NEONATAL
    return {
        name: [pair for pair in pairs if pair[0] in present and pair[1] in present]
        for name, pairs in table.items()
    }


def trend_chains(channels: Sequence[str]) -> Dict[str, List[Tuple[str, str]]]:
    """Pick the hemisphere derivation lists that the electrode set supports."""
    present = set(channels)
    table = TREND_CHAINS_19 if "T5" in present and "P3" in present else TREND_CHAINS_NEONATAL
    return {
        side: [pair for pair in pairs if pair[0] in present and pair[1] in present]
        for side, pairs in table.items()
    }


# --------------------------------------------------------------------------
# 0.5.0 (spec_version 3, montage family): the browser viewer's montage set
# --------------------------------------------------------------------------
# Mirrors ``src/lib/eeg/montage.ts`` (the site's EDF viewer) id for id, chain for chain and label for label, so a
# page rendered here and the same recording opened in the viewer agree.  Naming follows ACNS Guideline 3
# (LB-18.3, TB-18.3, R-18.3); circumferential = hatband = the outer temporal ring; grapefruit = outer ring + inner
# parasagittal ring + midline; Laplacian is the Hjorth nearest-neighbour form with equal weights.
#
# A derivation is ``(electrode, reference)`` where the reference is an electrode name or a TUPLE of electrode
# names whose mean is subtracted (linked ears, Laplacian, neonatal average).  ``average`` keeps its v1/v2
# ``(electrode, None)`` form.  The legacy names (longitudinal_bipolar, referential, average, neonatal_reduced)
# are untouched; every name below is opt-in and only accepted at spec_version 3.

_V_DOUBLE_BANANA = [["Fp1", "F7", "T3", "T5", "O1"], ["Fp2", "F8", "T4", "T6", "O2"],
                    ["Fp1", "F3", "C3", "P3", "O1"], ["Fp2", "F4", "C4", "P4", "O2"], ["Fz", "Cz", "Pz"]]
_V_TRANSVERSE = [["F7", "Fp1", "Fp2", "F8"], ["F7", "F3", "Fz", "F4", "F8"], ["T3", "C3", "Cz", "C4", "T4"],
                 ["T5", "P3", "Pz", "P4", "T6"], ["T5", "O1", "O2", "T6"]]
_V_OUTER_RING = ["Fp1", "F7", "T3", "T5", "O1", "O2", "T6", "T4", "F8", "Fp2", "Fp1"]
_V_INNER_RING = ["Fp1", "F3", "C3", "P3", "O1", "O2", "P4", "C4", "F4", "Fp2", "Fp1"]
_V_T1T2 = [["Fp1", "F7", "T1", "T3", "T5", "O1"], ["Fp2", "F8", "T2", "T4", "T6", "O2"],
           ["Fp1", "F3", "C3", "P3", "O1"], ["Fp2", "F4", "C4", "P4", "O2"], ["Fz", "Cz", "Pz"]]
_V_NEONATAL = [["Fp1", "C3", "O1"], ["Fp2", "C4", "O2"], ["Fp1", "T3", "O1"], ["Fp2", "T4", "O2"],
               ["T3", "C3", "Cz", "C4", "T4"]]
_V_REFERENTIAL_ORDER = [["Fp1", "F7", "T3", "T5", "O1"], ["Fp2", "F8", "T4", "T6", "O2"], ["F3", "C3", "P3"],
                        ["F4", "C4", "P4"], ["Fz", "Cz", "Pz"]]
_V_NEONATAL_ELECTRODES = [["Fp1", "T3", "C3", "O1"], ["Fp2", "T4", "C4", "O2"], ["Cz"]]
#: Hjorth nearest neighbours on the 10-20 grid (edge electrodes have fewer, so their estimate is one-sided)
LAPLACIAN_NEIGHBOURS: Dict[str, List[str]] = {
    "Fp1": ["Fp2", "F3", "F7"], "Fp2": ["Fp1", "F4", "F8"],
    "F7": ["Fp1", "F3", "T3"], "F8": ["Fp2", "F4", "T4"],
    "F3": ["Fp1", "F7", "Fz", "C3"], "F4": ["Fp2", "F8", "Fz", "C4"],
    "Fz": ["F3", "F4", "Cz"],
    "T3": ["F7", "C3", "T5"], "T4": ["F8", "C4", "T6"],
    "C3": ["F3", "T3", "P3", "Cz"], "C4": ["F4", "T4", "P4", "Cz"],
    "Cz": ["Fz", "C3", "C4", "Pz"],
    "T5": ["T3", "P3", "O1"], "T6": ["T4", "P4", "O2"],
    "P3": ["C3", "T5", "Pz", "O1"], "P4": ["C4", "T6", "Pz", "O2"],
    "Pz": ["P3", "P4", "Cz"],
    "O1": ["T5", "P3", "O2"], "O2": ["T6", "P4", "O1"],
}

#: id -> (viewer label, electrodes required).  Order and labels as in VIEWER_MONTAGES (montage.ts).
VIEWER_MONTAGES: Dict[str, Tuple[str, Tuple[str, ...]]] = {
    "transverse_bipolar": ("Transverse bipolar (TB-18.3)", ()),
    "circumferential": ("Circumferential (hatband)", ()),
    "grapefruit": ("Grapefruit (concentric rings)", ()),
    "t1t2_bipolar": ("Longitudinal with T1/T2", ("T1", "T2")),
    "ipsilateral_ear": ("Ipsilateral ear (R-18.3)", ("A1", "A2")),
    "contralateral_ear": ("Contralateral ear", ("A1", "A2")),
    "cz_reference": ("Cz reference", ("Cz",)),
    "neonatal_average": ("Neonatal, average reference", ()),
    "laplacian": ("Laplacian (source)", ()),
}
#: montage names only spec_version 3 accepts
V3_MONTAGES: List[str] = list(VIEWER_MONTAGES)
#: aliases the viewer's synonyms resolve to (normalised in spec.normalize)
MONTAGE_ALIASES: Dict[str, str] = {"hatband": "circumferential", "transverse": "transverse_bipolar",
                                   "longitudinal_t1t2": "t1t2_bipolar", "hjorth": "laplacian"}

Derivation = Tuple[str, "str | Tuple[str, ...] | None"]


def _chains(chains: Sequence[Sequence[str]], present) -> List[List[Derivation]]:
    out = []
    for chain in chains:
        rows = [(a, b) for a, b in zip(chain[:-1], chain[1:]) if a in present and b in present]
        if rows:
            out.append(rows)
    return out


def _side_num(e: str) -> "bool | None":
    """Viewer ``isLeft``: odd trailing number = left, even = right, none = midline."""
    digits = "".join(ch for ch in e if ch.isdigit())
    return None if not digits else int(digits) % 2 == 1


def _referential(order, channels: Sequence[str], ref_for) -> List[List[Derivation]]:
    present = set(channels)
    used, out = set(), []
    for chain in order:
        rows = []
        for e in chain:
            if e not in present:
                continue
            used.add(e)
            r = ref_for(e)
            if r is not False:
                rows.append((e, r))
        if rows:
            out.append(rows)
    extra = []
    for e in channels:
        if e in used or e in REFERENCE_ELECTRODES:
            continue
        r = ref_for(e)
        if r is not False:
            extra.append((e, r))
    if extra:
        out.append(extra)
    return out


def viewer_montage_chains(montage: str, channels: Sequence[str]) -> List[List[Derivation]]:
    """Derivations of a viewer montage grouped by chain (a gap is drawn between chains).

    Falls back like the viewer: a montage whose electrodes are missing becomes ``average``.
    """
    present = set(channels) | set(REFERENCE_ELECTRODES)
    scalp = [e for e in channels if e not in REFERENCE_ELECTRODES]
    need = VIEWER_MONTAGES[montage][1]
    if any(e not in present for e in need):
        avg = tuple(scalp)
        return _referential(_V_REFERENTIAL_ORDER, scalp, lambda e: avg)
    if montage == "transverse_bipolar":
        return _chains(_V_TRANSVERSE, present)
    if montage == "circumferential":
        return _chains([_V_OUTER_RING], present)
    if montage == "grapefruit":
        return _chains([_V_OUTER_RING, _V_INNER_RING, ["Fz", "Cz", "Pz"]], present)
    if montage == "t1t2_bipolar":
        return _chains(_V_T1T2, present)
    if montage in ("ipsilateral_ear", "contralateral_ear"):
        ipsi = montage == "ipsilateral_ear"

        def ear(e):
            left = _side_num(e)
            if left is None:
                return ("A1", "A2")                     # midline: linked ears ("-A12")
            return "A1" if left == ipsi else "A2"
        return _referential(_V_REFERENTIAL_ORDER, scalp, ear)
    if montage == "cz_reference":
        return _referential(_V_REFERENTIAL_ORDER, scalp, lambda e: False if e == "Cz" else "Cz")
    if montage == "neonatal_average":
        members = tuple(e for chain in _V_NEONATAL_ELECTRODES for e in chain if e in present)
        return _referential(_V_NEONATAL_ELECTRODES, scalp, lambda e: members if e in members else False)
    if montage == "laplacian":
        def lap(e):
            nb = tuple(n for n in LAPLACIAN_NEIGHBOURS.get(e, []) if n in present)
            return nb if len(nb) >= 2 else False
        return _referential(_V_REFERENTIAL_ORDER, scalp, lap)
    raise ValueError(f"unknown montage {montage!r}")


def montage_breaks(montage: str, channels: Sequence[str]) -> "List[int] | None":
    """Row indices starting a new chain for a viewer montage; None for the legacy montages."""
    if montage not in VIEWER_MONTAGES:
        return None
    out, n = [], 0
    for rows in viewer_montage_chains(montage, channels):
        if n:
            out.append(n)
        n += len(rows)
    return out


def montage_display_name(montage: str) -> str:
    """Footer name: the viewer label for a viewer montage, else the legacy underscore-free id."""
    if montage in VIEWER_MONTAGES:
        return VIEWER_MONTAGES[montage][0]
    return montage.replace("_", " ")


def montage_pairs(montage: str, channels: Sequence[str]) -> List[Tuple[str, str | None]]:
    """Derivation list for an ``eeg_page`` montage.

    ``referential`` and ``average`` return ``(electrode, None)`` pairs; the
    renderer subtracts the appropriate reference itself.  Viewer montages (0.5.0) return
    ``(electrode, reference)`` with the reference an electrode or a tuple of electrodes (mean).
    """
    if montage in VIEWER_MONTAGES:
        return [p for rows in viewer_montage_chains(montage, channels) for p in rows]
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
    if isinstance(b, tuple):
        # 0.5.0 viewer suffixes: linked ears "-A12", Laplacian "-Lp", neonatal average "-Av"
        if montage == "laplacian":
            return f"{a}-Lp"
        if set(b) == {"A1", "A2"}:
            return f"{a}-A12"
        return f"{a}-Av"
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
    "left_mesial_temporal": ["F7", "T3", "Fp1"],
    "right_mesial_temporal": ["F8", "T4", "Fp2"],
    "left_parietal": ["P3", "C3", "T5"],
    "right_parietal": ["P4", "C4", "T6"],
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
    # Frontally maximal, and it reaches the rim.  The nine-generator version
    # this replaced held only F3 F4 C3 C4 T3 T4 P3 P4 Fz, so Fp1/Fp2/F7/F8/
    # T5/T6/O1/O2 were never sources - they saw only the Gaussian tail of a
    # neighbour.  Interior electrodes superpose several generators and boundary
    # electrodes one or two, which built in a 2.35x centre-to-rim gradient and
    # put Fp1/Fp2 near the floor of a discharge that is frontally maximal in
    # life.  ``GENERALIZED_FIELD`` below now pins the topography; these
    # generators supply the phase texture.
    "generalized":     [("Fz", 1.00, 0.00), ("F3", 0.98, 0.01), ("F4", 0.98, 0.02),
                        ("Fp1", 0.90, 0.00), ("Fp2", 0.90, 0.01), ("C3", 0.90, 0.04),
                        ("C4", 0.90, 0.03), ("Cz", 0.95, 0.02), ("F7", 0.80, 0.03),
                        ("F8", 0.80, 0.04), ("T3", 0.70, 0.06), ("T4", 0.70, 0.05),
                        ("P3", 0.72, 0.07), ("P4", 0.72, 0.07), ("Pz", 0.75, 0.06),
                        ("T5", 0.58, 0.09), ("T6", 0.58, 0.08), ("O1", 0.52, 0.10),
                        ("O2", 0.52, 0.10)],
    "midline":         [("Cz", 1.00, 0.00), ("Fz", 0.55, 0.06), ("Pz", 0.50, 0.09)],
    # 0.5.0 phase D: mesial temporal onset reads anterior temporal on the scalp (learningeeg atlas-l-temporal-focal-
    # seizure: rhythmic theta maximal at F7/T1 with T3; the posterior temporal chain joins later)
    "left_mesial_temporal":  [("F7", 1.00, 0.00), ("T3", 0.70, 0.06), ("Fp1", 0.30, -0.05)],
    "right_mesial_temporal": [("F8", 1.00, 0.00), ("T4", 0.70, 0.06), ("Fp2", 0.30, -0.05)],
    "left_parietal":   [("P3", 1.00, 0.00), ("C3", 0.30, -0.06), ("T5", 0.30, 0.07)],
    "right_parietal":  [("P4", 1.00, 0.00), ("C4", 0.30, -0.06), ("T6", 0.30, 0.07)],
}

#: 0.5.0 phase D (spec_version 3 ictal runs only): a sharper occipital source.  The v2 set put O1 1.0, T5 0.50 and
#: P3 0.45 almost in phase, so P3-O1 largely cancelled and the run read maximal in C3-P3 (phase D review: C3-P3
#: 2.3-3.8x against P3-O1 below it); learningeeg o1-onset-seizure-bipolar has the rhythm in P3-O1 and T5-O1.
REGION_GENERATORS_V3: Dict[str, List[Tuple[str, float, float]]] = {
    "left_occipital":  [("O1", 1.00, 0.00), ("T5", 0.25, 0.06), ("P3", 0.15, -0.04)],
    "right_occipital": [("O2", 1.00, 0.00), ("T6", 0.25, 0.06), ("P4", 0.15, -0.04)],
}

#: spec_version 3 (0.5.0, feature review seizures-icu B4-01..04): generators a focal ictal run RECRUITS over its
#: first seconds, on top of ``REGION_GENERATORS``.  The v2 sets kept a temporal seizure in F7-T3/T3-T5 for its
#: whole length; learningeeg L1/L2 show the whole ipsilateral chain involved about 10 s after onset with a leak
#: into the parasagittal chain.  Each extra source joins at a per-run delay (synth ``_seizure_block``).
FOCAL_RECRUIT_GENERATORS: Dict[str, List[Tuple[str, float, float]]] = {
    "left_temporal":   [("F7", 0.45, -0.18), ("T5", 0.45, 0.22), ("C3", 0.25, 0.05)],
    "right_temporal":  [("F8", 0.45, -0.18), ("T6", 0.45, 0.22), ("C4", 0.25, 0.05)],
    "left_frontal":    [("F7", 0.40, 0.16), ("C3", 0.30, 0.12), ("Fz", 0.30, 0.04)],
    "right_frontal":   [("F8", 0.40, 0.16), ("C4", 0.30, 0.12), ("Fz", 0.30, 0.04)],
    "left_central":    [("P3", 0.40, 0.18), ("Cz", 0.30, 0.05), ("T3", 0.30, 0.12)],
    "right_central":   [("P4", 0.40, 0.18), ("Cz", 0.30, 0.05), ("T4", 0.30, 0.12)],
    # (phase D: P3/Pz lowered from 0.35/0.25, which put an occipital run's maximum in C3-P3 / Cz-Pz by 10 s)
    "left_occipital":  [("T5", 0.40, 0.18), ("P3", 0.20, 0.12), ("Pz", 0.10, 0.05)],
    "right_occipital": [("T6", 0.40, 0.18), ("P4", 0.20, 0.12), ("Pz", 0.10, 0.05)],
    "left_mesial_temporal":  [("T3", 0.45, 0.10), ("T5", 0.35, 0.22), ("C3", 0.20, 0.05)],
    "right_mesial_temporal": [("T4", 0.45, 0.10), ("T6", 0.35, 0.22), ("C4", 0.20, 0.05)],
    "left_parietal":   [("O1", 0.35, 0.16), ("C3", 0.30, 0.10), ("Pz", 0.30, 0.04)],
    "right_parietal":  [("O2", 0.35, 0.16), ("C4", 0.30, 0.10), ("Pz", 0.30, 0.04)],
}

#: Intended scalp topography of a *generalized* discharge, peak 1.0.
#:
#: Generalized spike-and-wave is frontally maximal with a smooth
#: anterior-posterior decline - it is not flat, and it is certainly not
#: centre-maximal.  This is the target the synthesizer normalises onto, so the
#: waveform and the prose (`electrodes_for_region`) finally agree; before, the
#: two were computed from different models that disagreed.
GENERALIZED_FIELD: Dict[str, float] = {
    "Fp1": 0.90, "Fp2": 0.90,
    "F7": 0.80, "F3": 1.00, "Fz": 1.00, "F4": 1.00, "F8": 0.80,
    "T3": 0.65, "C3": 0.85, "Cz": 0.85, "C4": 0.85, "T4": 0.65,
    "T5": 0.55, "P3": 0.70, "Pz": 0.70, "P4": 0.70, "T6": 0.55,
    "O1": 0.50, "O2": 0.50,
}


def region_generators(region: str, channels: Sequence[str], v3: bool = False) -> List[Tuple[str, float, float]]:
    """Generators for ``region``, dropping foci the electrode array lacks (``v3``: the 0.5.0 ictal overrides)."""
    present = set(channels)
    table = REGION_GENERATORS_V3 if (v3 and region in REGION_GENERATORS_V3) else REGION_GENERATORS
    gens = [g for g in table[region] if g[0] in present]
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


#: Default monopole falloff.  See :func:`generator_falloff` for why the pinned
#: generalized field uses a sharper one.
DEFAULT_FALLOFF = 0.42

#: Sharper falloff for a pinned field.  ``generalized`` has 19 generators, so
#: at the default falloff every electrode is a weighted average of most of
#: them and each channel ends up a scaled copy of one waveform - which is
#: exactly what "too synchronous" looks like on a page.  Narrowing the falloff
#: lets each electrode be dominated by its two or three nearest generators, so
#: per-generator variation survives instead of averaging out.  The topography
#: is unaffected: ``generator_field_scale`` pins the sum either way.
PINNED_FALLOFF = 0.30


def generator_falloff(region: str) -> float:
    """Monopole falloff to use for ``region``'s generators."""
    return PINNED_FALLOFF if region in _PINNED_FIELDS else DEFAULT_FALLOFF


def monopole_weights(focus: str, channels: Sequence[str],
                     falloff: float = DEFAULT_FALLOFF, leak: float = 0.03) -> Dict[str, float]:
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
    "left_mesial_temporal": "right_mesial_temporal",
    "right_mesial_temporal": "left_mesial_temporal",
    "left_parietal": "right_parietal",
    "right_parietal": "left_parietal",
}

HEMISPHERE_OF_REGION: Dict[str, str] = {
    "left_temporal": "left", "left_frontal": "left", "left_central": "left",
    "left_occipital": "left", "left_hemisphere": "left",
    "right_temporal": "right", "right_frontal": "right", "right_central": "right",
    "right_occipital": "right", "right_hemisphere": "right",
    "generalized": "both", "midline": "both",
    "left_mesial_temporal": "left", "right_mesial_temporal": "right",
    "left_parietal": "left", "right_parietal": "right",
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
        return {ch: GENERALIZED_FIELD.get(ch, leak) for ch in channels}
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


#: Regions whose summed generator field is pinned to an explicit topography.
#: Deliberately only ``generalized``.  A *focal* region's generators are a
#: physiologically meaningful set of partially independent nearby sources, and
#: their superposition is what gives a focus its gradient and its phase reversal
#: on a bipolar montage; forcing those onto ``region_weights`` shifts a focal
#: field by up to 0.72 (left_hemisphere), which would silently rewrite the
#: left-temporal case Persyst has already lateralised correctly.  Generalized is
#: different: it had no rim generators at all, so its gradient was an artefact
#: of where the electrodes happen to sit.
_PINNED_FIELDS = ("generalized",)


def generator_field_scale(region: str, channels: Sequence[str]) -> List[float]:
    """Per-electrode correction making the generator sum match the intended field.

    A region's generators are summed as monopoles, so an electrode's amplitude
    depends on *how many* generators happen to reach it.  Interior electrodes
    accumulate from several and rim electrodes from one or two, which is an
    artefact of the electrode array's geometry rather than anything
    physiological.  For a region in :data:`_PINNED_FIELDS` this returns
    ``target / raw`` per electrode, so the summed field reproduces
    :func:`region_weights` while the generators keep supplying the phase
    structure.  Every other region returns ones and is left exactly as it was.

    Multiplying each generator's weight vector by this is identical to scaling
    the sum, because the sum is linear.
    """
    if region not in _PINNED_FIELDS:
        return [1.0] * len(channels)
    target = region_weights(region, channels)
    raw: Dict[str, float] = {ch: 0.0 for ch in channels}
    fall = generator_falloff(region)
    for focus, ga, _ in region_generators(region, channels):
        w = monopole_weights(focus, channels, falloff=fall)
        for ch in channels:
            raw[ch] += ga * w[ch]
    floor = (max(raw.values()) or 1.0) * 1e-6
    return [target[ch] / max(raw[ch], floor) for ch in channels]


def electrodes_for_region(region: str, channels: Sequence[str], top: int = 4) -> List[str]:
    """The electrodes a reader should point at for a generator in ``region``."""
    w = region_weights(region, channels)
    ranked = sorted(w.items(), key=lambda kv: -kv[1])
    keep = [ch for ch, val in ranked if val > 0.45]
    return keep[:top] if keep else [ranked[0][0]]
