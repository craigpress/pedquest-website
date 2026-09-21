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
    # 0.4.4: state rows hand numpy scalars in; a numpy bool in the key breaks json.dumps in the exporter
    onset_s = float(onset_s)
    offset_s = float(offset_s)
    duration_s = float(duration_s)
    a = max(0.0, float(onset_s))
    b = min(float(duration_s), float(offset_s))
    out = {
        "kind": kind,
        "onset_s": round(a, 6),
        "offset_s": round(b, 6),
        "onset_sample": int(round(a * fs)),
        "offset_sample": int(round(b * fs)),
        "clipped_at_start": bool(onset_s < 0.0),
        "clipped_at_end": bool(offset_s > duration_s),
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

    # P7 batch 5: every sporadic discharge is keyed (onset = spike peak - 40 ms)
    for sd in (synth.sporadic_events() if hasattr(synth, "sporadic_events") else []):
        a0 = sd["t0"] - 0.04
        a1 = sd["t0"] + (0.55 if sd["aftergoing_slow"] else 0.12) * sd["width"] + (0.11 if sd["morphology"] == "polyspike" else 0.0)
        if a1 < 0.0 or a0 > duration_s:
            continue
        rows.append(_row("sporadic_discharge", a0, a1, fs, duration_s,
                         focus=sd["focus"], morphology=sd["morphology"], aftergoing_slow=sd["aftergoing_slow"],
                         amplitude_uv=round(sd["amplitude_uv"], 1), spec_event_index=sd["index"]))
    # P7 batch 5: pediatric normal variants, each run keyed as a normal (non-epileptiform) finding
    for vr in (synth.variant_runs() if hasattr(synth, "variant_runs") else []):
        if vr["t1"] < 0.0 or vr["t0"] > duration_s:
            continue
        rows.append(_row("normal_variant", vr["t0"], vr["t1"], fs, duration_s,
                         variant=vr["variant"], frequency_hz=round(vr["frequency_hz"], 2),
                         amplitude_uv=round(vr["amplitude_uv"], 1), count=vr["count"], normal_variant=True))

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
            extra = {}
            if kind == "stimulation":
                # P7 batch 2: the response is part of the key, not something the reader infers
                extra["response"] = str(synth.bg.get("reactivity", "present"))
            rows.append(_row(kind, at, at, fs, duration_s,
                             to=ev.get("to"), spec_event_index=i, **extra))

    # P7 batch 2: CAPE cycles and the awake/sleep timeline of a state_change record are keyed too
    for a, b, depth in synth.cape_cycles():
        if b < 0.0 or a > duration_s:
            continue
        rows.append(_row("cape_cycle", a, b, fs, duration_s, depth=round(float(depth), 3)))
    if not getattr(synth, "_state_intervals", None) and any(e.get("type") == "state_change" for e in synth.spec.get("events", [])):
        bp = list(zip(synth._state_t, synth._state_v))
        for k, (t0, v) in enumerate(bp):
            t1 = bp[k + 1][0] if k + 1 < len(bp) else duration_s
            if t1 <= t0 or t1 < 0.0 or t0 > duration_s:
                continue
            rows.append(_row("state", t0, t1, fs, duration_s, label="sleep" if v >= 0.5 else "awake"))

    # P7 batch 1: the behavioral-state timeline is part of the key when a state cycle is scheduled
    for t0, t1, label in getattr(synth, "_state_intervals", []) or []:
        if t1 < 0.0 or t0 > duration_s:
            continue
        rows.append(_row("state", t0, t1, fs, duration_s, label=label))

    for ann in synth.spec.get("annotations") or []:
        at = float(ann["at_min"]) * 60.0
        if at < 0.0 or at > duration_s:
            continue
        rows.append(_row("annotation", at, at, fs, duration_s,
                         label=str(ann.get("label", ""))))

    # P7 batch 4: clinical correlate travels with every ictal row (a non-EEG key field)
    events_spec = synth.spec.get("events", [])
    for r in rows:
        if r["kind"] in ("seizure", "seizure_cluster", "status_epilepticus", "spasm", "spasm_cluster", "tonic_seizure"):
            i = r.get("spec_event_index")
            corr = str((events_spec[i] if i is not None and i < len(events_spec) else {}).get("clinical_correlate") or "none")
            r["clinical_correlate"] = corr
            r["electroclinical"] = corr not in ("none", "unknown")
    rows.sort(key=lambda r: (r["onset_s"], r["kind"]))
    return rows


ICTAL_KINDS = ("seizure", "seizure_cluster", "status_epilepticus", "spasm", "spasm_cluster", "tonic_seizure")


def acns_prevalence(count: int, duration_s: float) -> str:
    """ACNS 2021 sporadic epileptiform discharge prevalence from a realized count over ``duration_s``.

    abundant >= 1 per 10 s; frequent >= 1/min; occasional >= 1/h; rare < 1/h (a record shorter than an
    hour cannot realize "rare": the category is over the record actually keyed).
    """
    if count <= 0:
        return "none"
    per_h = count / max(duration_s / 3600.0, 1e-9)
    if per_h >= 360.0:
        return "abundant"
    if per_h >= 60.0:
        return "frequent"
    if per_h >= 1.0:
        return "occasional"
    return "rare"


def sporadic_summary(rows: List[Dict], duration_s: float) -> List[Dict]:
    """Per sporadic_discharges event: realized count, rates and the ACNS prevalence category."""
    out: Dict[int, Dict] = {}
    for r in rows:
        if r["kind"] != "sporadic_discharge":
            continue
        i = int(r["spec_event_index"])
        s = out.setdefault(i, {"spec_event_index": i, "focus": r["focus"], "morphology": r["morphology"], "count": 0})
        s["count"] += 1
    for s in out.values():
        s["per_hour"] = round(s["count"] / max(duration_s / 3600.0, 1e-9), 2)
        s["per_minute"] = round(s["count"] / max(duration_s / 60.0, 1e-9), 3)
        s["acns_prevalence"] = acns_prevalence(s["count"], duration_s)
    return [out[k] for k in sorted(out)]


def _summary(synth, duration_s: float) -> Dict:
    rows = realized_events(synth, duration_s)
    out = {"seizure_burden": seizure_burden(rows, duration_s, synth.age)}
    sp = sporadic_summary(rows, duration_s)
    if sp:
        out["sporadic_discharges"] = sp
    return out


def seizure_burden(rows: List[Dict], duration_s: float, age: str = "") -> Dict:
    """Seizure burden and status flags from the realized key (P7 batch 4).

    ACNS 2021 (children and adults): electrographic status = a seizure >= 10 min, or seizures >= 20 % of any
    60-min window; nonconvulsive when no ictal row carries a clinical correlate.  A neonate is judged by the
    ACNS neonatal criterion only: status = seizures >= 50 % of any 60-min window (status_basis burden_neonatal).  Windows slide over the record in 10-s steps; a record
    shorter than an hour is one window.
    """
    import numpy as np
    ict = [r for r in rows if r["kind"] in ICTAL_KINDS and r["offset_s"] > r["onset_s"]]
    total = float(sum(r["offset_s"] - r["onset_s"] for r in ict))
    longest = float(max((r["offset_s"] - r["onset_s"] for r in ict), default=0.0))
    win = min(3600.0, float(duration_s))
    max_frac = 0.0
    if ict and win > 0:
        for start in np.arange(0.0, max(duration_s - win, 0.0) + 1e-9, 10.0):
            end = start + win
            cov = sum(max(0.0, min(r["offset_s"], end) - max(r["onset_s"], start)) for r in ict)
            max_frac = max(max_frac, cov / win)
    if age == "neonate":
        basis = "burden_neonatal" if max_frac >= 0.50 else None
    else:
        basis = "duration" if longest >= 600.0 else ("burden" if max_frac >= 0.20 else None)
    status = basis is not None
    nonconvulsive = bool(status and all(not r.get("electroclinical", False) for r in ict))
    return {"count": len(ict), "total_s": round(total, 1), "longest_s": round(longest, 1),
            "max_hour_fraction": round(float(max_frac), 4), "window_s": win,
            "electrographic_status": status, "status_basis": basis, "nonconvulsive": nonconvulsive,
            "neonatal_status": bool(age == "neonate" and basis == "burden_neonatal")}


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
        "summary": _summary(synth, recording.duration_s),
    }
