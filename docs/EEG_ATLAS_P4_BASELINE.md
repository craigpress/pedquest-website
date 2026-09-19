# EEG Atlas P4: current-engine baseline (renderer 0.3.10)

Date: 2026-09-15. Package P4 of the [staged plan](EEG_ATLAS_PLAN.md): measure what the current renderer actually emits for the eight pilot families, against the [P2 contracts](EEG_ATLAS_FEATURE_CONTRACTS.json) and the [P3 development references](EEG_ATLAS_REFERENCE_MANIFEST.csv), and write a reproducible gap matrix. Nothing in the generator was changed. No reference label was approved; the [clinical review sheet](EEG_ATLAS_CLINICAL_REVIEW.csv) is still 24/24 pending, so every real-versus-synthetic comparison below is a comparison against a candidate interval, not an accepted phenotype.

## Package

| Field | Value |
|---|---|
| Inputs | renderer `0.3.10` at site commit `61db78a` (file hashes in the [audit](EEG_ATLAS_P4_AUDIT.json)); P2 pilot-contract map; P3 review packet (`research/eeg-atlas/p3/review/*.npz`, 24 development intervals, 15 patients); frozen P3 measurement plan |
| Authorized changes | new files under `research/eeg-atlas/p4/` and these three docs; status lines in the plan, master prompt and P3 review |
| Excluded | generator edits, downloads, reserve-partition waveforms, paid compute, website changes |
| Resource use | one session; 84 s CPU wall for the full run (74 s synthesis, 8 s references); no GPU; 115 MB of outputs under `research/eeg-atlas/p4/out/` (112 MB are the 18 compressed analysis-window archives, deletable and regenerable) |
| Authorization | Craig, in-session, 2026-09-15 ("we are onto P4"); ceiling self-set at one session because P0 set envelopes only through P3 |

Outputs: this report, [EEG_ATLAS_P4_GAP_MATRIX.csv](EEG_ATLAS_P4_GAP_MATRIX.csv) (65 rows), [EEG_ATLAS_P4_AUDIT.json](EEG_ATLAS_P4_AUDIT.json). Code and numbers live outside the website repo in `PedQuest_website/research/eeg-atlas/p4/`: `p4_probes.py` (18 probe specs, 10 schema-acceptance cases), `p4_common.py` (estimators), `p4_baseline.py` (runner), `out/measurements.json` (every value), `out/tables.md` (all tables), `out/probes/*.npz` (the derived analysis windows). `python p4_baseline.py` regenerates everything deterministically.

## Method

Each family gets one or more minimal legal specs on the current schema (standard_19 array, 256 Hz, 30-minute horizon because the schema forbids less). Backgrounds are measured on a 10-minute window; seizures on the realized event plus 60 s either side; rhythmic patterns on every realized run. Synthetic and real signals go through the same estimators on the same derivations: an 8-pair neonatal set for Cork and Helsinki, the 18-pair longitudinal bipolar set otherwise, a common 0.5–30 Hz band (2–30 Hz for Siena, whose headers declare a 1.59-Hz high-pass), P3 flat/rail seconds masked. Estimators follow the frozen P3 plan: 1-s peak-to-peak distributions, Welch log-PSD (4-s Hann, 50 % overlap), an operational continuity envelope (interburst = all derivations below 25 µV for at least 2 s, suppression below 5 µV, ±20 % sensitivity retained), a dominant-frequency track for evolution, a lateralization index, and peak-based inter-discharge intervals for periodic patterns. Distances are 1-D Wasserstein in microvolts or seconds and mean absolute log-PSD difference; they are diagnostic, and no equivalence margin is set. Stand-ins are declared: the age enum has no adult, so AT-P05 to AT-P08 run as `adolescent`.

## Technical gate

