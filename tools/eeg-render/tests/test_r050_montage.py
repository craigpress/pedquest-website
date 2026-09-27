"""0.5.0 phase D, montage family: viewer montages on pages, and state-dependent interictal discharges.

Review: research/eeg-atlas/feature-review-20260926/montage-review.md.  Reference figures (learningeeg montages
chapter and pediatric chapter) are cached under research/eeg-atlas/references/cache/learningeeg/montage__*.

Montage measurements isolate the discharge (its own referential rows through the same derivation and causal 1-70 Hz
chain: the chain is linear, so this is exactly what the discharge adds to the display) and read the sign of each
derivation at the discharge peak.  A phase reversal is two consecutive derivations sharing an electrode with opposite
signs, both above a quarter of the largest deflection.
"""
import json
import re
from collections import Counter
from pathlib import Path

import numpy as np
import pytest

from eeg_render import montage as mt
from eeg_render import state_v3 as sv3
from eeg_render.export.manifest import realized_events, sporadic_summary, _stage_seconds
from eeg_render.render_page import apply_filters, build_filters, page_signals
from eeg_render.spec import SpecError, normalize
from eeg_render.synth import Synthesizer

FILT = {"lf_hz": 1.0, "hf_hz": 70.0, "notch_hz": 60.0}
BG = dict(type="continuous", amplitude_uv=40.0, dominant_hz=9.0, slow_fraction=0.35, reactivity="present",
          channel_gain_max=1.5, blink_rate_per_min=0)
VIEWER_TS = Path(__file__).resolve().parents[3] / "src" / "lib" / "eeg" / "montage.ts"


def _page(montage, events, seed, channels="standard_19", version=3, at_s=120.0, bg=BG):
    return {"kind": "eeg_page", "license": "synthetic-original", "attribution": None,
            "spec": {"sample_rate": 256, "channels": channels, "seed": seed, "spec_version": version,
                     "age_group": "child", "duration_min": 5, "at_min": at_s / 60.0, "window_s": 15.0,
                     "montage": montage, "sensitivity_uv_mm": 7.0, "background": dict(bg), "events": events}}


def _record(events, seed, dur_min, version=3):
    img = {"kind": "qeeg_panel", "license": "synthetic-original", "attribution": None,
           "spec": {"sample_rate": 256, "channels": "standard_19", "seed": seed, "spec_version": version,
                    "age_group": "child", "duration_min": dur_min, "background": dict(BG, blink_rate_per_min=15),
                    "events": events}}
    return normalize(img)["spec"]


def _sed(focus, rate_h=900, amp=120.0, **extra):
    e = {"type": "sporadic_discharges", "focus": focus, "rate_per_h": rate_h, "amplitude_uv": amp}
    e.update(extra)
    return e


def _isolated(syn, montage, t0, t1):
    t = np.arange(int(round((t0 - 6) * syn.fs)), int(round(t1 * syn.fs))) / syn.fs
    pairs = mt.montage_pairs(montage, syn.scalp)
    sig = apply_filters(syn.derive(syn._sed_rows(t), pairs, montage), build_filters(syn.fs, FILT, True), True)
    k = t >= t0
    return t[k], sig[:, k], pairs


def _peaks(syn, montage, t0=40.0, t1=280.0):
    """(pairs, [peak vector per discharge]) - each vector is every derivation at that discharge's largest sample."""
    t, sig, pairs = _isolated(syn, montage, t0, t1)
    out = []
    for r in syn._sed:
        if t0 + 1 < r[0] < t1 - 1:
            seg = sig[:, (t > r[0] - 0.03) & (t < r[0] + 0.04)]
            out.append(seg[:, int(np.argmax(np.abs(seg).max(axis=0)))])
    return pairs, out


def _reversals(peak, pairs, frac=0.25):
    """[(shared electrode, min |deflection| of the two)] for every phase reversal in the chains."""
    ref = np.abs(peak).max()
    out = []
    for i in range(1, len(pairs)):
        (_, b0), (a1, _) = pairs[i - 1], pairs[i]
        lo = min(abs(peak[i - 1]), abs(peak[i]))
        if b0 == a1 and np.sign(peak[i - 1]) != np.sign(peak[i]) and lo > frac * ref:
            out.append((a1, lo))
    return out


def _main_reversal(peak, pairs):
    rv = _reversals(peak, pairs)
    return max(rv, key=lambda x: x[1])[0] if rv else None


# ------------------------------------------------------------------------------------------ viewer agreement

def _ts_const(src, name):
    m = re.search(r"const %s(?::[^=]+)? = (\[.*?\]);" % name, src, re.S)
    return json.loads(re.sub(r",\s*\]", "]", m.group(1).replace('"', '"')))


