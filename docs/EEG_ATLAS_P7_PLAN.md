# EEG Atlas P7 — staged coverage batches (renderer 0.4.1 →)

Date opened: 2026-09-20. Authorization: Craig, "review the work done so far and verify that it makes sense to move
on to P7 … if ready proceed". Parent: [EEG_ATLAS_PLAN.md](EEG_ATLAS_PLAN.md) §9 (P7: accepted pilot → reviewed
families across all-age modules; each batch meets the same gates; the coverage matrix exposes gaps).

## Readiness review (what P5/P6 actually delivered, and two plan adjustments)

**Delivered.** Renderer 0.4.1 on main and both worker fleets; the 52 bank images migrated to spec_version 2 and
re-rendered (negative-up, display-referenced amplitudes, recruiting seizures, reduced-array fields, calibrated
bursts, S22 term anchors); 33 P5 candidates with Craig's decisions 31 accept / C08 revise / C18 unscored
([EEG_ATLAS_P5_CANDIDATE_REVIEW.csv](EEG_ATLAS_P5_CANDIDATE_REVIEW.csv)); renderer suite 134 passed.

**Adjustment 1 — P6 as chartered did not happen and could not.** The plan's P6 was "P5 + held-out references →
evidence report and go/no-go, human panel". [EEG_ATLAS_PARTITIONS.csv](EEG_ATLAS_PARTITIONS.csv) holds 18
development references and 5 `reserve_metadata_only` rows: there is no held-out waveform to test against, and
AT-P06/07/08 have no calibrated adult ICU reference at all. What stood in for P6 is (a) the P4 estimators on the
development references, reported per candidate in the P5 gallery, and (b) Craig's direct visual acceptance over
three passes. The go/no-go is therefore **a single-expert acceptance on development data**, and every downstream
claim inherits that limit: no blinded-reader, interrater or "indistinguishable from real" statement is supported
(plan §6 gate E remains for P9). Recorded here so P7 does not re-plan around a P6 that does not exist.

**Adjustment 2 — the 47 P2 contracts stay `ai_checked_pending_craig`.** Nobody will review 47 prose contracts in one
sitting. Policy for P7: Craig's acceptance of a rendered candidate is provisional acceptance of the contract rows it
exercises (the eight pilot-family mappings are provisionally accepted as of P5); each P7 batch lists the contracts it
touches in its review CSV, and those rows move to `accepted_via_candidate` with the candidate id and date when the
batch is accepted. Contracts no candidate exercises stay pending and visible in the gap matrix.

**Stale instrument.** The gap matrix ([EEG_ATLAS_P4_GAP_MATRIX.csv](EEG_ATLAS_P4_GAP_MATRIX.csv)) measured renderer
0.3.10: 7 pass / 26 measured / 17 partial / 13 unsupported / 2 no-rule. Several "unsupported" rows were answered by
0.3.11–0.4.1 (adult population, reactivity enum, BRD, neonatal seizure-minimum advisory, RPP pattern enum). P7 batch 0
re-runs the baseline against 0.4.1 so the matrix, not memory, says what is still missing. The 0.3.10 matrix is kept as
`EEG_ATLAS_P4_GAP_MATRIX.0.3.10.csv`.

**Carried failures (unchanged):** pdr_gain values are hand-picked, not fitted; the 4-Hz RDA autocorrelation reading;
Siena 2–30 Hz figures are not comparable with the 0.5–30 Hz synthetic values; adult ICU families have no microvolt
reference.

## Batch mechanics (same gates as P5)

- A batch = one module or family group, ≤ 12 candidates (canonical / variation / boundary / contrast per family),
  defined in `research/eeg-atlas/p7/batch<N>_candidates.py`, measured and rendered by the P5 runner generalised to a
  batch id (`p5_run.py` → `p7_run.py --batch N`), reviewed in the same gallery form (review server, `?filter=review`),
  decisions in `docs/EEG_ATLAS_P7_B<N>_REVIEW.csv`.
- Gates per batch: technical gate (chunk invariance, montage algebra, determinism, EDF round trip — the renderer
  suite); feature compliance via the P4 estimators on the display montage; Craig's acceptance. Rejected roles get one
  revision; two failed revisions end the family for the batch (P0 stop rule).
