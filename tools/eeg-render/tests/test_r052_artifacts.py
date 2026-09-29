"""0.5.2 renderer round r9 (gallery 2026-09-29, research/eeg-atlas/gallery-20260929/ISSUES.json): artifacts, sedation and
non-epileptiform backgrounds.  Every measurement is on the displayed page (longitudinal bipolar, causal 1-70 Hz chain);
an artifact's own component is the page minus the same page without the artifact event."""
import functools

import numpy as np
import scipy.signal as sps

from eeg_render import render_page as rp
from eeg_render import state_v3 as sv3
from eeg_render.render_page import page_signals
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer

BG = {"type": "continuous", "amplitude_uv": 40.0, "dominant_hz": 9.0, "slow_fraction": 0.3,
      "reactivity": "present", "blink_rate_per_min": 0.0, "channel_gain_max": 1.5}


def _spec(events, seed, age="child", version=3, bg=None, at_s=60.0, win=20.0, dur=5, **extra):
    s = {"sample_rate": 256, "channels": "standard_19", "seed": seed, "spec_version": version, "age_group": age,
         "duration_min": dur, "at_min": at_s / 60.0, "window_s": win, "montage": "longitudinal_bipolar",
         "sensitivity_uv_mm": 7.0, "background": dict(bg or BG), "events": events}
    s.update(extra)
    return normalize({"kind": "eeg_page", "license": "synthetic-original", "attribution": None, "spec": s})["spec"]


def _art(kind, **extra):
    ev = {"type": "artifact", "kind": kind, "at_min": 0.9, "duration_s": 36.0, "intensity": "medium"}
    ev.update(extra)
    return ev


def _disp(spec):
    _, t, sig, pairs, _ = page_signals(spec)
    return {f"{a}-{b}": sig[i] for i, (a, b) in enumerate(pairs)}


@functools.lru_cache(maxsize=None)
def _art_only(kind, seed, extra=()):
    ev = _art(kind, **{k: list(v) if isinstance(v, tuple) else v for k, v in extra})
    on, off = _disp(_spec([ev], seed)), _disp(_spec([], seed))
    return {k: on[k] - off[k] for k in on}, off


def _pp(x):
    return float(np.percentile(x, 99.5) - np.percentile(x, 0.5))


def _bp(x, fs, lo, hi):
    f, p = sps.welch(x, fs=fs, nperseg=2 * fs, axis=-1)
    return float(p[..., (f >= lo) & (f < hi)].sum())


# ------------------------------------------------------------------ mechanical artifacts (art-patting / chest-pt / ecmo)

def test_patting_side_all_survives_bipolar_posterior_temporal():
    d, off = _art_only("patting", 752001)
    post = np.mean([_pp(d[c]) for c in ("T3-T5", "T5-O1", "T4-T6", "T6-O2")])
    front = np.mean([_pp(d[c]) for c in ("Fp1-F7", "Fp2-F8", "Fp1-F3", "Fp2-F4")])
    assert post >= 60.0, post                          # about a page row where the hand is (was ~0.1 x of it)
    assert post >= 8.0 * front
    assert 0.8 <= _pp(d["T3-T5"]) / _pp(d["T4-T6"]) <= 1.25   # bilateral: no asymmetry on a trend


def test_patting_side_left_stays_left():
    d, _ = _art_only("patting", 752002, (("side", "left"),))
    assert _pp(d["T3-T5"]) >= 5.0 * _pp(d["T4-T6"])


def test_chest_pt_side_all_is_rhythmic_high_amplitude_with_muscle():
    d, off = _art_only("chest_pt", 752003)
    top = max(_pp(v) for v in d.values())
    assert top >= 45.0
    x = d["T3-T5"]
    assert _bp(x, 256, 2.5, 3.3) > 3.0 * _bp(x, 256, 4.0, 8.0)      # locked to the 2.9 Hz percussion
    assert _bp(x, 256, 30, 60) > 0.5 * _bp(off["T3-T5"], 256, 30, 60)   # co-timed muscle


