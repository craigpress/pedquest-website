# Clinical revisions: A series and exemplar

Reviewed 2026-09-04. Scope: `PQ-A-001`–`PQ-A-025` and example `PQ-X-001`. This is editorial/scientific correction, not expert approval or publication approval.

## Per-item disposition

| Item | Disposition |
|---|---|
| A-001, A-003, A-005, A-007, A-009, A-022 | Image repair already resolved the reviewed image/content mismatch; no further clinical claim change required in this pass. |
| A-002 | Replaced the inaccurate “area under the FFT amplitude curve” description with squared Fourier magnitude and distinguished power from power spectral density. |
| A-004 | Removed inference that a persistent signed asymmetry proves a structural cause; retained the laterality/sign-convention objective. |
| A-006 | Reframed limited-channel aEEG as a sensitivity/coverage limitation rather than a guarantee of zero signal from a remote focus. |
| A-008 | Made artifact reduction dependent on software/configuration and changed “reliably removes/usually persists” to qualified language. |
| A-010 | Limited alpha/delta cancellation to equal scaling in the simulated example; removed the unsupported claim that ratios are a preferred ischemia screen during changing sedation. |
| A-011, A-012, A-014, A-015, A-018 | Clarified that qEEG marks candidate events and that ictal diagnosis requires raw-EEG review using applicable seizure criteria; retained the illustrated localization tasks. |
| A-013 | Anchored the sensitivity question explicitly to the cited mixed-age, 562-seizure study rather than presenting a universal detector ranking. |
| A-016 | Preserved the reported cross-study medians but removed the causal statement that adding raw EEG doubles sensitivity. |
| A-017 | Reconciled the vignette with the rendered four-channel comparison; retained study-specific patient- and seizure-level estimates. |
| A-019 | Tied NPV/PPV to the cited post-arrest image-classification cohorts and stated dependence on prevalence and setting. |
| A-020 | Labeled detector tradeoff as a historical study result and directed local choice to current validation and reviewable alarm burden. |
| A-021 | Distinguished suppression ratio from ACNS continuity classification, which also counts attenuation and requires raw-EEG review. |
| A-023 | Removed interchangeability of the aEEG lower margin with raw-EEG voltage and the causal perfusion inference. |
| A-024 | Limited the IIC statement to LRDA and made a treatment trial context-dependent. |
| A-025 | Made artifact identification depend on the displayed raw excerpt rather than a supposedly diagnostic trend fingerprint. |
| X-001 | Removed the unsupported claim that both events raised the synthetic probability trace and labeled that panel a nonvalidated heuristic. |

## Source verification and limits

- Directly reviewed the [ACNS 2021 full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC8135051/) (PMID 33475321) for continuity, attenuation/suppression, burst terminology, IIC and reactivity claims.
- Directly reviewed the primary records for the [mixed-age focal-spectrogram comparison](https://pubmed.ncbi.nlm.nih.gov/29414138/) (PMID 29414138) and [pediatric detector comparison](https://pubmed.ncbi.nlm.nih.gov/32205601/) (PMID 32205601). The item wording now identifies those estimates as study-specific.
- Directly reviewed the [full primary article for pediatric CDSA/aEEG screening](https://pmc.ncbi.nlm.nih.gov/articles/PMC2974462/) (PMID 20861452). It supports 27 recordings, 487 hours, 553 seizures, median sensitivities of 83.3% for CDSA and 81.5% for aEEG, individual-recording sensitivity from 0% to 100%, and one false positive per 17–20 hours.
- Directly reviewed the [primary abstract for single- versus multichannel neonatal aEEG](https://pubmed.ncbi.nlm.nih.gov/19782640/) (PMID 19782640). It supports the 12-infant selected HIE cohort, 121 seizure patterns, 30% versus 39% seizure-pattern sensitivity with the stated confidence intervals, and 12/12 versus 11/12 patient identification. A-017 states the small selected sample and wide intervals.
- Citation identifiers and schema fields were validated across all 51 YAML files. A complete full-text, claim-by-claim audit of every cited paper remains outstanding.
- Synthetic detector behavior is illustrative and is not evidence of commercial detector performance.

Validation: `npm run qbank:validate -- --skip-pmid` after the edits (51 files; schema/duplicate validation). No status, approval, reviewer, image specification, image asset, deployment or database state was changed by this clinical-content pass.
