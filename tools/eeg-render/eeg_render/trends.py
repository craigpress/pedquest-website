"""Quantitative trends, computed from the synthesized EEG.

Nothing here is drawn or faked: every panel a ``qeeg_panel`` shows is derived
from the referential potentials produced by :mod:`eeg_render.synth`, using the
same class of algorithm a bedside review station uses.  See the README for the
formulas and their sign conventions; the short version is:

FFT spectrogram      Hann-windowed periodogram, 4 s window, hop = ``hop_s``,
                     PSD pooled (mean) over the hemisphere's bipolar chains.
Rhythmicity          normalized autocorrelation of the 1 Hz band around each
                     target frequency, evaluated at lag = 3 cycles, over a 16 s
                     window, gated by band amplitude; pooled by max over the
                     hemisphere's chains.
Relative asymmetry   100 * (P_right - P_left) / (P_right + P_left), per
                     frequency.  **Positive = more power on the RIGHT.**
Asymmetry index      the same ratio over 1-20 Hz total power.
aEEG                 peak-to-peak amplitude of the 2-15 Hz asymmetric (CFM)
                     filtered signal in a sliding 0.5 s window; lower/upper
                     margins are the 5th/95th percentiles per display epoch.
Suppression ratio    % of 0.5 s epochs whose peak-to-peak amplitude (0.5-30 Hz)
                     is below ``sr_threshold_uv`` (default 5), in a 1 min
                     trailing window.
Seizure probability  HEURISTIC (see README): rhythmicity x power-rise, with a
                     persistence requirement.  Not a validated detector.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np
from scipy import ndimage, signal as sps

from . import montage as mt
from .synth import Synthesizer

SHORT_WIN_S = 4.0
LONG_WIN_S = 16.0
BLOCK_S = 300.0
MARGIN_S = 12.0
FMAX_DISPLAY = 20.0
RHY_FREQS = np.arange(0.5, 20.01, 0.5)
SR_THRESHOLD_UV = 5.0
SR_WINDOW_S = 60.0
SR_EPOCH_S = 0.5
AEEG_PP_WIN_S = 0.5
AEEG_DISPLAY_WIN_S = 60.0     # span whose amplitude min/max become the margins

SIDES = ("left", "right")


@dataclass
class Trends:
    """Every trend on a common epoch grid."""

    t: np.ndarray                                     # epoch centres, s
    hop_s: float
    freqs: np.ndarray                                 # spectrogram freq axis, Hz
    rhy_freqs: np.ndarray
    psd: Dict[str, np.ndarray] = field(default_factory=dict)      # (n_f, n_t) uV^2/Hz
    rhy: Dict[str, np.ndarray] = field(default_factory=dict)      # (n_rf, n_t) 0..1
    aeeg_lo: Dict[str, np.ndarray] = field(default_factory=dict)  # uV
    aeeg_hi: Dict[str, np.ndarray] = field(default_factory=dict)
    sr: Dict[str, np.ndarray] = field(default_factory=dict)       # %
    env: Dict[str, np.ndarray] = field(default_factory=dict)      # uV (envelope trend)
    total_power: Dict[str, np.ndarray] = field(default_factory=dict)   # uV^2 (1-20 Hz)
    adr: Dict[str, np.ndarray] = field(default_factory=dict)      # alpha/delta ratio
    asym_rel: Optional[np.ndarray] = None             # (n_f, n_t) %
    asym_idx: Optional[np.ndarray] = None             # (n_t,) %
    szprob: Optional[np.ndarray] = None               # (n_t,) 0..1
    aeeg_derivation: Dict[str, str] = field(default_factory=dict)
    sr_threshold_uv: float = SR_THRESHOLD_UV

    @property
    def n_t(self) -> int:
        return int(self.t.size)


# --------------------------------------------------------------------------
# filters
# --------------------------------------------------------------------------

def aeeg_filter(fs: int) -> np.ndarray:
    """FIR approximation of the CFM asymmetric 2-15 Hz filter.

    The classic cerebral function monitor front end passes 2-15 Hz with a
    rising gain across the band (roughly +12 dB/decade), which is why aEEG is
    relatively insensitive to delta and to EMG.
    """
    nyq = fs / 2.0
    pts = np.array([0.0, 1.0, 2.0, 3.0, 5.0, 8.0, 12.0, 15.0, 17.5, 24.0, nyq])
    gains = np.array([0.0, 0.10, 0.80, 0.86, 0.92, 0.97, 1.00, 1.00, 0.45, 0.04, 0.0])
    taps = sps.firwin2(numtaps=int(2 * fs) | 1, freq=pts / nyq, gain=gains)
    return taps


def apply_fir(sig: np.ndarray, taps: np.ndarray) -> np.ndarray:
    """Zero-phase FIR filtering without ``filtfilt``.

    ``firwin2`` returns a symmetric (linear-phase) kernel, so a single
    ``fftconvolve(..., mode="same")`` is already zero-phase and ~50x cheaper
    than ``filtfilt``, which spends its time solving a 513x513 system in
    ``lfilter_zi`` for every call.
    """
    return sps.fftconvolve(sig, taps, mode="same", axes=-1)


def _sos_band(fs: int, lo: float, hi: float, order: int = 4):
    nyq = fs / 2.0
    hi = min(hi, nyq * 0.95)
    return sps.butter(order, [lo / nyq, hi / nyq], btype="band", output="sos")


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def _epoch_windows(sig: np.ndarray, starts: np.ndarray, win_n: int) -> np.ndarray:
    """(n_ch, n_epochs, win_n) gathered at the given local start indices."""
    view = np.lib.stride_tricks.sliding_window_view(sig, win_n, axis=-1)
    return view[:, starts, :]


def _psd(windows: np.ndarray, fs: int, win: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """One-sided PSD in uV^2/Hz for Hann-windowed epochs."""
    n = windows.shape[-1]
    scale = 2.0 / (fs * float(np.sum(win ** 2)))
    spec = np.fft.rfft(windows * win, axis=-1)
    psd = (np.abs(spec) ** 2) * scale
    freqs = np.fft.rfftfreq(n, 1.0 / fs)
    return freqs, psd


def _pp_envelope(sig: np.ndarray, fs: int, win_s: float) -> np.ndarray:
    """Peak-to-peak amplitude in a sliding window (uV), same length as sig."""
    k = max(3, int(round(win_s * fs)))
    hi = ndimage.maximum_filter1d(sig, size=k, axis=-1, mode="nearest")
    lo = ndimage.minimum_filter1d(sig, size=k, axis=-1, mode="nearest")
    return hi - lo


RHY_Q = 8.0          # constant-Q band: sigma(f) = f / Q
RHY_SIGMA_MIN = 0.22  # Hz - floor so the 0.5 Hz row stays estimable
RHY_CYCLES = 2.0      # autocorrelation lag, in cycles of the target frequency


def _acf_matrices(freqs: np.ndarray, targets: np.ndarray,
                  q: float = RHY_Q, sigma_min: float = RHY_SIGMA_MIN,
                  cycles: float = RHY_CYCLES):
    """Mask, complex-lag and flat-spectrum reference for band autocorrelation.

    For a signal band-limited by a Gaussian mask ``M_f`` around ``f``, the
    complex autocorrelation at lag tau is
    ``sum_k P_k M_f(k) exp(i 2 pi nu_k tau) / sum_k P_k M_f(k)`` - so the
    band-pass and the autocorrelation collapse into two matrix products.

    Two choices matter:

    * the **magnitude** of the complex autocorrelation (the ACF *envelope*) is
      used rather than its real part.  A seizure that evolves 4 -> 1.5 Hz is
      strongly periodic at every instant, but its frequency drifts within the
      analysis window, so the real part at a fixed lag partially cancels and a
      cos-based estimator reads a chirping discharge as *non*-rhythmic.  The
      envelope measures band concentration and is chirp-tolerant.
    * the mask is **constant-Q** (``sigma = f / Q``) with the lag a fixed
      number of cycles, so the mask's own decorrelation - what white noise
      scores, ``acf_flat = |sum_k M_f(k) exp(i 2 pi nu_k tau_f)|`` - is the
      same at every frequency instead of rising steeply with ``f``.

    Rhythmicity is then the excess over that reference,
    ``(acf - acf_flat) / (1 - acf_flat)``: 0 means "no more periodic than
    noise" at any frequency, 1 means a pure tone.
    """
    sigma = np.maximum(targets / q, sigma_min)
    m = np.exp(-0.5 * ((freqs[None, :] - targets[:, None]) / sigma[:, None]) ** 2)
    m[:, freqs <= 0.05] = 0.0
    m /= np.maximum(m.sum(axis=1, keepdims=True), 1e-12)
    lags = cycles / np.maximum(targets, 1e-6)
    e = np.exp(1j * 2 * np.pi * freqs[None, :] * lags[:, None])
    acf_flat = np.abs((m * e).sum(axis=1))
    return m, m * e, acf_flat


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def default_hop_s(duration_s: float) -> float:
    """Keep the trend grid under ~11k columns whatever the recording length."""
    return 2.0 if duration_s <= 21600 else 4.0


def hemisphere_chains(synth: Synthesizer, spec: Dict) -> Dict[str, List[Tuple[str, str]]]:
    chains = mt.trend_chains(synth.scalp)
    override = spec.get("hemisphere_channels", "default")
    if isinstance(override, dict):
        for side in SIDES:
            names = override.get(side)
            if not names:
                continue
            pairs: List[Tuple[str, str]] = []
            for item in names:
                if "-" in item:
                    a, b = item.split("-", 1)
                    if a in synth._idx and b in synth._idx:
                        pairs.append((a, b))
            if pairs:
                chains[side] = pairs
    return chains


def compute_trends(
    synth: Synthesizer,
    duration_s: float,
    spec: Optional[Dict] = None,
    hop_s: Optional[float] = None,
    sr_threshold_uv: Optional[float] = None,
    progress: Optional[Callable[[float], None]] = None,
) -> Trends:
    spec = spec or synth.spec
    _style = spec.get("style") or {}
    if sr_threshold_uv is None:
        sr_threshold_uv = float(_style.get("suppression_threshold_uv", SR_THRESHOLD_UV))
    envelope_statistic = str(_style.get("envelope_statistic", "median"))
    fs = synth.fs
    hop_s = float(hop_s or default_hop_s(duration_s))
    hop_n = max(1, int(round(hop_s * fs)))
    n_t = max(2, int(np.floor(duration_s / hop_s)))
    t_grid = (np.arange(n_t) + 0.5) * hop_s

    chains = hemisphere_chains(synth, spec)
    short_n = int(round(SHORT_WIN_S * fs))
    long_n = int(round(LONG_WIN_S * fs))
    short_win = np.hanning(short_n)
    long_win = np.hanning(long_n)

    f_short = np.fft.rfftfreq(short_n, 1.0 / fs)
    keep_disp = f_short <= FMAX_DISPLAY + 1e-9
    freqs_disp = f_short[keep_disp]

    # rhythmicity: 3-segment Welch inside the 16 s span (8 s segments, 50 %
    # overlap) - one raw periodogram is far too noisy to threshold on.
    rhy_sub_n = long_n // 2
    rhy_sub_win = np.hanning(rhy_sub_n)
    rhy_offsets = (0, long_n // 4, long_n // 2)
    f_long = np.fft.rfftfreq(rhy_sub_n, 1.0 / fs)
    keep_long = f_long <= 24.0
    m_mask, m_cos, acf_flat = _acf_matrices(f_long[keep_long], RHY_FREQS)
    band_bw = 1.0  # effective bandwidth of the (normalized) Gaussian mask, Hz
    # the 16 s rhythmicity window is heavily oversampled at a 2 s hop, so it is
    # evaluated every ~4 s and interpolated back onto the trend grid
    rhy_stride = max(1, int(round(4.0 / hop_s)))

    aeeg_taps = aeeg_filter(fs)
    sos_sr = _sos_band(fs, 0.5, 30.0)
    sos_env = _sos_band(fs, 2.0, 20.0)
    aeeg_pairs = {s: pick_aeeg_derivation(synth, [], s) for s in SIDES}

    out = Trends(t=t_grid, hop_s=hop_s, freqs=freqs_disp, rhy_freqs=RHY_FREQS)
    out.sr_threshold_uv = float(sr_threshold_uv)
    out.aeeg_derivation = {s: f"{a}-{b}" for s, (a, b) in aeeg_pairs.items()}
    for side in SIDES:
        out.psd[side] = np.zeros((freqs_disp.size, n_t))
        out.rhy[side] = np.zeros((RHY_FREQS.size, n_t))
        out.aeeg_lo[side] = np.zeros(n_t)
        out.aeeg_hi[side] = np.zeros(n_t)
        out.sr[side] = np.zeros(n_t)
        out.env[side] = np.zeros(n_t)

    sr_epoch_n = max(1, int(round(SR_EPOCH_S * fs)))
    sr_flags: Dict[str, List[np.ndarray]] = {s: [] for s in SIDES}
    sr_pp: Dict[str, List[np.ndarray]] = {s: [] for s in SIDES}
    sr_times: List[np.ndarray] = []

    n_blocks = int(np.ceil(duration_s / BLOCK_S))
    for b in range(n_blocks):
        t_start = b * BLOCK_S
        t_end = min(duration_s, t_start + BLOCK_S)
        col0 = int(np.searchsorted(t_grid, t_start, side="left"))
        col1 = int(np.searchsorted(t_grid, t_end, side="left"))
        if col1 <= col0:
            continue

        seg_t0 = t_start - MARGIN_S
        seg_t1 = t_end + MARGIN_S
        seg_i0 = int(round(seg_t0 * fs))
        _, x = synth.segment(seg_t0, seg_t1)

        centres = t_grid[col0:col1]
        centre_idx = np.round(centres * fs).astype(np.int64) - seg_i0
        short_starts = centre_idx - short_n // 2
        long_starts = centre_idx - long_n // 2
        if short_starts.min() < 0 or long_starts.min() < 0:
            pad = int(max(-short_starts.min(), -long_starts.min())) + 1
            x = np.concatenate([x[:, :pad][:, ::-1], x], axis=1)
            seg_i0 -= pad
            short_starts += pad
            long_starts += pad
        need = int(max(short_starts.max() + short_n, long_starts.max() + long_n))
        if need > x.shape[1]:
            pad = need - x.shape[1] + 1
            x = np.concatenate([x, x[:, -pad:][:, ::-1]], axis=1)

        sr_edges = np.arange(t_start, t_end, SR_EPOCH_S)
        sr_local = np.round(sr_edges * fs).astype(np.int64) - seg_i0
        sr_local = sr_local[(sr_local >= 0) & (sr_local + sr_epoch_n <= x.shape[1])]
        sr_times.append(sr_edges[: sr_local.size] + SR_EPOCH_S / 2.0)

        for side in SIDES:
            pairs = chains[side]
            if not pairs:
                continue
            sig = synth.derive(x, [(a, b) for a, b in pairs])

            # --- FFT spectrogram -------------------------------------
            w_short = _epoch_windows(sig, short_starts, short_n)
            _, psd_ch = _psd(w_short, fs, short_win)
            psd_side = psd_ch.mean(axis=0)[:, keep_disp]           # (n_ep, n_f)
            out.psd[side][:, col0:col1] = psd_side.T

            # --- rhythmicity -----------------------------------------
            sub = np.arange(0, long_starts.size, rhy_stride)
            if sub.size and sub[-1] != long_starts.size - 1:
                sub = np.append(sub, long_starts.size - 1)
            psd_long = None
            for off in rhy_offsets:
                w_long = _epoch_windows(sig, long_starts[sub] + off, rhy_sub_n)
                _, p = _psd(w_long, fs, rhy_sub_win)
                p = p[:, :, keep_long]
                psd_long = p if psd_long is None else psd_long + p
            psd_long = psd_long / len(rhy_offsets)                  # (n_ch, n_ep, n_k)
            num = np.abs(np.einsum("cek,fk->cef", psd_long.astype(complex), m_cos))
            den = np.einsum("cek,fk->cef", psd_long, m_mask)
            acf = np.divide(num, den, out=np.zeros_like(num), where=den > 1e-15)
            excess = (acf - acf_flat[None, None, :]) / (1.0 - acf_flat[None, None, :])
            band_rms2 = np.maximum(den, 0.0) * band_bw
            gate = band_rms2 / (band_rms2 + 1.5 ** 2)
            rhy_ch = np.clip(excess, 0.0, 1.0) * gate
            # pooling: mean of the two strongest derivations.  A plain max over
            # eight noisy estimators has a large upward bias; a mean dilutes a
            # focal rhythmic run.  The top-2 mean keeps focal sensitivity
            # without the single-channel noise floor.
            if rhy_ch.shape[0] >= 2:
                rhy_sub = np.sort(rhy_ch, axis=0)[-2:].mean(axis=0)
            else:
                rhy_sub = rhy_ch[0]
            rhy_sub = np.clip(rhy_sub, 0.0, 1.0) ** 1.35            # display contrast
            if sub.size == long_starts.size:
                out.rhy[side][:, col0:col1] = rhy_sub.T
            else:
                for fi in range(RHY_FREQS.size):
                    out.rhy[side][fi, col0:col1] = np.interp(
                        np.arange(long_starts.size), sub, rhy_sub[:, fi])

            # --- aEEG -------------------------------------------------
            # A review station's hemispheric aEEG runs on ONE derivation, not
            # a pool: averaging the rectified envelope over eight chains
            # collapses the moment-to-moment amplitude variation that *is* the
            # width of the aEEG band, and the trace comes out as a thin ribbon.
            a, bq = aeeg_pairs[side]
            one = synth.derive(x, [(a, bq)])[0]
            filt = apply_fir(one, aeeg_taps)
            pp = _pp_envelope(filt, fs, AEEG_PP_WIN_S)
            aeeg_win_n = max(short_n, int(round(AEEG_DISPLAY_WIN_S * fs)))
            aw = _epoch_windows(pp[None, :], np.clip(centre_idx - aeeg_win_n // 2, 0,
                                                     pp.size - aeeg_win_n), aeeg_win_n)[0]
            out.aeeg_lo[side][col0:col1] = np.percentile(aw, 1, axis=-1)
            out.aeeg_hi[side][col0:col1] = np.percentile(aw, 99, axis=-1)

            # --- suppression ratio ------------------------------------
            srf = sps.sosfiltfilt(sos_sr, sig, axis=-1)
            if sr_local.size:
                blocks = np.lib.stride_tricks.sliding_window_view(
                    srf, sr_epoch_n, axis=-1)[:, sr_local, :]
                pp_ep = blocks.max(axis=-1) - blocks.min(axis=-1)      # (n_ch, n_ep)
                pooled_pp = pp_ep.mean(axis=0)
                sr_flags[side].append((pooled_pp < sr_threshold_uv).astype(float))
                env_sig = sps.sosfiltfilt(sos_env, sig, axis=-1)
                env_blocks = np.lib.stride_tricks.sliding_window_view(
                    env_sig, sr_epoch_n, axis=-1)[:, sr_local, :]
                sr_pp[side].append((env_blocks.max(axis=-1) - env_blocks.min(axis=-1)).mean(axis=0))
            else:
                sr_flags[side].append(np.zeros(0))
                sr_pp[side].append(np.zeros(0))

        if progress:
            progress((b + 1) / n_blocks)

    # ---- suppression ratio: trailing 1 min window -----------------------
    sr_t = np.concatenate(sr_times) if sr_times else np.zeros(0)
    win_ep = max(1, int(round(SR_WINDOW_S / SR_EPOCH_S)))
    for side in SIDES:
        flags = np.concatenate(sr_flags[side]) if sr_flags[side] else np.zeros(0)
        if flags.size == 0 or sr_t.size == 0:
            continue
        flags = flags[: sr_t.size]
        kern = np.ones(win_ep) / win_ep
        pad = np.concatenate([np.full(win_ep, flags[0]), flags])
        rolling = np.convolve(pad, kern, mode="valid")[: flags.size] * 100.0
        out.sr[side] = np.interp(t_grid, sr_t[: flags.size], rolling)

        # Envelope amplitude uses its own 2–20 Hz filter, independent of SR.
        amps = np.concatenate(sr_pp[side]) if sr_pp[side] else np.zeros(0)
        if amps.size:
            amps = amps[: sr_t.size]
            k = max(1, int(round(60.0 / SR_EPOCH_S)))
            stat = {"mean": lambda a: ndimage.uniform_filter1d(a, size=k, mode="nearest"),
                    "p90": lambda a: ndimage.percentile_filter(a, 90, size=k, mode="nearest"),
                    }.get(envelope_statistic,
                          lambda a: ndimage.median_filter(a, size=k, mode="nearest"))
            out.env[side] = np.interp(t_grid, sr_t[: amps.size], stat(amps))

    # ---- asymmetry -------------------------------------------------------
    pl, pr = out.psd["left"], out.psd["right"]
    tot = pl + pr
    out.asym_rel = np.divide(100.0 * (pr - pl), tot, out=np.zeros_like(tot), where=tot > 1e-12)
    # a per-bin ratio of two noisy PSDs is very speckly; smooth lightly in both
    # axes so the panel shows regional/spectral asymmetry rather than variance
    out.asym_rel = ndimage.uniform_filter(
        out.asym_rel, size=(3, max(1, int(round(10.0 / hop_s)))), mode="nearest")

    band = (out.freqs >= 1.0) & (out.freqs <= 20.0)
    bl = pl[band].sum(axis=0)
    br = pr[band].sum(axis=0)
    idx = np.divide(100.0 * (br - bl), br + bl, out=np.zeros_like(bl), where=(br + bl) > 1e-12)
    out.asym_idx = ndimage.uniform_filter1d(idx, size=max(1, int(20.0 / hop_s)))

    # ---- Benedetti-2023 style scalar trends -------------------------------
    df = float(out.freqs[1] - out.freqs[0]) if out.freqs.size > 1 else 1.0
    b_tot = (out.freqs >= 1.0) & (out.freqs <= 20.0)
    b_alpha = (out.freqs >= 8.0) & (out.freqs <= 13.0)
    b_delta = (out.freqs >= 1.0) & (out.freqs <= 4.0)
    for side in SIDES:
        p = out.psd[side]
        out.total_power[side] = p[b_tot].sum(axis=0) * df
        d = p[b_delta].sum(axis=0)
        out.adr[side] = np.divide(p[b_alpha].sum(axis=0), d,
                                  out=np.zeros_like(d), where=d > 1e-12)
        out.adr[side] = ndimage.uniform_filter1d(
            out.adr[side], size=max(1, int(round(30.0 / hop_s))))

    # ---- heuristic seizure probability -----------------------------------
    out.szprob = seizure_probability(out)
    return out


def seizure_probability(tr: Trends) -> np.ndarray:
    """Heuristic ictal-likelihood trend (NOT a validated seizure detector).

    Rhythmicity and power are compared with the initial five minutes, then
    persistence is required. The reference is fixed so prolonged seizures
    cannot become their own background. An initially abnormal reference is
    a known limitation of this illustrative detector.

    The product form matters: a healthy posterior dominant rhythm is genuinely
    rhythmic, so an estimator built on rhythmicity alone flags every awake
    child.  Requiring a concurrent rise in band power is what a bedside trend
    reader actually keys on.  The trend still fires on any sustained rhythmic
    run - including a rhythmic *artifact* such as an ECMO pump or chest
    physiotherapy - which is the teaching point most of these items are built
    around.
    """
    hop = tr.hop_s
    rf = tr.rhy_freqs
    band_r = (rf >= 1.5) & (rf <= 12.0)
    rhy = np.maximum(tr.rhy["left"][band_r].max(axis=0), tr.rhy["right"][band_r].max(axis=0))

    band_p = (tr.freqs >= 1.5) & (tr.freqs <= 12.0)
    pw = np.maximum(tr.psd["left"][band_p].sum(axis=0), tr.psd["right"][band_p].sum(axis=0))

    baseline = tr.t < min(300.0, float(tr.t[-1]))
    rhy_base = float(np.median(rhy[baseline]))
    pw_base = float(np.median(pw[baseline]))
    rhy_new = np.clip((rhy - max(rhy_base, 0.10) - 0.08) / 0.50, 0.0, 1.0)
    ratio = np.log2((pw + 1e-9) / (pw_base + 1e-9))
    rise = np.clip((ratio - 1.0) / 2.0, 0.0, 1.0)   # credit from ~2x, full at ~8x

    slow_r = (rf >= 1.0) & (rf <= 4.0)
    slow_p = (tr.freqs >= 1.0) & (tr.freqs <= 4.0)
    slow_rhy = np.maximum(tr.rhy["left"][slow_r].max(axis=0), tr.rhy["right"][slow_r].max(axis=0))
    slow_power = np.maximum(tr.psd["left"][slow_p].sum(axis=0), tr.psd["right"][slow_p].sum(axis=0))
    slow_power *= float(tr.freqs[1] - tr.freqs[0])
    # Strong sustained slow rhythmic activity remains a screening candidate
    # even when present at recording onset; rhythmic artifact can trigger it.
    stationary = np.clip((slow_rhy - 0.45) / 0.35, 0.0, 1.0)
    stationary *= np.clip(np.log2((slow_power + 1e-9) / 12.5) / 4.0, 0.0, 1.0)
    raw = np.maximum(rhy_new * np.power(rise, 0.6), stationary)
    raw = ndimage.uniform_filter1d(raw, size=max(1, int(round(8.0 / hop))))
    raw = ndimage.minimum_filter1d(raw, size=max(1, int(round(10.0 / hop))))
    p = 1.0 / (1.0 + np.exp(-(raw - 0.28) / 0.055))
    return np.clip(ndimage.uniform_filter1d(p, size=max(1, int(round(6.0 / hop)))), 0.0, 1.0)


# --------------------------------------------------------------------------
# aEEG for the standalone `aeeg` kind (single/dual derivation)
# --------------------------------------------------------------------------

def aeeg_margins(
    synth: Synthesizer,
    duration_s: float,
    derivation: Tuple[str, str],
    bin_s: float = 20.0,
    progress: Optional[Callable[[float], None]] = None,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(t, lower, upper) aEEG margins for one derivation, in seconds and uV."""
    fs = synth.fs
    taps = aeeg_filter(fs)
    n_bins = max(2, int(np.floor(duration_s / bin_s)))
    t = (np.arange(n_bins) + 0.5) * bin_s
    lo = np.zeros(n_bins)
    hi = np.zeros(n_bins)
    n_blocks = int(np.ceil(duration_s / BLOCK_S))
    a, b = derivation
    for k in range(n_blocks):
        t0 = k * BLOCK_S
        t1 = min(duration_s, t0 + BLOCK_S)
        c0 = int(np.searchsorted(t, t0))
        c1 = int(np.searchsorted(t, t1))
        if c1 <= c0:
            continue
        _, x = synth.segment(t0 - MARGIN_S, t1 + MARGIN_S)
        sig = synth.derive(x, [(a, b)])[0]
        filt = apply_fir(sig, taps)
        pp = _pp_envelope(filt, fs, AEEG_PP_WIN_S)
        off = int(round(MARGIN_S * fs))
        for c in range(c0, c1):
            s = off + int(round((t[c] - bin_s / 2 - t0) * fs))
            e = s + int(round(bin_s * fs))
            chunk = pp[max(s, 0):min(e, pp.size)]
            if chunk.size == 0:
                continue
            lo[c] = float(np.percentile(chunk, 5))
            hi[c] = float(np.percentile(chunk, 95))
        if progress:
            progress((k + 1) / n_blocks)
    return t, lo, hi


def pick_aeeg_derivation(synth: Synthesizer, wanted: Sequence[str], side: str) -> Tuple[str, str]:
    """Resolve an aEEG derivation string like ``C3-P3`` against the array."""
    for item in wanted:
        if "-" not in item:
            continue
        a, b = item.split("-", 1)
        if a in synth._idx and b in synth._idx:
            if side == "any" or (mt.side_of(a) == side or mt.side_of(b) == side):
                return a, b
    if wanted:
        raise ValueError(f"Requested aEEG derivation unavailable: {', '.join(wanted)}")
    chains = mt.trend_chains(synth.scalp)
    prefs = {
        "left": [("C3", "P3"), ("C3", "O1"), ("T3", "C3")],
        "right": [("C4", "P4"), ("C4", "O2"), ("C4", "T4")],
        "any": [("C3", "P3"), ("C3", "O1"), ("P3", "P4")],
    }[side if side in ("left", "right") else "any"]
    for a, b in prefs:
        if a in synth._idx and b in synth._idx:
            return a, b
    pool = chains["left"] + chains["right"]
    return pool[0]
