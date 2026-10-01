# EEG example references

Use these sites when looking for visual examples; read the syndrome's EEG page and inspect its actual figures in the intended montage before tuning a synthetic example.

| Reference | Use |
|---|---|
| [ILAE EpilepsyDiagnosis.org](https://www.epilepsydiagnosis.org/) | Syndrome-specific EEG descriptions and examples; search the syndrome, open its EEG tab, and compare awake/sleep or montage pairs where available. |
| [ILAE SeLECTS / BECTS EEG](https://www.epilepsydiagnosis.org/syndrome/ects-eeg.html) | Normal background; centrotemporal negative maximum at C3/C4 and T3/T4 with frontal positivity; triphasic morphology; drowsiness/sleep activation. The illustrated referential example uses average reference. |
| [Learning EEG normal variants](https://www.learningeeg.com/normal-variants) | Mu, wickets, RMTD, lambda, BETS/SSS, and 14/6 positive spikes. Inspect the example rather than the deliberately abnormal quiz distractors. |
| [Learning EEG normal asleep](https://www.learningeeg.com/normal-asleep) | POSTS and sleep architecture. |
| [Learning EEG pediatric](https://www.learningeeg.com/pediatric) | Posterior slow waves of youth and hypersynchrony; its hypersynchrony example is hypnopompic, so compare morphology without claiming the same state transition. |
| [EEGpedia Ciganek rhythm](http://www.eegpedia.org/index.php?title=Midline_theta_rhythm_(Ciganek)) | Midline theta field, rhythm morphology, and wake/drowsy context. |

Compare frequency, polarity, field, shape, amplitude relative to background, duration and state. Account for reference, sensitivity, time scale and filters; image pixel similarity is not an EEG validation metric. External images are comparison evidence; published gallery images remain original synthetic renders.

## 2026-09-30 authored controls

- `normal_variant.kind: midline_theta`: one Cz-maximal generator, not bilateral temporal theta. `context: awake` or `drowsy` is checked over the event. Defaults: 6 Hz, 55 uV; train durations and amplitudes are simulation choices.
- Mu `train_duration_s`: optional authored train median. Existing schedules remain unchanged when absent. The revised gallery uses right dominance, 32 uV, 9-second train median, and a 65-uV background to reduce the clean, isolated appearance.
- `background.variants.posts.interval_s`: optional within-episode transient spacing median. The default remains 0.5 seconds; the revised gallery uses 1.7 seconds.
- Sporadic discharges `centrotemporal_triphasic: true`: opt-in positive-negative-positive sharp complex with an after-going slow wave. Use `morphology: sharp_wave` and centrotemporal foci. The negative maximum and frontal positive pole use the existing SeLECTS field.
- The paired bilateral SeLECTS pages share seed 30092621, the 2:30-2:50 window and the same independent left/right discharge schedule. Views: longitudinal bipolar and average reference. Frequencies, rate, amplitude and the teaching window are authored, not syndrome diagnostic thresholds.
