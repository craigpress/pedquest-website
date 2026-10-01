import pytest

from eeg_render.spec import normalize, spec_warnings


@pytest.mark.parametrize("version", [1, 2, 3])
def test_gallery_controls_warn_only_for_legacy_synthesis(version):
    image = normalize({
        "kind": "eeg_page", "license": "synthetic-original", "attribution": None,
        "spec": {"spec_version": version, "seed": 7, "duration_min": 10, "age_group": "child",
                 "background": {"type": "continuous", "variants": {"posts": {"interval_s": 1.7}}},
                 "style": {"spindle_topography": "central", "k_complex_spindle_delay_s": 1.5},
                 "events": [
                     {"type": "normal_variant", "kind": "mu", "at_min": 2, "duration_s": 30, "train_duration_s": 9},
                     {"type": "sporadic_discharges", "focus": "right_centrotemporal", "centrotemporal_triphasic": True},
                     {"type": "normal_variant", "kind": "midline_theta", "at_min": 3, "duration_s": 30},
                 ]},
    })
    warnings = spec_warnings(image)
    for key in ("background.variants.posts.interval_s", "events[0].train_duration_s", "events[1].centrotemporal_triphasic",
                "style.spindle_topography", "style.k_complex_spindle_delay_s"):
        assert any(key in warning and "not synthesized below spec_version 3" in warning for warning in warnings) == (version < 3)
    assert not any("midline_theta" in warning for warning in warnings)
