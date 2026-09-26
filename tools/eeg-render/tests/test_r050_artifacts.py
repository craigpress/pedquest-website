"""0.5.0 artifact family (spec_version 3): each artifact, as displayed, matches published teaching figures.

References: learningeeg.com atlas figures reviewed in research/eeg-atlas/feature-review-20260926/artifacts.md (A110-01..12),
cached in research/eeg-atlas/references/cache/learningeeg/.  Every measurement is on the displayed page: longitudinal
bipolar, causal LFF 1 Hz / HFF 70 Hz chain from ``page_signals``.  The artifact's own displayed component is the page
minus the same page without the artifact event (the chain is linear), and amplitudes are compared with the background of
that artifact-free page or with the page row spacing, because reference sensitivities are not printed.
"""
import functools

import numpy as np
import pytest

from eeg_render import render_page as rp
from eeg_render.render_page import page_signals
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer

BG = {"type": "continuous", "amplitude_uv": 40.0, "dominant_hz": 9.0, "slow_fraction": 0.3,
      "reactivity": "present", "blink_rate_per_min": 0.0, "channel_gain_max": 1.5}
AT_S = 60.0
WIN = 30.0


def _art(kind, **extra):
    ev = {"type": "artifact", "kind": kind, "at_min": (AT_S - 6.0) / 60.0, "duration_s": WIN + 12.0,
          "intensity": "medium"}
    ev.update(extra)
    return ev


def _image(events, seed, version=3, at_s=AT_S):
    return {"kind": "eeg_page", "license": "synthetic-original", "attribution": None,
            "spec": {"sample_rate": 256, "channels": "standard_19", "seed": seed, "spec_version": version,
                     "age_group": "child", "duration_min": 5, "at_min": at_s / 60.0, "window_s": WIN,
                     "montage": "longitudinal_bipolar", "sensitivity_uv_mm": 7.0,
                     "background": dict(BG), "events": events}}


CASES = {
    "lateral": ([_art("lateral_eye", context="awake", rate_per_h=1800)], 711001),
    "roving": ([{"type": "state_change", "at_min": 0.0, "to": "sleep"},
                _art("slow_roving_eye", context="drowsy", frequency_hz=0.25)], 711002),
    "rem": ([{"type": "state_change", "at_min": 0.5, "to": "rem"},
             _art("rem_eye_movements", context="rem", rate_per_h=2400)], 711003),
    "ecg": ([_art("ecg")], 711004),
    "pulse": ([_art("pulse", frequency_hz=1.2)], 711005),
    "sweat": ([_art("sweat")], 711006),
    "pop": ([_art("electrode_pop", channels=["T5"], rate_per_h=1800, decay_s=0.12)], 711007),
    "movement": ([_art("movement")], 711008),
    "vent": ([_art("ventilator", frequency_hz=0.4)], 711009),
    "chew": ([_art("emg_chewing")], 711010),
    "glosso": ([_art("glossokinetic", context="awake")], 711011),
    "sixty": ([_art("sixty_hz")], 711012),
}


@functools.lru_cache(maxsize=None)
def _page(case):
    events, seed = CASES[case]
    spec = normalize(_image(events, seed))["spec"]
    synth, t, sig, pairs, _ = page_signals(spec)
    bare = normalize(_image([e for e in events if e["type"] != "artifact"], seed))["spec"]
    bare["filters"] = dict(spec["filters"])
    _, _, sig0, _, _ = page_signals(bare)
    lab = {f"{a}-{b}": i for i, (a, b) in enumerate(pairs)}
    return spec, synth, t, sig - sig0, sig0, lab


def _row_uv(spec, n_rows=18, window_s=15.0):
    """Row spacing in microvolts of the standard 15 s bank page (render_eeg_page layout; the tests render 30 s)."""
    st = spec["style"]
    ax_w = (1.0 - rp.LEFT - rp.RIGHT) * st["width"]
    ax_h = (1.0 - rp.TOP - rp.BOTTOM) * st["height"]
    uv_per_px = spec["sensitivity_uv_mm"] / (ax_w / (window_s * rp.PAPER_MM_PER_S))
    return ax_h / (n_rows + rp.CHAIN_GAP_ROWS * 4 + 1.7) * uv_per_px


