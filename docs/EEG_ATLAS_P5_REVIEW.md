# EEG Atlas P5: pilot candidates and defect-driven generator fixes (renderer 0.3.11)

Date: 2026-09-16 (candidates re-rendered the same evening on renderer `0.3.12`, merged into `eeg-teaching-lab`/`main`; the gallery and `out/candidates.json` reflect 0.3.12, this text the 0.3.11 session unless marked). Package P5 of the [staged plan](EEG_ATLAS_PLAN.md), first session. Inputs: the [P4 baseline](EEG_ATLAS_P4_BASELINE.md) and its [gap matrix](EEG_ATLAS_P4_GAP_MATRIX.csv), the P2 contracts, the P3 development references. Output: renderer `0.3.11` on branch `eeg-atlas-p5` (not merged, not deployed), 32 measured candidate pages for Craig's review, and this report. Authorization: Craig, in-session ("move on to next phase"); ceiling self-set at one session. Clinical acceptance of the P3 references is still pending (24/24), so no candidate can yet cite an accepted reference.

## What changed in the generator (all opt-in or additive)

Legacy content is pinned by the normalized-spec hash, so every new control passes through only when a spec names it; a spec that omits it normalizes to the same dictionary and synthesizes the same samples as under 0.3.10. Proof: 13 representative committed questions (every image kind, every age group, the one rhythmic-pattern item and the burst-suppression / suppressed / low-voltage items) re-rendered under 0.3.11 and byte-compared with `public/images/qbank`: 13 of 13 identical, so the 52 sidecars were restamped (commits `55745e8`, `ba861d7`); plus a re-run of the whole P4 baseline whose measurements differ from the 0.3.10 run in no value (`research/eeg-atlas/p4/out/measurements_0.3.11_regression.json`).

| Control | Where | Closes P4 row | Note |
|---|---|---|---|
| `age_group: adult` | schema, spec presets (10 Hz, 30 µV, slow 0.25), ECG 72/min | GATE-POPULATION-ADULT | presets are engineering defaults; an advisory says so until adult references exist |
| `reactivity: unknown` / `unclear` | schema; synthesized as no stimulus response | GATE-REACTIVITY-ENUM, BG-REACTIVITY | recorded in the advisory list |
| event type `brd` | schema, normalizer, synthesizer, manifest | NEO-BRD | short rhythmic run keyed as its own kind with an ACNS advisory; default 5 s, rda morphology, no postictal change |
| `min_cycles` on `rhythmic_pattern` | synthesizer run draw | RPP-TIME-RATE six-cycle guarantee | run = max(drawn, min_cycles / f) |
| `background.blink_rate_per_min` | blink schedule | GATE-STATE-CONSISTENT-COMPONENTS | 0 removes the 15/min awake blinks that persisted in suppressed and low-voltage records |
| `background.pdr_gain` | posterior-dominant-rhythm stream weight | BG-PREDOMINANT-FREQUENCY, BG-PDR | 1.0 is bit-identical to 0.3.10 |
| `background.channel_gain_max` | per-electrode gain draw | new finding (below) | caps the high tail relative to the median scalp electrode |
| ACNS advisories | `spec_warnings()` printed by `validate` and `render`; `acns_advisory` on manifest rows | GATE-NEONATAL-SEIZURE-MINIMUM, GATE-RPP-FREQUENCY-RANGE, GATE-RPP-PATTERN-ENUM | never an error; a 5-s neonatal "seizure", a 30-Hz "LPD" or pattern `XYZ` still render, now with a warning and a keyed advisory |

Not changed, deliberately: the meaning of `amplitude_uv` for ictal and rhythmic-pattern events (still 1.5–1.7× and about 3.6× the request on the bipolar display montage) and the type `amp_scale` multipliers (low_voltage 0.28, suppressed 0.06). Both need Craig's decision on intended semantics before a fix. The site's TypeScript age enum (`LabAgeBand`, Lab spec builder) still lists four ages; the exported `render-image.schema.json` now accepts `adult`, so AI revisions validate, but the Lab UI cannot pick it yet (website work belongs to P8).

