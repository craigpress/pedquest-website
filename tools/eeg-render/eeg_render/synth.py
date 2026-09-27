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
from . import state_v3 as sv3
from . import variants_v3 as vv3
from . import rpp_v3 as rpp3
from . import generalized_v3 as gv3

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
#: 0.5.0 neonatal burst composition (spec_version 3; weights in background-RMS units beside the delta stream):
#: theta 4-7 Hz and a small 8-20 Hz stream, tuned so the displayed relative delta (0.5-4 / 0.5-30 Hz) of a term
#: record falls from 0.93-0.96 to ~0.8 with theta >= 0.1 (feature review, neonatal item 5)
NEO_THETA_W = 0.95
NEO_FAST_W = 0.20
#: phase D (neonatal-v3): high-voltage 0.5-1.5 Hz delta of mature quiet sleep (background-RMS units at full weight).
#: Trace-alternant bursts carry isolated 100+ uV slow waves over a flatter interburst (ACNS 2013 Fig. 2b; learningeeg
#: 4-day term quiet sleep), and past term quiet sleep is continuous high-voltage slow-wave sleep (ACNS: 50-150 uV)
NEO_SWS_W = 2.0
NEO_SWS_THETA_W = 0.9          # burst-only
NEO_SWS_THETA_IB_W = 0.5       # with the interburst theta floor
NEO_SWS_FAST_W = 0.5

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
#: 0.5.0 burst suppression (feature review C21, learningeeg L4): bursts start abruptly (40 ms rise, 30 ms lag)
BURST_EDGE_BS_V3 = (0.04, 0.35, 0.03, 0.08, 0.0)

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
#: 0.5.0 polymorphic focal delta weight (background-RMS units at the side's maximum, full slowing_hz >= 3)
POLYDELTA_W = 1.0
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
# 0.5.0 (spec_version 3): periodic discharge in SECONDS
# --------------------------------------------------------------------------
# Feature review 2026-09-26 (C26/C27): ``_periodic_template`` is defined in
# fractions of a cycle, so the sharp phase measured FWHM 138 ms at 0.5 Hz, 69 ms
# at 1 Hz and 34 ms at 2 Hz.  A discharge keeps its duration whatever its
# repetition rate (PLEDs.webp: narrow sharp, long flat interval at 0.75 Hz), so
# the v3 complex is a function of seconds from the sharp peak and the period
# only adds baseline.  The numbers are the 1-Hz template's (which C25 passed),
# with an asymmetric sharp phase (rise 30 ms, fall 50 ms; with the dip and the 1-Hz display high-pass the displayed
# sharp phase measures FWHM 55-66 ms at 0.5, 1 and 2 Hz, against about 59-70 ms for the accepted 1-Hz C25).
_PD_RISE, _PD_FALL = 0.030, 0.050
_PD_DIP_LAG, _PD_DIP_SIGMA, _PD_DIP_GAIN = 0.080, 0.045, 0.55
_PD_WAVE_LAG, _PD_WAVE_SIGMA, _PD_WAVE_GAIN = 0.300, 0.130, 0.42
_PD_AMP_VAR, _PD_WIDTH_VAR = 0.25, 0.20     # +/- per-cycle amplitude and width (C26: identical stamps)


def _pd_kernel(tau: np.ndarray, width: float | np.ndarray = 1.0) -> np.ndarray:
    """One periodic discharge (same polarity as ``_periodic_template``); ``tau`` is seconds from the sharp peak."""
    sig = np.where(tau < 0.0, _PD_RISE, _PD_FALL) * width
    return (np.exp(-0.5 * (tau / sig) ** 2)
            - _PD_DIP_GAIN * np.exp(-0.5 * ((tau - _PD_DIP_LAG * width) / (_PD_DIP_SIGMA * width)) ** 2)
            + _PD_WAVE_GAIN * np.exp(-0.5 * ((tau - _PD_WAVE_LAG) / _PD_WAVE_SIGMA) ** 2))


def _pd_cycle(tau: np.ndarray, period: np.ndarray, k: Optional[np.ndarray] = None,
              salt: int = 0) -> np.ndarray:
    """The discharge plus its neighbours (the slow wave outlasts a 2-4 Hz cycle), jittered per absolute cycle."""
    out = np.zeros_like(tau)
    for n in (-1, 0, 1, 2, 3):
        if k is None:
            out = out + _pd_kernel(tau + n * period)
            continue
        kk = k - n
        amp = 1.0 + (_cycle_noise(kk, salt + 131) - 0.5) * (2.0 * _PD_AMP_VAR)
        wid = 1.0 + (_cycle_noise(kk, salt + 137) - 0.5) * (2.0 * _PD_WIDTH_VAR)
        out = out + amp * _pd_kernel(tau + n * period, wid)
    return out


def _pd_norm() -> tuple:
    """Per-frequency mean and peak-to-peak of the unjittered cycle, interpolated at use (partition-independent)."""
    freqs = np.geomspace(0.2, 8.0, 128)
    means = np.empty_like(freqs)
    ptps = np.empty_like(freqs)
    for i, f in enumerate(freqs):
        period = 1.0 / f
        tau = np.linspace(-0.5 * period, 0.5 * period, 4096, endpoint=False)
        v = _pd_cycle(tau, np.full_like(tau, period))
        means[i] = v.mean()
        ptps[i] = float(np.ptp(v)) or 1.0
    return freqs, means, ptps


_PD_FREQS, _PD_MEANS, _PD_PTPS = _pd_norm()

#: 0.5.0 (spec_version 3): ACNS 2021 rhythmic-delta / periodic-discharge band for a rhythmic_pattern authored inside
#: it, and the largest in-run frequency drift as a FRACTION of the run rate (it was an absolute ~0.2-0.6 Hz)
_RPP_BAND = (0.5, 4.0)
_RPP_DRIFT = 0.05


# 0.5.0 (spec_version 3): polyspike as discrete biphasic spikes.  Feature review B5-04: three summed monophasic
# spikes left the inter-spike valleys at 0.44-0.55 of the peak, so the complex read as one notched 97-ms sharp wave
# (Craig: "merged on a sharp wave").  eeg0094_db1.png and myoclonic-jerk-examples/p1.webp show 4-8 spikes at
# 55-80 ms intervals, each swinging through the baseline, then a slow wave.
_PS_RISE, _PS_FALL = 0.007, 0.010          # s, negative spike limbs (surface sign applied by the caller)
# 0.5.0 phase D (epileptiform-v3.md change 1: the 0.5-0.7 x 14-ms trough made each spike one cycle of a 16-Hz sine
# and the after-going wave measured 0.41x the spike train): a smaller, broader trough (0.20-0.35 x 22 ms, drawn in
# generalized_v3.polyspike_draw) and a slow wave at least as large as the spikes after the 1-Hz display high-pass
_PS_TROUGH_LAG, _PS_TROUGH_SIGMA = 0.032, 0.022
_PS_WAVE_LAG, _PS_WAVE_SIGMA, _PS_WAVE_GAIN = 0.160, 0.100, 2.2


def _polyspike_kernel(d: np.ndarray, lags: np.ndarray, gains: np.ndarray, troughs: np.ndarray,
                      width: float, aftergoing: bool) -> np.ndarray:
    """Spikes at ``lags`` (s) with heights ``gains``, each followed by an opposite trough, then the slow wave.

    Returned with the spike phase POSITIVE; ``_sed_kernel`` negates it like the single spike.
    """
    k = np.zeros_like(d)
    for c, g, tr in zip(lags, gains, troughs):
        x = d - c
        k = k + g * (np.exp(-0.5 * (x / np.where(x < 0.0, _PS_RISE * width, _PS_FALL * width)) ** 2)
                     - tr * np.exp(-0.5 * ((x - _PS_TROUGH_LAG * width) / (_PS_TROUGH_SIGMA * width)) ** 2))
    if aftergoing:
        k = k + _PS_WAVE_GAIN * np.exp(-0.5 * ((d - (float(lags[-1]) + _PS_WAVE_LAG)) / _PS_WAVE_SIGMA) ** 2)
    return k


def _polyspike_unit_ptp(width: float = 1.0, trough: float = 0.6) -> float:
    """Peak-to-peak of ONE biphasic spike: what ``amplitude_uv`` names for a v3 polyspike."""
    d = np.linspace(-0.05, 0.1, 1501)
    return float(np.ptp(_polyspike_kernel(d, np.array([0.0]), np.array([1.0]), np.array([trough]), width, False)))


_PS_UNIT_PTP = _polyspike_unit_ptp(1.0, 0.28)


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
    #: 0.5.0 (spec_version 3): "+S" - sharp transients embedded in rhythmic delta, relative to the delta amplitude
    plus_sharp: float = 0.0
    #: frequency/amplitude trajectory: ``sweep`` (0.3.x log glide) or ``recruit``
    #: (0.4.0: low-voltage fast onset, stepwise slowing, build-up, late clonic bursting)
    profile: str = "sweep"
    #: 0.5.0: clinical correlate with a clonic phase (focal_clonic, generalized_tonic_clonic) - the ictal EMG
    #: comes in bursts time-locked to the run's clonic modulation instead of as a continuous floor
    clonic: bool = False
    #: 0.5.0 phase D (spec_version 3): resolved onset pattern of a recruiting run (lvfa / rhythmic_theta /
    #: electrodecrement / rhythmic_spikes; "" before v3), the keyed clinical correlate, and for spasms the side of
    #: an asymmetric spasm and the seconds of tonic contraction
    onset_pattern: str = ""
    correlate: str = ""
    side: str = "both"
    tonic_s: float = 0.0
    #: 0.5.0 phase D (spec_version 3): generalized RPP field predominance (frontal / occipital / none); "" = legacy
    predominance: str = ""
    #: 0.5.0 phase D: ACNS rhythmic/periodic run configuration built by ``rpp_v3.schedule`` (None = phase-B path)
    rpp: Optional[Dict] = None

    @property
    def t1(self) -> float:
        return self.t0 + self.duration_s


# spatial profile presets ---------------------------------------------------