def _p2p(x):
    return float(np.percentile(x, 99.5) - np.percentile(x, 0.5))


def _bg(sig0, lab, name):
    x = sig0[lab[name]]
    return float(np.percentile(x, 97.5) - np.percentile(x, 2.5))


def _steps(case):
    spec, synth, t, art, sig0, lab = _page(case)
    steps = next(iter(synth._gaze_sched.values()))
    return [s for s in steps if t[0] + 0.5 < s[0] < t[-1] - 0.8]


def _step_at(art, lab, t, fs, s0, rise, name):
    k0 = int((s0 - 0.02 - t[0]) * fs)
    k1 = int((s0 + rise + 0.02 - t[0]) * fs)
    return art[lab[name], k1] - art[lab[name], k0]


# ---------------- eye movements (A110-01/02/03) ----------------

@pytest.mark.parametrize("case", ["lateral", "rem"])
def test_saccade_field_reverses_at_f7_f8(case):
    """montages/clean/lateral-eye-movements and REM-Sleep-ex-3: Fp1-F7 and F7-T3 deflect in opposite directions
    (phase reversal at F7, mirrored at F8), F7-T3 about half of Fp1-F7, Fp1-F3 small, the two sides opposite."""
    spec, synth, t, art, sig0, lab = _page(case)
    fs = synth.fs
    rows = []
    for s0, rise, p0, p1 in _steps(case):
        if abs(p1 - p0) < 0.6:
            continue
        v = {n: _step_at(art, lab, t, fs, s0, rise, n) for n in ("Fp1-F7", "F7-T3", "Fp1-F3", "Fp2-F8", "F8-T4")}
        rows.append(v)
    assert len(rows) >= 4
    for v in rows:
        assert np.sign(v["Fp1-F7"]) == -np.sign(v["F7-T3"])
        assert np.sign(v["Fp2-F8"]) == -np.sign(v["F8-T4"])
        assert np.sign(v["Fp1-F7"]) == -np.sign(v["Fp2-F8"])
        assert 0.4 <= abs(v["F7-T3"] / v["Fp1-F7"]) <= 0.8
        assert abs(v["Fp1-F3"] / v["Fp1-F7"]) <= 0.35


def test_lateral_saccade_is_a_step_with_a_filter_return():
    """lateral-eye-movements (3 figures, artifacts.md A110-01): flat before, rise 30-60 ms, then the hold returns through
    the LFF (0.25-0.35 s to about a fifth of the peak); amplitude 1.5-6x the Fp1-F7 background."""
    spec, synth, t, art, sig0, lab = _page("lateral")
    fs = synth.fs
    x = art[lab["Fp1-F7"]]
    steps = _steps("lateral")
    bg = _bg(sig0, lab, "Fp1-F7")
    done = 0
    for j, (s0, rise, p0, p1) in enumerate(steps):
        nxt = steps[j + 1][0] if j + 1 < len(steps) else t[-1]
        prv = steps[j - 1][0] if j else t[0] - 1
        if nxt - s0 < 0.8 or s0 - prv < 0.8 or abs(p1 - p0) < 0.6:
            continue
        k = int((s0 - t[0]) * fs)
        seg = x[k - int(0.3 * fs):k + int(0.8 * fs)]
        base = x[k - int(0.02 * fs)]
        seg = (seg - base) * np.sign(p0 - p1)          # Fp1-F7 falls for a leftward step: make every step positive
        pk = int(np.argmax(seg))
        amp = seg[pk]
        pre = seg[:int(0.28 * fs)]
        assert pre.min() > -0.1 * amp and pre.max() < 0.1 * amp, "not flat before the saccade"
        up = seg[int(0.3 * fs):pk + 1]
        rise_ms = (np.argmax(up >= 0.9 * amp) - np.argmax(up >= 0.1 * amp)) / fs * 1000
        assert 15 <= rise_ms <= 60, rise_ms
        back = np.argmax(seg[pk:] <= 0.2 * amp) / fs
        assert 0.2 <= back <= 0.4, back
        assert 1.5 <= amp / bg <= 6.0, amp / bg
        done += 1
    assert done >= 3