Tests: `tests/test_atlas_p5.py` (13 tests: hash stability, adult, reactivity, brd, short-seizure advisory, blink cap, PDR gain, six-cycle floor, RPP advisories, gain cap) plus the existing suite.

## New finding: seed-dependent amplitude tail

Candidate C10 (a 40 µV neonatal request) measured 133 µV in its nonictal window with the same background as C09 at 33 µV. The event was irrelevant: seed 515302 alone gives 160 µV raw. A 25-seed sweep of the identical spec gave a median of 43.6 µV, a minimum of 26.6 and a maximum of 160.2 (max over median 3.68, CV 0.52). Cause: per-electrode gains are drawn per homologous pair with a log-sd of 0.50 on the high side and anchored to the median of all 19 scalp electrodes, so the 9 electrodes a neonatal montage reads can sit together in the tail. With `channel_gain_max: 2.0` the same sweep gives median 43.6, maximum 66.2 (ratio 1.52, CV 0.24). Every candidate below uses the cap; legacy specs are untouched.

## Candidates

32 candidates, four per family (canonical, variation, boundary, contrast), defined in `research/eeg-atlas/p5/p5_candidates.py`, measured with the P4 estimators by `p5_run.py`, and rendered as 15–20 s pages from the same synthesizer horizon. Review gallery: `research/eeg-atlas/p5/review/index.html`; decisions go in [EEG_ATLAS_P5_CANDIDATE_REVIEW.csv](EEG_ATLAS_P5_CANDIDATE_REVIEW.csv) (32 rows, all `pending`). Since 2026-09-16 each card carries a structured form (reads as described; amplitude, frequency, morphology, field, evolution and state features each plausible/borderline/implausible; trainee plausibility; concern checkboxes; corrected label; comments; decision) whose **Submit decision** writes the CSV row and `p5/review/decisions/<id>.json` through `python research/eeg-atlas/p3_review_server.py` (`http://127.0.0.1:8769/p5/review/index.html`); `python p5_run.py --review-only` rebuilds the gallery from `out/candidates.json` without the renderer. Reviewer observation 2026-09-16: the neonatal pages showed repeating bursts of 10–15 Hz activity; these were the synthesizer's default `delta_brushes` (a 13 Hz ± 4.5 Hz stream gated by the positive half of a delta stream, 0.30 weight, centro-temporal field, enabled by `AGE_DEFAULTS["neonate"]` and left on in every neonatal candidate C01–C12), so they recurred at delta rate head-wide with no delta wave of their own, and stayed on at term. **Fixed in renderer 0.3.12 (same day):** `background.delta_brushes: "riding"` turns that stream off and schedules brush events (one 0.7–1.6 s surface-negative delta wave with a 10–20 Hz burst riding on it at ~30 % of its amplitude; rolandic/temporal/occipital field; one side per event; inside bursts when discontinuous) from `DELTA_BRUSH_PMA` (0.3/min at 24 w, 3–3.5/min at 30–33 w, 0.8/min at 37 w, 0 at 40 w); `graphoelements.delta_brush` overrides rate and amplitude. Legacy bool specs normalize and synthesize identically (`tests/test_delta_brushes.py`, 7 tests; PQ-A-001 re-rendered byte-identical), and `spec_warnings` now flags `delta_brushes: true`. The 12 neonatal candidates were re-rendered with `"riding"` (`p5_candidates.neo`) and with the neonatal page filter at LFF 0.5 Hz (was the renderer's 1.0 Hz default, which attenuated a brush's ~0.5 Hz delta wave while passing its burst); at PMA 38–40 w they now show at most an occasional brush (C02, 14 s: a 74 µV slow wave with a 15 Hz burst, low contrast against the 35 µV background). A sub-term variation is not in the candidate set; `research/eeg-atlas/p5/review/preview-brush-32w.png` (spec beside it) is a 32-week discontinuous preview for judging the corrected morphology. Whether `"riding"` becomes the neonatal default is part of the version-upgrade decision below. All numbers: `research/eeg-atlas/p5/out/candidates.json` and `out/tables.md`.