- Generator changes stay behind `spec_version` (a version 3 only if a default must flip for existing version-2
  content; additive keys otherwise). The bank is re-rendered only when Craig asks, as on 2026-09-20.
- Every batch ends with: matrix rows touched, contracts provisionally accepted, renderer version, candidate hashes,
  Craig's tally, and the next batch's scope — in this file.

## Batch plan

| Batch | Scope | Generator work expected | Contracts / matrix rows | Depends on |
|---|---|---|---|---|
| **0** | Re-baseline at 0.4.1; refreshed gap matrix and audit | none | all 65 rows re-verdicted | — |
| **1** | Neonatal module completion (AT-P01/P02 extended): emitted behavioral state (awake / active sleep / quiet sleep / indeterminate) with term sleep-wake cycling (S22: cycles in 20/22 by day 3), tracé alternant as a state not a type, hours-of-life control (first-six-hours state: more discontinuity, 20 % brushed bursts, 12/h encoches, 63 % indeterminate sleep), term transient sharp waves (7.6/h, mostly temporal), dysmaturity contrast | `background.state_cycle`, `background.hours_of_life`, `graphoelements.sharp_transients` | NEO-BEHAVIORAL-STATE, NEO-CONTINUITY-NORMAL, NEO-SHARP-TRANSIENTS, NEO-DYSMATURITY, NEO-VARIABILITY-REACTIVITY | 0 |
| **2** | Pediatric/adult background module (AT-P06 extended): reactivity to stimulation as an emitted, keyed event; state changes; CAPE (cyclic alternating pattern of encephalopathy); breach rhythm; AP gradient; voltage categories at the ACNS boundaries on the display montage | `stimulation` keyed in the answer key, `background.cape`, `background.breach` | BG-REACTIVITY, BG-STATE-CHANGES, BG-CAPE, BG-BREACH, BG-AP-GRADIENT, BG-VOLTAGE | 0 |
| **3** | RPP / ictal-interictal continuum (AT-P07/P08 extended): SIRPIDs, RPP modifiers (+F, +R, +S, fluctuating/evolving), the IIC boundary (2.5 Hz / 1–2.5 Hz with plus), BIRDs in adults | `rpp.stimulus_evolution`, evolving-vs-fluctuating semantics, IIC advisory keyed | RPP-*, SZ-IIC, SZ-BIRDS | 0, 2 |
| **4** | Seizure module completion (AT-P03/P04/P05): ESE / ECSE burden over an hour, possible-ECSE, nonconvulsive SE, neonatal seizure burden and status, electroclinical annotation as a keyed non-EEG field | `seizure_cluster` burden reporting, `clinical_correlate` key | SZ-ESE, SZ-ECSE, SZ-POSSIBLE-ECSE, SZ-NONCONVULSIVE, REP-BURDEN, NEO-SEIZURE-BURDEN-STATUS | 0 |
| **5** | Sporadic epileptiform discharges and pediatric normal variants (new families): spikes/sharps with fields, prevalence categories, age-specific normal variants from the Pediatric atlas | `sed` events (SED-MORPHOLOGY, SED-PREVALENCE), variant library | SED-*, coverage rows from S-index books | 0 |

Batches 1 and 2 can run in either order; 3 after 2; 4 and 5 are independent of 1–3. One batch per session,
Craig's review between batches.

## Batch 0 — re-baseline at 0.4.1

Done 2026-09-20: `python research/eeg-atlas/p4/p4_baseline.py` against renderer 0.4.1 (probes normalised as version 2),
92 s, technical gate all zeros (chunk invariance, half-split, bipolar and average algebra; EDF round trip within half a
quantum), no probe errors. Verdicts 0.3.10 → 0.4.1: pass 7 → **16**, measured 26 → 26, partial 17 → **10**,
unsupported 13 → **11**, no-rule 2 → 2 (65 rows). Rows that changed:

| family | contract | probes | 0.3.10 | 0.4.1 |
|---|---|---|---|---|
| GATE | GATE-AMPLITUDE-CALIBRATION | P02a, P06a | partial | pass |
| GATE | GATE-EVENT-AMPLITUDE-CALIBRATION | P03a, P07a, P08a | partial | pass |
| GATE | GATE-POPULATION-ADULT | A01 | unsupported | pass |
| GATE | GATE-REACTIVITY-ENUM | A07 | unsupported | pass |
| GATE | GATE-STATE-CONSISTENT-COMPONENTS | P02d, P06c | partial | pass |

Still unsupported at 0.4.1 (the P7 target list): NEO-BEHAVIORAL-STATE (state must be emitted and checkable),
NEO-SEIZURE minimum-duration rule and GATE-NEONATAL-SEIZURE-MINIMUM (the renderer emits what is commanded; the ACNS
floor is an advisory, not a rule the estimator can grade), NEO-BRD, SZ-ECSZ (AT-P04/P05: electroclinical correlation
has no signal-side rule), BG-REACTIVITY, BG-STATE-CHANGES, BG-CAPE, BG-BREACH (AT-P06), SZ-IIC (AT-P07/P08), and the
two no-rule rows. Note for batches 1–3: NEO-BRD and the RPP pattern enum are "unsupported" because the P4 probe set
predates the 0.3.11 `brd` / `min_cycles` / advisory features, not because the generator lacks them — those batches
must add probes (and estimator rules) as well as candidates, or the matrix cannot register the gain.

**Verdict on readiness:** the technical gate is clean, the amplitude semantics gates now pass, and the remaining
unsupported rows are exactly the scopes of batches 1–4. Proceed to batch 1 (neonatal module) next session; Craig to
confirm the batch-1 scope above or reorder (batch 2 is independent and can go first).

## Batch 1 — neonatal module (renderer 0.4.2, 2026-09-20)

Generator (spec_version 2, opt-in keys, bank hashes unchanged): `background.state_cycle: term` — an emitted term
sleep-wake cycle (awake / active sleep / quiet sleep / indeterminate rows in the answer key) in which quiet sleep is
tracé alternant (8 s cycle, sf 0.44, interburst 0.42 of the burst voltage; S22 day 3: max IBI 3.7 s) and the other
states are continuous; `background.hours_of_life` — under 12 h the first-day state of S22 (indeterminate sleep dominant,
max IBI 5.75 s, lower interburst, 12/h encoches, ~1/h rolandic bursts, 37/h transient sharps, a fifth of bursts brushed);
`graphoelements.sharp_transient` — term transient sharp waves 7.6/h at day 3 (temporal 43 %, rolandic 32 %, occipital
20 %, frontal 5 %), 100-400 ms, > 50 µV, one side, present only inside the state-cycle module so no existing spec
changes; `background.dysmature_pma_weeks` — maturational defaults drawn from a younger PMA than the stated one. Neonatal
blink default inside the module 4/min (was the 15/min of older children). Also fixed: background calibration no longer
sees epileptiform discharges (PQ-A-022 re-rendered), hour-long records for the batch so every state is present.

Candidates B1-01 … B1-10 (`research/eeg-atlas/p7/batch1_candidates.py`; gallery `p7/batch1/review/index.html`, review
server package `p7b1`, CSV `EEG_ATLAS_P7_B1_REVIEW.csv`): day-3 term in quiet / active / indeterminate sleep, first
hours of life ×2, dysmature 40 w with 34 w patterns, excess temporal sharps (23/h, abnormal), encephalopathic no-cycle
contrast, post-term 43 w, 37 w discontinuous with cycle. Pages are placed in the requested state by the runner.

Contract rows (`EEG_ATLAS_P7_B1_GAP_ROWS.csv`): NEO-BEHAVIORAL-STATE **pass** (6 state rows keyed; quiet-sleep
burst:interburst 2.3 vs 1.6 in active sleep), NEO-CONTINUITY-NORMAL measured (active sleep 0 % under 25 µV),
NEO-SHARP-TRANSIENTS **pass** (9.0/h; B1-07 23/h), NEO-VARIABILITY-REACTIVITY measured, NEO-DYSMATURITY measured.
Tests: `tests/test_p7_batch1.py` (5). Craig's review pending.

