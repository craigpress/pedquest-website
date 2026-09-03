"""Dataset loader interface and the adapter that feeds real data to the trends.

Only two datasets are permitted by content/qbank/IMAGE_SPEC.md and
docs/CASE_IMAGE_SOURCING_POLICY.md, both openly licensed:

* **CHB-MIT Scalp EEG Database** (PhysioNet) - ODC-BY 1.0
* **Helsinki neonatal EEG dataset** (Stevenson et al. 2019, Zenodo) - CC BY 4.0

A loader fetches *only the requested record* into ``tools/eeg-render/.cache/``
(gitignored) and returns it in the same shape the synthesizer produces, so the
identical trend pipeline runs over real and synthetic data.
"""

from __future__ import annotations

import os
import urllib.error
import urllib.request
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

from .. import montage as mt
from .edf import read_signals

CACHE_DIR = Path(__file__).resolve().parents[2] / ".cache"
DOWNLOAD_TIMEOUT_S = 120


class DatasetUnavailable(RuntimeError):
    """The record is neither cached nor downloadable from this machine."""


@dataclass
class DatasetRecord:
    data: np.ndarray            # (n_ch, n) microvolts
    fs: float
    labels: List[str]           # dataset channel names, in order
    record: str
    license: str
    attribution: str
    source_url: str = ""
    extra: Dict[str, object] = field(default_factory=dict)


class DatasetLoader(ABC):
    name: str = ""
    license: str = ""
    attribution: str = ""

    @abstractmethod
    def record_url(self, record: str) -> str:
        """Canonical download URL for one record."""

    @abstractmethod
    def cache_name(self, record: str) -> str:
        """File name this record is cached under."""

    @abstractmethod
    def channel_map(self, labels: Sequence[str]) -> Dict[str, str]:
        """Map dataset channel labels onto 10-20 electrode names."""

    # ------------------------------------------------------------------

    def cache_path(self, record: str, cache_dir: Optional[Path] = None) -> Path:
        return Path(cache_dir or CACHE_DIR) / self.name / self.cache_name(record)

    def ensure(self, record: str, cache_dir: Optional[Path] = None,
               allow_download: bool = True) -> Path:
        path = self.cache_path(record, cache_dir)
        if path.exists() and path.stat().st_size > 1024:
            return path
        url = self.record_url(record)
        if not allow_download or os.environ.get("EEG_RENDER_OFFLINE"):
            raise DatasetUnavailable(
                f"{self.name}: {record} is not cached at {path} and downloads are "
                f"disabled. Fetch it once with:\n    python -m eeg_render.datasets "
                f"fetch {self.name} {record}\nor download {url} to that path."
            )
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".part")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "eeg-render/0.1"})
            with urllib.request.urlopen(req, timeout=DOWNLOAD_TIMEOUT_S) as resp, \
                    open(tmp, "wb") as fh:
                while True:
                    chunk = resp.read(1 << 20)
                    if not chunk:
                        break
                    fh.write(chunk)
            tmp.replace(path)
        except (urllib.error.URLError, urllib.error.HTTPError, OSError, TimeoutError) as exc:
            tmp.unlink(missing_ok=True)
            raise DatasetUnavailable(
                f"{self.name}: could not download {record} from {url} ({exc}). "
                f"Download it manually to {path} and re-run; nothing else is needed."
            ) from exc
        return path

    def load(self, record: str, start_s: float = 0.0, duration_s: float = 60.0,
             cache_dir: Optional[Path] = None,
             allow_download: bool = True) -> DatasetRecord:
        path = self.ensure(record, cache_dir, allow_download)
        data, fs, labels = read_signals(path, start_s, duration_s)
        return DatasetRecord(data=data, fs=fs, labels=labels, record=record,
                             license=self.license, attribution=self.attribution,
                             source_url=self.record_url(record))


# --------------------------------------------------------------------------
# adapter: a DatasetRecord that looks like a Synthesizer to the trend pipeline
# --------------------------------------------------------------------------

class DatasetSource:
    """Duck-types :class:`eeg_render.synth.Synthesizer` over recorded data.

    ``compute_trends`` only needs ``fs``, ``spec``, ``scalp``, ``_idx``,
    ``segment`` and ``derive``, so real records go through exactly the same
    spectrogram / rhythmicity / aEEG / suppression maths as synthetic ones.
    """

    def __init__(self, rec: DatasetRecord, loader: DatasetLoader, spec: Dict,
                 t0_s: float = 0.0):
        self.record = rec
        self.loader = loader
        self.spec = spec
        self.fs = int(round(rec.fs))
        self.t0_s = t0_s
        self.duration_s = rec.data.shape[1] / rec.fs

        mapping = loader.channel_map(rec.labels)
        rows: Dict[str, np.ndarray] = {}
        for i, lbl in enumerate(rec.labels):
            elec = mapping.get(lbl)
            if elec and elec not in rows:
                rows[elec] = rec.data[i]
        if not rows:
            raise DatasetUnavailable(
                f"{loader.name}: none of {rec.labels} mapped onto 10-20 electrodes"
            )
        self.scalp = [e for e in mt.STANDARD_19 if e in rows] or list(rows)
        self.electrodes = list(self.scalp)
        for ref in mt.REFERENCE_ELECTRODES:
            if ref not in self.electrodes:
                self.electrodes.append(ref)
                rows[ref] = np.zeros_like(rec.data[0])
        self._idx = {e: i for i, e in enumerate(self.electrodes)}
        self._data = np.vstack([rows[e] for e in self.electrodes])

    def segment(self, t0: float, t1: float) -> Tuple[np.ndarray, np.ndarray]:
        fs = self.fs
        i0 = int(round(t0 * fs))
        n = max(1, int(round((t1 - t0) * fs)))
        total = self._data.shape[1]
        idx = np.clip(np.arange(i0, i0 + n), 0, total - 1)   # edge-hold outside
        t = (i0 + np.arange(n)) / fs
        return t, self._data[:, idx]

    def derive(self, x: np.ndarray, pairs, montage: str = "longitudinal_bipolar") -> np.ndarray:
        rows = []
        avg = x[[self._idx[c] for c in self.scalp], :].mean(axis=0)
        for a, b in pairs:
            ia = self._idx[a]
            if b is not None:
                rows.append(x[ia] - x[self._idx[b]])
            elif montage == "average":
                rows.append(x[ia] - avg)
            else:
                rows.append(x[ia])
        return np.asarray(rows)

    def _ecg(self, t: np.ndarray, amplitude: float = 0.0) -> np.ndarray:
        return np.zeros((len(self.electrodes), t.size))


# --------------------------------------------------------------------------

_REGISTRY: Dict[str, DatasetLoader] = {}


def register(loader: DatasetLoader) -> DatasetLoader:
    _REGISTRY[loader.name] = loader
    return loader


def get_loader(name: str) -> DatasetLoader:
    from . import chbmit, helsinki  # noqa: F401  (populate the registry)
    try:
        return _REGISTRY[name]
    except KeyError as exc:
        raise ValueError(
            f"unknown dataset {name!r}; permitted: {sorted(_REGISTRY)}"
        ) from exc