**Neonatal background (AT-P01, AT-P02).** Continuous candidates deliver 0.80–0.99 of the requested p2p; the 25 µV boundary (C03) again reads 12 % interburst by the operational rule, which is the estimator's threshold talking, not the generator. Against the Cork grade-1 records the canonical C01 sits at 13–21 µV Wasserstein (clinical-to-clinical 15–24). Discontinuous C05 stays the closest match to Cork grade 3 (8.0 µV, log-PSD 0.18). The state-consistent burst suppression C08 (no blinks, frontal graphoelements off) is now 7.7–8.4 µV from the two Cork grade-4 records in amplitude, where P4's P02b was 21–22 µV; its interburst structure is still much shorter (12 s median against 46–53 s). C07 (requested 6-s interburst ceiling) delivered 0.36 of its amplitude and a 7.0 s median interburst: the `ibi_s` override interacts with the amplitude scaling and needs a look before it is used again.

**Neonatal seizure (AT-P03).** C09 keeps the P4 profile (6 changes per minute, lateralization 0.89, ictal/preictal 107). C11 realizes the 10-s boundary as designed: an 8-s `brd` keyed with its advisory and a 12-s seizure. C12's patting artifact reads 2 Hz at 28–33 µV with an ictal/preictal ratio of 2.9 and no lateralization, a plausible rhythmic mimic. C10's right-temporal seizure with hemispheric spread now measures 10 on ictal/preictal with lateralization −0.61.

**Focal seizures (AT-P04, AT-P05).** With `pdr_gain: 3` the child and adult backgrounds carry 27–32 % relative alpha and 58–60 % relative delta (P4: 8 % and 78–80 %); the spectral peak still sits at 0.5 Hz because the lowest bin dominates a 0.5–30 Hz PSD. Adult (C17–C20) synthesizes cleanly. Seizure descriptors remain far more stationary and lateralized than the CHB and Siena references (3–17 changes per minute against 19–34; lateralization 0.86–0.97 against −0.42–0.30). C16's chewing artifact is a 9 Hz, 70–80 µV, non-lateralized, non-evolving mimic.

**Adult ICU backgrounds (AT-P06).** With blinks off, suppressed C22 spends 100 % of the window under 25 µV and burst suppression C21 75 %, with a 1.3 µV interburst floor; the low-voltage boundary C23 delivers 14.9 µV for a 70 µV request (the `amp_scale` semantics again). No adult reference exists to compare against.

**Periodic and rhythmic patterns (AT-P07, AT-P08).** `min_cycles: 6` holds: every 1-Hz LPD run is 58–79 s with 50–67 discharges, inter-discharge CV 0.07–0.11, autocorrelation 1.0 Hz, lateralization 0.96–0.98; GPD at 2 Hz is bilateral (0.10–0.11). The 0.5-Hz boundary runs 12–15 s with 5–6 detected discharges, so six cycles in time does not always mean six detected peaks at the run edges. LRDA at 2 Hz reads 2.00 Hz with peak-interval CV 0.20–0.38 and lateralization 0.5–0.85; LRDA+S at 1.5 Hz reads 1.50 Hz; the 4-Hz boundary reads 2–4 Hz on the autocorrelation because the rda template at 4 Hz is close to the realized 10-Hz PDR's subharmonic structure. LPD amplitude stays about 3.6× the request (427–431 µV for 120).

## Gates and limits

Technical gate unchanged from P4 (chunk invariance, montage algebra, determinism, EDF round trip). Failures retained: the event-amplitude semantics, the `ibi_s` override behaviour (C07), the 4-Hz rda reading, and the fact that pdr_gain 3 is a hand-picked value, not a fit to references. Estimators are the P4 ones; nothing here is a clinical judgment, and Siena's 2–30 Hz relative-delta figures are not directly comparable with the 0.5–30 Hz synthetic values.