| Check | Result |
|---|---|
| Chunk invariance (`iter_blocks` vs `segment`) and half-split | exact, 0 µV |
| Bipolar and average-reference algebra | exact |
| Rebuild determinism; seed sensitivity | identical; seed+1 differs by 151 µV |
| EDF+ round trip via pyedflib (300 s, 21 channels) | labels, µV, 256 Hz, 300 × 1-s records all match; max error 0.050 µV against a 0.101 µV quantum; 0 clipped |
| Background amplitude calibration (`amplitude_uv` → display-montage 1-s p2p) | continuous 0.85–0.86 (P01a, P01b, P04a); discontinuous 0.64; low_voltage 0.26 because `spec.py` multiplies by the type's `amp_scale` (0.28; suppressed 0.06) |
| Event amplitude calibration | ictal `amplitude_end_uv` delivers 1.5–1.7×; LPD `amplitude_uv` 3.7× on T3-T5; LRDA 1.7× |
| State-consistent components | in `suppressed` and `low_voltage` probes a quarter of all seconds still exceed 25 µV, carried by frontal rows (blink/eye-movement schedule, and for neonates the PMA-table `frontal_sharp` 102 µV / `anterior_slow` 75 µV graphoelements), none of which scale with the background type |

Schema acceptance: `adult` rejected; `reactivity: unknown` rejected; a 5-s neonatal seizure accepted and realized (P03b emits and keys 9-, 10- and 11-s runs identically); RPP `pattern` is a free string (`XYZ` accepted) and 30 Hz "periodic discharges" are accepted while 0.1 Hz is rejected; `GPD +F generalized`, the neonatal montage on 19 electrodes and a 0.2→30 Hz seizure ramp are all accepted.

## Findings by family

**AT-P01 continuous neonatal background.** P01a (45 µV request) delivers a 38 µV median p2p with 0 % interburst time; the three Cork grade-1 records give 26, 35 and 47 µV with 0–4 % interburst. Wasserstein p2p distances 15–20 µV sit inside the clinical-to-clinical spread (15–24 µV), and log-PSD distances 0.22–0.39 inside 0.16–0.51. The 25 µV request (P01b) spends 9 % of the time under the 25 µV envelope, so a low-normal continuous request already reads as mildly discontinuous by the operational rule. Left attenuation 40 % moves the lateralization index from +0.13 to −0.15; the +0.13 baseline is the 10-minute random field, not a commanded asymmetry. Cork spectra are 98–99 % delta and peak at the lowest bin after the 0.5 Hz high-pass; the synthetic neonate is 92–93 % delta.

**AT-P02 discontinuity and suppression.** Discontinuous P02a is the closest match in the whole run: against Cork grade-3 AT-R004 the p2p distance is 4.5 µV and the interburst floor 20.6 vs 20.8 µV, with interburst medians 3.1 vs 5.9 s and maxima 6.8 vs 40.5 s. The two Cork grade-4 records are not burst-suppression-like: 96–97 % of the hour is under 25 µV, interburst medians 46–53 s, maxima 300–394 s, floor 12–13 µV, median p2p 7–8 µV, and AT-R006 carries 2112 s of source-flagged flat data (masked). Synthetic `burst_suppression` (P02b) gives 71 % interburst time, 9.8 s median, 25.5 s maximum, 4 µV floor; `excessively_discontinuous` 33 %, 20.5 s maximum; `suppressed` 74 % with a 1.6 µV median but the frontal components above.

**AT-P03 neonatal seizure.** The synthetic 60-s left-central seizure evolves 2.5→2.0→1.5 Hz with 8 dominant-frequency changes per minute, p2p rising 100→186 µV, an ictal/preictal power ratio of 20 and a lateralization index of 0.74. The three Helsinki consensus seizures are 18, 620 and 850 s long, change dominant frequency 19–23 times per minute, have ictal/preictal ratios of only 2.4–3.3 and lateralization indices −0.54, 0.02 and −0.01 on the bipolar set. The renderer therefore produces seizures that are shorter, far more stationary in rhythm, far more focal and far higher in contrast than these references. No BRD type exists; burden is computable only downstream from the manifest.

