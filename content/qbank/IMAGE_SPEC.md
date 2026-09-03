# Image Spec DSL (`image.spec`) — consumed by `tools/eeg-render`

Every question carries an `image` block. The renderer is **deterministic**:
the same spec + `seed` always yields the same PNG, so editors can tweak a
spec and re-render. Coordinates in outputs (answer regions) are fractions of
image width/height (0–1) so they survive resizing.

```yaml
image:
  kind: qeeg_panel | eeg_page | aeeg | composite
  license: synthetic-original | dataset-derived
  attribution: null            # required when license = dataset-derived
  spec: { ... }                # per kind, below
```

## Common fields

```yaml
seed: 12345                    # integer; required
age_group: neonate | infant | child | adolescent   # sets default background rhythms
sample_rate: 256               # Hz; default 256
channels: standard_19          # 10-20 system, 19 scalp channels (default); neonate → reduced 9-channel set
montage: longitudinal_bipolar | referential | average | neonatal_reduced   # eeg_page display
```

## `background`

```yaml
background:
  type: continuous | discontinuous | burst_suppression | suppressed | low_voltage | excessively_discontinuous | trace_alternant
  dominant_hz: 6.0             # posterior/background dominant frequency
  amplitude_uv: 40             # typical peak-to-peak
  slow_fraction: 0.4           # proportion of delta/theta power
  asymmetry:                   # optional persistent asymmetry
    side: left | right
    attenuation_pct: 60        # amplitude reduction on that side
    slowing_hz: 2.0            # optional focal slowing
  burst_suppression:           # only for type burst_suppression
    burst_s: 2.0
    ibi_s: 8.0                 # inter-burst interval
  reactivity: present | absent  # applied to any `stimulation` event
```

## `events[]` (time in minutes from recording start unless noted)

```yaml
- type: seizure
  onset_min: 95.0
  duration_s: 120
  onset_region: left_temporal | right_temporal | left_frontal | right_frontal | left_central | right_central | left_occipital | right_occipital | left_hemisphere | right_hemisphere | generalized | midline
  evolution: { start_hz: 4.0, end_hz: 1.5, amplitude_start_uv: 60, amplitude_end_uv: 150 }
  spread: none | hemispheric | generalized | contralateral   # later spread
  postictal_attenuation_s: 60                                # optional
- type: seizure_cluster          # repeated stereotyped seizures
  start_min: 30
  end_min: 150
  interval_min: 12
  seizure: { duration_s: 90, onset_region: right_central, evolution: {...} }
- type: status_epilepticus       # continuous or near-continuous ictal activity
  onset_min: 40
  duration_min: 45
  onset_region: generalized
- type: sedation_change
  at_min: 120
  direction: increase | decrease
  agent: propofol | midazolam | pentobarbital | dexmedetomidine | ketamine
  effect: { suppression_ratio_target_pct: 60, beta_boost: true, ramp_min: 10 }
- type: attenuation_transient    # abrupt diffuse or focal attenuation (e.g., ischemia)
  at_min: 200
  duration_min: 8
  side: both | left | right
  depth_pct: 80
- type: temperature_change
  at_min: 0
  from_c: 33.0
  to_c: 36.5
  over_min: 240
- type: stimulation              # tests reactivity
  at_min: 60
- type: artifact
  kind: emg_chewing | patting | chest_pt | ventilator | ecmo_pump | electrode_pop | sixty_hz | ecg | movement | sweat | eye_blink
  at_min: 70
  duration_s: 180
  channels: [T3, T5] | side: left | all
  intensity: low | medium | high
- type: state_change             # sleep/wake or arousal
  at_min: 150
  to: sleep | wake | arousal
```

## `annotations[]` — labels drawn on the time axis (what the bedside team recorded)

```yaml
annotations:
  - { at_min: 100, label: "Lorazepam 0.1 mg/kg" }
  - { at_min: 130, label: "Levetiracetam load" }
```

## `qeeg_panel` specifics

```yaml
duration_min: 240                # 30–2880 (up to 48 h)
panels:                          # top → bottom; default order below
  - seizure_probability
  - rhythmicity_L
  - rhythmicity_R
  - fft_L
  - fft_R
  - asymmetry_relative
  - asymmetry_index
  - aeeg_L
  - aeeg_R
  - suppression_ratio_L
  - suppression_ratio_R
hemisphere_channels: default     # or explicit lists per side
time_axis: clock | elapsed
show_cursor_at_min: null         # optional vertical cursor line
```

Rendering conventions (renderer defaults, may be overridden in `style`):
dark-on-light "instrument" style, spectrogram 0–20 Hz with a perceptually
uniform colormap, aEEG on a semilog axis 0–10 linear then 10–100 µV log,
suppression ratio 0–100 %, asymmetry index −50…+50 %.

## `eeg_page` specifics

```yaml
at_min: 96.0                     # window start
window_s: 15                     # 10, 15 or 20
sensitivity_uv_mm: 7
filters: { lf_hz: 1, hf_hz: 70, notch_hz: 60 }
highlight: null                  # renderer never marks the answer
```

## `aeeg` (neonatal, single or dual channel)

```yaml
duration_h: 6
channels: [C3-P3, C4-P4]         # or [P3-P4]
pattern: CNV | DNV | BS | CLV | FT
sleep_wake_cycling: mature | immature | absent
seizures: [ { onset_h: 2.5, duration_min: 4 } ]
raw_strip_at_h: 2.52             # optional raw EEG inset
```

## `composite`

```yaml
layout: panel_over_page | side_by_side
qeeg_panel: { ... }
eeg_page: { ... }
```

## `dataset-derived` (optional alternative source)

```yaml
source:
  dataset: chb-mit | helsinki-neonatal | physionet-neonatal-eeg
  record: chb01_03
  start_s: 2996
  duration_s: 60
  license: ODC-BY 1.0 | CC BY 4.0
  attribution: "CHB-MIT Scalp EEG Database (PhysioNet), ODC-BY 1.0"
```

Datasets permitted: **CHB-MIT Scalp EEG Database** (pediatric, ODC-BY 1.0),
**Helsinki Zenodo neonatal EEG dataset** (Stevenson et al. 2019, CC BY 4.0),
**PhysioNet neonatal EEG collections** with open licenses. Any other dataset
requires an explicit license entry in `CASE_IMAGE_SOURCING_POLICY.md`.

## Outputs (written by the renderer)

- `public/images/qbank/<ID>.png` (1600×1000 default for panels; 1600×900 for pages)
- `public/images/qbank/<ID>.json` sidecar:
  ```json
  { "id": "PQ-A-001", "width": 1600, "height": 1000,
    "answer_region": {"kind":"rect","x":0.39,"y":0.12,"w":0.03,"h":0.18},
    "panels": [{"name":"rhythmicity_L","y0":0.10,"y1":0.20}],
    "license": "synthetic-original", "attribution": null,
    "renderer_version": "0.1.0", "spec_hash": "sha256:..." }
  ```
