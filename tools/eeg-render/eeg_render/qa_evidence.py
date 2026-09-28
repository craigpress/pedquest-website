"""Render actual exported samples and the viewer's computed trend sidecar for QA."""
from __future__ import annotations
import json
import re
import struct
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from . import montage as mt
from .render_page import chain_breaks


def lab_evidence(packet: Path, out: Path, montage: str | None = None) -> tuple[list[Path], dict]:
    meta = json.loads(packet.read_text(encoding="utf-8"))
    raw = Path(meta["trendSidecar"]).read_bytes()
    if raw[:4] != b"PQTR":
        raise ValueError("Missing viewer trend sidecar")
    size = struct.unpack_from("<I", raw, 4)[0]
    header = json.loads(raw[8:8 + size].decode().rstrip("\0").strip())
    if header["format"] != 1 or header["filled"] != header["nT"]:
        raise ValueError("Incomplete or unsupported trend sidecar")
    arrays = {}
    offset = 8 + size
    for key in header["arrays"]:
        n = header["nT"] * (header["nF"] if key.startswith("psd.") else 1)
        a = np.frombuffer(raw, dtype="<f4", count=n, offset=offset)
        if not np.isfinite(a).all():
            raise ValueError("Nonfinite trend values")
        arrays[key] = a
        offset += n * 4
    if offset != len(raw):
        raise ValueError("Trend sidecar length mismatch")
    images = []
    plan = display_montage(meta["labels"], montage)
    windows = [np.asarray(w["data"], dtype=float) for w in meta["windows"]]
    derived = [[fn(x) for _, fn in plan["rows"]] for x in windows]
    spacing = _row_spacing([r for rows in derived for r in rows])
    for i, window in enumerate(meta["windows"]):
        rows = list(derived[i])
        names = [label for label, _ in plan["rows"]]
        for label, idx in plan["aux"]:
            trace = windows[i][idx]
            factor = _aux_factor(trace, spacing)
            rows.append(trace * factor)
            names.append(label if factor == 1 else f"{label} ×{factor:g}")
        breaks = set(plan["breaks"]) | ({len(plan["rows"])} if plan["aux"] else set())
        y, ys = 0.0, []
        for j in range(len(rows)):
            y -= spacing * (1.5 if j in breaks else 1)
            ys.append(y)
        fig, ax = plt.subplots(figsize=(16, max(9, .42 * len(rows) + 2)))
        t = np.arange(windows[i].shape[1]) / meta["sampleRate"] + window["t0"]
        for trace, y0 in zip(rows, ys):
            ax.plot(t, -trace + y0, color="black", linewidth=.4)
        ax.set_yticks(ys, names)
        ax.set_xlabel(f"Elapsed seconds; negative up; {plan['name']} derived from the exported referential samples; "
                      f"row spacing {spacing:g} µV")
        ax.set_title("SYNTHETIC EEG — actual exported samples — " + plan["name"] + " — QA window " + str(i+1)
                     + " — " + window.get("reason", "sample"))
        x = t[-1] + .15
        ax.plot([x, x], [ys[-1], ys[-1] + 50], color="black", linewidth=1)
        ax.text(x + .05, ys[-1] + 25, "50 µV", va="center", fontsize=8)
        ax.set_xlim(t[0], t[-1] + .8)
        ax.set_ylim(ys[-1] - spacing, -spacing * .1)
        ax.grid(axis="x", alpha=.2)
        path = out / f"qa-raw-{i+1}.png"
        fig.savefig(path, dpi=110, bbox_inches="tight"); plt.close(fig)
        images.append(path)
    fig, axes = plt.subplots(7, 1, figsize=(16, 13), sharex=True)
    t = arrays["t"] / 60
    db_values = np.concatenate([10*np.log10(np.maximum(arrays["psd."+s], 1e-12)) for s in ("left", "right")])
    low, high = np.percentile(db_values, [5, 95])
    high = max(high, low + 1)
    for i, side in enumerate(("left", "right")):
        psd = arrays["psd."+side].reshape(header["nT"], header["nF"]).T
        im = axes[i].imshow(10*np.log10(np.maximum(psd, 1e-12)), origin="lower", aspect="auto",
            extent=[t[0],t[-1], header["freqs"][0], header["freqs"][-1]], cmap="magma", vmin=low, vmax=high)
        axes[i].set_ylabel(side + " Hz")
        fig.colorbar(im, cax=axes[i].inset_axes([1.02, 0, .015, 1]), label="dB µV²/Hz")
    for ax, key, label in zip(axes[2:6], ["totalPower", "adr", "sr", "aeegHi"],
                             ["Power µV²", "Alpha/delta", "Suppression %", "aEEG µV"]):
        for side, color in (("left", "tab:blue"), ("right", "tab:orange")):
            ax.plot(t, arrays[key+"."+side], label=side, linewidth=.8, color=color)
            if key == "aeegHi":
                ax.plot(t, arrays["aeegLo."+side], linestyle=":", linewidth=.7, color=color)
        ax.set_ylabel(label); ax.legend(loc="upper right")
        if key == "sr": ax.set_ylim(0, 100)
    axes[6].plot(t, arrays["asym"]); axes[6].set_ylabel("Asymmetry %"); axes[6].set_xlabel("Elapsed minutes")
    axes[6].set_xlim(0, meta.get("durationS", float(arrays["t"][-1])) / 60)
    for i, window in enumerate(meta["windows"]):
        start = window["t0"] / 60
        stop = (window["t0"] + len(window["data"][0]) / meta["sampleRate"]) / 60
        for ax in axes:
            ax.axvspan(start, stop, color="cyan", alpha=.12)
        axes[0].text((start + stop) / 2, 1.01, str(i+1), transform=axes[0].get_xaxis_transform(), ha="center", fontsize=8)
    fig.suptitle("SYNTHETIC — viewer-calculated trends; engine " + str(header["engineVersion"]))
    path = out / "qa-trends.png"
    fig.savefig(path, dpi=110, bbox_inches="tight"); plt.close(fig)
    images.append(path)
    return images, {"coverage": meta["coverage"], "sample_rate": meta["sampleRate"],
                    "suppression_rule": meta.get("suppressionRule", "not provided"),
                    "spectrogram_scale": {"units": "dB µV²/Hz", "shared_left_right": True, "limits": [float(low), float(high)]},
                    "trend_engine": header["engineVersion"], "aeeg_derivation": header["aeegDerivation"],
                    "raw_windows": [{"start_s": w["t0"], "reason": w.get("reason", "sample")} for w in meta["windows"]],
                    "numeric_checks": "finite arrays; complete epoch count; valid binary dimensions",
                    "coverage_warning": "Raw EEG coverage is sampled; events outside selected windows need human inspection.",
                    "raw_montage": {"id": plan["id"], "name": plan["name"], "source": plan["source"],
                                    "derivations": [label for label, _ in plan["rows"]],
                                    "auxiliary": [label for label, _ in plan["aux"]], "row_spacing_uv": spacing},
                    "limitation": "Numeric checks do not independently validate the algorithm; raw samples are displayed in "
                                  + plan["name"] + ", re-derived from the exported referential channels."}


