# EEG Atlas P2: terminology contracts for clinical review

**Core extraction and AI checks are finished; clinical acceptance remains pending.** No EEGs were generated, clinical raw data downloaded, models installed, or website code changed.

## Deliverables

- [Feature contracts](EEG_ATLAS_FEATURE_CONTRACTS.json): 47 versioned, grouped contracts covering non-neonatal ACNS 2021 and neonatal ACNS 2013 terminology. Groups contain multiple concepts and enumerated variants; 47 is not the number of Atlas examples required.
- [Coverage inventory](EEG_ATLAS_COVERAGE.csv): 332 rows accounting for all 21 registered sources, all 29/40 pages of the two core authorities, 36 supplemental pages and 153 training slides, plus supporting HTML headings.
- [Generator gaps](EEG_ATLAS_SCHEMA_GAPS.md): current controls versus missing criteria and verification, with code hashes pinned in the contract file.

The eight P0 pilot families have contract mappings in the JSON. These are prerequisite mappings, not approved examples or a finding that suitable raw clinical recordings exist. LPD/LRDA reference availability remains unconfirmed.

## Scope and evidence limits

The contracts retain applicability, thresholds, units, exclusions, measurement requirements, engineering choices and source pages. They are structured prose for review, not executable clinical classifiers. All carry `ai_checked_pending_craig` and draft release status. Normal-development extensions from the NCBI chapter are inventoried but deferred beyond the two core ACNS terminology tracks. Preterm terminology is included; term-HIE datasets cannot validate preterm physiology.

Core definitions were extracted from the pinned P1 documents. Numeric ambiguities received targeted PDF visual review, including neonatal tables/boxes and the IIC boundary. Supplement/training inventory is structural and caption-based; it is **not** a completed visual adjudication of every trace, embedded media item or slide note. Those examples require further review before entering the Atlas reference manifest. Screenshots cannot establish raw-signal quantitative equivalence.

S03 has two pages labeled “EEG 7”; keys therefore include source and page. Continued examples 24, 26 and 29 must not become independent patients or cross split boundaries. Document access does not confer permission to republish its figures.

## Craig's review queue

Review the eight pilot mappings first, then the remaining groups. Record accepted interpretation, source/version and reviewer/date; preserve an unresolved state until adjudicated.

| Priority | Contract(s) | Decision needed |
|---|---|---|
| 1 | SZ-IIC | S01 p25/26 says lateralized RDA **>1 Hz**, but parenthetical wording allows “at least 10 waves in 10 s.” Strict >1 Hz is provisional; exact 1-Hz cases must remain unreleased until adjudicated. |
| 1 | NEO-REPORTING-CONTEXT | Clarify the source's overlapping 44-week term/post-term wording and 48-week endpoint. Preserve precise PMA; do not round away boundary distinctions. |
| 1 | NEO-CONTINUITY-NORMAL, NEO-DISCONTINUITY-ABNORMAL | Reconcile age-specific IBI voltage table with generic text; no table row above 40 weeks; interpret the neonatal burst-suppression asymmetry exception. |
| 1 | BG-BURST-MODIFIERS | Table 1 includes a ≥1-Hz cutoff for the rhythmic highly-epileptiform alternative that the main paragraph does not repeat. |
| 2 | SZ-ESE/ECSE versus NEO-SEIZURE-BURDEN-STATUS | Keep age-specific status definitions separate, including clinical and tonic-clonic exceptions. Neonatal 50%/hour is the pinned historical source definition, not an independently outcome-validated threshold. |
| 2 | SED-MORPHOLOGY and RPP waveform modifiers | Adjudicate exact 200-ms boundary handling; preserve baseline-duration versus peak-to-trough-voltage measurements. |
| 2 | Background/RPP prevalence and duration bins | Source display ranges such as 1–9% and 50–89% require an explicit rounding or interval policy for fractional measurements; never silently invent one. |
| 2 | Neonatal voltage/spatial burden | S09 contains visible author-comment balloons; body-text extraction is provisional. Cross-check the final journal mirror before clinical release. |
| 3 | PDR, CAPE, identical bursts, sharpness, background voltage | Choose separately versioned engineering measures for qualitative terms and observation windows. Their tuning is not an ACNS standard. |

“Not assessable” must remain distinct from absent when stimulation, clinical signs, medication response, PMA or sufficient duration is missing. Clinical contextual categories must never be inferred solely from waveform appearance or an ML score.

## Verification and handoff

Assembly checks passed: valid JSON/CSV, 47 unique contract IDs, required fields present, valid source/page and pilot references, all sources dispositioned, core page coverage, and no human-review or waveform-validation claims. Page coverage alone cannot prove semantic completeness. No application tests were run because application code did not change.

Private assembly tooling: `PedQuest_website/research/eeg-atlas/build_p2.py`; constituent drafts: `docs/eeg-atlas-p2/`. Edit a constituent draft and rebuild the canonical files rather than allowing two versions to diverge. Sources stay in the private P1 asset folder; the register's `clinical_feature_extraction_performed: false` is a historical P1 snapshot, not the current P2 state.

Next authorized phase would be P3 reference eligibility and frozen validation protocol. P3 can plan around unresolved contracts, but cannot treat them as accepted ground truth. It must specify patient/family splits, visual and quantitative comparisons, independent ML limitations, realistic contrast cases and later educational calibration. Model routing used Sol for clinical/background review and Terra for RPP extraction; no Astra subagents. The P2 token envelope is a planning ceiling; exact hosted usage was not available for audit.
