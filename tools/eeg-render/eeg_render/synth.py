"""Multichannel EEG synthesis with random access and bit-exact determinism.

The renderer never draws a trend.  It synthesizes referential scalp potentials
for every electrode of the requested array, then runs the *same* trend maths a
review station runs.  Two properties make that affordable for a 12-hour panel:

* **Streaming** - the trend pipeline pulls 5-minute blocks; nothing holds the
  whole recording.
* **Random access** - :meth:`Synthesizer.segment` regenerates any window in
  isolation and bit-identically, because the stochastic background is built by
  overlap-add of independently keyed frames (sqrt-Hann windows at 50 % overlap,
  whose squares sum to one, so variance and spectrum are preserved across the
  joins).  That is also what lets ``eeg_page`` re-extract 15 s out of hour 2
  without synthesizing hours 0-2.

Units are microvolts throughout.  Time is seconds from recording start.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
from scipy import ndimage, signal as sps

from . import montage as mt
from .rng import substream

FRAME_S = 32.0          # overlap-add frame length
_SMOOTH_EPS = 1e-12


def _periodic_norm() -> tuple:
    """Mean/RMS of the periodic-discharge template (computed once)."""
    x = np.linspace(0.0, 1.0, 4096, endpoint=False)
    w = (np.exp(-0.5 * ((x - 0.16) / 0.033) ** 2)
         - 0.55 * np.exp(-0.5 * ((x - 0.24) / 0.045) ** 2)
         + 0.42 * np.exp(-0.5 * ((x - 0.46) / 0.13) ** 2))
    m = float(w.mean())
    return m, float(np.sqrt(np.mean((w - m) ** 2)))


_PERIODIC_MEAN, _PERIODIC_RMS = _periodic_norm()


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------

def smoothstep(x: np.ndarray | float) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def _piecewise(times: Sequence[float], values: Sequence[float], t: np.ndarray) -> np.ndarray:
    """Linear interpolation with flat extrapolation (a control timeline)."""
    if not times:
        return np.zeros_like(t)
    return np.interp(t, np.asarray(times, float), np.asarray(values, float))


def _lognorm(rng: np.random.Generator, n: int, sigma: float) -> np.ndarray:
    return np.exp(rng.standard_normal(n) * sigma)


# --------------------------------------------------------------------------
# spectral shapes
# --------------------------------------------------------------------------

def bg_shape(freqs: np.ndarray, alpha: float) -> np.ndarray:
    """1/f^alpha amplitude spectrum with a physiologic head/skull roll-off."""
    f = np.clip(freqs, 0.15, None)
    amp = f ** (-alpha / 2.0)
    amp *= 1.0 / (1.0 + (f / 30.0) ** 2)            # cortical/skull low-pass
    amp *= f ** 2 / (f ** 2 + 0.4 ** 2)             # amplifier high-pass
    amp[freqs <= 0] = 0.0
    return amp


def band_shape(freqs: np.ndarray, f0: float, bw: float, order: float = 2.0) -> np.ndarray:
    """Narrowband amplitude spectrum (super-Gaussian) centred on ``f0``."""
    amp = np.exp(-0.5 * np.abs((freqs - f0) / max(bw, 0.05)) ** (2 * order))
    amp[freqs <= 0] = 0.0
    return amp


def hp_lp_shape(freqs: np.ndarray, lo: float, hi: float) -> np.ndarray:
    f = np.clip(freqs, 1e-6, None)
    amp = (f ** 2 / (f ** 2 + lo ** 2)) * (1.0 / (1.0 + (f / hi) ** 4))
    amp[freqs <= 0] = 0.0
    return amp


# --------------------------------------------------------------------------
# stream definition
# --------------------------------------------------------------------------

@dataclass
class _Stream:
    """One spectrally shaped noise source with a spatial profile."""

    name: str
    shape: np.ndarray            # amplitude spectrum over rfft bins of a frame
    norm: float                  # multiplier that brings the OA output to unit RMS
    spatial: np.ndarray          # (n_elec,) weights
    common: float = 0.0          # fraction of variance shared across electrodes


@dataclass
class SeizureInstance:
    t0: float
    duration_s: float
    onset_region: str
    start_hz: float
    end_hz: float
    amp_start: float
    amp_end: float
    spread: str
    postictal_s: float
    index: int          # index into spec["events"]
    ordinal: int = 0    # position within a cluster
    kind: str = "seizure"
    #: waveform family: ``ictal`` (sharply contoured evolving run),
    #: ``rda`` (monomorphic rhythmic delta), ``periodic`` (LPD/GPD - a sharp
    #: transient with an after-going slow wave, repeating at a fixed rate)
    morph: str = "ictal"
    fluctuate: float = 0.22
    plus_fast: float = 0.0

    @property
    def t1(self) -> float:
        return self.t0 + self.duration_s


# spatial profile presets ---------------------------------------------------

def _profile(channels: Sequence[str], weights: Dict[str, float], default: float) -> np.ndarray:
    return np.array([weights.get(ch, default) for ch in channels], float)


_POSTERIOR = {
    "O1": 1.00, "O2": 1.00, "P3": 0.82, "P4": 0.82, "Pz": 0.78,
    "T5": 0.80, "T6": 0.80, "T3": 0.45, "T4": 0.45,
    "C3": 0.35, "C4": 0.35, "Cz": 0.32,
    "F3": 0.14, "F4": 0.14, "Fz": 0.13, "F7": 0.14, "F8": 0.14,
    "Fp1": 0.08, "Fp2": 0.08,
}
_ANTERIOR = {
    "Fp1": 0.95, "Fp2": 0.95, "F3": 1.00, "F4": 1.00, "Fz": 1.00,
    "F7": 0.85, "F8": 0.85, "C3": 0.75, "C4": 0.75, "Cz": 0.80,
    "T3": 0.50, "T4": 0.50, "P3": 0.35, "P4": 0.35, "Pz": 0.35,
    "T5": 0.28, "T6": 0.28, "O1": 0.20, "O2": 0.20,
}
_CENTRAL = {
    "C3": 1.00, "C4": 1.00, "Cz": 1.00, "P3": 0.55, "P4": 0.55, "Pz": 0.60,
    "F3": 0.55, "F4": 0.55, "Fz": 0.60, "T3": 0.35, "T4": 0.35,
    "Fp1": 0.15, "Fp2": 0.15, "F7": 0.20, "F8": 0.20,
    "T5": 0.22, "T6": 0.22, "O1": 0.18, "O2": 0.18,
}
_TEMPORAL = {
    "T3": 1.00, "T4": 1.00, "T5": 0.85, "T6": 0.85, "F7": 0.90, "F8": 0.90,
    "C3": 0.35, "C4": 0.35, "P3": 0.30, "P4": 0.30,
    "Fp1": 0.30, "Fp2": 0.30, "F3": 0.25, "F4": 0.25,
    "O1": 0.20, "O2": 0.20, "Cz": 0.10, "Fz": 0.12, "Pz": 0.10,
}
_BROAD = {"Fp1": 0.85, "Fp2": 0.85, "Fz": 0.92, "Cz": 0.92, "Pz": 0.92}


# --------------------------------------------------------------------------
# the synthesizer
# --------------------------------------------------------------------------

class Synthesizer:
    """Build referential scalp potentials for one normalized spec."""

    def __init__(self, spec: Dict, duration_s: float):
        self.spec = spec
        self.seed = int(spec["seed"])
        self.fs = int(spec["sample_rate"])
        self.duration_s = float(duration_s)
        self.age = spec["age_group"]

        self.scalp: List[str] = mt.channel_set(spec["channels"])
        self.electrodes: List[str] = self.scalp + mt.REFERENCE_ELECTRODES
        self.n_elec = len(self.electrodes)
        self._idx = {ch: i for i, ch in enumerate(self.electrodes)}

        self.frame_n = int(round(FRAME_S * self.fs))
        if self.frame_n % 2:
            self.frame_n += 1
        self.hop_n = self.frame_n // 2
        self._win = np.sqrt(sps.get_window("hann", self.frame_n, fftbins=True))
        self._freqs = np.fft.rfftfreq(self.frame_n, 1.0 / self.fs)
        self._norm_cache: Dict[bytes, float] = {}

        bg = spec["background"]
        self.bg = bg
        # amplitude_uv is the peak-to-peak amplitude a reader would measure on
        # the *display* montage; a bipolar derivation of partially correlated
        # electrodes runs ~6x its RMS peak-to-peak.
        self.amp_rms = float(bg["amplitude_uv"]) / 6.4
        # 1/f exponent and delta content are separate knobs: real scalp EEG
        # sits around alpha 1.5-2.5 at every age.  Pushing alpha to 3 to
        # express "slow" leaves almost no 2-15 Hz power, which then makes the
        # aEEG read implausibly low.  slow_fraction drives the delta stream
        # weight (below) and only mildly steepens the spectrum.
        self.alpha = 1.10 + 1.55 * float(bg["slow_fraction"])
        self.slow_fraction = float(bg["slow_fraction"])
        self.dominant_hz = float(bg["dominant_hz"])

        self._build_streams()
        self._build_slow_am()
        self._build_channel_am()
        self._build_control_timelines()
        self._build_burst_schedule()
        self._collect_seizures()
        self.artifacts = [e for e in spec["events"] if e["type"] == "artifact"]
        self.stimulations = [e for e in spec["events"] if e["type"] == "stimulation"]

    # ---------------- streams ----------------

    def _norm_for(self, shape: np.ndarray) -> float:
        keyb = np.round(shape, 7).tobytes()
        hit = self._norm_cache.get(keyb)
        if hit is not None:
            return hit
        ref = np.random.default_rng(20240101)
        acc = []
        for _ in range(3):
            w = ref.standard_normal(self.frame_n)
            x = np.fft.irfft(np.fft.rfft(w) * shape, self.frame_n)
            acc.append(x)
        rms = float(np.std(np.concatenate(acc)))
        val = 1.0 / max(rms, _SMOOTH_EPS)
        self._norm_cache[keyb] = val
        return val

    def _mk(self, name: str, shape: np.ndarray, spatial: np.ndarray, common: float = 0.0) -> _Stream:
        return _Stream(name, shape, self._norm_for(shape), spatial, common)

    def _build_streams(self) -> None:
        ch = self.electrodes
        f = self._freqs
        near_uniform = _profile(ch, _BROAD, 1.0)
        near_uniform[[self._idx[e] for e in mt.REFERENCE_ELECTRODES]] = 0.35

        post = _profile(ch, _POSTERIOR, 0.2)
        ant = _profile(ch, _ANTERIOR, 0.3)
        cen = _profile(ch, _CENTRAL, 0.3)
        temp = _profile(ch, _TEMPORAL, 0.3)
        for arr in (post, ant, cen, temp):
            for e in mt.REFERENCE_ELECTRODES:
                arr[self._idx[e]] = 0.15

        self.st_broad = self._mk("broad", bg_shape(f, self.alpha), near_uniform, common=0.45)
        self.st_delta = self._mk("delta", band_shape(f, 1.6, 1.5, order=1.0), near_uniform, common=0.55)
        self.st_pdr = self._mk("pdr", band_shape(f, self.dominant_hz, 1.45), post, common=0.65)
        self.st_pdr_slow = self._mk(
            "pdrslow",
            band_shape(f, max(0.8, self.dominant_hz - float((self.bg.get("asymmetry") or {}).get("slowing_hz") or 2.0)), 1.1),
            post, common=0.6,
        )
        self.st_beta = self._mk("beta", band_shape(f, 17.5, 4.0, order=1.0), ant, common=0.4)
        spindle_hz = float((self.spec.get("style") or {}).get("spindle_hz", 13.0))
        self.st_spindle = self._mk("spindle", band_shape(f, spindle_hz, 0.65), cen, common=0.7)
        self.st_brush = self._mk("brush", band_shape(f, 13.0, 4.5, order=1.0), cen * 0.6 + temp * 0.5, common=0.35)
        self.st_theta = self._mk("theta", band_shape(f, 5.0, 1.8, order=1.0), temp * 0.6 + cen * 0.5, common=0.5)
        self.st_emg = self._mk("emg", hp_lp_shape(f, 22.0, 95.0), temp, common=0.15)
        self.st_sensor = self._mk(
            "sensor", hp_lp_shape(f, 16.0, min(55.0, self.fs * 0.45)),
            np.ones(self.n_elec), common=0.02,
        )

        # asymmetry / focal slowing gains -----------------------------------
        self.gain_asym = np.ones(self.n_elec)
        self.slow_side = np.zeros(self.n_elec)
        asym = self.bg.get("asymmetry")
        if asym:
            att = float(asym.get("attenuation_pct", 0.0)) / 100.0
            slw = float(asym.get("slowing_hz", 0.0))
            sign = -1.0 if asym["side"] == "left" else 1.0
            for i, e in enumerate(ch):
                x = mt.POSITIONS.get(e, (0.0, 0.0))[0]
                lateral = float(np.clip(sign * x, 0.0, 1.0))
                self.gain_asym[i] = 1.0 - att * lateral
                self.slow_side[i] = lateral * min(1.0, slw / 3.0)

    # ---------------- slow amplitude modulation ----------------

    def _build_slow_am(self, step_s: float = 5.0, sigma_s: float = 32.0,
                       log_sd: float = 0.24) -> None:
        """Log-normal background waxing/waning on a ~30 s time constant.

        Real background amplitude is far from stationary, and that
        non-stationarity is what gives an aEEG its band *width* (upper margin
        well above lower margin).  Built once on a coarse grid so it stays
        coherent over minutes while remaining random-access by interpolation.
        """
        grid = np.arange(-180.0, self.duration_s + 180.0 + step_s, step_s)
        rng = substream(self.seed, "slow_am")
        w = ndimage.gaussian_filter1d(rng.standard_normal(grid.size),
                                      sigma_s / step_s, mode="wrap")
        w /= max(float(w.std()), _SMOOTH_EPS)
        self._am_t = grid
        self._am_v = np.exp(log_sd * w)

    def slow_am(self, t: np.ndarray) -> np.ndarray:
        return np.interp(t, self._am_t, self._am_v)

    def _build_channel_am(self, step_s: float = 5.0, sigma_s: float = 45.0,
                          log_sd: float = 0.10) -> None:
        """Independent electrode gain drift layered under global waxing/waning."""
        grid = np.arange(-180.0, self.duration_s + 180.0 + step_s, step_s)
        rng = substream(self.seed, "channel_am")
        w = ndimage.gaussian_filter1d(
            rng.standard_normal((self.n_elec, grid.size)),
            sigma_s / step_s, axis=1, mode="reflect",
        )
        w -= w.mean(axis=1, keepdims=True)
        w /= np.maximum(w.std(axis=1, keepdims=True), _SMOOTH_EPS)
        self._ch_am_t = grid
        self._ch_am_v = np.exp(log_sd * w)
        self._ch_gain = np.exp(rng.normal(0.0, 0.055, self.n_elec))

    def channel_am(self, t: np.ndarray) -> np.ndarray:
        return np.vstack([
            np.interp(t, self._ch_am_t, row) for row in self._ch_am_v
        ]) * self._ch_gain[:, None]

    # ---------------- control timelines ----------------

    def _build_control_timelines(self) -> None:
        """Slowly varying weights: state, temperature, sedation, attenuation."""
        spec = self.spec
        dur = self.duration_s

        # state --------------------------------------------------------
        st_times: List[float] = [0.0]
        st_sleep: List[float] = [0.0 if self.age != "neonate" else 0.35]
        st_arousal: List[Tuple[float, float]] = []
        for ev in spec["events"]:
            if ev["type"] != "state_change":
                continue
            t = float(ev["at_min"]) * 60.0
            if ev["to"] == "arousal":
                st_arousal.append((t, 30.0))
                continue
            target = 1.0 if ev["to"] == "sleep" else 0.0
            st_times += [max(0.0, t - 30.0), t + 90.0]
            st_sleep += [st_sleep[-1], target]
        order = np.argsort(st_times)
        self._state_t = list(np.asarray(st_times)[order])
        self._state_v = list(np.asarray(st_sleep)[order])
        self._arousals = st_arousal

        # neonatal sleep-wake cycling shows on aEEG as a slow, regular
        # widening/narrowing of the band; maturity sets its depth and period
        cyc = spec.get("sleep_wake_cycling")
        depth, period_h = {
            "mature": (0.55, 3.0), "immature": (0.22, 4.0), "absent": (0.0, 4.0),
        }.get(cyc, (0.0, 4.0))
        self._swc_depth = depth
        self._swc_period_s = period_h * 3600.0
        self._swc_phase = 0.15

        # temperature --------------------------------------------------
        tt: List[float] = [0.0]
        tv: List[float] = [36.5]
        for ev in spec["events"]:
            if ev["type"] != "temperature_change":
                continue
            t0 = float(ev["at_min"]) * 60.0
            over = float(ev["over_min"]) * 60.0
            tt += [t0, t0 + max(over, 1.0)]
            tv += [float(ev["from_c"]), float(ev["to_c"])]
        if len(tt) > 1:
            tt[0] = 0.0
            tv[0] = tv[1]
        self._temp_t, self._temp_v = tt, tv

        # sedation -----------------------------------------------------
        sed_t: List[float] = [0.0]
        bs = self.bg["burst_suppression"]
        sed_sf: List[float] = [float(bs["ibi_s"]) / max(float(bs["ibi_s"]) + float(bs["burst_s"]), 1e-6)]
        sed_beta: List[float] = [0.10 if self.age != "neonate" else 0.05]
        sed_amp: List[float] = [1.0]
        for ev in spec["events"]:
            if ev["type"] != "sedation_change":
                continue
            t0 = float(ev["at_min"]) * 60.0
            ramp = max(float(ev["effect"]["ramp_min"]), 0.5) * 60.0
            tgt_sr = float(ev["effect"]["suppression_ratio_target_pct"]) / 100.0
            inc = ev["direction"] == "increase"
            beta_tgt = (0.42 if inc else 0.06) if ev["effect"].get("beta_boost", True) else sed_beta[-1]
            if ev["agent"] in ("pentobarbital", "propofol") and inc:
                beta_tgt = min(beta_tgt, 0.30)   # deep barbiturate: beta gives way to suppression
            amp_tgt = float(ev["effect"].get("amplitude_pct", 100.0)) / 100.0
            sed_t += [t0, t0 + ramp]
            sed_sf += [sed_sf[-1], tgt_sr]
            sed_beta += [sed_beta[-1], beta_tgt]
            sed_amp += [sed_amp[-1], amp_tgt]
        self._sed_t, self._sed_sf = sed_t, sed_sf
        self._sed_beta, self._sed_amp = sed_beta, sed_amp

        # attenuation transients ---------------------------------------
        self._atten = [
            (float(e["at_min"]) * 60.0, float(e["duration_min"]) * 60.0,
             e["side"], float(e["depth_pct"]) / 100.0)
            for e in spec["events"] if e["type"] == "attenuation_transient"
        ]
        self._dur_guard = dur

    def temperature_at(self, t: np.ndarray) -> np.ndarray:
        return _piecewise(self._temp_t, self._temp_v, t) if len(self._temp_t) > 1 else np.full_like(t, 36.5)

    def _sleep_at(self, t: np.ndarray) -> np.ndarray:
        v = _piecewise(self._state_t, self._state_v, t)
        v = v + self._swc_depth * 0.5 * (
            1.0 - np.cos(2 * np.pi * (t / self._swc_period_s + self._swc_phase)))
        for at, width in self._arousals:
            v = v * (1.0 - 0.9 * np.exp(-0.5 * ((t - at) / width) ** 2))
        return np.clip(v, 0.0, 1.0)

    # ---------------- burst / interburst schedule ----------------

    def suppression_fraction_at(self, t: np.ndarray) -> np.ndarray:
        """Target fraction of time spent in the interburst state."""
        bs = self.bg["burst_suppression"]
        base = float(bs["ibi_s"]) / max(float(bs["ibi_s"]) + float(bs["burst_s"]), 1e-6)
        sed = _piecewise(self._sed_t, self._sed_sf, t) if len(self._sed_t) > 1 else np.zeros_like(t)
        temp = self.temperature_at(t)
        cold = 0.22 * np.clip((35.0 - temp) / 2.5, 0.0, 1.6)
        sleep = 0.05 * self._sleep_at(t) if self.age == "neonate" else 0.0
        out = (sed if len(self._sed_t) > 1 else base) + cold + sleep
        return np.clip(out, 0.0, 0.96)

    def _build_burst_schedule(self) -> None:
        bs = self.bg["burst_suppression"]
        cycle0 = max(float(bs["ibi_s"]) + float(bs["burst_s"]), 2.0)
        floor0 = float(bs["ibi_floor"])
        rng = substream(self.seed, "bursts")
        starts: List[float] = []
        ends: List[float] = []
        t = -60.0
        horizon = self.duration_s + 120.0
        # a deep-sedation interburst is genuinely flat; a preterm interburst is not
        while t < horizon:
            sf = float(self.suppression_fraction_at(np.array([max(t, 0.0)]))[0])
            cyc = cycle0 * (1.0 + 1.35 * max(0.0, sf - 0.3))
            if sf < 0.03:
                starts.append(t)
                ends.append(t + 300.0)
                t += 300.0
                continue
            burst = max(0.25, cyc * (1.0 - sf) * float(_lognorm(rng, 1, 0.22)[0]))
            ibi = max(0.25, cyc * sf * float(_lognorm(rng, 1, 0.26)[0]))
            starts.append(t)
            ends.append(t + burst)
            t += burst + ibi
        self._burst_start = np.asarray(starts)
        self._burst_end = np.asarray(ends)
        self._ibi_floor0 = floor0

    def _ibi_floor_at(self, t: np.ndarray) -> np.ndarray:
        """Interburst residual amplitude; sedation drives it toward true flat."""
        sed = _piecewise(self._sed_t, self._sed_sf, t) if len(self._sed_t) > 1 else np.zeros_like(t)
        deep = np.clip(sed / 0.25, 0.0, 1.0)
        floor = self._ibi_floor0 * (1.0 - deep) + 0.005 * deep
        points = self.bg.get("ibi_floor_at_h")
        if points:
            floor = np.interp(t / 3600.0, [p[0] for p in points], [p[1] for p in points])
        return floor

    def burst_envelope(self, t: np.ndarray) -> np.ndarray:
        """Smoothed 0..1 burst indicator lifted by the interburst floor."""
        idx = np.searchsorted(self._burst_start, t, side="right") - 1
        idx = np.clip(idx, 0, len(self._burst_start) - 1)
        inside = (t >= self._burst_start[idx]) & (t < self._burst_end[idx])
        env = inside.astype(float)
        k = max(3, int(round(0.22 * self.fs)) | 1)
        win = np.hanning(k)
        win /= win.sum()
        env = np.convolve(np.pad(env, k, mode="edge"), win, mode="same")[k:-k]
        floor = self._ibi_floor_at(t)
        return floor + (1.0 - floor) * env

    # ---------------- seizures ----------------

    def _collect_seizures(self) -> None:
        out: List[SeizureInstance] = []
        for i, ev in enumerate(self.spec["events"]):
            if ev["type"] == "seizure":
                evo = ev["evolution"]
                out.append(SeizureInstance(
                    t0=float(ev["onset_min"]) * 60.0,
                    duration_s=float(ev["duration_s"]),
                    onset_region=ev["onset_region"],
                    start_hz=float(evo["start_hz"]), end_hz=float(evo["end_hz"]),
                    amp_start=float(evo["amplitude_start_uv"]),
                    amp_end=float(evo["amplitude_end_uv"]),
                    spread=ev["spread"], postictal_s=float(ev["postictal_attenuation_s"]),
                    index=i,
                ))
            elif ev["type"] == "seizure_cluster":
                z = ev["seizure"]
                evo = z["evolution"]
                t = float(ev["start_min"]) * 60.0
                end = float(ev["end_min"]) * 60.0
                step = max(float(ev["interval_min"]) * 60.0, 10.0)
                jit = substream(self.seed, "cluster", i)
                k = 0
                while t <= end + 1e-6:
                    out.append(SeizureInstance(
                        t0=t + float(jit.normal(0.0, step * 0.03)),
                        duration_s=float(z["duration_s"]) * float(_lognorm(jit, 1, 0.10)[0]),
                        onset_region=z["onset_region"],
                        start_hz=float(evo["start_hz"]), end_hz=float(evo["end_hz"]),
                        amp_start=float(evo["amplitude_start_uv"]),
                        amp_end=float(evo["amplitude_end_uv"]),
                        spread=z["spread"], postictal_s=float(z["postictal_attenuation_s"]),
                        index=i, ordinal=k, kind="seizure_cluster",
                    ))
                    t += step
                    k += 1
            elif ev["type"] == "status_epilepticus":
                evo = ev["evolution"]
                out.append(SeizureInstance(
                    t0=float(ev["onset_min"]) * 60.0,
                    duration_s=float(ev["duration_min"]) * 60.0,
                    onset_region=ev["onset_region"],
                    start_hz=float(evo["start_hz"]), end_hz=float(evo["end_hz"]),
                    amp_start=float(evo["amplitude_start_uv"]),
                    amp_end=float(evo["amplitude_end_uv"]),
                    spread=ev.get("spread", "generalized"),
                    postictal_s=float(ev.get("postictal_attenuation_s", 0.0)),
                    index=i, kind="status_epilepticus",
                ))
            elif ev["type"] == "rhythmic_pattern":
                out.extend(self._rpp_instances(ev, i))
        out.sort(key=lambda z: z.t0)
        self.seizures = out
        self.ictal = [z for z in out if z.kind != "rhythmic_pattern"]
        self.rhythmic_patterns = [z for z in out if z.kind == "rhythmic_pattern"]

    def _rpp_instances(self, ev: Dict, i: int) -> List[SeizureInstance]:
        """Intermittent runs of an ACNS rhythmic / periodic pattern.

        Deliberately *not* an evolving discharge: fixed frequency, fixed
        amplitude, no post-event attenuation.  Runs are separated by gaps so
        the pattern is intermittent the way LRDA and LPDs actually are.
        """
        rng = substream(self.seed, "rpp", i)
        f0 = float(ev["frequency_hz"])
        amp = float(ev["amplitude_uv"])
        run = max(float(ev["run_duration_s"]), 4.0)
        modifier = str(ev.get("modifier") or "").lower()
        plus = str(ev.get("plus_modifier") or "").lower()
        morph = "periodic" if ev.get("periodic") else "rda"
        plus_fast = 0.30 if ("+f" in plus or "fast" in plus) else 0.0
        fluct = 0.45 if "fluctuat" in modifier else 0.15
        duty_gap = 0.55 if "intermittent" in modifier else 0.30

        t = float(ev["onset_min"]) * 60.0
        end = t + float(ev["duration_min"]) * 60.0
        out: List[SeizureInstance] = []
        k = 0
        while t < end - 1.0 and k < 4000:
            dur = min(run * float(_lognorm(rng, 1, 0.18)[0]), end - t)
            out.append(SeizureInstance(
                t0=t, duration_s=dur, onset_region=ev["onset_region"],
                start_hz=f0, end_hz=f0, amp_start=amp, amp_end=amp,
                spread="none", postictal_s=0.0, index=i, ordinal=k,
                kind="rhythmic_pattern", morph=morph, fluctuate=fluct,
                plus_fast=plus_fast,
            ))
            t += dur + max(run * duty_gap * float(_lognorm(rng, 1, 0.3)[0]), 3.0)
            k += 1
        return out

    def _spread_region(self, inst: SeizureInstance) -> Optional[str]:
        if inst.spread in (None, "none"):
            return None
        if inst.spread == "generalized":
            return "generalized"
        if inst.spread == "contralateral":
            return mt.CONTRALATERAL.get(inst.onset_region)
        hemi = mt.HEMISPHERE_OF_REGION.get(inst.onset_region, "both")
        return f"{hemi}_hemisphere" if hemi in ("left", "right") else "generalized"

    def _gen_weights(self, focus: str) -> np.ndarray:
        cached = getattr(self, "_gw_cache", None)
        if cached is None:
            cached = {}
            self._gw_cache = cached
        if focus not in cached:
            w = mt.monopole_weights(focus, self.electrodes)
            cached[focus] = np.array([w[c] for c in self.electrodes])
        return cached[focus]

    def _seizure_block(self, t: np.ndarray) -> np.ndarray:
        """Sum of every ictal run overlapping ``t``; shape (n_elec, len(t))."""
        out = np.zeros((self.n_elec, t.size))
        if not self.seizures:
            return out
        for inst in self.seizures:
            if inst.t1 < t[0] - 1.0 or inst.t0 > t[-1] + 1.0:
                continue
            phase, u, amp = self._ictal_phase(inst, t)
            if phase is None:
                continue
            psi = substream(self.seed, "szharm", inst.index).uniform(0, 2 * np.pi, 4)
            spread = self._spread_region(inst)
            if spread is None:
                s = np.zeros_like(u)
                phase_d = None
            else:
                onset_frac = {"hemispheric": 0.22, "generalized": 0.30,
                              "contralateral": 0.42}.get(inst.spread, 0.3)
                s = smoothstep((u - onset_frac) / 0.30)
                phase_d, _, _ = self._ictal_phase(inst, t - 0.18)

            for focus, ga, gph in mt.region_generators(inst.onset_region, self.electrodes):
                w = self._gen_weights(focus)
                wv = (self._wave(phase, psi, gph, inst.morph, inst.plus_fast)
                      * amp * ga * (1.0 - 0.55 * s))
                out += w[:, None] * wv[None, :]
            if spread is not None and phase_d is not None:
                for focus, ga, gph in mt.region_generators(spread, self.electrodes):
                    w = self._gen_weights(focus)
                    wv = (self._wave(phase_d, psi, gph, inst.morph, inst.plus_fast)
                          * amp * ga * s)
                    out += w[:, None] * wv[None, :]
        return out

    @staticmethod
    def _wave(phase: np.ndarray, psi: np.ndarray, offset_cycles: float,
              morph: str = "ictal", plus_fast: float = 0.0) -> np.ndarray:
        """Waveform for one generator, from its instantaneous phase.

        ``ictal``    four harmonics at 1/k^1.3 - the spiky, non-sinusoidal
                     contour of an evolving ictal run.
        ``rda``      near-monomorphic (harmonics heavily suppressed), which is
                     what makes rhythmic delta activity look *bland* next to a
                     seizure of the same frequency.
        ``periodic`` a narrow sharp transient plus an after-going slow wave,
                     repeating once per cycle - LPDs / GPDs.

        Every family is normalized to unit RMS so ``amplitude_uv`` in the spec
        means the same thing across them.
        """
        p = phase + 2 * np.pi * offset_cycles
        if morph == "periodic":
            x = np.mod(p / (2 * np.pi), 1.0)
            wave = (np.exp(-0.5 * ((x - 0.16) / 0.033) ** 2)
                    - 0.55 * np.exp(-0.5 * ((x - 0.24) / 0.045) ** 2)
                    + 0.42 * np.exp(-0.5 * ((x - 0.46) / 0.13) ** 2))
            wave = (wave - _PERIODIC_MEAN) / _PERIODIC_RMS
        else:
            expo = 1.30 if morph == "ictal" else 2.60
            coeff = np.array([1.0 / k ** expo for k in range(1, 5)])
            wave = np.zeros_like(p)
            for k in range(1, 5):
                wave += coeff[k - 1] * np.sin(k * p + psi[k - 1])
            wave /= math.sqrt(0.5 * float(np.sum(coeff ** 2)))
            if morph == "ictal":
                wave += 0.22 * np.sin(6.0 * p + psi[0]) * (0.6 + 0.4 * np.sin(0.7 * p))
                wave /= 1.012
        if plus_fast > 0:
            wave = wave + plus_fast * np.sin(9.0 * p + psi[1]) * (0.5 + 0.5 * np.sin(p))
        return wave

    def _ictal_phase(self, inst: SeizureInstance, t: np.ndarray):
        """Instantaneous phase / progress / amplitude of a log-sweeping run."""
        dur = max(inst.duration_s, 1.0)
        u = (t - inst.t0) / dur
        live = (u >= 0.0) & (u <= 1.0)
        if not live.any():
            return None, u, None
        uu = np.clip(u, 0.0, 1.0)
        r = max(inst.end_hz, 0.2) / max(inst.start_hz, 0.2)
        f0 = max(inst.start_hz, 0.2)
        if abs(r - 1.0) < 1e-6:
            phase = 2 * np.pi * f0 * (uu * dur)
        else:
            lnr = math.log(r)
            phase = 2 * np.pi * f0 * dur * (np.power(r, uu) - 1.0) / lnr
        # Slow phase wander so the run is rhythmic but not a pure tone.  This
        # is *additive* on purpose: perturbing the accumulated phase
        # multiplicatively scales with elapsed cycles and smears the ictal
        # spectral peak into a broad hump, destroying the rhythmicity the
        # panels are supposed to show.
        jr = substream(self.seed, "szjit", inst.index, inst.ordinal)
        nj = 6
        wax_phase = float(jr.uniform(0, 2 * np.pi))
        wander = np.zeros_like(uu)
        for a, fq, p in zip(jr.uniform(0.10, 0.32, nj),
                            jr.uniform(0.03, 0.30, nj),
                            jr.uniform(0, 2 * np.pi, nj)):
            wander += a * np.sin(2 * np.pi * fq * (uu * dur) + p)
        phase = phase + wander

        # amplitude_*_uv is the peak-to-peak of the ictal run; a rhythmic,
        # sharply contoured discharge runs ~2.9x its RMS peak-to-peak.
        amp = (inst.amp_start + (inst.amp_end - inst.amp_start) * uu) / 2.9
        ramp = 0.07 if inst.kind != "rhythmic_pattern" else 0.14
        amp = amp * smoothstep(uu / ramp) * (1.0 - smoothstep((uu - (1.0 - ramp)) / ramp))
        # cycle-group waxing and waning
        amp = amp * (1.0 + inst.fluctuate * np.sin(2 * np.pi * 0.11 * uu * dur + wax_phase))
        amp = amp * live
        return phase, uu, amp

    def postictal_envelope(self, t: np.ndarray) -> np.ndarray:
        env = np.ones_like(t)
        for inst in self.seizures:
            if inst.postictal_s <= 0:
                continue
            d = t - inst.t1
            m = (d >= 0) & (d < inst.postictal_s * 3)
            if not m.any():
                continue
            depth = 0.62
            env = np.where(
                m, env * (1.0 - depth * np.exp(-d / max(inst.postictal_s / 1.6, 1.0))), env
            )
        return np.clip(env, 0.05, 1.0)

    # ---------------- overlap-add noise ----------------

    def _oa(self, stream: _Stream, i0: int, n: int, n_rows: int) -> np.ndarray:
        """Overlap-add ``n_rows`` independent realizations of ``stream``."""
        out = np.zeros((n_rows, n))
        j0 = i0 // self.hop_n - 1
        j1 = (i0 + n) // self.hop_n + 1
        for j in range(j0, j1 + 1):
            start = j * self.hop_n
            lo = max(start, i0)
            hi = min(start + self.frame_n, i0 + n)
            if hi <= lo:
                continue
            rng = substream(self.seed, stream.name, j)
            w = rng.standard_normal((n_rows, self.frame_n))
            x = np.fft.irfft(np.fft.rfft(w, axis=1) * stream.shape[None, :],
                             self.frame_n, axis=1)
            x *= self._win[None, :] * stream.norm
            out[:, lo - i0:hi - i0] += x[:, lo - start:hi - start]
        return out

    def _stream_signal(self, stream: _Stream, i0: int, n: int) -> np.ndarray:
        """(n_elec, n) with a shared/common component for spatial correlation.

        The shared row is generated in the *same* overlap-add pass as the
        per-electrode rows (one extra row) rather than a second pass, which
        halves the FFT count for the whole background mixture.
        """
        rows = self._oa(stream, i0, n, self.n_elec + 1)
        if stream.common <= 0:
            return rows[: self.n_elec] * stream.spatial[:, None]
        c = stream.common
        mixed = (math.sqrt(1.0 - c) * rows[: self.n_elec]
                 + math.sqrt(c) * rows[self.n_elec][None, :])
        return mixed * stream.spatial[:, None]

    # ---------------- artifacts ----------------

    def _artifact_channels(self, ev: Dict) -> np.ndarray:
        w = np.zeros(self.n_elec)
        if ev.get("channels"):
            for ch in ev["channels"]:
                if ch in self._idx:
                    w[self._idx[ch]] = 1.0
            # neighbours pick up a fraction
            for ch in ev["channels"]:
                if ch not in mt.POSITIONS:
                    continue
                cx, cy = mt.POSITIONS[ch]
                for i, e in enumerate(self.electrodes):
                    if w[i] >= 1.0 or e not in mt.POSITIONS:
                        continue
                    ex, ey = mt.POSITIONS[e]
                    d = math.hypot(cx - ex, cy - ey)
                    w[i] = max(w[i], 0.55 * math.exp(-(d / 0.55) ** 2))
            return w
        side = ev.get("side", "all")
        for i, e in enumerate(self.electrodes):
            x = mt.POSITIONS.get(e, (0.0, 0.0))[0]
            if side in ("all", "both"):
                w[i] = 1.0
            elif side == "left":
                w[i] = float(np.clip(-x + 0.15, 0.0, 1.0))
            elif side == "right":
                w[i] = float(np.clip(x + 0.15, 0.0, 1.0))
        return w

    _INTENSITY = {"low": 0.45, "medium": 1.0, "high": 2.1}

    def _artifact_block(self, t: np.ndarray, i0: int) -> np.ndarray:
        out = np.zeros((self.n_elec, t.size))
        n = t.size
        for k, ev in enumerate(self.artifacts):
            a0 = float(ev["at_min"]) * 60.0
            a1 = a0 + float(ev["duration_s"])
            if a1 < t[0] or a0 > t[-1]:
                continue
            live = ((t >= a0) & (t <= a1)).astype(float)
            # 1 s raised-cosine edges
            k_ed = max(3, int(0.8 * self.fs) | 1)
            win = np.hanning(k_ed)
            win /= win.sum()
            live = np.convolve(np.pad(live, k_ed, mode="edge"), win, mode="same")[k_ed:-k_ed]
            gain = self._INTENSITY[ev["intensity"]]
            rng = substream(self.seed, "art", k, i0 // self.hop_n)
            w = self._artifact_channels(ev)
            kind = ev["kind"]
            sig = self._artifact_waveform(kind, ev, t, i0, rng, gain)
            if sig is None:
                continue
            if sig.ndim == 1:
                jitter = 0.85 + 0.3 * substream(self.seed, "artg", k).random(self.n_elec)
                out += (w * jitter)[:, None] * (sig * live)[None, :]
            else:
                out += sig * (w * (0.85 + 0.3 * substream(self.seed, "artg", k).random(self.n_elec)))[:, None] * live[None, :]
        return out

    def _artifact_waveform(self, kind: str, ev: Dict, t: np.ndarray, i0: int,
                           rng: np.random.Generator, gain: float):
        n = t.size
        fs = self.fs

        if kind == "emg_chewing":
            base = self._oa(self.st_emg, i0, n, 1)[0]
            chew = 0.5 + 0.5 * sps.square(2 * np.pi * 1.9 * t, duty=0.42)
            chew = np.convolve(np.pad(chew, 50, mode="edge"),
                               np.hanning(31) / np.hanning(31).sum(), mode="same")[50:-50]
            return base * chew * 26.0 * gain

        if kind in ("patting", "chest_pt"):
            f0 = float(ev.get("frequency_hz", 1.9 if kind == "patting" else 2.9))
            ph = 2 * np.pi * f0 * t
            w = (np.sin(ph) + 0.45 * np.sin(2 * ph + 0.4) + 0.2 * np.sin(3 * ph + 1.1))
            amp = 34.0 if kind == "patting" else 55.0
            sig = w * amp * gain
            if kind == "chest_pt":
                sig = sig + self._oa(self.st_emg, i0 + 991, n, 1)[0] * 9.0 * gain
            return sig

        if kind == "ventilator":
            f0 = 0.35
            ph = 2 * np.pi * f0 * t
            w = np.sin(ph) + 0.30 * np.sin(2 * ph + 1.6) + 0.12 * np.sin(4 * ph)
            return w * 30.0 * gain

        if kind == "ecmo_pump":
            f0 = 1.45
            ph = 2 * np.pi * f0 * t
            w = np.sin(ph) + 0.18 * np.sin(2 * ph + 0.9) + 0.06 * np.sin(3 * ph)
            rows = np.zeros((self.n_elec, n))
            lag = substream(self.seed, "ecmolag").uniform(-0.03, 0.03, self.n_elec)
            for i in range(self.n_elec):
                phi = 2 * np.pi * f0 * (t - lag[i])
                rows[i] = (np.sin(phi) + 0.18 * np.sin(2 * phi + 0.9)) * 40.0 * gain
            return rows

        if kind == "electrode_pop":
            target = (ev.get("channels") or ["T5"])[0]
            rows = np.zeros((self.n_elec, n))
            rate = 0.8
            k = max(1, int(rate * (t[-1] - t[0])))
            times = rng.uniform(t[0], t[-1], k)
            amps = rng.uniform(120.0, 420.0, k) * rng.choice([-1.0, 1.0], k) * gain
            tau = 0.09
            prof = np.zeros(n)
            for tt, aa in zip(times, amps):
                d = t - tt
                m = (d >= 0) & (d < 8 * tau)
                prof[m] += aa * np.exp(-d[m] / tau)
            i = self._idx.get(target, 0)
            rows[i] = prof
            for j, e in enumerate(self.electrodes):
                if j != i and e in mt.POSITIONS and target in mt.POSITIONS:
                    d = math.hypot(*(np.subtract(mt.POSITIONS[e], mt.POSITIONS[target])))
                    rows[j] = prof * 0.12 * math.exp(-(d / 0.4) ** 2)
            return rows

        if kind == "sixty_hz":
            f0 = 60.0
            if f0 > 0.45 * fs:
                f0 = 50.0
            return (np.sin(2 * np.pi * f0 * t) + 0.25 * np.sin(2 * np.pi * 2 * f0 * t)) * 18.0 * gain

        if kind == "ecg":
            return self._ecg(t, amplitude=22.0 * gain)

        if kind == "movement":
            slow = self._oa(self.st_delta, i0 + 7717, n, 1)[0] * 95.0 * gain
            emg = self._oa(self.st_emg, i0 + 313, n, 1)[0] * 22.0 * gain
            burst = 0.5 + 0.5 * np.sin(2 * np.pi * 0.28 * t + 1.0)
            return (slow + emg) * burst

        if kind == "sweat":
            sh = band_shape(self._freqs, 0.16, 0.16, order=1.0)
            st = _Stream("sweat", sh, self._norm_for(sh), self.st_broad.spatial, 0.8)
            return self._oa(st, i0, n, 1)[0] * 130.0 * gain

        if kind == "eye_blink":
            rows = np.zeros((self.n_elec, n))
            rate = 0.30
            k = max(1, int(rate * (t[-1] - t[0])))
            times = np.sort(rng.uniform(t[0], t[-1], k))
            prof = np.zeros(n)
            for tt in times:
                d = t - tt
                m = (d > -0.05) & (d < 0.45)
                prof[m] += np.exp(-0.5 * ((d[m] - 0.14) / 0.075) ** 2)
            prof *= 95.0 * gain
            wmap = {"Fp1": 1.0, "Fp2": 1.0, "F7": 0.45, "F8": 0.45,
                    "F3": 0.5, "F4": 0.5, "Fz": 0.45, "T3": 0.15, "T4": 0.15}
            for i, e in enumerate(self.electrodes):
                rows[i] = prof * wmap.get(e, 0.04)
            return rows

        return None

    def _ecg(self, t: np.ndarray, amplitude: float) -> np.ndarray:
        """Synthetic QRS train, opposite polarity over the two hemispheres."""
        hr = {"neonate": 145.0, "infant": 130.0, "child": 100.0, "adolescent": 80.0}[self.age]
        rr = 60.0 / hr
        jr = substream(self.seed, "ecg")
        beats = np.arange(math.floor(t[0] / rr) - 1, math.ceil(t[-1] / rr) + 2) * rr
        beats = beats + jr.normal(0.0, 0.012, beats.size)
        prof = np.zeros(t.size)
        for b in beats:
            d = t - b
            m = (d > -0.10) & (d < 0.40)
            if not m.any():
                continue
            dd = d[m]
            qrs = (-0.25 * np.exp(-0.5 * (dd / 0.012) ** 2)
                   + 1.00 * np.exp(-0.5 * ((dd - 0.020) / 0.011) ** 2)
                   - 0.35 * np.exp(-0.5 * ((dd - 0.048) / 0.018) ** 2)
                   + 0.22 * np.exp(-0.5 * ((dd - 0.190) / 0.045) ** 2))
            prof[m] += qrs
        rows = np.zeros((self.n_elec, t.size))
        for i, e in enumerate(self.electrodes):
            x, y = mt.POSITIONS.get(e, (0.0, 0.0))
            near_neck = 0.35 + 0.65 * float(np.clip(abs(x), 0.0, 1.2)) / 1.2
            if e in ("A1", "A2"):
                near_neck = 1.4
            rows[i] = prof * amplitude * near_neck * (1.0 if x >= 0 else -1.0)
        return rows

    # ---------------- main entry ----------------

    def segment(self, t0: float, t1: float) -> Tuple[np.ndarray, np.ndarray]:
        """Referential potentials over [t0, t1).

        Returns ``(t, x)`` with ``t`` in seconds and ``x`` shaped
        ``(n_electrodes, n_samples)`` in microvolts.
        """
        fs = self.fs
        i0 = int(round(t0 * fs))
        n = max(1, int(round((t1 - t0) * fs)))
        t = (i0 + np.arange(n)) / fs

        sleep = self._sleep_at(t)
        temp = self.temperature_at(t)
        temp_slow = np.clip((36.5 - temp) / 3.5, 0.0, 1.0)
        beta_w = (_piecewise(self._sed_t, self._sed_beta, t)
                  if len(self._sed_t) > 1 else np.full(n, self._sed_beta[0]))
        amp_w = (_piecewise(self._sed_t, self._sed_amp, t)
                 if len(self._sed_t) > 1 else np.ones(n))

        # --- background mixture -------------------------------------------
        x = self._stream_signal(self.st_broad, i0, n) * (0.80 + 0.20 * sleep)[None, :]

        pdr_w = (1.0 - 0.55 * sleep) * (1.0 - 0.55 * temp_slow)
        if self.age != "neonate":
            x += self._stream_signal(self.st_pdr, i0, n) * (0.62 * pdr_w)[None, :]
            x += self._stream_signal(self.st_theta, i0, n) * (0.30 + 0.25 * sleep)[None, :]
        else:
            x += self._stream_signal(self.st_theta, i0, n) * 0.22

        delta_w = 0.14 + 0.85 * self.slow_fraction + 0.45 * sleep + 0.70 * temp_slow
        x += self._stream_signal(self.st_delta, i0, n) * delta_w[None, :]
        x += self._stream_signal(self.st_beta, i0, n) * beta_w[None, :]

        if self.age != "neonate":
            spindle_phase = np.mod(t, 3.7)
            spindle_gate = np.where(spindle_phase < 1.2, np.sin(np.pi * spindle_phase / 1.2) ** 2, 0.0)
            train_s = (self.spec.get("style") or {}).get("spindle_train_s")
            if train_s is not None:
                spindle_gate *= np.mod(t - 300.0, 1800.0) < float(train_s)
            x += self._stream_signal(self.st_spindle, i0, n) * (1.5 * sleep * spindle_gate)[None, :]
        if self.bg.get("delta_brushes") and self.age == "neonate":
            brush_gate = np.clip(self._oa(self.st_delta, i0 + 4242, n, 1)[0], 0, None)
            brush_gate = brush_gate / (brush_gate.std() + _SMOOTH_EPS)
            brush_gate = np.clip(brush_gate - 0.8, 0.0, None)
            x += self._stream_signal(self.st_brush, i0, n) * (0.30 * brush_gate)[None, :]

        # focal slowing on the attenuated side
        if float(self.slow_side.max()) > 0:
            slow_extra = self._stream_signal(self.st_pdr_slow, i0, n)
            x += slow_extra * (self.slow_side[:, None] * 0.55)

        # --- amplitude, asymmetry, envelopes ------------------------------
        x *= self.amp_rms
        x *= self.gain_asym[:, None]
        x *= self.channel_am(t)

        preset_scale = {
            "suppressed": 0.06, "low_voltage": 0.28,
        }.get(self.bg["type"], 1.10 if self.bg["type"] == "burst_suppression" else 1.0)
        x *= preset_scale

        env = self.burst_envelope(t)
        env = env * self.slow_am(t)
        env = env * self.postictal_envelope(t)
        env = env * np.clip(0.70 + 0.09 * (temp - 33.0), 0.55, 1.06)
        env = env * amp_w
        gain_points = self.bg.get("amplitude_gain_at_h")
        if gain_points:
            env *= np.interp(t / 3600.0, [p[0] for p in gain_points], [p[1] for p in gain_points])
        for at, dur, side, depth in self._atten:
            if at + dur < t[0] or at > t[-1]:
                continue
            shape = smoothstep((t - at) / 6.0) * (1.0 - smoothstep((t - (at + dur)) / 12.0))
            lat = np.ones(self.n_elec)
            if side in ("left", "right"):
                sgn = -1.0 if side == "left" else 1.0
                lat = np.array([float(np.clip(sgn * mt.POSITIONS.get(e, (0, 0))[0] + 0.1, 0.0, 1.0))
                                for e in self.electrodes])
            x *= (1.0 - depth * lat[:, None] * shape[None, :])
        x *= env[None, :]

        bs = self.bg["burst_suppression"]
        discharge_count = int(bs.get("epileptiform_discharges", 0))
        if discharge_count:
            signal = np.zeros_like(t)
            fraction = float(bs.get("highly_epileptiform_fraction", 1.0))
            spacing = float(bs.get("interpeak_latency_s", 0.4))
            phases = int(bs.get("phases", 6))
            for index in np.flatnonzero((self._burst_end >= t[0]) & (self._burst_start <= t[-1])):
                if np.floor((index + 1) * fraction + 1e-9) == np.floor(index * fraction + 1e-9):
                    continue
                start, end = self._burst_start[index], self._burst_end[index]
                run_spacing = min(spacing, (end - start) / (discharge_count + 1))
                for j in range(discharge_count):
                    centre = start + (j + 1) * run_spacing
                    u = (t - centre) / min(0.14, run_spacing * 0.40)
                    gate = np.where(np.abs(u) <= 1, np.cos(np.pi * u / 2) ** 2, 0.0)
                    signal += gate * np.cos(np.pi * phases * u / 2)
            field = self._gen_weights("F3") + self._gen_weights("F4")
            x += field[:, None] * signal[None, :] * float(self.bg["amplitude_uv"])

        # --- stimulation reactivity ---------------------------------------
        reactive = self.bg.get("reactivity", "present") == "present"
        for ev in self.stimulations:
            at = float(ev["at_min"]) * 60.0
            if not reactive or at + 25.0 < t[0] or at > t[-1]:
                continue
            shape = np.exp(-np.clip(t - at, 0, None) / 7.0) * (t >= at)
            x *= (1.0 + 0.55 * shape[None, :])
            x += (self._stream_signal(self.st_beta, i0 + 5551, n)
                  * (self.amp_rms * 0.55 * shape)[None, :])

        # --- ictal activity (not scaled by the background envelope) -------
        x += self._seizure_block(t)

        # --- always-present ECG contamination + artifacts ------------------
        sensor_rms_uv = 0.25
        x += self._stream_signal(self.st_sensor, i0, n) * sensor_rms_uv
        ecg_uv = float(self.bg.get("baseline_ecg_uv", 0.0))
        if ecg_uv > 0:
            x += self._ecg(t, amplitude=ecg_uv)
        x += self._artifact_block(t, i0)

        return t, x

    # ---------------- derivations ----------------

    def derive(self, x: np.ndarray, pairs: Sequence[Tuple[str, Optional[str]]],
               montage: str = "longitudinal_bipolar") -> np.ndarray:
        """Apply a display montage to referential data from :meth:`segment`."""
        rows = []
        avg = x[[self._idx[c] for c in self.scalp], :].mean(axis=0)
        for a, b in pairs:
            ia = self._idx[a]
            if b is not None:
                rows.append(x[ia] - x[self._idx[b]])
            elif montage == "average":
                rows.append(x[ia] - avg)
            else:
                ref = "A1" if mt.side_of(a) != "right" else "A2"
                rows.append(x[ia] - x[self._idx[ref]])
        return np.asarray(rows)