def test_chest_pt_no_muscle_under_blockade():
    ev = _art("chest_pt")
    on = _disp(_spec([ev], 752004, neuromuscular_blockade="complete"))
    off = _disp(_spec([], 752004, neuromuscular_blockade="complete"))
    x = on["T3-T5"] - off["T3-T5"]
    assert _bp(x, 256, 30, 60) < 0.02 * _bp(x, 256, 2.5, 3.3)


def test_ecmo_side_all_is_a_few_channels():
    d, _ = _art_only("ecmo_pump", 752005)
    amp = sorted(((_pp(v), k) for k, v in d.items()), reverse=True)
    assert amp[0][0] >= 30.0
    assert amp[4][0] < 0.2 * amp[3][0], amp[:6]        # a homologous pair: four chains, nothing much elsewhere
    top4 = {k for _, k in amp[:4]}
    assert sum(k.startswith(("Fp1", "F3", "C3", "P3", "F7", "T3", "T5")) for k in top4) == 2   # bilateral


def test_ecmo_channels_pin_the_electrode():
    d, _ = _art_only("ecmo_pump", 752006, (("channels", ("T4",)),))
    amp = sorted(((_pp(v), k) for k, v in d.items()), reverse=True)
    assert {amp[0][1], amp[1][1]} == {"F8-T4", "T4-T6"}


def test_mechanical_artifacts_window_independent():
    ev = _art("patting")
    spec = _spec([ev], 752007, win=10.0)
    S = Synthesizer(spec, rp.page_horizon_s(spec))
    _, a = S.segment(58.0, 70.0)
    S2 = Synthesizer(spec, rp.page_horizon_s(spec))
    _, b = S2.segment(62.0, 70.0)
    n = b.shape[1]
    assert np.allclose(a[:, -n:], b, atol=1e-9)


# ------------------------------------------------------------------ authored blinks (art-eye-blink)

def test_authored_blink_is_frontal_and_spaced():
    d, _ = _art_only("eye_blink", 752008, (("rate_per_h", 1800),))
    fp = _pp(d["Fp1-F3"])
    assert fp >= 100.0
    assert _pp(d["F3-C3"]) < 0.3 * fp and _pp(d["Fz-Cz"]) < 0.2 * fp
    assert _pp(d["T3-T5"]) < 0.03 * fp and _pp(d["C3-P3"]) < 0.08 * fp
    x = d["Fp1-F3"]
    pk, _ = sps.find_peaks(x, height=0.5 * fp, distance=int(0.3 * 256))
    assert np.min(np.diff(pk)) / 256.0 >= 0.75                # 0.8-s refractory (uniform draws stacked them)


def test_spontaneous_blink_contour_untouched():
    # the reference-validated contour belongs to test_r050_blink_reference; the event path reuses _blink_profile
    spec = _spec([], 752009, bg=dict(BG, blink_rate_per_min=20.0))
    S = Synthesizer(spec, rp.page_horizon_s(spec))
    t = np.arange(0, 2.0, 1 / 256)
    p = S._blink_profile(t, np.array([0.5]))
    assert abs(p.max() - 1.0) < 0.05


# ------------------------------------------------------------------ glossokinetic

def test_glossokinetic_anterior_greater_than_posterior():
    d, _ = _art_only("glossokinetic", 752010, (("context", "awake"),))
    ps = [_pp(d[c]) for c in ("Fp1-F3", "F3-C3", "C3-P3", "P3-O1")]
    tm = [_pp(d[c]) for c in ("F7-T3", "T3-T5", "T5-O1")]
    assert ps[0] > 2.5 * ps[3] and ps[1] > ps[2] > ps[3], ps
    assert tm[0] > tm[1] > tm[2] and tm[0] > 4.0 * tm[2], tm


# ------------------------------------------------------------------ page header (art-sixty-hz)

class _Fig:
    def __init__(self):
        self.texts = []

    def text(self, x, y, s, **kw):
        self.texts.append(s)


def test_header_notch_off_has_no_unit():
    spec = _spec([], 752011)
    for version, want, bad in ((3, "notch off  |", "notch off Hz"), (2, "notch off Hz", None)):
        sp = dict(spec, spec_version=version, filters=dict(spec["filters"], notch_hz=None))
        fig = _Fig()
        rp._page_header(fig, sp, {}, "", 0, 0, 1, 1, 7)
        line = fig.texts[-1]
        assert want in line, line
        if bad:
            assert bad not in line
    fig = _Fig()
    rp._page_header(fig, dict(spec, filters=dict(spec["filters"], notch_hz=60.0)), {}, "", 0, 0, 1, 1, 7)
    assert "notch 60.0 Hz" in fig.texts[-1]


