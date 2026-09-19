# EEG Atlas: P2 generator gap review

2026-09-15. Read-only review of the current schema and synthesis path. No emitted EEG was tested. Source hashes are pinned in `EEG_ATLAS_FEATURE_CONTRACTS.json`; accepting a prompt field does not demonstrate a correct waveform.

| Contract family | Existing controls/evidence | Gap for later work |
|---|---|---|
| Population | `schema.py:12` accepts neonate, infant, child, adolescent; background has PMA | Adult is unsupported by the age enum. Age/state-conditioned validation remains necessary; neonatal and non-neonatal rules must remain separate. |
| Continuity/voltage | `schema.py:203` provides background labels, amplitude, burst/IBI timing, IBI floor | Label selection does not establish measured suppression percentage, calibrated montage voltage, neonatal PMA appropriateness, or matched normal graphoelements. |
| Burst modifiers | Background burst fields include phases, interpeak latency and highly epileptiform fraction | Need emitted-signal checks for burst duration, majority fractions, identical morphology across channels and source-defined voltage. Presence of controls is partial support only. |
| Symmetry/synchrony | Background asymmetry side/attenuation/slowing and neonatal synchrony fields | Need reference-specific measurements, persistence, hemispheric lead/lag and age-conditioned interpretation. |
| Reactivity/state/PDR/CAPE | Binary present/absent reactivity plus stimulation/state events | Unknown, unclear and SIRPIDs-only cannot be represented by that binary field. Eye-opening response, sustained states and six-cycle CAPE require explicit evidence and durations. |
| Sporadic discharges/graphoelements | Multifocal spike and neonatal graphoelement controls | Rates/amplitudes alone do not prove morphology, baseline duration, field or age/state plausibility. Broad normal-development coverage is deferred. |
| RPP type/localization | `schema.py:100` event fields include arbitrary `pattern`, modifier and plus strings, periodic flag, frequency 0.2–30 Hz | No enum/compatibility enforcement for all G/L/BI/UI/Mf × PD/RDA/SW variants; accepted 30-Hz RPP input exceeds the ACNS RPP range. Validate terminology before generation and measure emitted morphology afterward. |
| RPP timing/evolution | `synth.py:1273` uses fixed start/end frequency and amplitude, no spread, run floor 4 s and stochastic gaps | This path cannot deliberately satisfy evolution sequences. A 4-s floor still does not guarantee six cycles at low frequency. Burden/prevalence/duration must be measured rather than inferred from the requested run. |
| Independent patterns | Same path constructs two clocks for pattern prefixes `BIPD` and `BIRD`, with frequency multipliers 0.88/1.12 | Inspect simultaneous independence, field and true resulting frequency; UI/Mf arrangements are not established by this path. Avoid confusing the BIRDA prefix handling with clinical BIRDs. |
| Plus/EDB/minor modifiers | Same path implements a fast component for `+f`/`fast` strings; fluctuation uses two numeric settings | No separate +S/+R handling was found in this path. EDB needs prevalence and phase relationship; triphasic morphology, AP lag, polarity and sharpness require separate checks. |
| Seizures/BIRDs/IIC | Seizure events, duration and evolution controls exist | `spec.py:254` validates schema plus basic semantic checks (event time, cluster fields, artifact kind); it does not implement these ACNS diagnostic contracts. BIRDs versus neonatal BRDs and age-specific status thresholds need explicit handling. |
| Clinical/reporting context | Generic labels/events are available | Time-locked signs, medication response and baseline encephalopathy evidence are not typed diagnostic conditions. Waveforms alone cannot establish ECSz or possible ECSE. |
| Burden/indices | Event schedules can seed measurements | Need valid-time denominators, simultaneous-event handling, rolling windows and patient-specific context; do not sum requested durations as measured burden. |

Paths above are under `tools/eeg-render/eeg_render/`. This is a bounded review of those three files, not a claim that every related module lacks a feature.

## P4 acceptance boundary

For each contract, record requested parameters, normalized parameters and measured output separately. Test thresholds immediately below, at and above the boundary; include missing context, invalid combinations and realistic confounders. Freeze waveform metrics in P3 before optimization. Do not tune an EEG solely to a detector score. No current contract is marked waveform-verified or clinically approved.

P2 supplies knowledge-bank source material only. No application ingestion, prompt compiler, schema migration or generator behavior changed.
