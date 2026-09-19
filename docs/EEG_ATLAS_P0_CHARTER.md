# EEG Atlas P0: charter, pilot and resource envelope

Date: 2026-09-15. **P0 complete. P1 and later packages have not started.**

Authority: Craig's instruction, “Okay begin P0.” This authorizes the charter/access decisions for P0, not automatic execution of later packages. This document selects the working defaults for those packages; it is not clinical approval of any waveform.

## 1. Charter

Create a separate, source-grounded EEG Atlas that improves the existing synthesizer and supports formative teaching. Cover adults, children, infants, term neonates and preterm neonates in stages. Use separate non-neonatal and neonatal terminology tracks. Adaptive learning refers to students.

Initial evidence comes from public datasets and Craig's clinical review. The first release claims only the feature coverage and evidence actually demonstrated. Independent blinded realism studies and competency certification are later work.

The Atlas is a distinct collection and lifecycle. Existing EEG Lab recordings, question-bank items, course behavior and generator versions must not change as a side effect of this project.

**Success for the first pilot:** a reproducible chain from source criterion to intended phenotype, emitted signal, independent measurement and Craig's review, with explicit failures and gaps. Neither a plausible picture nor a high detector score is sufficient.

## 2. Selected sources and access decisions

The same-day [access review](EEG_ATLAS_DATA_ACCESS.md) is the evidence baseline; its anonymous endpoint checks were not repeated in P0. No raw recordings were inspected, so eligibility below is at dataset level. P3 must establish record-level suitability.