def test_rem_saccades_come_in_clusters():
    """REM-Sleep-ex-3: saccades 2-4 in a 1-2 s cluster, rise 40-150 ms, clusters separated by quiet gaps."""
    spec, synth, t, art, sig0, lab = _page("rem")
    steps = next(iter(synth._gaze_sched.values()))
    starts = np.array([s[0] for s in steps])
    rises = np.array([s[1] for s in steps])
    assert 0.04 <= rises.min() and rises.max() <= 0.15
    gaps = np.diff(starts)
    assert (gaps < 2.0).mean() >= 0.5            # most intervals are within a cluster
    assert gaps.max() >= 2.0                      # and clusters are separated
    # the displayed Fp1-F7 shows the saccades as steep deflections at the scheduled times
    x = art[lab["Fp1-F7"]]
    fs = synth.fs
    on_page = [s for s in steps if t[0] + 0.2 < s[0] < t[-1] - 0.3 and abs(s[3] - s[2]) > 0.5]
    for s0, rise, p0, p1 in on_page:
        k0, k1 = int((s0 - t[0]) * fs), int((s0 + rise - t[0]) * fs)
        assert abs(x[k1] - x[k0]) > 0.4 * _bg(sig0, lab, "Fp1-F7")


def test_rem_background_has_no_alpha():
    """REM-Sleep-ex-3: low-voltage mixed frequency background without the posterior alpha of wakefulness."""
    spec, synth, t, art, sig0, lab = _page("rem")
    wake = _page("lateral")[4]
    fs = synth.fs

    def alpha(x):
        f = np.fft.rfftfreq(x.size, 1 / fs)
        p = np.abs(np.fft.rfft(x)) ** 2
        return p[(f >= 8) & (f <= 11)].sum() / p[(f >= 1) & (f <= 30)].sum()
    assert alpha(sig0[lab["P3-O1"]]) < 0.6 * alpha(wake[lab["P3-O1"]])


def test_slow_roving_is_irregular_and_frontotemporal():
    """Drowsy-state and More-drowsy-state: irregular half-waves 0.9-1.8 s in Fp1-F7/Fp2-F8 with F7-T3 opposite and the
    two sides opposed, Fp1-F3 small, amplitude above the Fp1-F7 background (not metronomic, unlike the 4.0 s sine)."""
    spec, synth, t, art, sig0, lab = _page("roving")
    x = art[lab["Fp1-F7"]]
    assert _p2p(x) > 1.0 * _bg(sig0, lab, "Fp1-F7")
    zc = np.flatnonzero(np.diff(np.sign(x)) != 0) / synth.fs
    half = np.diff(zc)
    half = half[half > 0.3]
    assert 0.9 <= float(np.median(half)) <= 1.8, np.median(half)
    assert np.std(half) / np.mean(half) > 0.2
    assert np.corrcoef(x, art[lab["F7-T3"]])[0, 1] < -0.9
    assert np.corrcoef(x, art[lab["Fp2-F8"]])[0, 1] < -0.9
    assert _p2p(art[lab["Fp1-F3"]]) < 0.35 * _p2p(x)


# ---------------- cardiac (A110-04/05) ----------------

def test_ecg_spikes_survive_bipolar_posteriorly():
    """ECG-artifact-on-an-uncalibrated-screen, Sweat-and-electrode-pop, cardioballistic-artifact-clean: one sharp spike per
    beat, clearest in T5-O1, P3-O1, Cz-Pz and C4-P4 at about 0.3-0.8x the background (was 1-6 uV)."""
    spec, synth, t, art, sig0, lab = _page("ecg")
    assert spec["style"].get("show_ecg_channel") is True
    beats = synth._beat_times(t[0], t[-1])
    beats = beats[(beats > t[0] + 0.2) & (beats < t[-1] - 0.5)]
    fs = synth.fs
    for name in ("T5-O1", "P3-O1", "Cz-Pz", "C4-P4"):
        x = art[lab[name]]
        amps = [np.ptp(x[int((b - 0.05 - t[0]) * fs):int((b + 0.08 - t[0]) * fs)]) for b in beats]
        assert min(amps) > 0.8 * max(amps)                   # every beat, the same spike
        r = np.median(amps) / _bg(sig0, lab, name)
        assert 0.3 <= r <= 0.9, (name, r)
        assert np.median(amps) >= 12.0                       # 15-25 uV spikes, review A110-04
    # spikes are QRS-locked and sharp: the 50 ms around each R holds most of the displayed artifact
    x = art[lab["T5-O1"]]
    k = np.concatenate([np.arange(int((b - 0.01 - t[0]) * fs), int((b + 0.04 - t[0]) * fs)) for b in beats])
    assert np.abs(x[k]).max() >= 0.95 * np.abs(x).max()


