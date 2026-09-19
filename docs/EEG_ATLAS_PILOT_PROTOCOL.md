# EEG Atlas P3: pilot reference and measurement protocol

Version: 2026-09-15.p3-feasibility1. **Feasibility protocol frozen before generator testing; clinical acceptance and confirmatory design remain pending.** Source definitions awaiting Craig's adjudication remain draft. This phase screens references and defines later evaluation. It does not generate EEGs or claim realism, equivalence or competency validity.

## 1. Reference selection and partitions

The [record manifest](EEG_ATLAS_REFERENCE_MANIFEST.csv) separates source annotations, proposed Atlas families, technical inspection and Craig's label. A candidate interval is not an accepted reference. All 24 non-I-CARE candidate intervals now have complete native-rate numeric checks with up to 60 seconds of context on each side. Finite samples, flat/ADC-rail flags and decoding do not establish clinical morphology or artifact-free intervals. Full EDFs, byte-range fragments and the offline review packet live outside the website repository in `PedQuest_website/research/eeg-atlas/p3/`.

Selection is a reproducible convenience sample: the first documented candidates within the P0 cap, with Cork grades deliberately represented. It is not prevalence-representative. Up to 12 candidate patients per source and 60 overall remain the screening ceiling. Target three independent patients per active family; report shortfalls rather than count windows as patients.

The [partition proposal](EEG_ATLAS_PARTITIONS.csv) assigns all currently inspected patients to development and identifies metadata-only reserve patients before generator work. These reserves are **not yet an eligible final test set**. Do not inspect their waveforms or use their outcomes to optimize the generator. A later custodian must select and lock calibration and final-test patients after feasibility counts are known, without exposing final-test signals to developers. Do not force a three-way percentage split onto this small sample.

- Group all recordings, epochs, montages and crops from one clinical patient together. CHB01 and CHB21 share one patient and must share the `chb01_21` group. Helsinki release versions share a cohort; do not count them twice. Dataset cohorts overlapping an evaluator's training set are not independent external validation.
- Group synthetics by morphology/template ancestry, parameter regime and parent clinical reference. Different seeds do not make independent families. A synthetic derived from development references stays in development.
- Freeze patient assignments before window selection for future cohorts; log exclusions and replacements without looking at generator performance. If a reserve is opened for troubleshooting, mark it development and obtain a new reserve.

## 2. Eligibility and rights gates

For every proposed interval, verify: population/PMA and uncertainty, acquisition state when available, annotation time origin, contiguous available duration, original montage/reference, channel labels, sample rates, physical units, digital/physical ranges, filtering and signal integrity. Keep native data untouched. Use the EDF affine conversion `(digital-digital_min)*(physical_max-physical_min)/(digital_max-digital_min)+physical_min`; check units before expressing values in microvolts. Preserve quantization uncertainty and saturation flags.

Critical source findings:

- Cork's grades summarize HIE background severity; grade 1 combines normal and mildly abnormal. They do not directly label ACNS continuous, burst-suppressed or healthy physiology. Its metadata documents artifacts and different acquisition references. Exact patient PMA/state are not provided by the selected metadata. [Dataset documentation](https://zenodo.org/records/7477575)
- Helsinki supplies individual one-second seizure annotations. Preserve each reviewer, consensus intersection and disagreement; do not average them into certain ground truth. Consensus-run boundaries used here are derived screening aids, not new expert annotations. [Dataset](https://zenodo.org/records/4940267)
- CHB includes bipolar derivations, duplicate channels and repeated-patient cases. Compare synthetic voltages in the measured derivations; do not invent an absolute reference. The selected seizure timestamps do not alone establish focal onset or identify a mimic. [CHB-MIT](https://physionet.org/content/chbmit/1.0.0/)
- Siena PN01's annotation names `PN01.edf`, while its directory provides `PN01-1.edf`; this reconciliation remains explicit. Clock offsets cross midnight. All three inspected EDF headers explicitly identify EEG O1; separate auxiliary channels named `1`/`2` are excluded. The original acquisition reference is still unspecified, so spatial claims requiring that reference remain deferred. The PN00 third-event end time exceeds its listed record end and is excluded from this selection. [Siena](https://physionet.org/content/siena-scalp-eeg/1.0.0/)
- I-CARE v2.1 explicitly has no physical units (`nu`). It cannot validate absolute microvolt cutoffs or calibrated low-voltage/suppression claims. Keep relative temporal/morphological analyses conditional; outcome labels are not ACNS labels. LPD/LRDA presence is unconfirmed. [Release notes](https://physionet.org/content/i-care/2.1/)

Keep Cork/Helsinki/Siena CC BY, CHB ODC-By and I-CARE CC BY-NC-SA provenance separate. Public display is a later per-artifact decision, with attribution, modifications and license recorded. Neither document figures nor restricted CCEMRC self-assessment questions become benchmark assets. No new accounts, agreements, external messages or model installations are part of this packet.

## 3. Frozen pilot measurement plan

These are the primary measurement domains to implement and validate independently in P4. They are not already-tested estimators. Freeze estimator code, parameters and uncertainty policy after development calibration and before reserved evaluation. Changes require a new protocol version and rerun; report exploratory metrics separately.

| Family | Primary feature measurements | Primary realism comparisons | Required context/limits |
|---|---|---|---|
| AT-P01 neonatal background | Calibrated voltage distribution; continuity; state-appropriate organization | Per-patient amplitude quantiles and log-PSD distributions | Term HIE; grade is not an ACNS label; state/PMA uncertainty retained |
| AT-P02 neonatal discontinuity | IBI duration/voltage, burst duration and retained graphoelements | Burst/IBI empirical distributions and burst-shape diversity | Neonatal thresholds only; artifacts/flat missing data cannot be suppression |
| AT-P03 neonatal seizure | Evolution, ≥10-s duration, ≥2-µV peak-to-peak, field; reviewer disagreement | Event time-frequency trajectories and regional field similarity | Whole event plus context; BRD contrast; clinical coupling unknown |
| AT-P04/05 pediatric/adult seizure | Source-defined duration/evolution, localization, prohibited features | Event trajectories and spatial covariance in matched derivations | Keep epilepsy-monitoring and ICU populations separate; confirm focal labels |
| AT-P06 adult background | Continuity and absolute voltage/suppression | Calibrated voltage, PSD and burst/IBI distributions | **Absolute-voltage branch blocked with public I-CARE; calibrated replacement required** |
| AT-P07 LPD | Six-cycle validity, interdischarge interval, recurrence variability, spatial field | Discharge morphology and interval distributions | Raw phenotype unconfirmed; no release on an ACNS picture alone |
| AT-P08 LRDA/slow contrast | Six cycles, no inter-wave interval, regularity, localization; exclude ESz | Cycle variability and regional spectral/spatial structure | Raw phenotype unconfirmed; plus/fluctuation and IIC boundaries retained |

Common technical gate: channel order and units, valid montage algebra, no unreported clipping, file length/time consistency, export round trip within declared quantization, identical displayed/exported voltages and chunk invariance. These checks precede phenotype and realism judgments.

P3 review-display convention: the waveform uses the same native-rate calibrated data as the NPZ export, converted to float32 with error checked below half an ADC quantum. Each visible page subtracts its channel median for display only and prints that offset. Source amplitudes in QC are uncentered. Vertical display clipping is visibly flagged and gain-adjustable. These display transformations do not alter the future P4 canonical-voltage/export gate.

Measurement defaults for development: retain native sampling for morphology/duration and absolute voltage. For PSD use artifact-masked continuous 4-s Hann windows, 50% overlap, mean removal, density scaling in µV²/Hz only when units are known, and compare a common 0.5–30-Hz band. Report sensitivity to window length for brief/nonstationary events; do not estimate an event's spectrum from mostly background. Specify anti-alias filtering before any resampling. No amplitude normalization in the absolute-voltage branch. Match reference, montage, bandwidth and observation duration across real and synthetic inputs.

The common band must also lie within the source acquisition passband. Selected Siena headers declare HP 1.591549 Hz, LP 30 Hz and notch 50 Hz; use 2–30 Hz for its primary PSD comparison and match acquisition-filter effects before interpretation. Do not infer preserved sub-1.6-Hz physiology from these records. Exclude duplicate derivations from aggregate metrics to prevent double weighting; retain and identify them in as-recorded review displays.

Report patient-level medians/quantiles and empirical distributions first. Use Wasserstein distance in original measurement units for amplitude/IBI distributions and an explicitly specified distance on log PSD; establish clinical-to-clinical variability using development patients. Spatial comparisons use identical observed derivations and retain channel exclusions. These distances are diagnostic measures, not a universal realism score. Three patients cannot establish robust equivalence margins.

Every threshold test needs below/equal/above cases, unit conversion checks, incompatible-label cases and missing context. The unresolved P2 IIC/PMA/IBI/burst boundaries remain unreleased. Unknown stimulus, clinical signs or medication response produces **not assessable**, not absent. No waveform-only ECSz/ECSE inference.

## 4. Missingness, uncertainty and exclusions

Mask disconnected, saturated, flat or artifact-dominated samples before measurement and retain the reason, channel and duration. Do not concatenate across gaps. Report usable seconds and total observed seconds separately. Burden is interval-union duration over a declared valid-time denominator; missing time is unknown, not seizure-free. Rolling-hour conclusions require adequate uninterrupted observation and documented missingness.

Keep source annotation disagreement as a separate stratum. Use strict all-reviewer agreement for initial canonical candidate screening; use union and individual annotations for sensitivity analyses. Absence of a seizure annotation does not certify a clean normal background. Boundary estimates whose uncertainty crosses a source threshold are indeterminate. Predefine estimator uncertainty and failure rules on development data; do not create a tolerance to rescue failing final examples.

## 5. Auxiliary ML evaluation

Use an independent deterministic measurement suite first. Optional later comparators:

- [MORGOTH](https://github.com/bdsp-core/morgoth): selected slowing, burst-suppression, spike, sleep and IIIC predictions; credentialed weights. Its preprocessing includes transformations that can remove absolute-amplitude evidence.
- [SpikeNet2](https://github.com/bdsp-core/SpikeNet2): spike detection/localization only; restricted weights. Not a whole-background realism judge.
- [IIIC-SPaRCNet](https://github.com/bdsp-core/IIIC-SPaRCNet): focused pattern comparator after access, model license and cohort-overlap audit.
- Existing licensed Persyst: only after version, authorized access, population and preprocessing verification.

For each evaluator pin code/weight hashes, license, training cohorts or unknown-overlap status, channel map, units, filters, resampling, normalization, window/hop, output classes and calibration. Run real and synthetic signals through the same eligible pipeline. Do not interpret correlated BDSP model votes as independent evidence or optimize against all evaluators. No model is mandatory for the pilot; none was installed or run in P3.

## 6. Craig review and later blinded study

Initial review is formative and single-reviewer. For each candidate, show the whole relevant interval plus context, matched montage/calibration, source annotation separately, measured evidence and P2 contract. Capture Craig's feature labels, accept/revise/reject/indeterminate decision, failure reason, scope and date. Preserve edits as reviewer labels, never overwrite source labels. Review canonical and contrast examples together for teaching suitability; keep a separate blinded task for later realism claims.

Later independent study: at least two qualified independent clinicians plus adjudication, with reviewer recruitment and sample size justified separately. Randomize real/synthetic presentation within age/phenotype/display blocks; hide provenance clues, balance order, separate near-duplicates and include weak-synthetic sensitivity controls and concealed repeats. Ask feature identification, plausibility, real/synthetic judgment with confidence and failure reason separately. Ordinary teaching pages always disclose synthetic provenance.

Analyze patient/case and reader clustering; windows are not independent observations. Report feature accuracy/confusion and uncertainty by family, plus reader discrimination and agreement. Use crossed reader/case models or appropriate cluster-aware resampling once counts support them. With this small pilot, descriptive results and failure discovery take precedence over inferential claims. Do not bootstrap thousands of windows to imply a large independent sample.

Confirmatory equivalence margins, primary endpoint hierarchy/multiplicity and sample size remain **unset** until clinical consequences and pilot patient/reader variance support a human-reviewed design. A nonsignificant difference, 50% discrimination point estimate or high detector agreement cannot establish near-indistinguishability. Freeze the confirmatory plan before final-test access.

## 7. Educational use and next sessions

After clinical acceptance, link each item to a feature, contrast, explanation, age/state, difficulty rationale and uncertainty rubric. Begin formative adaptive practice using demonstrated errors and spaced revisits. Keep related synthetic families in one assessment split. Evaluate transfer on unfamiliar clinical patients, not memorized seed variants. Competency cut scores, item calibration and learning-effect claims require learner data and a later educational study; they are not authorized conclusions of P3.

Next bounded work: (1) resolve technical/reference gaps with local CPU parsing and Terra/Luna checks; (2) Craig's ≤2-hour initial label review across small batches; (3) protocol lock and P4 baseline only when authorized. Reuse the existing specialist design reviews; no new expert panel was launched. Local LLMs may format de-identified metadata after a fidelity check, but cannot approve labels or decide license/clinical ambiguities. No paid compute, generator tuning, website changes or protected assessment ingestion.
