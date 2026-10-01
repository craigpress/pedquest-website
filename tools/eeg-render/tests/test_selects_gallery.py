import numpy as np

from eeg_render import montage as mt
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer


def test_bilateral_selects_triphasic_dipole_in_both_montages():
    image = {"kind": "eeg_page", "license": "synthetic-original", "attribution": None,
             "spec": {"spec_version": 3, "seed": 30092621, "age_group": "child", "sample_rate": 256,
                      "duration_min": 30, "background": {"type": "continuous", "amplitude_uv": 45,
                                                           "blink_rate_per_min": 0},
                      "events": [{"type": "state_change", "at_min": 2, "to": "sleep"},
                                 {"type": "sporadic_discharges", "focus": "right_centrotemporal",
                                  "foci": ["left_centrotemporal", "right_centrotemporal"],
                                  "focus_weights": [.5, .5], "synchrony": "independent",
                                  "morphology": "sharp_wave", "centrotemporal_triphasic": True,
                                  "rate_per_h": 300, "amplitude_uv": 180, "sleep_activation": 8}]}}
    s = Synthesizer(normalize(image)["spec"], 1800)
    events = [r for r in s.sporadic_events() if 150 < r["t0"] < 170]
    assert {r["focus"] for r in events} == {"left_centrotemporal", "right_centrotemporal"}
    assert all(r["synchrony"] == "independent" and r["centrotemporal_triphasic"] for r in events)
    pairs = mt.montage_pairs("longitudinal_bipolar", s.scalp)
    labels = [mt.montage_label(p, "longitudinal_bipolar") for p in pairs]
    avg_pairs = mt.montage_pairs("average", s.scalp)
    avg_labels = [p[0] for p in avg_pairs]
    for r in events:
        left = r["focus"].startswith("left")
        c, temporal, fp = ("C3", "T3", "Fp1") if left else ("C4", "T4", "Fp2")
        d = np.linspace(-.5, 1.2, 1000)
        wave = s._sed_kernel(d, "sharp_wave", r["width"], True, True)
        assert wave[d < -.08].max() > 0 and wave[np.abs(d) < .03].min() < 0
        assert wave[(d > .1) & (d < .4)].max() > 0
        field = s._sed_field(r["focus"])
        isolated = np.outer(field, wave)
        j = int(np.argmin(wave))
        avg = s.derive(isolated, avg_pairs, "average")[:, j]
        assert avg[avg_labels.index(c)] < 0 and avg[avg_labels.index(temporal)] < 0
        assert avg[avg_labels.index(fp)] > 0
        bipolar = s.derive(isolated, pairs, "longitudinal_bipolar")[:, j]
        for a, b in (("F3-C3", "C3-P3"), ("F7-T3", "T3-T5")) if left else (
                ("F4-C4", "C4-P4"), ("F8-T4", "T4-T6")):
            assert bipolar[labels.index(a)] > 0 > bipolar[labels.index(b)]
    whole = s.segment(150, 170)[1]
    chunks = np.concatenate([s.segment(150, 160)[1], s.segment(160, 170)[1]], axis=1)
    np.testing.assert_allclose(whole, chunks, atol=1e-9, rtol=0)