# ------------------------------------------------------------------ awake child EMG (art-lateral-eye / slw-generalized)

def test_awake_child_emg_bursts_short_and_rare():
    ep = sv3.emg_episodes(752012, 1800.0, sv3.EMG_ON_S_CHILD, sv3.EMG_OFF_S_CHILD)
    dur = ep[:, 1] - ep[:, 0]
    duty = dur.sum() / (ep[-1, 1] - ep[0, 0])
    assert duty < 0.25 and np.median(dur) < 2.5
    old = sv3.emg_episodes(752012, 1800.0)
    assert (old[:, 1] - old[:, 0]).sum() / (old[-1, 1] - old[0, 0]) > 0.35      # other ages keep the old gate
    S = Synthesizer(_spec([], 752013), 300.0)
    assert S._emg_levels == sv3.EMG_LEVELS_CHILD
    assert Synthesizer(_spec([], 752013, age="adolescent"), 300.0)._emg_levels == (sv3.EMG_ON_LEVEL, sv3.EMG_OFF_LEVEL)


# ------------------------------------------------------------------ sedation

def _sed(agent, seed, at_s=240.0, win=30.0):
    on = _disp(_spec([], seed, at_s=at_s, win=win, sedation={"agent": agent, "level": 0.8}))
    off = _disp(_spec([], seed, at_s=at_s, win=win))
    return on, off


def test_ketamine_gamma_frontocentral_not_temporal():
    on, off = _sed("ketamine", 752014)
    ex = {k: _bp(on[k], 256, 25, 30) - _bp(off[k], 256, 25, 30) for k in on}
    fc = np.mean([ex[c] for c in ("Fp1-F3", "F3-C3", "Fp2-F4", "F4-C4", "Fz-Cz")])
    tp = np.mean([ex[c] for c in ("T3-T5", "T4-T6", "T5-O1", "T6-O2")])
    assert fc > 1.5 * tp, (fc, tp)
    mus = np.mean([_bp(on[c], 256, 40, 58) / _bp(off[c], 256, 40, 58) for c in ("F7-T3", "T3-T5", "F8-T4", "T4-T6")])
    assert mus < 0.6


def test_propofol_large_frontal_slow_waves():
    on, off = _sed("propofol", 752015)
    fr = np.mean([_bp(on[c], 256, 0.5, 3.0) / _bp(off[c], 256, 0.5, 3.0) for c in ("Fp1-F3", "Fp2-F4", "Fz-Cz")])
    oc = np.mean([_bp(on[c], 256, 0.5, 3.0) / _bp(off[c], 256, 0.5, 3.0) for c in ("P3-O1", "P4-O2")])
    assert fr > 8.0 and fr > 2.0 * oc, (fr, oc)
    assert np.mean([_bp(on[c], 256, 8, 13) for c in ("Fp1-F3", "Fz-Cz")]) > \
        2.0 * np.mean([_bp(on[c], 256, 8, 13) for c in ("P3-O1", "P4-O2")])         # frontal alpha kept


# ------------------------------------------------------------------ backgrounds

def test_non_drug_burst_suppression_interburst_not_flat():
    bg = dict(BG, type="burst_suppression", amplitude_uv=50.0, dominant_hz=3.0, slow_fraction=0.7, reactivity="absent",
              burst_suppression={"burst_s": 2.0, "ibi_s": 6.0})
    spec = _spec([], 752016, bg=bg, win=30.0)
    S, t, sig, pairs, _ = page_signals(spec)
    env = S.burst_envelope(t)
    ib = env < env.min() + 0.02
    assert ib.mean() > 0.4
    rms = np.median(np.std(sig[:, ib], axis=1))
    assert 1.2 <= rms <= 3.5, rms                                # a few uV, like the drug-induced residual
    q = int(0.25 * S.fs)
    runs = [sig[:, i:i + q] for i in range(0, sig.shape[1] - q, q) if ib[i:i + q].all()]
    pp = np.array([np.median(np.ptp(r, axis=1)) for r in runs])
    assert np.mean(pp < 10.0) > 0.95                             # still suppressed by the SR trend criterion