@pytest.mark.skipif(not VIEWER_TS.exists(), reason="site viewer source not in this checkout")
def test_viewer_montages_mirrored_id_label_and_chain():
    """The page renderer's montages are the site viewer's (src/lib/eeg/montage.ts): same ids, labels, chains and
    Laplacian neighbours, so a page and the same recording in the viewer agree."""
    src = VIEWER_TS.read_text(encoding="utf-8")
    labels = dict(re.findall(r'\{ id: "(\w+)", label: "([^"]+)"', src))
    for mid, (label, _) in mt.VIEWER_MONTAGES.items():
        assert labels[mid] == label, mid
    for ts_name, py in (("DOUBLE_BANANA", mt._V_DOUBLE_BANANA), ("TRANSVERSE", mt._V_TRANSVERSE),
                        ("T1T2", mt._V_T1T2), ("NEONATAL", mt._V_NEONATAL),
                        ("REFERENTIAL_ORDER", mt._V_REFERENTIAL_ORDER)):
        assert _ts_const(src, ts_name) == py, ts_name
    for ts_name, py in (("OUTER_RING", mt._V_OUTER_RING), ("INNER_RING", mt._V_INNER_RING)):
        assert _ts_const(src, ts_name) == py, ts_name
    nb = dict((k, re.findall(r'"(\w+)"', v)) for k, v in
              re.findall(r"(\w+): \[([^\]]*)\]", src.split("LAPLACIAN_NEIGHBOURS")[1].split("};")[0]))
    assert nb == mt.LAPLACIAN_NEIGHBOURS
    # every viewer montage except the legacy / as-recorded ones is renderable here
    ids = set(re.findall(r'\{ id: "(\w+)"', src)) - {"as_recorded", "longitudinal_bipolar", "average", "neonatal"}
    assert ids == set(mt.VIEWER_MONTAGES)


def test_viewer_montage_rows_and_labels():
    ch19, ch21 = mt.channel_set("standard_19"), mt.channel_set("standard_19_t1t2")
    lab = lambda m, ch: [mt.montage_label(p, m) for p in mt.montage_pairs(m, ch)]   # noqa: E731
    assert len(lab("transverse_bipolar", ch19)) == 18                                 # TB-18.3
    assert lab("transverse_bipolar", ch19)[:4] == ["F7-Fp1", "Fp1-Fp2", "Fp2-F8", "F7-F3"]
    assert lab("circumferential", ch19)[-1] == "Fp2-Fp1" and len(lab("circumferential", ch19)) == 10
    assert lab("t1t2_bipolar", ch21)[:5] == ["Fp1-F7", "F7-T1", "T1-T3", "T3-T5", "T5-O1"]
    assert "Cz-A12" in lab("ipsilateral_ear", ch19) and "Fp1-A1" in lab("ipsilateral_ear", ch19)
    assert "Fp1-A2" in lab("contralateral_ear", ch19)
    assert "Cz-Cz" not in lab("cz_reference", ch19) and len(lab("cz_reference", ch19)) == 18
    assert lab("laplacian", ch19)[0] == "Fp1-Lp"
    # a montage whose electrodes are missing falls back to the average reference, like the viewer
    assert lab("t1t2_bipolar", ch19)[0] == "Fp1-Av"
    assert mt.montage_breaks("transverse_bipolar", ch19) == [3, 7, 11, 15]
    assert mt.montage_breaks("longitudinal_bipolar", ch19) is None


def test_viewer_montages_are_v3_only_and_t1t2_selects_the_array():
    with pytest.raises(SpecError):
        normalize(_page("transverse_bipolar", [], 1, version=2))
    with pytest.raises(SpecError):
        normalize(_page("longitudinal_bipolar", [], 1, channels="standard_19_t1t2", version=2))
    s = normalize(_page("t1t2_bipolar", [], 1))["spec"]
    assert s["channels"] == "standard_19_t1t2"
    assert normalize(_page("hatband", [], 1))["spec"]["montage"] == "circumferential"


def test_montage_switch_does_not_rescale_the_record():
    """One recording, several montages (the viewer's behaviour): the display calibration is montage-independent."""
    scales = {m: Synthesizer(normalize(_page(m, [], 931000))["spec"], 200.0).display_scale
              for m in ("longitudinal_bipolar", "transverse_bipolar", "laplacian", "ipsilateral_ear")}
    assert len({round(v, 12) for v in scales.values()}) == 1, scales


# ------------------------------------------------------------------------------------------ learningeeg examples

