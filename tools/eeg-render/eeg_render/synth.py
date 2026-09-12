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

**Partition independence.**  The invariant the whole design rests on is that
*the same absolute sample interval yields the same samples however it was
requested* - so a chunked export and a single-shot render agree, and the file a
learner scrolls through is the recording the rendered image was drawn from.
Anything derived from the requested window rather than from absolute time
breaks it.  Four classes of that bug were fixed in 0.3.7: RNG streams keyed by
the request's starting hop, event times drawn across the request instead of the
event, normalisers taken from the request's own statistics, and window functions
convolved against edge-padded requests.  One case remains and cannot be fixed
here: ``sosfiltfilt`` in the frequency-selective attenuation branch settles
against the block it is given, so **callers that chunk must request a margin and
trim it**, as ``compute_trends`` does.

Constructing the synthesizer with a different ``duration_s`` also changes the
signal everywhere, because the slow amplitude-modulation grids are normalised
over the whole recording.  Duration is therefore part of a recording's identity,
not a display option.

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

#: Spread of per-electrode gain, as a two-sided log-normal: ``_LO`` governs how
#: much quieter than the median a channel may read, ``_HI`` how much louder.
#:
#: At the original symmetric 0.055 every channel sat within ~5% of every other,
#: which is a large part of what reads as synthetic.  Chosen against CHB-MIT by
#: the SHAPE of the per-channel amplitude distribution rather than one summary
#: statistic - matching the interquartile spread with a symmetric distribution
#: argues for ~1.0, which puts the loudest channel 30x the quietest against a
#: real 4.2-7.2x and leaves the quietest at 0.12 of the median, effectively a
#: dead electrode.
#:
#: Measured, bipolar, 100 s interictal, against real min/med 0.52-0.69 and
#: max/min 4.2-7.2.
CH_GAIN_LOG_SD_LO = 0.30
CH_GAIN_LOG_SD_HI = 0.75

#: Weight of the continuous muscle floor, awake.  NOT microvolts: this term is
#: mixed in before ``x *= self.amp_rms``, so it scales with the record's own
#: background amplitude - which is right, since muscle and cerebral amplitude
#: both ride the same electrode gain. It is also inside the burst envelope, so
#: a suppressed interval stays suppressed.
#:
#: Set against CHB-MIT: at 0.0 our 1-40 Hz spectral slope was -2.65 against a
#: real -0.83..-1.69 and line length 361 against 543-2376. At 0.70, -1.27 and
#: 1531.
#:
#: Sleep drives it, via ``1 - 0.75*sleep``.  Tonic muscle falls markedly as
#: sleep deepens, which is much of why a sleep record looks cleaner than a
#: waking one; and because ``_sleep_at`` dips at an arousal, an arousal gets a
#: transient muscle burst for free, which is what one looks like in life.
#: Measured, 25-70 Hz over 2-20 Hz power: awake 0.461, asleep 0.024 (a 19x
#: drop), arousal 0.294, back to 0.024 afterwards.  ``_sleep_at`` is a
#: continuous depth, not a stage, so there is no REM atonia here - the model
#: has no REM to hook onto.
EMG_FLOOR_W = 0.70

#: Extra muscle during an ictal run, as a multiple of the tonic floor.  Applied
#: through ``ictal_gate`` and multiplied by the same wakefulness factor, so a
#: sedated or neonatal electrographic seizure still recruits none.
#: Measured on a focal run against CHB-MIT ictal windows: at 0.0, slope -1.84
#: (target -0.83..-1.52) and line length 1542 (target 2909-8646); at 1.5, -1.04
#: and 3453, both inside. Kept modest on purpose - this bank is mostly
#: electrographic seizures, not convulsions, where real muscle is far larger.
#: It does NOT close the ictal amplitude gap: 36 -> 41 uV against a real 81-95.
#: That residue is the specs' own amplitude_start_uv/amplitude_end_uv, a
#: clinical authoring value, not a scaling bug.
EMG_ICTAL_GAIN = 1.5

#: Spontaneous blinks per second, awake.  ~0.25/s is 15/min, an ordinary rate.
#: Set to 0 to disable.  Gated by wakefulness and by the burst envelope, so a
#: sleeping or suppressed record does not blink.
BLINK_RATE_HZ = 0.25

#: Global multiplier on ictal amplitude.  The authored amplitude_start_uv /
#: amplitude_end_uv across the bank express clinical intent and their RELATIVE
#: values are meaningful, but their absolute scale ran about 2x quiet against
#: real pediatric ictal recordings: a focal run measured 43 uV median on the
#: bipolar montage against CHB-MIT's 81-95. One multiplier here preserves every
#: authored relationship instead of rewriting 48 YAMLs.
#:
#: A montage-aware version was tried first and rejected: a generalized field
#: cancels ~2.5x through a bipolar chain where a focal one barely cancels at
#: all, so in principle the scaling should follow the field. But the static
#: field predictor did not match measurement - 5.33x predicted against 2.53x
#: measured for generalized - and it degenerates to zero survival for focal
#: fields, where most derivation pairs sit in the leak and see the same value.
#: A wrong model is worse than an honest constant.
ICTAL_GAIN = 2.0