def _profile(channels: Sequence[str], weights: Dict[str, float], default: float) -> np.ndarray:
    return np.array([mt.table_value(weights, ch, default) for ch in channels], float)


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
_PDR_FIELD_V3 = {
    "O1": 1.00, "O2": 1.00, "P3": 0.40, "P4": 0.40, "Pz": 0.42, "T5": 0.50, "T6": 0.50,
    "T3": 0.12, "T4": 0.12, "C3": 0.10, "C4": 0.10, "Cz": 0.10,
    "F3": 0.04, "F4": 0.04, "Fz": 0.04, "F7": 0.04, "F8": 0.04, "Fp1": 0.03, "Fp2": 0.03,
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
#: 0.5.0: relaxed scalp muscle is frontalis / temporalis.  Digitized against learningeeg 5-year-old awake figures,
#: the parasagittal chains carried 3-4x the reference's fast "fuzz" while the temporal chains matched, so the
#: parasagittal and posterior weights drop and the temporal / frontopolar ones stay.
_MUSCLE_V3 = {
    "T3": 1.00, "T4": 1.00, "F7": 0.95, "F8": 0.95,
    "T5": 0.60, "T6": 0.60, "Fp1": 0.45, "Fp2": 0.45,
    "F3": 0.25, "F4": 0.25, "Fz": 0.20,
    "C3": 0.12, "C4": 0.12, "Cz": 0.10,
    "P3": 0.10, "P4": 0.10, "Pz": 0.08, "O1": 0.15, "O2": 0.15,
}
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
        self._build_sporadic()
        self._build_variants()
        self._build_authored_variants()
        self._gen = None
        self._collect_seizures()
        if self.spec_version >= 3 and any(e["type"] in ("generalized_seizure", "generalized_discharges", "tonic_seizure")
                                          for e in spec["events"]):
            # 0.5.0 phase D: generalized seizures and generalized interictal patterns (generalized_v3.py)
            self._gen = gv3.GeneralizedV3(self)
        self.artifacts = [e for e in spec["events"]
                          if e["type"] == "artifact" and self._artifact_eligible(e)]
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
        # 0.5.0 slow-wave sleep: high-voltage 0.5-2 Hz waves with a frontal maximum, gated by N3 (normal-variants
        # re-review: 0-1 % of N3 had >= 75 uV 0.5-2 Hz waves against the > 20 % AASM scoring needs)
        self.st_sws = (self._mk("sws", band_shape(f, 1.0, 1.2, order=1.0), _profile(ch, _ANTERIOR, 0.3), common=0.35)
                       if self.spec_version >= 3 else None)
        # 0.4.0 (Craig, P5 C13): a focal posterior field for the dominant rhythm keeps it
        # occipito-parietal instead of leaking into central and frontal derivations
        post_pdr = np.power(post, 2.2) if self.bg.get("pdr_field") == "focal" else post
        if self.spec_version >= 3:
            # 0.5.0 (feature review: C3-P3 alpha 0.87-0.99 of P3-O1): occipital maximum with a steep parietal fall, so
            # longitudinal bipolar shows the PDR best in P3-O1 / T5-O1 and about half of it in C3-P3
            post_pdr = _profile(ch, _PDR_FIELD_V3, 0.03)
        self.st_pdr = self._mk("pdr", band_shape(f, self.dominant_hz, 1.45), post_pdr, common=0.65)
        self.st_pdr_slow = self._mk(
            "pdrslow",
            band_shape(f, max(0.8, self.dominant_hz - float((self.bg.get("asymmetry") or {}).get("slowing_hz") or 2.0)), 1.1),
            post, common=0.6,
        )
        self.st_beta = self._mk("beta", band_shape(f, 17.5, 4.0, order=1.0), ant, common=0.4)
        self.st_sed_alpha = self._mk("sed_alpha", band_shape(f, 10.5, 1.8), ant, common=0.65)
        self.st_sed_gamma = self._mk("sed_gamma", band_shape(f, 35.0, 7.0, order=1.0), near_uniform, common=0.25)
        spindle_hz = float((self.spec.get("style") or {}).get("spindle_hz", 13.0))
        self.st_spindle = self._mk("spindle", band_shape(f, spindle_hz, 0.65), cen, common=0.7)
        self.st_brush = self._mk("brush", band_shape(f, 13.0, 4.5, order=1.0), cen * 0.6 + temp * 0.5, common=0.35)
        self.st_theta = self._mk("theta", band_shape(f, 5.0, 1.8, order=1.0), temp * 0.6 + cen * 0.5, common=0.5)
        self.st_emg = self._mk("emg", hp_lp_shape(f, 22.0, 95.0), temp, common=0.15)
        if self.spec_version >= 3:
            # 0.5.0 sedation streams (seeded by name, so adding them moves no other stream).  Benzodiazepine beta is
            # diffuse (learningeeg: dominates every chain), so part anterior, part uniform, with less shared component
            # than a uniform field would need to survive the bipolar chain.
            # phase D (sedation-v3 S109-03): 0.55 anterior left P3-O1/P4-O2/T5-O1 clearly quieter, while the benzodiazepine
            # beta in R1 is full size in the posterior chains too
            self.st_sed_beta = self._mk("sed_beta3", band_shape(f, 16.5, 3.0, order=1.0), 0.2 * ant + 0.8 * near_uniform,
                                        common=0.35)
            self.st_barb = self._mk("sed_barb", band_shape(f, 14.5, 2.0), 0.6 * ant + 0.4 * near_uniform, common=0.35)
            # phase D (sedation-v3 S109-05): a Gaussian 25-32 Hz band (the super-Gaussian 2.6-Hz band drew
            # near-sinusoidal 28-Hz packets that read as fast spindles)
            self.st_gamma3 = self._mk("sed_gamma3", band_shape(f, 28.5, 3.2, order=1.0), near_uniform, common=0.2)
            # phase D (sedation-v3 S109-06): the 2.2-Hz Lorentzian kept half its peak weight at DC, so every abrupt
            # burst offset cut a slow offset and left the same 1-Hz LFF exponential tail on every chain; the burst
            # delta now has no sub-Hz content (second-order 1 Hz high-pass on the same band)
            # phase D (neonatal-v3): quiet-sleep slow waves, v3 neonates only (seeded by name: no other stream moves)
            self.st_neo_sws = (self._mk("neo_sws", band_shape(f, 0.9, 0.45, order=1.0) * hp_lp_shape(f, 0.35, 60.0),
                                        near_uniform, common=0.35) if self.age == "neonate" else None)
            self.st_burst = self._mk("sed_burst", band_shape(f, 2.2, 2.4, order=1.0) * hp_lp_shape(f, 1.0, 60.0),
                                     near_uniform, common=0.3)
        if self.bg["type"] == "hypsarrhythmia":
            # "no topographical distribution, no frequency or amplitude
            # gradient": the slow activity is asynchronous between regions, so
            # the head-wide shared component is cut for the slow streams.
            for st in (self.st_broad, self.st_delta, self.st_theta):
                st.common = 0.12
        # tonic floor gets its own, broader field; st_emg stays peaked for artifacts
        musc = _profile(ch, _MUSCLE_V3 if self.spec_version >= 3 else _MUSCLE, 0.30)
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
        self.st_polydelta = None
        if self.spec_version >= 3 and float(self.slow_side.max()) > 0:
            # 0.5.0 (feature review C32: the "slowed" side was only attenuated, delta fraction F7-T3 0.57 vs F8-T4
            # 0.62): polymorphic delta - broadband 1-3 Hz with no dominant peak, mostly independent per electrode -
            # on the affected side (tinc-left-temporal-slowing.webp, tinyc-Right-Temporal-Polymorphic-Delta-Slowing)
            side = self.slow_side / float(self.slow_side.max())
            for e in mt.REFERENCE_ELECTRODES:
                side[self._idx[e]] = 0.0
            self.st_polydelta = self._mk("polydelta", bg_shape(f, 1.0) * hp_lp_shape(f, 1.0, 3.2), side, common=0.15)

        # P7 batch 2: breach effect - over a skull defect the background is larger and carries
        # more sharply contoured fast activity (Niedermeyer: 2-3x amplitude, beta accentuated)
        self._breach_fast = np.ones(self.n_elec)
        self._breach_gain = None
        br = self.bg.get("breach")
        if br and self.spec_version >= 3:
            # 0.5.0 (feature review B2-04, learningeeg L5): the defect is a plateau over a region - the focus and
            # its neighbours in the longitudinal chain unless ``breach.region`` names them - weight 1.0 across it and
            # a 0.3 falloff outside.  The single-electrode monopole made the two derivations sharing C3 mirror
            # images (r = -0.59) and leaked x1.5 into T3.  The gain is applied to cerebral activity only in
            # segment(): a skull defect does not amplify scalp muscle.  Inside the plateau every derivation carries
            # the full requested gain, so there is no bipolar-dilution factor.
            w = self._breach_plateau(br)
            self._breach_gain = 1.0 + (float(br.get("gain", 2.0)) - 1.0) * w
            self._breach_fast = 1.0 + (float(br.get("fast_gain", 2.5)) - 1.0) * w
        elif br:
            w = self._gen_weights(str(br["focus"]))      # monopole field around the defect (neighbours ~0.24)
            # ``gain`` is what the reader measures on the bipolar display montage: a derivation of two
            # partially correlated electrodes (spatial kernel 0.65) dilutes a referential gain, so the
            # focus electrode is raised by 1.6x the requested excess (P7 batch 2: requested 2.2 read 1.36)
            self.gain_asym = self.gain_asym * (1.0 + 1.6 * (float(br.get("gain", 2.0)) - 1.0) * w)
            self._breach_fast = 1.0 + (float(br.get("fast_gain", 2.5)) - 1.0) * w

    def _breach_plateau(self, br: Dict) -> np.ndarray:
        region = list(br.get("region") or [])
        focus = str(br["focus"])
        if not region:
            region = [focus]
            for a, b in mt.montage_pairs("longitudinal_bipolar", self.scalp):
                if focus in (a, b) and b is not None:
                    region.append(b if a == focus else a)
        region = [e for e in dict.fromkeys(region) if e in mt.POSITIONS and e in self._idx]
        w = np.zeros(self.n_elec)
        for i, e in enumerate(self.electrodes):
            if e in region:
                w[i] = 1.0
            elif e in mt.POSITIONS:
                x, y = mt.POSITIONS[e]
                w[i] = max(math.exp(-((math.hypot(x - mt.POSITIONS[r][0], y - mt.POSITIONS[r][1]) / 0.3) ** 2))
                           for r in region)
        return w

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
        if self.spec_version >= 2:
            # 0.4.4 (Craig, PQ-G-002): independent draws let one electrode sit at 2-3x both of its chain
            # neighbours, so both derivations around it become mirror images (T3-T5 vs T5-O1 r = -0.84).
            # Scalp contact varies smoothly over the head: smooth the log-gain with the monopole field
            # (self 1, first neighbours ~0.3-0.5) before anchoring and capping.
            logg = np.log(gain)
            sm = logg.copy()
            ref_idx = [self._idx[r] for r in mt.REFERENCE_ELECTRODES if r in self._idx]
            for i, e in enumerate(self.electrodes):
                if e not in self.scalp:
                    continue
                w = mt.monopole_weights(e, self.electrodes, falloff=0.6)
                wv = np.array([w[c] for c in self.electrodes])
                wv[ref_idx] = 0.0
                sm[i] = float(np.dot(wv, logg) / wv.sum())
            gain = np.exp(sm)
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
        rem_starts: List[float] = []
        rem_intervals: List[Tuple[float, float]] = []
        for ev in spec["events"]:
            if ev["type"] != "state_change":
                continue
            t = float(ev["at_min"]) * 60.0
            if ev["to"] == "arousal":
                st_arousal.append((t, 30.0))
                continue
            if ev["to"] == "rem":
                rem_starts.append(t)
                target = 1.0
            else:
                for start in rem_starts:
                    rem_intervals.append((start, t))
                rem_starts = []
                target = 1.0 if ev["to"] == "sleep" else 0.0
            st_times += [max(0.0, t - 30.0), t + 90.0]
            st_sleep += [st_sleep[-1], target]
        rem_intervals.extend((start, dur) for start in rem_starts)
        self._rem_intervals = rem_intervals
        order = np.argsort(st_times)
        self._state_t = list(np.asarray(st_times)[order])
        self._state_v = list(np.asarray(st_sleep)[order])
        self._arousals = st_arousal
        self._hypno: List[Tuple[float, float, str]] = []
        if self.spec_version >= 3 and self.age != "neonate":
            self._build_state_v3(spec, dur)

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
        # These are authored, normalized effect profiles, not dose conversions.
        # Adult evidence supports each named direction; neonatal support is
        # limited to the separate midazolam attenuation profile.
        def profile(agent: str, level: float) -> Dict[str, float]:
            q = float(np.clip(level, 0.0, 1.0))
            out = {"delta": 0.0, "alpha": 0.0, "beta": 0.0, "gamma": 0.0,
                   "spindle": 0.0, "theta_scale": 1.0, "amp": 1.0,
                   "emg_scale": 1.0 - 0.55*q}
            if agent == "propofol":
                out.update(delta=0.65*q, alpha=0.70*q, beta=0.12*q)
            elif agent == "dexmedetomidine":
                out.update(delta=0.50*q, spindle=0.80*q)
            elif agent == "midazolam":
                if self.age == "neonate":
                    out.update(amp=1.0 - 0.35*q)
                else:
                    out.update(beta=0.75*q)
            elif agent == "ketamine":
                out.update(delta=0.45*q, gamma=0.55*q)
            elif agent == "pentobarbital":
                out.update(beta=0.30*q, delta=0.25*q)
            elif agent == "remifentanil":
                out.update(delta=0.55*q, theta_scale=1.0 - 0.45*q, alpha=-0.30*q)
            if self.spec_version >= 3:
                out.update(self._sed_profile_v3(agent, q, out))
            return out

        initial = spec.get("sedation") or {"agent": "midazolam", "level": 0.0}
        initial_profile = profile(str(initial["agent"]), float(initial["level"]))
        sed_t: List[float] = [0.0]
        bs = self.bg["burst_suppression"]
        sed_sf: List[float] = [float(bs["ibi_s"]) / max(float(bs["ibi_s"]) + float(bs["burst_s"]), 1e-6)]
        sed_beta: List[float] = [(0.10 if self.age != "neonate" else 0.05) + initial_profile["beta"]]
        sed_amp: List[float] = [initial_profile["amp"]]
        sed_delta: List[float] = [initial_profile["delta"]]
        sed_alpha: List[float] = [initial_profile["alpha"]]
        sed_gamma: List[float] = [initial_profile["gamma"]]
        sed_spindle: List[float] = [initial_profile["spindle"]]
        sed_theta: List[float] = [initial_profile["theta_scale"]]
        sed_emg: List[float] = [initial_profile["emg_scale"]]
        sed_v3: Dict[str, List[float]] = {k: [initial_profile[k]] for k in self._SED_V3_KEYS if k in initial_profile}
        sedation_events = [ev for ev in spec["events"] if ev["type"] == "sedation_change"]
        if any("level" in ev for ev in sedation_events):
            sedation_events.sort(key=lambda x: float(x["at_min"]))
        for ev in sedation_events:
            t0 = float(ev["at_min"]) * 60.0
            ramp = max(float(ev["effect"]["ramp_min"]), 0.5) * 60.0
            tgt_sr = float(ev["effect"].get("suppression_ratio_target_pct", sed_sf[-1] * 100.0)) / 100.0
            inc = ev["direction"] == "increase"
            if "level" in ev:
                p = profile(str(ev["agent"]), float(ev["level"]))
                beta_tgt = (0.10 if self.age != "neonate" else 0.05) + p["beta"]
            else:
                p = profile(str(ev["agent"]), 0.0)
                beta_tgt = ((0.42 if inc else 0.06)
                            if ev["effect"].get("beta_boost", True) else sed_beta[-1])
                if ev["agent"] in ("pentobarbital", "propofol") and inc:
                    beta_tgt = min(beta_tgt, 0.30)
            amp_tgt = p["amp"] * float(ev["effect"].get("amplitude_pct", 100.0)) / 100.0
            sed_t += [t0, t0 + ramp]
            sed_sf += [sed_sf[-1], tgt_sr]
            sed_beta += [sed_beta[-1], beta_tgt]
            sed_amp += [sed_amp[-1], amp_tgt]
            sed_delta += [sed_delta[-1], p["delta"]]
            sed_alpha += [sed_alpha[-1], p["alpha"]]
            sed_gamma += [sed_gamma[-1], p["gamma"]]
            sed_spindle += [sed_spindle[-1], p["spindle"]]
            sed_theta += [sed_theta[-1], p["theta_scale"]]
            sed_emg += [sed_emg[-1], p["emg_scale"]]
            for k in sed_v3:
                sed_v3[k] += [sed_v3[k][-1], p[k]]
        self._sed_v3 = sed_v3
        self._sed_t, self._sed_sf = sed_t, sed_sf
        self._sed_beta, self._sed_amp = sed_beta, sed_amp
        self._sed_delta, self._sed_alpha = sed_delta, sed_alpha
        self._sed_gamma, self._sed_spindle = sed_gamma, sed_spindle
        self._sed_theta = sed_theta
        self._sed_emg = sed_emg
        if self.spec_version >= 3:
            self._build_sed_schedules_v3()

        # attenuation transients ---------------------------------------
        self._atten = [
            (float(e["at_min"]) * 60.0, float(e["duration_min"]) * 60.0,
             e["side"], float(e["depth_pct"]) / 100.0,
             float(e.get("ramp_min", 0.0)) * 60.0,
             float(e.get("delta_depth_pct", e["depth_pct"])) / 100.0)
            for e in spec["events"] if e["type"] == "attenuation_transient"
        ]
        self._dur_guard = dur

    # ---------------- 0.5.0 sedation (spec_version 3) ----------------
    #: v3-only sedation timelines, interpolated like the others (feature review 2026-09-26, sedation.md): ``loc`` loss of
    #: consciousness 0..1 (removes blinks and eye-state events), ``pdr`` posterior-rhythm multiplier, ``beta3`` diffuse
    #: waxing/waning benzodiazepine beta, ``barb`` barbiturate 13-16 Hz fast activity, ``gamma3`` ketamine 25-32 Hz gamma,
    #: ``keta`` depth of the ketamine slow-delta / gamma alternation
    _SED_V3_KEYS = ("loc", "pdr", "beta3", "barb", "gamma3", "keta")
    #: drug spindle packet weight (background-RMS units at the field maximum, per unit spindle level)
    _DRUG_SPINDLE_W = 3.5
    #: residual interburst floor (fraction of the background) under drug-induced burst suppression
    #: re-review 2026-09-26: 0.01 of 40 uV was a 0.4 uV dead line.  A drug-induced suppression keeps low-voltage
    #: irregular residual activity (0.025 of a 40 uV background, about 1 uV RMS) plus ECG: visibly not flat, still under the
    #: 3 uV epoch criterion the suppression-ratio trend uses
    _SED_IBI_FLOOR_V3 = 0.025

    def _sed_profile_v3(self, agent: str, q: float, out: Dict[str, float]) -> Dict[str, float]:
        """A drug REPLACES the awake background instead of adding to it (sedation.md systematic item 1).

        Hypnotics at level >= 0.7 are unconscious: the posterior dominant rhythm, spontaneous blinks and eye-state
        events go and tonic muscle falls.  Sources: Purdon 2015 (S23 context; propofol alpha anteriorizes, occipital alpha
        lost; dexmedetomidine 9-15 Hz spindles 1-2 s long in a sleep-like slow background; ketamine 25-32 Hz gamma with
        slow-delta); Akeju 2014 (S23, dex spindle peak 12.9 Hz); Breimer 1990 (S24, midazolam subjects asleep, largest
        change 12-30 Hz); Jennekens 2012 (S25, neonatal midazolam: amplitude down, relative delta down, theta up); Akeju
        2016 (S26, ketamine: theta up, alternating slow-delta and gamma); Barberio 2011 (S28, pentobarbital); Graversen
        2014 (S29, remifentanil volunteers stay awake).  Weights are authored, not dose conversions."""
        loc = float(smoothstep((q - 0.2) / 0.5))
        v = {"loc": loc, "pdr": 1.0, "beta3": 0.0, "barb": 0.0, "gamma3": 0.0, "keta": 0.0}
        if agent == "propofol":
            v.update(pdr=1.0 - 0.95 * loc, emg_scale=1.0 - 0.9 * q, delta=1.1 * q, alpha=1.5 * q, beta=0.05 * q)
        elif agent == "dexmedetomidine":
            v.update(pdr=1.0 - 0.9 * loc, emg_scale=1.0 - q, delta=0.9 * q, theta_scale=1.0 + 0.25 * q,
                     spindle=q)
        elif agent == "midazolam":
            if self.age == "neonate":
                v.update(loc=0.0, amp=1.0 - 0.3 * q, theta_scale=1.0 + 0.4 * q, delta=-0.15 * q)
            else:
                v.update(pdr=1.0 - 0.75 * loc, emg_scale=1.0 - 0.8 * q, beta3=0.9 * q)
        elif agent == "ketamine":
            v.update(pdr=1.0 - 0.9 * loc, emg_scale=1.0 - 0.4 * q, theta_scale=1.0 + 1.5 * q, gamma=0.0,
                     gamma3=1.0 * q, keta=float(np.clip((q - 0.3) / 0.4, 0.0, 1.0)))
        elif agent == "pentobarbital":
            v.update(pdr=1.0 - 0.95 * loc, emg_scale=1.0 - 0.9 * q, beta=0.05 * q, barb=0.9 * q)
        else:                                   # remifentanil: awake volunteers (S29)
            v.update(loc=0.0)
        return v

    def _sed_v3_at(self, key: str, t: np.ndarray, neutral: float) -> np.ndarray:
        vals = self._sed_v3.get(key) if self.spec_version >= 3 else None
        if not vals:
            return np.full(t.shape, neutral)
        return _piecewise(self._sed_t, vals, t) if len(self._sed_t) > 1 else np.full(t.shape, vals[0])

    def _sed_driven_bs(self) -> bool:
        """Burst suppression that comes from a sedation_change target, not from ``background.type``."""
        return (self.spec_version >= 3 and len(self._sed_t) > 1 and max(self._sed_sf[1:]) > 0.03
                and self.bg["type"] == "continuous" and self.bg.get("ibi_range_s") is None)

    def _build_sed_schedules_v3(self) -> None:
        """Drug-driven transients, drawn once per record (never per requested window)."""
        dur = self.duration_s
        # dexmedetomidine spindles: irregular (lognormal inter-onset, mean 6 s), 1-2 s long (Purdon 2015); thinned by the
        # spindle weight at each onset so a ramp raises their density
        rng = substream(self.seed, "sed_spindle")
        spmax = max(self._sed_spindle) if self._sed_spindle else 0.0
        n = int((dur + 120.0) / 2.0) + 8 if spmax > 0 else 0
        gaps = 6.0 * _lognorm(rng, n, 0.4) / math.exp(0.08) if n else np.empty(0)
        cand = np.cumsum(gaps) - 30.0 if n else np.empty(0)
        spd = np.clip(2.2 * _lognorm(rng, n, 0.25), 1.4, 3.2) if n else np.empty(0)
        hz = rng.uniform(12.0, 14.0, n) if n else np.empty(0)
        amp = _lognorm(rng, n, 0.25) if n else np.empty(0)
        ph = rng.uniform(0.0, 2 * np.pi, n) if n else np.empty(0)
        u = rng.uniform(0.0, 1.0, n) if n else np.empty(0)
        keep = np.zeros(n, bool)
        last_end = -1e9
        for i in range(n):
            if cand[i] > dur + 30.0:
                break
            w = float(_piecewise(self._sed_t, self._sed_spindle, np.array([max(cand[i], 0.0)]))[0]) / spmax \
                if len(self._sed_t) > 1 else self._sed_spindle[0] / spmax
            if u[i] < w and cand[i] > last_end + 0.8:
                keep[i] = True
                last_end = cand[i] + spd[i]
        self._dsp = {"t": cand[keep], "dur": spd[keep], "hz": hz[keep], "amp": amp[keep], "ph": ph[keep]}
        # ketamine: alternating slow-delta (median 2.5 s) and gamma (median 1.5 s) epochs (Akeju 2016 "gamma burst")
        kr = substream(self.seed, "sed_ketamine")
        ep, t = [], -30.0
        while t < dur + 30.0:
            t += 2.5 * float(_lognorm(kr, 1, 0.35)[0])
            g = 1.5 * float(_lognorm(kr, 1, 0.35)[0])
            ep.append((t, t + g))
            t += g
        self._keta_ep = np.asarray(ep) if ep else np.empty((0, 2))
        # benzodiazepine beta waxes and wanes over 3-10 s (learningeeg "background after benzos")
        br = substream(self.seed, "sed_beta_am")
        self._beta_am = (br.uniform(0.10, 0.18), br.uniform(0.2, 0.3), br.uniform(0, 2 * np.pi), br.uniform(0, 2 * np.pi))

    def _keta_gate(self, t: np.ndarray) -> np.ndarray:
        """1 inside a ketamine gamma epoch, 0 in a slow-delta epoch, 0.25 s raised-cosine edges."""
        g = np.zeros(t.shape)
        ep = self._keta_ep
        for a, b in ep[(ep[:, 1] > t[0] - 0.5) & (ep[:, 0] < t[-1] + 0.5)]:
            g = np.maximum(g, np.clip(np.minimum((t - a) / 0.25, (b - t) / 0.25) + 0.5, 0.0, 1.0))
        return 0.5 - 0.5 * np.cos(np.pi * g)

    #: phase D (sedation-v3 S109-02): dexmedetomidine spindles are frontally predominant (R7), not the central N2 field
    #: whose steep parietal-occipital fall drew them as large in P3-O1 / P4-O2 / T5-O1 as in F3-C3
    _DEX_SPINDLE_FIELD = {"F3": 1.0, "F4": 1.0, "Fz": 1.0, "Fp1": 0.5, "Fp2": 0.5, "C3": 0.6, "C4": 0.6, "Cz": 0.65,
                          "F7": 0.45, "F8": 0.45, "T3": 0.3, "T4": 0.3, "P3": 0.3, "P4": 0.3, "Pz": 0.3,
                          "T5": 0.12, "T6": 0.12, "O1": 0.1, "O2": 0.1}

    def _drug_spindle_rows(self, t: np.ndarray) -> np.ndarray:
        d = self._dsp
        env, c, s = sv3.packets(t, d["t"], d["dur"], d["hz"], d["amp"], d["ph"])
        if not env.any():
            return np.zeros((self.n_elec, t.size))
        lag = self._sp_lag[:, None]
        field = np.array([self._DEX_SPINDLE_FIELD.get(e, 0.1) for e in self.electrodes])
        return field[:, None] * (c[None, :] * np.cos(lag) - s[None, :] * np.sin(lag))

    def _burst_content_rows(self, t: np.ndarray, i0: int) -> np.ndarray:
        """Barbiturate burst: high-voltage polymorphic delta/theta plus sharp transients (learningeeg burst-suppression
        pages; Purdon 2015 Fig 2F), in background-RMS units; the burst envelope applied later confines it to bursts."""
        n = t.size
        rows = self._stream_signal(self.st_burst, i0, n) * 2.5
        # phase D (sedation-v3 S109-06: bursts were pure slow humps, relative beta 0.00): the barbiturate fast activity
        # persists inside the bursts as fine superimposed 12-20 Hz activity (learningeeg burst-suppression pages R2/R3)
        rows = rows + self._stream_signal(self.st_barb, i0 + 9091, n) * 0.9
        rise, fall, _, _, _ = self._burst_edge()
        pos = np.array([mt.POSITIONS.get(e, (0.0, 0.0)) for e in self.electrodes], float)
        for k in self._bursts_touching(t, rise, fall):
            a, b = float(self._burst_start[k]), float(self._burst_end[k])
            if b < t[0] - 0.5 or a > t[-1] + 0.5:
                continue
            rng = substream(self.seed, "sed_burst", k)
            m = int(rng.integers(2, 5))
            m += int(substream(self.seed, "sed_burst_d", k).integers(1, 4))   # phase D: 3-7 sharp waves per burst
            for j in range(m):
                c0 = a + (b - a) * float(rng.uniform(0.1, 0.85))
                wd = float(rng.uniform(0.035, 0.06))
                sgn = -1.0 if rng.uniform() < 0.8 else 1.0        # surface-negative sharp waves mostly
                fx, fy = rng.normal(0.0, 0.6, 2)
                field = np.clip(1.0 + fx * pos[:, 0] + fy * pos[:, 1], 0.2, 1.8)
                field[[self._idx[e] for e in mt.REFERENCE_ELECTRODES]] *= 0.3
                d = t - c0
                mm = (d > -0.3) & (d < 0.5)
                if mm.any():
                    dd = d[mm]
                    w = sgn * (np.exp(-0.5 * (dd / wd) ** 2) - 0.35 * np.exp(-0.5 * ((dd - 2.6 * wd) / (2.2 * wd)) ** 2))
                    rows[:, mm] += 5.0 * float(rng.uniform(0.7, 1.3)) * field[:, None] * w[None, :]
        return rows

    #: 0.5.0 per-electrode spindle field (central maximum; temporal chains carry lower-voltage spindles, Craig on
    #: PQ-G-002: "lower voltage, but not absent") and a small anterior-to-posterior phase lag (traveling spindle)
    _SPINDLE_FIELD_V3 = {"C3": 1.0, "C4": 1.0, "Cz": 1.0, "F3": 0.75, "F4": 0.75, "Fz": 0.85, "P3": 0.75, "P4": 0.75,
                         "Pz": 0.8, "T3": 0.55, "T4": 0.55, "F7": 0.4, "F8": 0.4, "T5": 0.4, "T6": 0.4,
                         "Fp1": 0.25, "Fp2": 0.25, "O1": 0.25, "O2": 0.25}
    _SPINDLE_LAG_RAD_PER_UNIT = 1.1
    _VERTEX_FIELD = {"Cz": 1.0, "Fz": 0.55, "Pz": 0.5, "C3": 0.45, "C4": 0.45, "F3": 0.3, "F4": 0.3, "P3": 0.3, "P4": 0.3,
                     "T3": 0.1, "T4": 0.1, "Fp1": 0.08, "Fp2": 0.08, "O1": 0.08, "O2": 0.08, "F7": 0.1, "F8": 0.1,
                     "T5": 0.08, "T6": 0.08}
    _KCOMPLEX_FIELD = {"Fz": 1.0, "F3": 0.85, "F4": 0.85, "Cz": 0.7, "C3": 0.5, "C4": 0.5, "Fp1": 0.55, "Fp2": 0.55,
                       "Pz": 0.3, "P3": 0.25, "P4": 0.25, "F7": 0.45, "F8": 0.45, "T3": 0.2, "T4": 0.2, "T5": 0.1,
                       "T6": 0.1, "O1": 0.05, "O2": 0.05}
    #: peak microvolts at the field maximum (median; lognormal per event).  Pediatric vertex waves and K-complexes are
    #: typically the largest waves of an N2 page; the bipolar chains show the field gradient, about a third of this
    _VERTEX_UV = {"infant": 170.0, "child": 200.0, "adolescent": 140.0, "adult": 90.0}
    _KCOMPLEX_UV = {"infant": 300.0, "child": 350.0, "adolescent": 250.0, "adult": 160.0}

    #: N3 slow-wave weight (background-RMS units) by age: children carry the highest-voltage slow-wave sleep
    _SWS_W_V3 = {"infant": 0.65, "child": 0.7, "adolescent": 0.55, "adult": 0.4}
    _THETA_W_V3 = {"infant": 0.9, "child": 0.65, "adolescent": 0.45, "adult": 0.30}

    def _build_state_v3(self, spec: Dict, dur: float) -> None:
        grid = np.arange(0.0, dur + 1.0, 1.0)
        asleep = _piecewise(self._state_t, self._state_v, grid) >= 0.5
        staged = (self.bg.get("sleep_staging") or "cycling") == "cycling"
        sp = sv3.spans(grid, asleep)
        if staged:
            hyp = sv3.build_hypnogram(self.seed, sp, self.age, dur)
        else:
            hyp, prev = [], -120.0
            for a, b in sp:
                hyp += [(prev, a, "W"), (a, b, "N2")]
                prev = b
            hyp.append((prev, dur + 120.0, "W"))
        for a, b in self._rem_intervals:            # authored REM overrides the drawn stage
            cut = []
            for x0, x1, st in hyp:
                if x1 <= a or x0 >= b:
                    cut.append((x0, x1, st))
                    continue
                if x0 < a:
                    cut.append((x0, a, st))
                if x1 > b:
                    cut.append((b, x1, st))
            hyp = sorted(cut + [(a, b, "R")])
        self._hypno = [iv for iv in hyp if iv[1] > iv[0]]
        self._arousals_v3 = sv3.build_arousals(self.seed, self._hypno) + [(a, w) for a, w in self._arousals]
        eyes_on = self.bg.get("reactivity") == "present" and float(self.bg.get("blink_rate_per_min") or 0.0) > 0
        self._eyes = sv3.build_eye_timeline(self.seed, self._hypno) if eyes_on else []
        style = spec.get("style") or {}
        rate = float(style.get("spindle_rate_per_min", 4.0))
        self._sp_t = sv3.schedule_transients(self.seed, "spindles", self._hypno, sv3.SPINDLE, rate, 1.5)
        self._sp = sv3.spindle_params(self.seed, self._sp_t.size, self.age)
        vrate = 6.0 if self.age in ("infant", "child") else 3.0
        self._vx_t = sv3.schedule_transients(self.seed, "vertex", self._hypno, sv3.VERTEX, vrate, 2.0)
        self._kc_t = sv3.schedule_transients(self.seed, "kcomplex", self._hypno, sv3.KCOMPLEX, 1.5, 4.0)
        vr = substream(self.seed, "vertex-shape")
        self._vx_a = np.exp(vr.normal(0.0, 0.25, self._vx_t.size))
        kr = substream(self.seed, "kcomplex-shape")
        self._kc_a = np.exp(kr.normal(0.0, 0.25, self._kc_t.size))
        pos = np.array([mt.POSITIONS.get(e, (0.0, 0.0)) for e in self.electrodes])
        self._sp_field = np.array([mt.table_value(self._SPINDLE_FIELD_V3, e, 0.2) for e in self.electrodes])
        self._sp_lag = -self._SPINDLE_LAG_RAD_PER_UNIT * pos[:, 1]
        self._vx_field = np.array([mt.table_value(self._VERTEX_FIELD, e, 0.05) for e in self.electrodes])
        self._kc_field = np.array([mt.table_value(self._KCOMPLEX_FIELD, e, 0.05) for e in self.electrodes])

    def stage_at(self, t: np.ndarray) -> np.ndarray:
        """Sleep stage label per sample (spec_version 3, non-neonatal); '' otherwise."""
        out = np.full(t.shape, "", dtype=object)
        for a, b, st in self._hypno:
            out[(t >= a) & (t < b)] = st
        return out

    def _eye_factor(self, t: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """(PDR factor, blink factor) from the eye timeline: eyes closed 1.0 / 0.0, eyes open 0.3 / 1.0, with the PDR
        briefly back to 0.85 from 0.15 s to about 1.2 s after each eyes-open blink (Craig on B2-06)."""
        force = getattr(self, "_eye_force", None)
        if not self._eyes and not force:
            return np.ones(t.shape), np.ones(t.shape)
        closed = (sv3.weight(t, self._eyes, {"closed": 1.0, "open": 0.0}, xfade=0.6, default=1.0) if self._eyes
                  else np.ones(t.shape))
        for a, b, st in force or ():
            # 0.5.0: visual scanning holds the eyes open, photic stimulation holds them closed (normal-variants.md)
            m = np.clip(np.minimum(t - a + 0.3, b + 0.3 - t) / 0.3, 0.0, 1.0)
            closed = closed * (1 - m) + (0.0 if st == "open" else 1.0) * m
        boost = np.zeros(t.shape)
        for pk in self._blink_t[(self._blink_t > t[0] - 1.5) & (self._blink_t < t[-1])] + 0.10:
            d = t - pk
            m = (d > 0.15) & (d < 1.2)
            boost[m] = np.maximum(boost[m], np.sin(np.pi * (d[m] - 0.15) / 1.05) ** 2)
        pdr = closed + (1.0 - closed) * (0.3 + 0.55 * boost)
        # phase D (artifacts-v3 blinks): no blinks behind closed lids (0.1 gain drew 5-16 uV frontal V's, half of all blinks)
        return pdr, 1.0 - closed

    def _eye_event_rows(self, t: np.ndarray) -> np.ndarray:
        """Eye closure (Fp positive, about 2x a blink, back by 300 ms) and eye opening (Fp negative, 1.5x a blink,
        80 ms rise, 100 ms plateau, 170 ms decay) at each eye-state change (feature review, artifacts.md 1f)."""
        rows = np.zeros((self.n_elec, t.size))
        if not self._eyes:
            return rows
        # phase D: the v3 blink default doubled (160 -> 320 uV) so a displayed blink reaches its reference size; a slow
        # eyelid movement loses far less through the LFF than a 100-ms blink, so the eye events keep their accepted
        # scale (opening about 2.5 rows, 1.4x the displayed blinks; reference 1.5x)
        a_uv = 0.5 * float(self.bg.get("blink_amplitude_uv", BLINK_UV))
        prof = np.zeros(t.size)
        for (a, b, st) in self._eyes[1:]:
            d = t - a
            if d[-1] < -0.3 or d[0] > 1.5:
                continue
            if st == "closed":
                m = (d > -0.15) & (d < 0.8)
                dd = d[m]
                prof[m] += 2.0 * np.where(dd < 0, np.exp(-0.5 * (dd / 0.045) ** 2), np.exp(-0.5 * (dd / 0.11) ** 2))
            else:
                m = (d > -0.1) & (d < 1.2)
                dd = d[m]
                up = np.clip(dd / 0.08, 0.0, 1.0) ** 2
                prof[m] += -1.5 * np.where(dd < 0.18, up, np.exp(-(dd - 0.18) / 0.17))
        return prof[None, :] * a_uv * self._blink_field()[:, None]

    def _spindle_rows_v3(self, t: np.ndarray) -> np.ndarray:
        env, c, s = sv3.packets(t, self._sp_t, self._sp["dur"], self._sp["hz"], self._sp["amp"], self._sp["ph"])
        if not env.any():
            return np.zeros((self.n_elec, t.size))
        lag = self._sp_lag[:, None]
        return self._sp_field[:, None] * (c[None, :] * np.cos(lag) - s[None, :] * np.sin(lag))

    def _sleep_transient_rows(self, t: np.ndarray) -> np.ndarray:
        """Vertex sharp waves (surface-negative, about 150 ms, central) and K-complexes (sharp negative then positive
        slow wave, >= 0.5 s, frontal-central), microvolts."""
        rows = np.zeros((self.n_elec, t.size))
        vuv = self._VERTEX_UV.get(self.age, 90.0)
        for tt, a in zip(self._vx_t, self._vx_a):
            d = t - tt
            m = (d > -0.15) & (d < 0.45)
            if m.any():
                dd = d[m]
                w = -np.exp(-0.5 * (dd / 0.045) ** 2) + 0.35 * np.exp(-0.5 * ((dd - 0.14) / 0.06) ** 2)
                rows[:, m] += (vuv * a) * self._vx_field[:, None] * w[None, :]
        kuv = self._KCOMPLEX_UV.get(self.age, 150.0)
        for tt, a in zip(self._kc_t, self._kc_a):
            d = t - tt
            m = (d > -0.2) & (d < 1.4)
            if m.any():
                dd = d[m]
                w = -np.exp(-0.5 * (dd / 0.07) ** 2) + 0.6 * np.exp(-0.5 * ((dd - 0.45) / 0.18) ** 2)
                rows[:, m] += (kuv * a) * self._kc_field[:, None] * w[None, :]
        return rows

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
        if self._hypno:
            v = sv3.weight(t, self._hypno, sv3.DEPTH)
            return np.clip(v * (1.0 - 0.9 * sv3.arousal_gate(t, self._arousals_v3)), 0.0, 1.0)
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

    def _pma_eff(self) -> float:
        """Maturational PMA: the dysmature PMA when the record carries a younger PMA's patterns."""
        return float(self.bg.get("dysmature_pma_weeks") or self.bg.get("pma_weeks") or 40.0)

    def _qs_sf_v3(self, term_sf: float) -> float:
        """0.5.0 (feature review B1-09: 43-w quiet sleep was still day-3 trace alternant): TA is minimal by 42 w
        and gone by 46 w, replaced by continuous 50-150 uV slow-wave sleep (ACNS 2013), so the quiet-sleep
        interburst share falls from the term value at 40 w to 0.15 at 43 w and 0 at 46 w."""
        return float(np.interp(self._pma_eff(), [40.0, 43.0, 46.0], [term_sf, 0.15, 0.0]))

    def _qs_floor_v3(self, term_floor: float) -> float:
        """Quiet-sleep interburst voltage over the same span: 0.42 at term to 0.65 at 43 w and 0.85 at 46 w."""
        return float(np.interp(self._pma_eff(), [40.0, 43.0, 46.0], [term_floor, 0.65, 0.85]))

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
            table = self._STATE_SF_EARLY if early else self._STATE_SF
            if self.spec_version >= 3:
                table = dict(table, quiet_sleep=self._qs_sf_v3(table["quiet_sleep"]))
            base = self._state_lookup(t, table, np.zeros_like(t, dtype=float))
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
        # 0.5.0 (feature review B1-04/C07/B1-01/B1-10: the cycle stretch below turned an authored 6-s IBI into a
        # 7.5-s median and the 5-s first-hours mean into a 13-s maximum): a neonatal record draws its IBI directly
        # around the authored ``ibi_s``, scaled only by how far the current state's interburst share departs from
        # the reference, and resamples any draw above ``ibi_max_s``.  Sedation-driven records keep the old model.
        direct = self.spec_version >= 3 and self.age == "neonate" and len(self._sed_t) <= 1
        ibi_max = float(bs["ibi_max_s"]) if direct and bs.get("ibi_max_s") else None
        if direct:
            if self._state_intervals and self.bg["type"] == "continuous":
                early = self.bg.get("hours_of_life") is not None and float(self.bg["hours_of_life"]) < 12.0
                sf_ref = (self._STATE_SF_EARLY if early else self._STATE_SF)["quiet_sleep"]
            else:
                sf_ref = float(bs["ibi_s"]) / max(float(bs["ibi_s"]) + float(bs["burst_s"]), 1e-6)
            sf_ref = max(sf_ref, 0.05)
        # a deep-sedation interburst is genuinely flat; a preterm interburst is not
        sed_bs = self._sed_driven_bs()
        while t < horizon:
            sf = float(self.suppression_fraction_at(np.array([max(t, 0.0)]))[0])
            if direct and sf >= 0.03:
                burst = max(0.25, float(bs["burst_s"]) * float(_lognorm(rng, 1, 0.22)[0]))
                mean = float(bs["ibi_s"]) * sf / sf_ref
                sig = float(bs.get("ibi_sigma", 0.26))
                ibi = max(0.25, mean * float(_lognorm(rng, 1, sig)[0]))
                tries = 0
                while ibi_max is not None and ibi > ibi_max and tries < 30:
                    ibi = max(0.25, mean * float(_lognorm(rng, 1, sig)[0]))
                    tries += 1
                if ibi_max is not None:
                    ibi = min(ibi, ibi_max)
                starts.append(t)
                ends.append(t + burst)
                t += burst + ibi
                continue
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
            if sed_bs:
                # 0.5.0 (sedation.md S109-06): drug-induced bursts last about 1-2 s (learningeeg burst-suppression pages,
                # Purdon 2015 Fig 2F) with irregular interburst intervals; the authored suppression ratio sets the IBI
                # the authored ratio is honoured on what reads as burst: the scheduled burst plus about 0.9 s of
                # edges, slow tails and sub-threshold interburst margins (0.5 s-epoch SR trend, 5 uV page reading)
                burst = float(np.clip(1.1 * _lognorm(rng, 1, 0.3)[0], 0.5, 3.0))
                ibi = max(0.5, 2.05 * min(sf, 0.95) / max(1.0 - sf, 0.05) * float(_lognorm(rng, 1, 0.4)[0]) * 0.92)
                starts.append(t)
                ends.append(t + burst)
                t += burst + ibi
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
        if self.spec_version >= 3:
            # 0.5.0: per-blink amplitude and time course, drawn once per record (a window never re-draws them)
            shp = substream(self.seed, "blink-shape")
            k = self._blink_t.size
            self._blink_amp = _lognorm(shp, k, 0.3) if k else np.empty(0)
            self._blink_sr = 0.040 * shp.uniform(0.85, 1.2, k)
            # phase D (artifacts-v3 blinks): the fall jitter U(0.8, 1.6) had mean 1.2, so the typical fall sigma was 60 ms
            # and the +40 ms point sat at 0.66 (reference 0.43, IQR 0.40-0.48).  Mean-1 jitter, one blink in ten slow
            self._blink_sf = 0.045 * np.where(shp.random(k) < 0.1, 1.6, shp.uniform(0.8, 1.2, k))

    def blink_rows(self, t: np.ndarray, wake: np.ndarray) -> np.ndarray:
        """Blink deflections over ``t``; ``wake`` is the 0..1 gate."""
        rows = np.zeros((self.n_elec, t.size))
        if self._blink_t.size == 0 or t.size == 0:
            return rows
        idx = np.nonzero((self._blink_t > t[0] - 0.6) & (self._blink_t < t[-1] + 0.6))[0]
        if idx.size == 0:
            return rows
        prof = self._blink_profile(t, self._blink_t[idx], idx) * float(self.bg.get("blink_amplitude_uv", BLINK_UV)) * wake
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

    #: 0.5.0 (feature review 2026-09-26, 15 blinks in 6 learningeeg figures, longitudinal bipolar): Fp1-F7 is
    #: larger than Fp1-F3 and F7-T3 is 0.14-0.36 of Fp1-F7, so F7/F8 carry less field than F3/F4 (v2 had them equal).
    _BLINK_FIELD_V3 = {"Fp1": 1.00, "Fp2": 1.00, "F7": 0.15, "F8": 0.15, "F3": 0.35, "F4": 0.35,
                       "Fz": 0.35, "T3": 0.02, "T4": 0.02, "C3": 0.12, "C4": 0.12, "Cz": 0.10}

    def _blink_field(self) -> np.ndarray:
        if self.spec_version >= 3:
            # F3-C3/Fp1-F3 varies four-fold between patients: one per-record scale on the frontal row
            scale = float(substream(self.seed, "blink-field").uniform(0.6, 1.4))
            return np.array([mt.table_value(self._BLINK_FIELD_V3, e, 0.02) * (scale if e in ("F3", "F4", "Fz") else 1.0)
                             for e in self.electrodes])
        table = self._BLINK_FIELD_V2 if self.spec_version >= 2 else _BLINK_FIELD
        default = 0.02 if self.spec_version >= 2 else 0.04
        return np.array([mt.table_value(table, e, default) for e in self.electrodes])

    def _blink_profile(self, t: np.ndarray, times: np.ndarray, idx: Optional[np.ndarray] = None) -> np.ndarray:
        """Unit-peak blink deflections at ``times`` (positive = cornea-positive at Fp).

        Version 3: split Gaussian peaking 100 ms after the blink time, rise sigma 40 ms and fall
        sigma 50 ms (each jittered per blink) and a lognormal per-blink amplitude.  Through the
        causal 1 Hz LFF this gives the reference 10 %/50 % rise at -82/-44 ms, baseline crossing at
        +74 ms and the -0.4 undershoot without an explicit opposite lobe.  Version 2: eyelid closure
        in ~100 ms (rise sigma 45 ms) and a return with a 120 ms time constant.  Version 1 keeps the
        0.3.x symmetric 75 ms Gaussian.
        """
        prof = np.zeros(t.size)
        if self.spec_version >= 3:
            for j, tt in enumerate(times):
                # scheduled blinks carry their own draws; event blinks (eye_blink artifact) use the nominal shape
                k = None if idx is None else idx[j]
                sr, sf, a = (0.040, 0.050, 1.0) if k is None else (self._blink_sr[k], self._blink_sf[k], self._blink_amp[k])
                d = t - tt - 0.10
                m = (d > -0.20) & (d < 0.30)
                dd = d[m]
                prof[m] += a * np.exp(-0.5 * (dd / np.where(dd < 0, sr, sf)) ** 2)
            return prof
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
            if name == "delta_brush" and self.spec_version >= 3:
                # 0.5.0: brushes live inside bursts (own substream so every other element keeps its draws)
                times = self._brush_times_v3(rate, span)
                m = times.size
                rng = substream(self.seed, "graphoelement-v3", name)
                mean_s, dur_sd = 1.0, 0.22
            dur = np.clip(mean_s * _lognorm(rng, m, dur_sd), 0.3, 60.0) if dur_sd > 0 else np.full(m, mean_s)
            if name == "delta_brush" and self.spec_version >= 3:
                dur = np.clip(dur, 0.7, 1.6)
            freq = rng.uniform(f0, f1, m) if f1 > 0 else np.zeros(m)
            if name == "sharp_transient":      # the freq column carries the region index for this element
                freq = rng.choice(len(self._SHARP_REGION_P), size=m, p=self._SHARP_REGION_P).astype(float)
            side = (rng.integers(0, 2, m) * 2 - 1).astype(float) if lat == "unilateral" else np.zeros(m)
            aj = amp * _lognorm(rng, m, 0.30)
            phase = rng.uniform(0, 2 * np.pi, m)
            self._ge_events[name] = np.column_stack([times, dur, freq, side, aj, phase])
            if name == "delta_brush" and self.spec_version >= 3:
                # second carrier, FM phase and per-brush fast ratio (columns of self._brush_v3)
                self._ge_events[name][:, 4] = amp * _lognorm(rng, m, 0.20)
                self._brush_v3 = np.column_stack([rng.uniform(10.0, 20.0, m), rng.uniform(0, 2 * np.pi, m),
                                                  rng.uniform(0, 2 * np.pi, m), rng.uniform(0.85, 1.15, m)])

    def _brush_times_v3(self, rate: float, span: float) -> np.ndarray:
        """0.5.0 (feature review C33: one brush per page at 32 w, scheduled independently of the bursts): brush
        times drawn inside the scheduled bursts, at the authored per-minute rate overall.  At 30-34 w, when most
        delta waves of a burst carry fast activity (ACNS 2013 Fig. 2a; LE-33wED), at least half of a burst's
        ~1.8-s delta waves are brushed.  A continuous stretch (the scheduler's merged 30-s pseudo-bursts) keeps the plain rate."""
        rng = substream(self.seed, "brush-times-v3")
        segs = [(max(float(a), -60.0), min(float(b), span)) for a, b in zip(self._burst_start, self._burst_end)
                if b > -60.0 and a < span]
        long_t = sum(b - a for a, b in segs if b - a >= 29.9)
        short_t = sum(b - a for a, b in segs if b - a < 29.9)
        frac = short_t / max(span + 60.0 - long_t, 1e-6)
        dense = 30.0 <= self._pma_eff() <= 34.0
        out: List[float] = []
        for a, b in segs:
            L = b - a
            lam = rate / 60.0 * L
            if L < 29.9:
                lam /= max(frac, 0.2)
                if dense:
                    lam = max(lam, 0.5 * L / 1.8)
            lam *= self._brush_state_w(0.5 * (a + b))
            n = int(rng.poisson(lam))
            lo, hi = a + 0.8, b - 1.8      # clear of the burst edge ramps
            if n == 0 or hi <= lo:
                continue
            last = -1e9
            for tt in np.sort(rng.uniform(lo, hi, n)):
                if tt - last >= 1.6:
                    out.append(float(tt))
                    last = tt
        return np.asarray(out)

    def _brush_state_w(self, tt: float) -> float:
        """Phase D (neonatal-v3 B1-06: 7.3 / 6.9 / 7.2 brushes per minute in quiet sleep / active sleep / wake): delta
        brushes by behavioural state (ACNS 2013): maximal in active sleep up to 32 w, maximal in quiet sleep from 33 w,
        so from 33 w active sleep and wake carry 0.3 of the quiet-sleep rate; before 32 w quiet sleep carries 0.6 of the
        active-sleep rate.  1.0 without a state cycle (or before version 3)."""
        if self.spec_version < 3 or not self._state_intervals:
            return 1.0
        st = str(self.state_at(np.array([tt]))[0])
        early = {"active_sleep": 1.0, "indeterminate": 0.8, "quiet_sleep": 0.6, "awake": 0.5}
        late = {"active_sleep": 0.3, "indeterminate": 0.6, "quiet_sleep": 1.0, "awake": 0.3}
        if st not in late:
            return 1.0
        k = float(np.clip(self._pma_eff() - 32.0, 0.0, 1.0))
        return (1.0 - k) * early[st] + k * late[st]

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
            hit = (ev[:, 0] + ev[:, 1] > t[0] - 1.0) & (ev[:, 0] < t[-1] + 1.0)
            if name == "delta_brush" and self.spec_version >= 3:
                for j in np.nonzero(hit)[0]:
                    target += self._brush_rows_v3(t, ev[j], self._brush_v3[j])
                continue
            sel = ev[hit]
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

    #: 0.5.0 (feature review B1-06(d): O1/T3/T5 at 1.0/0.85/0.8 cancelled in T3-O1 and T3-T5): one temporal maximum
    #: with a steep fall, so the complex phase-reverses at T3/T4 (ACNS 2013 Fig. 2a: Fp2-T4 against T4-O2)
    _BRUSH_FIELD_OCCTEMP_V3 = {"T3": 1.0, "T5": 0.5, "O1": 0.35, "C3": 0.35, "P3": 0.3}

    def _brush_rows_v3(self, t: np.ndarray, ev: np.ndarray, extra: np.ndarray) -> np.ndarray:
        """0.5.0 delta brush (feature review B1-06(a)/C33; Craig: "the beta must ride on the delta wave").

        One surface-negative delta wave whose trough is ``amp`` in the longitudinal-bipolar derivation of largest
        field difference (the referential field is scaled up by that difference, so a focal field does not dilute
        the request), 0.7-1.6 s long (the causal 0.5 Hz display LFF turns it into a trough and an equal rebound, so
        the displayed peak-to-peak is about the request), with 10-20 Hz fast activity from two carriers (+-15 % FM)
        confined to the trough by ``win**3``.  Fast peak = 0.15 of the delta (0.20 at 33.5-35.5 w, "extremely high
        voltage beta"): displayed fast/delta 0.3-0.4, as in ACNS Fig. 2a and LE-33wED.  Ratio and field read the
        dysmature PMA when one is set (B1-06(c)).
        """
        t0, dur, f1, side, amp, _ = ev
        f2, ph1, ph2, rj = extra
        pma = self._pma_eff()
        fld = self._BRUSH_FIELD_CENTRAL if pma < 31.0 else self._BRUSH_FIELD_OCCTEMP_V3
        w = self._table_field(fld, side)
        key = (id(fld), float(np.sign(side)))
        cache = self.__dict__.setdefault("_brush_diff", {})
        if key not in cache:
            pairs = mt.montage_pairs("longitudinal_bipolar", self.scalp)
            cache[key] = max((abs(w[self._idx[a]] - w[self._idx[b]]) for a, b in pairs if b is not None), default=1.0)
        A = amp / max(cache[key], 0.2)
        ratio = (0.20 if 33.5 <= pma <= 35.5 else 0.15) * rj
        d = t - t0
        u = d / max(dur, 1e-3)
        inside = (u > 0) & (u < 1)
        win = np.where(inside, np.sin(np.pi * np.clip(u, 0, 1)), 0.0)
        c1 = 2 * np.pi * f1 * d - 0.15 * f1 * dur * np.cos(2 * np.pi * u + ph1) + ph1
        c2 = 2 * np.pi * f2 * d - 0.15 * f2 * dur * np.cos(2 * np.pi * u + ph2) + ph2
        carrier = (np.sin(c1) + 0.8 * np.sin(c2)) / 1.5
        sig = -A * win + ratio * A * win ** 3 * carrier
        return np.outer(w, sig)

    def cape_cycles(self) -> List[Tuple[float, float, float]]:
        """(onset_s, offset_s, depth) of each CAPE cycle; empty without ``background.cape``."""
        c = self.bg.get("cape")
        if not c:
            return []
        period = float(c["period_s"]); depth = float(c.get("depth", 0.6))
        at = float(c.get("at_min", 0.0)) * 60.0
        n = int(c.get("cycles") or max(6, int((self.duration_s - at) // period)))
        if self.spec_version >= 3:
            return [(a, b, depth) for a, _, b, _, _ in self._cape_v3(at, period, n)]
        return [(at + k * period, at + (k + 1) * period, depth) for k in range(n)]

    #: 0.5.0 CAPE: cycle-length log-SD, the transition range (s) and the shortest phase (ACNS: each phase >= 10 s)
    _CAPE_LOG_SD = 0.25
    _CAPE_TRANSITION_S = (4.0, 8.0)
    _CAPE_MIN_PHASE_S = 10.0
    #: share of ``depth`` taken by the envelope, and the phase-B stream weights: delta x(1 - 0.6), theta x(1 + 1.2),
    #: beta x(1 + 1.5) - lower-voltage faster activity against higher-voltage delta (ACNS CAPE: two patterns)
    _CAPE_ENV_SHARE = 0.9
    _CAPE_SPECTRUM = (0.6, 1.2, 1.5)

    def _cape_v3(self, at: float, period: float, n: int) -> List[Tuple[float, float, float, float, float]]:
        """(start, mid, end, rise_s, fall_s) per CAPE cycle, drawn once (feature review B2-03: a strictly periodic
        40-s square wave).  Cycle length is lognormal around ``period_s``; the attenuated phase begins at 40-60 %
        of the cycle; transitions are raised-cosine ramps of 4-8 s; every phase keeps >= 10 s of plateau."""
        cached = self.__dict__.get("_cape_v3_cache")
        if cached is not None:
            return cached
        rng = substream(self.seed, "cape-v3")
        out, a = [], at
        lo_tr, hi_tr = self._CAPE_TRANSITION_S
        for _ in range(n):
            rise, fall = (float(v) for v in rng.uniform(lo_tr, hi_tr, 2))
            shortest = 2.0 * self._CAPE_MIN_PHASE_S + rise + fall
            p = max(shortest, period * float(_lognorm(rng, 1, self._CAPE_LOG_SD)[0]))
            frac = float(rng.uniform(0.4, 0.6))
            mid = float(np.clip(a + frac * p, a + self._CAPE_MIN_PHASE_S + 0.5 * (rise + fall),
                                a + p - self._CAPE_MIN_PHASE_S - 0.5 * (rise + fall)))
            out.append((a, mid, a + p, rise, fall))
            a += p
        self._cape_v3_cache = out
        return out

    def cape_phase(self, t: np.ndarray) -> np.ndarray:
        """0 in the higher-voltage phase, 1 in the attenuated phase, raised-cosine between (spec_version 3)."""
        out = np.zeros_like(t)
        c = self.bg.get("cape")
        if not c or self.spec_version < 3 or t.size == 0:
            return out
        self.cape_cycles()
        for a, mid, b, rise, fall in self._cape_v3_cache:
            if b + fall < t[0] or a > t[-1] + rise:
                continue
            up = np.clip((t - (mid - 0.5 * rise)) / rise, 0.0, 1.0)
            down = np.clip((t - (b - 0.5 * fall)) / fall, 0.0, 1.0)
            out = np.maximum(out, 0.5 - 0.5 * np.cos(np.pi * up) - (0.5 - 0.5 * np.cos(np.pi * down)))
        return np.clip(out, 0.0, 1.0)

    def cape_envelope(self, t: np.ndarray) -> np.ndarray:
        """Cyclic alternating pattern of encephalopathy: the second half of every cycle is attenuated
        by ``depth`` with 2 s smooth edges (ACNS: >= 6 cycles of two alternating patterns, each
        phase >= 10 s).  Pure function of absolute time."""
        cyc = self.cape_cycles()
        if not cyc:
            return np.ones_like(t)
        if self.spec_version >= 3:
            # the phase-B spectrum shift (segment: less delta, more theta/beta) removes part of the voltage itself
            return 1.0 - self._CAPE_ENV_SHARE * cyc[0][2] * self.cape_phase(t)
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
        # 0.5.0: a drug-induced suppression keeps low-voltage residual activity, not a dead line (sedation.md S109-06)
        floor = self._ibi_floor0 * (1.0 - deep) + (self._SED_IBI_FLOOR_V3 if self._sed_driven_bs() else 0.005) * deep
        if self._state_intervals:
            # quiet sleep = trace alternant: interburst about 0.42 of the burst voltage (< 50 uV for
            # 100 uV bursts), a little lower in the first hours; other states have no interburst
            early = self.bg.get("hours_of_life") is not None and float(self.bg["hours_of_life"]) < 12.0
            table = {"awake": 1.0, "active_sleep": 1.0, "indeterminate": 0.6, "quiet_sleep": 0.30 if early else 0.42}
            if self.spec_version >= 3:
                if self.bg["type"] == "continuous":
                    table["quiet_sleep"] = self._qs_floor_v3(table["quiet_sleep"])
                else:
                    # 0.5.0 (feature review B1-06: dysmature 34-w quiet sleep got the term 0.42 floor, 0 % < 25 uV):
                    # a discontinuous record keeps its PMA row's interburst voltage in quiet sleep
                    table["quiet_sleep"] = self._ibi_floor0
            floor =self._state_lookup(t, table, np.asarray(floor, dtype=float) * np.ones_like(t))
        points = self.bg.get("ibi_floor_at_h")
        if points:
            floor = np.interp(t / 3600.0, [p[0] for p in points], [p[1] for p in points])
        return floor

    def _neo_sws_w(self, t: np.ndarray) -> np.ndarray:
        """Phase D (neonatal-v3 B1-01/B1-09): weight of the quiet-sleep slow-wave stream.  Quiet sleep 1.0,
        indeterminate 0.25, none in active sleep or wake; grows with maturity from 36 w (trace alternant emerging) to
        term and on to continuous slow-wave sleep by 44 w.  Zero without a state cycle."""
        if self.spec_version < 3 or not self._state_intervals or self._calibrating:
            return np.zeros(t.shape)
        w = float(np.interp(self._pma_eff(), [35.0, 38.0, 40.0, 44.0], [0.0, 0.6, 1.0, 1.25])) * NEO_SWS_W
        if w <= 0:
            return np.zeros(t.shape)
        return w * self._state_lookup(t, {"awake": 0.0, "active_sleep": 0.0, "indeterminate": 0.25,
                                          "quiet_sleep": 1.0}, np.zeros(t.shape))

    def _neo_burst_only_gain(self, t: np.ndarray) -> np.ndarray:
        """(n_elec, n) factor that confines a stream to the bursts once ``burst_envelope_rows`` multiplies everything:
        the interburst floor is divided back out, so the trace-alternant interburst stays low-voltage."""
        rows = self.burst_envelope_rows(t)
        floor = self._ibi_floor_at(t)[None, :]
        e = np.clip((rows - floor) / np.maximum(1.0 - floor, 1e-6), 0.0, None)
        return e / np.maximum(rows, 1e-6)

    def _neo_theta_gain(self, t: np.ndarray) -> np.ndarray:
        """(n_elec, n) factor that gives the theta stream its own interburst floor once ``burst_envelope_rows``
        multiplies everything: theta keeps part of the burst-to-interburst gap back when the interburst is
        trace-alternant-like (floor >= 0.4; a quarter, so the alternation stays visible), none when it is quiescent (TD, floor <= 0.2)."""
        rows = self.burst_envelope_rows(t)
        floor = self._ibi_floor_at(t)[None, :]
        e = np.clip((rows - floor) / np.maximum(1.0 - floor, 1e-6), 0.0, None)
        ft = floor + (1.0 - floor) * 0.25 * smoothstep((floor - 0.2) / 0.2)
        return (ft + (1.0 - ft) * e) / np.maximum(rows, 1e-6)

    def _burst_edge(self) -> Tuple[float, float, float, float, float]:
        if self._sed_driven_bs():
            # 0.5.0: drug-induced bursts start and stop abruptly (learningeeg burst-suppression pages), with the
            # burst-suppression lag and regional tilt
            return (0.12, 0.2, 0.05, 0.08, 0.0)
        if self.spec_version >= 3 and self.bg["type"] == "burst_suppression":
            return BURST_EDGE_BS_V3
        return BURST_EDGE_S.get(self.bg["type"], _BURST_EDGE_DEFAULT)

    #: 0.5.0 burst-onset transient: peak-to-peak as a multiple of amplitude_uv, and the frontocentral foci whose
    #: per-burst weights give it a field that survives the bipolar chain
    _BS_ONSET_GAIN = 1.5
    _BS_ONSET_FOCI = ("F3", "F4", "C3", "C4", "Fz", "Cz")
    _BS_ONSET_NORM = 0.65

    def _burst_onset_rows(self, t: np.ndarray) -> np.ndarray:
        """Sharp-then-slow transient opening each burst (spec_version 3 burst suppression).

        Feature review C21 / learningeeg L4: bursts start abruptly with a high-voltage sharply contoured transient
        rather than on a smooth ramp.  A 30-ms surface-negative sharp component and a 150-ms opposite slow wave
        at 1.5x ``amplitude_uv`` peak-to-peak on the frontocentral maximum; per-burst weights keyed by burst index.
        """
        out = np.zeros((self.n_elec, t.size))
        if t.size == 0:
            return out
        amp = self._BS_ONSET_GAIN * float(self.bg["amplitude_uv"]) * self._BS_ONSET_NORM
        for k in self._bursts_touching(t, 1.0, 1.0):
            a = float(self._burst_start[k])
            if a < t[0] - 1.0 or a > t[-1] + 0.5:
                continue
            rng = substream(self.seed, "bs-onset", k)
            wts = rng.uniform(0.3, 1.0, len(self._BS_ONSET_FOCI))
            g = float(_lognorm(rng, 1, 0.25)[0])
            d = t - (a + 0.03)
            wave = -np.exp(-0.5 * (d / 0.03) ** 2) + 0.55 * np.exp(-0.5 * ((d - 0.12) / 0.075) ** 2)
            field = sum(wi * self._gen_weights(f) for wi, f in zip(wts, self._BS_ONSET_FOCI) if f in self._idx)
            out += field[:, None] * (amp * g * wave)[None, :]
        return out

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
                v3 = self.spec_version >= 3
                vr = substream(self.seed, "cluster-v3", i)
                first = len(out)
                nominal: List[float] = []
                neo = v3 and self.age == "neonate"
                while t <= end + 1e-6:
                    frac = min(max((t - float(ev["start_min"]) * 60.0) / span, 0.0), 1.0)
                    if neo:
                        # 0.5.0 (feature review B4-05/06: 35 near-clones, onset gaps CV 4 %): neonatal seizures run
                        # 10 s to many minutes (ACNS 2013: median 1 min, 75 % <= 2.5 min, range 10 s-46 min), so the
                        # duration is a wide log-normal (sigma 0.7) around the authored MEAN, clipped to 10 s-10 min;
                        # the interictal gap after each run is log-normal (sigma 0.45) around interval - duration
                        # (>= 10 s), so the mean onset spacing and the hourly burden stay as authored; frequency
                        # +-20 %, voltage +-30 %.
                        t_k = t
                        d_k = float(np.clip((dur0 + (dur1 - dur0) * frac) * float(_lognorm(vr, 1, 0.7)[0])
                                            * math.exp(-0.5 * 0.7 ** 2), 10.0, 600.0))
                        f_k = float(_lognorm(vr, 1, 0.20)[0])
                        a_k = float(_lognorm(vr, 1, 0.30)[0])
                        gap = d_k + max(10.0, max(step - (dur0 + (dur1 - dur0) * frac), 10.0)
                                        * float(_lognorm(vr, 1, 0.45)[0]) * math.exp(-0.5 * 0.45 ** 2))
                    elif v3:
                        # 0.5.0 (feature review: B4-02/05/06 near-clones, metronomic sawtooth aEEG): each run
                        # draws its own timing, length, frequencies and voltage around the authored values
                        t_k = t + float(np.clip(vr.normal(0.0, 0.10 * step), -0.25 * step, 0.25 * step))
                        # phase D (seizures-icu-v3 item 2: B4-02 realized burden 31.7 % against 25 %, PQ-G-002 run 6
                        # at 1.75x the ramp): mean-preserving log-normal, clipped to 0.6-1.6x the authored length
                        d_k = (dur0 + (dur1 - dur0) * frac) * float(np.clip(
                            float(_lognorm(vr, 1, 0.35)[0]) * math.exp(-0.5 * 0.35 ** 2), 0.6, 1.6))
                        nominal.append(dur0 + (dur1 - dur0) * frac)
                        f_k = float(_lognorm(vr, 1, 0.12)[0])
                        a_k = float(_lognorm(vr, 1, 0.20)[0])
                    else:
                        t_k = t + float(jit.normal(0.0, step * 0.03))
                        d_k = (dur0 + (dur1 - dur0) * frac) * float(_lognorm(jit, 1, 0.10)[0])
                        f_k = a_k = 1.0
                    out.append(SeizureInstance(
                        t0=t_k,
                        duration_s=d_k,
                        onset_region=z["onset_region"],
                        start_hz=float(evo["start_hz"]) * f_k, end_hz=float(evo["end_hz"]) * f_k,
                        amp_start=float(evo["amplitude_start_uv"]) * a_k,
                        amp_end=float(evo["amplitude_end_uv"]) * a_k,
                        spread=z["spread"], postictal_s=float(z["postictal_attenuation_s"]),
                        morph=z.get("morphology") or "ictal",
                        profile=str(evo.get("profile") or "sweep"),
                        index=i, ordinal=k, kind="seizure_cluster",
                    ))
                    t += gap if neo else step
                    k += 1
                if nominal:
                    # ... and rescaled so the cluster's total ictal time is the authored one (realized burden = authored);
                    # the clip is re-applied, so the sum can differ by a few percent when many draws sit at a bound
                    runs = out[first:]
                    scale = float(np.sum(nominal)) / max(float(np.sum([z.duration_s for z in runs])), 1e-9)
                    for z, d0 in zip(runs, nominal):
                        z.duration_s = float(np.clip(z.duration_s * scale, 0.6 * d0, 1.6 * d0))
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
                        side=str(ev.get("side") or "both") if self.spec_version >= 3 else "both",
                        tonic_s=float(ev.get("tonic_s") or 0.4) if self.spec_version >= 3 else 0.0,
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
                if self.spec_version >= 3:
                    z.clonic = self.spec["events"][z.index].get("clinical_correlate") in ("focal_clonic", "generalized_tonic_clonic")
            if self.spec_version >= 3 and z.kind in ("seizure", "seizure_cluster", "status_epilepticus", "tonic_seizure"):
                ev = self.spec["events"][z.index]
                z.correlate = str(ev.get("clinical_correlate") or "")
                if z.kind != "tonic_seizure":
                    z.onset_pattern = self._onset_pattern(z, (ev.get("seizure") or ev).get("onset_pattern"))
                    if z.onset_pattern == "rhythmic_spikes" and z.morph == "ictal":
                        # a surface-negative sharp transient on the crest of each cycle (_wave "+S" path)
                        z.plus_sharp = self._RHYTHMIC_SPIKE_SHARP
                if (self.age == "neonate" and z.correlate == "focal_clonic" and z.morph == "ictal"
                        and z.kind in ("seizure", "seizure_cluster")):
                    # phase D (ACNS 2013 neonatal; neonatal focal clonic): rhythmic sharp waves / spike discharges
                    # repeating at the clonic rate (0.5-3 Hz) with a jerk locked to each discharge, not the
                    # harmonic theta-delta stack of an electrographic run
                    z.morph = "periodic"
                    z.fluctuate = 0.15
        out.sort(key=lambda z: z.t0)
        if self.spec_version >= 3:
            # 0.5.0 (feature review, PQ-G-002 snr 0.4-1.5): an ictal request can no longer sink into its own
            # background.  Onset at least 1.5x and the established run at least 2x the background peak-to-peak
            # (display-referenced amplitude_uv); evolution.amplitude_mode "absolute" keeps the authored voltages.
            bg_pp = float(self.bg.get("amplitude_uv") or 0.0)
            # a rhythmic_pattern's evolution is the string "none", not a dict
            modes = {i: str(evo.get("amplitude_mode", "relative")) if isinstance(evo, dict) else "relative"
                     for i, evo in ((i, (ev.get("seizure") or ev).get("evolution"))
                                    for i, ev in enumerate(self.spec["events"]))}
            for z in out:
                if z.kind in ("seizure", "seizure_cluster", "status_epilepticus") and z.morph == "ictal"                         and modes.get(z.index) != "absolute" and bg_pp > 0:
                    z.amp_start = max(z.amp_start, 1.5 * bg_pp)
                    z.amp_end = max(z.amp_end, 2.0 * bg_pp)
                elif z.kind == "spasm" and modes.get(z.index) != "absolute" and bg_pp > 0:
                    # 0.5.0 (feature review SPASM): the slow wave is the largest deflection on the page, also on a
                    # hypsarrhythmic background (infantile-spasm-ii: it towers over the 300-uV chaos)
                    z.amp_start = max(z.amp_start, 2.0 * bg_pp)
                    z.amp_end = max(z.amp_end, 2.0 * bg_pp)
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

    #: phase D: "+S" weight of the rhythmic-spike onset (central / parietal / occipital) relative to the run RMS
    _RHYTHMIC_SPIKE_SHARP = 1.6

    def _onset_pattern(self, z: SeizureInstance, given: Optional[str]) -> str:
        """Resolve a v3 run's onset pattern (schema ``onset_pattern``; ``auto`` picks by onset region)."""
        if z.profile != "recruit" or z.morph != "ictal":
            return ""
        if given and given != "auto":
            return str(given)
        if self.age == "neonate":
            # ACNS 2013 neonatal: a rhythmic discharge that builds and evolves; no adult low-voltage fast onset
            return "rhythmic_theta"
        r = z.onset_region
        if r.endswith("mesial_temporal"):
            return "rhythmic_theta"
        if r.endswith("_frontal"):
            return "electrodecrement"
        if r.endswith(("_central", "_parietal", "_occipital")):
            return "rhythmic_spikes"
        return "lvfa"

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
        if self.spec_version >= 3 and rpp3.wants_v3(ev):
            # 0.5.0 phase D (acns-review.md): BIRDs, SI-, evolving/fluctuating, triphasic, sharpness, +F/+R, EDB,
            # prevalence and duration categories
            return rpp3.schedule(self, ev, i)
        rng = substream(self.seed, "rpp", i)
        f0 = float(ev["frequency_hz"])
        amp = float(ev["amplitude_uv"])
        run = max(float(ev["run_duration_s"]), 4.0)
        min_cycles = int(ev.get("min_cycles") or 0)         # EEG Atlas P5 opt-in
        modifier = str(ev.get("modifier") or "").lower()
        plus = str(ev.get("plus_modifier") or "").lower()
        morph = "periodic" if ev.get("periodic") else "rda"
        plus_fast = 0.30 if ("+f" in plus or "fast" in plus) else 0.0
        # 0.5.0 (feature review C30): "+S" was never read; "+FS" carries both
        plus_sharp = (1.0 if self.spec_version >= 3 and morph == "rda"
                      and ("+s" in plus or "+fs" in plus or "sharp" in plus) else 0.0)
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
                f_run = f0 * fmul * fj
                if self.spec_version >= 3 and _RPP_BAND[0] <= f0 <= _RPP_BAND[1]:
                    # 0.5.0 (feature review C27/C31: run rates 0.39-0.46 Hz on a 0.5-Hz card, 4.5-5.0 Hz on a 4-Hz
                    # card): an authored rate inside the ACNS 0.5-4 Hz band stays inside it, including the in-run
                    # drift (+/- _RPP_DRIFT of the rate, see _ictal_phase)
                    f_run = float(np.clip(f_run, _RPP_BAND[0] * (1.0 + _RPP_DRIFT) + 1e-6,
                                          _RPP_BAND[1] * (1.0 - _RPP_DRIFT) - 1e-6))
                out.append(SeizureInstance(
                    t0=t, duration_s=dur, onset_region=region,
                    start_hz=f_run, end_hz=f_run, amp_start=amp, amp_end=amp,
                    spread="none", postictal_s=0.0, index=i, ordinal=k * len(generators) + gi,
                    kind="rhythmic_pattern", morph=morph, fluctuate=fluct,
                    plus_fast=plus_fast, plus_sharp=plus_sharp,
                    # 0.5.0 phase D (epileptiform-v3 C26): a generalized RPP is frontally predominant, not flat
                    predominance=(str(ev.get("predominance") or "frontal")
                                  if self.spec_version >= 3 and region == "generalized" else ""),
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

    def _gpd_field_scale(self) -> np.ndarray:
        """Per-electrode scale that pins the generalized generator sum onto the steep GPD field (v3)."""
        cached = getattr(self, "_gpd_fs", None)
        if cached is None:
            target = gv3.gpd_field_target(self.electrodes)
            fall = mt.generator_falloff("generalized")
            raw = np.zeros(self.n_elec)
            for focus, ga, _ in mt.region_generators("generalized", self.electrodes):
                raw += ga * self._gen_weights(focus, fall)
            cached = np.array([target[e] for e in self.electrodes]) / np.maximum(raw, raw.max() * 1e-6)
            self._gpd_fs = cached
        return cached

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
        if self.spec_version >= 3:
            return self._spasm_rows_v3(inst, t)
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
        field = np.array([mt.table_value(self._SPASM_FIELD, e, 0.0) for e in self.electrodes])
        rows = np.outer(field, slow + fast_on)
        if inst.fast_uv > 0 and inst.decrement_s > 0:
            start = inst.t0 + 0.55 * dur
            w = smoothstep((t - start) / 0.3) * (1.0 - smoothstep((t - (start + inst.decrement_s)) / 0.5))
            f_hz = rng.uniform(16.0, 22.0)
            fast = 0.5 * inst.fast_uv * w * np.sin(2 * np.pi * f_hz * d + rng.uniform(0, 2 * np.pi))
            gen = np.array([0.7 + 0.3 * mt.table_value(self._SPASM_FIELD, e, 0.0) for e in self.electrodes])
            rows += np.outer(gen, fast)
        return rows

    #: 0.5.0 (feature review SPASM): a steep vertex-parietal field.  The 0.3.x field was nearly flat (largest bipolar
    #: difference 0.3; Cz-Pz 0.0), so a 420-uV slow wave measured 59 uV on Cz-Pz against a 58-uV background.  This
    #: one gives every longitudinal chain a share (Fz-Cz 0.45, Cz-Pz 0.40, P3-O1 0.30, F3-C3 0.30, C3-P3 0.25,
    #: T3-T5 0.18) as in infantile-spasm-craig-20260926.png, where Cz-Pz, P3-O1 and the temporal chains carry the
    #: largest deflection on the page.
    #: Phase D (epileptiform-v3 SPASM: the temporal chains carried the least, 1.1-1.9x; in Craig's figure F7-T3,
    #: T3-T5 and the T1/T2 chains are among the largest deflections): F7/F8 and T5/T6 raised to 0.45 with T3/T4 at
    #: 0.15, so every temporal derivation gets 0.25-0.35 of the vertex difference (a flat 0.35 temporal plateau would
    #: cancel in F7-T3).
    _SPASM_FIELD_V3 = {"Cz": 1.0, "C3": 0.70, "C4": 0.70, "Pz": 0.60, "Fz": 0.55, "P3": 0.45, "P4": 0.45,
                       "F3": 0.40, "F4": 0.40, "T5": 0.45, "T6": 0.45, "F7": 0.45, "F8": 0.45,
                       "O1": 0.15, "O2": 0.15, "T3": 0.15, "T4": 0.15, "Fp1": 0.10, "Fp2": 0.10}

    def _spasm_rows_v3(self, inst: SeizureInstance, t: np.ndarray) -> np.ndarray:
        """0.5.0 spasm: a slow wave that is the largest bipolar deflection, visible overriding fast activity.

        ``amplitude_start_uv`` is the slow wave's peak-to-peak on the largest longitudinal-bipolar derivation.
        The fast activity riding the wave (``wave_fast_uv``) and the decrement (``fast_uv``) has a per-electrode
        amplitude field**2 and an independent phase and frequency per electrode, so it survives the bipolar
        subtraction (a common-mode 0.7-1.0 field cancelled).  The wave spreads front to back over 20-40 ms.
        """
        rng = substream(self.seed, "spasm", inst.index, inst.ordinal)
        r3 = substream(self.seed, "spasm-v3", inst.index, inst.ordinal)
        dur = max(inst.duration_s, 0.3)
        jitter = float(np.clip(_lognorm(rng, 1, 0.2)[0], 0.75, 1.3))
        field = np.array([mt.table_value(self._SPASM_FIELD_V3, e, 0.0) for e in self.electrodes])
        fast_side = np.ones(self.n_elec)
        if inst.side in ("left", "right"):
            # phase D asymmetric spasm: the named hemisphere carries the full slow wave, the other 55 % (midline
            # 80 %), and the overriding fast activity is 30 % on the other side
            sgn = -1.0 if inst.side == "left" else 1.0
            xs = np.array([mt.POSITIONS.get(e, (0.0, 0.0))[0] for e in self.electrodes]) * sgn
            other = xs < -0.05
            mid = np.abs(xs) <= 0.05
            field = field * np.where(other, 0.55, np.where(mid, 0.80, 1.0))
            fast_side = np.where(other, 0.30, np.where(mid, 0.65, 1.0))
        pairs = [(self._idx[a], self._idx[b]) for a, b in mt.montage_pairs("longitudinal_bipolar", self.scalp)
                 if b is not None and a in self._idx and b in self._idx]
        max_diff = max((abs(field[a] - field[b]) for a, b in pairs), default=1.0) or 1.0
        ap_lag = float(r3.uniform(0.020, 0.040))
        ypos = np.array([mt.POSITIONS.get(e, (0.0, 0.0))[1] for e in self.electrodes])
        lag = ap_lag * (1.0 - np.clip(ypos, -1.0, 1.0)) / 2.0          # frontal first
        d = (t - inst.t0)[None, :] - lag[:, None]
        wave = (-1.0 * np.exp(-0.5 * ((d - 0.45 * dur) / (0.17 * dur)) ** 2)
                + 0.42 * np.exp(-0.5 * ((d - 0.12 * dur) / (0.10 * dur)) ** 2)
                + 0.50 * np.exp(-0.5 * ((d - 0.85 * dur) / (0.16 * dur)) ** 2))
        rows = field[:, None] * wave * (inst.amp_start / 1.5 / max_diff * jitter)
        f2 = (field ** 2) * fast_side
        n_e = self.n_elec
        f_wave = float(r3.uniform(17.0, 24.0))
        fw = f_wave + r3.normal(0.0, 1.2, n_e)
        ph = r3.uniform(0.0, 2 * np.pi, n_e)
        dd = t - inst.t0
        env_w = np.exp(-0.5 * ((dd - 0.5 * dur) / (0.30 * dur)) ** 2)
        rows += (0.5 * inst.wave_fast_uv * jitter * f2[:, None]
                 * np.sin(2 * np.pi * fw[:, None] * dd[None, :] + ph[:, None]) * env_w[None, :])
        if inst.fast_uv > 0 and inst.decrement_s > 0:
            start = inst.t0 + 0.55 * dur
            w = smoothstep((t - start) / 0.3) * (1.0 - smoothstep((t - (start + inst.decrement_s)) / 0.5))
            f_hz = float(r3.uniform(16.0, 22.0))
            fd = f_hz + r3.normal(0.0, 1.2, n_e)
            pd = r3.uniform(0.0, 2 * np.pi, n_e)
            fb = fd + r3.uniform(3.0, 6.0, n_e)          # a second, beating component: irregular, not a sine train
            pb = r3.uniform(0.0, 2 * np.pi, n_e)
            gen = (0.4 + 0.6 * field) * fast_side
            rows += (0.5 * inst.fast_uv * gen[:, None] * w[None, :]
                     * (0.75 * np.sin(2 * np.pi * fd[:, None] * dd[None, :] + pd[:, None])
                        + 0.5 * np.sin(2 * np.pi * fb[:, None] * dd[None, :] + pb[:, None])))
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
        v3 = self.spec_version >= 3
        for k, fi in enumerate(foci):
            n = max(1, int(span * per * 1.8))
            if v3:
                # 0.5.0: times, widths and amplitudes from per-focus streams, so the first discharges of a focus
                # do not depend on how long a record the synthesizer was built for (page vs answer key)
                times = np.cumsum(_lognorm(substream(self.seed, "multifocal-v3", k, "t"), n, 0.55) / per) - 60.0
                times = times[times < span]
                m = times.size
                width = substream(self.seed, "multifocal-v3", k, "w").uniform(0.85, 1.15, m)
                amps = amp * _lognorm(substream(self.seed, "multifocal-v3", k, "a"), m, 0.30)
            else:
                times = np.cumsum(_lognorm(rng, n, 0.55) / per) - 60.0
                times = times[times < span]
                m = times.size
                width = rng.uniform(0.85, 1.15, m)       # duration scale of the LPD complex
                amps = amp * _lognorm(rng, m, 0.30)
            ev.append(np.column_stack([times, np.full(m, fi, float), width, amps]))
        allev = np.vstack(ev)
        order = np.argsort(allev[:, 0])
        self._mf_spikes = allev[order]
        self._mf_poly = None
        if v3:
            # 0.5.0 (feature review HYPS): the discharges are surface-negative spikes (FWHM ~40 ms) and, for 30 %
            # of them, polyspikes of 2-4 spikes - drawn per discharge, keyed by its own time in ms
            self._mf_poly = []
            for t0 in self._mf_spikes[:, 0]:
                prng = substream(self.seed, "multifocal-poly", int(round(float(t0) * 1000.0)))
                self._mf_poly.append(self._polyspike_params(prng, 3, lo=2) if prng.uniform() < 0.30 else None)

    #: v3 multifocal spike normalization: peak-to-peak of the single spike-and-wave kernel
    _MF_SPIKE_PTP = None

    def _multifocal_spike_rows(self, t: np.ndarray) -> np.ndarray:
        rows = np.zeros((self.n_elec, t.size))
        ev = getattr(self, "_mf_spikes", None)
        if ev is None or t.size == 0:
            return rows
        poly = getattr(self, "_mf_poly", None)
        if poly is not None and Synthesizer._MF_SPIKE_PTP is None:
            grid = np.linspace(-0.3, 1.0, 2600)
            Synthesizer._MF_SPIKE_PTP = float(np.ptp(self._sed_kernel(grid, "spike", 1.0, True)))
        live_ev = (ev[:, 0] > t[0] - 1.0) & (ev[:, 0] < t[-1] + 0.2)
        for j in np.flatnonzero(live_ev):
            t0, fi, width, amp = ev[j]
            d = t - t0
            if poly is not None:
                pp = poly[j]
                if pp is None:
                    complex_ = self._sed_kernel(d, "spike", float(width), True) / Synthesizer._MF_SPIKE_PTP
                    complex_ *= (d > -0.3 * width) & (d < 0.9 * width + 0.35)
                else:
                    lags, gains, troughs = pp
                    complex_ = (-_polyspike_kernel(d, lags, gains, troughs, float(width), True)
                                / _PS_UNIT_PTP)
                    complex_ *= (d > -0.1) & (d < float(lags[-1]) + 0.55)
            else:
                x = d / width
                live = (x >= 0.0) & (x < 1.0)
                complex_ = ((_periodic_template(x) - _PERIODIC_MEAN)
                            / _PERIODIC_RMS / _PERIODIC_PTP)
                complex_ *= live
            w = self._gen_weights(self.electrodes[int(fi)], mt.PINNED_FALLOFF)
            rows += np.outer(w, complex_ * amp)
        return rows


    # ---------------- P7 batch 5: sporadic epileptiform discharges ----------------
    #: Kernel widths (s) for the spike component: a spike is < 70 ms, a sharp wave 70-200 ms.
    _SED_WIDTH = {"spike": 1.0, "sharp_wave": 2.6, "polyspike": 1.0}
    _SED_FALLOFF = 0.60

    @staticmethod
    def _sed_kernel(d: np.ndarray, morph: str, width: float, aftergoing: bool) -> np.ndarray:
        """One surface-NEGATIVE interictal discharge; ``d`` is seconds from the (first) spike peak.

        Asymmetric spike (rise sigma 12 ms, fall 24 ms at width 1 -> FWHM ~42 ms), a small
        opposite overshoot, and an after-going slow wave of the same polarity (~220 ms later).
        A polyspike adds two further spikes 55 ms apart before the wave.
        """
        rise, fall = 0.012 * width, 0.024 * width
        def spk(c):
            return np.exp(-0.5 * ((d - c) / np.where(d < c, rise, fall)) ** 2)
        k = spk(0.0)
        if morph == "polyspike":
            k = k + 0.85 * spk(0.055) + 0.6 * spk(0.110)
        last = 0.110 if morph == "polyspike" else 0.0
        k = k - 0.22 * np.exp(-0.5 * ((d - (last + 0.045 * width + 0.03)) / 0.03) ** 2)
        if aftergoing:
            k = k + 0.55 * np.exp(-0.5 * ((d - (last + 0.12 * width + 0.16)) / 0.09) ** 2)
        return -k

    #: 0.5.0 (spec_version 3) table fields for a sporadic ``focus`` that is not one electrode.  Myoclonic / JME
    #: polyspike-and-wave (eeg0094_db1.png, myoclonic-jerk-examples/p1.webp): bilateral, frontal maximum, largest in
    #: F3-C3 / F4-C4 / Fz-Cz with Fp-F and P-O smaller, temporal chains small.  Weights are chosen for the
    #: longitudinal-bipolar differences, not the referential map (a flat frontocentral field cancels in the chain).
    _SED_FIELDS = {
        "generalized_frontocentral": {
            "F3": 1.0, "F4": 1.0, "Fz": 0.95, "Fp1": 0.55, "Fp2": 0.55, "C3": 0.45, "C4": 0.45, "Cz": 0.45,
            "P3": 0.40, "P4": 0.40, "Pz": 0.35, "F7": 0.35, "F8": 0.35, "T3": 0.30, "T4": 0.30,
            "T5": 0.20, "T6": 0.20, "O1": 0.10, "O2": 0.10},
        # 0.5.0 phase D (montage family): SeLECTS centrotemporal field.  Negative maximum spread over C and T
        # (learningeeg BECTS-centrotemporal-spikes-4-bipolar: reversal at C4 in F4-C4/C4-P4 AND at T4 in F8-T4/T4-T6,
        # also in T2-T4), with the horizontal-dipole frontal positivity (negative weights at Fp/F: surface-positive).
        "left_centrotemporal": {
            "C3": 1.0, "T3": 0.85, "P3": 0.35, "T5": 0.35, "F3": 0.20, "F7": 0.25, "Cz": 0.30, "T1": 0.55,
            "Fp1": -0.20, "Fz": -0.10, "A1": 0.35},
        "right_centrotemporal": {
            "C4": 1.0, "T4": 0.85, "P4": 0.35, "T6": 0.35, "F4": 0.20, "F8": 0.25, "Cz": 0.30, "T2": 0.55,
            "Fp2": -0.20, "Fz": -0.10, "A2": 0.35},
    }
    #: ACNS 2021 "abundant" is >= 1 per 10 s: from that rate up no inter-discharge gap may exceed 10 s.
    _SED_ABUNDANT_PER_H = 360.0

    def _sed_focus_ok(self, focus: str) -> bool:
        return focus in self._idx or (self.spec_version >= 3 and focus in self._SED_FIELDS)

    def _sed_field(self, focus: str) -> np.ndarray:
        if focus in self._idx:
            return self._gen_weights(focus, self._SED_FALLOFF)
        tab = self._SED_FIELDS[focus]
        return np.array([mt.table_value(tab, e, 0.0) for e in self.electrodes])

    #: v3 sporadic schedule block (s): counts, gaps and per-discharge draws are keyed by block, so the schedule does
    #: not depend on the synthesis horizon (a page renders with t0 + window + 60 s, the key with the whole record)
    _SED_BLOCK_S = 600.0

    def _sed_schedule_v3(self, i: int, rate_h: float, a: float, b: float) -> List[Tuple[np.random.Generator, np.ndarray]]:
        """Discharge times with the requested rate over [a, b), in horizon-independent blocks (0.5.0).

        Feature review B5-01/02: lognormal gaps (sigma 0.6) left long empty stretches, so an abundant (480/h)
        record had 10-s epochs with no discharge.  Each 600-s block gets floor(rate x 600 s + u) discharges (the
        authored rate in expectation, exactly for >= 6/h), lognormal gaps of sigma 0.5 (irregular: ACNS abundant is
        "not periodic") clipped to [1 s, 10 s when abundant] and rescaled to the block, so an abundant record meets
        >= 1 per 10 s everywhere, block joins included.  Returns (block rng, times) pairs; the rng then draws that
        block's per-discharge parameters.
        """
        L = self._SED_BLOCK_S
        hi = 10.0 if rate_h >= self._SED_ABUNDANT_PER_H else np.inf
        out = []
        for k in range(int(np.ceil((b - a) / L))):
            rng = substream(self.seed, "sporadic-v3", i, k)
            n = int(np.floor(rate_h * L / 3600.0 + rng.uniform()))
            if n <= 0:
                out.append((rng, np.zeros(0)))
                continue
            gaps = _lognorm(rng, n, 0.5)
            for _ in range(6):
                gaps = np.clip(gaps * (L / float(gaps.sum())), min(1.0, L / n), 0.98 * hi)
            gaps = gaps * (L / float(gaps.sum()))
            # the block's last gap is split across its two ends, so a join between blocks is (g_n + g'_n) / 2:
            # inside the same [1 s, 10 s] limits as every other gap
            out.append((rng, a + k * L + 0.5 * gaps[-1] + np.concatenate([[0.0], np.cumsum(gaps[:-1])])))
        return out

    @staticmethod
    def _polyspike_params(rng: np.random.Generator, n_spikes: int, lo: int = 3):
        """One polyspike's spike lags, heights and troughs (0.5.0; drawn once per discharge).

        Phase D (epileptiform-v3.md B5-04 / HYPS: equal 60-75 ms ISIs and 0.8-1.1 heights read as a 16-Hz sinusoidal
        burst, 81 % of the train's power within 3 Hz of 1/ISI): irregular lognormal ISIs (55-120 ms), unsorted
        heights 0.5-1.2 and small troughs, shared with the generalized polyspike-and-wave (generalized_v3).
        """
        return gv3.polyspike_draw(rng, n_spikes, lo=lo, hi=8)

    def _build_sporadic(self) -> None:
        """Draw every sporadic discharge once: (t0, event index, width, amplitude) sorted by time."""
        self._sed = None
        self._sed_norm = {}
        self._sed_poly: List = []
        # 0.5.0 phase D: per-discharge focus for multi-focus events (None = the event's single ``focus``)
        self._sed_focus: List = []
        evs = [(i, e) for i, e in enumerate(self.spec["events"]) if e["type"] == "sporadic_discharges"]
        if not evs:
            return
        v3 = self.spec_version >= 3
        rows = []
        polys: List = []
        foci_l: List = []
        for i, e in evs:
            rate_h = float(e.get("rate_per_h", 0.0) or 0.0)
            amp = float(e.get("amplitude_uv", 0.0) or 0.0)
            if rate_h <= 0 or amp <= 0 or not self._sed_focus_ok(str(e["focus"])):
                continue
            morph = str(e.get("morphology") or "spike")
            a = float(e["start_min"]) * 60.0 if e.get("start_min") is not None else -60.0
            b = float(e["end_min"]) * 60.0 if e.get("end_min") is not None else self.duration_s + 60.0
            if v3:
                ns = int(e.get("n_spikes") or 5)
                # 0.5.0 phase D (montage family): state-dependent rate.  Discharges are scheduled at the highest
                # stage rate and thinned by rate(stage at t) / max with a separate substream, so a record without
                # the state keys draws exactly what it did before, and the per-discharge draws below do not depend
                # on which discharges survive.  Gating needs the v3 hypnogram (not neonates).
                gated = self._sed_gated(e)
                table = sv3.stage_rate_table(rate_h, e.get("sleep_activation"), e.get("state_rates")) if gated else {}
                r_max = max([rate_h] + list(table.values())) if gated else rate_h
                foci = self._sed_foci(e)
                for k_blk, (brng, times) in enumerate(self._sed_schedule_v3(i, r_max, a, b)):
                    m = times.size
                    if m == 0:
                        continue
                    width = self._SED_WIDTH[morph] * brng.uniform(0.88, 1.12, m)
                    # 0.5.0 (feature review B5-01: a 90-uV request drew 61 uV): the authored voltage is what is drawn,
                    # within -10 / +30 %
                    amps = amp * np.clip(_lognorm(brng, m, 0.10), 0.9, 1.3)
                    pp = ([self._polyspike_params(brng, ns) for _ in range(m)] if morph == "polyspike"
                          else [None] * m)
                    keep = (times >= a) & (times < b)
                    if gated:
                        u = substream(self.seed, "sporadic-state", i, k_blk).uniform(size=m)
                        keep &= u < sv3.rate_at(times, self._hypno, table, rate_h) / max(r_max, 1e-9)
                    if foci is None:
                        fsel = [None] * m
                    elif e.get("synchrony") == "bisynchronous":
                        fsel = [tuple(foci)] * m
                    else:
                        names = [f for f, _ in foci]
                        pr = np.asarray([w for _, w in foci], float)
                        pick = substream(self.seed, "sporadic-foci", i, k_blk).choice(len(names), size=m,
                                                                                      p=pr / pr.sum())
                        fsel = [names[j] for j in pick]
                    rows.append(np.column_stack([times, np.full(m, i, float), width, amps])[keep])
                    polys.extend(p for p, kk in zip(pp, keep) if kk)
                    foci_l.extend(f for f, kk in zip(fsel, keep) if kk)
                if morph == "polyspike":
                    # amplitude_uv is the peak-to-peak of one spike (review B5-04), not of the whole complex
                    self._sed_norm[i] = _PS_UNIT_PTP
                    continue
            else:
                rng = substream(self.seed, "sporadic", i)
                mean_gap = 3600.0 / rate_h / np.exp(0.5 * 0.6 ** 2)   # lognormal gaps: mean = exp(s^2/2) x median
                n = max(2, int((b - a) / mean_gap * 2.0) + 4)
                gaps = np.maximum(_lognorm(rng, n, 0.6) * mean_gap, 1.5)
                times = a + np.cumsum(gaps) - 0.5 * mean_gap
                times = times[(times >= a) & (times < b)]
                m = times.size
                width = self._SED_WIDTH[morph] * rng.uniform(0.88, 1.12, m)
                amps = amp * _lognorm(rng, m, 0.25)
                rows.append(np.column_stack([times, np.full(m, i, float), width, amps]))
                polys.extend([None] * m)
                foci_l.extend([None] * m)
            grid = np.linspace(-0.3, 1.0, 2600)
            k = self._sed_kernel(grid, morph, 1.0, bool(e.get("aftergoing_slow", True)))
            self._sed_norm[i] = float(np.ptp(k))
        if rows:
            allev = np.vstack(rows)
            order = np.argsort(allev[:, 0], kind="stable") if v3 else np.argsort(allev[:, 0])
            self._sed = allev[order]
            self._sed_poly = [polys[j] for j in order]
            self._sed_focus = [foci_l[j] for j in order]

    def _sed_gated(self, e: Dict) -> bool:
        """0.5.0 phase D: does this sporadic event's rate follow the sleep stage (v3 hypnogram + a state key)."""
        return (self.spec_version >= 3 and bool(self._hypno)
                and (e.get("sleep_activation") is not None or bool(e.get("state_rates"))))

    def _sed_foci(self, e: Dict) -> "List[Tuple[str, float]] | None":
        """0.5.0 phase D: ``foci`` of a v3 sporadic event as (focus, weight) pairs, or None for one focus.

        ``synchrony: independent`` (default) gives each discharge ONE focus, drawn with probability proportional
        to ``focus_weights`` (bilateral independent / multifocal); ``bisynchronous`` fires every focus together,
        each at its weight / the largest weight x the discharge amplitude (``focus_weights`` = the asymmetry)."""
        foci = e.get("foci") if self.spec_version >= 3 else None
        if not foci:
            return None
        wts = list(e.get("focus_weights") or [1.0] * len(foci))
        out = [(str(f), float(w)) for f, w in zip(foci, wts) if self._sed_focus_ok(str(f)) and float(w) > 0]
        return out or None

    def stage_rate(self, t: np.ndarray, base: float, sleep_activation: "float | None" = None,
                   state_rates: "Dict[str, float] | None" = None) -> np.ndarray:
        """0.5.0 phase D state-gating hook: the rate a state-dependent event runs at, per time.

        ``base`` is the waking rate (any unit); NREM stages multiply it by ``sleep_activation`` per
        ``state_v3.NREM_ACTIVATION`` and ``state_rates`` overrides named stages.  Crossfaded across stage
        boundaries (20 s).  Without a v3 hypnogram (spec_version < 3 or neonate) it is ``base`` everywhere."""
        table = sv3.stage_rate_table(base, sleep_activation, state_rates)
        return sv3.rate_at(t, self._hypno, table, base)

    def stage_intervals(self, stages: Sequence[str] = sv3.NREM_STAGES) -> List[Tuple[float, float]]:
        """0.5.0 phase D state-gating hook: (start, end) runs of ``stages`` in the record's hypnogram (merged).
        Empty without a v3 hypnogram.  For continuous NREM patterns (ESES / DEE-SWAS) to live in."""
        return sv3.stage_intervals(self._hypno, stages)

    def sporadic_events(self) -> List[Dict]:
        """Realized discharges (for the answer key): dicts with t0, event index, width, amplitude."""
        if getattr(self, "_sed", None) is None:
            return []
        out = []
        poly = getattr(self, "_sed_poly", None) or [None] * len(self._sed)
        fsel = getattr(self, "_sed_focus", None) or [None] * len(self._sed)
        for (t0, i, w, amp), pp, fc in zip(self._sed, poly, fsel):
            e = self.spec["events"][int(i)]
            row = {"t0": float(t0), "index": int(i), "width": float(w), "amplitude_uv": float(amp),
                   "focus": str(e["focus"]), "morphology": str(e.get("morphology") or "spike"),
                   "aftergoing_slow": bool(e.get("aftergoing_slow", True))}
            # 0.5.0 phase D: the focus that actually fired, and the sleep stage it fired in (state-gated events)
            if isinstance(fc, tuple):
                row["focus"] = "+".join(f for f, _ in fc)
                row["foci"] = [f for f, _ in fc]
                row["synchrony"] = "bisynchronous"
            elif fc is not None:
                row["focus"] = fc
                row["synchrony"] = "independent"
            if self._sed_gated(e):
                row["stage"] = str(self.stage_at(np.array([float(t0)]))[0])
            if pp is not None:
                # 0.5.0: the key spans every spike and the after-going wave
                row["n_spikes"] = int(len(pp[0]))
                row["end_s"] = float(t0 + pp[0][-1] + (_PS_WAVE_LAG + 2.0 * _PS_WAVE_SIGMA
                                                       if row["aftergoing_slow"] else 0.05))
            out.append(row)
        return out

    def _sed_rows(self, t: np.ndarray) -> np.ndarray:
        rows = np.zeros((self.n_elec, t.size))
        ev = getattr(self, "_sed", None)
        if ev is None or t.size == 0:
            return rows
        poly = getattr(self, "_sed_poly", None) or [None] * len(ev)
        fsel = getattr(self, "_sed_focus", None) or [None] * len(ev)
        live = (ev[:, 0] > t[0] - 1.2) & (ev[:, 0] < t[-1] + 0.4)
        for j in np.flatnonzero(live):
            t0, i, width, amp = ev[j]
            e = self.spec["events"][int(i)]
            morph = str(e.get("morphology") or "spike")
            d = t - t0
            after = bool(e.get("aftergoing_slow", True))
            pp = poly[j]
            if pp is not None:
                lags, gains, troughs = pp
                k = -_polyspike_kernel(d, lags, gains, troughs, float(width), after)
                k *= (d > -0.1) & (d < float(lags[-1]) + 0.55)
            else:
                k = self._sed_kernel(d, morph, float(width), after)
                k *= (d > -0.3 * width) & (d < 0.9 * width + 0.35)
            k *= amp / max(self._sed_norm.get(int(i), 1.0), 1e-6)
            # a wider field than the pinned LPD one: first neighbours ~1/3, C3-like ~1/2 (Craig, P5: "no field to
            # the other electrodes"); the phase reversal at the focus survives on a bipolar chain
            fc = fsel[j]
            if isinstance(fc, tuple):          # 0.5.0 phase D bisynchronous: every focus at its weight
                w = sum(wt * self._sed_field(f) for f, wt in fc) / max(wt for _, wt in fc)
            else:
                w = self._sed_field(str(e["focus"]) if fc is None else fc)
            rows += np.outer(w, k)
        return rows

    # ---------------- P7 batch 5: pediatric normal variants ----------------
    _VAR_FIELD = {
        # fronto-centro-parietal, generalized and synchronous
        "hypnagogic_hypersynchrony": {"Fz": 1.0, "Cz": 1.0, "F3": 0.95, "F4": 0.95, "C3": 0.95, "C4": 0.95,
                                      "Pz": 0.8, "P3": 0.7, "P4": 0.7, "Fp1": 0.6, "Fp2": 0.6, "F7": 0.5, "F8": 0.5,
                                      "T3": 0.4, "T4": 0.4, "T5": 0.35, "T6": 0.35, "O1": 0.3, "O2": 0.3},
        # occipital
        "posts": {"O1": 1.0, "O2": 1.0, "P3": 0.35, "P4": 0.35, "T5": 0.35, "T6": 0.35, "Pz": 0.3},
        "posterior_slow_waves_of_youth": {"O1": 1.0, "O2": 1.0, "P3": 0.55, "P4": 0.55, "T5": 0.45, "T6": 0.45, "Pz": 0.5},
    }

    def _build_variants(self) -> None:
        """Schedule each enabled variant inside its permitting state (drawn once).

        ``self._variants`` is a list of (t0, t1, name, freq_hz, amplitude_uv, side_asym, count).
        States come from the sleep index: drowsy 0.15-0.75, asleep > 0.55, awake < 0.2.
        """
        self._variants = []
        self._variants_v3: List[Tuple[str, Dict]] = []
        cfg = self.bg.get("variants") or {}
        if not cfg:
            return
        if self.spec_version >= 3 and self._hypno:
            self._build_variants_v3(cfg)
            return
        grid = np.arange(-60.0, self.duration_s + 60.0, 1.0)
        sleep = self._sleep_at(grid)
        gate = {"hypnagogic_hypersynchrony": (sleep > 0.15) & (sleep < 0.75),
                "posts": sleep > 0.55,
                "posterior_slow_waves_of_youth": sleep < 0.2}
        for j, name in enumerate(("hypnagogic_hypersynchrony", "posts", "posterior_slow_waves_of_youth")):
            c = cfg.get(name)
            if not c or not c.get("enabled", True):
                continue
            rate = float(c.get("rate_per_min", 0.0) or 0.0)
            amp = float(c.get("amplitude_uv", 0.0) or 0.0)
            if name == "posterior_slow_waves_of_youth" and amp <= 0:
                # fused with the PDR, so it must stand above the occipital rhythm it rides: 1.5 x the
                # background scaled by the PDR gain the streams apply at O1/O2 (0.62 x pdr_gain)
                amp = 1.5 * float(self.bg["amplitude_uv"]) * max(1.0, 0.62 * float(getattr(self, "pdr_gain", 1.0)))
            if rate <= 0 or amp <= 0:
                continue
            rng = substream(self.seed, "variant", j)
            ok = gate[name]
            gap = 60.0 / rate / np.exp(0.5 * 0.4 ** 2)
            t = -60.0 + float(_lognorm(rng, 1, 0.4)[0]) * gap
            while t < self.duration_s + 60.0:
                gi = int(np.clip(round(t + 60.0), 0, grid.size - 1))
                if ok[gi]:
                    if name == "hypnagogic_hypersynchrony":
                        dur = float(rng.uniform(1.0, 3.0)); f = float(rng.uniform(3.0, 5.0)); cnt = 0
                    elif name == "posts":
                        cnt = int(rng.integers(3, 7)); f = float(rng.uniform(4.0, 5.0)); dur = cnt / f
                    else:
                        cnt = int(rng.integers(1, 3)); f = float(rng.uniform(2.5, 4.5)); dur = cnt / f
                    self._variants.append((t, t + dur, name, f, amp * float(_lognorm(rng, 1, 0.2)[0]),
                                           float(rng.uniform(-0.25, 0.25)), cnt))
                    t += dur
                t += float(_lognorm(rng, 1, 0.4)[0]) * gap
        self._variants.sort(key=lambda r: r[0])

    #: 0.5.0: HH amplitude_uv means the peak-to-peak a reader measures in the best longitudinal-bipolar derivation
    #: (review B5-06: the broad field showed 0.44 of the request on the chain); this undoes the lagged-field loss
    _HH_BIPOLAR_CAL = 1.5
    #: 0.5.0: default PSWY peak (O1, uV) per uV of background amplitude x the occipital PDR weight; tuned so the
    #: displayed P3-O1 / T5-O1 wave is about twice the eyes-closed background p2p (Craig, B5-08: "can't see them")
    _PSWY_PER_BG = 1.8

    def _build_variants_v3(self, cfg: Dict) -> None:
        """0.5.0 scheduled variants driven by the hypnogram and eye state (drawn once per record).

        HH: N1 (hypnagogic) and at arousals out of N2/N3 (hypnopompic, Craig's reference figure).  POSTS: episodic
        trains through N1-N2.  PSWY: wake with eyes closed, where the PDR they ride on is present.
        """
        def merged(stages):
            out = []
            for a, b, st in self._hypno:
                if st not in stages:
                    continue
                a, b = max(a, -60.0), min(b, self.duration_s + 60.0)
                if b <= a:
                    continue
                if out and abs(out[-1][1] - a) < 1e-6:
                    out[-1] = (out[-1][0], b)
                else:
                    out.append((a, b))
            return out

        c = cfg.get("hypnagogic_hypersynchrony")
        if c and c.get("enabled", True) and float(c.get("rate_per_min") or 0) > 0:
            amp = float(c.get("amplitude_uv") or 0.0) * self._HH_BIPOLAR_CAL
            deep = [(a, b) for a, b, st in self._hypno if st in ("N2", "N3")]
            starts = [a for a, w in self._arousals_v3 if any(x0 <= a < x1 for x0, x1 in deep)]
            for r in vv3.hh_schedule(self.seed, merged(("N1",)), float(c["rate_per_min"]), amp, starts):
                self._variants_v3.append(("hypnagogic_hypersynchrony", r))
        c = cfg.get("posts")
        if c and c.get("enabled", True) and float(c.get("amplitude_uv") or 0) > 0:
            for r in vv3.posts_schedule(self.seed, merged(("N1", "N2")), float(c["amplitude_uv"])):
                self._variants_v3.append(("posts", r))
        c = cfg.get("posterior_slow_waves_of_youth")
        if c and c.get("enabled", True) and float(c.get("rate_per_min") or 0) > 0:
            amp = float(c.get("amplitude_uv") or 0.0)
            if amp <= 0:
                amp = self._PSWY_PER_BG * float(self.bg["amplitude_uv"]) * max(1.0, 0.62 * self.pdr_gain)
            wake = merged(("W",))
            if self._eyes:
                closed = [(a, b) for a, b, st in self._eyes if st == "closed" and b - a > 2.0]
                wake = [(max(a, x0) + 1.0, min(b, x1) - 0.5) for a, b in wake for x0, x1 in closed
                        if min(b, x1) - max(a, x0) > 2.0]
            for r in vv3.pswy_schedule(self.seed, wake, float(c["rate_per_min"]), amp, self.dominant_hz):
                self._variants_v3.append(("posterior_slow_waves_of_youth", r))
        self._variants_v3.sort(key=lambda kr: kr[1]["t0"])
        pos = np.array([mt.POSITIONS.get(e, (0.0, 0.0)) for e in self.electrodes])
        self._var_y = pos[:, 1]
        self._var_xs = np.sign(np.where(np.abs(pos[:, 0]) < 1e-6, 0.0, pos[:, 0]))

    def variant_runs(self) -> List[Dict]:
        if getattr(self, "_variants_v3", None):
            return [{"t0": r["t0"], "t1": r["t1"], "variant": nm, "frequency_hz": float(r.get("hz", 0.0)),
                     "amplitude_uv": float(r["amp"]), "count": int(len(r["times"]) if nm == "posts" else r.get("count", 0))}
                    for nm, r in self._variants_v3]
        return [{"t0": a, "t1": b, "variant": nm, "frequency_hz": f, "amplitude_uv": amp, "count": cnt}
                for a, b, nm, f, amp, asym, cnt in getattr(self, "_variants", [])]

    def _variant_rows_v3(self, t: np.ndarray) -> np.ndarray:
        rows = np.zeros((self.n_elec, t.size))
        for nm, r in self._variants_v3:
            if r["t1"] < t[0] - 0.5 or r["t0"] > t[-1] + 0.5:
                continue
            if nm == "hypnagogic_hypersynchrony":
                rows += vv3.hh_rows(r, t, self.electrodes, self._var_y, self._var_xs)
            elif nm == "posts":
                rows += vv3.posts_rows(r, t, vv3.side_field("posts", self.electrodes, "left"),
                                       vv3.side_field("posts", self.electrodes, "right"))
            else:
                w = vv3.pswy_wave(r, t)
                rows += np.outer(vv3.side_field(nm, self.electrodes, "left") * r["gl"]
                                 + vv3.side_field(nm, self.electrodes, "right") * r["gr"], w)
        return rows

    def _variant_rows(self, t: np.ndarray) -> np.ndarray:
        if getattr(self, "_variants_v3", None):
            return self._variant_rows_v3(t)
        rows = np.zeros((self.n_elec, t.size))
        runs = getattr(self, "_variants", None)
        if not runs or t.size == 0:
            return rows
        for a, b, name, f, amp, asym, cnt in runs:
            if b < t[0] - 0.5 or a > t[-1] + 0.5:
                continue
            d = t - a
            dur = b - a
            if name == "hypnagogic_hypersynchrony":
                env = np.sin(np.pi * np.clip(d / dur, 0.0, 1.0)) ** 0.7 * ((d >= 0) & (d <= dur))
                ph = 2 * np.pi * f * d
                # rhythmic delta-theta with a sharpened crest ("sharp or spiky components")
                wave = -(np.sin(ph) + 0.28 * np.sin(2 * ph + 0.6)) * env * (0.5 * amp / 1.15)
            elif name == "posts":
                # monophasic surface-POSITIVE triangular transients at 4-5 Hz
                wave = np.zeros_like(t)
                for k in range(cnt):
                    c = k / f
                    dd = d - c
                    wave += np.exp(-0.5 * (dd / np.where(dd < 0, 0.055, 0.035)) ** 2)
                wave *= amp * (1.0 - 0.15 * np.abs(np.sin(np.pi * d / dur)))
            else:
                # posterior slow waves of youth: 1-2 surface-negative delta waves fused with the PDR
                wave = np.zeros_like(t)
                for k in range(cnt):
                    c = (k + 0.5) / f
                    wave += np.exp(-0.5 * ((d - c) / (0.22 / f * 1.6)) ** 2)
                wave *= -0.7 * amp        # a slow wave that stands above the alpha it is fused with
            base = self._VAR_FIELD[name]
            field = np.array([base.get(e, 0.0) * (1.0 + asym * (1 if mt.POSITIONS.get(e, (0.0,))[0] > 1e-6 else -1 if mt.POSITIONS.get(e, (0.0,))[0] < -1e-6 else 0))
                              for e in self.electrodes])
            rows += np.outer(field, wave)
        return rows

    _AUTHORED_FIELDS = {
        "mu": {"C3": 1.0, "C4": 1.0, "Cz": 0.8, "F3": 0.25, "F4": 0.25, "P3": 0.35, "P4": 0.35},
        "lambda": {"O1": 1.0, "O2": 1.0, "P3": 0.35, "P4": 0.35},
        "wicket": {"T3": 1.0, "T4": 1.0, "F7": 0.35, "F8": 0.35, "T5": 0.45, "T6": 0.45},
        "fourteen_and_six": {"T5": 1.0, "T6": 1.0, "O1": 0.45, "O2": 0.45, "P3": 0.35, "P4": 0.35},
        "rmtd": {"T3": 1.0, "T4": 1.0, "T5": 0.65, "T6": 0.65},
        "sreda": {"T5": 1.0, "T6": 1.0, "P3": 0.75, "P4": 0.75, "T3": 0.5, "T4": 0.5},
        "frontal_arousal_rhythm": {"Fp1": 0.8, "Fp2": 0.8, "F3": 1.0, "F4": 1.0, "Fz": 1.0, "C3": 0.35, "C4": 0.35},
        "photic_driving": {"O1": 1.0, "O2": 1.0, "P3": 0.5, "P4": 0.5, "Pz": 0.4},
        "hyperventilation_buildup": {"Fp1": 0.8, "Fp2": 0.8, "F3": 1.0, "F4": 1.0, "C3": 0.85, "C4": 0.85,
                                      "P3": 0.65, "P4": 0.65, "O1": 0.45, "O2": 0.45},
    }

    def _authored_variant_eligible(self, ev: Dict) -> bool:
        """Authored teaching policy plus state checks over the emitted interval."""
        kind = str(ev["kind"])
        if kind == "sreda" and self.age != "adult":
            return False
        if kind == "lambda" and self.age not in ("child", "adolescent"):
            return False
        if kind == "frontal_arousal_rhythm" and self.age not in ("infant", "child"):
            return False
        start = float(ev["at_min"]) * 60.0
        end = start + float(ev["duration_s"])
        probes = np.linspace(start, end, max(3, int(np.ceil(end - start)) + 1))
        sleep = self._sleep_at(probes)
        context = ev["context"]
        required_context = {
            "mu": "movement", "lambda": "visual_scanning", "wicket": "drowsy",
            "fourteen_and_six": "light_sleep", "rmtd": "drowsy",
            "sreda": "adult_teaching", "frontal_arousal_rhythm": "arousal",
            "photic_driving": "photic", "hyperventilation_buildup": "hyperventilation",
        }[kind]
        if context != required_context:
            return False
        if context in ("awake", "movement", "visual_scanning", "photic", "hyperventilation"):
            return bool(np.all(sleep < 0.2))
        if context == "drowsy":
            return bool(np.all((sleep > 0.15) & (sleep < 0.75)))
        if context == "light_sleep":
            if self.spec_version >= 3 and self._hypno:
                # 0.5.0: staged sleep - drowsiness through N2 is light sleep (14 & 6 occur from N1)
                return bool(np.all(np.isin(self.stage_at(probes), ["N1", "N2"])))
            return bool(np.all(sleep > 0.55))
        if context == "arousal":
            return any(at <= start and end <= at + width for at, width in self._arousals)
        return True

    def _build_authored_variants(self) -> None:
        self._authored_variants = []
        for index, ev in enumerate(self.spec["events"]):
            if ev["type"] != "normal_variant" or not self._authored_variant_eligible(ev):
                continue
            a = float(ev["at_min"]) * 60.0
            b = a + float(ev["duration_s"])
            blocks = []
            if ev["kind"] == "mu" and ev.get("block_at_min") is not None:
                ba = float(ev["block_at_min"]) * 60.0
                blocks = [(ba, ba + float(ev.get("block_duration_s", 1.0)))]
            run = {"t0": a, "t1": b, "variant": ev["kind"],
                "frequency_hz": float(ev["frequency_hz"]), "amplitude_uv": float(ev["amplitude_uv"]),
                "side": ev.get("side", "both"), "context": ev["context"], "blocks": blocks,
                "spec_event_index": index}
            if self.spec_version >= 3:
                # 0.5.0: bursts / trains drawn once per event, each hemisphere on its own schedule
                run["bursts"] = vv3.authored_schedule(self.seed, index, run)
            self._authored_variants.append(run)
        # 0.5.0: visual scanning and movement hold the eyes open (lambda, and mu is read with the PDR attenuated -
        # Mu-IV, very-nice-Mu); photic stimulation holds them closed
        self._eye_force = [(r["t0"], r["t1"], "closed" if r["context"] == "photic" else "open")
                           for r in self._authored_variants
                           if self.spec_version >= 3 and r["context"] in ("visual_scanning", "movement", "photic")]
        pos = np.array([mt.POSITIONS.get(e, (0.0, 0.0)) for e in self.electrodes])
        self._av_y = pos[:, 1]

    #: 0.5.0: kinds keyed per train (the key follows what is visible), not per authored window
    _AV_TRAIN_KEYED = ("mu", "wicket", "fourteen_and_six", "rmtd", "frontal_arousal_rhythm")

    def authored_variant_runs(self) -> List[Dict]:
        out = []
        for run in self._authored_variants:
            intervals = [(run["t0"], run["t1"])]
            if run.get("bursts") and run["variant"] in self._AV_TRAIN_KEYED:
                intervals = []
                for bu in sorted(run["bursts"], key=lambda x: x["t0"]):
                    if bu["amp"] < 0.3 * run["amplitude_uv"]:
                        continue            # the attenuated side of an authored one-sided variant
                    if intervals and bu["t0"] <= intervals[-1][1]:
                        intervals[-1] = (intervals[-1][0], max(intervals[-1][1], bu["t1"]))
                    else:
                        intervals.append((bu["t0"], bu["t1"]))
            for ba, bb in run["blocks"]:
                intervals = [(a, min(b, ba)) for a, b in intervals if a < ba] + \
                            [(max(a, bb), b) for a, b in intervals if b > bb]
            for a, b in intervals:
                if b > a:
                    out.append({**run, "t0": a, "t1": b})
        return out

    def _authored_variant_rows_v3(self, t: np.ndarray) -> np.ndarray:
        rows = np.zeros((self.n_elec, t.size))
        for run in self._authored_variants:
            kind = run["variant"]
            tail = 25.0 if kind == "hyperventilation_buildup" else 0.5
            if run["t1"] + tail < t[0] or run["t0"] > t[-1] + 0.5:
                continue
            sc = vv3.bipolar_scale(kind, self.electrodes)
            fields = {sd: sc * vv3.side_field(kind, self.electrodes, sd) for sd in ("left", "right")}
            part = np.zeros((self.n_elec, t.size))
            gaze = np.zeros(t.size)
            for bu in run["bursts"]:
                if kind == "hyperventilation_buildup":
                    part += vv3.hv_rows(bu, t, fields[bu["side"]], self._av_y)
                    continue
                if kind == "lambda" and bu["side"] == "left" and t[0] - 3.0 < bu["saccade"] < t[-1] + 0.1:
                    # the saccade that times each lambda: a lateral eye movement step at F7/F8 (opposed)
                    gaze += bu["gaze"] * np.clip((t - bu["saccade"]) / 0.03, 0.0, 1.0) * (t < bu["saccade"] + 3.0)                         * np.exp(-np.clip(t - bu["saccade"], 0.0, None) / 0.6)
                if bu["t1"] < t[0] - 0.3 or bu["t0"] > t[-1] + 0.3:
                    continue
                part += np.outer(fields[bu["side"]], vv3.burst_wave(kind, bu, t))
            if kind == "lambda" and gaze.any():
                lat = np.array([mt.table_value({"F7": 1.0, "F8": -1.0, "Fp1": 0.35, "Fp2": -0.35, "T3": 0.25, "T4": -0.25}, e, 0.0)
                                for e in self.electrodes])
                part += np.outer(lat, 30.0 * gaze)
            for ba, bb in run["blocks"]:
                part[:, (t >= ba) & (t < bb)] = 0.0
            rows += part
        return rows

    def _authored_variant_rows(self, t: np.ndarray) -> np.ndarray:
        if self.spec_version >= 3:
            return self._authored_variant_rows_v3(t)
        rows = np.zeros((self.n_elec, t.size))
        for run in self.authored_variant_runs():
            a, b, kind = run["t0"], run["t1"], run["variant"]
            if b < t[0] or a > t[-1]:
                continue
            d = t - a
            live = (t >= a) & (t < b)
            dur = max(b - a, 1e-6)
            edge = np.sin(np.pi * np.clip(d / dur, 0.0, 1.0)) ** 0.4 * live
            f, amp = run["frequency_hz"], run["amplitude_uv"]
            phase = 2 * np.pi * f * d
            if kind == "mu":
                # Arciform central rhythm: rounded positive arches with a
                # smaller return phase rather than a featureless sine.
                s = np.sin(phase)
                wave = (np.maximum(s, 0.0) ** 1.6 + 0.35 * np.minimum(s, 0.0)) * edge * amp
            elif kind == "lambda":
                wave = np.maximum(np.sin(phase), 0.0) ** 4 * edge * amp
            elif kind == "wicket":
                wave = np.maximum(np.sin(phase), 0.0) ** 1.5 * edge * amp
            elif kind == "fourteen_and_six":
                # A selected 14- or 6-Hz positive burst, not simultaneous
                # superposed frequencies.
                burst = (np.sin(2 * np.pi * 0.65 * d) > -0.15).astype(float)
                wave = np.maximum(np.sin(phase), 0.0) ** 2 * burst * edge * amp
            elif kind == "hyperventilation_buildup":
                ramp = np.sin(np.pi * np.clip(d / dur, 0.0, 1.0))
                wave = np.sin(phase) * ramp * amp
            else:
                wave = np.sin(phase) * edge * amp
            field_map = self._AUTHORED_FIELDS[kind]
            field = np.array([mt.table_value(field_map, e, 0.0) for e in self.electrodes])
            if run["side"] in ("left", "right"):
                want = -1 if run["side"] == "left" else 1
                field *= np.array([1.0 if np.sign(mt.POSITIONS.get(e, (0.0, 0.0))[0]) == want else 0.12
                                   for e in self.electrodes])
            rows += np.outer(field, wave)
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
            if inst.rpp is not None:
                out += rpp3.rows(self, inst, t)
                continue
            if inst.kind == "tonic_seizure" and self.spec_version >= 3:
                continue          # 0.5.0 phase D: generalized_v3 draws its paroxysmal fast activity
            phase, u, amp, f_inst = self._ictal_phase(inst, t)
            if phase is None:
                continue
            psi = substream(self.seed, "szharm", inst.index).uniform(0, 2 * np.pi, 4)
            base = int(self.seed) * 31 + inst.index * 1009 + inst.ordinal * 101
            v3run = (self.spec_version >= 3 and inst.morph == "ictal"
                     and inst.kind in ("seizure", "seizure_cluster", "status_epilepticus"))
            late = None
            spread = self._spread_region(inst)
            if spread is None:
                s = np.zeros_like(u)
                phase_d = None
                if v3run and inst.duration_s > 30.0:
                    # 0.5.0 (feature review B4-01: a 12-min status stayed in 3-4 derivations): a run longer than
                    # 30 s spreads late through its own hemisphere at half voltage, without leaving the onset zone
                    hemi = mt.HEMISPHERE_OF_REGION.get(inst.onset_region, "both")
                    if hemi in ("left", "right") and inst.onset_region != f"{hemi}_hemisphere":
                        late = f"{hemi}_hemisphere"
                        t_late = float(np.clip(0.30 * inst.duration_s, 15.0, 45.0))
                        s = 0.5 * smoothstep((t - inst.t0 - t_late) / 8.0)
                        phase_d, _, _, f_d = self._ictal_phase(inst, t - 0.18)
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
            psi_d = psi
            if v3run:
                # 0.5.0 (feature review B4-02/C14/C18: harmonic comb on the CSA): per-cycle period and
                # morphology jitter, keyed by the absolute cycle index so every window sees the same run
                psi0 = psi
                psi = self._cycle_psi(phase, psi0, base)
                phase = self._cycle_warp(phase, base)
                if phase_d is not None:
                    psi_d = self._cycle_psi(phase_d, psi0, base)
                    phase_d = self._cycle_warp(phase_d, base)
            if late is not None:
                spread = late

            # One jitter stream per discharge, shared by every generator, with
            # the head-wide desynchrony carried by each generator's y position.
            # Independent per-generator noise would be averaged away: ~19
            # generators sum into every electrode.
            v3 = self.spec_version >= 3
            onset_scale = self._field_scale(inst.onset_region)
            gpd = (v3 and inst.kind == "rhythmic_pattern" and inst.morph == "periodic"
                   and inst.onset_region == "generalized")
            if inst.predominance and inst.onset_region == "generalized":
                # ACNS family: predominance-shaped generalized field, calibrated on the strongest bipolar link.  Chosen
                # over generalized_v3's steeper GPD field at merge: that one left Cz-Pz at background level (23 vs 24 uV)
                onset_scale = rpp3.field_scale(self, inst.predominance)
            elif gpd:
                # 0.5.0 phase D (epileptiform-v3.md C26: GPDs fell to 20-30 uV bipolar, 0.30x referential Fz, because
                # the near-uniform generalized field reached the chain only through the inter-electrode lag)
                onset_scale = self._gpd_field_scale()
            onset_fall = mt.generator_falloff(inst.onset_region)
            gens = [(g, 1.0) for g in mt.region_generators(inst.onset_region, self.electrodes, v3=v3run)]
            if v3 and inst.kind == "tonic_seizure":
                # phase D (learningeeg atlas-tonic-seizure-i/-ii: 10-20 Hz fast activity in every chain, parasagittal
                # and midline included): the generalized fast activity was near-synchronous at 15-22 Hz, so it
                # cancelled in the bipolar chain and only temporal EMG showed.  Each generator gets its own phase.
                gph_r = substream(self.seed, "tonic-desync", inst.index).uniform(0.0, 1.0, len(gens))
                # overlapping monopoles still halve the bipolar voltage (Fz 97 uV referential, 20-45 uV bipolar):
                # the authored peak-to-peak is the displayed bipolar value, as for every v3 ictal request
                gens = [((g[0], g[1] * self._TONIC_BIPOLAR_GAIN, float(p)), j) for (g, j), p in zip(gens, gph_r)]
            clon = self._gtc_gate(inst, t) if v3 else None
            extra = [g for g in mt.FOCAL_RECRUIT_GENERATORS.get(inst.onset_region, []) if g[0] in self._idx] if v3run else []
            if extra:
                # 0.5.0 (feature review B4-01, learningeeg L1): the rest of the chain joins over the first ~10 s
                delays = substream(self.seed, "szfield", inst.index, inst.ordinal).uniform(1.0, 7.0, len(extra))
                gens += [(g, smoothstep((t - inst.t0 - d) / 3.0)) for g, d in zip(extra, delays)]
            onset_keep = (1.0 - 0.55 * s) if late is None else 1.0
            for gi, ((focus, ga, gph), join) in enumerate(gens):
                w = self._gen_weights(focus, onset_fall) * onset_scale
                wv = (self._wave(phase, psi, gph, inst.morph, inst.plus_fast,
                                 f_inst, base, mt.POSITIONS.get(focus, (0.0, 0.0))[1],
                                 base + 7919 * (gi + 1), v3, inst.plus_sharp, gpd)
                      * amp * ga * onset_keep * join)
                if clon is not None:
                    wv = wv * clon
                out += w[:, None] * wv[None, :]
            if spread is not None and phase_d is not None:
                spread_scale = self._field_scale(spread)
                spread_fall = mt.generator_falloff(spread)
                for gi, (focus, ga, gph) in enumerate(
                        mt.region_generators(spread, self.electrodes)):
                    w = self._gen_weights(focus, spread_fall) * spread_scale
                    wv = (self._wave(phase_d, psi_d, gph, inst.morph, inst.plus_fast,
                                     f_d, base + 500_003,
                                     mt.POSITIONS.get(focus, (0.0, 0.0))[1],
                                     base + 500_003 + 7919 * (gi + 1), v3, inst.plus_sharp)
                          * amp * ga * s)
                    if clon is not None:
                        wv = wv * clon
                    out += w[:, None] * wv[None, :]
        return out

    # ---------------- phase D: generalized tonic-clonic phases and v3 ictal EMG ----------------

    #: phase D: v3 tonic-seizure fast activity gain so the authored voltage is what the bipolar chain shows
    _TONIC_BIPOLAR_GAIN = 2.2

    def _is_gtc(self, inst: SeizureInstance) -> bool:
        """A v3 run keyed generalized_tonic_clonic that is (or becomes) bilateral."""
        return (self.spec_version >= 3 and inst.correlate == "generalized_tonic_clonic" and inst.morph == "ictal"
                and inst.kind in ("seizure", "seizure_cluster", "status_epilepticus")
                and (inst.onset_region == "generalized" or inst.spread in ("generalized", "bilateral")))

    def _gtc_times(self, inst: SeizureInstance) -> Tuple[float, float]:
        """(bilateral onset, clonic onset) in seconds.  The spread reaches half weight at 45 % of a focal run
        (_seizure_block); the tonic phase lasts a quarter of the rest, 8-20 s (learningeeg atlas-r-temporal-to-
        bilateral-tcs p3: whole-head tonic EMG; p5: clonic bursts slowing, near-silent pauses between)."""
        t_b = inst.t0 + (0.0 if inst.onset_region == "generalized" else 0.45 * inst.duration_s)
        t_c = t_b + float(np.clip(0.25 * (inst.t1 - t_b), 8.0, 20.0))
        return t_b, min(t_c, inst.t1 - 2.0)

    #: clonic burst rate at the start and end of the clonic phase (Hz): clonic jerks slow before they stop
    _GTC_CLONIC_HZ = (3.0, 1.0)

    def _gtc_pulse(self, inst: SeizureInstance, t: np.ndarray):
        """(tonic weight, clonic weight, burst pulse 0..1) of a GTC run, from absolute time (window-independent)."""
        t_b, t_c = self._gtc_times(inst)
        tonic = smoothstep((t - t_b) / 3.0) * (1.0 - smoothstep((t - t_c) / 1.0))
        clonic = smoothstep((t - t_c) / 1.0) * (1.0 - smoothstep((t - inst.t1) / 0.5))
        tc = max(inst.t1 - t_c, 1.0)
        f0, f1 = self._GTC_CLONIC_HZ
        tau = np.clip(t - t_c, 0.0, tc)
        r = f1 / f0
        cyc = f0 * tc * (np.power(r, tau / tc) - 1.0) / math.log(r)
        pulse = (0.5 + 0.5 * np.cos(2 * np.pi * cyc)) ** 6
        return tonic, clonic, pulse

    def _gtc_gate(self, inst: SeizureInstance, t: np.ndarray) -> Optional[np.ndarray]:
        """Cerebral amplitude through the clonic phase: bursts, with the pauses at 25 % (None if not a GTC)."""
        if not self._is_gtc(inst):
            return None
        _, clonic, pulse = self._gtc_pulse(inst, t)
        return 1.0 - clonic * (1.0 - (0.25 + 0.75 * pulse))

    def _v3_emg_kind(self, inst: SeizureInstance) -> Optional[str]:
        """Runs whose EMG is drawn by _ictal_emg_rows_v3 instead of ictal_gate."""
        if self.spec_version < 3:
            return None
        if inst.kind == "spasm":
            return "spasm"
        if self._is_gtc(inst):
            return "gtc"
        if self.age == "neonate" and inst.correlate == "focal_clonic" and inst.morph == "periodic":
            return "neo_clonic"
        if (self.age == "neonate" and inst.correlate == "focal_tonic"
                and inst.kind in ("seizure", "seizure_cluster") and inst.muscle != "none"):
            return "neo_tonic"
        return None

    #: phase D ictal EMG, in units of the muscle floor weight (EMG_FLOOR_W) before the background scale:
    #: spasm burst (infantile-spasm-i/-ii: the most striking high-frequency event on the page), GTC tonic phase
    #: (whole head obscured), neonatal clonic jerk
    _EMG_V3_GAIN = {"spasm": 5.0, "gtc": 9.0, "neo_clonic": 2.5, "neo_tonic": 2.0}
    _EMG_V3_OFFSET = 1_500_000_000

    def _emg_field_v3(self, kind: str, inst: SeizureInstance) -> np.ndarray:
        key = ("emgf", kind, inst.onset_region, inst.side)
        cache = self.__dict__.setdefault("_emgf_cache", {})
        if key not in cache:
            x = np.array([abs(mt.POSITIONS.get(e, (0.0, 0.0))[0]) for e in self.electrodes])
            y = np.array([mt.POSITIONS.get(e, (0.0, 0.0))[1] for e in self.electrodes])
            if kind in ("neo_clonic", "neo_tonic"):
                w = 0.3 + 0.7 * self._postictal_field(inst)
            elif kind == "spasm":
                # temporalis / neck: the burst is in the temporal chains (F7-T3, T1-T3 in infantile-spasm-i), little
                # parasagittally, none at the vertex
                w = np.clip((x - 0.35) / 0.5, 0.08, 1.0)
                if inst.side in ("left", "right"):
                    sgn = -1.0 if inst.side == "left" else 1.0
                    xs = np.array([mt.POSITIONS.get(e, (0.0, 0.0))[0] for e in self.electrodes]) * sgn
                    w = w * np.where(xs < -0.05, 0.45, 1.0)
            else:
                # frontotemporal maximum (temporalis, frontalis), parasagittal less, midline least
                w = np.clip(0.35 + 0.65 * x + 0.15 * np.clip(y, 0.0, 1.0), 0.3, 1.0)
            cache[key] = w
        return cache[key]

    def _ictal_emg_rows_v3(self, t: np.ndarray, i0: int, n: int) -> np.ndarray:
        """Phase D ictal EMG, independent per electrode (so it survives the bipolar chain), added after the
        background envelopes: an electrodecrement or a burst-suppression gate no longer damps it (epileptiform-v3
        SPASM: the spasm burst rose only 1.2-2x because the decrement multiplied it)."""
        out = np.zeros((self.n_elec, n))
        if self.spec_version < 3 or t.size == 0:
            return out
        lo, hi = float(t[0]), float(t[-1])
        noise = None
        for inst in self.ictal:
            kind = self._v3_emg_kind(inst)
            if kind is None:
                continue
            factor = MUSCLE_FACTOR.get(inst.muscle, MUSCLE_FACTOR["modest"])
            if kind == "spasm":
                if factor <= 0 or inst.t0 + 0.4 + inst.tonic_s + 1.0 < lo or inst.t0 > hi + 1.0:
                    continue
                # 0.3-0.5 s burst about 0.4 s into the wave (infantile-spasm-i); a tonic spasm holds tonic_s
                shape = (smoothstep((t - (inst.t0 + 0.40)) / 0.08)
                         * (1.0 - smoothstep((t - (inst.t0 + 0.40 + inst.tonic_s)) / 0.15)))
                gain = factor / MUSCLE_FACTOR["modest"]
            elif kind == "neo_tonic":
                # neonatal focal tonic: sustained posturing, EMG held through the run (ACNS 2013 / ILAE 2021
                # neonatal classification: focal tonic seizures carry an EEG correlate)
                if inst.t1 + 1.0 < lo or inst.t0 > hi + 1.0:
                    continue
                shape = smoothstep((t - inst.t0) / 1.5) * (1.0 - smoothstep((t - inst.t1) / 1.0))
                gain = factor / MUSCLE_FACTOR["modest"]
            elif kind == "gtc":
                if inst.t1 + 1.0 < lo or inst.t0 > hi + 1.0:
                    continue
                tonic, clonic, pulse = self._gtc_pulse(inst, t)
                shape = tonic + clonic * pulse
                gain = 1.0
            else:
                if inst.t1 + 1.0 < lo or inst.t0 > hi + 1.0:
                    continue
                phase, _, amp, _ = self._ictal_phase(inst, t)
                if phase is None:
                    continue
                # a jerk ~60 ms after each discharge (the discharge sits at phase 0 of each cycle)
                live = (amp > 0).astype(float)
                shape = live * (0.5 + 0.5 * np.cos(phase - 2 * np.pi * 0.06 * self._f_of(inst))) ** 10
                gain = 1.0
            if not np.any(shape > 1e-4):
                continue
            if noise is None:
                noise = self._oa(self.st_muscle, i0 + self._EMG_V3_OFFSET, n, self.n_elec)
            out += (self._emg_field_v3(kind, inst)[:, None] * noise
                    * (EMG_FLOOR_W * self._EMG_V3_GAIN[kind] * gain * shape)[None, :])
        return out * self.amp_rms

    @staticmethod
    def _f_of(inst: SeizureInstance) -> float:
        return 0.5 * (float(inst.start_hz) + float(inst.end_hz))

    #: 0.5.0 per-cycle jitter of an ictal run: phase warp amplitude in cycles (period SD about 0.82x this, ~7 %)
    #: and the per-cycle phase wobble of harmonics 2-4 in radians.  0.12 (period SD ~10 %) smeared the comb a
    #: little more but halved the heuristic seizure-probability trend on B4-02 (median run max 0.92 -> 0.48);
    #: 0.08 keeps it at 0.77
    _CYCLE_WARP = 0.08
    _CYCLE_PSI = (0.0, 0.675, 1.2, 1.65)

    @staticmethod
    def _cycle_interp(cyc: np.ndarray, salt: int) -> np.ndarray:
        """Per-cycle uniform [-1, 1) noise, smoothly interpolated across each cycle (keyed by absolute cycle)."""
        k = np.floor(cyc)
        a = 2.0 * _cycle_noise(k, salt) - 1.0
        b = 2.0 * _cycle_noise(k + 1.0, salt) - 1.0
        return a + (b - a) * smoothstep(cyc - k)

    def _cycle_warp(self, phase: np.ndarray, base: int) -> np.ndarray:
        return phase + 2 * np.pi * self._CYCLE_WARP * self._cycle_interp(phase / (2 * np.pi), base + 17)

    def _cycle_psi(self, phase: np.ndarray, psi: np.ndarray, base: int) -> np.ndarray:
        cyc = phase / (2 * np.pi)
        return np.stack([psi[k] + self._CYCLE_PSI[k] * self._cycle_interp(cyc, base + 31 * (k + 1))
                         for k in range(4)])

    @staticmethod
    def _wave(phase: np.ndarray, psi: np.ndarray, offset_cycles: float,
              morph: str = "ictal", plus_fast: float = 0.0,
              f_inst: Optional[np.ndarray] = None, salt: int = 0,
              lead: float = 0.0, gsalt: Optional[int] = None,
              v3: bool = False, plus_sharp: float = 0.0, disperse: bool = False) -> np.ndarray:
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
        elif morph == "periodic" and v3 and f_inst is not None:
            # 0.5.0: seconds-based discharge (C26/C27), same peak-to-peak (in RMS units) as the cycle template
            f = np.clip(f_inst, 0.2, 8.0)
            period = 1.0 / f
            # the generator offset is a time lag too (0.5 s per offset cycle, <= 50 ms), not a cycle fraction that
            # grew to 200 ms between T3 and T5 at 0.5 Hz
            cycles = (phase + 2 * np.pi * offset_cycles * 0.5 * f) / (2 * np.pi)
            if disperse and gsalt is not None:
                # 0.5.0 phase D (C26, gpds-ty: GPDs in every chain, P-O and Cz-Pz included): each generator keeps its
                # own fixed +/-12 ms timing, so the discharge is not one waveform scaled across the head
                cycles = cycles - 0.012 * (2.0 * float(_cycle_noise(np.zeros(1), gsalt + 401)[0]) - 1.0) * f
            k = np.floor(cycles + 0.5)
            wave = _pd_cycle((cycles - k) * period, period, k, salt)
            wave = ((wave - np.interp(f, _PD_FREQS, _PD_MEANS))
                    / np.interp(f, _PD_FREQS, _PD_PTPS) * _PERIODIC_PTP)
            if disperse and gsalt is not None:
                wave = wave * (1.0 + 0.25 * (2.0 * _cycle_noise(k, gsalt + 409) - 1.0))   # per-generator, per-cycle
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
            if plus_sharp > 0 and f_inst is not None:
                # (phase D: also an ictal run with a rhythmic-spike onset; plus_sharp is 0 on every other ictal run)
                # 0.5.0 "+S" (feature review C30: the modifier was never read): a surface-negative sharp transient
                # (rise 18 / fall 30 ms, FWHM ~57 ms, in SECONDS) on the negative crest of the delta wave, on 50-100 %
                # of cycles with +/-25 % amplitude, keyed by absolute cycle (grda-plus-s-clean.webp)
                period = 1.0 / np.clip(f_inst, 0.2, 30.0)
                c = (p + psi[0] - 1.5 * np.pi) / (2 * np.pi)
                kc = np.floor(c + 0.5)
                tau = (c - kc) * period
                p_on = 0.5 + 0.5 * float(_cycle_noise(np.zeros(1), salt + 227)[0])
                on = (_cycle_noise(kc, salt + 211) < p_on).astype(float)
                g = 0.75 + 0.5 * _cycle_noise(kc, salt + 223)
                sig = np.where(tau < 0.0, 0.018, 0.030)
                wave = wave - plus_sharp * 1.4 * on * g * np.exp(-0.5 * (tau / sig) ** 2)
        if plus_fast > 0:
            wave = wave + plus_fast * np.sin(9.0 * p + psi[1]) * (0.5 + 0.5 * np.sin(p))
        return wave

    def _ictal_gain(self, inst: SeizureInstance) -> float:
        """ICTAL_GAIN, corrected under the display amplitude reference (0.4.0)."""
        gen = 1.0
        if inst.kind == "rhythmic_pattern" and inst.predominance and inst.onset_region == "generalized":
            # 0.5.0 phase D: a generalized RPP's amplitude is its max-bipolar-channel voltage (ACNS 2021)
            lagged = "_lag" if (inst.rpp and inst.rpp.get("lag_s")) else ""
            gen = rpp3.GEN_BIPOLAR_GAIN.get(inst.morph + lagged, rpp3.GEN_BIPOLAR_GAIN.get(inst.morph, 1.0))
        if not self.display_ref:
            return ICTAL_GAIN * gen
        key = inst.morph if (inst.kind == "rhythmic_pattern" and inst.morph in DISPLAY_CAL) else "ictal"
        return ICTAL_GAIN / DISPLAY_CAL[key] * gen

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
        cal_montage = self.spec.get("montage", "longitudinal_bipolar")
        if cal_montage in mt.VIEWER_MONTAGES:
            # 0.5.0 viewer montages re-display one recording, as the viewer does: calibrate on the double banana so
            # switching montage never rescales the record
            cal_montage = "longitudinal_bipolar"
        pairs = [p for p in mt.montage_pairs(cal_montage, self.electrodes)
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
        if self.spec_version >= 3 and self._hypno:
            # 0.5.0: amplitude_uv is the BASELINE (awake) voltage.  Measure it in wake only, so sleep stages raise
            # the display instead of being normalised back down (feature review: wake 34 -> sleep 34 uV).
            wake = [(max(a, 0.0), min(b, dur)) for a, b, st in self._hypno if st == "W" and min(b, dur) - max(a, 0.0) >= 20.0]
            if wake:
                step = max(1, len(wake) // 4)
                windows = [(a + 2.0, min(b - 2.0, a + 62.0)) for a, b in wake[::step][:4]]
        if self.spec_version >= 3 and self.age == "neonate" and self._state_intervals:
            # phase D (neonatal-v3): amplitude_uv is the continuous awake / active-sleep voltage (ACNS activite moyenne,
            # 25-50 uV), so quiet sleep's high-voltage slow waves and trace alternant are not normalised away and wake
            # can no longer out-voltage quiet sleep (fixed windows hit 2 quiet-sleep minutes out of 4 on B1-01)
            cont = [(max(a, 0.0), min(b, dur)) for a, b, st in self._state_intervals
                    if st in ("awake", "active_sleep") and min(b, dur) - max(a, 0.0) >= 20.0]
            if cont:
                step = max(1, len(cont) // 4)
                windows = [(a + 2.0, min(b - 2.0, a + 62.0)) for a, b in cont[::step][:4]]
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
                    tg = np.linspace(t0, t1, max(8, int(t1 - t0)))
                    e = float(np.mean(self.slow_am(tg)))
                    # spec_version 3: segment() synthesizes the drug-free background while calibrating, so a drug's
                    # amplitude change, including one present from t = 0, survives calibration (feature review:
                    # neonatal midazolam 0.72x -> 0.94x; additive anesthetic streams were normalised away too)
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
        pat = inst.onset_pattern
        if pat and pat != "lvfa":
            # phase D onset patterns (own substream, so the lvfa draws above keep their sequence)
            pr = substream(self.seed, "onset-pattern", inst.index, inst.ordinal)
            if pat == "rhythmic_theta":
                # mesial temporal: rhythmic theta from the first second (learningeeg atlas-l-temporal-focal-seizure)
                f_onset = f_start * float(pr.uniform(1.0, 1.15))
            elif pat == "electrodecrement":
                # frontal: low-voltage fast activity inside a regional electrodecrement
                f_onset = float(np.clip(f_start * pr.uniform(2.5, 3.5), 15.0, 25.0))
            elif pat == "rhythmic_spikes":
                # central / parietal / occipital: rhythmic alpha-beta spikes (o1-onset-seizure-bipolar)
                f_onset = float(np.clip(f_start * pr.uniform(1.4, 1.8), 7.0, 13.0))
        # steps every 2.5-5 s through the middle 70 % of the run; at least 4
        u_on, u_off = self._recruit_bounds(dur, pat)
        n_mid = max(4, int(round((u_off - u_on) * dur / float(rng.uniform(2.5, 5.0)))))
        u = np.concatenate([[0.0, u_on], np.linspace(u_on, u_off, n_mid + 1)[1:], [1.0]])
        logf = np.empty_like(u)
        logf[0] = math.log(f_onset)
        logf[1] = math.log(f_start)
        # mean-reverting random walk around the start->end glide (log domain)
        dev = 0.0
        for k in range(2, u.size - 1):
            frac = (u[k] - u_on) / (u_off - u_on)
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

    def _recruit_bounds(self, dur: float, pattern: str = "") -> Tuple[float, float]:
        """Fractions of the run at which the onset ends and the offset begins.

        Versions 1-2 use a fixed 15 % onset and 85 % offset, so a 12-min seizure spent 108 s in a
        quarter-voltage onset and its visible length fell short of the key (feature review, B4-01,
        C15, C19).  Version 3 caps them in seconds: onset at most 4 s, offset at most 10 s.
        Phase D (seizures-icu-v3 C15: the obvious rhythm of a 10-s run lasted 7 s): a run of 12 s or less
        spends 0.5 s in its onset and 1 s in its offset; a rhythmic-theta onset builds over up to 8 s.
        """
        if self.spec_version >= 3:
            if dur <= self._SHORT_RUN_S:
                return 0.5 / dur, 1.0 - 1.0 / dur
            if pattern == "rhythmic_theta":
                return min(0.20, 8.0 / dur), max(0.85, 1.0 - 10.0 / dur)
            return min(0.15, 4.0 / dur), max(0.85, 1.0 - 10.0 / dur)
        return 0.15, 0.85

    #: phase D: runs up to this length use the short-run onset/offset (the ACNS 10-s boundary items)
    _SHORT_RUN_S = 12.0
    #: phase D: amplitude at u = 0 as a fraction of amplitude_start, by onset pattern (lvfa keeps 0.8)
    _ONSET_AMP = {"rhythmic_theta": 0.7, "electrodecrement": 0.35, "rhythmic_spikes": 0.8}

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
        if self.spec_version >= 3:
            u_on, u_off = self._recruit_bounds(dur, inst.onset_pattern)
            if dur <= self._SHORT_RUN_S:
                # phase D (C15): full voltage 1 s into a boundary run, a shallow 0.85 fall-off at the end
                u_up = u_on + 0.5 / dur
                a = np.interp(uu, [0.0, u_on, u_up, u_off, 1.0],
                              [inst.amp_start, 0.5 * (inst.amp_start + inst.amp_end), inst.amp_end, inst.amp_end,
                               0.85 * inst.amp_end])
            else:
                a = np.interp(uu, [0.0, u_on, u_off, 1.0],
                              [self._ONSET_AMP.get(inst.onset_pattern, 0.8) * inst.amp_start, inst.amp_start,
                               inst.amp_end, 0.7 * inst.amp_end])
            ramp = min(0.04, 0.5 / dur) if dur > self._SHORT_RUN_S else 0.2 / dur
        else:
            a = np.interp(uu, [0.0, 0.15, 0.75, 1.0],
                          [0.25 * inst.amp_start, inst.amp_start, inst.amp_end, 0.55 * inst.amp_end])
            ramp = 0.04
        amp = a / 2.9 * self._ictal_gain(inst)
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
        if inst.rpp is not None and inst.rpp.get("steps"):
            # 0.5.0 phase D: ACNS evolution / fluctuation as discrete frequency levels (>= 0.5 Hz, >= 3 cycles each)
            phase, f_inst = rpp3.step_phase(inst, uu, dur)
        # Slow phase wander so the run is rhythmic but not a pure tone.  This
        # is *additive* on purpose: perturbing the accumulated phase
        # multiplicatively scales with elapsed cycles and smears the ictal
        # spectral peak into a broad hump, destroying the rhythmicity the
        # panels are supposed to show.
        jr = substream(self.seed, "szjit", inst.index, inst.ordinal)
        nj = 6
        wax_phase = float(jr.uniform(0, 2 * np.pi))
        wander = np.zeros_like(uu)
        amps_j = jr.uniform(0.10, 0.32, nj)
        fqs_j = jr.uniform(0.03, 0.30, nj)
        phs_j = jr.uniform(0, 2 * np.pi, nj)
        if self.spec_version >= 3 and inst.kind == "rhythmic_pattern":
            # 0.5.0 (feature review C27/C31): the drift is proportional to the rate - at most _RPP_DRIFT of f0 - so
            # a 0.5-Hz LPD or a 4-Hz LRDA stays inside its ACNS band (sum a*fq was an absolute 0.2-0.6 Hz)
            amps_j = amps_j * min(1.0, _RPP_DRIFT * f0 / float(np.sum(amps_j * fqs_j)))
        for a, fq, p in zip(amps_j, fqs_j, phs_j):
            wander += a * np.sin(2 * np.pi * fq * (uu * dur) + p)
            f_inst = f_inst + a * fq * np.cos(2 * np.pi * fq * (uu * dur) + p)
        phase = phase + wander
        f_inst = np.clip(f_inst, 0.2, 30.0)

        # amplitude_*_uv is the peak-to-peak of the ictal run; a rhythmic,
        # sharply contoured discharge runs ~2.9x its RMS peak-to-peak.
        amp = ((inst.amp_start + (inst.amp_end - inst.amp_start) * uu)
               / 2.9 * self._ictal_gain(inst))
        ramp = 0.07 if inst.kind != "rhythmic_pattern" else 0.14
        if self.spec_version >= 3 and inst.kind in ("seizure", "seizure_cluster", "status_epilepticus"):
            ramp = min(ramp, 2.0 / dur)
        if inst.rpp is not None and inst.rpp.get("ramp_s"):
            ramp = min(0.3, float(inst.rpp["ramp_s"]) / dur)      # BIRDs: sudden onset and offset
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
            if factor <= 0 or self._v3_emg_kind(inst) is not None:
                continue                  # phase D: spasm / GTC / neonatal clonic EMG is _ictal_emg_rows_v3
            u = (t - inst.t0) / max(inst.duration_s, 1.0)
            if inst.kind == "spasm" and self.spec_version >= 3:
                # 0.5.0 (infantile-spasm-i/-ii): a 0.3-0.5 s EMG burst about 0.6 s after the wave begins
                shape = (smoothstep((t - (inst.t0 + 0.40)) / 0.10)
                         * (1.0 - smoothstep((t - (inst.t0 + 0.80)) / 0.15)))
            elif inst.kind == "spasm":
                # a brief symmetric phasic contraction peaking with the slow wave
                shape = smoothstep(u / 0.2) * (1.0 - smoothstep((u - 0.5) / 0.3))
            else:
                ramp = max(min(2.0, inst.duration_s * 0.08), 0.25)
                shape = smoothstep((t - inst.t0) / ramp) * (1.0 - smoothstep((t - (inst.t1 - ramp)) / ramp))
                if inst.kind == "tonic_seizure":
                    shape = shape * (0.35 + 0.65 * smoothstep(u / 0.7))   # tonic EMG builds
                elif inst.clonic and inst.profile == "recruit" and inst.morph == "ictal":
                    # 0.5.0 (feature review B4-03: focal clonic keyed, no clonic artifact): myogenic bursts on the
                    # peaks of the run's clonic modulation (_recruit_phase), little EMG before the clonic phase
                    _, _, _, clonic_hz, clonic_ph = self._recruit_breakpoints(inst)
                    w = smoothstep((np.clip(u, 0.0, 1.0) - 0.68) / 0.15)
                    pulse = (0.5 + 0.5 * np.cos(2 * np.pi * clonic_hz * (t - inst.t0) + clonic_ph)) ** 4
                    shape = shape * (0.05 * (1.0 - w) + w * pulse)
                    factor = max(factor, MUSCLE_FACTOR["clinical"])
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
        gate = self._run_gate(t, [z for z in self.ictal if z.morph == "spike_wave"])
        if getattr(self, "_gen", None) is not None:
            gate = np.maximum(gate, self._gen.absence_gate(t))
        return gate

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

    #: 0.5.0 (neonatal re-review: temporal 30-70 Hz at 3-4x central on nearly every neonatal page; the ACNS 2013 sleep
    #: figures carry no EMG): neonatal tonic muscle by behavioural state
    _NEO_EMG_V3 = {"awake": 0.6, "active_sleep": 0.15, "indeterminate": 0.25, "quiet_sleep": 0.05}

    def _neo_emg_v3(self, t: np.ndarray):
        if self.spec_version < 3:
            return 1.0
        return self._state_lookup(t, self._NEO_EMG_V3, np.full(t.shape, 0.15))

    def _postictal_diffuse(self, inst) -> bool:
        return (inst.onset_region == "generalized" or inst.spread in ("generalized", "bilateral")
                or inst.kind == "status_epilepticus" and inst.spread not in (None, "none"))

    def _postictal_field(self, inst) -> np.ndarray:
        """0..1 per electrode: the onset zone (plus a spread region at half weight)."""
        key = ("pif", inst.onset_region, inst.spread)
        cache = self.__dict__.setdefault("_pif_cache", {})
        if key not in cache:
            w = np.zeros(self.n_elec)
            for focus, ga, _ in mt.region_generators(inst.onset_region, self.electrodes):
                w = np.maximum(w, ga * self._gen_weights(focus, mt.generator_falloff(inst.onset_region)))
            if inst.spread not in (None, "none", "generalized", "bilateral"):
                for focus, ga, _ in mt.region_generators(inst.spread, self.electrodes):
                    w = np.maximum(w, 0.5 * ga * self._gen_weights(focus, mt.generator_falloff(inst.spread)))
            cache[key] = w / max(float(w.max()), 1e-9)
        return cache[key]

    #: phase D electrodecrement onset: depth over the onset field and its length (seconds, 1.5-3.5)
    _ONSET_DEC_DEPTH = 0.85

    def _onset_dec_field(self, inst: SeizureInstance) -> np.ndarray:
        """Flat over the onset hemisphere (midline 0.5): a decrement graded across F3/C3 RAISED the bipolar difference
        against the less attenuated neighbour (F3-C3 1.27x with the onset field alone, 0.6x with a graded
        hemisphere), so it is uniform over the side, as a regional electrodecrement reads in the chain."""
        key = ("odf", inst.onset_region)
        cache = self.__dict__.setdefault("_odf_cache", {})
        if key not in cache:
            hemi = mt.HEMISPHERE_OF_REGION.get(inst.onset_region, "both")
            xs = np.array([mt.POSITIONS.get(e, (0.0, 0.0))[0] for e in self.electrodes])
            if hemi in ("left", "right"):
                xs = xs * (-1.0 if hemi == "left" else 1.0)
                w = np.where(xs > 0.05, 1.0, np.where(xs >= -0.05, 0.5, 0.0))
            else:
                w = np.ones(self.n_elec)
            cache[key] = w
        return cache[key]

    def _onset_dec_len(self, inst: SeizureInstance) -> float:
        return float(np.clip(0.10 * inst.duration_s, 1.5, 3.5))

    def postictal_rows_v3(self, t: np.ndarray) -> np.ndarray:
        """0.5.0 (re-review: a 62 % head-wide attenuation after every focal run switched off the opposite PDR):
        focal postictal attenuation weighted by the seizure's own field.

        Phase D: also the regional electrodecrement that opens a frontal (``electrodecrement``) run - the
        background over the onset field drops by 85 % from 0.3 s before onset for 1.5-3.5 s while the low-voltage
        fast activity starts (frontal lobe seizures: an electrodecrement or low-voltage fast onset)."""
        rows = np.ones((self.n_elec, t.size))
        if t.size == 0 or self.spec_version < 3:
            return rows
        lo, hi = float(t[0]), float(t[-1])
        for inst in self.seizures:
            if inst.onset_pattern != "electrodecrement":
                continue
            L = self._onset_dec_len(inst)
            if inst.t0 + L + 2.0 < lo or inst.t0 - 1.0 > hi:
                continue
            shape = smoothstep((t - (inst.t0 - 0.3)) / 0.3) * (1.0 - smoothstep((t - (inst.t0 + L)) / 1.5))
            rows *= 1.0 - self._ONSET_DEC_DEPTH * self._onset_dec_field(inst)[:, None] * shape[None, :]
        for inst in self.seizures:
            if inst.postictal_s <= 0 or self._postictal_diffuse(inst):
                continue
            if inst.t1 > hi or inst.t1 + inst.postictal_s * 3.0 < lo:
                continue
            d = t - inst.t1
            m = (d >= 0) & (d < inst.postictal_s * 3)
            if not m.any():
                continue
            fld = self._postictal_field(inst)
            rows[:, m] *= 1.0 - 0.62 * fld[:, None] * np.exp(-d[m] / max(inst.postictal_s / 1.6, 1.0))[None, :]
        return np.clip(rows, 0.05, 1.0)

    def postictal_envelope(self, t: np.ndarray) -> np.ndarray:
        env = np.ones_like(t)
        if t.size == 0:
            return env
        lo, hi = float(t[0]), float(t[-1])
        for inst in self.seizures:
            if inst.postictal_s <= 0:
                continue
            if self.spec_version >= 3 and not self._postictal_diffuse(inst):
                continue                      # focal: postictal_rows_v3 attenuates the onset field instead
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

    #: 0.5.0 focal postictal delta: peak RMS over the onset zone in background-RMS units, and the sample offset of
    #: the private delta realizations (far past any record, so they never coincide with the background's)
    _PI_DELTA_GAIN = 2.5
    _PI_DELTA_OFFSET = 2_000_000_000

    def _postictal_delta_rows(self, t: np.ndarray, i0: int, n: int) -> np.ndarray:
        """Focal polymorphic delta over the onset zone after an ictal run (spec_version 3).

        Feature review B4-03 / C14 / C18: every run ended in a clean cut back to background.  The default
        postictal attenuation (``postictal_envelope``) now has focal slowing on top: one independent 1-3 Hz source
        per onset generator, so it has a gradient and survives the bipolar chain, rising over 1.5 s from offset and
        decaying with tau = max(postictal_attenuation_s, duration/2), at most 120 s.
        """
        out = np.zeros((self.n_elec, n))
        if self.spec_version < 3 or t.size == 0:
            return out
        lo, hi = float(t[0]), float(t[-1])
        for inst in self.ictal:
            if (inst.kind not in ("seizure", "seizure_cluster", "status_epilepticus") or inst.morph != "ictal"
                    or inst.postictal_s <= 0):
                continue
            tau = min(max(inst.postictal_s, 0.5 * inst.duration_s), 120.0)
            if inst.t1 > hi or inst.t1 + 3.0 * tau < lo:
                continue
            d = t - inst.t1
            shape = np.zeros(n)
            m = (d >= 0) & (d < 3.0 * tau)
            shape[m] = smoothstep(d[m] / 1.5) * np.exp(-d[m] / tau)
            gens = mt.region_generators(inst.onset_region, self.electrodes)
            src = self._oa(self.st_delta, i0 + self._PI_DELTA_OFFSET, n, len(gens))
            fall = mt.generator_falloff(inst.onset_region)
            for gi, (focus, ga, _) in enumerate(gens):
                out += self._gen_weights(focus, fall)[:, None] * (ga * src[gi] * shape)[None, :]
        return out * (self._PI_DELTA_GAIN * self.amp_rms)

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

    def _artifact_eligible(self, ev: Dict) -> bool:
        """Eligibility for newly authored state-specific artifact controls."""
        kind = ev.get("kind")
        if kind not in {"lateral_eye", "slow_roving_eye", "rem_eye_movements", "glossokinetic"}:
            return True
        required = {"lateral_eye": "awake", "slow_roving_eye": "drowsy",
                    "rem_eye_movements": "rem", "glossokinetic": "awake"}[kind]
        if ev.get("context") != required:
            return False
        start, end = self._event_window(ev)
        probes = np.linspace(start, end, max(3, int(np.ceil(end - start)) + 1))
        sleep = self._sleep_at(probes)
        if required == "awake":
            return bool(np.all(sleep < 0.2))
        if required == "drowsy":
            return bool(np.all((sleep > 0.15) & (sleep < 0.75)))
        return any(a <= start and end <= b for a, b in self._rem_intervals)

    #: 0.5.0: an authored blink needs the lids, which complete neuromuscular blockade paralyses (Whitham 2007, S30); the
    #: other ocular/tongue kinds are already rejected by spec.normalize, device and cardiac artifacts stay
    _SKELETAL_ARTIFACTS_V3 = ("eye_blink",)

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
            if self.spec.get("neuromuscular_blockade") == "complete" and kind == "emg_chewing":
                continue
            if (self.spec_version >= 3 and self.spec.get("neuromuscular_blockade") == "complete"
                    and kind in self._SKELETAL_ARTIFACTS_V3):
                continue
            if self.spec_version >= 3 and kind in self._V3_ARTIFACTS:
                # 0.5.0: each model carries its own per-electrode field (no side mask or gain jitter on top)
                out += self._artifact_rows_v3(kind, ev, k, t, i0, gain) * live[None, :]
                continue
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

    # ---------------- 0.5.0 artifact models (spec_version 3) ----------------
    # Feature review 2026-09-26 (research/eeg-atlas/feature-review-20260926/artifacts.md, A110-01..12).  Every model
    # returns (n_elec, n) microvolts with its own per-electrode field, chosen by the ratios it must show in
    # longitudinal bipolar, and every random draw is keyed to the event index (never to the requested window).

    _V3_ARTIFACTS = frozenset({"lateral_eye", "slow_roving_eye", "rem_eye_movements", "ecg", "pulse", "emg_chewing",
                               "glossokinetic", "movement", "sweat", "ventilator", "electrode_pop", "sixty_hz"})
    _MIRROR = {"Fp1": "Fp2", "F7": "F8", "F3": "F4", "T3": "T4", "C3": "C4", "T5": "T6", "P3": "P4", "O1": "O2",
               "A1": "A2"}
    #: horizontal corneo-retinal field for gaze to the LEFT; the right side is the negated mirror.  Maximum at F7, with
    #: Fp1 near the null plane of the horizontal dipole, so Fp1-F7 and F7-T3 reverse at F7 (F7-T3 about 0.6x Fp1-F7),
    #: Fp1-F3 stays small and the posterior chains are quiet (montages/clean/lateral-eye-movements, REM-Sleep-ex-3).
    _GAZE_FIELD_L = {"F7": 1.0, "T3": 0.45, "T5": 0.22, "F3": 0.20, "Fp1": 0.10, "C3": 0.10, "O1": 0.08, "P3": 0.05,
                     "A1": 0.30}
    #: glossokinetic: bilaterally in-phase and broad.  Phase D (artifacts-v3 A110-11): a steep front-to-back gradient
    #: (0.25 per link along every chain) so the rolling waves survive the parasagittal and midline chains as in
    #: Tongue-Artifact; the old table put 0.25 rows in C3-P3/P3-O1 and read as frontotemporal only
    _GLOSSO_FIELD = {"F7": 1.0, "F8": 1.0, "T3": 0.65, "T4": 0.65, "T5": 0.3, "T6": 0.3, "Fp1": 0.8, "Fp2": 0.8,
                     "F3": 0.75, "F4": 0.75, "C3": 0.5, "C4": 0.5, "P3": 0.25, "P4": 0.25, "O1": 0.0, "O2": 0.0,
                     "Fz": 0.75, "Cz": 0.5, "Pz": 0.25, "A1": 0.7, "A2": 0.7}
    GAZE_UV = 75.0          # gaze-position scale at F7: saccade steps of 75-150 uV
    ROVING_UV = 55.0        # RMS of the slow roving drift at F7
    GLOSSO_UV = 200.0
    CHEW_EMG_UV = 70.0      # phase D: 120 drew 4-6 rows at medium and 11 at high (C16)
    ECG_ART_UV = 45.0
    PULSE_UV = 35.0
    SWEAT_UV = 80.0
    VENT_UV = 120.0
    SIXTY_UV = 25.0

    def _art_stream(self, name: str, shape: np.ndarray) -> _Stream:
        cache = self.__dict__.setdefault("_art_streams", {})
        if name not in cache:
            cache[name] = _Stream(name, shape, self._norm_for(shape), np.ones(self.n_elec), 0.0)
        return cache[name]

    def _gaze_field(self) -> np.ndarray:
        out = np.zeros(self.n_elec)
        right = {v: k for k, v in self._MIRROR.items()}
        for i, e in enumerate(self.electrodes):
            if e in self._GAZE_FIELD_L:
                out[i] = self._GAZE_FIELD_L[e]
            elif e in right and right[e] in self._GAZE_FIELD_L:
                out[i] = -self._GAZE_FIELD_L[right[e]]
            elif e in mt.SUBTEMPORAL_PROXY:
                # 0.5.0 T1/T2: the mean of the two scalp neighbours (T1 from F7/T3; T2 the negated mirror)
                a, b = mt.SUBTEMPORAL_PROXY[e]
                out[i] = 0.5 * (out[self._idx[a]] + out[self._idx[b]])
        return out

    def _gaze_schedule(self, k: int, ev: Dict, kind: str) -> List[Tuple[float, float, float, float]]:
        """Saccades ``(start, rise_s, from, to)`` over the event window, drawn once per event.

        Gaze position is held between saccades (fixation); the causal 1 Hz LFF turns each step into the reference's
        sawtooth (fast rise, 0.2-0.35 s return).  lateral_eye: raised-cosine saccades of 30-60 ms alternating left and
        right at ``rate_per_h``.  rem_eye_movements: clusters of 2-4 saccades in 1-2 s, rise 40-150 ms, the cluster rate
        set so the saccade rate is ``rate_per_h`` (REM-Sleep-ex-3).
        """
        cache = self.__dict__.setdefault("_gaze_sched", {})
        if k in cache:
            return cache[k]
        rng = substream(self.seed, "gaze", k)
        a0, a1 = self._event_window(ev)
        rate = float(ev.get("rate_per_h", 360.0 if kind == "lateral_eye" else 900.0)) / 3600.0
        mean = 1.0 / max(rate, 1e-6)
        steps: List[Tuple[float, float, float, float]] = []
        pos = 0.0
        side = float(rng.choice([-1.0, 1.0]))
        tt = a0 + float(rng.uniform(0.3, 1.0))
        while tt < a1:
            if kind == "rem_eye_movements":
                n_sac = int(rng.integers(2, 5))
                span = float(rng.uniform(1.0, 2.0))
                starts = tt + np.sort(rng.uniform(0.0, span, n_sac))
                for s0 in starts:
                    if steps and s0 < steps[-1][0] + steps[-1][1] + 0.12:
                        continue
                    to = side * float(rng.uniform(0.4, 1.0))
                    steps.append((float(s0), float(rng.uniform(0.04, 0.15)), pos, to))
                    pos = to
                    side = -side if rng.random() < 0.8 else side
                tt += span + float(np.clip(rng.lognormal(math.log(max(n_sac * mean - span, 0.5)), 0.5), 0.5, 30.0))
            else:
                to = side * float(rng.uniform(0.5, 1.0))
                steps.append((tt, float(rng.uniform(0.03, 0.06)), pos, to))
                pos, side = to, -side
                tt += float(np.clip(rng.lognormal(math.log(mean), 0.5), 0.3, 4.0 * mean))
        cache[k] = steps
        return steps

    @staticmethod
    def _rc(x: np.ndarray) -> np.ndarray:
        return 0.5 - 0.5 * np.cos(np.pi * np.clip(x, 0.0, 1.0))

    def _gaze_signal(self, steps, t: np.ndarray) -> np.ndarray:
        g = np.zeros(t.size)
        for s0, rise, p0, p1 in steps:
            if s0 > t[-1]:
                break
            m = t >= s0
            g[m] = p0 + (p1 - p0) * self._rc((t[m] - s0) / rise)
        return g

    def _event_schedule(self, k: int, tag: str, a0: float, a1: float, draw) -> list:
        """Generic once-per-event timetable: ``draw(rng, t)`` returns ``(item, next_t)``."""
        cache = self.__dict__.setdefault("_art_events_v3", {})
        key = (k, tag)
        if key not in cache:
            rng = substream(self.seed, "art3-" + tag, k)
            items, tt = [], a0 + float(rng.uniform(0.0, 0.5))
            while tt < a1:
                item, tt = draw(rng, tt)
                items.append(item)
            cache[key] = items
        return cache[key]

    def _artifact_rows_v3(self, kind: str, ev: Dict, k: int, t: np.ndarray, i0: int, gain: float) -> np.ndarray:
        n = t.size
        rows = np.zeros((self.n_elec, n))
        a0, a1 = self._event_window(ev)
        blocked = self.spec.get("neuromuscular_blockade") == "complete"
        chans = [c for c in (ev.get("channels") or []) if c in self._idx]

        if kind in ("lateral_eye", "rem_eye_movements"):
            g = self._gaze_signal(self._gaze_schedule(k, ev, kind), t)
            return self._gaze_field()[:, None] * (g * self.GAZE_UV * gain)[None, :]

        if kind == "slow_roving_eye":
            # band-limited random gaze drift centred at 1.4x frequency_hz (0.35 Hz for the default 0.25), so half-waves
            # are irregular and 0.9-1.8 s long as in Drowsy-state (a pure sine was metronomic: 4.0 s for 15 s)
            fc = float(np.clip(1.4 * float(ev.get("frequency_hz", 0.25)), 0.15, 0.6))
            st = self._art_stream(f"art3-roving-{fc:.3f}", band_shape(self._freqs, fc, 0.4 * fc, order=2.0))
            g = self._oa(st, i0, n, 1)[0]
            return self._gaze_field()[:, None] * (g * self.ROVING_UV * gain)[None, :]

        if kind == "ecg":
            return self._ecg(t, amplitude=self.ECG_ART_UV * gain, gradient=True)

        if kind == "pulse":
            # one electrode's mechanical pulse wave filling each R-R interval, locked to the R wave with a 0.25-0.35 s
            # delay (cardioballistic-artifact-clean: Cz, Fz-Cz and Cz-Pz mirror images); frequency_hz is ignored
            delay = float(substream(self.seed, "pulse", k).uniform(0.25, 0.35))
            rr = 60.0 / _ECG_HR[self.age]
            onsets = self._beat_times(t[0] - delay - 2 * rr, t[-1]) + delay
            j = np.clip(np.searchsorted(onsets, t, side="right") - 1, 0, onsets.size - 2)
            phi = (t - onsets[j]) / (onsets[j + 1] - onsets[j])
            wave = np.sin(2 * np.pi * phi) + 0.3 * np.sin(4 * np.pi * phi + 0.8)
            for c in chans or ["Cz"]:
                if c in self._idx:
                    rows[self._idx[c]] = wave * self.PULSE_UV * gain
            return rows

        if kind == "emg_chewing":
            # independent EMG per electrode (one shared realisation cancels inside F7-T3/T3-T5; A110-10)
            if blocked:
                return rows
            bouts, chews = self._artifact_schedule(ev, kind)
            base = self._oa(self._art_stream("art3-chew-emg", self.st_emg.shape), i0, n, self.n_elec)
            env = np.zeros(n)
            slow = np.zeros(n)
            for c0, cd in chews:
                d = (t - c0) / cd
                m = (d > 0) & (d < 1)
                env[m] += np.sin(np.pi * d[m]) ** 1.5
                ms = (d > -0.2) & (d < 1.6)
                slow[ms] += np.exp(-0.5 * ((d[ms] - 0.6) / 0.45) ** 2)
            temporal = _profile(self.electrodes, _TEMPORAL, 0.15)
            frontal = _profile(self.electrodes, _ANTERIOR, 0.1)
            # phase D (artifacts-v3 C16): the temporalis burst voltage saturates, so "high" draws the medium voltage (low
            # still scales down).  At 2.1x the 120-uV model drew 11 rows on P5 C16; Craig accepted that page at 1.6-2.2
            # rows in the outer temporal chains (renderer 0.4.1), and chewing-artifact-2 shows several spacings
            g = min(gain, 1.0) ** 0.5
            emg = np.clip(env, 0.0, 1.5) * self.CHEW_EMG_UV * g
            return (base * emg[None, :] * (0.12 + 0.88 * temporal)[:, None]
                    - (slow * 14.0 * g)[None, :] * (0.4 * frontal + 0.6 * temporal)[:, None])

        if kind == "glossokinetic":
            # near-continuous rolling runs: trains of 0.8-3.5 s (median 1.7 s) of 1.5-2.5 Hz waves, each cycle with its
            # own length (+-20 %) and amplitude, 0.2-1 s gaps, bilaterally in phase over a broad field whose
            # front-to-back gradient survives the parasagittal chains (Tongue-Artifact; phase D, artifacts-v3 A110-11:
            # isolated 0.3-0.6 s waves at 0.25 rows parasagittally read as intermittent F7/F8 transients)
            def draw(rng, tt):
                span = float(np.clip(rng.lognormal(math.log(1.7), 0.45), 0.8, 3.5))
                f0 = float(rng.uniform(1.5, 2.5))
                cyc, c0 = [], tt
                while c0 < tt + span:
                    p = float(np.clip(rng.normal(1.0, 0.2), 0.6, 1.4)) / f0
                    cyc.append((c0, p, float(rng.uniform(0.6, 1.0))))
                    c0 += p
                sgn = float(rng.choice([-1.0, 1.0]))
                return (tt, c0 - tt, np.array(cyc), sgn), c0 + float(rng.uniform(0.2, 1.0))
            sig = np.zeros(n)
            for b0, dur, cyc, sgn in self._event_schedule(k, "glosso", a0, a1, draw):
                if b0 > t[-1] or b0 + dur < t[0]:
                    continue
                edge = np.clip(np.minimum(t - b0, b0 + dur - t) / 0.3, 0.0, 1.0)
                for c0, p, a in cyc:
                    m = (t >= c0) & (t < c0 + p)
                    if m.any():
                        sig[m] += sgn * a * edge[m] * np.sin(2 * np.pi * (t[m] - c0) / p)
            field = np.array([mt.table_value(self._GLOSSO_FIELD, e, 0.1) for e in self.electrodes])
            return field[:, None] * (sig * self.GLOSSO_UV * gain)[None, :]

        if kind == "movement":
            # abrupt irregular transients (onset 50-150 ms, 0.5-2 s, 30-110 uV), each over its own REGION (bifrontal
            # 0.4, one side 0.4, global 0.2; weight exp(-(d/0.55)^2) from the region centre x U(0.7, 1.3), one electrode
            # in ten reversed) with per-electrode sway after the common abrupt onset, plus a co-timed
            # independent-per-electrode EMG burst RMS 8-16 uV.  Phase D (artifacts-v3 A110-08): 100-300 uV in every
            # electrode drew 3.4-5.8 rows in every chain; shaking-head-artifact and chest-PT-artifact show 0.5-1.5
            # rows, regional (bifrontal / one side), posterior chains quiet.
            ne = self.n_elec
            pos = np.array([mt.POSITIONS.get(e, (0.0, 0.0)) for e in self.electrodes])
            centres = {"bifrontal": [(0.0, 0.8)], "left": [(-0.9, 0.3)], "right": [(0.9, 0.3)]}

            def draw(rng, tt):
                u = float(rng.random())
                region = "bifrontal" if u < 0.4 else ("global" if u >= 0.8 else str(rng.choice(["left", "right"])))
                if region == "global":
                    fld = np.full(ne, 0.6)       # jitter and sway on a uniform field still differ between leads
                else:
                    dmin = np.min([np.hypot(pos[:, 0] - cx, pos[:, 1] - cy) for cx, cy in centres[region]], axis=0)
                    fld = np.exp(-(dmin / 0.55) ** 2)
                w = fld * rng.uniform(0.7, 1.3, ne) * np.where(rng.random(ne) < 0.1, -1.0, 1.0)
                item = (tt, float(rng.uniform(0.05, 0.15)), float(rng.uniform(0.5, 2.0)),
                        float(rng.uniform(30.0, 110.0)) * float(rng.choice([-1.0, 1.0])), w,
                        float(rng.uniform(0.4, 0.8)), rng.uniform(0.0, 2 * np.pi, ne), float(rng.uniform(8.0, 16.0)),
                        region)
                return item, tt + item[2] + float(np.clip(rng.lognormal(math.log(1.2), 0.6), 0.2, 5.0))
            emg_rows = None
            if not blocked:     # frontalis / temporalis: RMS 8-16 uV per electrode where the muscle is
                musc = np.maximum(_profile(self.electrodes, _TEMPORAL, 0.15), _profile(self.electrodes, _ANTERIOR, 0.1))
                emg_rows = (self._oa(self._art_stream("art3-move-emg", self.st_emg.shape), i0, n, ne)
                            * (0.35 + 0.65 * musc)[:, None])
            for s0, onset, dur, amp, w, wig, wph, emg_uv, _region in self._event_schedule(k, "move", a0, a1, draw):
                d = t - s0
                m = (d >= 0) & (d < dur + 0.3)
                if not m.any():
                    continue
                dd = d[m]
                fall = 0.35 * dur
                shape = self._rc(dd / onset) * (1.0 - self._rc((dd - (dur - fall)) / (fall + 0.3)))
                sway = 1.0 + wig * np.sin(2 * np.pi * 1.5 * dd[None, :] / dur + wph[:, None])
                rows[:, m] += (amp * gain) * w[:, None] * shape[None, :] * sway
                if emg_rows is not None:
                    burst = np.where(dd < dur, np.sin(np.pi * np.clip(dd / dur, 0, 1)) ** 0.5, 0.0)
                    reg = 0.3 + 0.7 * np.clip(np.abs(w), 0.0, 1.0)      # the moving region's muscles
                    rows[:, m] += emg_rows[:, m] * reg[:, None] * (burst * emg_uv * gain)[None, :]
            return rows

        if kind == "sweat":
            # a regional slow (0.1-0.4 Hz) sway: common plus independent per-electrode drift under a regional field,
            # one frontopolar region by default (drawn per record), left/right frontotemporal, or centred on ``channels``;
            # about one page row in the dominant chain, posterior chains quiet (Sweat-and-electrode-pop)
            side = ev.get("side", "all")
            centres = chans or {"left": ["F7"], "right": ["F8"]}.get(
                side, [str(substream(self.seed, "sweat", k).choice(["Fp1", "Fp2"]))])
            field = np.zeros(self.n_elec)
            for i, e in enumerate(self.electrodes):
                if e in mt.POSITIONS:
                    d = min(math.hypot(*np.subtract(mt.POSITIONS[e], mt.POSITIONS[c])) for c in centres)
                    field[i] = math.exp(-(d / 0.5) ** 2)
            st = self._art_stream("art3-sweat", band_shape(self._freqs, 0.25, 0.15, order=1.0))
            r = self._oa(st, i0, n, self.n_elec + 1)
            return field[:, None] * (0.8 * r[-1][None, :] + 0.6 * r[:-1]) * (self.SWEAT_UV * gain)
        if kind == "ventilator":
            # breath-locked bursts (jitter <= 3 %): per breath a 0.3-0.5 s damped 5-12 Hz oscillation plus a slow
            # half-wave on the tubing-side electrodes, homologous side smaller (ventilator-artifact-water-motion)
            f_b = float(ev.get("frequency_hz", 0.35))
            rng = substream(self.seed, "vent", k)
            f_osc = float(rng.uniform(5.0, 12.0))
            side = ev.get("side", "all")
            near = chans or (["F8", "T4"] if side == "right" else ["F7", "T3"])
            far = [] if chans else [self._MIRROR.get(near[0], near[0])] if side in ("all", "both") else []
            wts = {near[0]: 1.0, **{c: 0.3 for c in near[1:]}, **{c: 0.35 for c in far}}

            def draw(rng, tt):
                item = (tt, float(rng.uniform(0.3, 0.5)), float(rng.uniform(0.7, 1.0)), float(rng.uniform(0, 2 * np.pi)))
                return item, tt + (1.0 / f_b) * float(np.clip(rng.normal(1.0, 0.012), 0.97, 1.03))
            sig = np.zeros(n)
            for b0, dur, amp, ph in self._event_schedule(k, "vent", a0, a1, draw):
                d = t - b0
                m = (d >= 0) & (d < 0.9)
                if m.any():
                    dd = d[m]
                    osc = np.where(dd < dur, np.sin(np.pi * dd / dur) * np.exp(-dd / (0.6 * dur))
                                   * np.sin(2 * np.pi * f_osc * dd + ph), 0.0)
                    sig[m] += amp * (osc + 0.5 * np.sin(np.pi * dd / 0.9))
            for c, wt in wts.items():
                if c in self._idx:
                    rows[self._idx[c]] = sig * wt * self.VENT_UV * gain
            return rows

        if kind == "electrode_pop":
            # an abrupt step with exponential decay on ONE electrode, 35-110 uV (0.5-1.5 page rows) (F7-Electrode-Pop, Sweat-and-electrode-pop)
            target = (chans or ["T5"])[0]
            rate = float(ev.get("rate_per_h", 2880.0)) / 3600.0
            tau = float(ev.get("decay_s", 0.2))

            def draw(rng, tt):
                item = (tt, float(rng.uniform(35.0, 110.0)) * float(rng.choice([-1.0, 1.0])))
                return item, tt + float(rng.exponential(1.0 / max(rate, 1e-6))) + 0.05
            prof = np.zeros(n)
            for p0, amp in self._event_schedule(k, "pop", a0, a1, draw):
                d = t - p0
                m = (d >= 0) & (d < 8 * tau)
                if m.any():
                    prof[m] += amp * gain * np.exp(-d[m] / tau)
            rows[self._idx.get(target, 0)] = prof
            return rows

        if kind == "sixty_hz":
            # dense 60 Hz (+10 % 120 Hz) only on 1-3 high-impedance electrodes; everything else <= 2 uV with its own
            # phase, so it does not cancel in bipolar and shows only in chains containing a bad electrode (60hz-artifact)
            rng = substream(self.seed, "sixty", k)
            f0 = 60.0 if 60.0 <= 0.45 * self.fs else 50.0
            bad = chans or list(rng.choice(self.scalp, int(rng.integers(1, 4)), replace=False))
            amp = rng.uniform(0.3, 2.0, self.n_elec)
            ph = rng.uniform(0.0, 2 * np.pi, self.n_elec)
            for c in bad:
                amp[self._idx[c]] = self.SIXTY_UV * float(rng.uniform(0.6, 1.4))
            w = 2 * np.pi * f0 * t
            return (amp * gain)[:, None] * (np.sin(w[None, :] + ph[:, None])
                                           + 0.1 * np.sin(2 * w[None, :] + 2 * ph[:, None]))
        return rows

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
            if kind == "chest_pt" and self.spec.get("neuromuscular_blockade") != "complete":
                sig = sig + self._oa(self.st_emg, i0 + 991, n, 1)[0] * 9.0 * gain
            return sig

        if kind == "ventilator":
            f0 = float(ev.get("frequency_hz", 0.35))
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
            rate = float(ev.get("rate_per_h", 2880.0)) / 3600.0
            tau = float(ev.get("decay_s", 0.09))
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

        if kind == "pulse":
            f0 = float(ev.get("frequency_hz", 1.2))
            phase = np.mod(t * f0, 1.0)
            pulse = (np.exp(-0.5 * ((phase - 0.18) / 0.035) ** 2)
                     - 0.35 * np.exp(-0.5 * ((phase - 0.26) / 0.06) ** 2)) * 38.0 * gain
            return pulse

        if kind in ("lateral_eye", "slow_roving_eye", "rem_eye_movements"):
            if kind == "slow_roving_eye":
                prof = np.sin(2 * np.pi * float(ev.get("frequency_hz", 0.25)) * t) * 90.0 * gain
            else:
                a0, a1 = self._event_window(ev)
                rate = float(ev.get("rate_per_h", 360.0 if kind == "lateral_eye" else 900.0)) / 3600.0
                count = max(1, int((a1 - a0) * rate))
                centers = rng.uniform(a0, a1, count)
                prof = np.zeros(n)
                for center in centers[(centers > t[0] - 0.4) & (centers < t[-1] + 0.4)]:
                    d = t - center
                    prof += np.exp(-0.5 * (d / (0.10 if kind == "lateral_eye" else 0.07)) ** 2)
                prof *= 110.0 * gain
            rows = np.zeros((self.n_elec, n))
            left = {"Fp1": 1.0, "F7": 0.45, "F3": 0.35, "T3": 0.12}
            right = {"Fp2": -1.0, "F8": -0.45, "F4": -0.35, "T4": -0.12}
            for i, electrode in enumerate(self.electrodes):
                rows[i] = prof * (left.get(electrode, 0.0) + right.get(electrode, 0.0))
            return rows

        if kind == "glossokinetic":
            f0 = float(ev.get("frequency_hz", 0.7))
            slow = (np.sin(2 * np.pi * f0 * t) + 0.25 * np.sin(4 * np.pi * f0 * t + 0.6)) * 45.0 * gain
            rows = np.zeros((self.n_elec, n))
            field = {"Fp1": 0.7, "Fp2": -0.7, "F7": 1.0, "F8": -1.0,
                     "T3": 0.65, "T4": -0.65, "F3": 0.35, "F4": -0.35}
            for i, electrode in enumerate(self.electrodes):
                rows[i] = slow * field.get(electrode, 0.0)
            return rows

        if kind == "movement":
            slow = self._oa(self.st_delta, i0 + 7717, n, 1)[0] * 95.0 * gain
            emg = (0.0 if self.spec.get("neuromuscular_blockade") == "complete"
                   else self._oa(self.st_emg, i0 + 313, n, 1)[0] * 22.0 * gain)
            burst = 0.5 + 0.5 * np.sin(2 * np.pi * 0.28 * t + 1.0)
            return (slow + emg) * burst

        if kind == "sweat":
            sh = band_shape(self._freqs, 0.16, 0.16, order=1.0)
            st = _Stream("sweat", sh, self._norm_for(sh), self.st_broad.spatial, 0.8)
            return self._oa(st, i0, n, 1)[0] * 130.0 * gain

        if kind == "eye_blink":
            rows = np.zeros((self.n_elec, n))
            rate = float(ev.get("rate_per_h", 1080.0)) / 3600.0
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
                rows[i] = prof * mt.table_value(wmap, e, 0.04)
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

    def _beat_times(self, t0: float, t1: float) -> np.ndarray:
        """R-wave times covering [t0, t1], the same beats ``_ecg`` draws."""
        rr = 60.0 / _ECG_HR[self.age]
        idx = np.arange(math.floor(t0 / rr) - 1, math.ceil(t1 / rr) + 2, dtype=np.int64)
        return idx * rr + self._beat_jitter(idx)

    _ECG_FIELD_POST = {"O1": 1.0, "O2": 0.7, "Pz": 0.5, "T5": 0.55, "P3": 0.45, "T6": 0.4, "P4": 0.4, "C3": 0.15,
                       "T3": 0.15, "Cz": 0.1, "C4": 0.1, "T4": 0.1}

    def _ecg(self, t: np.ndarray, amplitude: float, gradient: bool = False) -> np.ndarray:
        """Synthetic QRS train, opposite polarity over the two hemispheres.

        ``gradient`` (the 0.5.0 ECG artifact): a posterior-left field (``_ECG_FIELD_POST``).  The hemispheric weights
        depend only on |x| and the side, so they are nearly equal along each longitudinal chain and cancel there (6 uV
        bipolar QRS from 22 uV, feature review A110-04); the posterior field survives P3-O1, T5-O1, Cz-Pz and C4-P4.
        """
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
        if gradient:
            # phase D (artifacts-v3 A110-04): a linear field makes every bipolar link equal, so the old 0.5 x - 0.9 y
            # drew the same spike in 16 chains.  A posterior-left field concentrates it in P3-O1 / T5-O1 / Cz-Pz with
            # frontal chains near zero (ECG-artifact-on-an-uncalibrated-screen, Sweat-and-electrode-pop)
            for i, e in enumerate(self.electrodes):
                rows[i] = prof * amplitude * self._ECG_FIELD_POST.get(e, 0.0)
            return rows
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
                 if len(self._sed_t) > 1 else np.full(n, self._sed_amp[0]))
        def sed_value(values: List[float]) -> np.ndarray:
            return (_piecewise(self._sed_t, values, t) if len(self._sed_t) > 1
                    else np.full(n, values[0]))
        sed_delta = sed_value(self._sed_delta)
        sed_alpha = sed_value(self._sed_alpha)
        sed_gamma = sed_value(self._sed_gamma)
        sed_spindle = sed_value(self._sed_spindle)
        sed_theta = sed_value(self._sed_theta)
        sed_emg = sed_value(self._sed_emg)
        v3 = self.spec_version >= 3
        sed_loc = self._sed_v3_at("loc", t, 0.0)
        sed_pdr = self._sed_v3_at("pdr", t, 1.0)
        if v3 and self._calibrating:
            # 0.5.0: amplitude_uv is the UNSEDATED baseline voltage, so calibrate on the drug-free background and let a
            # drug's amplitude change (neonatal midazolam attenuation, anesthetic slow/alpha growth) reach the page
            beta_w = np.full(n, 0.10 if self.age != "neonate" else 0.05)
            amp_w = np.ones(n)
            sed_delta, sed_alpha, sed_gamma, sed_spindle = (np.zeros(n) for _ in range(4))
            sed_theta, sed_emg, sed_pdr = np.ones(n), np.ones(n), np.ones(n)
            sed_loc = np.zeros(n)

        def s3(key: str, neutral: float) -> np.ndarray:
            return np.full(n, neutral) if self._calibrating else self._sed_v3_at(key, t, neutral)

        # --- background mixture -------------------------------------------
        x = self._stream_signal(self.st_broad, i0, n) * (0.80 + 0.20 * sleep)[None, :]

        v3state = bool(self._hypno)
        if v3state:
            aro = sv3.arousal_gate(t, self._arousals_v3)
            stage_pdr = sv3.weight(t, self._hypno, sv3.PDR)
            eye_pdr, eye_blink = self._eye_factor(t)
            pdr_w = np.maximum(stage_pdr * eye_pdr, 0.6 * aro) * (1.0 - 0.55 * temp_slow)
        else:
            pdr_w = (1.0 - 0.55 * sleep) * (1.0 - 0.55 * temp_slow)
        pdr_w *= 1.0 + np.minimum(sed_alpha, 0.0)
        if v3:
            pdr_w = pdr_w * sed_pdr
        if self.age != "neonate":
            x += self._stream_signal(self.st_pdr, i0, n) * (0.62 * self.pdr_gain * pdr_w)[None, :]
            # 0.5.0: awake theta by age.  Digitized against learningeeg 5-year-old awake figures, a flat 0.30 gave a
            # child half the reference theta share (0.17 vs 0.35 of 1-30 Hz) and a PDR that looked too pure
            theta0 = self._THETA_W_V3.get(self.age, 0.30) if self.spec_version >= 3 else 0.30
            x += self._stream_signal(self.st_theta, i0, n) * ((theta0 + 0.25 * sleep) * sed_theta)[None, :]
        elif self.spec_version >= 3:
            # 0.5.0 (feature review, neonatal item 5: rel delta 0.93-0.96 and rel alpha <= 0.01 on every card): bursts
            # carry dense theta and superimposed fast activity, and the trace-alternant interburst is MIXED theta and
            # delta (ACNS 2013), not a voltage-scaled copy of the burst.  Theta therefore takes a higher interburst
            # floor than the delta (``_neo_theta_gain``: the burst envelope is divided back out and re-applied with
            # that floor), and a small fast stream rides the bursts.
            x += (self._stream_signal(self.st_theta, i0, n) * (NEO_THETA_W * sed_theta)[None, :]
                  * self._neo_theta_gain(t))
            x += self._stream_signal(self.st_brush, i0 + 7717, n) * NEO_FAST_W
            w_sws = self._neo_sws_w(t)
            if w_sws.any():
                # the quiet-sleep bursts stay dense with theta and fast activity under the slow waves (LE-QS4d, ACNS 2b)
                bo = self._neo_burst_only_gain(t)
                u = w_sws / NEO_SWS_W
                x += self._stream_signal(self.st_neo_sws, i0, n) * w_sws[None, :] * bo
                # (theta with the trace-alternant interburst floor of _neo_theta_gain, so the interburst stays the
                # more theta-rich part, ACNS 2013)
                th = self._stream_signal(self.st_theta, i0 + 6113, n) * u[None, :]
                x += th * (NEO_SWS_THETA_W * bo + NEO_SWS_THETA_IB_W * self._neo_theta_gain(t))
                x += self._stream_signal(self.st_brush, i0 + 6211, n) * (NEO_SWS_FAST_W * u)[None, :] * bo
        else:
            x += self._stream_signal(self.st_theta, i0, n) * (0.22 * sed_theta)[None, :]

        # 0.5.0: sleep raises voltage (the review measured wake 34 -> sleep 34 uV); deeper stages carry more delta
        delta_w = 0.14 + 0.85 * self.slow_fraction + (1.1 if v3state else 0.45) * sleep + 0.70 * temp_slow + sed_delta
        if self.spec_version >= 3 and self.age == "neonate" and self._state_intervals:
            # 0.5.0 (feature review B1-09): past term, quiet sleep becomes continuous HIGH-voltage slow-wave sleep
            # (ACNS 2013: 50-150 uV delta/theta replacing TA by 46 w), the highest-voltage state of the cycle
            mature = float(np.interp(self._pma_eff(), [40.0, 44.0], [0.0, 1.0]))
            if mature > 0:
                # phase D: most of it now comes from the 0.5-1.5 Hz slow-wave stream (_neo_sws_w); st_delta's 1.6-Hz band
                # at 1.6 drew continuous 2-4 Hz activity that read as active sleep
                delta_w = delta_w + 0.5 * mature * self._state_lookup(
                    t, {"awake": 0.0, "active_sleep": 0.0, "indeterminate": 0.3, "quiet_sleep": 1.0}, np.zeros_like(t))
        cape_b = self.cape_phase(t) if (self.spec_version >= 3 and self.bg.get("cape")) else None
        if cape_b is not None:
            delta_w = delta_w * (1.0 - self._CAPE_SPECTRUM[0] * cape_b)
            beta_w = beta_w * (1.0 + self._CAPE_SPECTRUM[2] * cape_b)
            x += (self._stream_signal(self.st_theta, i0, n)
                  * (self._CAPE_SPECTRUM[1] * (0.30 + 0.25 * sleep) * sed_theta * cape_b)[None, :])
        x += self._stream_signal(self.st_delta, i0, n) * delta_w[None, :]
        if v3state and self.st_sws is not None:
            x += self._stream_signal(self.st_sws, i0, n) * (self._SWS_W_V3.get(self.age, 1.2) * sv3.weight(t, self._hypno, {"N3": 1.0, "N2": 0.12}))[None, :]
        x += self._stream_signal(self.st_beta, i0, n) * beta_w[None, :] * self._breach_fast[:, None]
        x += self._stream_signal(self.st_sed_alpha, i0, n) * np.maximum(sed_alpha, 0.0)[None, :]
        x += self._stream_signal(self.st_sed_gamma, i0, n) * sed_gamma[None, :]
        bs_mix = None
        if v3:
            beta3 = s3("beta3", 0.0)
            if beta3.any():
                f1, f2, p1, p2 = self._beta_am
                am = np.clip(1.0 + 0.6 * np.sin(2 * np.pi * f1 * t + p1) + 0.35 * np.sin(2 * np.pi * f2 * t + p2), 0.15, None)
                x += self._stream_signal(self.st_sed_beta, i0, n) * (beta3 * am)[None, :]
            barb = s3("barb", 0.0)
            if barb.any():
                x += self._stream_signal(self.st_barb, i0, n) * barb[None, :]
            gamma3 = s3("gamma3", 0.0)
            if gamma3.any():
                keta = s3("keta", 0.0)
                g = self._keta_gate(t)
                # phase D (sedation-v3 S109-05; Purdon 2015 Fig 9C): continuous low-voltage fast activity riding the
                # slow drift, dipping only mildly in the slow-delta epochs (Akeju 2016 "gamma burst").  Gating it 5:1
                # drew discrete 1-1.5 s, 20-40 uV packets
                x += self._stream_signal(self.st_gamma3, i0, n) * (0.35 * gamma3 * (1.0 - keta * (1.0 - g) * 0.5))[None, :]
                x += self._stream_signal(self.st_delta, i0 + 3331, n) * (1.6 * gamma3 * keta * (1.0 - g))[None, :]
            if self._sed_driven_bs() and not self._calibrating:
                # 0.5.0: a barbiturate burst is not gated awake EEG (sedation.md S109-06): past sf 0.1 the burst
                # content becomes high-voltage polymorphic slow and sharp activity
                sf = _piecewise(self._sed_t, self._sed_sf, t)
                bs_mix = np.clip((sf - 0.1) / 0.2, 0.0, 1.0)
                if bs_mix.any():
                    x = x * (1.0 - 0.8 * bs_mix)[None, :] + self._burst_content_rows(t, i0) * bs_mix[None, :]

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
        gen = self._gen if (self._gen is not None and not self._calibrating) else None
        if gen is not None:
            # 0.5.0 phase D: an absence replaces the background, a tonic seizure decrements it, a GTC ends in
            # postictal suppression (the ictal rows themselves are added after the envelopes, below)
            dec = dec * gen.bg_factor(t)
        # 0.4.1 (Craig, P5 C08 "shouldn't have fast muscle"): an unreactive patient - sedated,
        # paralysed, post-anoxic - has no tonic muscle, inside bursts included.  Version 2 only.
        unreactive = self.spec_version >= 2 and self.bg.get("reactivity") == "absent"
        blocked = self.spec.get("neuromuscular_blockade") == "complete"
        sleep_emg = (np.maximum(sv3.weight(t, self._hypno, sv3.EMG), 0.8 * aro) if v3state else (1.0 - 0.75 * sleep))
        emg_w = ((0.0 if unreactive or blocked else EMG_FLOOR_W) * sed_emg * sleep_emg * self.burst_envelope(t)
                 * (1.0 + self.ictal_gate(t))
                 * (1.0 - ABSENCE_EMG_DROP * self.absence_gate(t))
                 * dec
                 * (gen.emg_factor(t) if gen is not None else 1.0)
                 # an infant's temporalis floor is a fraction of a child's
                 * (0.45 if self.age == "infant" else self._neo_emg_v3(t) if self.age == "neonate" else 1.0))
        muscle_term = self._stream_signal(self.st_muscle, i0, n) * emg_w[None, :]
        if self._breach_gain is None:
            x += muscle_term

        if v3state:
            # 0.5.0: scheduled spindle packets in N2/N3 (2.6 background-RMS units at the field maximum); the drug
            # spindle weight (dexmedetomidine) adds to the stage rate through the same packets
            x += self._spindle_rows_v3(t) * (2.6 * (1.0 + sed_spindle))[None, :]
            if not self._calibrating and self._dsp["t"].size:
                # dexmedetomidine spindles in wake too: their own irregular schedule, same packet shape and field
                x += self._drug_spindle_rows(t) * (self._DRUG_SPINDLE_W * sed_spindle)[None, :]
        elif self.age != "neonate":
            spindle_phase = np.mod(t, 3.7)
            spindle_gate = np.where(spindle_phase < 1.2, np.sin(np.pi * spindle_phase / 1.2) ** 2, 0.0)
            train_s = (self.spec.get("style") or {}).get("spindle_train_s")
            if train_s is not None:
                spindle_gate *= np.mod(t - 300.0, 1800.0) < float(train_s)
            x += self._stream_signal(self.st_spindle, i0, n) * ((1.5 * sleep + sed_spindle) * spindle_gate)[None, :]
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
            if self.st_polydelta is not None:
                # added outside the side's attenuation (divided back out below): the slowing is not attenuated
                x += (self._stream_signal(self.st_polydelta, i0, n)
                      * (POLYDELTA_W * min(1.0, float(self.slow_side.max())) / self.gain_asym)[:, None])
        if self._breach_gain is not None:
            # 0.5.0: breach gain on cerebral activity only, then the muscle floor.  The display calibration measures
            # the record without the defect, so a breach no longer turns the rest of the head down (T3 read 0.9x)
            x = (x if self._calibrating else x * self._breach_gain[:, None]) + muscle_term

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
        if self.spec_version >= 3 and self.seizures:
            x *= self.postictal_rows_v3(t)
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
        if self.spec_version >= 3 and self.stimulations:
            # 0.5.0 phase D: stimulation.response increase / attenuation / paradoxical / none (ACNS 2021 A5)
            x = rpp3.stimulus_rows(self, x, t, i0, n)
        for ev in (self.stimulations if self.spec_version < 3 else []):
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
        if gen is not None:
            x += gen.rows(t, i0) * self._ch_gain[:, None]
        if self.spec_version >= 3 and self.bg["type"] == "burst_suppression":
            x += self._burst_onset_rows(t) * self._ch_gain[:, None]
        if self.spec_version >= 3 and self.ictal:
            x += self._postictal_delta_rows(t, i0, n)
        if self.spec_version >= 3 and self.ictal:
            x += self._ictal_emg_rows_v3(t, i0, n)
        # multifocal spikes (hypsarrhythmia), attenuated through a decrement
        # (phase D, epileptiform-v3 SPASM: at depth 0.6 they ran on at 40 % through the decrement, which
        # atlas-infantile-spasm-ii does not show; v3 silences them: 1 - 1.6 * (1 - dec))
        dec_spk = np.clip(1.0 - 1.6 * (1.0 - dec), 0.0, 1.0) if self.spec_version >= 3 else dec
        x += self._multifocal_spike_rows(t) * (dec_spk * self.burst_envelope(t))[None, :] * self._ch_gain[:, None]
        # P7 batch 5: sporadic interictal discharges and pediatric normal variants; both ride the
        # burst gate and any decrement like the multifocal spikes, in absolute microvolts
        if (getattr(self, "_sed", None) is not None or getattr(self, "_variants", None)
                or getattr(self, "_variants_v3", None) or getattr(self, "_authored_variants", None)):
            gate_bv = (dec * self.burst_envelope(t))[None, :] * self._ch_gain[:, None]
            x += self._sed_rows(t) * gate_bv
            x += self._variant_rows(t) * gate_bv
            x += self._authored_variant_rows(t) * gate_bv

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
        # 0.5.0: an unconscious patient does not blink or open the eyes, and under complete neuromuscular blockade the
        # lids and extraocular muscles are paralysed too (sedation.md S109-01..06, S109-09)
        eyes = (np.zeros(n) if blocked else 1.0 - sed_loc) if v3 else 1.0
        if v3state:
            gate = sv3.weight(t, self._hypno, sv3.BLINK) * eye_blink * env * (1.0 - self.absence_gate(t)) * eyes
            x += self.blink_rows(t, gate)
            x += self._eye_event_rows(t) * (env * (1.0 - self.absence_gate(t)) * eyes)[None, :]
            x += self._sleep_transient_rows(t) * env[None, :] * self._ch_gain[:, None]
        elif self.spec_version >= 3 and self.age == "neonate":
            # 0.5.0: a neonate blinks only while awake (feature review, neonatal item 4), never in active sleep
            awake = self._state_lookup(t, {"awake": 1.0, "active_sleep": 0.0, "indeterminate": 0.0, "quiet_sleep": 0.0},
                                       1.0 - sleep)
            x += self.blink_rows(t, awake * env * (1.0 - self.absence_gate(t)))
        else:
            x += self.blink_rows(t, (1.0 - sleep) * env * (1.0 - self.absence_gate(t)) * eyes)
        # Neonatal graphoelements (microvolts; burst-bound ones gated inside).
        if self.age == "neonate":
            x += self.graphoelement_rows(t) * self._ch_gain[:, None]
        ecg_uv = float(self.bg.get("baseline_ecg_uv", 0.0))
        if self._sed_driven_bs():
            # 0.5.0 (re-review): ECG shows through a drug-induced suppression.  At least 5 uV, drawn with the
            # front-to-back gradient so it survives the longitudinal chains (the default weights cancel there)
            x += self._ecg(t, amplitude=max(ecg_uv, 5.0), gradient=True)
        elif ecg_uv > 0:
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
            if isinstance(b, tuple):
                # 0.5.0 viewer montages: mean of several electrodes (linked ears, Laplacian, neonatal average)
                rows.append(x[ia] - x[[self._idx[c] for c in b]].mean(axis=0))
            elif b is not None:
                rows.append(x[ia] - x[self._idx[b]])
            elif montage == "average":
                rows.append(x[ia] - avg)
            else:
                ref = "A1" if mt.side_of(a) != "right" else "A2"
                rows.append(x[ia] - x[self._idx[ref]])
        return np.asarray(rows)