## Batch 2 — pediatric / adult background module (renderer 0.4.2, 2026-09-20)

Generator (opt-in keys): stimulation rows now carry `response` (the background's reactivity) in the key; a
`state_change` record emits awake / sleep rows; `background.cape` — cyclic alternating pattern of encephalopathy,
the second half of every cycle attenuated by `depth` with 2 s edges, each cycle keyed (`cape_cycle` rows);
`background.breach` — display-referenced regional gain around a focus electrode with a separate fast-activity gain;
`background.ap_gradient: absent` — the posterior-dominant and anterior-fast fields become uniform.

Candidates B2-01 … B2-07 (`batch2_candidates.py`; package `p7b2`, CSV `EEG_ATLAS_P7_B2_REVIEW.csv`): reactive vs
unreactive ICU record with a keyed stimulation, CAPE (12 cycles of 40 s, depth 0.6), left central breach in a child,
AP gradient absent vs preserved, awake→sleep state change with spindles.

Contract rows (`EEG_ATLAS_P7_B2_GAP_ROWS.csv`): BG-REACTIVITY **pass** (post/pre p2p 1.25 reactive vs 1.13 unreactive
— the unreactive record's 13 % is background variance; the key, not the page, carries the answer), BG-CAPE **pass**
(12 cycles keyed, phase B/A 0.45), BG-BREACH **pass** (C3/C4 p2p 1.75, beta 2.96 after the display-referenced gain),
BG-AP-GRADIENT **pass** (alpha O/F 5.39 present vs 1.73 absent), BG-STATE-CHANGES **pass** (sigma RMS sleep/awake 5.5).
Tests: `tests/test_p7_batch2.py` (5). Renderer suite 145 passed / 1 skipped. Craig's review pending.

Adult ICU families still have no calibrated microvolt reference (P3): these rows are generator-side measurements and
Craig's read, not validation against patients.

## Batch 4 — seizure module completion (renderer 0.4.3, 2026-09-20)

Generator (opt-in keys, no signal change): every ictal event accepts `clinical_correlate` (none / subtle /
focal_clonic / focal_tonic / generalized_tonic_clonic / autonomic / behavioral_arrest / unknown), copied onto each
realized seizure / cluster row with a derived `electroclinical` flag; the manifest gains `summary.seizure_burden`
(count, total and longest seizure, the maximum fraction of any sliding 60-min window, `electrographic_status` with
`status_basis` duration (≥ 10 min) or burden (≥ 20 % of an hour; ACNS 2021), `nonconvulsive` when status carries no
correlate, and `neonatal_status` = ≥ 50 % of an hour — a neonate is judged by the neonatal rule only). The
`seizure_cluster` schema nests its per-run parameters under `seizure` (start_min / end_min / interval_min); the P5
helpers had that wrong, so the first run of this batch realized 90-s default seizures — fixed in the candidates.

Candidates B4-01 … B4-06 (`batch4_candidates.py`; package `p7b4`, CSV `EEG_ATLAS_P7_B4_REVIEW.csv`, hour-long
records): adult status by duration (12-min nonconvulsive), adult status by burden (15 × 60 s, 25 % of the hour, subtle
correlate), child electroclinical seizure (focal clonic keyed), child three seizures below status, neonatal status
(35 × 60 s every 100 s, 58 %) and neonatal high burden below status (20 %).

Contract rows (`EEG_ATLAS_P7_B4_GAP_ROWS.csv`, all **pass**): SZ-ESE (720 s duration / 0.25 burden / 0.04 not
status), REP-BURDEN (per-hour fraction keyed for all six), SZ-NONCONVULSIVE, SZ-ECSZ for AT-P04 and AT-P05,
NEO-SEIZURE-BURDEN-STATUS (0.59 status vs 0.20 not). The first neonatal candidate sat exactly on the 50 % threshold
(realized 0.4995 → false); the candidate was moved to 58 % rather than the rule softened. SZ-POSSIBLE-ECSE (the
"possible" category needs a treatment-response record) stays pending. Tests: `tests/test_p7_batch4.py` (5).

## Batch 5 — sporadic epileptiform discharges and pediatric normal variants (renderer 0.4.3, 2026-09-20)

Two new families, both from the S-index: **AT-P09 sporadic epileptiform discharges** (S01 §prevalence: abundant ≥ 1 per
10 s not periodic, frequent ≥ 1/min, occasional ≥ 1/h, rare < 1/h) and **AT-P10 pediatric normal variants** (S06
developmental chapter: hypnagogic hypersynchrony in drowsiness after the first year, peak 2–4 y; POSTS in sleep from
school age; posterior slow waves of youth fused with the alpha PDR, persisting into the twenties).

Generator (opt-in, additive; a spec without the keys normalizes unchanged): event `sporadic_discharges` (`focus`
electrode, `rate_per_h`, `amplitude_uv`, `morphology` spike / sharp_wave / polyspike, `aftergoing_slow`, optional
`start_min`/`end_min`) — surface-negative kernel (rise 12 / fall 24 ms sigma → spike FWHM ~40 ms, sharp wave ×2.6),
lognormal timing with a 1.5-s refractory, monopole field at falloff 0.60 (first neighbours ~1/3 as generated; the
per-electrode scalp gain, capped at 2.0, then multiplies what the page shows), every discharge keyed as a
`sporadic_discharge` row and summarized per event in `summary.sporadic_discharges` (count, per hour, per minute,
`acns_prevalence` from the realized count over the keyed record — "rare" needs a record longer than an hour).
`background.variants` {hypnagogic_hypersynchrony, posts, posterior_slow_waves_of_youth} each with `amplitude_uv` and
`rate_per_min`; runs are scheduled only inside the permitting state from the sleep index (drowsy 0.15–0.75, asleep
> 0.55, awake < 0.2) and keyed as `normal_variant` rows (`normal_variant: true`, frequency, count). POSTS are
surface-positive occipital 4–5 Hz triangles; hypnagogic hypersynchrony a fronto-centro-parietal 3–5 Hz run with a
sharpened crest; posterior slow waves single or paired occipital 2.5–4.5 Hz waves at 1.5 × background × the PDR gain.
The runner gained `page_on`: the page lands on the first keyed row of a kind after minute 4.

Candidates B5-01 … B5-08 (`batch5_candidates.py`; package `p7b5`, CSV `EEG_ATLAS_P7_B5_REVIEW.csv`, hour-long
records): T3 spikes frequent (120/h) and abundant (480/h), F4 sharp waves occasional (8/h), C4 polyspikes, the same T3
spikes without the slow wave (contrast); hypnagogic hypersynchrony in a 3-year-old falling asleep, POSTS in a sleeping
adolescent, posterior slow waves of youth in an awake 10-year-old.

Contract rows (`EEG_ATLAS_P7_B5_GAP_ROWS.csv`, all **pass** on discharge-locked averages): SED-MORPHOLOGY (spike 39 ms,
sharp wave 94 ms, polyspike, all negative), SED-FIELD (first neighbours 0.33 as generated, 0.15 on the page where T3
carries scalp gain 2.0, contralateral 0.04), SED-PREVALENCE (129/h frequent, 487/h abundant, 10/h occasional),
SED-AFTERGOING (0.49 vs 0.02), VAR-HYPNAGOGIC (6 runs at sleep index 0.22–0.69, 3.6–4.9 Hz, Cz/O1 1.89), VAR-POSTS (278
runs at ≥ 0.61, O1/F3 8.4, positive), VAR-PSWY (352 runs awake, O1 delta RMS in the run 1.8 × the 2 s before — the
first two attempts measured raw p2p against a 2.5× PDR and read 0.94 / 1.13; the wave was raised to 0.7 × amplitude and
the measure moved to the delta band). Tests: `tests/test_p7_batch5.py` (5); renderer suite 155 passed / 1 skipped.

Open for Craig's read: the field falloff (0.6) and the discharge amplitudes are generator choices with no P3 reference;
the variant rates (5–6 runs/min inside the state) are placeholders from the chapter's "common"/"frequent" wording.
Batch 3 (RPP / IIC) waits for the batch-2 review; the remaining unsupported rows are SZ-IIC (batch 3) and
SZ-POSSIBLE-ECSE (needs a treatment-response record).
