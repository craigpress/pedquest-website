# EEG Atlas: staged research and delivery plan

Date: 2026-09-15. **Planning only. No system implementation, EEG generation, model installation, or deployment.**

Companion: [reusable master prompt](EEG_ATLAS_MASTER_PROMPT.md).

Access follow-up: [public EEG dataset and usage matrix](EEG_ATLAS_DATA_ACCESS.md), checked 2026-09-15. Includes anonymous starting datasets and exact registration/DUA requirements; distinguishes public PhysioNet I-CARE from the differently licensed BDSP release.

P0 completed 2026-09-15: [charter, selected pilot and P1–P3 resource envelope](EEG_ATLAS_P0_CHARTER.md). This supersedes proposed release ordering/resource decisions below. P1 is complete: [source review](EEG_ATLAS_SOURCE_REVIEW.md) and [register](EEG_ATLAS_SOURCE_REGISTER.json). P2 core contracts and coverage are authored and AI checked; [clinical review remains pending](EEG_ATLAS_P2_REVIEW.md). P3's technical packet and the [P4 current-engine baseline](EEG_ATLAS_P4_BASELINE.md) are complete (2026-09-15); the first P5 session (2026-09-16) delivered renderer 0.3.11 on branch `eeg-atlas-p5` and [32 candidates for review](EEG_ATLAS_P5_REVIEW.md); clinical acceptance of the P3 references is still pending.

## 1. Intended outcome and decisions

Build a distinct EEG Atlas connecting **terminology -> measurable criteria -> original signals -> verification -> teaching and assessment**. Improve the existing generator through this evidence loop. Cover all ages, including premature and term neonates, in stages. Craig clarified that adaptive learning is for students.

The important improvement is a reusable, testable feature specification rather than a gallery of attractive examples. Each exemplar should teach a concept; each generated variation should carry evidence that the concept survived synthesis; each assessment should measure a defined skill.

Confirmed scope:

- Incorporate ACNS terminology into the knowledge bank and prompt-driven synthesis.
- Compare examples visually and quantitatively to appropriate clinical references, particularly ACNS/CCEMRC.
- Keep Atlas content separate from existing EEGs while reusing suitable infrastructure.
- Support effectively open-ended practice variation, later adaptive learning, and defensible competency measurement.
- Optimize for small resumable sessions across efficient hosted and local models.
- Plan first. Implementation requires a later instruction.

Craig confirmed **public datasets and his review initially**. Independent reviewers and institutional data are later options, not initial dependencies. Release order and budget remain proposals. There is no calibrated basis for claiming exactly 97% understanding; the confirmed requirements above are the readiness check. All three scope questions are resolved. This is sufficient to design the plan, not to claim validation or begin construction.

## 2. Project fit: verified versus historical context

Read-only inspection found `tools/eeg-render/eeg_render/spec.py`, `schema.py`, `synth.py`, exports, and `src/lib/lab/spec.ts`; the checked renderer version is 0.3.9. Current age defaults and guided-form ages are neonatal through adolescent. **Adult support needs an explicit gap assessment** before an all-age claim.

The question generator has a retrieved-evidence path (`src/lib/qbank/retrieve.ts`, `cited.ts`, `draft.ts`, `critic.ts`). The Atlas should connect a structured terminology layer to that path rather than assume PubMed abstracts contain all operational definitions. [Existing research note](EEG_TEACHING_LAB_RESEARCH.md) and [canonical handoff](../../HANDOFF.md) describe the EEG Lab, exports, viewer, and course layer. Production state and historical detector results were not rerun in this planning session.

A crucial correction to the older research framing: the scenario specification provides **intended labels**. Measured and adjudicated labels must establish whether the emitted signal realizes them.

## 3. Evidence map and source roles