| Source/version | P0 disposition | Permitted working role / condition |
|---|---|---|
| [Cork, Zenodo 7477575](https://zenodo.org/records/7477575) | **Core** | Term-HIE background development and reference selection. CC BY 4.0; preserve grades and repeated-patient grouping. |
| [Helsinki, Zenodo 4940267](https://zenodo.org/records/4940267) | **Core** | Neonatal seizure development/reference selection. CC BY 4.0. Use this version, not a second copy of the earlier release; retain individual expert annotations. |
| [CHB-MIT v1.0.0](https://physionet.org/content/chbmit/1.0.0/) | **Core** | Pediatric seizure references. ODC-By; verify each recording's derivations. Do not reconstruct unavailable referential channels as if measured. |
| [Siena v1.0.0](https://physionet.org/content/siena-scalp-eeg/1.0.0/) | **Core** | Adult seizure references. CC BY 4.0. Keep its epilepsy population separate from ICU patients. |
| [PhysioNet I-CARE v2.1](https://physionet.org/content/i-care/2.1/) | **Conditional core** | Noncommercial adult ICU benchmark/reference selection under CC BY-NC-SA. Preserve a separate license/provenance group; do not release data-derived templates, weights or adaptations without checking the specific artifact's obligations. No need to download its full corpus. |
| [OpenNeuro ds004577 v1.0.1](https://openneuro.org/datasets/ds004577/versions/1.0.1) | **Reserve for developmental release** | Infant developmental comparison; CC0. Not a substitute for neonatal ICU or preterm normative data. |
| Sleep-EDF | **Deferred** | Limited-channel sleep coverage is not on the initial pilot's critical path. |
| SPaRCNet, TUH, MORGOTH, SpikeNet, NCH, CCEMRC original data | **Optional later access** | No application or new agreement in P0. Do not make any of these a dependency of P1/P2. |

Use ACNS documents and public training examples as definition/visual anchors, with links and source locations. Do not publish their figures or ingest protected assessment questions by default. The [access register](EEG_ATLAS_DATA_ACCESS.md) contains exact terms and application links.

### Fallback decisions

- If I-CARE's intended use cannot fit its terms, keep that branch inactive and complete the permissive-data pilot cells. Do not switch to a restricted mirror assuming it is equivalent.
- If no suitable raw LPD/LRDA example is found within the P3 screening cap, retain the terminology/visual reference entry and mark quantitative validation unavailable. Defer that cell's waveform release; do not relax the definition or substitute a different phenotype.
- If SPaRCNet/TUH access is later granted, treat it as a separately governed addition and check cohort overlap before calling it external validation.
- Missing preterm references delay only those validated waveform cells. Preterm vocabulary, PMA/state applicability and required context remain part of P2.
- Unreadable presentation content in P1 gets an explicit gap record and an accessible official alternative where available; do not invent slide contents.

## 3. Eight selected pilot families

These are authoring/validation families, not eight already-labeled clinical cases. Population and labels below are **targets to verify**. Exact numerical definitions and record IDs belong to P2/P3; none are being inferred from a dataset title.

| ID | Target family | Candidate references | Main engineering/teaching question |
|---|---|---|---|
| AT-P01 | Term-neonatal continuous background with graded abnormality | Cork | Can the generator vary organization and voltage while retaining the intended background grade/context? Avoid calling a mildly abnormal HIE record healthy-normal. |
| AT-P02 | Term-neonatal discontinuity versus severe suppression/burst suppression | Cork | Are burst/interburst behavior and voltage realized correctly, with PMA/state context? Include a contrast pair rather than treating all discontinuity as pathology. |
| AT-P03 | Neonatal electrographic seizure and matched nonseizure interval | Helsinki | Are evolution, field and timing correct under neonatal criteria? Keep reviewer disagreement visible. |
| AT-P04 | Pediatric focal seizure and a rhythmic/artifact mimic | CHB-MIT | Can a realistic focal event evolve against a plausible background without a simplistic template cue? A nonseizure label alone does not identify an artifact; Craig must confirm the mimic. |
| AT-P05 | Adult focal seizure and nonseizure comparison | Siena | Does the pipeline support adult parameters and morphology separately from pediatric defaults? |
| AT-P06 | Adult post-arrest slow/low-voltage background versus suppression/burst suppression | I-CARE, conditional | Can measured background properties and temporal variability match eligible ICU references? Clinical outcome labels are not ACNS background labels. |
| AT-P07 | Lateralized periodic discharges with a matched nonperiodic contrast | I-CARE candidate screening; ACNS visual anchors | Are periodicity, morphology and spatial field jointly correct? Raw reference availability is unconfirmed. |
| AT-P08 | Lateralized rhythmic delta activity versus polymorphic focal slowing | I-CARE candidate screening; ACNS visual anchors | Can rhythm be distinguished from slow activity without accidentally creating a seizure or unrelated plus modifier? Raw reference availability is unconfirmed. |

### Bounded pilot sampling target for P3–P6

- First eligibility screen: up to **12 candidate patients per core source**, maximum 60 across five sources. Start with indexes/annotations, then only necessary signal files when that package is authorized.
- Aim for **3 distinct clinical patients per family**, with at most two selected intervals per patient for initial development review. This is a feasibility target, not a validation sample-size calculation or equivalence claim.
- Separately reserve untouched patient IDs before generator tuning, where sufficient records exist. P3 proposes a final split based on actual counts; do not force a fragile percentage split onto sparse families.
- P5 starts with **4 synthetic candidates per active family**: canonical, variation, boundary and negative/contrast. Maximum 32 initial candidates. All are measured; all proposed teaching exemplars receive Craig's review. No candidate is accepted simply because its seed differs.
- Longer episodes must retain enough recording context for the relevant criterion. A display crop is not the entire observation window.
- No false completeness: a family can remain unavailable while other cells proceed. Record the missing population, feature or evidence precisely.

The first two neonatal families may share patients, but those patients must remain in one partition across both families. The same applies to shared I-CARE patients across AT-P06–08. Neither multiple views nor multiple release versions create independent samples.

## 4. Release order

1. **R0: terminology and evidence inventory.** Both terminology tracks, including preterm applicability. Internal documentation; no public site work.
2. **R1: small formative pilot.** Release only pilot cells that pass technical/feature checks and Craig's review, ideally spanning term-neonatal, pediatric and adult examples. Label single-reviewer evidence. Do not wait for an unavailable LPD/LRDA reference to improve the other families.
3. **R2: common ACNS coverage.** Expand non-neonatal backgrounds, sporadic discharges, rhythmic/periodic patterns and modifiers, plus term-neonatal families. Publish a coverage/gap map rather than claim all-age completeness.
4. **R3: developmental breadth and difficult contexts.** Normal infant and preterm PMA/state modules after appropriate reference qualification; uncommon combinations and longitudinal/context-dependent phenomena. Hypsarrhythmia is a companion module with separate evidence.
5. **R4: adaptive practice and independent validation.** Calibrated item families, retention/clinical transfer study, then any supported competency claims. Independent reviewers are required for those broader claims.

All ages remain in the project scope. Reference readiness determines when each waveform cell becomes eligible, not whether its terminology is modeled.

## 5. P1–P3 resource envelope

These are **planning ceilings for later authorized work**, not measured costs, runtime promises, or permission to purchase resources. Reforecast from actual P1 usage before scaling P2. Do not add spend to finish a package silently.

| Package | Hosted input ceiling | Hosted output ceiling | Session allowance | Human review allowance |
|---|---:|---:|---:|---:|
| P1 source register | 20,000 tokens | 5,000 tokens | 2 | Craig: 15 minutes only for unresolved source/version issues |
| P2 terminology/contracts | 65,000 tokens | 16,000 tokens | 4 | Craig: 2 hours across small review batches |
| P3 reference/protocol | 35,000 tokens | 9,000 tokens | 3 | Craig: 2 hours for initial label/eligibility decisions |
| **Total** | **120,000** | **30,000** | **9** | **4 hours 15 minutes** |

Input ceilings include repeated context and tool results where metered; output includes billed reasoning where reported. If the client does not expose accurate usage, report that limitation and use the session ceiling plus provider usage records. Do not present estimates as actual accounting. Token caps apply across parent and any explicitly assigned subagents, not per agent.

- **Hosted routing:** Terra for structured extraction/integration; Luna for bounded consistency checks; Sol for disputed definitions/protocol review only. Reuse the three completed specialist reports. No further panel by default; no Astra subagents.
- **Local work:** deterministic parsing, indexing, integrity checks and later DSP. Local LLM use only after a small checked extraction demonstrates fidelity. Local hardware/model discovery is future execution setup, not performed in P0.
- **Compute:** no paid external compute or GPU training. P1/P2 CPU work only; P3 maximum 4 CPU-hours for screening after data work is authorized. No MORGOTH/SpikeNet installs in P1–P3.
- **Storage:** P1 document assets capped at 500 MB; P3 first raw-data tranche capped at 10 GB with 5 GB scratch allowance. Fetch only selected files. If packaging prevents selective access, record it and revise the plan before exceeding the ceiling. No full I-CARE download.
- **Dollar cost:** no defensible dollar total is set because model route, subscription/API billing and effective prices are unverified. Before any billable API batch, calculate its maximum from the selected provider's current rates and these token ceilings. Purchase/paid-compute authorization remains separate.
- **Stop rule:** stop at a resource ceiling or after two failed revisions of the same bounded task. Preserve partial outputs and report the unresolved requirement; do not mark the package complete or weaken acceptance criteria.

The ceilings buy an initial bounded attempt, not a guarantee that the complete terminology map fits nine sessions. If P2 needs more, its handoff must distinguish complete source coverage, completed contracts and remaining contracts.

## 6. Concrete P1–P3 delivery contracts

### P1 — source register

Inputs: the eight supplied links, official neonatal full-text alternative, selected dataset pages, existing access register. Output: a versioned source/asset manifest and readable gap report; future filenames `EEG_ATLAS_SOURCE_REGISTER.json` and `EEG_ATLAS_SOURCE_REVIEW.md` under `docs/`.

Required fields: source ID/title, URL/DOI/version, retrieval date, local path/hash when fetched, document type, authority, terminology track, population, page/slide count when determinable, access/license evidence, planned use and unresolved issues. Preserve publication assets separately from raw EEG. Raw corpus downloads are outside P1.

Acceptance: all eight supplied links accounted for; inaccessible assets explicitly marked; neonatal authority separated; dataset versions not duplicated as cohorts; source permissions separated from model/code licenses; no clinical thresholds guessed. Return a compact packet for P2. Do not write generator code.

### P2 — terminology/contracts

Inputs: accepted P1 register, master prompt, existing renderer schemas read-only. Output: complete source-section coverage inventory and versioned feature contracts, with the eight pilot families reviewed first. Future artifacts: `EEG_ATLAS_COVERAGE.csv` and `EEG_ATLAS_FEATURE_CONTRACTS.json`.

Acceptance: every source section mapped or explicitly out of scope; required context, units, boundaries, exclusions and duration retained; authoritative definitions separated from engineering choices; unsupported generator features listed. Mark draft/AI-checked/Craig-reviewed separately. Do not call the package complete if full required contracts remain pending. Craig owns clinical disagreements.

### P3 — references and protocol

Inputs: P1/P2 plus the selected public datasets. Output: record-level reference manifest, patient/family partition proposal, pilot measurement/reader protocol and reference gaps. Future artifacts: `EEG_ATLAS_REFERENCE_MANIFEST.csv` and `EEG_ATLAS_PILOT_PROTOCOL.md`.

Acceptance: each selected interval has verified metadata, calibration/channel feasibility, source label versus Craig label, license/provenance and population; repeated patients cannot cross partitions. Document primary metrics, missingness and uncertainty rules. Final equivalence margins/sample size remain a later human-reviewed design, not invented acceptance numbers. No generator tuning against reserved records.

P3 may inspect a bounded clinical subset only when P3 is authorized. Its first pass is metadata selection; retrieve signals only as necessary for eligibility. Website publication, synthetic generation and restricted data access are outside P3.

## 7. Ownership and deferred decisions

| Decision/work | Owner | Timing |
|---|---|---|
| Scope, spending changes, optional institutional applications | Craig | Only when needed by the relevant package |
| Source extraction, manifests, deterministic checks, integration | Assigned agent | P1–P3 |
| Clinical applicability, target labels, ambiguous patterns, teaching eligibility | Craig | P2 onward; approvals recorded separately from AI checks |
| Independent realism/competency claims | Later independent clinicians and educational/statistical reviewers | R4; not an initial dependency |
| Per-artifact redistribution conditions | Integrating agent documents terms; Craig resolves permission requests | Before affected publication |

No outstanding user answer is needed to finish P0. Optional access applications, preterm references, precise statistical margins, and final dollar estimates are assigned future decisions with fallbacks above.

## 8. P0 acceptance and handoff

- Confirmed all-age, staged, public-data/single-reviewer charter: **pass**.
- Selected versioned dataset shortlist and gated-source fallback: **pass**.
- Selected eight pilot families with unverified record availability explicitly identified: **pass**.
- Set release order and bounded P1–P3 resources/stop rules: **pass**.
- Assigned clinical, access and financial decisions: **pass**.
- Implementation, corpus downloads, model installs, external messages and deployment: **none**.

Inputs at P0 start (SHA-256):

| Artifact | Hash |
|---|---|
| EEG_ATLAS_PLAN.md | `48805B0C548A945D068DF38C345274FAA439F11FF2EB3DFB8E3729CDD261B796` |
| EEG_ATLAS_DATA_ACCESS.md | `B8CBCD54454F714C3C2CD953B6CFEB8758D05FB17C0D7A5115AA2A9BEB6B9115` |
| EEG_ATLAS_MASTER_PROMPT.md | `79C0A64BA8619DDC38E80B73A018138050EC684799E6D14E45231673A01B2915` |

Local read-only checks: canonical handoff, source documents, parent task board, file hashes and git status. Vault search returned no focused Atlas P0 record; local project documents provided the current context. P0 used this conversation and local document operations only; no subagents or billed external compute were launched. Exact conversation token cost is unavailable from this runtime.

Canonical coordination remains `../../HANDOFF.md` and the existing parent `../../.tasks/tasks.md`; do not create a second task board inside the Git root.

**Next bounded action: P1 source register, when requested.** Use this charter's P1 scope and budget. P0 completion does not start P1 automatically.