def test_spindle_coma_default_rate_and_gain():
    bg = dict(BG, amplitude_uv=50.0, dominant_hz=4.0, slow_fraction=0.7, coma_pattern="spindle")
    bg.pop("reactivity")
    S = Synthesizer(_spec([], 752017, bg=bg, dur=10), 600.0)
    rate = S._sp_t.size / 12.0
    assert rate >= 8.0, rate                                     # 10 / min default (N2 default is 4)
    S2 = Synthesizer(_spec([], 752017, bg=bg, dur=10, style={"spindle_rate_per_min": 4.0}), 600.0)
    assert S2._sp_t.size < 0.6 * S._sp_t.size


def _adr(spec):
    S, t, sig, pairs, _ = page_signals(spec)
    return _bp(sig, 256, 8, 13) / _bp(sig, 256, 1, 4), _bp(sig[[0, 1, 4, 5]], 256, 40, 60)


def test_hypothermia_moderate_slowing_and_no_muscle():
    ev = [{"type": "temperature_change", "at_min": 2.0, "from_c": 36.5, "to_c": 33.0, "over_min": 3.0}]
    bg = dict(BG, pdr_gain=3.0)
    warm = _spec(ev, 752018, bg=bg, at_s=30.0, win=30.0, dur=12)
    cold = _spec(ev, 752018, bg=bg, at_s=600.0, win=30.0, dur=12)
    (a_w, m_w), (a_c, m_c) = _adr(warm), _adr(cold)
    assert 0.2 <= a_c / a_w <= 0.6, a_c / a_w                   # was 0.1 (alpha/delta 1 -> 0.15 on the panel)
    assert m_c < 0.25 * m_w                                      # a cooled patient carries no scalp muscle


# ------------------------------------------------------------------ versions 1-2 pinned

V12_HASHES = ["882abaadde5b88d6", "1685d815ee498c60", "0d6451fddcd83c75", "058b0c15e4ebd275", "e77fb8f07dbd8f5f",
              "c91dfa5e16ecb656", "57174d0a818b0010", "2c29768ea8416e28", "d56c9f900bd4e93b", "50c176d2662e4e5f"]


def test_v1_v2_pages_byte_identical_to_0_5_1():
    """Every model this round touched, under spec_version 1 and 2 (hashes captured on 1b2fee6, renderer 0.5.1)."""
    import hashlib
    bg = dict(BG, blink_rate_per_min=12.0)
    bg.pop("channel_gain_max")
    ev = [_art("patting"), _art("chest_pt", side="right"), _art("ecmo_pump"), _art("eye_blink"), _art("glossokinetic"),
          {"type": "temperature_change", "at_min": 0.5, "from_c": 36.5, "to_c": 33.0, "over_min": 1.0}]
    out = []

    def page(s):
        sp = normalize({"kind": "eeg_page", "license": "synthetic-original", "attribution": None, "spec": s})["spec"]
        _, _, sig, _, _ = page_signals(sp)
        return hashlib.sha256(np.ascontiguousarray(sig).tobytes()).hexdigest()[:16]
    for v in (1, 2):
        for age in ("child", "infant"):
            for events in (ev, []):
                out.append(page({"sample_rate": 256, "channels": "standard_19", "seed": 7521, "spec_version": v,
                                 "age_group": age, "duration_min": 3, "at_min": 1.0, "window_s": 10,
                                 "montage": "longitudinal_bipolar", "background": dict(bg), "events": events,
                                 "sedation": {"agent": "ketamine", "level": 0.8}}))
        bs = dict(bg, type="burst_suppression", reactivity="absent", burst_suppression={"burst_s": 2.0, "ibi_s": 6.0})
        out.append(page({"sample_rate": 256, "channels": "standard_19", "seed": 7522, "spec_version": v,
                         "age_group": "child", "duration_min": 3, "at_min": 1.0, "window_s": 10,
                         "montage": "longitudinal_bipolar", "background": bs, "events": [],
                         "sedation": {"agent": "propofol", "level": 0.8}}))
    assert out == V12_HASHES
