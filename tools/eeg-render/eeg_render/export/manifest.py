"""Recording identity, block streaming, and the realized-event answer key."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from typing import Dict, Iterator, List, Optional, Sequence, Tuple

import numpy as np

from .. import RENDERER_VERSION
from ..spec import canonical_json, spec_hash
from ..synth import Synthesizer

#: Streaming block length and the margin trimmed from each side.  The margin
#: exists for the one filter in ``segment`` that settles against its input block
#: (see the partition-independence note in ``synth.py``); ``compute_trends`` uses
#: the same 12 s for the same reason.
BLOCK_S = 300.0
MARGIN_S = 12.0

#: The synthesizer's reference convention, recorded so a consumer never has to
#: guess what the voltages are relative to.
REFERENCE = "ideal-common-reference; A1/A2 synthesized, not neutral"


@dataclass(frozen=True)
class Recording:
    """Everything that has to match for two exports to be the same recording.

    Duration belongs here, not in a transport option: constructing the
    synthesizer with a different ``duration_s`` renormalises the slow
    amplitude-modulation grids and changes samples everywhere, including at
    t=0.  A recording is a spec *and* a horizon.
    """

    spec_hash: str
    renderer_version: str
    duration_s: float
    sample_rate: int
    channels: Tuple[str, ...]
    reference: str = REFERENCE

    @property
    def n_samples(self) -> int:
        return int(round(self.duration_s * self.sample_rate))

    @property
    def recording_id(self) -> str:
        payload = canonical_json({
            "renderer": self.renderer_version,
            "spec_hash": self.spec_hash,
            "duration_s": self.duration_s,
            "sample_rate": self.sample_rate,
            "channels": list(self.channels),
            "reference": self.reference,
        }).encode("utf-8")
        return "sha256:" + hashlib.sha256(payload).hexdigest()

    def as_dict(self) -> Dict:
        return {
            "recording_id": self.recording_id,
            "spec_hash": self.spec_hash,
            "renderer_version": self.renderer_version,
            "duration_s": self.duration_s,
            "sample_rate": self.sample_rate,
            "channels": list(self.channels),
            "reference": self.reference,
        }


def recording_for(image: Dict, synth: Synthesizer, duration_s: float,
                  extra_channels: Sequence[str] = ()) -> Recording:
    """Identity for an export of ``synth`` over ``[0, duration_s)``."""
    return Recording(
        spec_hash=spec_hash(image),
        renderer_version=RENDERER_VERSION,
        duration_s=float(duration_s),
        sample_rate=int(synth.fs),
        channels=tuple(list(synth.electrodes) + list(extra_channels)),
    )


def iter_blocks(synth: Synthesizer, n_samples: int,
                block_s: float = BLOCK_S,
                margin_s: float = MARGIN_S) -> Iterator[Tuple[int, np.ndarray]]:
    """Yield ``(start_sample, block)`` covering ``[0, n_samples)`` in microvolts.

    Each request is widened by ``margin_s`` on both sides and trimmed back, so
    the filter that settles against its input block sees context rather than an
    edge.  Boundaries are integer sample counts; ``segment`` rounds ``t0*fs``
    independently, and drifting by one sample would defeat the point.
    """
    fs = synth.fs
    block_n = max(1, int(round(block_s * fs)))
    margin_n = max(0, int(round(margin_s * fs)))
    total_n = int(round(synth.duration_s * fs))

    start = 0
    while start < n_samples:
        stop = min(start + block_n, n_samples)
        lo = max(0, start - margin_n)
        hi = min(total_n, stop + margin_n)
        _, wide = synth.segment(lo / fs, hi / fs)
        if wide.shape[1] != hi - lo:          # segment rounds independently
            wide = wide[:, : hi - lo]
        yield start, wide[:, start - lo: stop - lo]
        start = stop


# --------------------------------------------------------------------------
# realized events
# --------------------------------------------------------------------------

def _row(kind: str, onset_s: float, offset_s: float, fs: int,
         duration_s: float, **detail) -> Dict:
    """One answer-key entry, clipped to the recording and indexed in samples."""
    a = max(0.0, float(onset_s))
    b = min(float(duration_s), float(offset_s))
    out = {
        "kind": kind,
        "onset_s": round(a, 6),
        "offset_s": round(b, 6),
        "onset_sample": int(round(a * fs)),
        "offset_sample": int(round(b * fs)),
        "clipped_at_start": onset_s < 0.0,
        "clipped_at_end": offset_s > duration_s,
        # What the generator was told to produce.  Whether a reader would call
        # it that on inspection is a separate, unverified question.
        "label_type": "commanded",
    }
    out.update(detail)
    return out


def realized_events(synth: Synthesizer, duration_s: float) -> List[Dict]:
    """Events as the synthesizer actually realized them.

    Not the spec, and not the image sidecar.  Cluster members carry jittered
    onsets and interpolated durations, rhythmic-pattern runs are expanded into
    individual instances, and a ramped attenuation's sidecar box deliberately
    covers the ramp rather than the event -- so neither of those sources
    describes where the signal actually changed.
    """
    fs = int(synth.fs)
    rows: List[Dict] = []

    for inst in synth.seizures:
        if inst.t1 < 0.0 or inst.t0 > duration_s:
            continue
        rows.append(_row(
            inst.kind, inst.t0, inst.t1, fs, duration_s,
            onset_region=inst.onset_region,
            spread=inst.spread,
            morphology=inst.morph,
            start_hz=round(float(inst.start_hz), 4),
            end_hz=round(float(inst.end_hz), 4),
            amplitude_start_uv=round(float(inst.amp_start), 3),
            amplitude_end_uv=round(float(inst.amp_end), 3),
            postictal_s=round(float(inst.postictal_s), 3),
            spec_event_index=int(inst.index),
            cluster_ordinal=int(inst.ordinal),
        ))
        # EEG Atlas P5: ACNS advisories travel with the key, never change the signal
        if inst.kind == "brd":
            rows[-1]["acns_advisory"] = ("brief rhythmic discharge: evolving rhythmic activity shorter than "
                                        "the 10-s neonatal seizure minimum")
        elif synth.age == "neonate" and inst.kind in ("seizure", "seizure_cluster") and (inst.t1 - inst.t0) < 10.0:
            rows[-1]["acns_advisory"] = ("shorter than the 10-s ACNS neonatal electrographic seizure minimum; "
                                        "consider type brd")

    for ev in getattr(synth, "artifacts", []):
        a0 = float(ev["at_min"]) * 60.0
        a1 = a0 + float(ev["duration_s"])
        if a1 < 0.0 or a0 > duration_s:
            continue
        rows.append(_row(
            "artifact", a0, a1, fs, duration_s,
            artifact_kind=ev.get("kind"),
            intensity=ev.get("intensity"),
            side=ev.get("side"),
            channels=list(ev.get("channels") or []),
        ))

    for at, dur, side, depth, ramp, delta_depth in getattr(synth, "_atten", []):
        if at + dur < 0.0 or at > duration_s:
            continue
        rows.append(_row(
            "attenuation_transient", at, at + dur, fs, duration_s,
            side=side,
            depth_pct=round(float(depth) * 100.0, 3),
            delta_depth_pct=round(float(delta_depth) * 100.0, 3),
            ramp_min=round(float(ramp) / 60.0, 4),
        ))

    # Control events that change the background without producing a discrete
    # graphoelement.  They are not in synth.seizures, synth.artifacts or
    # synth._atten, so without this pass a sedation change or a rewarming -- the
    # very thing a trend question is often about -- is missing from the key.
    for i, ev in enumerate(synth.spec.get("events") or []):
        kind = ev.get("type")
        if kind == "sedation_change":
            at = float(ev["at_min"]) * 60.0
            effect = ev.get("effect") or {}
            ramp_s = float(effect.get("ramp_min") or 0.0) * 60.0
            if at + ramp_s < 0.0 or at > duration_s:
                continue
            rows.append(_row(kind, at, at + ramp_s, fs, duration_s,
                             direction=ev.get("direction"), agent=ev.get("agent"),
                             effect=effect, spec_event_index=i))
        elif kind == "temperature_change":
            at = float(ev["at_min"]) * 60.0
            over_s = float(ev.get("over_min") or 0.0) * 60.0
            if at + over_s < 0.0 or at > duration_s:
                continue
            rows.append(_row(kind, at, at + over_s, fs, duration_s,
                             from_c=ev.get("from_c"), to_c=ev.get("to_c"),
                             spec_event_index=i))
        elif kind in ("stimulation", "state_change"):
            at = float(ev["at_min"]) * 60.0
            if at < 0.0 or at > duration_s:
                continue
            rows.append(_row(kind, at, at, fs, duration_s,
                             to=ev.get("to"), spec_event_index=i))

    for ann in synth.spec.get("annotations") or []:
        at = float(ann["at_min"]) * 60.0
        if at < 0.0 or at > duration_s:
            continue
        rows.append(_row("annotation", at, at, fs, duration_s,
                         label=str(ann.get("label", ""))))

    rows.sort(key=lambda r: (r["onset_s"], r["kind"]))
    return rows


def build_manifest(synth: Synthesizer, recording: Recording,
                   *, clipped_samples: int = 0,
                   files: Optional[Dict[str, str]] = None) -> Dict:
    """The instructor-side answer key for an exported recording."""
    return {
        "recording": recording.as_dict(),
        "synthetic": True,
        "notice": "SYNTHETIC RECORDING - NOT A PATIENT RECORDING. Not for clinical use.",
        "quantization": {"clipped_samples": int(clipped_samples)},
        "files": dict(files or {}),
        "events": realized_events(synth, recording.duration_s),
    }
