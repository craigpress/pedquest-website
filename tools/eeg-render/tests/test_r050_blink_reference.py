"""0.5.0 blink contract: the displayed Fp1-F3 blink matches blinks measured in published teaching figures.

Reference: 15 blinks digitized from 6 learningeeg.com atlas figures (longitudinal bipolar, grid-calibrated time axis
checked against the PDR or ECG rate), research/eeg-atlas/feature-review-20260926/artifacts.md section 1c.
Values are peak-normalised amplitude at the given ms from the peak.
"""
import numpy as np

from eeg_render.render_page import page_signals
from eeg_render.spec import normalize

MS = [-120, -100, -80, -60, -40, -20, 0, 20, 40, 60, 80, 100, 150, 200, 300, 400]
REF_LO = [-.10, -.06, -.01, .15, .42, .67, 1, .51, .14, -.04, -.40, -.81, -1.21, -1.12, -.69, -.38]
REF_HI = [.08, .13, .31, .59, .89, .98, 1, .94, .67, .57, .44, .31, -.01, -.08, 0, .01]
IQR_LO = [-.02, .01, .05, .22, .57, .77, 1, .78, .40, .11, -.20, -.25, -.53, -.50, -.36, -.24]
IQR_HI = [.04, .05, .18, .42, .70, .91, 1, .84, .48, .26, .09, -.03, -.24, -.28, -.20, -.12]


def _page(version):
    img = {"kind": "eeg_page", "license": "synthetic-original", "attribution": None,
           "spec": {"sample_rate": 256, "channels": "standard_19", "seed": 90511, "spec_version": version,
                    "age_group": "adult", "duration_min": 10, "at_min": 2.0, "window_s": 30.0,
                    "background": {"type": "continuous", "amplitude_uv": 30.0, "dominant_hz": 10.0,
                                   "slow_fraction": 0.2, "reactivity": "present", "blink_rate_per_min": 20.0},
                    "events": []}}
    spec = normalize(img)["spec"]
    synth, t, sig, pairs, _ = page_signals(spec)
    return spec, synth, t, sig, pairs


def _median_blink(version):
    spec, synth, t, sig, pairs = _page(version)
    row = next(i for i, p in enumerate(pairs) if tuple(p) == ("Fp1", "F3"))
    x = sig[row]                            # derivation value (positive = Fp1 more positive)
    fs = synth.fs
    peaks = synth._blink_t + 0.10
    iso = [p for i, p in enumerate(peaks)
           if t[0] + 0.5 < p < t[-1] - 0.6
           and (i == 0 or p - peaks[i - 1] > 1.2) and (i == len(peaks) - 1 or peaks[i + 1] - p > 1.2)]
    assert len(iso) >= 4, "not enough isolated blinks on the page"
    waves = []
    for p in iso:
        k = int(round((p - t[0]) * fs))
        seg = x[k - int(0.05 * fs):k + int(0.05 * fs)]
        k = k - int(0.05 * fs) + int(np.argmax(seg))
        base = np.median(x[max(0, k - int(0.5 * fs)):k - int(0.2 * fs)])
        w = np.array([x[k + int(round(m / 1000 * fs))] for m in MS]) - base
        waves.append(w / w[MS.index(0)])
    return np.median(np.array(waves), axis=0)


def test_v3_blink_matches_reference_shape():
    w = _median_blink(3)
    out = [(m, round(float(v), 2)) for m, v, lo, hi in zip(MS, w, REF_LO, REF_HI) if not lo - 0.05 <= v <= hi + 0.05]
    assert not out, f"outside the reference range: {out}"
    in_iqr = sum(lo - 0.05 <= v <= hi + 0.05 for v, lo, hi in zip(w, IQR_LO, IQR_HI))
    assert in_iqr >= 9, (in_iqr, np.round(w, 2).tolist())


def test_v3_has_no_pre_blink_opposite_lobe_and_v2_does():
    assert _median_blink(3)[:3].min() > -0.08
    assert _median_blink(2)[:3].min() < -0.15


def test_v3_blink_field_ratios():
    """Longitudinal bipolar ratios measured in the references: Fp1-F7 > Fp1-F3 and F7-T3 small."""
    spec, synth, t, sig, pairs = _page(3)
    field = dict(zip(synth.electrodes, synth._blink_field()))
    fp1f3 = field["Fp1"] - field["F3"]
    fp1f7 = field["Fp1"] - field["F7"]
    f7t3 = field["F7"] - field["T3"]
    assert fp1f7 > fp1f3
    assert 0.10 <= f7t3 / fp1f7 <= 0.36
