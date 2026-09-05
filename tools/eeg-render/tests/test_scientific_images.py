import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest
from scipy import signal

RENDERER = Path(__file__).resolve().parents[1]
ROOT = RENDERER.parents[1]
sys.path.insert(0, str(RENDERER))

from eeg_render.spec import load_question, normalize, style_warnings
from eeg_render.synth import Synthesizer
from eeg_render.trends import Trends, hemisphere_chains, seizure_probability
from eeg_render.render_aeeg import aeeg_derivations, synth_spec_for_aeeg, _header
from eeg_render import style


def question(ident):
    return load_question(ROOT / 'content/qbank/questions' / f'{ident}.yaml')


@pytest.mark.parametrize('ident', ['PQ-B-012', 'PQ-B-022'])
def test_confirmatory_raw_page_contains_actual_seizure(ident):
    spec = normalize(question(ident).image)['spec']
    panel, page = spec['qeeg_panel'], spec['eeg_page']
    synth = Synthesizer(panel, panel['duration_min'] * 60)
    start = page['at_min'] * 60
    end = start + page['window_s']
    assert any(min(end, seizure.t1) - max(start, seizure.t0) >= 10 for seizure in synth.seizures)


def test_suppressed_raw_intervals_survive_sensor_noise():
    spec = normalize(question('PQ-A-003').image)['spec']
    synth = Synthesizer(spec, 180 * 60)
    chains = hemisphere_chains(synth, spec)
    for minute, limits in [(20, (15, 35)), (70, (40, 65)), (130, (70, 85))]:
        _, raw = synth.segment(minute * 60 - 5, (minute + 3) * 60 + 5)
        sos = signal.butter(4, [0.5, 30], btype='bandpass', fs=synth.fs, output='sos')
        for pairs in chains.values():
            displayed = signal.sosfiltfilt(sos, synth.derive(raw, pairs), axis=-1)
            displayed = displayed[:, 5*synth.fs:-5*synth.fs]
            epochs = displayed.reshape(len(pairs), -1, synth.fs // 2)
            amplitude = np.ptp(epochs, axis=-1).mean(axis=0)
            measured = 100 * np.mean(amplitude < 5)
            assert limits[0] <= measured <= limits[1], (minute, measured)


def test_requested_neonatal_parietal_derivations_are_not_substituted():
    spec = normalize(question('PQ-B-001').image)['spec']
    synth = Synthesizer(synth_spec_for_aeeg(spec), spec['duration_h'] * 3600)
    assert aeeg_derivations(spec, synth) == [('C3', 'P3'), ('C4', 'P4')]


def test_generalized_aeeg_seizures_retain_both_hemisphere_generators():
    spec = normalize(question('PQ-B-011').image)['spec']
    synth = Synthesizer(synth_spec_for_aeeg(spec), spec['duration_h'] * 3600)
    assert all(seizure.onset_region == 'generalized' for seizure in synth.seizures)


def test_learner_header_does_not_reveal_pattern_or_cycling():
    import matplotlib.pyplot as plt
    spec = normalize(question('PQ-B-001').image)['spec']
    fig = plt.figure()
    _header(fig, spec, style.theme_for(spec['style']['theme']), spec['style'], '')
    text = ' '.join(item.get_text() for item in fig.texts)
    plt.close(fig)
    assert 'pattern' not in text.lower() and 'cycling' not in text.lower()
    assert 'SYNTHETIC' in text


def test_prolonged_rhythmic_seizure_does_not_become_its_own_baseline():
    t = np.arange(1, 3601, 2)
    tr = Trends(t=t, hop_s=2, freqs=np.arange(13), rhy_freqs=np.arange(1, 13))
    ictal = (t >= 600) & (t < 3500)
    for side in ['left', 'right']:
        tr.rhy[side] = np.full((12, len(t)), 0.15)
        tr.rhy[side][1, ictal] = 0.95
        tr.psd[side] = np.ones((13, len(t)))
        tr.psd[side][2, ictal] = 1000
    p = seizure_probability(tr)
    assert np.median(p[t < 300]) < 0.1
    assert np.median(p[(t > 900) & (t < 3300)]) > 0.9


def test_bank_has_no_unrendered_style_requests():
    for folder in ['questions', 'examples']:
        for path in (ROOT / 'content/qbank' / folder).glob('*.yaml'):
            assert not style_warnings(normalize(load_question(path).image)), path.name


def test_highly_epileptiform_bursts_generate_real_raw_voltage():
    import copy

    spec = normalize(question('PQ-A-022').image)['spec']['qeeg_panel']
    synth = Synthesizer(spec, spec['duration_min'] * 60)
    baseline_spec = copy.deepcopy(spec)
    baseline_spec['background']['burst_suppression']['epileptiform_discharges'] = 0
    baseline = Synthesizer(baseline_spec, spec['duration_min'] * 60)
    indices = np.flatnonzero(synth._burst_start > 0)[:10]
    start, end = synth._burst_start[indices[0]], synth._burst_end[indices[-1]]
    t, raw = synth.segment(start, end)
    _, background = baseline.segment(start, end)
    component = np.max(np.abs(raw - background), axis=0)
    marked = [np.max(component[(t >= synth._burst_start[i]) & (t < synth._burst_end[i])]) > 1
              for i in indices]
    assert sum(marked) == 8


def test_worker_rejects_queued_image_for_superseded_spec(monkeypatch):
    loader = importlib.util.spec_from_file_location('image_worker', RENDERER / 'worker.py')
    worker = importlib.util.module_from_spec(loader)
    loader.loader.exec_module(worker)
    calls = []
    monkeypatch.setattr(worker, 'claim_job', lambda db: {'id': 'job', 'case_id': 'case', 'spec': {'seed': 1}})
    monkeypatch.setattr(worker, 'render_image', lambda *args: pytest.fail('superseded render ran'))

    class DB:
        def request(self, path, method='GET', body=None, **kwargs):
            calls.append((path, method, body))
            if method == 'GET':
                return [{'id': 'case', 'qbank_id': 'PQ-TEST-001', 'version': 2, 'spec': {'seed': 2},
                         'content': {'image': {'kind': 'aeeg', 'spec': {'seed': 2}}}}]
            return []

    assert worker.process_one(DB())
    assert not any('/eeg_cases?' in path and method == 'PATCH' for path, method, _ in calls)
    assert calls[-1][2]['status'] == 'error'


def test_aeeg_semilog_honors_extended_amplitude_scale():
    from eeg_render.style import aeeg_forward

    positions = aeeg_forward([10, 100, 250, 500], vmax=500)
    assert np.all(np.diff(positions) > 0)
    assert positions[-1] == pytest.approx(1)
    assert positions[0] == pytest.approx(aeeg_forward(10))


@pytest.mark.parametrize('changed_during_render', [False, True])
def test_worker_attaches_immutable_image_only_to_matching_version(monkeypatch, changed_during_render):
    loader = importlib.util.spec_from_file_location('image_worker', RENDERER / 'worker.py')
    worker = importlib.util.module_from_spec(loader)
    loader.loader.exec_module(worker)
    calls, uploads = [], []
    monkeypatch.setattr(worker, 'claim_job', lambda db: {'id': 'job', 'case_id': 'case', 'spec': {'seed': 1}})
    monkeypatch.setattr(worker, 'render_image', lambda *args: (Path('mock.png'),
                        {'width': 1600, 'height': 900, 'spec_hash': 'sha256:0123456789abcdef'}))

    class DB:
        def request(self, path, method='GET', body=None, **kwargs):
            calls.append((path, method, body, kwargs))
            if method == 'GET':
                return [{'id': 'case', 'qbank_id': 'PQ-TEST-001', 'version': 2, 'spec': {'seed': 1},
                         'content': {'image': {'kind': 'aeeg', 'spec': {'seed': 1}}}}]
            if '/eeg_cases?' in path:
                return [] if changed_during_render else [{'id': 'case'}]
            return []

        def upload_png(self, path, png):
            uploads.append(path)
            return 'https://example.invalid/' + path

    assert worker.process_one(DB())
    assert uploads == ['qbank/PQ-TEST-001/2-0123456789abcdef.png']
    attachment = next(call for call in calls if call[1] == 'PATCH' and '/eeg_cases?' in call[0])
    assert '&version=eq.2' in attachment[0]
    assert attachment[3]['extra']['Prefer'] == 'return=representation'
    assert calls[-1][2]['status'] == ('error' if changed_during_render else 'done')