#: Peak microvolts of a blink at Fp1/Fp2, referential.  Real Fp blinks run
#: 100-300 uV, and a bipolar chain halves one (Fp1 - F7), so the 95 used by the
#: explicit ``eye_blink`` artifact reads thin as a spontaneous floor.  Measured
#: on FP1-F7 as the ratio of the 99.9th percentile to the channel SD - a
#: scale-free measure of how far transients stand out of the trace - real is
#: 6.4-7.0, ours 4.2 at 95 and 5.3 at 200.
#:
#: Kept at 95 anyway.  A blink is ocular and genuinely should NOT shrink with a
#: cerebral attenuation, and the attenuation ramp is applied separately from
#: ``env`` so blinks escape it - but at 200 they then obscure the very thing an
#: attenuation case asks the reader to see, and
#: test_attenuation_ramp_builds_over_the_requested_window drops to 1.25x against
#: a required 1.3x.  Readability of the clinical sign wins over transient
#: realism.  The shortfall against real is partly honest anyway: real extremes
#: are not only blinks but movement and electrode pops, which remain
#: artifact-events-only here.
BLINK_UV = 95.0

#: Blink field: frontal-maximal, falling off fast behind the frontal chain.
_BLINK_FIELD = {
    "Fp1": 1.00, "Fp2": 1.00, "F7": 0.45, "F8": 0.45,
    "F3": 0.50, "F4": 0.50, "Fz": 0.45, "T3": 0.15, "T4": 0.15,
}

#: RMS microvolts of amplifier/electrode noise.  Deliberately left at 0.25.
#: This term is added AFTER the burst envelope - correctly, since amplifier
#: noise is not physiologically suppressed - so raising it fills the interburst
#: intervals of a burst-suppression record and breaks the <5 uV suppression
#: criterion that the BSR trend depends on. Raising it to 1.0 dropped measured
#: suppression from 15%+ to 10.6% and failed
#: test_suppressed_raw_intervals_survive_sensor_noise. It also bought almost
#: nothing: line length moved 1241 -> 1267 against a target band of 543-2376.
SENSOR_RMS_UV = 0.25
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
# spike-and-wave, parameterized in SECONDS
# --------------------------------------------------------------------------
# A harmonic stack (``morph="ictal"``) is defined in phase, so its "spike"
# stretches with the repetition rate: sweep a run 3.0 -> 1.5 Hz and the spike
# doubles in width.  A real spike does not care how often it repeats - IFCN
# fixes it at 20 to <70 ms, an after-going slow wave follows at its own
# timescale, and the pair keeps those durations whatever the rate.  So this
# kernel is a function of elapsed SECONDS within the cycle, and the cycle
# period only decides how much flat baseline follows the complex.
#
# The spike is deliberately asymmetric - steeper ascending than descending -
# which is one of the six IFCN criteria for an epileptiform discharge and is
# something a symmetric harmonic sum cannot produce.
_SW_SPIKE_RISE = 0.012      # s, ascending limb sigma
_SW_SPIKE_FALL = 0.024      # s, descending limb sigma (FWHM ~42 ms overall)
_SW_WAVE_LAG = 0.16         # s, spike peak -> slow-wave trough
_SW_WAVE_SIGMA = 0.075      # s, slow-wave sigma (FWHM ~177 ms)
_SW_WAVE_GAIN = 0.85        # slow wave amplitude, relative to the spike


#: Cycle-to-cycle variability.  Without these every complex is an identical
#: stamp and every channel moves in lockstep, which reads as synthetic
#: immediately - real generalized spike-wave wobbles in timing, amplitude and
#: contour, and the head is never perfectly synchronous.
#
#: These draws are deliberately COMMON to every generator of one discharge,
#: with the head-wide desynchrony carried by ``_SW_AP_LEAD`` instead.  A
#: generalized field sums ~19 generators into each electrode, so per-generator
#: independent jitter is averaged away by the central limit theorem - it makes
#: the trace *smoother*, not more organic.  Only variation with spatial
#: structure survives the sum.
_SW_JITTER_S = 0.016        # +/- s, per-cycle timing of the whole discharge
_SW_AMP_VAR = 0.26          # +/- fraction, per-cycle amplitude
_SW_WIDTH_VAR = 0.22        # +/- fraction, per-cycle spike width
_SW_WAVE_VAR = 0.28         # +/- fraction, per-cycle slow-wave depth
#: Per-cycle anterior-posterior lead, scaled by each generator's y position.
#: Generalized spike-wave is near-synchronous but not simultaneous, and the
#: front-to-back lead varies discharge to discharge.
_SW_AP_LEAD = 0.022         # +/- s at the poles