## Next bounded work

1. Craig reviews the 32 pages and records decisions in the CSV; rejected roles get one revision each (the P0 stop rule: two failed revisions end the family for this pilot).
2. Craig decides the `amplitude_uv` semantics for events and whether `channel_gain_max`, `blink_rate_per_min: 0` for unreactive states and `pdr_gain` should become new-spec defaults through a deliberate version upgrade (they cannot become silent defaults without changing legacy renders).
3. Merge decision for `eeg-atlas-p5` into `eeg-teaching-lab` after Craig's read; the branch carries the renderer, the schema export, restamped sidecars and the tests. Deployment to the Moltbot workers is a separate step.
4. P6 needs the P3 clinical adjudication and a locked calibration/test split before any held-out comparison.


## Renderer 0.4.1 re-render (2026-09-19): Craig's verdicts into the generator

Craig's 09-16 pass (10 accept, 12 revise, 2 reject, 8 pending) went into renderer 0.4.0 behind `spec_version` (see
[EEG_ATLAS_P6_PLAN.md](EEG_ATLAS_P6_PLAN.md)). Re-rendering the candidates under the version-2 defaults exposed three
0.4.0 defects, fixed in 0.4.1 without touching any pinned bank image (52 sidecars restamped and verified; PQ-A-003 and
PQ-B-001, both burst suppression, re-render byte-identical): burst-type display calibration measured the interburst
(80th percentile of all seconds) and clipped its scale; an authored `ibi_range_s` was rescaled by the suppression-fraction
cycle model (10-30 s came out 28-40 s with 8 s bursts); a rhythmic-pattern run truncated at the pattern window's end put a
1.6 s "LPD run" in an answer key. The background calibration estimator itself was sound: the 1.14-1.23x check of 09-18 was
six-window envelope sampling plus blink seconds on F-anchored pairs; measured whole-record and blink-free the child/neonate
cases deliver 1.07/1.02 (`calibrate_display.py`, `tests/test_display_calibration.py`, 10 cases within 15 %).

Re-authored per card: **C03** (reject, "should be burst suppression with flatter interburst intervals at this GA") is now
term encephalopathic burst suppression, 30 uV bursts, 3 uV interburst 10-30 s, unreactive, graphoelements off - measured
74 % of seconds under 5 uV, bursts every 15-23 s; **C05** (revise, "IB voltage lower, interburst longer than 6 s") keeps
its 40 uV bursts over a 10-25 s interburst at 8 uV (Cork grade 3); **C23** (revise, "adult slow, not low voltage") is
18 uV on the display montage, diffuse 7 Hz mix, `pdr_gain` 1, no posterior rhythm; **C33** is new, the sub-term brush
exemplar Craig asked for on C02 (32 w trace discontinu, riding brushes at their 30-33 w peak, 3.4 bursts/min). The
remaining revise cards are answered by the version-2 defaults: recruiting seizure evolution (C17-C19, C26 jitter), no
muscle at a spread-free focal onset (C15, C19), 160 uV sharp blinks and artifact model 2 (C12, C16, C20), hemispheric
attenuation (C04), tighter PDR field (C13), brushes x1.7 riding a high-voltage delta wave (C02).

Every spec hashes differently under version 2, so `p5_run.py` reset all 33 rows to `pending`. The 09-16 verdicts are kept
in `research/eeg-atlas/p5/review/decisions/` (per-card JSON; `EEG_ATLAS_P5_CANDIDATE_REVIEW.backup-20260919.csv`) and in
the table below. Burst-type rows show the median of all seconds, so their ratio is the interburst fraction talking, not
the burst calibration (bursts: BS 30 -> 29.1, discontinuous 40 -> 41.1, adult BS 50 -> 50.7 in `calibrate_display.py`).