**AT-P04 / AT-P05 focal seizures.** Synthetic 40- and 70-s events change frequency 9 and 3 times per minute with lateralization 0.91–0.96 and ictal/preictal 84–105; CHB seizures (40–82 s) change 24–33 times per minute at 240–660 µV, indices −0.22 to 0.30, ratios 24–69; Siena (54–70 s) 19–26 per minute, ratios 14–35, indices −0.42 and 0.03. AT-R023 is dominated by its P3-flagged rail artifact (p2p thirds 253 → 10065 µV) and is not interpretable. Nonseizure backgrounds: CHB 59–137 µV median p2p against a 43 µV synthetic child; Siena 20–40 µV (2–30 Hz) against 27 µV synthetic. Requested `dominant_hz` 9–10 Hz never becomes the spectral peak: the synthetic child and adolescent peak at 0.5 Hz with relative alpha 0.08 and relative delta 0.78–0.80, whereas the Siena awake adults show relative delta 0.33–0.51.

**AT-P06 adult ICU backgrounds.** References deferred (public I-CARE is unitless), so only synthetic values are recorded: `low_voltage` 15 µV → 4.0 µV median p2p, `suppressed` 8 µV → 1.1 µV, `burst_suppression` 50 µV → bursts of 4.5 s median between 13.2-s interburst periods. Reactivity is a present/absent binary; CAPE, breach, typed state transients and unknown reactivity have no control.

**AT-P07 LPD.** Three 60-s runs realized in the 3-minute window (the third truncated at 22 s): 52–55 discharges per minute, inter-discharge interval 1.00 s with CV 0.04–0.08, autocorrelation 1.00 Hz, lateralization 0.92. The six-cycle boundary fails as predicted: 0.5 Hz × 4-s floor yields 1–3 discharges; "1 Hz × 6 s" yields six or more in only 3 of 7 runs because `run_duration_s` is a mean with stochastic spread (realized 3.1–8.4 s). Dominant-frequency tracks jitter across harmonics on sharp-slow complexes, so the evolution estimator is not meaningful for periodic patterns.

**AT-P08 LRDA versus focal slowing.** LRDA runs (23–41 s) give autocorrelation 2.00 Hz but peak-interval CV 0.20–0.54 and lateralization only 0.24–0.68; the peak detector is tuned for sharp discharges and undercounts rhythmic delta, so CV alone should not be read as morphology. The `asymmetry.slowing_hz` mimic (P08b) produces a lateralization index of −0.03 and no spectral shift, so the intended polymorphic-slowing contrast is barely expressed.

## Gap matrix

65 rows in [EEG_ATLAS_P4_GAP_MATRIX.csv](EEG_ATLAS_P4_GAP_MATRIX.csv): 7 gate passes, 26 measured, 17 partial, 13 unsupported, 2 no-rule. Unsupported: adult population, reactivity beyond a binary, RPP pattern vocabulary, BRD, ECSz clinical coupling, behavioral state, N2 transients, CAPE, breach, IIC. No-rule: the neonatal 10-s minimum. Partial rows are where controls exist but the emitted signal misses the request (dominant frequency, event and RPP amplitude, low-voltage scaling, frontal components, six-cycle guarantee, PDR reactivity, burst morphology).

## Limits

Estimators were written and run once in this session; they are frozen for P5 only if Craig accepts them, and the P3 plan requires a new protocol version for any change. Three patients per family cannot set margins. The 8-pair neonatal set assumes Cork's nine labels are common-reference electrodes (the reference is not stated in the header). The evolution count is a plateau count on a 2-s dominant-frequency track, which real EEG inflates through jitter; it separates synthetic from real here but is not an ACNS evolution judgment. Nothing in this package says whether a synthetic page would fool a reader.

## Next bounded package (not started)

P5 (pilot families, defect-driven fixes) needs Craig's decisions on: which partial rows to repair first (candidates in order of leverage: dominant-frequency/PDR realization, amplitude semantics for ictal and rhythmic-pattern events, state-consistent scaling of blink and graphoelement components, a neonatal duration rule and BRD type, an RPP enum with an ACNS frequency range, six-cycle guarantee for `run_duration_s`), whether to widen the age enum, and the P3 clinical adjudication that P5 candidate selection must cite. Re-run `p4_baseline.py` after each P5 change; a changed number in `measurements.json` is the regression signal.
