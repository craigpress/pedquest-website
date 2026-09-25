"""Render actual exported samples and the viewer's computed trend sidecar for QA."""
from __future__ import annotations
import json
import struct
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def lab_evidence(packet: Path, out: Path) -> tuple[list[Path], dict]:
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
    for i, window in enumerate(meta["windows"]):
        fig, ax = plt.subplots(figsize=(16, 9))
        signals = np.asarray(window["data"])
        labels = meta["labels"]
        n = min(len(labels), 21)
        t = np.arange(signals.shape[1]) / meta["sampleRate"] + window["t0"]
        for j in range(n):
            ax.plot(t, -signals[j] + (n - j) * 100, color="black", linewidth=.4)
        ax.set_yticks([(n-j)*100 for j in range(n)], labels[:n])
        ax.set_xlabel("Elapsed seconds; negative up; exported reference; row spacing 100 µV")
        ax.set_title("SYNTHETIC EEG — actual exported samples — QA window " + str(i+1))
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
    fig.suptitle("SYNTHETIC — viewer-calculated trends; engine " + str(header["engineVersion"]))
    path = out / "qa-trends.png"
    fig.savefig(path, dpi=110, bbox_inches="tight"); plt.close(fig)
    images.append(path)
    return images, {"coverage": meta["coverage"], "sample_rate": meta["sampleRate"],
                    "suppression_rule": meta.get("suppressionRule", "not provided"),
                    "spectrogram_scale": {"units": "dB µV²/Hz", "shared_left_right": True, "limits": [float(low), float(high)]},
                    "trend_engine": header["engineVersion"], "aeeg_derivation": header["aeegDerivation"],
                    "numeric_checks": "finite arrays; complete epoch count; valid binary dimensions",
                    "coverage_warning": "Raw EEG coverage is sampled; events outside selected windows need human inspection.",
                    "limitation": "Numeric checks do not independently validate the algorithm; raw samples are in exported reference."}