def test_pulse_is_one_electrode_locked_to_the_r_wave():
    """cardioballistic-artifact-clean: a smooth wave filling each R-R interval on one electrode (Cz: Fz-Cz and Cz-Pz
    mirror images, other chains clean), crossing zero about 0.33 s after each R, about one page row."""
    spec, synth, t, art, sig0, lab = _page("pulse")
    a, b = art[lab["Fz-Cz"]], art[lab["Cz-Pz"]]
    assert np.corrcoef(a, b)[0, 1] < -0.99
    others = [n for n in lab if "Cz" not in n]
    assert max(_p2p(art[lab[n]]) for n in others) < 1e-6
    row = _row_uv(spec)
    assert 0.7 * row <= _p2p(b) <= 1.5 * row, (_p2p(b), row)
    fs = synth.fs
    beats = synth._beat_times(t[0], t[-1])
    up = np.flatnonzero((b[:-1] < 0) & (b[1:] >= 0)) / fs + t[0]      # Cz rising through zero
    lat = [u - beats[beats < u].max() for u in up if (beats < u).any()]
    rr = 60.0 / 100.0
    assert np.all(np.abs(np.array(lat) - np.median(lat)) < 0.05 * rr)  # locked to the R wave
    assert 0.2 <= np.median(lat) <= 0.45, np.median(lat)


# ---------------- EMG and tongue (A110-10/11) ----------------

def test_chewing_bursts_in_every_temporal_chain():
    """chewing-artifact-2, Hypoglossal-Artifact-and-Chewing: bursts in every chain, maximal temporal, several page rows;
    F7-T3 and T3-T5 no longer cancel (one shared EMG realisation made them nearly clean)."""
    spec, synth, t, art, sig0, lab = _page("chew")
    row = _row_uv(spec)
    temporal = ["Fp1-F7", "F7-T3", "T3-T5", "T5-O1", "Fp2-F8", "F8-T4", "T4-T6", "T6-O2"]
    p = {n: _p2p(art[lab[n]]) for n in lab}
    assert min(p[n] for n in temporal) >= 2.0 * row
    assert min(p["F7-T3"], p["T3-T5"]) >= 0.6 * max(p["Fp1-F7"], p["T5-O1"])
    assert np.mean([p[n] for n in temporal]) > np.mean([p[n] for n in ("Fz-Cz", "Cz-Pz")])
    assert min(p.values()) > 0.5 * row


def test_glossokinetic_is_bilateral_broad_and_irregular():
    """Tongue-Artifact, Hypoglossal-Artifact-and-Chewing: in phase over both hemispheres (not the opposed lateral-eye
    field), broad down to the parasagittal chains, irregular 1-3 Hz."""
    spec, synth, t, art, sig0, lab = _page("glosso")
    L, R = art[lab["Fp1-F7"]], art[lab["Fp2-F8"]]
    assert np.corrcoef(L, R)[0, 1] > 0.95
    assert np.corrcoef(art[lab["T3-T5"]], art[lab["T4-T6"]])[0, 1] > 0.95
    top = max(_p2p(art[lab[n]]) for n in lab)
    assert _p2p(art[lab["Fp1-F7"]]) >= 0.8 * _bg(sig0, lab, "Fp1-F7")
    assert _p2p(art[lab["C3-P3"]]) >= 0.15 * top and _p2p(art[lab["P3-O1"]]) >= 0.15 * top
    f = np.fft.rfftfreq(L.size, 1 / synth.fs)
    pw = np.abs(np.fft.rfft(L)) ** 2
    assert pw[(f >= 1) & (f <= 3.5)].sum() > 0.6 * pw[(f >= 0.3) & (f <= 30)].sum()
    sched = next(v for k, v in synth._art_events_v3.items() if k[1] == "glosso")
    starts = np.diff([s[0] for s in sched])
    assert np.std(starts) / np.mean(starts) > 0.3


# ---------------- movement, sweat, ventilator, pops, mains ----------------