def test_transverse_localizes_central_spike_reversal_at_c3():
    """learningeeg montages chapter (transverse-montage.webp; BECTS-centrotemporal-spikes-4-bipolar.webp shows the
    centrotemporal reversal in the double banana): a C3 spike reverses at C3 in the coronal chain T3-C3 / C3-Cz, the
    largest reversal on the transverse page.  Measured 59/59 discharges (seed 930001)."""
    syn = Synthesizer(normalize(_page("transverse_bipolar", [_sed("C3")], 930001))["spec"], 300.0)
    pairs, peaks = _peaks(syn, "transverse_bipolar")
    main = Counter(_main_reversal(p, pairs) for p in peaks)
    assert len(peaks) >= 30 and main["C3"] >= 0.95 * len(peaks), main


def test_circumferential_shows_the_o1_reversal_the_double_banana_hides():
    """learningeeg o1-spike-bipolar / o1-spike-circumferential (end-of-chain effect): an O1 spike has no reversal in
    the double banana (O1 ends both chains) and reverses at O1 (T5-O1 / O1-O2) in the circumferential ring."""
    ev = [_sed("O1")]
    syn = Synthesizer(normalize(_page("circumferential", ev, 930004))["spec"], 300.0)
    pairs, peaks = _peaks(syn, "circumferential")
    main = Counter(_main_reversal(p, pairs) for p in peaks)
    assert main["O1"] >= 0.95 * len(peaks), main
    pairs, peaks = _peaks(syn, "longitudinal_bipolar")
    rev_o1 = sum(any(e == "O1" for e, _ in _reversals(p, pairs)) for p in peaks)
    assert rev_o1 == 0


def test_lateral_eye_movement_referential_and_bipolar():
    """learningeeg lateral-eye-movements.webp ("F7 negative / F8 positive phase reversal", double banana) and the
    referential teaching form: on a referential montage (ear, average, Cz) the saccade is largest at F7 and F8 with
    OPPOSITE polarity; in the double banana it reverses at F7 and at F8 with opposite signs, F7-T3 about 0.6x
    Fp1-F7 (range 0.4-0.8 read from the figure)."""
    art = {"type": "artifact", "kind": "lateral_eye", "at_min": 1.9, "duration_s": 30.0, "intensity": "medium",
           "context": "awake", "rate_per_h": 1800}
    for mon in ("ipsilateral_ear", "average", "cz_reference", "longitudinal_bipolar"):
        spec = normalize(_page(mon, [art], 930002))["spec"]
        bare = normalize(_page(mon, [], 930002))["spec"]
        bare["filters"] = dict(spec["filters"])
        syn, _, sig, pairs, _ = page_signals(spec)
        _, _, sig0, _, _ = page_signals(bare)
        d = sig - sig0
        col = d[:, int(np.argmax(np.abs(d).max(axis=0)))]
        lab = [mt.montage_label(p, mon) for p in pairs]
        v = dict(zip(lab, col))
        if mon == "longitudinal_bipolar":
            rv = [e for e, _ in _reversals(col, pairs)]
            assert "F7" in rv and "F8" in rv
            assert np.sign(v["Fp1-F7"]) == -np.sign(v["Fp2-F8"])
            assert 0.4 <= abs(v["F7-T3"]) / abs(v["Fp1-F7"]) <= 0.8
            continue
        top2 = {lab[i].split("-")[0] for i in np.argsort(-np.abs(col))[:2]}
        assert top2 == {"F7", "F8"}, (mon, top2)
        f7 = next(x for k, x in v.items() if k.startswith("F7-"))
        f8 = next(x for k, x in v.items() if k.startswith("F8-"))
        assert np.sign(f7) == -np.sign(f8) and 0.8 < abs(f7) / abs(f8) < 1.25


def test_t2_spike_reverses_at_t2_and_is_equipotential_f8_t4_in_the_double_banana():
    """learningeeg negative-phase-reversal.webp ("don't forget to look at the subtemporal leads": the F8-T2 / T2-T4
    reversal) and normal-bipolar-t1t2.webp: an anterior temporal spike maximal at T2 reverses at T2 in the T1/T2
    chain; in the double banana it shows as Fp2-F8 and T4-T6 of opposite sign around a near-isoelectric F8-T4
    (<= 0.35x Fp2-F8), i.e. the maximum lies between F8 and T4 - the equipotentiality T1/T2 resolves."""
    syn = Synthesizer(normalize(_page("t1t2_bipolar", [_sed("T2")], 930003))["spec"], 300.0)
    pairs, peaks = _peaks(syn, "t1t2_bipolar")
    main = Counter(_main_reversal(p, pairs) for p in peaks)
    assert main["T2"] >= 0.95 * len(peaks), main
    pairs, peaks = _peaks(syn, "longitudinal_bipolar")
    lab = [mt.montage_label(p, "longitudinal_bipolar") for p in pairs]
    ratios = [abs(p[lab.index("F8-T4")]) / abs(p[lab.index("Fp2-F8")]) for p in peaks]
    signs = [np.sign(p[lab.index("Fp2-F8")]) == -np.sign(p[lab.index("T4-T6")]) for p in peaks]
    assert np.median(ratios) <= 0.35 and all(signs)


