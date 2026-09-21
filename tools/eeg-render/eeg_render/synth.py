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
#:
#: ``_HI`` came down from 0.75 to 0.50 when the draw became pair-shared (see
#: CH_GAIN_ASYM_LOG_SD).  A 3x regional draw on a homologous pair makes a
#: whole bipolar chain run hot on both sides at once, which moved a
#: calibrated burst-suppression page (PQ-A-003, minute 20) from 16% to 13%
#: suppressed epochs against a 15-35% band.  Swept over 8 seeds, bipolar
#: 100 s awake child: HI 0.75 gave max/min 4.2 (median; range 2.3-11.8) and
#: min/med 0.50; HI 0.50 gives max/min 3.0 (2.2-5.9), min/med 0.56, and the
#: page back at 16-17%.  The real 4.2-7.2 extremes are muscle- and
#: eye-laden frontotemporal channels, which the blink and muscle streams
#: already place anatomically; a random regional gain was standing in for
#: them and producing false hot regions instead.
CH_GAIN_LOG_SD_LO = 0.30
CH_GAIN_LOG_SD_HI = 0.50

#: The spread above is drawn ONCE PER HOMOLOGOUS PAIR (Fp1/Fp2, T3/T4, ...),
#: with this much independent log-normal spread left between the two sides.
#: Drawn per electrode instead, 60 seeds gave a worst homologous ratio of
#: 4.0x median (98% of records had a pair differing >2x) and a hemispheric
#: median-gain ratio of 1.25 (p90 1.70) - a reader calls >1.5x an abnormal
#: asymmetry, so nearly every "normal" background carried a false focal
#: finding.  The real 4.2-7.2x max/min spread is between REGIONS (a muscle-
#: and eye-laden frontotemporal channel against a quiet parasagittal one),
#: not between homologues, and the pair-shared draw keeps that spread.  At
#: 0.12 a typical homologous pair differs 1.13x, the 95th percentile 1.3x.
CH_GAIN_ASYM_LOG_SD = 0.12

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

#: Fraction of the tonic muscle floor withdrawn during a generalized
#: spike-wave (absence-type) run, which is behavioural arrest and staring
#: rather than a convulsion.  Blinks stop with it.  Only ``morphology:
#: spike_wave`` seizures do this; every other ictal morphology recruits
#: muscle through ``EMG_ICTAL_GAIN`` instead.
ABSENCE_EMG_DROP = 0.65

#: Burst edges by background type: ``(rise_s, fall_s, lag_s, regional_log_sd)``.
#: The old envelope was a box smoothed over 0.22 s, identical on every
#: electrode, so a neonatal burst snapped on and off head-wide like a switch.
#: A real burst builds over a fraction of a second and decays over one to
#: two seconds as its slow waves fade into the interburst interval, and its
#: edges lead or lag by a few hundred milliseconds from one region to another.
#: ``rise`` is centred on the scheduled start and ``fall`` on the scheduled
#: end, so the burst's mean duration - and the suppression fraction the trend
#: is measured against - is unchanged.  ``lag`` is the per-electrode edge
#: offset of a spatially smooth (linear-in-position) field drawn once per
#: burst; ``regional_log_sd`` tilts the burst's amplitude across the head the
#: same way.  Anaesthetic burst suppression keeps an abrupt onset, which is
#: what it actually looks like, and its short tail protects the <5 uV
#: interburst criterion.  Continuous backgrounds use the default and see no
#: edge at all (their pseudo-bursts are merged in ``_build_burst_schedule``).
#: The fifth element, ``hump``, is how much a burst waxes and wanes inside
#: its own span (0 = flat-topped, 0.3 = the ends sit at 70% of the peak);
#: neonatal bursts crescendo and decrescendo, anaesthetic ones do not.
BURST_EDGE_S: Dict[str, Tuple[float, float, float, float, float]] = {
    "burst_suppression": (0.15, 0.35, 0.05, 0.08, 0.0),
    "discontinuous": (1.20, 3.00, 0.60, 0.18, 0.30),
    "excessively_discontinuous": (0.80, 2.00, 0.50, 0.18, 0.25),
    "trace_alternant": (2.00, 4.00, 0.60, 0.15, 0.30),
    "hypsarrhythmia": (0.40, 0.90, 0.30, 0.25, 0.20),
}

#: Scalp muscle recruited by an ictal run, as a multiple of the tonic floor,
#: by the run's ``muscle`` setting.  ``modest`` is the 0.3.8 constant.
MUSCLE_FACTOR: Dict[str, float] = {"none": 0.0, "modest": 1.5, "clinical": 4.0}
_BURST_EDGE_DEFAULT = (0.11, 0.11, 0.0, 0.0, 0.0)

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

#: 0.4.0 ``amplitude_reference: display``: delivered / requested ratios of the
#: 0.3.x referential scale, measured with the EEG Atlas P4 estimators (1-s
#: peak-to-peak, median over the display-montage derivations of the region,
#: 0.5-30 Hz) so that dividing by them makes the request come out on the page.
#: ``background``: continuous backgrounds on the bipolar montage (P4: 0.85-0.86;
#: the neonatal reduced montage measured the same to two figures).  ``ictal``:
#: ``amplitude_end_uv`` at the end of a focal run (P4/P5: 1.5-1.7x).
#: ``periodic`` / ``rda``: LPD 3.6-3.7x and LRDA 1.7x on the maximal derivation.
#: Re-measure with tests/test_display_calibration.py after touching any
#: waveform template; that test holds delivered within 15 % of requested.
#: The background is not in this table: it is self-calibrated per spec in
#: ``Synthesizer._calibrate_display`` (a 40 s background-only synthesis measured on
#: the spec's own display montage), because the delivered ratio depends on the
#: mix (PDR gain and field, dominant frequency, montage).  Event constants below
#: were measured with calibrate_display.py on 2026-09-16.
DISPLAY_CAL: Dict[str, float] = {"ictal": 2.45, "periodic": 4.4, "rda": 2.9}

#: Spatial correlation length of the per-electrode background noise, in head
#: units (adjacent 10-20 electrodes sit ~0.5 apart).  Volume conduction blurs
#: a cortical source over several centimetres of scalp, so neighbouring
#: electrodes see partly the SAME activity; the old model gave each electrode
#: an independent draw plus one head-wide common row, and a bipolar chain
#: subtracts the common row out, leaving adjacent derivations with only the
#: -0.5 that sharing an electrode imposes.  Measured on CHB-MIT, longitudinal
#: bipolar, 100 s interictal, four records: |r| between derivations whose
#: midpoints sit <0.45 apart is 0.46-0.71, <0.75 is 0.23-0.42, 1.1-1.6 is
#: 0.15-0.25.  Ours before: 0.42-0.45 / 0.23-0.25 / 0.10-0.14.  A Gaussian
#: kernel on the independent rows puts the correlation where the real
#: signal has it - at short range, falling with distance - which no amount of
#: head-wide common mode can, because bipolar derivation cancels that.
#:
#: Correlated neighbours make a bipolar DIFFERENCE smaller, and the bank's
#: amplitudes (aEEG margins, 5 uV interburst criterion) were all calibrated
#: on bipolar derivations.  ``_build_spatial_mix`` therefore rescales the
#: kernel so the variance of a nearest-neighbour derivation is unchanged;
#: referential amplitude rises instead, which is the direction real
#: referential-vs-bipolar amplitude actually goes.
#:
#: Far-pair correlation (>1.6) is NOT this mechanism.  Real 0.11-0.22 there
#: comes from per-electrode gain mismatch leaking common mode into every
#: derivation (already modelled by CH_GAIN_LOG_SD_*, and seed-dependent: two
#: seeds measured 0.06 and 0.11) plus ocular and cardiac artifact.
SPATIAL_CORR_LENGTH = 0.65

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


def _periodic_template(x: np.ndarray) -> np.ndarray:
    """LPD/GPD sharp transient plus its after-going slow wave."""
    return (np.exp(-0.5 * ((x - 0.16) / 0.033) ** 2)
            - 0.55 * np.exp(-0.5 * ((x - 0.24) / 0.045) ** 2)
            + 0.42 * np.exp(-0.5 * ((x - 0.46) / 0.13) ** 2))


def _periodic_norm() -> tuple:
    """Mean/RMS/peak-to-peak of the periodic template (computed once)."""
    x = np.linspace(0.0, 1.0, 4096, endpoint=False)
    w = _periodic_template(x)
    m = float(w.mean())
    rms = float(np.sqrt(np.mean((w - m) ** 2)))
    return m, rms, float((w.max() - w.min()) / rms)