def test_movement_is_abrupt_multichannel_transients_with_emg():
    """shaking-head-artifact, chest-PT-artifact: abrupt high-amplitude transients in many chains at once, with
    electrode-to-electrode differences, co-timed EMG, irregular timing; not rhythmic frontal delta (FIRDA-like)."""
    spec, synth, t, art, sig0, lab = _page("movement")
    fs = synth.fs
    row = _row_uv(spec)
    sched = next(v for k, v in synth._art_events_v3.items() if k[1] == "move")
    on = [s for s in sched if t[0] < s[0] and s[0] + s[2] < t[-1]]
    assert len(on) >= 4
    starts = np.array([s[0] for s in sched])
    assert np.std(np.diff(starts)) / np.mean(np.diff(starts)) > 0.3
    from scipy import signal as sps
    lo = sps.sosfiltfilt(sps.butter(2, 8.0, "low", fs=fs, output="sos"), art, axis=-1)
    hi = art - lo
    inside = np.zeros(t.size, bool)
    for s0, onset, dur, *_ in on:
        inside |= (t >= s0) & (t < s0 + dur)
    counts = []
    for s0, onset, dur, *_ in on:
        m = (t >= s0) & (t < s0 + dur + 0.3)
        amp = np.array([np.ptp(lo[i, m]) for i in range(lo.shape[0])])
        counts.append(int((amp >= 1.5 * row).sum()))
        assert amp.max() >= 2.0 * row                              # high amplitude (>= 2-3 rows in the references)
        assert np.std(amp) / np.mean(amp) > 0.2                    # electrode-to-electrode differences
    assert min(counts) >= 6 and np.median(counts) >= 10, counts    # many chains at once
    hf_in = np.sqrt(np.mean(hi[:, inside] ** 2))
    hf_out = np.sqrt(np.mean(hi[:, ~inside] ** 2))
    assert hf_in > 5 * hf_out + 1e-9
    # abrupt: steepest slope of each transient over 50 ms reaches a page row
    k = int(0.05 * fs)
    assert np.max(np.abs(lo[:, k:] - lo[:, :-k])) >= row


def test_sweat_is_regional_and_survives_the_lff():
    """Sweat-and-electrode-pop: a slow 2-4 s sway of about one page row, frontal and regional, posterior chains quiet."""
    spec, synth, t, art, sig0, lab = _page("sweat")
    row = _row_uv(spec)
    p = {n: _p2p(art[lab[n]]) for n in lab}
    top = max(p, key=p.get)
    assert top.startswith("Fp")
    assert 0.6 * row <= p[top] <= 1.8 * row, (p[top], row)
    for n in ("T5-O1", "T6-O2", "P3-O1", "P4-O2", "C3-P3", "C4-P4", "Cz-Pz"):
        assert p[n] < 0.1 * p[top], n
    x = art[lab[top]]
    f = np.fft.rfftfreq(x.size, 1 / synth.fs)
    pw = np.abs(np.fft.rfft(x)) ** 2
    assert pw[f < 0.6].sum() > 0.7 * pw.sum()


def test_ventilator_bursts_are_breath_locked_and_focal():
    """ventilator-artifact-water-motion-in-the-tubes: a burst of 5-12 Hz oscillation every breath at a steady rate,
    focal at F7 (smaller homologous), about one page row; parasagittal chains clean."""
    spec, synth, t, art, sig0, lab = _page("vent")
    row = _row_uv(spec)
    sched = next(v for k, v in synth._art_events_v3.items() if k[1] == "vent")
    iv = np.diff([s[0] for s in sched])
    assert np.all(np.abs(iv * 0.4 - 1.0) <= 0.0301)
    p = {n: _p2p(art[lab[n]]) for n in lab}
    assert max(p, key=p.get) == "Fp1-F7"
    assert 0.7 * row <= p["Fp1-F7"] <= 2.5 * row
    assert 0.15 * p["Fp1-F7"] <= p["Fp2-F8"] <= 0.6 * p["Fp1-F7"]
    for n in ("Fp1-F3", "F3-C3", "C3-P3", "Fz-Cz", "Cz-Pz"):
        assert p[n] < 1e-6
    x = art[lab["Fp1-F7"]]
    f = np.fft.rfftfreq(x.size, 1 / synth.fs)
    pw = np.abs(np.fft.rfft(x)) ** 2
    band = pw[(f >= 4) & (f <= 13)].sum() / pw[(f >= 13) & (f <= 40)].sum()
    assert band > 5, band