_AUX_RE = re.compile(r"^(ekg|ecg|emg|eog|resp|sao2|spo2)\b", re.I)
_ALIASES = {"T7": "T3", "T8": "T4", "P7": "T5", "P8": "T6", "FT9": "T1", "FT10": "T2"}
_CANONICAL = {e.upper(): e for e in list(mt.POSITIONS) + mt.STANDARD_19_T1T2 + mt.REFERENCE_ELECTRODES}
_LEGACY_NAMES = {"longitudinal_bipolar": "Longitudinal bipolar (LB-18.3)", "neonatal_reduced": "Neonatal bipolar (reduced)",
                 "average": "Average reference", "referential": "Referential (ear)"}


def _norm(label: str) -> str:
    """Electrode name as the viewer reads it (montage.ts ``norm``): drop 'EEG ', cut at '-' or space, alias 10-10."""
    base = re.split(r"[-\s]", re.sub(r"^EEG\s*", "", label.strip(), flags=re.I))[0]
    base = _ALIASES.get(base.upper(), base)
    return _CANONICAL.get(base.upper(), base)


def display_montage(labels: list[str], requested: str | None = None) -> dict:
    """Derivations for the QA raw pages, built from referential export channels.

    Longitudinal bipolar by default (the reduced neonatal chains when the array lacks the double-banana
    electrodes, by montage.py's rule); the job spec's montage when it names one the recording supports.
    Returns rows as (label, fn(samples) -> trace), chain breaks, auxiliary (label, index) rows and provenance.
    """
    index: dict[str, int] = {}
    for i, label in enumerate(labels):
        index.setdefault(_norm(label), i)
    aux = [(_norm(l), i) for i, l in enumerate(labels) if _AUX_RE.match(_norm(l))]
    channels = [e for e in index if e in mt.POSITIONS or e in mt.REFERENCE_ELECTRODES]
    scalp = [e for e in channels if e not in mt.REFERENCE_ELECTRODES]
    requested = mt.MONTAGE_ALIASES.get(requested, requested) if requested else None
    source = "job spec" if requested else "default"
    montage = requested or "longitudinal_bipolar"
    known = montage in mt.VIEWER_MONTAGES or montage in _LEGACY_NAMES
    if not known or any(e not in index for e in mt.VIEWER_MONTAGES.get(montage, ("", ()))[1]):
        source = f"default (job montage {requested!r} unsupported by this recording)"
        montage = "longitudinal_bipolar"
    if montage == "longitudinal_bipolar" and "T5" not in index:
        montage, source = "neonatal_reduced", source + "; reduced array (no full double banana)"
    pairs = mt.montage_pairs(montage, channels)
    breaks = mt.montage_breaks(montage, channels)
    if breaks is None:
        breaks = chain_breaks(pairs)
    name = mt.montage_display_name(montage) if montage in mt.VIEWER_MONTAGES else _LEGACY_NAMES[montage]

    def row(pair):
        a, b = pair
        ia = index[a]
        if isinstance(b, tuple):
            refs = [index[e] for e in b]
            return mt.montage_label(pair, montage), lambda x: x[ia] - x[refs].mean(axis=0)
        if b is not None:
            ib = index[b]
            return mt.montage_label(pair, montage), lambda x: x[ia] - x[ib]
        if montage == "average":
            refs = [index[e] for e in scalp]
            return f"{a}-Avg", lambda x: x[ia] - x[refs].mean(axis=0)
        ear = "A1" if mt.side_of(a) != "right" else "A2"
        if ear in index:
            ie = index[ear]
            return f"{a}-{ear}", lambda x: x[ia] - x[ie]
        return f"{a}-Ref", lambda x: x[ia]

    rows = [row(p) for p in pairs]
    if not rows:  # no recognisable 10-20 electrodes: show the channels as exported
        montage, name, source, breaks = "as_recorded", "As recorded", "fallback (no 10-20 electrodes found)", []
        rows = [(l, (lambda i: lambda x: x[i])(i)) for i, l in enumerate(labels)
                if not _AUX_RE.match(_norm(l))][:21]
    return {"id": montage, "name": name, "source": source, "rows": rows, "breaks": breaks, "aux": aux}


def _row_spacing(traces: list) -> float:
    """50-µV-step spacing sized to the median derivation's 1st-99th percentile range."""
    if not traces:
        return 100.0
    amp = float(np.median([np.percentile(t, 99) - np.percentile(t, 1) for t in traces]))
    return float(np.clip(50 * np.ceil(amp / 1.2 / 50), 50, 500))


def _aux_factor(trace, spacing: float) -> float:
    """Largest 1-2-5 display gain (<= 1) that keeps an auxiliary trace within about one and a half rows."""
    pp = float(np.percentile(trace, 99) - np.percentile(trace, 1))
    for factor in (1, .5, .2, .1, .05, .02, .01, .005, .002, .001):
        if pp * factor <= 1.5 * spacing:
            return factor
    return .001