_PERIODIC_MEAN, _PERIODIC_RMS, _PERIODIC_PTP = _periodic_norm()


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
_ECG_HR = {"neonate": 145.0, "infant": 130.0, "child": 100.0, "adolescent": 80.0, "adult": 72.0}


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
    #: scalp muscle recruited by this run: none / modest / clinical
    muscle: str = "modest"
    #: seconds of diffuse electrodecrement tied to this run (spasm: after the
    #: slow wave; tonic seizure: before the fast activity)
    decrement_s: float = 0.0
    decrement_depth: float = 0.0
    fast_uv: float = 0.0
    wave_fast_uv: float = 0.0
    #: waveform family: ``ictal`` (sharply contoured evolving run),
    #: ``rda`` (monomorphic rhythmic delta), ``periodic`` (LPD/GPD - a sharp
    #: transient with an after-going slow wave, repeating at a fixed rate)
    morph: str = "ictal"
    fluctuate: float = 0.22
    plus_fast: float = 0.0
    #: frequency/amplitude trajectory: ``sweep`` (0.3.x log glide) or ``recruit``
    #: (0.4.0: low-voltage fast onset, stepwise slowing, build-up, late clonic bursting)
    profile: str = "sweep"

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
        self._spatial_mix = self._build_spatial_mix()

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
        # 0.4.0: with ``amplitude_reference: display`` the request is what the
        # reader measures on the display montage, so undo the measured shortfall
        # (DISPLAY_CAL) and drop the hidden per-type multipliers: a suppressed
        # record is authored as the voltage wanted on screen.
        self.display_ref = bg.get("amplitude_reference") == "display"
        self._calibrating = False          # True only inside _calibrate_display()
        self.spec_version = int(spec.get("spec_version") or 1)
        # 1/f exponent and delta content are separate knobs: real scalp EEG
        # sits around alpha 1.5-2.5 at every age.  Pushing alpha to 3 to
        # express "slow" leaves almost no 2-15 Hz power, which then makes the
        # aEEG read implausibly low.  slow_fraction drives the delta stream
        # weight (below) and only mildly steepens the spectrum.
        self.alpha = 1.10 + 1.55 * float(bg["slow_fraction"])
        self.slow_fraction = float(bg["slow_fraction"])
        self.dominant_hz = float(bg["dominant_hz"])
        # EEG Atlas P5 opt-in; 1.0 reproduces the 0.3.10 mix bit for bit
        self.pdr_gain = float(bg.get("pdr_gain", 1.0))

        self._build_streams()
        self._build_slow_am()
        self._build_channel_am()
        self._build_control_timelines()
        self._build_burst_schedule()
        self._build_blink_schedule()
        self._build_graphoelement_schedule()
        self._build_multifocal_spikes()
        self._collect_seizures()
        self.artifacts = [e for e in spec["events"] if e["type"] == "artifact"]
        self.stimulations = [e for e in spec["events"] if e["type"] == "stimulation"]
        # 0.4.0 ``amplitude_reference: display``: last, once everything a segment needs exists
        self.display_scale = 1.0
        if self.display_ref:
            self._calibrate_display()

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
        if self.bg.get("ap_gradient") == "absent":
            # P7 batch 2: loss of the anteroposterior gradient (diffuse encephalopathy) - the
            # posterior-dominant and anterior-fast streams lose their fields and become uniform
            post = np.full_like(post, float(np.mean(post)))
            ant = np.full_like(ant, float(np.mean(ant)))
        cen = _profile(ch, _CENTRAL, 0.3)
        temp = _profile(ch, _TEMPORAL, 0.3)
        for arr in (post, ant, cen, temp):
            for e in mt.REFERENCE_ELECTRODES:
                arr[self._idx[e]] = 0.15

        self.st_broad = self._mk("broad", bg_shape(f, self.alpha), near_uniform, common=0.45)
        self.st_delta = self._mk("delta", band_shape(f, 1.6, 1.5, order=1.0), near_uniform, common=0.55)
        # 0.4.0 (Craig, P5 C13): a focal posterior field for the dominant rhythm keeps it
        # occipito-parietal instead of leaking into central and frontal derivations
        post_pdr = np.power(post, 2.2) if self.bg.get("pdr_field") == "focal" else post
        self.st_pdr = self._mk("pdr", band_shape(f, self.dominant_hz, 1.45), post_pdr, common=0.65)
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
        if self.bg["type"] == "hypsarrhythmia":
            # "no topographical distribution, no frequency or amplitude
            # gradient": the slow activity is asynchronous between regions, so
            # the head-wide shared component is cut for the slow streams.
            for st in (self.st_broad, self.st_delta, self.st_theta):
                st.common = 0.12
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
            hemispheric = asym.get("profile") == "hemispheric"
            for i, e in enumerate(ch):
                x = mt.POSITIONS.get(e, (0.0, 0.0))[0]
                # gradient (0.3.x): C3 at x~0.5 got half the attenuation, Fp1 a third, so a
                # "40 %" request never read as 40 %; hemispheric (0.4.0, Craig P5 C04): every
                # electrode clear of the midline gets the full figure
                lateral = float(smoothstep(sign * x / 0.25)) if hemispheric else float(np.clip(sign * x, 0.0, 1.0))
                self.gain_asym[i] = 1.0 - att * lateral
                self.slow_side[i] = lateral * min(1.0, slw / 3.0)

        # P7 batch 2: breach effect - over a skull defect the background is larger and carries
        # more sharply contoured fast activity (Niedermeyer: 2-3x amplitude, beta accentuated)
        self._breach_fast = np.ones(self.n_elec)
        br = self.bg.get("breach")
        if br:
            w = self._gen_weights(str(br["focus"]))      # monopole field around the defect (neighbours ~0.24)
            # ``gain`` is what the reader measures on the bipolar display montage: a derivation of two
            # partially correlated electrodes (spatial kernel 0.65) dilutes a referential gain, so the
            # focus electrode is raised by 1.6x the requested excess (P7 batch 2: requested 2.2 read 1.36)
            self.gain_asym = self.gain_asym * (1.0 + 1.6 * (float(br.get("gain", 2.0)) - 1.0) * w)
            self._breach_fast = 1.0 + (float(br.get("fast_gain", 2.5)) - 1.0) * w

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
        # One regional draw per homologous pair (mirror the x coordinate;
        # midline electrodes are their own pair), plus a small independent
        # left-right term.  See CH_GAIN_ASYM_LOG_SD.
        keys: List[Tuple[float, float]] = []
        key_of: List[int] = []
        for e in self.electrodes:
            x, y = mt.POSITIONS.get(e, (0.0, 0.0))
            k = (round(abs(x), 3), round(y, 3))
            if k not in keys:
                keys.append(k)
            key_of.append(keys.index(k))
        zk = rng.standard_normal(len(keys))[np.asarray(key_of)]
        ze = rng.standard_normal(self.n_elec)
        gain = np.exp(
            np.where(zk < 0.0, CH_GAIN_LOG_SD_LO, CH_GAIN_LOG_SD_HI) * zk
            + CH_GAIN_ASYM_LOG_SD * ze)
        # Anchor the median SCALP gain at 1 so ``amplitude_uv`` means the
        # median channel of every record.  With ~11 regional draws instead of
        # 19 independent ones, an unanchored median swung ~1.4x between
        # seeds, which moved a calibrated burst-suppression page from 16% to
        # 12% suppressed epochs with no change of spec.
        scalp = [self._idx[e] for e in self.scalp]
        self._ch_gain = gain / float(np.median(gain[scalp]))
        cap = self.bg.get("channel_gain_max")          # EEG Atlas P5 opt-in
        if cap is not None:
            # clip the tail, re-anchor the scalp median, clip once more so no
            # electrode ends above the cap after re-anchoring
            g = np.minimum(self._ch_gain, float(cap))
            g = g / float(np.median(g[scalp]))
            self._ch_gain = np.minimum(g, float(cap))

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

        # P7 batch 1 (0.4.2): an EMITTED term sleep-wake cycle.  Intervals of awake / active sleep /
        # quiet sleep with indeterminate sleep at the transitions, drawn once from the record seed
        # (Castro Conde 2017: well-differentiated cycles in 20/22 healthy term neonates by day 3, but
        # 63 % indeterminate sleep and cycles in only 2/22 in the first six hours).  Quiet sleep is
        # trace alternant (suppression_fraction_at / _ibi_floor_at), active sleep and wake are
        # continuous; the timeline goes into the answer key (export.manifest).
        self._state_intervals: List[Tuple[float, float, str]] = []
        bgc = spec["background"]
        if bgc.get("state_cycle") == "term" and self.age == "neonate":
            rng = substream(self.seed, "state_cycle")
            early = bgc.get("hours_of_life") is not None and float(bgc["hours_of_life"]) < 12.0
            # mean minutes per state: day 3 vs first hours (indeterminate dominates early)
            means = {"awake": (10.0, 5.0), "active_sleep": (25.0, 9.0), "quiet_sleep": (20.0, 6.0),
                     "indeterminate": (3.0, 14.0)}
            order = ["awake", "active_sleep", "indeterminate", "quiet_sleep", "indeterminate"]
            t = -60.0 - float(rng.uniform(0.0, 20.0)) * 60.0
            k = int(rng.integers(0, len(order)))
            while t < dur + 120.0:
                label = order[k % len(order)]
                mean_min = means[label][1 if early else 0]
                length = 60.0 * mean_min * float(_lognorm(rng, 1, 0.25)[0])
                self._state_intervals.append((t, t + length, label))
                t += length
                k += 1

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

    #: per-state sleep weight (drives delta content, muscle, blinks) and quiet-sleep discontinuity
    _STATE_SLEEP = {"awake": 0.0, "active_sleep": 0.35, "indeterminate": 0.5, "quiet_sleep": 1.0}
    _STATE_SF = {"awake": 0.0, "active_sleep": 0.0, "indeterminate": 0.18, "quiet_sleep": 0.44}
    _STATE_SF_EARLY = {"awake": 0.0, "active_sleep": 0.05, "indeterminate": 0.30, "quiet_sleep": 0.55}

    def state_at(self, t: np.ndarray) -> np.ndarray:
        """Behavioral-state label per sample ('' when no state cycle is scheduled)."""
        out = np.full(t.shape, "", dtype=object)
        for a, b, label in self._state_intervals:
            out[(t >= a) & (t < b)] = label
        return out

    def _state_lookup(self, t: np.ndarray, table: Dict[str, float], default: np.ndarray) -> np.ndarray:
        if not self._state_intervals:
            return default
        out = np.array(default, dtype=float, copy=True)
        for a, b, label in self._state_intervals:
            m = (t >= a) & (t < b)
            if m.any():
                out[m] = table[label]
        return out

    def _sleep_at(self, t: np.ndarray) -> np.ndarray:
        if self._state_intervals:
            v = self._state_lookup(t, self._STATE_SLEEP, np.zeros_like(t, dtype=float))
            for at, width in self._arousals:
                v = v * (1.0 - 0.9 * np.exp(-0.5 * ((t - at) / width) ** 2))
            return np.clip(v, 0.0, 1.0)
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
        if self.bg["type"] == "hypsarrhythmia":
            # NREM sleep fragments hypsarrhythmia into grouped bursts with
            # periods of voltage attenuation (the "modified" variant); awake
            # it is continuous.
            sleep = 0.35 * self._sleep_at(t)
        if self._state_intervals and self.bg["type"] == "continuous":
            early = self.bg.get("hours_of_life") is not None and float(self.bg["hours_of_life"]) < 12.0
            base = self._state_lookup(t, self._STATE_SF_EARLY if early else self._STATE_SF, np.zeros_like(t, dtype=float))
            sleep = np.zeros_like(t)     # the state table already carries sleep
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
        # 0.4.0 ``background.ibi_range_s``: the author stated the interburst interval in
        # seconds, so draw it (and ``burst_s``) directly.  The suppression-fraction cycle
        # model below rescales both by 1 + 1.35 (sf - 0.3): an authored 10-30 s came out
        # 28-40 s with 8 s bursts (P5 C03, 2026-09-19).
        if self.bg.get("ibi_range_s") is not None:
            burst_s = max(float(bs["burst_s"]), 0.25)
            ibi_s = max(float(bs["ibi_s"]), 0.5)
            sigma = float(bs.get("ibi_sigma", 0.26))
            while t < horizon:
                burst = max(0.25, burst_s * float(_lognorm(rng, 1, 0.22)[0]))
                ibi = max(0.5, ibi_s * float(_lognorm(rng, 1, sigma)[0]))
                starts.append(t)
                ends.append(t + burst)
                t += burst + ibi
            self._burst_start = np.asarray(starts)
            self._burst_end = np.asarray(ends)
            self._ibi_floor0 = floor0
            return
        # a deep-sedation interburst is genuinely flat; a preterm interburst is not
        while t < horizon:
            sf = float(self.suppression_fraction_at(np.array([max(t, 0.0)]))[0])
            cyc = cycle0 * (1.0 + 1.35 * max(0.0, sf - 0.3))
            if sf < 0.03:
                # Continuous: extend the running pseudo-burst instead of
                # abutting a new one, so the edge ramps never meet inside it.
                # 30 s steps (not 300) so a state or sedation change that
                # brings discontinuity is honoured within half a minute; the
                # merge keeps a continuous record one unbroken burst.
                if ends and abs(ends[-1] - t) < 1e-9:
                    ends[-1] = t + 30.0
                else:
                    starts.append(t)
                    ends.append(t + 30.0)
                t += 30.0
                continue
            burst = max(0.25, cyc * (1.0 - sf) * float(_lognorm(rng, 1, 0.22)[0]))
            # IBI spread widens with prematurity (spec.PMA_TABLE); 0.26 is the
            # historical default every existing spec keeps.
            ibi = max(0.25, cyc * sf * float(_lognorm(rng, 1, float(bs.get("ibi_sigma", 0.26)))[0]))
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
        rate = BLINK_RATE_HZ
        if self.bg.get("blink_rate_per_min") is not None:      # EEG Atlas P5 opt-in
            rate = float(self.bg["blink_rate_per_min"]) / 60.0
        if rate <= 0:
            self._blink_t = np.empty(0)
            return
        rng = substream(self.seed, "blinks")
        span = self.duration_s + 120.0
        # inter-blink intervals are lognormal-ish, not a metronome
        n = max(1, int(span * rate * 1.6))
        gaps = _lognorm(rng, n, 0.55) / rate
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
        prof = self._blink_profile(t, sel) * float(self.bg.get("blink_amplitude_uv", BLINK_UV)) * wake
        field = self._blink_field()
        for i, e in enumerate(self.electrodes):
            rows[i] = prof * field[i]
        return rows

    #: 0.4.1 blink field (Craig, P5 second pass: "blinks don't look right", eegpedia).  A blink
    #: is a cornea-positive potential at Fp that falls off steeply: F3/F4 and F7/F8 carry about
    #: a third, the central and temporal chain almost nothing, so Fp1-F7 / Fp1-F3 dip hard and
    #: F7-T3 / F3-C3 show a third of it.  0.4.0's table gave F3 half of Fp1, which made Fp1-F3
    #: and F3-C3 equal - the "second blink" one row down that Craig flagged.
    _BLINK_FIELD_V2 = {"Fp1": 1.00, "Fp2": 1.00, "F7": 0.32, "F8": 0.32, "F3": 0.30, "F4": 0.30,
                       "Fz": 0.22, "T3": 0.06, "T4": 0.06, "C3": 0.05, "C4": 0.05, "Cz": 0.04}

    def _blink_field(self) -> np.ndarray:
        table = self._BLINK_FIELD_V2 if self.spec_version >= 2 else _BLINK_FIELD
        default = 0.02 if self.spec_version >= 2 else 0.04
        return np.array([table.get(e, default) for e in self.electrodes])

    def _blink_profile(self, t: np.ndarray, times: np.ndarray) -> np.ndarray:
        """Unit-peak blink deflections at ``times`` (positive = cornea-positive at Fp).

        Version 2: eyelid closure in ~100 ms (rise sigma 45 ms) and a return with a
        120 ms time constant: ~0.14 s at half height, ~0.4 s in all, the 0.2-0.4 s of
        a real blink.  Version 1 keeps the 0.3.x symmetric 75 ms Gaussian.
        """
        prof = np.zeros(t.size)
        sharp = self.spec_version >= 2
        for tt in times:
            d = t - tt
            if sharp:
                m = (d > -0.06) & (d < 0.55)
                dd = d[m]
                prof[m] += np.where(dd < 0.10, np.exp(-0.5 * ((dd - 0.10) / 0.045) ** 2),
                                    np.exp(-(dd - 0.10) / 0.12))
            else:
                m = (d > -0.05) & (d < 0.45)
                prof[m] += np.exp(-0.5 * ((d[m] - 0.14) / 0.075) ** 2)
        return prof

    # ---------------- neonatal graphoelements ----------------

    #: Per element: (mean duration s, log-sd of duration, carrier Hz range,
    #: laterality, burst-bound).  Laterality: "bilateral" (synchronous both
    #: sides), "unilateral" (one side per event), "midline".  Burst-bound
    #: elements are gated by the head-wide burst envelope so in a
    #: discontinuous record they live inside bursts.
    _GE_SHAPE: Dict[str, Tuple[float, float, Tuple[float, float], str, bool]] = {
        "occipital_delta": (8.0, 0.7, (0.4, 1.4), "bilateral", True),
        "temporal_theta": (1.5, 0.25, (4.0, 6.0), "unilateral", True),
        "temporal_alpha": (1.5, 0.25, (8.0, 10.0), "unilateral", True),
        "stop": (1.0, 0.3, (5.0, 6.0), "unilateral", True),
        "frontal_sharp": (0.45, 0.0, (0.0, 0.0), "bilateral", False),
        "anterior_slow": (3.0, 0.35, (1.5, 2.0), "bilateral", False),
        "midline_theta": (1.5, 0.3, (5.0, 9.0), "midline", True),
        # 0.3.12: a delta brush is one slow wave (~0.7-1.6 s) with a 10-20 Hz
        # burst riding on it; one side per event, inside bursts when discontinuous
        "delta_brush": (1.1, 0.30, (10.0, 20.0), "unilateral", True),
        # P7 batch 1: transient sharp waves of the term neonate, 100-400 ms, > 50 uV, one side; the
        # region is drawn per event (temporal 43 %, rolandic 32 %, occipital 20 %, frontal 5 %: S22)
        "sharp_transient": (0.25, 0.25, (0.0, 0.0), "unilateral", False),
    }
    _SHARP_REGION_P = (0.43, 0.32, 0.20, 0.05)
    _SHARP_REGION_FIELDS = (
        {"T3": 1.0, "C3": 0.30, "T5": 0.40, "F7": 0.35},          # temporal
        {"C3": 1.0, "Cz": 0.30, "T3": 0.25, "P3": 0.30},          # rolandic
        {"O1": 1.0, "T5": 0.40, "P3": 0.35},                      # occipital
        {"F3": 1.0, "Fp1": 0.60, "F7": 0.50},                     # frontal
    )
    #: Spatial fields (electrode weight; the unilateral ones list the LEFT
    #: field and are mirrored for the right).
    _GE_FIELD: Dict[str, Dict[str, float]] = {
        "occipital_delta": {"O1": 1.0, "O2": 1.0, "T5": 0.45, "T6": 0.45, "P3": 0.45, "P4": 0.45, "Pz": 0.3},
        "temporal_theta": {"T3": 1.0, "F7": 0.5, "T5": 0.5, "C3": 0.25},
        "temporal_alpha": {"T3": 1.0, "F7": 0.5, "T5": 0.5, "C3": 0.25},
        "stop": {"O1": 1.0, "P3": 0.4, "T5": 0.4},
        "frontal_sharp": {"Fp1": 1.0, "Fp2": 1.0, "F3": 0.6, "F4": 0.6, "Fz": 0.6, "F7": 0.45, "F8": 0.45},
        "anterior_slow": {"Fp1": 1.0, "Fp2": 1.0, "F3": 1.0, "F4": 1.0, "Fz": 0.9, "F7": 0.6, "F8": 0.6, "C3": 0.3, "C4": 0.3, "Cz": 0.3},
        "midline_theta": {"Cz": 1.0, "C3": 0.4, "C4": 0.4, "Fz": 0.35, "Pz": 0.35},
        # rolandic / temporal / occipital, the regions brushes favour (the PMA-dependent
        # central vs occipito-temporal weighting is applied in graphoelement_rows)
        "delta_brush": {"C3": 1.0, "Cz": 0.5, "T3": 0.6, "O1": 0.7, "P3": 0.55, "T5": 0.4, "F3": 0.3},
        "sharp_transient": {"T3": 1.0, "C3": 0.30, "T5": 0.40},   # placeholder; the per-event region field is used
    }
    #: beta-delta complexes are CENTRAL at 27-30 w and OCCIPITO-TEMPORAL at 31-33 w
    #: (Hrachovy/Mizrahi/Kellaway); central ones are gone by 36-37 w, occipital by 39 w
    _BRUSH_FIELD_CENTRAL = {"C3": 1.0, "Cz": 0.55, "F3": 0.35, "T3": 0.35, "P3": 0.4}
    _BRUSH_FIELD_OCCTEMP = {"O1": 1.0, "T3": 0.85, "T5": 0.8, "P3": 0.6, "C3": 0.35}
    _MIRROR = {"Fp1": "Fp2", "F7": "F8", "F3": "F4", "T3": "T4", "C3": "C4", "T5": "T6", "P3": "P4", "O1": "O2"}

    def _build_graphoelement_schedule(self) -> None:
        """Draw every graphoelement's events over the whole record at construction.

        Times, durations, carrier frequencies, sides and amplitude jitter are
        all drawn from the record seed here, so which chunk asks for a given
        second cannot change what it contains.
        """
        self._ge_events: Dict[str, np.ndarray] = {}
        ge = (self.bg.get("graphoelements") or {}) if self.age == "neonate" else {}
        span = self.duration_s + 120.0
        for name, cfg in ge.items():
            rate = float(cfg.get("rate_per_min", 0.0))
            amp = float(cfg.get("amplitude_uv", 0.0))
            if rate <= 0 or amp <= 0 or name not in self._GE_SHAPE:
                continue
            mean_s, dur_sd, (f0, f1), lat, _ = self._GE_SHAPE[name]
            rng = substream(self.seed, "graphoelement", name)
            n = max(1, int(span * rate / 60.0 * 1.8))
            gaps = _lognorm(rng, n, 0.6) * (60.0 / rate)
            times = np.cumsum(gaps) - 60.0
            times = times[times < span]
            m = times.size
            if name == "occipital_delta":
                # runs are longest at 28-31 w ("commonly >30 s"), short before 28 w
                pma = float(self.bg.get("pma_weeks") or 32.0)
                mean_s = 3.0 if pma < 28.0 else (14.0 if pma <= 31.0 else 6.0)
            dur = np.clip(mean_s * _lognorm(rng, m, dur_sd), 0.3, 60.0) if dur_sd > 0 else np.full(m, mean_s)
            freq = rng.uniform(f0, f1, m) if f1 > 0 else np.zeros(m)
            if name == "sharp_transient":      # the freq column carries the region index for this element
                freq = rng.choice(len(self._SHARP_REGION_P), size=m, p=self._SHARP_REGION_P).astype(float)
            side = (rng.integers(0, 2, m) * 2 - 1).astype(float) if lat == "unilateral" else np.zeros(m)
            aj = amp * _lognorm(rng, m, 0.30)
            phase = rng.uniform(0, 2 * np.pi, m)
            self._ge_events[name] = np.column_stack([times, dur, freq, side, aj, phase])

    #: 0.4.1: spread of a tabled field onto electrodes the table does not name, in head
    #: units (adjacent 10-20 electrodes sit ~0.5 apart, so a neighbour of a 1.0 electrode
    #: receives ~0.55).  Same length as the background's SPATIAL_CORR_LENGTH.
    _GE_FIELD_SPREAD = 0.65

    def _table_field(self, table: Dict[str, float], side: float) -> np.ndarray:
        """Electrode weights from a (left-listed) field table, mirrored for ``side > 0``.

        The tables name 10-20 electrodes.  On a reduced array (neonatal_9 has no
        F3/F4/Fz/F7/F8) a frontal transient therefore used to exist at Fp1/Fp2 only,
        with nothing at C3/T3/Cz - Craig, P5 second pass (2026-09-19): "no field to
        the other electrodes".  Version 2 gives every acquired electrode the table
        does not name the physical spill-over of the named ones,
        ``max_k v_k * exp(-(d/spread)^2)``; named electrodes keep their tabled value,
        so a full 10-20 array renders as authored.  Version 1 keeps the bare lookup.
        """
        w = np.zeros(self.n_elec)
        placed: List[Tuple[str, float]] = []
        for e, v in table.items():
            if side > 0 and e in self._MIRROR:
                e = self._MIRROR[e]
            placed.append((e, float(v)))
            if e in self._idx:
                w[self._idx[e]] = max(w[self._idx[e]], v)
        if self.spec_version < 2:
            return w
        named = {e for e, _ in placed}
        for i, ch in enumerate(self.electrodes):
            if ch in named or ch not in mt.POSITIONS:
                continue
            cx, cy = mt.POSITIONS[ch]
            best = 0.0
            for e, v in placed:
                if e not in mt.POSITIONS:
                    continue
                ex, ey = mt.POSITIONS[e]
                d = math.hypot(cx - ex, cy - ey)
                best = max(best, v * math.exp(-((d / self._GE_FIELD_SPREAD) ** 2)))
            # a unilateral element stays unilateral: the homologous electrode across the
            # midline (O1 -> O2 is 0.62 apart) gets a fifth of the geometric spill
            if side != 0.0 and cx * side < -1e-9:
                best *= 0.2
            w[i] = best
        return w

    def _ge_field(self, name: str, side: float) -> np.ndarray:
        return self._table_field(self._GE_FIELD[name], side)

    def graphoelement_rows(self, t: np.ndarray) -> np.ndarray:
        """(n_elec, n) microvolts of the scheduled neonatal graphoelements over ``t``."""
        bound = np.zeros((self.n_elec, t.size))   # gated by the burst envelope
        free = np.zeros((self.n_elec, t.size))    # frontal transients, anterior slow
        if not getattr(self, "_ge_events", None) or t.size == 0:
            return bound
        for name, ev in self._ge_events.items():
            _, _, _, lat, burst_bound = self._GE_SHAPE[name]
            target = bound if burst_bound else free
            sel = ev[(ev[:, 0] + ev[:, 1] > t[0] - 1.0) & (ev[:, 0] < t[-1] + 1.0)]
            for t0, dur, freq, side, amp, phase in sel:
                if name == "frontal_sharp":
                    # broad biphasic transient, negative then positive, ~0.4 s
                    d = t - t0
                    wave = (np.exp(-0.5 * ((d - 0.10) / 0.055) ** 2)
                            - 0.75 * np.exp(-0.5 * ((d - 0.27) / 0.085) ** 2))
                    sig = -amp * 0.5 * wave
                elif name == "sharp_transient":
                    # a surface-negative sharp wave (~80 ms to peak) with a smaller positive
                    # after-wave, 200-300 ms in all; ``amp`` is the peak-to-peak request
                    d = t - t0
                    wave = (np.exp(-0.5 * ((d - 0.08) / 0.030) ** 2)
                            - 0.55 * np.exp(-0.5 * ((d - 0.19) / 0.060) ** 2))
                    sig = -amp * 0.65 * wave
                    fld = self._SHARP_REGION_FIELDS[int(freq) % len(self._SHARP_REGION_FIELDS)]
                    target += np.outer(self._table_field(fld, side), sig)
                    continue
                elif name == "delta_brush":
                    # a delta wave (one surface-negative half-cycle, ``amp`` peak-to-peak)
                    # with a fast burst riding on it: the burst envelope follows the slow
                    # wave.  The delta wave dominates (Craig, 0.4.0); the burst is about a
                    # fifth of it, rising to a third at 34-35 w when the beta inside the
                    # complexes is "extremely high voltage" (Hrachovy/Mizrahi).
                    pma_b = float(self.bg.get("pma_weeks") or 32.0)
                    ratio = 0.34 if 33.5 <= pma_b <= 35.5 else 0.22
                    u = (t - t0) / max(dur, 1e-3)
                    win = np.where((u > 0) & (u < 1), np.sin(np.pi * np.clip(u, 0, 1)), 0.0)
                    slow = -amp * 0.5 * win
                    fast = amp * 0.5 * ratio * win ** 2 * np.sin(2 * np.pi * freq * (t - t0) + phase)
                    sig = slow + fast
                    # field by maturity: central before 31 w, occipito-temporal after
                    fld = self._BRUSH_FIELD_CENTRAL if pma_b < 31.0 else self._BRUSH_FIELD_OCCTEMP
                    w = self._table_field(fld, side if lat == "unilateral" else 0.0)
                    target += np.outer(w, sig)
                    continue
                else:
                    u = (t - t0) / max(dur, 1e-3)
                    win = np.where((u > 0) & (u < 1), np.sin(np.pi * np.clip(u, 0, 1)) ** 1.5, 0.0)
                    ph = 2 * np.pi * freq * (t - t0) + phase
                    carrier = np.sin(ph)
                    if name in ("temporal_theta", "stop", "temporal_alpha"):
                        carrier = (carrier + 0.25 * np.sin(3 * ph)) / 1.03   # sharply contoured
                    sig = amp * 0.5 * win * carrier
                target += np.outer(self._ge_field(name, side if lat == "unilateral" else 0.0), sig)
        if bound.any():
            bound *= self.burst_envelope(t)[None, :]
        return bound + free

    def cape_cycles(self) -> List[Tuple[float, float, float]]:
        """(onset_s, offset_s, depth) of each CAPE cycle; empty without ``background.cape``."""
        c = self.bg.get("cape")
        if not c:
            return []
        period = float(c["period_s"]); depth = float(c.get("depth", 0.6))
        at = float(c.get("at_min", 0.0)) * 60.0
        n = int(c.get("cycles") or max(6, int((self.duration_s - at) // period)))
        return [(at + k * period, at + (k + 1) * period, depth) for k in range(n)]

    def cape_envelope(self, t: np.ndarray) -> np.ndarray:
        """Cyclic alternating pattern of encephalopathy: the second half of every cycle is attenuated
        by ``depth`` with 2 s smooth edges (ACNS: >= 6 cycles of two alternating patterns, each
        phase >= 10 s).  Pure function of absolute time."""
        cyc = self.cape_cycles()
        if not cyc:
            return np.ones_like(t)
        out = np.ones_like(t)
        for a, b, depth in cyc:
            if b < t[0] - 3.0 or a > t[-1] + 3.0:
                continue
            mid = 0.5 * (a + b)
            phase_b = smoothstep((t - mid) / 2.0) * (1.0 - smoothstep((t - b) / 2.0))
            out = out * (1.0 - depth * phase_b)
        return out

    def _ibi_floor_at(self, t: np.ndarray) -> np.ndarray:
        """Interburst residual amplitude; sedation drives it toward true flat."""
        sed = _piecewise(self._sed_t, self._sed_sf, t) if len(self._sed_t) > 1 else np.zeros_like(t)
        deep = np.clip(sed / 0.25, 0.0, 1.0)
        floor = self._ibi_floor0 * (1.0 - deep) + 0.005 * deep
        if self._state_intervals:
            # quiet sleep = trace alternant: interburst about 0.42 of the burst voltage (< 50 uV for
            # 100 uV bursts), a little lower in the first hours; other states have no interburst
            early = self.bg.get("hours_of_life") is not None and float(self.bg["hours_of_life"]) < 12.0
            table = {"awake": 1.0, "active_sleep": 1.0, "indeterminate": 0.6, "quiet_sleep": 0.30 if early else 0.42}
            floor = self._state_lookup(t, table, np.asarray(floor, dtype=float) * np.ones_like(t))
        points = self.bg.get("ibi_floor_at_h")
        if points:
            floor = np.interp(t / 3600.0, [p[0] for p in points], [p[1] for p in points])
        return floor

    def _burst_edge(self) -> Tuple[float, float, float, float, float]:
        return BURST_EDGE_S.get(self.bg["type"], _BURST_EDGE_DEFAULT)

    def _bursts_touching(self, t: np.ndarray, rise: float, fall: float) -> range:
        """Indices of scheduled bursts whose ramps reach into ``t``."""
        if t.size == 0:
            return range(0)
        lo = float(t[0]) - fall - 1.0
        hi = float(t[-1]) + rise + 1.0
        k0 = int(np.searchsorted(self._burst_end, lo, side="left"))
        k1 = int(np.searchsorted(self._burst_start, hi, side="right"))
        return range(max(k0, 0), min(k1, len(self._burst_start)))

    @staticmethod
    def _burst_shape(t: np.ndarray, start: float, end: float, rise: float, fall: float,
                     hump: float = 0.0) -> np.ndarray:
        # Rise centred on the scheduled start, fall centred on the scheduled
        # end, so the burst keeps its scheduled mean duration.
        shape = (smoothstep((t - start) / rise + 0.5)
                 * (1.0 - smoothstep((t - end) / fall + 0.5)))
        if hump > 0:
            u = np.clip((t - start) / max(end - start, 1e-6), 0.0, 1.0)
            shape = shape * ((1.0 - hump) + hump * np.sin(np.pi * u))
        return shape

    def burst_envelope(self, t: np.ndarray) -> np.ndarray:
        """Head-wide 0..1 burst envelope lifted by the interburst floor.

        A pure function of absolute time (partition-independent).  Drives
        the muscle floor and blinks; the per-electrode version the background
        is scaled by is ``burst_envelope_rows``.
        """
        rise, fall, _, _, hump = self._burst_edge()
        env = np.zeros_like(t)
        for k in self._bursts_touching(t, rise, fall):
            env += self._burst_shape(t, self._burst_start[k], self._burst_end[k], rise, fall, hump)
        env = np.clip(env, 0.0, 1.0)
        floor = self._ibi_floor_at(t)
        return floor + (1.0 - floor) * env

    def burst_envelope_rows(self, t: np.ndarray) -> np.ndarray:
        """(n_elec, n) burst envelope with per-burst edge lag and regional tilt.

        Each burst draws, keyed on its index in the schedule, a linear field
        over electrode position: edges lead or lag by up to ``lag_s`` and the
        burst's amplitude tilts by ``regional_log_sd``.  Keying on the burst
        index rather than the request window keeps a chunked export identical
        to a whole-record render.
        """
        rise, fall, lag, reg, hump = self._burst_edge()
        floor = self._ibi_floor_at(t)
        if lag <= 0 and reg <= 0:
            return np.broadcast_to(self.burst_envelope(t), (self.n_elec, t.size)).copy()
        pos = np.array([mt.POSITIONS.get(e, (0.0, 0.0)) for e in self.electrodes], float)
        env = np.zeros((self.n_elec, t.size))
        sync = float(self.bg.get("synchrony", 1.0))
        for k in self._bursts_touching(t, rise, fall + lag + 1.5):
            rng = substream(self.seed, "burst_edge", k)
            z = rng.standard_normal(4) / math.sqrt(2.0)
            shift = lag * (z[0] * pos[:, 0] + z[1] * pos[:, 1])
            # Interhemispheric asynchrony: with probability 1 - synchrony the
            # two hemispheres start this burst 0.5-1.5 s apart (rec 2446:
            # ~70% synchronous at 31-32 w, 80% at 33-34 w, 100% after 37 w).
            if rng.uniform() > sync:
                hemi_lag = rng.uniform(0.5, 1.5) * (1.0 if rng.uniform() < 0.5 else -1.0)
                shift = shift + 0.5 * hemi_lag * np.sign(pos[:, 0])
            tilt = np.exp(reg * (z[2] * pos[:, 0] + z[3] * pos[:, 1]))
            tt = t[None, :] - shift[:, None]
            env += tilt[:, None] * self._burst_shape(
                tt, self._burst_start[k], self._burst_end[k], rise, fall, hump)
        env = np.clip(env, 0.0, 1.35)
        return floor[None, :] + (1.0 - floor[None, :]) * env

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
                    profile=str(evo.get("profile") or "sweep"),
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
                        profile=str(evo.get("profile") or "sweep"),
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
            elif ev["type"] == "brd":
                # neonatal brief rhythmic discharge (EEG Atlas P5): a short
                # rhythmic run keyed as its own kind, never as a seizure
                evo = ev["evolution"]
                out.append(SeizureInstance(
                    t0=float(ev["onset_min"]) * 60.0, duration_s=float(ev["duration_s"]),
                    onset_region=ev["onset_region"],
                    start_hz=float(evo["start_hz"]), end_hz=float(evo["end_hz"]),
                    amp_start=float(evo["amplitude_start_uv"]), amp_end=float(evo["amplitude_end_uv"]),
                    spread=ev.get("spread", "none"), postictal_s=0.0,
                    morph=ev.get("morphology") or "rda", muscle=ev.get("muscle", "none"),
                    # an ictal-morphology BRD (0.4.0 default) waxes and wanes like the real thing
                    fluctuate=0.35 if (ev.get("morphology") or "rda") == "ictal" else 0.22,
                    index=i, kind="brd",
                ))
            elif ev["type"] == "rhythmic_pattern":
                out.extend(self._rpp_instances(ev, i))
            elif ev["type"] in ("spasm", "spasm_cluster"):
                evo = ev["evolution"]
                if ev["type"] == "spasm":
                    times = [float(ev["onset_min"]) * 60.0]
                else:
                    jit = substream(self.seed, "spasms", i)
                    step = float(ev["interval_s"])
                    times, t = [], float(ev["onset_min"]) * 60.0
                    for _ in range(int(ev["count"])):
                        times.append(t)
                        t += max(step * float(_lognorm(jit, 1, 0.35)[0]), 3.0)
                for k, t0 in enumerate(times):
                    out.append(SeizureInstance(
                        t0=t0, duration_s=float(ev["duration_s"]),
                        onset_region=ev["onset_region"], start_hz=1.0, end_hz=1.0,
                        amp_start=float(evo["amplitude_start_uv"]), amp_end=float(evo["amplitude_end_uv"]),
                        spread="none", postictal_s=float(ev["postictal_attenuation_s"]),
                        index=i, ordinal=k, kind="spasm", morph="spasm",
                        muscle=ev.get("muscle", "clinical"),
                        decrement_s=float(ev["decrement_s"]), decrement_depth=float(ev["decrement_depth"]),
                        fast_uv=float(ev["fast_uv"]), wave_fast_uv=float(ev.get("wave_fast_uv", 0.0)),
                    ))
            elif ev["type"] == "tonic_seizure":
                evo = ev["evolution"]
                dec = float(ev["decrement_s"])
                # the fast activity starts when the decrement ends
                out.append(SeizureInstance(
                    t0=float(ev["onset_min"]) * 60.0 + dec,
                    duration_s=float(ev["duration_s"]),
                    onset_region=ev["onset_region"],
                    start_hz=float(evo["start_hz"]), end_hz=float(evo["end_hz"]),
                    amp_start=float(evo["amplitude_start_uv"]), amp_end=float(evo["amplitude_end_uv"]),
                    spread=ev["spread"], postictal_s=float(ev["postictal_attenuation_s"]),
                    index=i, kind="tonic_seizure", morph="ictal",
                    muscle=ev.get("muscle", "clinical"),
                    decrement_s=dec, decrement_depth=float(ev["decrement_depth"]),
                ))
        # per-run muscle setting for the ordinary seizure kinds
        for z in out:
            if z.kind in ("seizure", "seizure_cluster", "status_epilepticus"):
                z.muscle = str(self.spec["events"][z.index].get("muscle") or "modest")
        out.sort(key=lambda z: z.t0)
        self.seizures = out
        self.ictal = [z for z in out if z.kind != "rhythmic_pattern"]
        self.rhythmic_patterns = [z for z in out if z.kind == "rhythmic_pattern"]
        # electrodecrements: (start, end, depth)
        self._decrements: List[Tuple[float, float, float]] = []
        for z in out:
            if z.decrement_s <= 0:
                continue
            if z.kind == "spasm":
                start = z.t0 + 0.55 * z.duration_s
                self._decrements.append((start, start + z.decrement_s, z.decrement_depth))
            elif z.kind == "tonic_seizure":
                self._decrements.append((z.t0 - z.decrement_s, z.t0 + 0.4, z.decrement_depth))

    def decrement_envelope(self, t: np.ndarray) -> np.ndarray:
        """Diffuse voltage attenuation tied to spasms and tonic seizures, 0..1."""
        env = np.ones_like(t)
        for start, end, depth in getattr(self, "_decrements", []):
            if end < t[0] - 1.0 or start > t[-1] + 1.0:
                continue
            shape = smoothstep((t - start) / 0.25) * (1.0 - smoothstep((t - end) / 0.6))
            env *= 1.0 - depth * shape
        return env

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
        min_cycles = int(ev.get("min_cycles") or 0)         # EEG Atlas P5 opt-in
        modifier = str(ev.get("modifier") or "").lower()
        plus = str(ev.get("plus_modifier") or "").lower()
        morph = "periodic" if ev.get("periodic") else "rda"
        plus_fast = 0.30 if ("+f" in plus or "fast" in plus) else 0.0
        fluct = float(ev.get("fluctuation", 0.45 if "fluctuat" in modifier else 0.15))
        rate_jitter = float(ev.get("rate_jitter", 0.0))     # 0.4.0: run-to-run repetition-rate wander
        duty_gap = 0.55 if "intermittent" in modifier else 0.30

        pat = str(ev.get("pattern") or "").upper()
        # Bilateral INDEPENDENT periodic discharges need two generators with
        # their own clocks: one per hemisphere, at slightly different rates,
        # with independent run timing.  Same for BIRDA.
        if pat.startswith(("BIPD", "BIRD")):
            hemi = {"left_hemisphere": ("left_hemisphere",), "right_hemisphere": ("right_hemisphere",)}
            region = ev["onset_region"]
            if region in ("left_hemisphere", "right_hemisphere", "left_temporal", "right_temporal"):
                base_regions = [region.replace("left", "right") if region.startswith("left") else region.replace("right", "left"), region]
            else:
                base_regions = ["left_temporal", "right_temporal"]
            generators = [(base_regions[0], 0.88, substream(self.seed, "rpp", i, "L")),
                          (base_regions[1], 1.12, substream(self.seed, "rpp", i, "R"))]
        else:
            generators = [(ev["onset_region"], 1.0, rng)]

        out: List[SeizureInstance] = []
        for gi, (region, fmul, grng) in enumerate(generators):
            t = float(ev["onset_min"]) * 60.0 + (0.0 if gi == 0 else float(grng.uniform(0.0, run * 0.5)))
            end = float(ev["onset_min"]) * 60.0 + float(ev["duration_min"]) * 60.0
            k = 0
            while t < end - 1.0 and k < 4000:
                dur = run * float(_lognorm(grng, 1, 0.18)[0])
                if min_cycles:
                    dur = max(dur, min_cycles / (f0 * fmul))
                # 0.4.0 (spec_version 2): no fragment run at the end of the pattern window.
                # Truncating the last run to whatever is left put a 1.6 s "LPD run" in
                # C25's answer key; a run that cannot fit its cycles is not started.
                if self.spec_version >= 2 and end - t < ((min_cycles / (f0 * fmul)) if min_cycles else 2.0):
                    break
                dur = min(dur, end - t)
                # drawn only when asked for, so version-1 specs keep their RNG stream
                fj = float(np.clip(1.0 + rate_jitter * grng.normal(), 0.7, 1.3)) if rate_jitter > 0 else 1.0
                out.append(SeizureInstance(
                    t0=t, duration_s=dur, onset_region=region,
                    start_hz=f0 * fmul * fj, end_hz=f0 * fmul * fj, amp_start=amp, amp_end=amp,
                    spread="none", postictal_s=0.0, index=i, ordinal=k * len(generators) + gi,
                    kind="rhythmic_pattern", morph=morph, fluctuate=fluct,
                    plus_fast=plus_fast,
                ))
                t += dur + max(run * duty_gap * float(_lognorm(grng, 1, 0.3)[0]), 3.0)
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

    #: Field of the spasm slow wave: vertex and central-parietal maximum with
    #: a large posterior deflection, smaller frontally.
    _SPASM_FIELD = {"Cz": 1.0, "Pz": 1.0, "P3": 0.95, "P4": 0.95, "C3": 0.9, "C4": 0.9,
                    "O1": 0.85, "O2": 0.85, "T5": 0.7, "T6": 0.7, "Fz": 0.7,
                    "F3": 0.6, "F4": 0.6, "T3": 0.5, "T4": 0.5,
                    "Fp1": 0.4, "Fp2": 0.4, "F7": 0.4, "F8": 0.4}

    def _spasm_rows(self, inst: SeizureInstance, t: np.ndarray) -> np.ndarray:
        """One epileptic spasm: the slow-wave transient plus the decrement's fast activity.

        The high-voltage slow wave (``amplitude_start_uv`` peak-to-peak, ~0.8 s,
        vertex maximum, positive-negative-positive) carries a little
        superimposed fast activity; the diffuse electrodecrement that follows
        is applied to the background in ``segment`` and here gets its
        low-voltage 16-22 Hz fast activity (``fast_uv``).
        """
        d = t - inst.t0
        dur = max(inst.duration_s, 0.3)
        # main negative deflection at ~45% of the wave, flanked by smaller positive phases
        wave = (-1.0 * np.exp(-0.5 * ((d - 0.45 * dur) / (0.17 * dur)) ** 2)
                + 0.42 * np.exp(-0.5 * ((d - 0.12 * dur) / (0.10 * dur)) ** 2)
                + 0.50 * np.exp(-0.5 * ((d - 0.85 * dur) / (0.16 * dur)) ** 2))
        rng = substream(self.seed, "spasm", inst.index, inst.ordinal)
        jitter = float(_lognorm(rng, 1, 0.2)[0])
        # amplitude_uv is peak-to-peak; the shape above spans ~1.5 units
        slow = wave * (inst.amp_start / 1.5) * jitter
        # Cerebral beta (18-26 Hz) riding the delta deflection, peaking with
        # it; ``wave_fast_uv`` peak-to-peak.  Not muscle.
        f_wave = rng.uniform(18.0, 26.0)
        fast_on = (0.5 * inst.wave_fast_uv * jitter
                   * np.sin(2 * np.pi * f_wave * d + rng.uniform(0, 2 * np.pi))
                   * np.exp(-0.5 * ((d - 0.5 * dur) / (0.28 * dur)) ** 2))
        field = np.array([self._SPASM_FIELD.get(e, 0.0) for e in self.electrodes])
        rows = np.outer(field, slow + fast_on)
        if inst.fast_uv > 0 and inst.decrement_s > 0:
            start = inst.t0 + 0.55 * dur
            w = smoothstep((t - start) / 0.3) * (1.0 - smoothstep((t - (start + inst.decrement_s)) / 0.5))
            f_hz = rng.uniform(16.0, 22.0)
            fast = 0.5 * inst.fast_uv * w * np.sin(2 * np.pi * f_hz * d + rng.uniform(0, 2 * np.pi))
            gen = np.array([0.7 + 0.3 * self._SPASM_FIELD.get(e, 0.0) for e in self.electrodes])
            rows += np.outer(gen, fast)
        return rows

    def _build_multifocal_spikes(self) -> None:
        """Independent multifocal spikes/sharp waves (hypsarrhythmia), drawn once."""
        self._mf_spikes = None
        ms = self.bg.get("multifocal_spikes") or {}
        rate = float(ms.get("rate_per_s", 0.0) or 0.0)
        amp = float(ms.get("amplitude_uv", 0.0) or 0.0)
        if rate <= 0 or amp <= 0:
            return
        # Erratic multifocal discharges: six independent LPD-like generators
        # across both hemispheres, each with its own irregular clock.  These
        # reuse the periodic-discharge complex below rather than a separate,
        # broader spike kernel, so they remain discrete on a 15-second page.
        # ``rate_per_s`` is the head-wide total; per focus it is rate / 6.
        rng = substream(self.seed, "multifocal")
        span = self.duration_s + 120.0
        # Foci sit INSIDE a longitudinal bipolar chain (an electrode that
        # appears in two derivations), so every discharge shows a phase
        # reversal about its electrode on the reading montage.  Chain ends
        # (Fp1/Fp2, O1/O2, Fz, Pz) cannot reverse and are excluded.
        # (Fp1/O1 each start or end TWO chains, so counting derivations does
        # not find them; the ends are named explicitly.)
        chain_ends = {"Fp1", "Fp2", "O1", "O2", "Fz", "Pz"}
        inner = [e for e in self.scalp if e not in chain_ends] or list(self.scalp)
        scalp_idx = np.array([self._idx[e] for e in inner])
        n_foci = 6
        left = [i for i in scalp_idx if mt.POSITIONS[self.electrodes[i]][0] < -1e-6]
        right = [i for i in scalp_idx if mt.POSITIONS[self.electrodes[i]][0] > 1e-6]
        foci = list(rng.choice(left, n_foci // 2, replace=False)) + list(rng.choice(right, n_foci // 2, replace=False))
        per = rate / n_foci
        ev = []
        for fi in foci:
            n = max(1, int(span * per * 1.8))
            times = np.cumsum(_lognorm(rng, n, 0.55) / per) - 60.0
            times = times[times < span]
            m = times.size
            width = rng.uniform(0.85, 1.15, m)       # duration scale of the LPD complex
            amps = amp * _lognorm(rng, m, 0.30)
            ev.append(np.column_stack([times, np.full(m, fi, float), width, amps]))
        allev = np.vstack(ev)
        self._mf_spikes = allev[np.argsort(allev[:, 0])]

    def _multifocal_spike_rows(self, t: np.ndarray) -> np.ndarray:
        rows = np.zeros((self.n_elec, t.size))
        ev = getattr(self, "_mf_spikes", None)
        if ev is None or t.size == 0:
            return rows
        sel = ev[(ev[:, 0] > t[0] - 1.0) & (ev[:, 0] < t[-1] + 0.2)]
        for t0, fi, width, amp in sel:
            d = t - t0
            x = d / width
            live = (x >= 0.0) & (x < 1.0)
            complex_ = ((_periodic_template(x) - _PERIODIC_MEAN)
                        / _PERIODIC_RMS / _PERIODIC_PTP)
            complex_ *= live
            w = self._gen_weights(self.electrodes[int(fi)], mt.PINNED_FALLOFF)
            rows += np.outer(w, complex_ * amp)
        return rows

    def _seizure_block(self, t: np.ndarray) -> np.ndarray:
        """Sum of every ictal run overlapping ``t``; shape (n_elec, len(t))."""
        out = np.zeros((self.n_elec, t.size))
        if not self.seizures:
            return out
        for inst in self.seizures:
            if inst.t1 + inst.decrement_s < t[0] - 1.0 or inst.t0 > t[-1] + 1.0:
                continue
            if inst.morph == "spasm":
                out += self._spasm_rows(inst, t)
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
            wave = _periodic_template(x)
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

    def _ictal_gain(self, inst: SeizureInstance) -> float:
        """ICTAL_GAIN, corrected under the display amplitude reference (0.4.0)."""
        if not self.display_ref:
            return ICTAL_GAIN
        key = inst.morph if (inst.kind == "rhythmic_pattern" and inst.morph in DISPLAY_CAL) else "ictal"
        return ICTAL_GAIN / DISPLAY_CAL[key]

    def _calibrate_display(self) -> None:
        """Scale ``amp_rms`` so the background's 1-s peak-to-peak on the display montage equals ``amplitude_uv``.

        Synthesizes background only (events, blinks, graphoelements, sensor noise
        and artifacts skipped) in four fixed 60 s windows, derives the spec's
        display montage, band-passes 0.5-30 Hz like the EEG Atlas P4 estimators
        and takes the median 1-s peak-to-peak.  Burst-type backgrounds are
        measured inside their scheduled bursts, because the request means the
        bursts.  Fixed windows and a single scalar keep every later request
        window-independent.  Checked whole-record by
        tests/test_display_calibration.py (calibrate_display.py).
        """
        # background voltage is read away from the frontopolar derivations, where blinks live
        pairs = [p for p in mt.montage_pairs(self.spec.get("montage", "longitudinal_bipolar"), self.electrodes)
                 if p[1] and not any(str(e).upper().startswith("FP") for e in p)]
        if not pairs:
            return
        # The background waxes and wanes by +-20 % over minutes (slow AM, channel AM),
        # so one window would calibrate to one swing of it: four 60 s windows spread
        # over the record, pooled.  Short records use what they have.
        dur = float(self.duration_s)
        if dur >= 400.0:
            windows = [(t0, min(t0 + 60.0, dur)) for t0 in (30.0, 0.25 * dur, 0.50 * dur, 0.75 * dur)]
        else:
            windows = [(0.0, max(10.0, dur - 5.0))]
        bursty = self.bg["type"] in ("discontinuous", "excessively_discontinuous", "trace_alternant",
                                     "burst_suppression", "hypsarrhythmia")
        if bursty:
            # The request means the bursts, so measure inside scheduled bursts.  The 80th
            # percentile of all seconds that 0.4.0 shipped with sits in the interburst as
            # soon as bursts occupy less than a fifth of the record (a 2 s burst every 17 s),
            # and the scale then clipped at 4.0: P5 C03 rendered 2-3x bursts over a 10 uV
            # "flat" interburst.  Up to twelve bursts spread over the record, the first 10 s
            # of each, 0.3 s in from the edge ramps.
            inside = [(float(a), float(b)) for a, b in zip(self._burst_start, self._burst_end)
                      if a >= 0.0 and b <= dur and b - a >= 0.5]
            if inside:
                step = max(1, len(inside) // 12)
                windows = []
                for a, b in inside[::step][:12]:
                    a2, b2 = (a + 0.3, b - 0.3) if b - a >= 1.6 else (a, a + 1.0)
                    windows.append((a2, min(b2, a2 + 10.0)))
        hi = min(30.0, self.fs / 2.0 - 1.0)
        sos = sps.butter(4, [0.5, hi], btype="bandpass", fs=self.fs, output="sos")
        n = int(self.fs)
        chunks = []
        self._calibrating = True
        try:
            for t0, t1 in windows:
                _, x = self.segment(t0, t1)
                rows = sps.sosfiltfilt(sos, self.derive(x, pairs), axis=-1)
                m = rows.shape[1] // n
                if m:
                    # divide out this window's slow envelope: the record-wide median of
                    # that envelope is put back below, so the calibration targets the
                    # long-run page, not whichever swing these windows caught
                    e = float(np.mean(self.slow_am(np.linspace(t0, t1, max(8, int(t1 - t0))))))
                    chunks.append(np.ptp(rows[:, : m * n].reshape(rows.shape[0], m, n), axis=2) / max(e, 1e-6))
        finally:
            self._calibrating = False
        if not chunks:
            return
        record_env = float(np.median(self.slow_am(np.arange(0.0, max(dur, 1.0), 1.0))))
        p2p = np.concatenate(chunks, axis=1) * record_env
        measured = float(np.median(p2p))
        if measured > 1e-6:
            self.display_scale = float(np.clip(float(self.bg["amplitude_uv"]) / measured, 0.25, 4.0))
            self.amp_rms *= self.display_scale

    def _recruit_breakpoints(self, inst: SeizureInstance):
        """Log-frequency breakpoints (u_k, f_k) of a recruiting run, drawn once per run.

        Real focal seizures (P4 against CHB-MIT / Siena: 19-34 dominant-frequency
        changes per minute against our 3-9) start as low-voltage fast activity,
        slow in steps while the amplitude builds, and end in clonic bursting.
        Everything is drawn from the record seed here so a chunk boundary
        cannot change the run (test_partition_independence).
        """
        key = (inst.index, inst.ordinal)
        cache = self.__dict__.setdefault("_recruit_cache", {})
        if key in cache:
            return cache[key]
        rng = substream(self.seed, "recruit", inst.index, inst.ordinal)
        dur = max(inst.duration_s, 1.0)
        f_start, f_end = max(inst.start_hz, 0.5), max(inst.end_hz, 0.5)
        f_onset = float(np.clip(f_start * rng.uniform(2.0, 3.0), f_start * 1.5, 22.0))
        # steps every 2.5-5 s through the middle 70 % of the run; at least 4
        n_mid = max(4, int(round(0.70 * dur / float(rng.uniform(2.5, 5.0)))))
        u = np.concatenate([[0.0, 0.15], np.linspace(0.15, 0.85, n_mid + 1)[1:], [1.0]])
        logf = np.empty_like(u)
        logf[0] = math.log(f_onset)
        logf[1] = math.log(f_start)
        # mean-reverting random walk around the start->end glide (log domain)
        dev = 0.0
        for k in range(2, u.size - 1):
            frac = (u[k] - 0.15) / 0.70
            glide = math.log(f_start) + (math.log(f_end) - math.log(f_start)) * frac
            dev = 0.55 * dev + float(rng.normal(0.0, 0.16))
            logf[k] = glide + dev
        logf[-1] = math.log(f_end * float(rng.uniform(0.65, 0.85)))    # terminal slowing
        f = np.clip(np.exp(logf), 0.5, 25.0)
        # cumulative phase at each breakpoint: exact integral of a geometric glide
        cum = np.zeros_like(u)
        for k in range(1, u.size):
            du = (u[k] - u[k - 1]) * dur
            f0, f1 = f[k - 1], f[k]
            cum[k] = cum[k - 1] + (du * (f1 - f0) / math.log(f1 / f0) if abs(f1 - f0) > 1e-9 else du * f0)
        clonic_hz = float(rng.uniform(1.2, 2.2))
        clonic_ph = float(rng.uniform(0, 2 * np.pi))
        cache[key] = (u, f, cum, clonic_hz, clonic_ph)
        return cache[key]

    def _recruit_phase(self, inst: SeizureInstance, t: np.ndarray):
        dur = max(inst.duration_s, 1.0)
        u = (t - inst.t0) / dur
        live = (u >= 0.0) & (u <= 1.0)
        if not live.any():
            return None, u, None, None
        uu = np.clip(u, 0.0, 1.0)
        bu, bf, cum, clonic_hz, clonic_ph = self._recruit_breakpoints(inst)
        k = np.clip(np.searchsorted(bu, uu, side="right") - 1, 0, bu.size - 2)
        u0, u1 = bu[k], bu[k + 1]
        f0, f1 = bf[k], bf[k + 1]
        s = np.clip((uu - u0) / np.maximum(u1 - u0, 1e-9), 0.0, 1.0)
        ratio = f1 / f0
        f_inst = f0 * np.power(ratio, s)
        seg = np.where(np.abs(ratio - 1.0) > 1e-9,
                       (u1 - u0) * dur * f0 * (np.power(ratio, s) - 1.0) / np.log(np.where(np.abs(ratio - 1.0) > 1e-9, ratio, 2.0)),
                       (u1 - u0) * dur * f0 * s)
        phase = 2 * np.pi * (cum[k] + seg)
        # amplitude: quarter-voltage onset, build to amplitude_end by 75 %, fall off at the end
        a = np.interp(uu, [0.0, 0.15, 0.75, 1.0],
                      [0.25 * inst.amp_start, inst.amp_start, inst.amp_end, 0.55 * inst.amp_end])
        amp = a / 2.9 * self._ictal_gain(inst)
        ramp = 0.04
        amp = amp * smoothstep(uu / ramp) * (1.0 - smoothstep((uu - (1.0 - ramp)) / ramp))
        # clonic bursting over the last third: the run breaks into groups at 1-2 Hz
        w = smoothstep((uu - 0.68) / 0.15)
        amp = amp * (1.0 - 0.45 * w * (0.5 - 0.5 * np.cos(2 * np.pi * clonic_hz * (t - inst.t0) + clonic_ph)))
        amp = amp * (1.0 + inst.fluctuate * 0.6 * np.sin(2 * np.pi * 0.11 * uu * dur + clonic_ph))
        amp = amp * live
        return phase, uu, amp, np.clip(f_inst, 0.2, 30.0)

    def _ictal_phase(self, inst: SeizureInstance, t: np.ndarray):
        """Instantaneous phase / progress / amplitude of a log-sweeping run."""
        if inst.profile == "recruit" and inst.morph == "ictal":
            return self._recruit_phase(inst, t)
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
               / 2.9 * self._ictal_gain(inst))
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
        if t.size == 0:
            return gate
        lo, hi = float(t[0]), float(t[-1])
        for inst in self.ictal:
            if inst.morph == "spike_wave" or inst.t1 < lo - 2.0 or inst.t0 > hi + 2.0:
                continue
            factor = MUSCLE_FACTOR.get(inst.muscle, MUSCLE_FACTOR["modest"])
            if factor <= 0:
                continue
            u = (t - inst.t0) / max(inst.duration_s, 1.0)
            if inst.kind == "spasm":
                # a brief symmetric phasic contraction peaking with the slow wave
                shape = smoothstep(u / 0.2) * (1.0 - smoothstep((u - 0.5) / 0.3))
            else:
                ramp = max(min(2.0, inst.duration_s * 0.08), 0.25)
                shape = smoothstep((t - inst.t0) / ramp) * (1.0 - smoothstep((t - (inst.t1 - ramp)) / ramp))
                if inst.kind == "tonic_seizure":
                    shape = shape * (0.35 + 0.65 * smoothstep(u / 0.7))   # tonic EMG builds
                elif inst.spread not in (None, "none"):
                    # Muscle follows clinical spread, not electrographic onset:
                    # a focal-onset run recruits muscle as it generalizes.
                    shape = shape * smoothstep((u - 0.12) / 0.30)
            gate = np.maximum(gate, factor * shape)
        return gate

    def absence_gate(self, t: np.ndarray) -> np.ndarray:
        """0..1 over generalized spike-wave runs, the absence-type discharge.

        The behavioural counterpart of a generalized 3 Hz spike-wave run is
        arrest and staring, so where ``ictal_gate`` recruits muscle this one
        withdraws it (``ABSENCE_EMG_DROP``) and stops the blinks.  Rhythmic
        and periodic patterns (LPDs, LRDA) drive neither gate: they are not
        seizures and recruit nothing.
        """
        return self._run_gate(t, [z for z in self.ictal if z.morph == "spike_wave"])

    @staticmethod
    def _run_gate(t: np.ndarray, insts: Sequence[SeizureInstance]) -> np.ndarray:
        gate = np.zeros_like(t)
        if t.size == 0 or not insts:
            return gate
        lo, hi = float(t[0]), float(t[-1])
        for inst in insts:
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
        # Smooth the independent rows over the scalp (see SPATIAL_CORR_LENGTH).
        # A fixed matrix on frame-seeded rows keeps this partition-independent.
        indep = (self._spatial_mix @ rows[: self.n_elec]) * self._indep_gain(stream)
        if stream.common <= 0:
            return indep * stream.spatial[:, None]
        c = stream.common
        mixed = (math.sqrt(1.0 - c) * indep
                 + math.sqrt(c) * rows[self.n_elec][None, :])
        return mixed * stream.spatial[:, None]

    def _build_spatial_mix(self) -> np.ndarray:
        """(n_elec, n_elec) mixing that gives independent rows a smooth field.

        Rows of the Cholesky factor of a Gaussian kernel, each normalised to
        unit norm so every electrode keeps unit variance.  The amplitude
        correction that keeps bipolar derivations calibrated is per stream
        (``_indep_gain``), because it depends on the stream's spatial profile.
        """
        pos = np.array([mt.POSITIONS[e] for e in self.electrodes], float)
        d = np.hypot(pos[:, None, 0] - pos[None, :, 0], pos[:, None, 1] - pos[None, :, 1])
        self._spatial_k = np.exp(-(d / SPATIAL_CORR_LENGTH) ** 2)
        m = np.linalg.cholesky(self._spatial_k + 1e-6 * np.eye(self.n_elec))
        m /= np.sqrt((m ** 2).sum(axis=1, keepdims=True))
        # The derivations the bank's amplitudes were calibrated on: the
        # channel set's own bipolar montage (neonatal pairs are longer, so the
        # neonatal array gets a smaller correction than the 10-20 array).
        self._montage_idx = [(self._idx[a], self._idx[b])
                             for a, b in mt.montage_pairs("longitudinal_bipolar", self.scalp)
                             if b is not None and a in self._idx and b in self._idx]
        self._indep_gain_cache: Dict[str, float] = {}
        return m

    def _indep_gain(self, stream: _Stream) -> float:
        """Scalar that restores this stream's mean bipolar variance over the
        montage pairs to what independent rows gave.

        For a pair with spatial weights ``s_a, s_b`` the independent part
        contributed ``s_a^2 + s_b^2`` before; correlated rows contribute
        ``s_a^2 + s_b^2 - 2 s_a s_b k_ab``.  A single head-wide factor was
        tried first and over-corrected graded profiles (posterior rhythm,
        frontal beta) by up to 2x in variance, because where one weight
        dominates nothing cancels and there is nothing to restore.
        """
        g = self._indep_gain_cache.get(stream.name)
        if g is None:
            s, k = stream.spatial, self._spatial_k
            before = after = 0.0
            for a, b in self._montage_idx:
                before += s[a] ** 2 + s[b] ** 2
                after += s[a] ** 2 + s[b] ** 2 - 2.0 * s[a] * s[b] * k[a, b]
            g = math.sqrt(before / after) if after > 1e-12 and before > 1e-12 else 1.0
            self._indep_gain_cache[stream.name] = g
        return g

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

    def _artifact_schedule(self, ev: Dict, kind: str):
        """Bout / burst timetable of a model-2 artifact over its own window, drawn once.

        patting: bouts of 3-8 s of patting separated by 1-4 s pauses, each bout
        at its own rate (a parent's hand is not a metronome; Craig, P5 C12).
        chewing: individual chews 0.25-0.4 s long at irregular ~0.75 s
        intervals grouped into bouts, as on the EEG Atlas chewing page (P5 C16).
        """
        k = next((j for j, e in enumerate(self.artifacts) if e is ev), 0)
        cache = self.__dict__.setdefault("_art_sched", {})
        if k in cache:
            return cache[k]
        rng = substream(self.seed, "artsched", k)
        a0, a1 = self._event_window(ev)
        bouts: List[Tuple[float, float, float]] = []      # (start, end, rate_hz)
        t = a0
        f_base = float(ev.get("frequency_hz", 1.9 if kind == "patting" else 1.35))
        while t < a1:
            on = float(np.clip(rng.lognormal(math.log(5.0), 0.35), 3.0, 8.0)) if kind == "patting" else float(np.clip(rng.lognormal(math.log(6.0), 0.4), 3.0, 12.0))
            off = float(np.clip(rng.lognormal(math.log(2.0), 0.5), 1.0, 4.0))
            bouts.append((t, min(t + on, a1), f_base * float(np.clip(rng.normal(1.0, 0.12), 0.75, 1.25))))
            t += on + off
        chews: List[Tuple[float, float]] = []               # (start, duration) of single chews
        if kind == "emg_chewing":
            for b0, b1, fr in bouts:
                tc = b0
                while tc < b1:
                    chews.append((tc, float(np.clip(rng.normal(0.32, 0.05), 0.22, 0.45))))
                    tc += float(np.clip(rng.lognormal(math.log(1.0 / fr), 0.22), 0.4, 1.6))
        cache[k] = (bouts, chews)
        return cache[k]

    def _artifact_waveform_v2(self, kind: str, ev: Dict, t: np.ndarray, i0: int, gain: float):
        n = t.size
        bouts, chews = self._artifact_schedule(ev, kind)
        if kind == "patting":
            sig = np.zeros(n)
            for b0, b1, fr in bouts:
                edge = np.clip(np.minimum((t - b0) / 0.4, (b1 - t) / 0.4), 0.0, 1.0)
                gate = 0.5 - 0.5 * np.cos(np.pi * edge)
                ph = 2 * np.pi * fr * (t - b0)
                # a pat is a sharp mechanical transient with a slow rebound, not a sine
                w = np.sin(ph) + 0.55 * np.sin(2 * ph + 0.4) + 0.30 * np.sin(3 * ph + 1.1) + 0.12 * np.sin(4 * ph + 0.7)
                sig += gate * w
            return sig * 90.0 * gain / 1.35
        if kind == "emg_chewing":
            base = self._oa(self.st_emg, i0, n, 1)[0]
            env = np.zeros(n)
            slow = np.zeros(n)
            for c0, cd in chews:
                d = (t - c0) / cd
                m = (d > 0) & (d < 1)
                env[m] += np.sin(np.pi * d[m]) ** 1.5
                # glossokinetic / jaw slow wave under each chew, frontotemporal
                ms = (d > -0.2) & (d < 1.6)
                slow[ms] += np.exp(-0.5 * ((d[ms] - 0.6) / 0.45) ** 2)
            emg = base * np.clip(env, 0.0, 1.5) * 48.0 * gain
            rows = np.zeros((self.n_elec, n))
            temporal = _profile(self.electrodes, _TEMPORAL, 0.15)
            frontal = _profile(self.electrodes, _ANTERIOR, 0.1)
            for i in range(self.n_elec):
                rows[i] = emg * (0.12 + 0.88 * temporal[i]) - slow * 14.0 * gain * (0.4 * frontal[i] + 0.6 * temporal[i])
            return rows
        return None

    def _artifact_waveform(self, kind: str, ev: Dict, t: np.ndarray, i0: int,
                           rng: np.random.Generator, gain: float):
        n = t.size
        fs = self.fs

        model = int(ev.get("model", 1) or 1)
        if model >= 2 and kind in ("emg_chewing", "patting"):
            return self._artifact_waveform_v2(kind, ev, t, i0, gain)

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
            if self.spec_version >= 2:
                # same blink as the spontaneous ones (shape, field, 160 uV default)
                prof = self._blink_profile(t, np.asarray(times)) * float(self.bg.get("blink_amplitude_uv", BLINK_UV)) * gain
                field = self._blink_field()
                for i in range(self.n_elec):
                    rows[i] = prof * field[i]
                return rows
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
        # Each beat touches ~0.5 s of signal, so work on that slice instead of
        # the whole request: the full-array version was O(beats x samples) and
        # cost more than all 21 EEG channels together (50 s per recorded hour).
        # The slice is found generously with searchsorted and the ORIGINAL
        # elementwise mask is then applied inside it, so every value that is
        # added, and the order it is added in, is unchanged - the output is
        # bit-identical to the previous loop.
        for b in beats:
            i0 = max(0, int(np.searchsorted(t, b - 0.10, side="left")) - 1)
            i1 = min(t.size, int(np.searchsorted(t, b + 0.40, side="right")) + 1)
            if i1 <= i0:
                continue
            d = t[i0:i1] - b
            m = (d > -0.10) & (d < 0.40)
            if not m.any():
                continue
            dd = d[m]
            qrs = (-0.25 * np.exp(-0.5 * (dd / 0.012) ** 2)
                   + 1.00 * np.exp(-0.5 * ((dd - 0.020) / 0.011) ** 2)
                   - 0.35 * np.exp(-0.5 * ((dd - 0.048) / 0.018) ** 2)
                   + 0.22 * np.exp(-0.5 * ((dd - 0.190) / 0.045) ** 2))
            window = prof[i0:i1]
            window[m] += qrs
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
            x += self._stream_signal(self.st_pdr, i0, n) * (0.62 * self.pdr_gain * pdr_w)[None, :]
            x += self._stream_signal(self.st_theta, i0, n) * (0.30 + 0.25 * sleep)[None, :]
        else:
            x += self._stream_signal(self.st_theta, i0, n) * 0.22

        delta_w = 0.14 + 0.85 * self.slow_fraction + 0.45 * sleep + 0.70 * temp_slow
        x += self._stream_signal(self.st_delta, i0, n) * delta_w[None, :]
        x += self._stream_signal(self.st_beta, i0, n) * beta_w[None, :] * self._breach_fast[:, None]

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
        # An electrodecrement (spasm, tonic onset) silences the muscle floor
        # too: the child is still, and the page must actually flatten.
        dec = self.decrement_envelope(t)
        # 0.4.1 (Craig, P5 C08 "shouldn't have fast muscle"): an unreactive patient - sedated,
        # paralysed, post-anoxic - has no tonic muscle, inside bursts included.  Version 2 only.
        unreactive = self.spec_version >= 2 and self.bg.get("reactivity") == "absent"
        emg_w = ((0.0 if unreactive else EMG_FLOOR_W) * (1.0 - 0.75 * sleep) * self.burst_envelope(t)
                 * (1.0 + self.ictal_gate(t))
                 * (1.0 - ABSENCE_EMG_DROP * self.absence_gate(t))
                 * dec
                 # an infant's temporalis floor is a fraction of a child's
                 * (0.45 if self.age == "infant" else 1.0))
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
        if not self.display_ref:      # 0.4.0 display reference: the author states the on-screen voltage
            x *= preset_scale

        # Per-electrode burst envelope (edge lag + regional tilt); ``env`` below
        # carries the head-wide factors and is what the blink gate reuses.
        burst_rows = self.burst_envelope_rows(t)
        env = self.slow_am(t)
        env = env * self.postictal_envelope(t)
        env = env * np.clip(0.70 + 0.09 * (temp - 33.0), 0.55, 1.06)
        env = env * amp_w
        env = env * self.cape_envelope(t)
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
        # Electrodecrements (spasms, tonic seizures) attenuate the background
        # and its graphoelements; the ictal block below is added after.
        env = env * dec
        x *= burst_rows * env[None, :]
        # Head-wide envelope including the burst gate, for the blinks below.
        env = env * self.burst_envelope(t)

        bs = self.bg["burst_suppression"]
        discharge_count = 0 if self._calibrating else int(bs.get("epileptiform_discharges", 0))
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
        if self._calibrating:
            return t, x            # background only: what the display calibration measures
        x += self._seizure_block(t)
        # multifocal spikes (hypsarrhythmia), attenuated through a decrement
        x += self._multifocal_spike_rows(t) * (dec * self.burst_envelope(t))[None, :] * self._ch_gain[:, None]

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
        # A staring absence does not blink; see ABSENCE_EMG_DROP.
        x += self.blink_rows(t, (1.0 - sleep) * env * (1.0 - self.absence_gate(t)))
        # Neonatal graphoelements (microvolts; burst-bound ones gated inside).
        if self.age == "neonate":
            x += self.graphoelement_rows(t) * self._ch_gain[:, None]
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
