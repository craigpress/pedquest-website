"""Helsinki neonatal EEG dataset loader (Zenodo, CC BY 4.0).

Stevenson NJ, Tapani K, Lauronen L, Vanhatalo S. "A dataset of neonatal EEG
recordings with seizure annotations." Sci Data 6:190039 (2019).
Zenodo record 2547147; files are ``eeg1.edf`` ... ``eeg79.edf`` in a 19-channel
10-20 referential montage.
"""

from __future__ import annotations

import re
from typing import Dict, Sequence

from .base import DatasetLoader, register
from .chbmit import canonical

ZENODO_RECORD = "2547147"
BASE_URL = f"https://zenodo.org/records/{ZENODO_RECORD}/files"

ATTRIBUTION = (
    "Helsinki neonatal EEG dataset - Stevenson NJ, Tapani K, Lauronen L, "
    "Vanhatalo S, Sci Data 2019;6:190039 (Zenodo 10.5281/zenodo.2547147), CC BY 4.0"
)


class HelsinkiNeonatalLoader(DatasetLoader):
    name = "helsinki-neonatal"
    license = "CC BY 4.0"
    attribution = ATTRIBUTION

    def record_url(self, record: str) -> str:
        rec = record if record.lower().endswith(".edf") else f"{record}.edf"
        return f"{BASE_URL}/{rec}?download=1"

    def cache_name(self, record: str) -> str:
        rec = record[:-4] if record.lower().endswith(".edf") else record
        return f"{rec}.edf"

    def channel_map(self, labels: Sequence[str]) -> Dict[str, str]:
        """``EEG Fp1-REF`` -> Fp1 (the file is referential, so this is direct)."""
        out: Dict[str, str] = {}
        used: set = set()
        for lbl in labels:
            token = re.sub(r"(?i)^eeg\s*", "", lbl).split("-")[0]
            elec = canonical(token)
            if elec and elec not in used:
                out[lbl] = elec
                used.add(elec)
        return out


register(HelsinkiNeonatalLoader())


#: PhysioNet also hosts open neonatal collections; the DSL allows the name but
#: no specific record set is wired up yet, so it fails loudly rather than
#: silently rendering something unattributed.
class PhysionetNeonatalLoader(DatasetLoader):
    name = "physionet-neonatal-eeg"
    license = "see the record's PhysioNet page"
    attribution = "PhysioNet neonatal EEG collection"

    def record_url(self, record: str) -> str:
        return f"https://physionet.org/files/{record}"

    def cache_name(self, record: str) -> str:
        return record.replace("/", "_") + ".edf"

    def channel_map(self, labels: Sequence[str]) -> Dict[str, str]:
        out: Dict[str, str] = {}
        used: set = set()
        for lbl in labels:
            elec = canonical(re.sub(r"(?i)^eeg\s*", "", lbl).split("-")[0])
            if elec and elec not in used:
                out[lbl] = elec
                used.add(elec)
        return out


register(PhysionetNeonatalLoader())
