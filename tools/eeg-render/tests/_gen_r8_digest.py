"""Digests of the generalized features Craig accepted in the 2026-09-28 review (shared by test_r050_gen_r8.py)."""
import hashlib

import numpy as np

from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer

CHILD = dict(type="continuous", amplitude_uv=40.0, dominant_hz=9.0, slow_fraction=0.4, reactivity="present",
             channel_gain_max=1.5)
AT = 2.0


def _gs(st, at=AT + 4 / 60, **kw):
    return dict(type="generalized_seizure", seizure_type=st, onset_min=at, **kw)


def _gd(pat, **kw):
    return dict(type="generalized_discharges", pattern=pat, **kw)


#: name -> (seed, age, events); the seeds and events of research/eeg-atlas/generalized-review-20260928/current/indep.py
ACCEPTED = {
    "typical_absence": (26092601, "child", [_gs("typical_absence", duration_s=8.0)]),
    "myoclonic": (26092603, "adolescent", [_gs("myoclonic", count=3, interval_s=4.0)]),
    "myoclonic_atonic": (26092604, "child", [_gs("myoclonic_atonic", count=2, interval_s=6.0)]),
    "myoclonic_tonic": (26092605, "child", [_gs("myoclonic_tonic", count=2, interval_s=6.0)]),
    "atonic": (26092607, "child", [_gs("atonic", at=AT + 5 / 60)]),
    "interictal_gsw": (26092611, "adolescent", [_gd("spike_wave", rate_per_h=600)]),
    "interictal_psw_jme": (26092612, "adolescent", [_gd("polyspike_wave", rate_per_h=600)]),
}


def digest(name: str) -> str:
    """SHA-256 of the whole synthesized record (every electrode, 10 decimals) over the reviewed page, 2:00-2:15."""
    seed, age, events = ACCEPTED[name]
    img = {"kind": "eeg_page", "license": "synthetic-original", "attribution": None,
           "spec": {"sample_rate": 256, "channels": "standard_19", "duration_min": 10, "spec_version": 3,
                    "seed": seed, "age_group": age, "background": CHILD, "events": events, "at_min": AT,
                    "window_s": 15.0, "sensitivity_uv_mm": 15.0, "montage": "longitudinal_bipolar"}}
    spec = normalize(img)["spec"]
    syn = Synthesizer(spec, 600.0)
    _t, x = syn.segment(AT * 60.0, AT * 60.0 + 15.0)
    t = AT * 60.0 + np.arange(x.shape[1]) / syn.fs
    emg = syn.emg_channel(t) if hasattr(syn, "emg_channel") else None
    h = hashlib.sha256(np.round(x, 10).tobytes())
    if emg is not None:
        h.update(np.round(np.asarray(emg), 10).tobytes())
    return h.hexdigest()


if __name__ == "__main__":
    for k in ACCEPTED:
        print(f'    "{k}": "{digest(k)}",')