def test_laplacian_spike_is_maximal_and_negative_at_the_focus():
    """Hjorth source derivation: the C3 spike is largest at C3-Lp and surface-negative there."""
    syn = Synthesizer(normalize(_page("laplacian", [_sed("C3")], 930001))["spec"], 300.0)
    pairs, peaks = _peaks(syn, "laplacian")
    lab = [mt.montage_label(p, "laplacian") for p in pairs]
    for p in peaks:
        i = int(np.argmax(np.abs(p)))
        assert lab[i] == "C3-Lp" and p[i] < 0


def test_t1t2_rows_carry_background():
    """T1/T2 are not holes in the chain: F7-T1 and T1-T3 carry 0.3-1.2x the F7-T3 background (the learningeeg
    T1/T2 figure's subtemporal rows run about half to equal the temporal rows)."""
    spec = normalize(_page("t1t2_bipolar", [], 930005))["spec"]
    _, _, sig, pairs, _ = page_signals(spec)
    lab = [mt.montage_label(p, "t1t2_bipolar") for p in pairs]
    sd = dict(zip(lab, sig.std(axis=1)))
    ref = np.std(sig[lab.index("T3-T5")])
    for row in ("F7-T1", "T1-T3", "F8-T2", "T2-T4"):
        assert 0.3 <= sd[row] / ref <= 1.2, (row, sd[row] / ref)


# ------------------------------------------------------------------------------------------ state-dependent IEDs

SLEEP_AT = 15.0
DUR_MIN = 150


def _cects(**extra):
    e = _sed("right_centrotemporal", rate_h=60, amp=120.0, morphology="sharp_wave",
             foci=["right_centrotemporal", "left_centrotemporal"], focus_weights=[0.7, 0.3], sleep_activation=6.0)
    e.update(extra)
    return e


@pytest.fixture(scope="module")
def cects():
    spec = _record([{"type": "state_change", "at_min": SLEEP_AT, "to": "sleep"}, _cects()], 932001, DUR_MIN)
    return Synthesizer(spec, DUR_MIN * 60.0)


def _rate_by_stage(syn):
    rows = syn.sporadic_events()
    cnt = Counter(r["stage"] for r in rows)
    sec = _stage_seconds(syn, syn.duration_s)
    return {st: cnt.get(st, 0) / (s / 3600.0) for st, s in sec.items() if s > 600}


def test_sleep_activation_multiplies_rate_in_nrem(cects):
    """SeLECTS (ILAE 2022: centrotemporal spikes activated by drowsiness and sleep; learningeeg ESES awake page 2
    discharges / 20 s vs the BECTS sleep page about 1 / s): with sleep_activation 6 the N2/N3 rate is 4-8x the waking
    rate, N1 between, REM near wake (<= 2.5x)."""
    r = _rate_by_stage(cects)
    w = r["W"]
    assert 30 <= w <= 100, r
    for st in ("N2", "N3"):
        if st in r:
            assert 4.0 <= r[st] / w <= 8.0, (st, r)
    if "R" in r:
        assert r["R"] / w <= 2.5, r


def test_independent_bilateral_foci(cects):
    """Bilateral independent centrotemporal foci (common in SeLECTS): each discharge fires ONE side, C4:C3 drawn
    0.7:0.3, and its field stays on that side (C3-P3 vs C4-P4 ratio < 0.25 at a C4 discharge)."""
    rows = cects.sporadic_events()
    c = Counter(r["focus"] for r in rows)
    assert set(c) == {"right_centrotemporal", "left_centrotemporal"}
    assert 0.6 <= c["right_centrotemporal"] / sum(c.values()) <= 0.8
    t, sig, pairs = _isolated(cects, "longitudinal_bipolar", 2000.0, 2600.0)
    lab = [mt.montage_label(p, "longitudinal_bipolar") for p in pairs]
    for r in rows:
        if 2001 < r["t0"] < 2599 and r["focus"] == "right_centrotemporal":
            m = (t > r["t0"] - 0.03) & (t < r["t0"] + 0.05)
            assert np.ptp(sig[lab.index("C3-P3"), m]) < 0.25 * np.ptp(sig[lab.index("C4-P4"), m])


