# EEG Atlas P3: technical packet complete; clinical acceptance pending

## Delivered

- [Manifest](EEG_ATLAS_REFERENCE_MANIFEST.csv): 27 candidate rows; **24 full intervals across 15 patients** retrieved and numerically screened. Three unitless I-CARE rows are deferred.
- [Patient partitions](EEG_ATLAS_PARTITIONS.csv): 18 development patient groups (including three deferred I-CARE patients) and five metadata-only reserves. No reserve waveform was used; CHB01/CHB21 share one group. These are feasibility partitions, not a validated final-test cohort.
- [Frozen feasibility protocol](EEG_ATLAS_PILOT_PROTOCOL.md): primary measurements, source bandwidth restrictions, uncertainty, missingness, ML eligibility, reader workflow and educational transfer plan. Confirmatory margins/sample size remain unset.
- [Clinical review sheet](EEG_ATLAS_CLINICAL_REVIEW.csv): 24 decisions, with source labels kept separate from Craig's labels. **Reviewed 2026-09-16: 24/24 accepted**; incorporated into the manifest (`craig_label`, `craig_review_status`, `clinical_acceptance`, `eligibility`) and summarised in [EEG_ATLAS_P3_CLINICAL_ACCEPTANCE.md](EEG_ATLAS_P3_CLINICAL_ACCEPTANCE.md) by `research/eeg-atlas/p3_incorporate.py`. AT-R009's onset was moved to 1000 s (source 1058 s); the manifest keeps the source bounds and records the correction in `notes`.
- [Audit and hashes](EEG_ATLAS_P3_AUDIT.json): unique IDs, partition consistency, exact decoded bounds, physical calibration and export rounding checked.

## Review packet

Run `python research/eeg-atlas/p3_review_server.py` (opens `http://127.0.0.1:8769/`). The index shows progress per row; each candidate page has its full interval and up to 60 seconds of surrounding context, native-rate EEG with display-only filters (HP/LP/notch, auto or fixed µV per row, arrow-key paging), display montages derived on the fly from the as-recorded channels (Cork, Helsinki and Siena are referential, so longitudinal/transverse bipolar, neonatal double-distance and average reference are offered; CHB-MIT is recorded bipolar and stays as recorded), the target interval shaded, visible QC findings, draft ACNS contract links, source/license details, and a structured decision form (state, family-specific ACNS labels, artifact, technical adequacy, teaching suitability, concerns, corrected interval, comments). Fields derivable from the source annotation, record notes and QC flags (never a clinical read, never the decision) open pre-checked in yellow and lose the highlight when confirmed or changed; the saved JSON records `suggested` and `suggestion_unchanged` so rubber-stamped fields stay distinguishable. **Submit decision** writes the row into `EEG_ATLAS_CLINICAL_REVIEW.csv` (decision, `acns_labels` as `group: value; …`, state, corrected bounds, comments, reviewer, date) and the full form into `p3/review/decisions/<id>.json`; the first save of a day copies the CSV to `decisions/EEG_ATLAS_CLINICAL_REVIEW.backup-<date>.csv`. Opened from disk without the server, the pages keep a browser draft and offer Download JSON instead. Pages are re-skinned by `p3_review_upgrade.py` from `review_template.html` without touching the embedded data (2026-09-16). The NPZ and QC JSON expose the data and measurements. This is an offline research artifact; nothing was published to PedQuEST.

Start with AT-R001 (neonatal background), AT-R006 (flat-data concern), AT-R007 (neonatal event), AT-R013 (pediatric event), and AT-R023 (adult event with rail flags). Then review the remaining patients and contrasts. Source annotations are not accepted ACNS labels. Use the review sheet or downloadable JSON to record corrected labels, state, interval changes and concerns.

## Technical findings

| Finding | Handling |
|---|---|
| All six Cork EDFs and three Helsinki EDFs available | Cork archive CRC checked; Helsinki published sizes/MD5 matched; local SHA-256 provenance retained. |
| CHB/Siena full selected intervals and context downloaded | Exact HTTP byte ranges, headers and payload hashes retained. These hashes document fragments; they are not whole-source-file checksum verification. |
| Digital flatness in AT-R002, AT-R006 and AT-R015 | Exact per-channel times recorded. AT-R006 has extensive flat segments consistent with the source's missing-data warning. Do not treat these as biological suppression; revise/mask only with documented review. |
| AT-R023 has flat and ADC-rail samples | Requires artifact review before canonical-example selection. No automatic clinical artifact classification was made. |
| CHB duplicate T8-P8 labels | Explicitly displayed in QC; do not double-weight duplicate derivations in later metrics. |
| Siena naming | EDF headers identify EEG O1 directly; auxiliary `1`/`2` channels excluded. PN01 filename and start clocks reconciled. Original acquisition reference remains unspecified. |
| Siena acquisition filters | HP 1.591549 Hz, LP 30 Hz, notch 50 Hz. Primary PSD comparison is limited to 2–30 Hz with matched filter effects. |

QC scanned all selected samples for calibration/finite values and computed exact-flat and rail flags in one-second windows, retaining actual sample bounds and partial-window counts. All selected rates are integer and records are continuous EDF; the bounded parser fails closed for unsupported layouts. QC flags are not a complete detector of movement, muscle, sweat or other artifacts. Clinical artifact review is still required.

## Deferred families and claims

**AT-P06/07/08:** public I-CARE v2.1 has no physical voltage units and the selected records do not provide confirmed LPD/LRDA labels. No calibrated adult ICU replacement was established within the selected public-source screen. Access-controlled SPaRCNet/TUH and CCEMRC remain later options, not silently substituted datasets. Adult ICU absolute-voltage and LPD/LRDA quantitative acceptance stay deferred, as permitted by P0. [I-CARE release notes](https://physionet.org/content/i-care/2.1/)

AT-P01–05 have three candidate patients each, **not three clinically accepted patients**. Cork grades do not prove a particular ACNS phenotype; precise PMA/state limitations remain. Clinical review may reject intervals or reveal a family shortfall. Preterm normative references and final independent test cohorts remain unavailable. No near-indistinguishability, interrater-reliability or competency claim is supported by P3.

## Completion boundary and next action

The remaining task is Craig's clinical adjudication of this concrete packet, including relevant P2 ambiguities. An AI cannot record Craig's clinical approval on his behalf. The P4 [current-engine baseline](EEG_ATLAS_P4_BASELINE.md) was run on 2026-09-15 against these development intervals with their labels still marked pending; it changes no reference and records no approval. Any replacement sampling prompted by clinical review stays in development and must preserve the patient/reserve separation.

Renderer note (2026-09-19): the P4 estimators and the P5 candidate comparisons against these references now run on renderer 0.4.1 (`research/eeg-atlas/p5/out/candidates.json`); the references, their labels and the acceptance CSV are unchanged by any renderer version.

Private scripts: `p3_raw.py` (selective Cork extraction), `download_helsinki.py`, `p3_inspect.py`, `finish_p3.py`, and `finalize_p3.py` under `research/eeg-atlas/`. The historical `p3_manifest.py` creates the initial draft and must not overwrite completed technical fields or later clinical decisions. Preserve reviewer files when rebuilding. The audit records current retained storage, below P0 caps. Hosted usage and network transfer are not fully metered; no exact spend claim is made. No paid compute, model installation, generator tuning, website changes, commits or deployment.