def _cycle_noise(k: np.ndarray, salt: int) -> np.ndarray:
    """Deterministic uniform [0,1), keyed by the ABSOLUTE cycle index.

    Keying on the cycle number rather than on position within the request is
    what keeps the jitter partition-independent: the same discharge gets the
    same wobble no matter which chunk asked for it, so a chunked export still
    matches the image it was drawn from.
    """
    # The salt is mixed in Python ints and masked to 64 bits: the wrap-around
    # is the point of a hash, but doing it in numpy raises an overflow warning.
    off = np.uint64(((salt & 0xFFFFFFFF) * 0x9E3779B97F4A7C15) & 0xFFFFFFFFFFFFFFFF)
    x = (k.astype(np.int64) + 1_000_003).astype(np.uint64) + off
    x = (x ^ (x >> np.uint64(30))) * np.uint64(0xBF58476D1CE4E5B9)
    x = (x ^ (x >> np.uint64(27))) * np.uint64(0x94D049BB133111EB)
    x = x ^ (x >> np.uint64(31))
    return (x >> np.uint64(11)).astype(np.float64) * (1.0 / 9007199254740992.0)


def _sw_kernel(tau: np.ndarray, width: float | np.ndarray = 1.0,
               wave: float | np.ndarray = 1.0) -> np.ndarray:
    """One spike-and-wave complex; ``tau`` is seconds from the spike peak."""
    sig = np.where(tau < 0.0, _SW_SPIKE_RISE, _SW_SPIKE_FALL) * width
    spike = np.exp(-0.5 * (tau / sig) ** 2)
    slow = (_SW_WAVE_GAIN * wave
            * np.exp(-0.5 * ((tau - _SW_WAVE_LAG) / _SW_WAVE_SIGMA) ** 2))
    return spike - slow


def _sw_cycle(tau: np.ndarray, period: np.ndarray,
              k: Optional[np.ndarray] = None, salt: int = 0,
              lead: float = 0.0, gsalt: Optional[int] = None) -> np.ndarray:
    """The complex plus its neighbours, so nothing is truncated at the wrap.

    Each neighbour is drawn with *its own* cycle's jitter (cycle ``k - n``
    holds the spike sitting at ``tau + n*period``), so a complex keeps one
    identity across the wrap instead of changing shape at the boundary.

    ``lead`` is the generator's anterior-posterior position in [-1, 1]; it
    scales a per-cycle timing gradient across the head.
    """
    out = np.zeros_like(tau)
    for n in (-2, -1, 0, 1, 2):
        if k is None:
            out = out + _sw_kernel(tau + n * period)
            continue
        kk = k - n
        gs = salt if gsalt is None else gsalt

        def draw(sal, off, amt):
            return (_cycle_noise(kk, sal + off) - 0.5) * (2.0 * amt)

        # Each parameter blends a discharge-wide draw with a per-generator one.
        # The common part survives the ~19-generator sum and is what makes one
        # complex differ from the next; the per-generator part is what stops
        # every channel being a scaled copy of the same trace, and it survives
        # only because PINNED_FALLOFF keeps each electrode local.
        dt = (draw(salt, 11, _SW_JITTER_S)
              + lead * draw(salt, 67, _SW_AP_LEAD)
              + draw(gs, 83, _SW_JITTER_S * 0.5))
        amp = 1.0 + draw(salt, 23, _SW_AMP_VAR * 0.65) + draw(gs, 23, _SW_AMP_VAR * 0.55)
        wid = 1.0 + draw(salt, 37, _SW_WIDTH_VAR * 0.6) + draw(gs, 37, _SW_WIDTH_VAR * 0.6)
        wav = 1.0 + draw(salt, 53, _SW_WAVE_VAR * 0.6) + draw(gs, 53, _SW_WAVE_VAR * 0.6)
        out = out + amp * _sw_kernel(tau + n * period - dt, np.maximum(wid, 0.35),
                                     wav)
    return out


def _sw_norm() -> tuple:
    """Per-frequency mean and RMS of the spike-wave complex (computed once).

    The duty cycle - and so the RMS - depends on the repetition rate, because
    the complex has a fixed duration inside a cycle that does not.  Normalising
    against the *realised* signal would be partition-dependent, so this is a
    pure function of frequency, interpolated at use.
    """
    freqs = np.geomspace(0.2, 30.0, 192)
    means = np.empty_like(freqs)
    rmss = np.empty_like(freqs)
    for i, f in enumerate(freqs):
        period = 1.0 / f
        tau = np.linspace(0.0, period, 2048, endpoint=False)
        v = _sw_cycle(tau, np.full_like(tau, period))
        means[i] = v.mean()
        rmss[i] = np.sqrt(np.mean((v - means[i]) ** 2)) or 1.0
    return freqs, means, rmss


_SW_FREQS, _SW_MEANS, _SW_RMSS = _sw_norm()


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------

def smoothstep(x: np.ndarray | float) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def _margin_time(t: np.ndarray, k: int, fs: float) -> np.ndarray:
    """``t`` extended by ``k`` samples of *absolute* time on each side.

    Convolving a window function needs values beyond the request.  Taking them
    from ``np.pad(..., mode="edge")`` makes the result depend on where the
    request happened to start, so the same absolute second smooths differently
    in a full-record render and in a chunked export.  Continuing the real time
    axis instead keeps the smoothing partition-independent.
    """
    dt = 1.0 / fs
    return np.concatenate([
        t[0] - dt * np.arange(k, 0, -1),
        t,
        t[-1] + dt * np.arange(1, k + 1),
    ])


