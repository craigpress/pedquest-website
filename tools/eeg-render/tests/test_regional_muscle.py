"""Source-field, carrier calibration and random-access muscle contracts."""
import numpy as np
import pytest
from scipy.signal import get_window, welch

from eeg_render.muscle_v3 import RegionalMuscle
from eeg_render.synth import Synthesizer, FRAME_S, hp_lp_shape


ELECTRODES = ("Fp1", "Fp2", "F7", "F8", "T3", "T4", "T5", "T6",
              "F3", "F4", "Fz", "C3", "C4", "Cz", "P3", "P4",
              "Pz", "O1", "O2", "A1", "A2")
FS = 256


class Carriers:
    """Exercise production frame-seeded OA without cerebral mixing/calibration."""
    def __init__(self, model):
        self.syn = object.__new__(Synthesizer)
        self.syn.seed = model.seed
        self.syn.frame_n = int(FS * FRAME_S)
        self.syn.hop_n = self.syn.frame_n // 2
        self.syn._win = np.sqrt(get_window("hann", self.syn.frame_n, fftbins=True))
        self.syn._norm_cache = {}
        f = np.fft.rfftfreq(self.syn.frame_n, 1 / FS)
        self.streams = {}
        for name, (lo, hi) in model.bands.items():
            shape = hp_lp_shape(f, lo, hi)
            self.streams[name] = self.syn._mk("regional-muscle/" + name, shape,
                                             np.ones(len(ELECTRODES)), 0.0)

    def sample(self, model, i0, n):
        t = np.arange(i0, i0 + n) / FS
        return model.sample(t, lambda name, count: self.syn._oa(self.streams[name], i0, n, count))


def test_arbitrary_chunks_and_out_of_order_are_identical():
    model = RegionalMuscle(97, ELECTRODES, 180, posterior=True)
    carrier = Carriers(model)
    i0, n = -3 * FS + 17, 32 * FS + 11
    whole = carrier.sample(model, i0, n)
    splits = (0, 131, 997, 4021, n)
    for a, b in reversed(list(zip(splits[:-1], splits[1:]))):
        np.testing.assert_array_equal(carrier.sample(model, i0 + a, b - a), whole[:, a:b])


def test_posterior_option_does_not_reseed_other_regions_or_change_duration_prefix():
    short = RegionalMuscle(51, ELECTRODES, 30)
    long = RegionalMuscle(51, ELECTRODES, 600, posterior=True)
    t = np.arange(-1, 31, 1 / FS)
    for band, envelope in short.envelopes(t).items():
        np.testing.assert_array_equal(envelope, long.envelopes(t)[band])
    assert "posterior" not in short.bands
    assert "posterior" in long.bands


def test_envelopes_are_positive_irregular_continuous_and_laterally_independent():
    model = RegionalMuscle(307, ELECTRODES, 600, posterior=True)
    t = np.arange(0, 600, 1 / FS)
    for envelope in model.envelopes(t).values():
        assert envelope.min() > 0
        assert envelope.max() / envelope.min() > 5
        assert np.max(np.abs(np.diff(envelope))) < 0.12
        assert abs(np.corrcoef(envelope)[0, 1]) < 0.5
        # Continuous drift replaces repeated on/off plateaux.
        assert np.mean(np.diff(envelope[0]) == 0) < 0.01


def test_anchor_variance_matches_fixed_carrier_units_and_central_field_is_weak():
    model = RegionalMuscle(211, ELECTRODES, 600, posterior=True)
    signal = Carriers(model).sample(model, 0, 600 * FS)
    t = np.arange(signal.shape[1]) / FS
    envelopes = model.envelopes(t)
    expected_variance = sum(np.mean((field ** 2).T @ (envelopes[band] ** 2), axis=1)
                            for band, field in model._fields.items())
    observed = np.mean(signal ** 2, axis=1)
    for name in ("Fp1", "Fp2", "T3", "T4", "O1", "O2"):
        i = ELECTRODES.index(name)
        assert observed[i] / expected_variance[i] == pytest.approx(1.0, abs=0.10)
    temporal = np.sqrt(observed[ELECTRODES.index("T3")])
    central = np.sqrt(observed[ELECTRODES.index("C3")])
    vertex = np.sqrt(observed[ELECTRODES.index("Cz")])
    assert 0.65 < temporal < 1.4
    assert central < 0.15 * temporal
    assert vertex < 0.06 * temporal
    assert np.sqrt(observed[ELECTRODES.index("O1")]) < 0.4 * temporal


def test_fast_sources_have_local_covariance_without_global_synchrony():
    model = RegionalMuscle(451, ELECTRODES, 180)
    signal = Carriers(model).sample(model, 0, 180 * FS)
    names = ("T3", "T4", "F7", "Fp1", "Fp2")
    corr = np.corrcoef(signal[[ELECTRODES.index(e) for e in names]])
    pair = lambda a, b: corr[names.index(a), names.index(b)]
    assert 0.12 < pair("T3", "F7") < 0.40
    assert abs(pair("T3", "T4")) < 0.05
    assert abs(pair("Fp1", "Fp2")) < 0.12


def test_frontal_and_temporal_spectra_and_reference_effects_are_distinct():
    model = RegionalMuscle(83, ELECTRODES, 180, posterior=True)
    signal = Carriers(model).sample(model, 0, 180 * FS)
    f, psd = welch(signal, FS, nperseg=FS * 2, axis=1)
    high = (f >= 60) & (f <= 90)
    mid = (f >= 25) & (f <= 45)
    ratio = psd[:, high].sum(axis=1) / psd[:, mid].sum(axis=1)
    assert ratio[ELECTRODES.index("T3")] > 4 * ratio[ELECTRODES.index("Fp1")]
    # Shared endpoints cancel part of regional source voltage in bipolar;
    # mastoid subtraction can broadcast peripheral artifact centrally.
    t3, f7, cz, a1 = (signal[ELECTRODES.index(e)] for e in ("T3", "F7", "Cz", "A1"))
    assert np.var(t3 - f7) < np.var(t3) + np.var(f7)
    assert np.std(cz - a1) > 2 * np.std(cz)


def test_no_sampling_dependency_on_cerebral_state_or_call_order():
    model = RegionalMuscle(17, ELECTRODES, 180)
    carrier = Carriers(model)
    before = carrier.sample(model, 33 * FS, 12 * FS)
    carrier.sample(model, 0, 80 * FS)
    np.testing.assert_array_equal(carrier.sample(model, 33 * FS, 12 * FS), before)
    assert set(model.bands) == {"frontal", "temporal"}
    assert all(count == len(ELECTRODES) + 2 for count in model.row_counts.values())