def test_centrotemporal_field_reverses_at_c_and_t_with_frontal_positivity():
    """learningeeg BECTS-centrotemporal-spikes-4-bipolar.webp: right centrotemporal spikes reverse at C4 (F4-C4 /
    C4-P4) and at T4 (F8-T4 / T4-T6) in the double banana; the SeLECTS horizontal dipole puts a positive pole
    frontally (Fp2 positive on an average reference while C4/T4 are negative)."""
    syn = Synthesizer(normalize(_page("longitudinal_bipolar", [_sed("right_centrotemporal")], 930007))["spec"], 300.0)
    pairs, peaks = _peaks(syn, "longitudinal_bipolar")
    rv = Counter(e for p in peaks for e, _ in _reversals(p, pairs))
    assert rv["C4"] >= 0.95 * len(peaks) and rv["T4"] >= 0.95 * len(peaks), rv
    pairs, peaks = _peaks(syn, "average")
    lab = [p[0] for p in pairs]
    for p in peaks:
        assert p[lab.index("C4")] < 0 and p[lab.index("T4")] < 0 and p[lab.index("Fp2")] > 0


def test_bisynchronous_foci_asymmetry():
    """learningeeg bisynchronous-P3-max-discharges / left-predominant-bifrontocentral-spikes: every discharge on both
    sides at once, the weaker side at its focus_weights ratio (0.5 here, measured on F3-C3 vs F4-C4)."""
    ev = [_sed("F3", foci=["F3", "F4"], focus_weights=[1.0, 0.5], synchrony="bisynchronous")]
    syn = Synthesizer(normalize(_page("longitudinal_bipolar", ev, 930006))["spec"], 300.0)
    pairs, peaks = _peaks(syn, "longitudinal_bipolar")
    lab = [mt.montage_label(p, "longitudinal_bipolar") for p in pairs]
    ratio = np.median([abs(p[lab.index("Fp2-F4")]) / abs(p[lab.index("Fp1-F3")]) for p in peaks])
    assert 0.4 <= ratio <= 0.6
    assert all(r["focus"] == "F3+F4" for r in syn.sporadic_events())


def test_activation_one_reproduces_the_ungated_schedule():
    """The state path only thins: sleep_activation 1.0 keeps every discharge of the ungated v3 schedule."""
    base = [{"type": "state_change", "at_min": 5.0, "to": "sleep"}, _sed("T3", rate_h=200)]
    a = Synthesizer(_record(base, 932002, 40), 2400.0)._sed
    b = Synthesizer(_record([base[0], _sed("T3", rate_h=200, sleep_activation=1.0)], 932002, 40), 2400.0)._sed
    assert np.array_equal(a, b)


def test_state_gated_schedule_is_window_independent():
    ev = [{"type": "state_change", "at_min": 5.0, "to": "sleep"}, _cects()]
    spec = _record(ev, 932003, 60)
    short = Synthesizer(spec, 1500.0).sporadic_events()
    long = Synthesizer(spec, 3600.0).sporadic_events()
    keep = lambda rows: [(round(r["t0"], 6), r["focus"], r["stage"]) for r in rows if r["t0"] < 1300.0]  # noqa
    assert keep(short) == keep(long) and len(keep(short)) > 20


def test_answer_key_reports_stage_and_focus(cects):
    rows = realized_events(cects, cects.duration_s)
    sd = [r for r in rows if r["kind"] == "sporadic_discharge"]
    assert sd and all("stage" in r and r["synchrony"] == "independent" for r in sd)
    summ = sporadic_summary(rows, cects.duration_s, _stage_seconds(cects, cects.duration_s))[0]
    assert set(summ["count_by_focus"]) == {"right_centrotemporal", "left_centrotemporal"}
    assert summ["per_hour_by_stage"]["N2"] > 3 * summ["per_hour_by_stage"]["W"]


def test_state_gating_hook_api(cects):
    """The hook the generalized family's ESES / DEE-SWAS uses: per-time rate and NREM intervals."""
    iv = cects.stage_intervals()
    assert iv and all(b > a for a, b in iv)
    tn = np.array([0.5 * (a + b) for a, b in iv])
    assert np.all(cects.stage_rate(tn, 10.0, sleep_activation=5.0) >= 10.0 * (1 + 4 * 0.6) - 1e-9)
    assert cects.stage_rate(np.array([60.0]), 10.0, sleep_activation=5.0)[0] == pytest.approx(10.0)
    assert sv3.stage_rate_table(10.0, 5.0, {"N3": 0.0})["N3"] == 0.0
