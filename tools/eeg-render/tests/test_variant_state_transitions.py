"""Natural variant eligibility uses clinical state and preserves each original scheduled burst."""
import numpy as np
import pytest

from eeg_render.export.manifest import realized_events
from eeg_render.spec import normalize
from eeg_render.synth import Synthesizer


def _syn(kind, changes=(), context=None, bg_variants=None, age='adult', **extra):
    event = {'type':'normal_variant','kind':kind,'at_min':2,'duration_s':60}
    if context is not None:
        event['context'] = context
    background = {'type':'continuous','amplitude_uv':40,'dominant_hz':9,'reactivity':'present',
                  'blink_rate_per_min':0}
    if bg_variants:
        background['variants'] = bg_variants
    image = {'kind':'eeg_page','license':'synthetic-original','spec':{
        'spec_version':3,'seed':991001,'age_group':age,'sample_rate':256,'channels':'standard_19',
        'duration_min':8,'background':background,'events':[event,*changes],**extra}}
    spec = normalize(image)['spec']
    return Synthesizer(spec,480)


def _state(at, to):
    return {'type':'state_change','at_min':at/60,'to':to}


def test_crossing_variant_is_split_and_original_burst_identity_is_retained():
    plain = _syn('mu')
    split = _syn('mu', [_state(132,'sedated'), _state(150,'wake')])
    assert split._authored_variants[0]['bursts'] == plain._authored_variants[0]['bursts']
    t = np.arange(120,180,1/256)
    p = plain._authored_variant_rows(t)
    x = split._authored_variant_rows(t)
    denied = (t >= 132) & (t < 150)
    assert np.max(np.abs(p[:,denied])) > 10
    assert np.max(np.abs(x[:,denied])) == 0
    assert np.array_equal(x[:,~denied], p[:,~denied])
    keys = [r for r in realized_events(split,480) if r.get('variant') == 'mu']
    assert keys and all(r['offset_s'] <= 132 or r['onset_s'] >= 150 for r in keys)
    assert any(r['onset_s'] < 132 for r in keys) and any(r['onset_s'] >= 150 for r in keys)
    whole = split.segment(120,180)[1]
    chunks = np.concatenate([split.segment(a,min(a+7,180))[1] for a in np.arange(120,180,7)],axis=1)
    assert np.max(np.abs(whole-chunks)) < 1e-9


@pytest.mark.parametrize('kind', ['mu','lambda','midline_theta','wicket','rmtd','fourteen_and_six','sreda',
                                  'photic_driving','hyperventilation_buildup'])
@pytest.mark.parametrize('clinical', ['sedated','comatose'])
def test_benign_variants_do_not_inherit_drug_or_coma_proxy_stages(kind,clinical):
    syn = _syn(kind,[_state(0,clinical)])
    t = np.arange(120,180,1/256)
    assert np.max(np.abs(syn._authored_variant_rows(t))) == 0
    assert not [r for r in realized_events(syn,480) if r.get('variant') == kind]
    assert not syn.photic_flashes(120,180).size


def test_midline_theta_drowsiness_is_not_n2_or_rem_depth():
    syn = _syn('midline_theta',[_state(0,'drowsy')],context='drowsy')
    assert syn.authored_variant_runs()
    # The old scalar range admitted depth 0.65/N2 and 0.25/REM. Test actual labels with exact boundaries.
    syn._hypno = [(0,140,'N1'),(140,160,'N2'),(160,480,'R')]
    syn._natural_hypno_cache = None
    syn._clinical_boundaries_cache = None
    assert syn.allowed_feature_intervals('midline_theta',120,180,'drowsy') == [(120,140)]
    t = np.arange(120,180,1/256)
    x = syn._authored_variant_rows(t)
    assert np.max(np.abs(x[:,t<140])) > 10
    assert np.max(np.abs(x[:,t>=140])) == 0


def test_background_sleep_variants_and_their_keys_use_same_clinical_gate():
    syn = _syn('mu',[_state(60,'sleep'),_state(132,'sedated')],age='child',
               bg_variants={'posts':{'amplitude_uv':100},'hypnagogic_hypersynchrony':{'rate_per_min':30,'amplitude_uv':200}})
    t = np.arange(60,180,1/256)
    x = syn._variant_rows(t)
    assert np.max(np.abs(x[:,t<132])) > 20
    assert np.max(np.abs(x[:,t>=132])) == 0
    assert all(r['t1'] <= 132 for r in syn.variant_runs())


def test_pswy_closed_eye_condition_respects_authored_scanning():
    syn = _syn('lambda',bg_variants={'posterior_slow_waves_of_youth':{'rate_per_min':30,'amplitude_uv':150}})
    t = np.arange(120,180,1/256)
    assert syn.authored_variant_runs()  # adult lambda is physiologically possible
    assert np.max(np.abs(syn._authored_variant_rows(t))) > 10
    assert np.max(np.abs(syn._variant_rows(t))) == 0
    assert all(r['t1'] <= 120 or r['t0'] >= 180 for r in syn.variant_runs())


def test_expanded_hv_interval_is_gated_after_minimum_duration_extension():
    syn = _syn('hyperventilation_buildup',[_state(0,'comatose'),_state(120,'wake')])
    run = syn._authored_variants[0]
    assert run['t0'] == 0 and run['eligible_intervals'] == [(120,180)]
    t = np.arange(0,200,1/256)
    x = syn._authored_variant_rows(t)
    assert np.max(np.abs(x[:,t<120])) == 0
    assert np.max(np.abs(x[:,(t>=120)&(t<180)])) > 10
    keys = [r for r in realized_events(syn,480) if r.get('variant') == 'hyperventilation_buildup']
    assert keys[0]['onset_s'] == 120


@pytest.mark.parametrize('kind',['wicket','rmtd'])
def test_relaxed_wake_exception_requires_explicit_awake_context(kind):
    default = _syn(kind)
    awake = _syn(kind,[_state(150,'drowsy')],context='awake')
    assert not default.authored_variant_runs()
    keys = awake.authored_variant_runs()
    assert keys and all(r['t1'] <= 150 and r['context'] == 'awake' for r in keys)
    t = np.arange(120,180,1/256)
    x = awake._authored_variant_rows(t)
    assert np.max(np.abs(x[:,t<150])) > 10
    assert np.max(np.abs(x[:,t>=150])) == 0