| Source | Planned use | Limits / verification state |
|---|---|---|
| [ACNS 2021 terminology](https://www.acns.org/UserFiles/file/ACNSStandardizedCriticalCareEEGTerminology_rev2021.pdf) | Definition authority for critical-care concepts | Readable PDF; exact criteria extraction and page-level audit are future work |
| [ACNS guideline index](https://www.acns.org/practice/guidelines) | Version checks; technical and neonatal companion standards | Currently links the 2021 terminology, reference chart, examples, and CCEMRC training |
| [Supplemental examples](https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf) | Source-linked visual exemplars | Readable 36-page PDF; not a raw multichannel EEG corpus |
| [2022 training presentation](https://www.acns.org/UserFiles/file/ACNS_Training_Module_2022-01-01_Combined_FINAL.pptx) and [CCEMRC education](https://www.acns.org/research/critical-care-eeg-monitoring-research-consortium-ccemrc/education) | Instructional organization and annotated examples | Presentation could not be parsed through the web reader in this session; slide/media inventory remains a first-phase task |
| [User's Ovid neonatal paper](https://www.ovid.com/jnls/clinicalneurophys/fulltext/10.1097/wnp.0b013e3182872b24~american-clinical-neurophysiology-society-standardized-eeg), [official ACNS full-text alternative](https://www.acns.org/pdf/guidelines/Guideline-16.pdf) | Separate neonatal terminology authority | DOI identifies Tsuchida et al., 2013; Ovid inaccessible, but the official ACNS PDF is readable |
| [Developmental EEG chapter](https://www.ncbi.nlm.nih.gov/books/NBK390356/) | Age/state context and developmental exemplars | Accessible; supplemental educational source, not a substitute for ACNS definitions |
| [Nature dataset paper](https://www.nature.com/articles/s41597-023-02002-8), [dataset record](https://zenodo.org/records/7477575) | Raw neonatal background benchmark | 169 one-hour epochs from 53 term neonates with HIE; repeated infants must remain in one split. Does not cover preterm physiology or all neonatal diagnoses |
| [IEEE 10385183](https://ieeexplore.ieee.org/document/10385183), [PubMed identity](https://pubmed.ncbi.nlm.nih.gov/38194391/) | Candidate hypsarrhythmia measurements | Hou et al., 2024, *Quantification of Hypsarrhythmia in Infantile Spasmatic EEG: A Large Cohort Study*, DOI 10.1109/TNSRE.2024.3351670. Relevant to a later infantile-spasm extension; not a general realism metric. Public code/raw data not established |

The [CCEMRC public database page](https://www.acns.org/research/critical-care-eeg-monitoring-research-consortium-ccemrc/ccemrc-public-database) offers a reporting database template; original study data require contributor-site approval. Do not mistake this for a freely downloadable waveform bank.

Library search also identified EndNote record 4929, [Abend et al. 2017](https://doi.org/10.1097/WNP.0000000000000424), on pediatric post-arrest EEG interrater agreement. It supports planning domain-specific agreement analyses rather than assuming every descriptor is equally reproducible. The semantic library query timed out; keyword and author-filter searches returned results. This is a targeted planning review, not a completed systematic literature review.

### Reference governance

Maintain a manifest per asset: source/version/hash, page or recording interval, population, provenance, montage, calibration, available channels, duration, clinical labels and uncertainty, access terms, and separate permissions for analysis, training, public display, and redistribution. Link out to protected figures unless display rights permit reuse. Do not assume all figures share a document's general license.

Use two evidence tracks:

- **Figures:** standardized side-by-side display, morphology/topography review, and limited calibrated measurements with uncertainty. Do not infer raw spectra, phase, connectivity, or biological covariance from rasterized traces. Digitized traces, if ever used, remain derived uncertain data.
- **Raw recordings:** waveform metrics, multichannel relationships, temporal dynamics, and held-out clinical validation. Store recordings where their access terms permit; send public excerpts or derived permitted metadata to hosted models as appropriate.

If raw data are unavailable for a feature, publish only the evidence level actually achieved. A visual reference does not justify a quantitative-equivalence badge.

## 4. Coverage and the terminology knowledge bank

Use source-defined axes rather than a flat list of waveform names. Initial inventory includes background frequency/organization, symmetry, voltage, continuity, reactivity/state; rhythmic/periodic pattern distributions and morphology; frequency, duration, prevalence, evolution/fluctuation, plus modifiers and stimulus relationships; seizures, status, BIRDs, and IIC. The exact inventory must be audited against all sections of the [2021 source](https://www.acns.org/UserFiles/file/ACNSStandardizedCriticalCareEEGTerminology_rev2021.pdf).

Neonatal coverage uses its own age/state vocabulary, maturation context, graphoelements, continuity and interburst behavior, synchrony, and seizure descriptors. It must not inherit inappropriate adult thresholds. Developmental normal variants, artifacts, and hypsarrhythmia are labeled companion modules, with their own sources. [Neonatal terminology identity](https://pubmed.ncbi.nlm.nih.gov/23545767/), [developmental chapter](https://www.ncbi.nlm.nih.gov/books/NBK390356/).

Use two terminology tracks behind one Atlas: non-neonatal ACNS 2021 and neonatal ACNS terminology. Preserve observations, rule-derived labels, and clinical interpretations separately. The source inventory must also check less obvious concepts such as CAPE, breach effect, sporadic discharges, independent distributions, identical/highly epileptiform bursts, and context-dependent modifiers. This is a checklist for extraction, not an implemented or exhaustive rule set.

Each source concept gets a coverage row, even if implementation is deferred: `unmapped`, `defined`, `reference available`, `synthesizable`, `measured`, `human reviewed`, `teaching released`, `assessment calibrated`. Track these by age/state and evidence strength. Report missing references and unsupported combinations rather than silently omitting them.

### Feature contract: proposed fields

| Group | Required contents |
|---|---|
| Identity | Stable concept ID, terminology/version, aliases, preferred wording, parent/related concepts |
| Evidence | Definition paraphrase, source/page/figure, reviewer, authoritative versus empirical versus engineering status |
| Applicability | Age/PMA when relevant, clinical state, required context, acquisition and display assumptions |
| Requirements | Values/ranges, units, inclusive/exclusive boundaries, denominator and observation duration, temporal/spatial predicates |
| Relationships | Required companions, forbidden combinations, mimics, exceptions, mutually exclusive labels |
| Generation | Supported parameters, validated bounds, constraints, randomization families, unavailable requests |
| Measurement | Independent estimator, preprocessing, uncertainty, tolerance and provenance of tolerance |
| Human review | Morphology/field rubric, ambiguity, adjudication record, approved uses |
| Education | Skill targets, contrast cases, difficulty factors, explanation, rubric, assessment eligibility |

Keep immutable source assertions separate from adjustable engineering tolerances. A single contract should supply knowledge retrieval, generation validation, learner explanations, and rubric construction. Do not maintain four hand-copied definitions.

For each concept plan: one canonical example, several phenotype-preserving variations, near-boundary pairs, mimics, and selected clinically plausible combinations. Use pairwise/risk-based combination coverage; a Cartesian product across every modifier, age, background, and artifact would be expensive and often invalid.

## 5. Prompt-driven synthesis

Proposed flow:

`prompt -> retrieve applicable contracts -> typed scenario -> compatibility/context checks -> synthesis -> independent measurements -> adjudication/release`

The compiled scenario records requested features and exclusions, age/state, observation length, channel setup, target ranges, source versions, seed/family, and purpose (canonical teaching, variation, boundary exercise, or assessment).

For example, a request for a lateralized periodic pattern should resolve into explicit location, rate, morphology, duration and background constraints. The compiler must not silently add evolution or a plus modifier. Requests that cannot be judged from the available duration or context return a precise missing requirement. Labels dependent on stimulus or clinical correlation need those event records; they cannot be inferred from appearance alone.

Preserve three linked objects: `requested phenotype`, `measured phenotype`, `adjudicated phenotype`. If they disagree, quarantine the example and retain the failure. Never let the LLM declare its output correct merely by restating the prompt.

### Generator improvement sequence

1. Establish the current baseline without changing it: export fidelity, units, electrode consistency, window/chunk invariance, and existing feature realization.
2. Correct measurable failures in the current deterministic engine.
3. Improve morphology diversity, spatial fields/covariance, nonstationarity, realistic transitions, state and artifact interactions where reference evidence supports them.
4. Test hybrid signal models or learned residuals only if a documented residual gap persists. Require ablations and repeat all feature checks; added texture can erase a target morphology.
5. Consider full generative models only after the smaller approaches show insufficient value. No LLM LoRA or waveform foundation-model training is assumed.

All montages, stills, EDF/Persyst exports and qEEG must derive from the same canonical voltages. Age-aware physiological bounds and realistic variability should be learned or estimated from eligible development data, not guessed from a single textbook figure.

## 6. Verification: independent gates

### A. Technical fidelity

Check voltage units/scaling, sampling, reference and montage algebra, channel order, clipping, filtering, export round-trip error, chunk-boundary continuity, and consistency between displayed and exported windows. Tolerances account for declared file quantization. This gate is necessary even when an image looks right.

### B. Feature compliance

Independent measurement code checks the contract against emitted voltages. Check required and prohibited features, temporal coverage, spatial field, rate/duration distributions, continuity and state transitions as applicable. Estimators report uncertainty and an indeterminate state near unreliable boundaries. Source thresholds and operational tolerances are different fields.

Canonical teaching examples must have no unresolved critical violations. Boundary cases have explicit uncertainty labels and appropriate rubrics. Rare/context-dependent concepts remain human-reviewed when reliable automatic measurement is unavailable.

Observation length is a contract requirement. A short still can illustrate morphology but cannot establish an hour-based burden, stimulus reactivity without stimulus context, or an electroclinical event without a clinical correlate. Provide linked longer clips and event timelines, or mark the criterion unassessable. Source-specific neonatal rules must be checked separately. Do not ingest protected CCEMRC self-assessment questions as benchmark content; use the public educational resources and original items.

### C. Biological realism

Compare matched clinical and synthetic distributions by age/state/phenotype. Candidate metrics include amplitude quantiles, log power spectra, spectral slope, event shape and interval variability, spatial covariance/coherence, burst/IBI distributions, asymmetry, and longer-term transitions. Select a small primary set per family before evaluation; reserve other metrics for diagnosis.

Report effect sizes, confidence intervals, distribution distances, and failures. Establish the clinical-to-clinical variability baseline. Avoid a pooled global score that lets plentiful normal backgrounds hide poor rare-pattern synthesis. Signal coherence depends on montage/reference; compare like with like and retain absolute-voltage checks alongside normalized comparisons.

### D. ML and clinical analysis tools

| Candidate | Suitable role | Constraint |
|---|---|---|
| Deterministic DSP suite | First-line compliance and distribution checks | Must be independent of generator labels; validate estimators themselves |
| [MORGOTH](https://github.com/bdsp-core/morgoth), [access record](https://bdsp.io/content/morgoth1/1.0.0/) | Auxiliary predictions for slowing, burst suppression, spikes, sleep, and selected rhythmic/periodic patterns | Credentialed model access; population and task eligibility require audit. Not a generic realism score |
| [SpikeNet 2.0](https://github.com/bdsp-core/SpikeNet2), [access record](https://bdsp.io/content/spikenet2/1.0/) | Spike detection/localization agreement when spikes are the target | Restricted weights; not a background/seizure/whole-EEG realism validator |
| [IIIC-SPaRCNet](https://github.com/bdsp-core/IIIC-SPaRCNet) | Focused rhythmic/periodic/seizure phenotype comparator | Access/license audit needed; possible cohort/label overlap with other BDSP tools means votes may be correlated |
| Existing Persyst pathway | Licensed external trends/detection checks after current access/version confirmation | Historical local result is feasibility evidence only; verify applicable population and baseline requirements |
| Simple held-out real/synthetic classifier | Detect residual shortcuts and distribution mismatch | Chance performance can reflect a weak test; audit metadata/device/filter shortcuts and test power |

Verify code, model-weight, and data licenses separately. MORGOTH and SpikeNet repositories expose noncommercial terms; record the exact applicable agreements before use. Keep tool-specific preprocessing versioned. Compare clinical and synthetic inputs through identical eligible pipelines; a probability is not automatically calibrated confidence on synthetic data.

Freeze evaluators before final testing. Do not tune against every evaluator or final test set. Agreement among tools trained on overlapping data is not independent corroboration.

### E. Blinded human study and statistics

Use matched displays with identical calibration, montage, time scale, filters, and UI. Include canonical and challenging real/synthetic examples. Remove provenance clues from the blinded task; retain truthful synthetic labels on the ordinary teaching site.

Ask separately: (1) what features are present, (2) realism/plausibility rating, (3) real-versus-synthetic judgment with confidence, and (4) any visible reason for failure. A convincing wrong feature still fails. Use at least two qualified independent reviewers plus adjudication for the initial review workflow when available; broader claims need a reviewer sample justified by the study design.

**Initial feasible track:** Craig reviews candidate families and their measured evidence using public datasets. Label this single-reviewer formative content; it cannot estimate interrater reliability or provide an independent blinded validation of a generator he helped refine. Continue useful synthesis and teaching work under that scope. Recruit independent reviewers only for the later confirmatory claims. Include deliberately crude positive controls and concealed repeat items in that later study to check task sensitivity and intrareader consistency.

Split clinical patients before window extraction. Group synthetic examples by generator family/template and parameter regime, not merely random seed. Keep related clinical excerpts and near-duplicate synthetic variants in the same split. Keep development, calibration, and final test partitions separate; obtain an external site/device cohort when feasible. Audit overlap with pretrained evaluators and mark unknown overlap explicitly.

Predefine primary endpoints, acceptable margins, multiplicity strategy, exclusion/missingness rules, and analyses with a biostatistician. Estimate patient, family and reader variation in a pilot; use crossed/hierarchical models or cluster-aware resampling as appropriate. Simulate sample size for the desired interval precision/equivalence margin. Hundreds of windows from one patient are not hundreds of independent clinical examples.

"Nearly indistinguishable" requires positive evidence: the relevant confidence interval must fit a prespecified practical-equivalence range, with adequate power, while feature correctness also passes. A nonsignificant difference or 50% point estimate alone does not pass. Scope any resulting claim to the tested ages, contexts, modalities and tasks. Human reader success is a bounded criterion, not proof of identical biological processes.

Methods to specify with the statistical reviewer include [two one-sided equivalence testing](https://pubmed.ncbi.nlm.nih.gov/3450848/) and [multi-reader/multi-case analysis](https://doi.org/10.1080/03610919508813243). Do not pick a numerical equivalence margin from an AI suggestion. Derive it from the consequences of an error and pilot variance before locking the study.

## 7. Teaching, adaptive practice, and competency

### Learning progression

1. Recognize an isolated feature with highlighted explanation and source.
2. Distinguish it from a closely matched mimic or boundary case.
3. Describe and localize it across montages.
4. Interpret temporal changes in a longer recording and associated qEEG.
5. Combine background, patterns, artifacts, and uncertainty in a structured report.
6. Transfer to unfamiliar, permissioned clinical recordings.

Each Atlas concept should offer a definition card, canonical trace, annotated/unannotated modes, generated variations, contrast examples, and the specific criteria demonstrated. Expose age, state and display settings. Keep answer keys and overlays unavailable in assessment mode.

### Adaptive learning

Start with transparent rules: prerequisite skills, error types, spaced revisits, and increased or reduced difficulty. Track mastery by skill and context rather than a single overall percentage. Vary similarity to mimics, signal-to-background ratio, distractors, montage, and temporal complexity within reviewed limits. Age is a content dimension, not automatically a difficulty score.

Introduce IRT or Bayesian learner models only after sufficient real learner responses support calibration. New seeds do not automatically create psychometrically equivalent items. Estimate difficulty at the item-family level and monitor variant-specific deviations, exposure, uncertainty, and subgroup/device effects. Include anchor items and occasional nonadaptive probes to identify selection bias and drift.

### Assessment and expertise claims

Maintain separate open-practice families, protected assessment families, and research test material. Avoid distributing protected seed recipes or answer keys. Match alternate forms to a competency blueprint; do not infer equivalent forms from equal item counts.

Score classification, localization, temporal annotation and structured reporting with explicit partial-credit rubrics and calibrated tolerances. Preserve uncertainty when human experts disagree. Use delayed retention and transfer to unseen clinical EEG as primary educational evidence. Confidence calibration and efficiency can supplement accuracy; speed should not dominate expertise scoring.

Define the target learner groups and intended stakes before setting mastery cutoffs. Use educational measurement review and standard-setting before competency certification. Initially describe outputs as formative skill estimates. Unlimited generation is a supply capability; it does not establish unlimited valid exams.

For the later education study, compare against a defined standard/static curriculum with baseline, immediate post-test, delayed retention and blinded real-EEG transfer scoring. Use the [Standards for Educational and Psychological Testing](https://www.apa.org/science/programs/testing/standards) as a framework for the intended score interpretations. The present phase does not establish test validity.

Existing course permissions, feedback rules and scoring behavior should be checked during integration. New learning policies should not silently override those decisions.

## 8. Atlas isolation and release lifecycle

Proposed logical objects: source asset, terminology concept, feature contract, clinical reference, synthesis recipe/family, generated instance, evaluation run, adjudication, educational item, and release manifest. Decide physical tables only after mapping the existing schema.

Give Atlas objects their own namespace, storage prefix, collection filters and release state. Proposed website destination: `/eeg-atlas`. Reuse the current EEG viewer and export engine behind explicit interfaces. Existing EEG Lab and question-bank imports are never an automatic side effect of Atlas publication.

Lifecycle: draft -> automatic checks -> clinical review -> teaching eligible -> assessment calibrated -> retired/superseded. Store evidence and approved populations on each release. Pin existing content to the generator version that produced it. Promote generator improvements through regression checks and deliberate version upgrades; do not mass-regenerate legacy examples during Atlas experiments.

## 9. Sessions, dependencies, and resource routing

These are proposed work packages, not work started. Split each package into sessions of roughly 1-3 focused agent-hours when necessary; human review and access delays are separate. Token/runtime ceilings must be set per invocation. Counts below are budgeting aids, not empirical promises.

| Package | Inputs -> concrete output | Acceptance / dependency | Suggested execution |
|---|---|---|---|
| P0: charter and access (1 session) | This plan + confirmed public-data/Craig-review start -> eligible public-data matrix, release order, budget | Every blocked source has a fallback; independent-validation scope deferred explicitly | Sol/Terra PM + Craig |
| P1: source register (1-2) | Approved sources -> pinned source/figure/slide manifest | All eight supplied links accounted for; exact versions and access gaps recorded | Local/Luna extraction; Terra audit |
| P2: terminology map (3-6) | P1 -> full concept inventory and feature contracts | Page-level coverage audit; adult/pediatric/neonatal differences and exceptions reviewed | Local bounded extraction; Sol synthesis; clinical reviewer |
| P3: benchmark and protocol (2-4) | P1/P2 -> eligible reference manifest, patient/family splits, frozen metrics and reader protocol | Enough references for pilot families; statistical and rights decisions explicit | Terra data work; Sol statistical review; humans |
| P4: current-engine baseline (1-2) | P2/P3 + current renderer -> gap matrix and reproducible baseline report | Measure actual emitted signals; no blanket capability claims | CPU worker; Terra analysis |
| P5: pilot families (3-6) | P4 -> small candidate set and defect-driven generator fixes | All technical/feature gates pass; failures retained | Terra implementation; local CPU rendering; Sol review |
| P6: pilot validation (2-4 plus readers) | P5 + held-out references -> evidence report and go/no-go | No test leakage; clinically acceptable morphology; design/power for next study | CPU metrics; optional eligible GPU tools; human panel |
| P7: staged coverage (repeat batches) | Accepted pilot -> reviewed families across all-age modules | Each batch meets same gates; coverage matrix exposes gaps | Local batch jobs; Terra/Luna; focused clinical review |
| P8: Atlas website (2-4) | Stable contracts + accepted families -> isolated browsable Atlas | Access separation, same-signal viewer/export, existing-content regression checks | Terra implementation; Luna UI checks |
| P9: education pilot (2-4 plus learners) | P8 + rubric -> formative practice and learner study | Comprehensible feedback, retention/transfer evidence, item-family analysis | Sol education design; Terra implementation; educators |
| P10: adaptive/competency layer (later) | P9 response data -> calibrated adaptive practice; scoped competency claims | Sufficient calibration, standard-setting, fairness and protected-test checks | Statistician/educator + Sol/Terra |

Dependency path: P0 -> P1 -> P2/P3 -> P4 -> P5 -> P6 -> P7/P8 -> P9 -> P10. Source extraction and reference eligibility work can overlap once scope is agreed. Start no expensive model training or full website build before pilot evidence.

### Proposed pilot and release staging

- **Pilot:** 6-8 deliberately diverse families spanning normal/slow background, discontinuity/suppression, a periodic pattern, a rhythmic pattern, a seizure/evolution case, and neonatal background behavior. Include a mimic and a boundary comparison. Final choices depend on references; these are not the entire scope.
- **Release A:** common critical-care concepts with separate adult and non-neonatal pediatric evidence. Adult engine support is explicitly checked.
- **Release B:** neonatal modules split by PMA/state, including term and preterm references; term-HIE data cannot stand in for preterm normal EEG. Neonatal design is present from P2, with at least one pilot family.
- **Release C:** remaining modifiers/combinations, uncommon patterns, developmental variants, and relevant infantile-spasm extensions.
- **Release D:** longer clinical trajectories, advanced assessment, and validated adaptive learning.

If neonatal reference readiness is stronger, move that module earlier. Priority follows educational value, measurable feasibility, clinical availability, and reviewer capacity.

### Efficient model and compute use

- Local models: public-source field extraction, synonym candidates, manifest formatting, discrepancy lists, and bounded summaries. Validate on a small expert-checked extraction set before scaling; never let them finalize clinical thresholds unsupervised.
- Luna/older capable GPT: document consistency, routine tests, source-link checks, UI acceptance tasks with clear criteria.
- Terra: code/data work, adapters, reproducible analysis pipelines, integration.
- Sol: planning synthesis, difficult clinical/algorithmic reconciliation, statistical review, adjudication preparation.
- Humans: authoritative clinical interpretation, source conflicts, equivalence margins, reader adjudication and competency standards.
- CPU jobs: signal generation, DSP, exports, lightweight discrimination. GPU jobs: eligible frozen models only when they answer a remaining question. Benchmark runtime and memory before scheduling larger batches.

Local inference has no per-token provider charge but still uses electricity, hardware and review time. Discover available systems and capabilities at execution time; no host assignment or capacity is assumed here. Use isolated job directories and a single integration owner. Do not let multiple models edit the same schema or canonical document simultaneously.

For each package estimate and then record: hosted input/output tokens and cost, GPU/CPU hours, storage, human review time, cache reuse, and retry count. Total budget = agent usage + compute + storage + human review/access costs. Use observed P1-P6 costs to forecast P7; a credible full-project dollar total is not yet available. Proposed stop rule: after two unsuccessful bounded revisions, report the failure and change the hypothesis before another batch. This is a project-management proposal, not a scientific threshold.

### Portable session handoff

Every authorized package ends with: package ID/status; parent dependencies; exact input hashes/versions; output paths/hashes; commands/environment; seed/family list; checks with pass/fail/indeterminate; unresolved scientific questions; resource use; and the next bounded action. Store bulky signals and logs as artifacts, not conversation context. Continue using the canonical project handoff and existing task board; this plan is not a competing task tracker.

## 10. Biggest rework risks and improvements

| Risk | Design response |
|---|---|
| Beautiful examples with wrong definitions | One source-backed contract plus independent waveform measurement |
| Adult assumptions embedded before neonatal work | All-age schema and separate neonatal definitions from the first terminology phase |
| Quantitative claims based on screenshots | Explicit figure/raw-data evidence tracks |
| Detector gaming or correlated model votes | Frozen diverse evaluators and blinded clinical review |
| Infinite seeds mistaken for biological diversity | Family-level variation, held-out families, clinical distribution coverage |
| Generator changes silently alter other EEGs | Separate Atlas lifecycle and version-pinned shared components |
| Assessment memorization and uncalibrated difficulty | Protected families, anchor items, clinical transfer tests and psychometric review |
| Expensive training before knowing the defect | Baseline -> targeted deterministic repair -> gated hybrid experiments |
| Agents repeat literature search or lose context | Pinned source register, compact work packages and artifact-based handoffs |

Highest-value additions are contrastive pairs that change one meaningful criterion, a failure atlas that records what fooled an evaluator, and a concept-by-population evidence map. These make every new example improve the knowledge bank, synthesis tests and teaching materials together.

## 11. Planning review and next action

This plan received separate Sol reviews for signal/clinical methods and education/statistics/prompt design, and a Terra review for ML/data/tool feasibility. These are AI-assisted disciplinary reviews, not human expert endorsements. No Astra subagents were used.

P0 and P1 are complete. P2 contracts remain pending Craig's clinical review. P3's [technical packet](EEG_ATLAS_P3_REVIEW.md) is complete: 24 full intervals across 15 patients, offline review pages, QC evidence, partition proposal and frozen feasibility protocol. Clinical acceptance remains pending. AT-P06/07/08 are explicitly deferred for reference/calibration gaps; public I-CARE cannot validate microvolt thresholds. P4 is complete: the [current-engine baseline](EEG_ATLAS_P4_BASELINE.md) measured renderer 0.3.10 against the P2 pilot contracts and the P3 development references; its [gap matrix](EEG_ATLAS_P4_GAP_MATRIX.csv) lists 65 rows (7 gate passes, 26 measured, 17 partial, 13 unsupported, 2 no-rule). P5's first session is complete: [EEG_ATLAS_P5_REVIEW.md](EEG_ATLAS_P5_REVIEW.md) records seven opt-in/additive generator controls (adult, reactivity unknown/unclear, brd, min_cycles, blink_rate_per_min, pdr_gain, channel_gain_max), ACNS advisories, a byte-identity proof for legacy content, and 32 candidates in [EEG_ATLAS_P5_CANDIDATE_REVIEW.csv](EEG_ATLAS_P5_CANDIDATE_REVIEW.csv), all pending Craig's review. The branch is not merged or deployed.

Update 2026-09-20: P5 is accepted (31 accept / 1 revise / 1 unscored over three passes; renderer 0.4.1 on main and
both worker fleets; the 52 bank images migrated to spec_version 2). P6 as chartered could not run - the partitions
hold no held-out waveform - and was replaced by Craig's direct acceptance on development data; the limit this places
on later claims and the contract-acceptance policy are recorded in [EEG_ATLAS_P7_PLAN.md](EEG_ATLAS_P7_PLAN.md),
which opens P7 with a re-baseline of the gap matrix at 0.4.1.