def test_electrode_pop_is_one_electrode_step_decay():
    """F7-Electrode-Pop, Sweat-and-electrode-pop: a vertical onset with exponential decay, flat before, confined to the
    chains of one electrode (phase reversal around it), 0.5-1.6 page rows (was 3-5 rows)."""
    spec, synth, t, art, sig0, lab = _page("pop")
    fs = synth.fs
    row = _row_uv(spec)
    a, b = art[lab["T3-T5"]], art[lab["T5-O1"]]
    assert np.corrcoef(a, b)[0, 1] < -0.99
    assert max(_p2p(art[lab[n]]) for n in lab if "T5" not in n) < 1e-6
    sched = next(v for k, v in synth._art_events_v3.items() if k[1] == "pop")
    iso = [(p0, amp) for j, (p0, amp) in enumerate(sched)
           if t[0] + 0.3 < p0 < t[-1] - 0.6
           and (j == 0 or p0 - sched[j - 1][0] > 1.0) and (j + 1 == len(sched) or sched[j + 1][0] - p0 > 0.6)]
    assert len(iso) >= 3
    peaks = []
    for p0, amp in iso:
        k = int(np.ceil((p0 - t[0]) * fs))
        seg = b[k - int(0.1 * fs):k + int(0.6 * fs)] * np.sign(amp)      # T5-O1 carries +T5
        seg = seg - seg[0]
        pk = seg.max()
        peaks.append(pk)
        assert np.abs(seg[:int(0.1 * fs) - 1]).max() < 0.05 * pk
        assert np.argmax(seg >= 0.9 * pk) - int(0.1 * fs) <= int(0.012 * fs) + 1
        assert np.argmax(seg[int(0.1 * fs):] <= 0.2 * pk) / fs <= 0.4
    assert 0.5 * row <= np.median(peaks) <= 1.6 * row, (np.median(peaks), row)


def test_sixty_hz_is_visible_on_high_impedance_electrodes_only():
    """60hz-artifact: with the notch off, a dense 60 Hz band of about 0.5-1 page row only in the chains containing the
    high-impedance electrode(s); neighbouring chains clean."""
    spec, synth, t, art, sig0, lab = _page("sixty")
    assert spec["filters"]["notch_hz"] is None
    row = _row_uv(spec)
    p = np.array([_p2p(art[i]) for i in range(art.shape[0])])
    bad = p > 0.3 * row
    assert 1 <= bad.sum() <= 6
    assert np.all((p[bad] >= 0.4 * row) & (p[bad] <= 1.6 * row)), (p[bad], row)
    assert p[~bad].max() < 0.15 * p[bad].min()
    x = art[int(np.argmax(p))]
    f = np.fft.rfftfreq(x.size, 1 / synth.fs)
    pw = np.abs(np.fft.rfft(x)) ** 2
    assert pw[(f > 59) & (f < 61)].sum() > 0.8 * pw.sum()
    explicit = _image(CASES["sixty"][0], 711012)
    explicit["spec"]["filters"] = {"notch_hz": 60.0}
    assert normalize(explicit)["spec"]["filters"]["notch_hz"] == 60.0


# ---------------- scheduling ----------------

def test_v3_artifacts_are_window_independent():
    """Every v3 artifact is drawn once per event: a split request reproduces the whole-window samples."""
    events = [dict(e, at_min=0.2 + 0.4 * i) for i, (evs, _) in enumerate(CASES.values()) for e in evs
              if e["type"] == "artifact" and e["kind"] not in ("slow_roving_eye", "rem_eye_movements")]
    spec = normalize(_image(events, 711099))["spec"]
    synth = Synthesizer(spec, 400.0)
    fs = synth.fs
    for a0 in np.arange(10.0, 290.0, 23.0):
        i0 = int(a0 * fs)
        n = int(20.0 * fs)
        t = (i0 + np.arange(n)) / fs
        whole = synth._artifact_block(t, i0)
        h = n // 2 + 37
        parts = np.hstack([synth._artifact_block(t[:h], i0), synth._artifact_block(t[h:], i0 + h)])
        np.testing.assert_allclose(parts, whole, atol=1e-6)