| id | family / role | 09-16 verdict | 0.4.1 change | delivered / requested | realized |
|---|---|---|---|---|---|
| C01 | AT-P01 canonical | accept | version-2 defaults | 1.14 | - |
| C02 | AT-P01 variation | revise | version-2 defaults | 0.89 | - |
| C03 | AT-P01 boundary | reject | re-authored: term BS, 30 uV bursts, 3 uV interburst 10-30 s | 0.14 (median of all seconds; bursts calibrated separately) | - |
| C04 | AT-P01 contrast | reject | version-2 defaults | 0.85 | - |
| C05 | AT-P02 canonical | revise | re-authored: interburst 10-25 s at 8 uV | 0.41 (median of all seconds; bursts calibrated separately) | - |
| C06 | AT-P02 variation | accept | version-2 defaults | 1.19 (median of all seconds; bursts calibrated separately) | - |
| C07 | AT-P02 boundary | accept | version-2 defaults | 0.62 (median of all seconds; bursts calibrated separately) | - |
| C08 | AT-P02 contrast | pending | version-2 defaults | 0.03 (median of all seconds; bursts calibrated separately) | - |
| C33 | AT-P02 variation | - | new: 32 w trace discontinu, riding brushes | 1.06 (median of all seconds; bursts calibrated separately) | - |
| C09 | AT-P03 canonical | accept | version-2 defaults | 1.10 | 1 event(s) |
| C10 | AT-P03 variation | accept | version-2 defaults | 1.54 | 1 event(s) |
| C11 | AT-P03 boundary | revise | version-2 defaults | 0.90 | 2 event(s) |
| C12 | AT-P03 contrast | revise | version-2 defaults | 0.98 | 1 event(s) |
| C13 | AT-P04 canonical | accept | version-2 defaults | 1.08 | 1 event(s) |
| C14 | AT-P04 variation | accept | version-2 defaults | 0.86 | 1 event(s) |
| C15 | AT-P04 boundary | revise | version-2 defaults | 1.13 | 1 event(s) |
| C16 | AT-P04 contrast | revise | version-2 defaults | 1.03 | 1 event(s) |
| C17 | AT-P05 canonical | revise | version-2 defaults | 1.08 | 1 event(s) |
| C18 | AT-P05 variation | revise | version-2 defaults | 0.88 | 1 event(s) |
| C19 | AT-P05 boundary | revise | version-2 defaults | 1.06 | 1 event(s) |
| C20 | AT-P05 contrast | revise | version-2 defaults | 0.87 | - |
| C21 | AT-P06 canonical | pending | version-2 defaults | 0.02 (median of all seconds; bursts calibrated separately) | - |
| C22 | AT-P06 variation | accept | version-2 defaults | 0.94 | - |
| C23 | AT-P06 boundary | revise | re-authored: 18 uV display, 7 Hz mix, pdr_gain 1 | 0.90 | - |
| C24 | AT-P06 contrast | accept | version-2 defaults | 0.98 | - |
| C25 | AT-P07 canonical | accept | version-2 defaults | 0.77 | 2 run(s), six cycles in 2 |
| C26 | AT-P07 variation | revise | version-2 defaults | 0.98 | 2 run(s), six cycles in 2 |
| C27 | AT-P07 boundary | pending | version-2 defaults | 0.78 | 11 run(s), six cycles in 3 |
| C28 | AT-P07 contrast | pending | version-2 defaults | 0.80 | - |
| C29 | AT-P08 canonical | pending | version-2 defaults | 1.11 | 6 run(s), six cycles in 5 |
| C30 | AT-P08 variation | pending | version-2 defaults | 1.06 | 7 run(s), six cycles in 7 |
| C31 | AT-P08 boundary | pending | version-2 defaults | 1.12 | 13 run(s), six cycles in 11 |
| C32 | AT-P08 contrast | pending | version-2 defaults | 1.05 | - |

Gallery: `research/eeg-atlas/p5/review/index.html` (run `python research/eeg-atlas/p3_review_server.py` with
`PEDQUEST_SITE_DIR` pointing at the checkout whose `docs/` holds the CSV). Next: merge `eeg-teaching-lab` into main,
deploy 0.4.1 to both worker fleets, then Craig's second pass.
