"""CHB-MIT Scalp EEG Database loader (PhysioNet, ODC-BY 1.0).

Pediatric scalp EEG from Children's Hospital Boston.  Records are named
``chbNN_XX`` (e.g. ``chb01_03``) and live under ``chbNN/`` on PhysioNet.
Channels are already bipolar 10-20 pairs such as ``FP1-F7``.
"""

from __future__ import annotations

import re
from typing import Dict, Sequence

from .base import DatasetLoader, register

BASE_URL = "https://physionet.org/files/chbmit/1.0.0"

ATTRIBUTION = (
    "CHB-MIT Scalp EEG Database (Shoeb A, Guttag J; Goldberger et al., PhysioNet), "
    "ODC-BY 1.0"
)

#: dataset labels are bipolar pairs; the adapter needs single electrodes, so a
#: pair contributes its *first* electrode (the chain is reconstructed from the
#: 10-20 array afterwards).  ``T7/P7/T8/P8`` are the 10-10 aliases of T3/T5/T4/T6.
ALIASES = {"T7": "T3", "P7": "T5", "T8": "T4", "P8": "T6",
           "FP1": "Fp1", "FP2": "Fp2", "FZ": "Fz", "CZ": "Cz", "PZ": "Pz"}

_CANON = {e.upper(): e for e in
          ["Fp1", "Fp2", "F7", "F3", "Fz", "F4", "F8", "T3", "C3", "Cz", "C4",
           "T4", "T5", "P3", "Pz", "P4", "T6", "O1", "O2"]}


def canonical(name: str) -> str | None:
    n = re.sub(r"[^A-Za-z0-9]", "", name).upper()
    n = ALIASES.get(n, n)
    return _CANON.get(n.upper()) or (n if n in _CANON.values() else None)


class ChbMitLoader(DatasetLoader):
    name = "chb-mit"
    license = "ODC-BY 1.0"
    attribution = ATTRIBUTION

    def record_url(self, record: str) -> str:
        subject = record.split("_")[0]
        return f"{BASE_URL}/{subject}/{record}.edf"

    def cache_name(self, record: str) -> str:
        return f"{record}.edf"

    def channel_map(self, labels: Sequence[str]) -> Dict[str, str]:
        """``FP1-F7`` -> Fp1 for the first occurrence of each electrode.

        CHB-MIT ships bipolar derivations, so the adapter reconstructs a
        pseudo-referential array by taking each pair's leading electrode.  The
        trend pipeline then re-derives its own chains from that array, which
        keeps the maths identical to the synthetic path.  This is an
        approximation and is recorded as such in the sidecar.
        """
        out: Dict[str, str] = {}
        used: set = set()
        for lbl in labels:
            head = lbl.split("-")[0]
            elec = canonical(head)
            if elec and elec not in used:
                out[lbl] = elec
                used.add(elec)
        return out


register(ChbMitLoader())