#: Heart rate by age band, used both for the ECG artifact and the baseline ECG.
_ECG_HR = {"neonate": 145.0, "infant": 130.0, "child": 100.0, "adolescent": 80.0}


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

#: Tonic muscle: temporalis AND frontalis, so this is broader and much flatter
#: than ``_TEMPORAL``.  Reusing the chewing-artifact profile (10:1 temporal to
#: midline) buried the temporal chains under EMG while leaving the midline
#: clean - obviously wrong beside a real page, where muscle is frontotemporal
#: and roughly bilateral rather than a band across two derivations.
_MUSCLE = {
    "T3": 1.00, "T4": 1.00, "F7": 0.95, "F8": 0.95,
    "T5": 0.72, "T6": 0.72, "Fp1": 0.70, "Fp2": 0.70,
    "F3": 0.55, "F4": 0.55, "Fz": 0.45,
    "C3": 0.40, "C4": 0.40, "Cz": 0.30,
    "P3": 0.30, "P4": 0.30, "Pz": 0.25, "O1": 0.30, "O2": 0.30,
}


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

        # Caches for quantities that must NOT be derived from the requested
        # window, or the same absolute sample would differ between a full-record
        # render and a chunked export.  See the partition-independence note in
        # the module docstring.
        self._ecg_jit: Optional[Tuple[int, np.ndarray]] = None
        self._brush_norm: Optional[float] = None

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
        self._build_blink_schedule()
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
        # tonic floor gets its own, broader field; st_emg stays peaked for artifacts
        musc = _profile(ch, _MUSCLE, 0.30)
        for e in mt.REFERENCE_ELECTRODES:
            musc[self._idx[e]] = 0.20
        self.st_muscle = self._mk("muscle", hp_lp_shape(f, 20.0, 95.0), musc,
                                  common=0.10)
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
        # Asymmetric on purpose.  A symmetric log-normal wide enough to match
        # the real interquartile spread also drives its low tail to 0.12 of the
        # median, i.e. a near-dead channel, where real recordings bottom out
        # around 0.52-0.69.  Physiologically that asymmetry is right: an
        # electrode can read hot (poor contact, focal pathology, muscle) far
        # more easily than a live channel can read much quieter than its
        # neighbours.
        z = rng.standard_normal(self.n_elec)
        self._ch_gain = np.exp(
            np.where(z < 0.0, CH_GAIN_LOG_SD_LO, CH_GAIN_LOG_SD_HI) * z)

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
             e["side"], float(e["depth_pct"]) / 100.0,
             float(e.get("ramp_min", 0.0)) * 60.0,
             float(e.get("delta_depth_pct", e["depth_pct"])) / 100.0)
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

    def _build_blink_schedule(self) -> None:
        """Spontaneous blink times over the whole record, drawn once.

        Real awake EEG blinks every few seconds without anyone scheduling it;
        the ``eye_blink`` artifact only fires inside an event window, so a
        recording with none had no blinks at all.  The whole schedule is drawn
        at construction from the record seed, so which chunk asks for a given
        second cannot change where the blinks are.
        """
        if BLINK_RATE_HZ <= 0:
            self._blink_t = np.empty(0)
            return
        rng = substream(self.seed, "blinks")
        span = self.duration_s + 120.0
        # inter-blink intervals are lognormal-ish, not a metronome
        n = max(1, int(span * BLINK_RATE_HZ * 1.6))
        gaps = _lognorm(rng, n, 0.55) / BLINK_RATE_HZ
        times = np.cumsum(gaps) - 60.0
        self._blink_t = times[times < span]

    def blink_rows(self, t: np.ndarray, wake: np.ndarray) -> np.ndarray:
        """Blink deflections over ``t``; ``wake`` is the 0..1 gate."""
        rows = np.zeros((self.n_elec, t.size))
        if self._blink_t.size == 0 or t.size == 0:
            return rows
        sel = self._blink_t[(self._blink_t > t[0] - 0.6) & (self._blink_t < t[-1] + 0.6)]
        if sel.size == 0:
            return rows
        prof = np.zeros(t.size)
        for tt in sel:
            d = t - tt
            m = (d > -0.05) & (d < 0.45)
            prof[m] += np.exp(-0.5 * ((d[m] - 0.14) / 0.075) ** 2)
        prof = prof * BLINK_UV * wake
        for i, e in enumerate(self.electrodes):
            rows[i] = prof * _BLINK_FIELD.get(e, 0.04)
        return rows

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
        k = max(3, int(round(0.22 * self.fs)) | 1)
        # Evaluate the indicator over an absolute-time margin rather than padding
        # the request's own edge value: a burst straddling a chunk boundary must
        # smooth identically whichever chunk asked for it.
        te = _margin_time(t, k, self.fs)
        idx = np.searchsorted(self._burst_start, te, side="right") - 1
        idx = np.clip(idx, 0, len(self._burst_start) - 1)
        inside = (te >= self._burst_start[idx]) & (te < self._burst_end[idx])
        win = np.hanning(k)
        win /= win.sum()
        env = np.convolve(inside.astype(float), win, mode="same")[k:-k]
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
                    morph=ev.get("morphology") or "ictal",
                    index=i,
                ))
            elif ev["type"] == "seizure_cluster":
                z = ev["seizure"]
                evo = z["evolution"]
                t = float(ev["start_min"]) * 60.0
                end = float(ev["end_min"]) * 60.0
                step = max(float(ev["interval_min"]) * 60.0, 10.0)
                jit = substream(self.seed, "cluster", i)
                # duration_end_s lets a cluster ESCALATE: each seizure is
                # interpolated between duration_s at start_min and
                # duration_end_s at end_min, which is how a worsening burden
                # actually reads on a trend. Absent, every run is the same
                # length as before.
                dur0 = float(z["duration_s"])
                dur1 = float(z.get("duration_end_s", dur0))
                span = max(end - t, 1e-6)
                k = 0
                while t <= end + 1e-6:
                    frac = min(max((t - float(ev["start_min"]) * 60.0) / span, 0.0), 1.0)
                    out.append(SeizureInstance(
                        t0=t + float(jit.normal(0.0, step * 0.03)),
                        duration_s=(dur0 + (dur1 - dur0) * frac) * float(_lognorm(jit, 1, 0.10)[0]),
                        onset_region=z["onset_region"],
                        start_hz=float(evo["start_hz"]), end_hz=float(evo["end_hz"]),
                        amp_start=float(evo["amplitude_start_uv"]),
                        amp_end=float(evo["amplitude_end_uv"]),
                        spread=z["spread"], postictal_s=float(z["postictal_attenuation_s"]),
                        morph=z.get("morphology") or "ictal",
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
                    morph=ev.get("morphology") or "ictal",
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

    def _gen_weights(self, focus: str,
                     falloff: float = mt.DEFAULT_FALLOFF) -> np.ndarray:
        cached = getattr(self, "_gw_cache", None)
        if cached is None:
            cached = {}
            self._gw_cache = cached
        key = (focus, falloff)
        if key not in cached:
            w = mt.monopole_weights(focus, self.electrodes, falloff=falloff)
            cached[key] = np.array([w[c] for c in self.electrodes])
        return cached[key]

    def _field_scale(self, region: str) -> np.ndarray:
        """Cached ``generator_field_scale`` for ``region`` on this electrode set."""
        cached = getattr(self, "_fs_cache", None)
        if cached is None:
            cached = {}
            self._fs_cache = cached
        if region not in cached:
            cached[region] = np.array(
                mt.generator_field_scale(region, self.electrodes))
        return cached[region]

    def _seizure_block(self, t: np.ndarray) -> np.ndarray:
        """Sum of every ictal run overlapping ``t``; shape (n_elec, len(t))."""
        out = np.zeros((self.n_elec, t.size))
        if not self.seizures:
            return out
        for inst in self.seizures:
            if inst.t1 < t[0] - 1.0 or inst.t0 > t[-1] + 1.0:
                continue
            phase, u, amp, f_inst = self._ictal_phase(inst, t)
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
                # A generalized discharge is near-synchronous across the head -
                # tens of milliseconds, not the ~0.2 s a focal run takes to
                # cross to the other hemisphere.  The old flat 0.18 s lag made
                # every generalized event look like it propagated.
                lag = 0.02 if spread == "generalized" else 0.18
                phase_d, _, _, f_d = self._ictal_phase(inst, t - lag)

            # One jitter stream per discharge, shared by every generator, with
            # the head-wide desynchrony carried by each generator's y position.
            # Independent per-generator noise would be averaged away: ~19
            # generators sum into every electrode.
            base = int(self.seed) * 31 + inst.index * 1009 + inst.ordinal * 101
            onset_scale = self._field_scale(inst.onset_region)
            onset_fall = mt.generator_falloff(inst.onset_region)
            for gi, (focus, ga, gph) in enumerate(
                    mt.region_generators(inst.onset_region, self.electrodes)):
                w = self._gen_weights(focus, onset_fall) * onset_scale
                wv = (self._wave(phase, psi, gph, inst.morph, inst.plus_fast,
                                 f_inst, base, mt.POSITIONS.get(focus, (0.0, 0.0))[1],
                                 base + 7919 * (gi + 1))
                      * amp * ga * (1.0 - 0.55 * s))
                out += w[:, None] * wv[None, :]
            if spread is not None and phase_d is not None:
                spread_scale = self._field_scale(spread)
                spread_fall = mt.generator_falloff(spread)
                for gi, (focus, ga, gph) in enumerate(
                        mt.region_generators(spread, self.electrodes)):
                    w = self._gen_weights(focus, spread_fall) * spread_scale
                    wv = (self._wave(phase_d, psi, gph, inst.morph, inst.plus_fast,
                                     f_d, base + 500_003,
                                     mt.POSITIONS.get(focus, (0.0, 0.0))[1],
                                     base + 500_003 + 7919 * (gi + 1))
                          * amp * ga * s)
                    out += w[:, None] * wv[None, :]
        return out

    @staticmethod
    def _wave(phase: np.ndarray, psi: np.ndarray, offset_cycles: float,
              morph: str = "ictal", plus_fast: float = 0.0,
              f_inst: Optional[np.ndarray] = None, salt: int = 0,
              lead: float = 0.0, gsalt: Optional[int] = None) -> np.ndarray:
        """Waveform for one generator, from its instantaneous phase.

        ``ictal``      four harmonics at 1/k^1.3 - the spiky, non-sinusoidal
                       contour of an evolving ictal run.
        ``rda``        near-monomorphic (harmonics heavily suppressed), which is
                       what makes rhythmic delta activity look *bland* next to a
                       seizure of the same frequency.
        ``periodic``   a narrow sharp transient plus an after-going slow wave,
                       repeating once per cycle - LPDs / GPDs.
        ``spike_wave`` the same two components but fixed in SECONDS, so the
                       spike keeps its ~42 ms width while the repetition rate
                       sweeps.  Needs ``f_inst``.

        Every family is normalized to unit RMS so ``amplitude_uv`` in the spec
        means the same thing across them.  For ``spike_wave`` that normalisation
        is frequency-dependent, because a fixed-duration complex inside a
        lengthening cycle has a falling duty cycle.
        """
        p = phase + 2 * np.pi * offset_cycles
        if morph == "spike_wave":
            f = np.full_like(p, 3.0) if f_inst is None else np.clip(f_inst, 0.2, 30.0)
            period = 1.0 / f
            cycles = p / (2 * np.pi)
            tau = np.mod(cycles, 1.0) * period
            wave = _sw_cycle(tau, period, np.floor(cycles), salt, lead, gsalt)
            wave = ((wave - np.interp(f, _SW_FREQS, _SW_MEANS))
                    / np.interp(f, _SW_FREQS, _SW_RMSS))
        elif morph == "periodic":
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
            return None, u, None, None
        uu = np.clip(u, 0.0, 1.0)
        r = max(inst.end_hz, 0.2) / max(inst.start_hz, 0.2)
        f0 = max(inst.start_hz, 0.2)
        if abs(r - 1.0) < 1e-6:
            phase = 2 * np.pi * f0 * (uu * dur)
            f_inst = np.full_like(uu, f0)
        else:
            lnr = math.log(r)
            phase = 2 * np.pi * f0 * dur * (np.power(r, uu) - 1.0) / lnr
            # d(phase)/dt / 2pi.  Analytic on purpose: differentiating the
            # sampled phase numerically would use one-sided differences at the
            # array edges, making the result depend on where the caller cut
            # its chunk - exactly what test_partition_independence forbids.
            f_inst = f0 * np.power(r, uu)
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
            f_inst = f_inst + a * fq * np.cos(2 * np.pi * fq * (uu * dur) + p)
        phase = phase + wander
        f_inst = np.clip(f_inst, 0.2, 30.0)

        # amplitude_*_uv is the peak-to-peak of the ictal run; a rhythmic,
        # sharply contoured discharge runs ~2.9x its RMS peak-to-peak.
        amp = ((inst.amp_start + (inst.amp_end - inst.amp_start) * uu)
               / 2.9 * ICTAL_GAIN)
        ramp = 0.07 if inst.kind != "rhythmic_pattern" else 0.14
        amp = amp * smoothstep(uu / ramp) * (1.0 - smoothstep((uu - (1.0 - ramp)) / ramp))
        # cycle-group waxing and waning
        amp = amp * (1.0 + inst.fluctuate * np.sin(2 * np.pi * 0.11 * uu * dur + wax_phase))
        amp = amp * live
        return phase, uu, amp, f_inst

    def ictal_gate(self, t: np.ndarray) -> np.ndarray:
        """0..1 over the support of any ictal run, with a short rise and fall.

        Only used to drive muscle.  A *clinical* seizure recruits muscle hard,
        and on a real ictal page much of the apparent amplitude is EMG rather
        than cerebral - which is a large part of why our ictal pages measured
        quiet against CHB-MIT, a cohort of awake children having clinical
        seizures.  An electrographic seizure in a sedated or paralysed patient
        recruits none, and that case is handled without a separate flag because
        the muscle term is multiplied by the same ``1 - 0.75*sleep`` wakefulness
        factor as the tonic floor.
        """
        gate = np.zeros_like(t)
        if t.size == 0 or not self.seizures:
            return gate
        lo, hi = float(t[0]), float(t[-1])
        for inst in self.seizures:
            if inst.t1 < lo - 2.0 or inst.t0 > hi + 2.0:
                continue
            ramp = max(min(2.0, inst.duration_s * 0.08), 0.25)
            gate = np.maximum(gate, smoothstep((t - inst.t0) / ramp)
                              * (1.0 - smoothstep((t - (inst.t1 - ramp)) / ramp)))
        return gate

    def postictal_envelope(self, t: np.ndarray) -> np.ndarray:
        env = np.ones_like(t)
        if t.size == 0:
            return env
        lo, hi = float(t[0]), float(t[-1])
        for inst in self.seizures:
            if inst.postictal_s <= 0:
                continue
            # Skip on the event's own support -- [t1, t1 + 3*postictal_s) -- before
            # allocating anything.  A long cluster can hold thousands of instances
            # and the old code built two full-length arrays for every one of them.
            # Note this is the *postictal* interval, not the ictal one.
            if inst.t1 > hi or inst.t1 + inst.postictal_s * 3.0 < lo:
                continue
            d = t - inst.t1
            m = (d >= 0) & (d < inst.postictal_s * 3)
            if not m.any():
                continue
            depth = 0.62
            # Masked, not np.where: the latter evaluates the exponential across
            # the whole array, including samples far before offset where the
            # positive exponent overflows.
            env[m] *= 1.0 - depth * np.exp(-d[m] / max(inst.postictal_s / 1.6, 1.0))
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

    @staticmethod
    def _event_window(ev: Dict) -> Tuple[float, float]:
        """The artifact's own ``[start, end)`` in seconds from recording start."""
        a0 = float(ev["at_min"]) * 60.0
        return a0, a0 + float(ev["duration_s"])

    def _artifact_block(self, t: np.ndarray, i0: int) -> np.ndarray:
        out = np.zeros((self.n_elec, t.size))
        n = t.size
        for k, ev in enumerate(self.artifacts):
            a0 = float(ev["at_min"]) * 60.0
            a1 = a0 + float(ev["duration_s"])
            if a1 < t[0] or a0 > t[-1]:
                continue
            # Raised-cosine edges evaluated on absolute time.  The old code
            # convolved an edge-padded indicator, so an artifact straddling a
            # chunk boundary got a different envelope in each chunk.
            ramp = 0.8
            live = np.clip(np.minimum((t - a0) / ramp, (a1 - t) / ramp), 0.0, 1.0)
            live = 0.5 - 0.5 * np.cos(np.pi * live)
            gain = self._INTENSITY[ev["intensity"]]
            # Keyed to the event, NOT to the request's starting hop: otherwise
            # the realized pops/blinks move when the window moves.
            rng = substream(self.seed, "art", k)
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
            # Continue the square wave on absolute time rather than padding the
            # request's edge value, so the chew cycle is continuous across chunks.
            te = _margin_time(t, 50, fs)
            chew = 0.5 + 0.5 * sps.square(2 * np.pi * 1.9 * te, duty=0.42)
            chew = np.convolve(chew, np.hanning(31) / np.hanning(31).sum(),
                               mode="same")[50:-50]
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
            tau = 0.09
            # Draw over the EVENT's window, not the request's, so a given pop
            # keeps its time and amplitude however the recording is chunked.
            a0, a1 = self._event_window(ev)
            k = max(1, int(rate * (a1 - a0)))
            times = rng.uniform(a0, a1, k)
            amps = rng.uniform(120.0, 420.0, k) * rng.choice([-1.0, 1.0], k) * gain
            sel = (times >= t[0] - 8 * tau) & (times <= t[-1])
            times, amps = times[sel], amps[sel]
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
            a0, a1 = self._event_window(ev)
            k = max(1, int(rate * (a1 - a0)))
            times = np.sort(rng.uniform(a0, a1, k))
            times = times[(times > t[0] - 0.5) & (times < t[-1] + 0.5)]
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

    def _beat_jitter(self, idx: np.ndarray) -> np.ndarray:
        """Beat-timing jitter keyed to the *absolute* beat index.

        Drawing ``jr.normal(size=beats.size)`` per request assigns the stream's
        first value to whichever beat the request happens to start on, so the
        same heartbeat lands at a different time in a chunked export than in a
        full-record render.  ``baseline_ecg_uv`` is non-zero for every age band,
        so that affected every channel of every recording.  The table is drawn
        once for the whole recording and indexed absolutely.
        """
        if self._ecg_jit is None:
            rr = 60.0 / _ECG_HR[self.age]
            lo = int(math.floor(-180.0 / rr)) - 2
            hi = int(math.ceil((self.duration_s + 180.0) / rr)) + 2
            vals = substream(self.seed, "ecg").normal(0.0, 0.012, hi - lo + 1)
            self._ecg_jit = (lo, vals)
        lo, vals = self._ecg_jit
        return vals[np.clip(idx - lo, 0, vals.size - 1)]

    def _ecg(self, t: np.ndarray, amplitude: float) -> np.ndarray:
        """Synthetic QRS train, opposite polarity over the two hemispheres."""
        rr = 60.0 / _ECG_HR[self.age]
        idx = np.arange(math.floor(t[0] / rr) - 1, math.ceil(t[-1] / rr) + 2, dtype=np.int64)
        beats = idx * rr + self._beat_jitter(idx)
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

        # Continuous muscle floor.  Before this, ``st_emg`` existed but was
        # reachable only through an explicit artifact event, so a recording with
        # no artifact scheduled had no high-frequency content whatever.  Real
        # scalp EEG always carries some: measured against CHB-MIT we were 3-15x
        # too smooth by line length (162 against 543-2376 interictal) and our
        # 1-40 Hz spectral slope was -2.5 against a real -0.83 to -1.69.
        #
        # Tonic muscle falls markedly in sleep, which is also why a sleep record
        # looks cleaner than a waking one.
        # Gated by the burst envelope a SECOND time (everything gets it once at
        # the end).  Muscle tracks burst state far more sharply than cerebral
        # background does: in the deep suppression this models - anaesthesia,
        # post-anoxic - the patient is typically sedated or paralysed and there
        # is essentially no muscle at all.  Without this the broadband floor
        # lifts the interburst intervals above the <5 uV suppression criterion
        # the BSR trend is measured against.  On a continuous record the
        # envelope is ~1 and this changes nothing.
        emg_w = (EMG_FLOOR_W * (1.0 - 0.75 * sleep) * self.burst_envelope(t)
                 * (1.0 + EMG_ICTAL_GAIN * self.ictal_gate(t)))
        x += self._stream_signal(self.st_muscle, i0, n) * emg_w[None, :]

        if self.age != "neonate":
            spindle_phase = np.mod(t, 3.7)
            spindle_gate = np.where(spindle_phase < 1.2, np.sin(np.pi * spindle_phase / 1.2) ** 2, 0.0)
            train_s = (self.spec.get("style") or {}).get("spindle_train_s")
            if train_s is not None:
                spindle_gate *= np.mod(t - 300.0, 1800.0) < float(train_s)
            x += self._stream_signal(self.st_spindle, i0, n) * (1.5 * sleep * spindle_gate)[None, :]
        if self.bg.get("delta_brushes") and self.age == "neonate":
            brush_gate = np.clip(self._oa(self.st_delta, i0 + 4242, n, 1)[0], 0, None)
            # Normalise by a fixed reference window, not this request's own std:
            # otherwise brush amplitude depends on how much of the recording was
            # asked for at once.  Neonatal backgrounds enable brushes by default.
            if self._brush_norm is None:
                ref_n = max(1, min(int(300.0 * self.fs), int(self.duration_s * self.fs)))
                ref = np.clip(self._oa(self.st_delta, 4242, ref_n, 1)[0], 0, None)
                self._brush_norm = float(ref.std()) + _SMOOTH_EPS
            brush_gate = brush_gate / self._brush_norm
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
        for at, dur, side, depth, ramp, delta_depth in self._atten:
            if at + dur < t[0] or at > t[-1]:
                continue
            # ramp = 0 keeps the historical 6 s (abrupt) onset; a longer ramp
            # builds the attenuation over that many minutes, which is how a
            # developing infarct reads on a trend rather than a step change.
            rise = max(ramp, 6.0)
            fall = max(min(ramp, dur) * 0.5, 12.0)
            shape = smoothstep((t - at) / rise) * (1.0 - smoothstep((t - (at + dur)) / fall))
            lat = np.ones(self.n_elec)
            if side in ("left", "right"):
                sgn = -1.0 if side == "left" else 1.0
                lat = np.array([float(np.clip(sgn * mt.POSITIONS.get(e, (0, 0))[0] + 0.1, 0.0, 1.0))
                                for e in self.electrodes])
            if abs(delta_depth - depth) < 1e-9:
                x *= (1.0 - depth * lat[:, None] * shape[None, :])
            else:
                # Frequency-selective loss. Ischemia takes the faster
                # frequencies first and spares delta, so a broadband
                # multiplier — which scales alpha and delta by the same factor
                # — leaves alpha/delta and theta/delta flat and the very
                # trends a reader would use to spot the stroke show nothing.
                # NOTE (partition independence): this is the one place segment()
                # cannot be made window-independent on its own.  sosfiltfilt
                # extends the *requested* block to settle, so samples within
                # roughly a filter length of a chunk edge differ from the same
                # samples rendered in a longer window.  Callers must request a
                # margin and trim it -- compute_trends already does (MARGIN_S),
                # and the waveform exporter must do the same.
                sos = sps.butter(4, 4.0, btype="lowpass", fs=self.fs, output="sos")
                slow = sps.sosfiltfilt(sos, x, axis=-1)
                fast = x - slow
                x = (slow * (1.0 - delta_depth * lat[:, None] * shape[None, :])
                     + fast * (1.0 - depth * lat[:, None] * shape[None, :]))
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
        sensor_rms_uv = SENSOR_RMS_UV
        x += self._stream_signal(self.st_sensor, i0, n) * sensor_rms_uv

        # Spontaneous blinks.  Ocular, not cerebral, so they are in absolute
        # microvolts and added after the amplitude scaling rather than riding
        # it.
        #
        # Gated by wakefulness AND by the full envelope.  Strictly a blink is
        # not cerebral and should survive cerebral attenuation, but every
        # attenuated state this bank models - sedation, burst suppression,
        # postictal - is a reduced-arousal state in which blinking stops, so
        # gating on the same envelope is right for the cases that exist here.
        # Leaving them ungated masks the very thing an attenuation case is
        # asking the reader to see: it cut the measured attenuation ratio to
        # 1.25x and failed test_attenuation_ramp_builds_over_the_requested_window,
        # and it would have lifted burst-suppression interburst intervals past
        # the <5 uV suppression criterion.
        x += self.blink_rows(t, (1.0 - sleep) * env)
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
