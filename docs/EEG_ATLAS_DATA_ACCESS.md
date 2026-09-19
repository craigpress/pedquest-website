# EEG Atlas: public datasets, access and permitted use

Checked: 2026-09-15. Planning/access research only; no EEG corpus downloaded, account registered, agreement signed, or request sent.

## Recommended starting set

Start with **Cork neonatal backgrounds, Helsinki neonatal seizures, CHB-MIT, Siena, and the public PhysioNet I-CARE release**. Together these offer neonatal backgrounds/seizures, pediatric epilepsy, adult epilepsy and adult post-arrest ICU recordings. They do not provide exhaustive ACNS labels; Craig's review and targeted annotation are still needed.

For applications, prioritize **BDSP SPaRCNet** for annotated ICU rhythmic/periodic patterns and **TUH** for clinical breadth and artifacts. MORGOTH and SpikeNet are optional evaluator/data access requests. The initial Atlas can proceed without them.

## What “I can access now” means

**Anonymous:** the official service publishes files without a login or signed agreement. I can retrieve these once a download/analysis task is authorized. This is not a claim that the dataset is already stored locally.

**Gated:** the landing page is public, but record access needs Craig's registration, signature, training or approval. No existing private credentials or approvals were verified in this session. I cannot sign agreements or complete training as Craig. After approval, permitted local processing can be automated within the agreement's scope.

Verification: official dataset pages and licenses were inspected. Anonymous HEAD requests returned HTTP 200 for CHB-MIT, Siena and I-CARE record indexes, Cork grade metadata, and one Helsinki EDF endpoint. Zenodo's live API reports `open` and `cc-by-4.0` for records 7477575, 2547147 and 4940267. These are access checks, not full-download/integrity tests. Other anonymous entries below have public file/metadata listings; their full transfer was not tested.

## A. No registration or approval needed

| Dataset / exact resource | Atlas value and limitations | Access now | Rules for use and website publication |
|---|---|---|---|
| **[Cork neonatal EEG graded for background abnormalities](https://zenodo.org/records/7477575)** | 169 one-hour recordings from 53 term neonates with HIE; background grades. Highest-priority neonatal background reference. Not a preterm normative cohort. | **Anonymous; verified**. About 4.4 GB overall. | **CC BY 4.0** per live Zenodo metadata. Analysis, adaptation and redistribution, including attributed clinical trace displays, permitted under that license. Cite dataset/paper, link license and identify transformations. [Metadata](https://zenodo.org/api/records/7477575). |
| **[Helsinki neonatal seizures](https://zenodo.org/records/4940267)**; [earlier supplied record](https://zenodo.org/records/2547147) | Multichannel neonatal EEG with expert seizure annotations; useful for morphology, seizure timing and reviewer disagreement. These records are versions of the same dataset, not independent cohorts. | **Anonymous; verified**. Pin the selected version before use. | **CC BY 4.0** verified in the API for both records. Same attribution/adaptation/display rules as Cork. Preserve expert-specific annotations; do not collapse disagreement without a documented rule. [Metadata](https://zenodo.org/api/records/4940267). |
| **[CHB-MIT scalp EEG v1.0.0](https://physionet.org/content/chbmit/1.0.0/)** | Primarily pediatric epilepsy monitoring with seizure annotations. Useful for seizure variability; not representative of PICU encephalopathy. Channel derivations vary, limiting re-montaging. | **Anonymous; verified**. 42.6 GB full dataset. | **ODC-By 1.0**. Database reuse/adaptation and attributed public outputs are allowed within its scope; retain notices and cite dataset/original paper. ODC-By concerns database rights and does not independently license every separate copyrighted item in the package. |
| **[Siena scalp EEG v1.0.0](https://physionet.org/content/siena-scalp-eeg/1.0.0/)** | Adult epilepsy, 14 patients, seizure timing. Useful adult external comparison; small and epilepsy-selected. | **Anonymous; verified**. 20.3 GB uncompressed. | **CC BY 4.0**. Analysis, adaptations and attributed public traces permitted under the license. Retain calibration and identify crops/filtering/re-montaging. |
| **[I-CARE, PhysioNet v2.1](https://physionet.org/content/i-care/2.1/)** | Adult post-arrest ICU EEG; public challenge training release, 607 patients. Particularly useful for abnormal backgrounds and longer trajectories; not an ACNS feature-by-feature ground-truth atlas. | **Anonymous; verified**. About 1.5 TB; select a small subset later rather than download all. | **CC BY-NC-SA 4.0**. Noncommercial analysis and sharing with attribution; distributed adaptations require the same/compatible license. Suitable for a clearly noncommercial clinical-reference collection under these terms. Keep provenance separate from permissively licensed assets. |
| **[Normal infant resting EEG, OpenNeuro ds004577](https://openneuro.org/datasets/ds004577/versions/1.0.1)** | 103 infants in the first year, 130 recordings. Developmental comparison outside HIE/seizure-selected cohorts. Not a preterm or ICU reference. | **Anonymous public dataset**; repository metadata inspected, full transfer not tested. | **CC0** in [dataset metadata](https://github.com/OpenNeuroDatasets/ds004577/blob/main/dataset_description.json). Broad reuse and redistribution; cite the dataset and listed papers as scholarly practice. [README](https://raw.githubusercontent.com/OpenNeuroDatasets/ds004577/main/README). |
| **[Sleep-EDF Expanded v1.0.0](https://physionet.org/content/sleep-edfx/1.0.0/)** | Sleep-stage/background examples. Limited EEG derivations; unsuitable for validating full scalp topography or neonatal states. | **Anonymous**; public file listing and access policy checked. | **ODC-By 1.0**; attribution/notice requirements as for CHB-MIT. Lower priority than full-montage clinical datasets. |

### License meanings for the Atlas

- **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/):** sharing and adaptation, including commercial use, with credit, license link and modification notice. Do not imply endorsement or impose restrictions incompatible with the license. Separate privacy/third-party rights may remain.
- **[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/):** attribution plus noncommercial use; shared adaptations use the same/compatible license. A free website is not by itself proof of noncommercial purpose. This does not automatically force unrelated website code under share-alike, nor establish that all trained weights or synthetic outputs are adaptations; assess the actual derived artifact before releasing it.
- **[ODC-By 1.0](https://opendatacommons.org/licenses/by/1-0/):** database use, adaptation and sharing with required attribution/notices, including notices for public produced works. It does not clear separate rights in individual content, software or papers.
- **CC0:** no attribution condition under the dedication, but preserve scientific citation and provenance. Check the exact dataset version; OpenNeuro includes older datasets under other licenses too. [OpenNeuro license FAQ](https://docs.openneuro.org/faq).

For public clinical traces, store a visible attribution block with dataset/version/DOI, record and interval, license, and processing changes. A screenshot is still a use of the source data; it is not a workaround for restrictions.

## B. Registration, approval or a signed agreement required

| Resource | Why consider it | Craig's access step | Use/display restrictions |
|---|---|---|---|
| **[SPaRCNet ICU EEG v1.1](https://bdsp.io/content/bdsp-sparcnet/1.1/)** | Best-targeted candidate here for seizure, LPD/GPD and LRDA/GRDA comparisons and expert label distributions. | BDSP account, registered AWS account ID, restricted-access DUA and project request/approval. **Not anonymously accessible to me.** | Noncommercial approved research; no public redistribution of records or record-level derivatives. Ask specifically about synthetic-generator development and release of resulting artifacts. [DUA](https://bdsp.io/content/bdsp-sparcnet/view-dua/1.1/). |
| **[TUH EEG and subsets](https://isip.piconepress.com/projects/nedc/html/tuh_eeg/)** | Broad clinical EEG. Prioritize TUSZ (seizures), TUEV (events/periodic discharges), TUAR (artifacts), TUAB (normal/abnormal). Subsets overlap and older labels need ACNS mapping. | Complete and sign the [editable application PDF](https://isip.piconepress.com/projects/nedc/forms/tuh_eeg.pdf), institutional email/address, send to help@nedcdata.org; then SSH-key registration and rsync instructions. No active access verified. | Current signed form requires citation, **no third-party redistribution**, no reidentification/malicious use, research/technology-development scope, and deletion when finished. Ask permission before public clinical trace excerpts. Landing-page commercialization language does not cancel these conditions. |
| **[MORGOTH data/model v1.0.0](https://bdsp.io/content/morgoth1/1.0.0/)** | Broad automated EEG phenotype comparator; not necessary for initial generation. | **Credentialed** BDSP level: account/AWS ID, DUA, training evidence (CITI Data or Specimens Only Research), application purpose and approval. | Restricted research/data handling, noncommercial scope; public code access is not weight/data access. Verify the weight license and authorized inference/public-output uses separately. [Credentialed DUA](https://bdsp.io/content/morgoth1/view-dua/1.0.0/). |
| **[SpikeNet 2.0 v1.0](https://bdsp.io/content/spikenet2/1.0/)** | Targeted spike detection/localization comparator plus related data. | Current project is **restricted**, not credentialed: account/AWS ID, signed restricted DUA and approval. Current weights are documented under restricted storage. | No public data redistribution; research/noncommercial restrictions. [License](https://bdsp.io/content/spikenet2/view-license/1.0/). License text also mentions maintaining human-subject/HIPAA certification; confirm the applicable training requirement with BDSP even though project access lists only the DUA. |
| **[I-CARE, BDSP v2.0](https://bdsp.io/content/bdsp-icare/2.0/)** | Later release to compare with public PhysioNet version if additional coverage is needed. | Restricted BDSP account/AWS/DUA approval. | This distribution has a **different agreement** from PhysioNet v2.1. Noncommercial approved research and no onward record-level sharing. Do not mix the two versions' permissions or treat them as independent validation cohorts. [DUA](https://www.bdsp.io/content/bdsp-icare/view-dua/2.0/). |
| **[NCH Sleep DataBank v3.1.0](https://physionet.org/content/nch-sleep/3.1.0/)** | Pediatric sleep physiology and developmental state references; PSG rather than full critical-care scalp EEG. | PhysioNet credentialing, CITI Data or Specimens Only Research, signed DUA. Current v3.1.0 is gated; an old version/search snippet can misleadingly appear open. | Restricted data: protect access, no reidentification/sharing; scientific research scope; publish associated research code as required. Public waveform display is not granted by the standard terms. [License](https://physionet.org/content/nch-sleep/view-license/3.1.0/). |
| **[CCEMRC original study data](https://www.acns.org/research/critical-care-eeg-monitoring-research-consortium-ccemrc/ccemrc-public-database)** | Closest potential connection between consensus terminology and clinical examples. | Contact consortium; contributor-site approval case by case. Ask whether raw waveforms and example IDs are available, not just REDCap data. | No blanket public-data license established. Obtain explicit analysis, synthetic-development, excerpt display and redistribution terms. Public database template is not a public waveform corpus. |

### Important BDSP details

The [current access guide](https://bdsp.io/about/howto_accessdata/) requires an AWS account even for its nominally open S3 projects; those are not equivalent to anonymous PhysioNet downloads. Restricted access adds a DUA; credentialed access adds training. The guide describes project-level requests while DUA text describes access-level coverage. Use the dashboard and obtain confirmation rather than assume one approval includes every intended resource.

The [restricted DUA](https://bdsp.io/content/bdsp-sparcnet/view-dua/1.1/) limits approved use, bars public record-level transfer and unapproved third-party platform access, and includes noncommercial restrictions. Accordingly, approval does not automatically permit sending raw EEG, trace images or record-level derivatives to hosted LLMs. State the planned local/hosted workflow in the application. Local models also need to remain inside the permitted access/storage environment.

## C. Sources that remain access/coverage gaps

- **Preterm normal/developmental EEG:** not adequately covered by the neonatal HIE/seizure datasets above. Identify a PMA/state-labeled preterm corpus and verify its record-level license before claiming this gap is filled.
- **Hypsarrhythmia:** the supplied IEEE paper is a feature-method reference; no reusable raw corpus/code release was established in this review. Author inquiry may be needed later.
- **ACNS figures/training slides:** accessible for reading, but that does not establish permission to republish figures or train on embedded recordings. Link to the originals or obtain permission; do not harvest protected self-assessment items.
- **OpenNeuro / iEEG.org generally:** repositories, not a single license or EEG population. Evaluate a named dataset/version. Intracranial recordings cannot substitute for scalp topography validation.

## What Craig should look into first

1. **SPaRCNet/BDSP:** review the DUA against the proposed noncommercial Atlas research and synthetic-generator refinement. Clarify what derived outputs can be published and whether authorized local AI analysis is allowed. Optional MORGOTH/SpikeNet requests can follow in the same access-planning discussion.
2. **TUH:** review/sign the application if its no-redistribution condition fits. Ask separately about attributed short clinical EEG displays on a public teaching site.
3. **CCEMRC:** only if source-matched raw examples remain important after using public corpora. Ask for specific waveform/example linkage and rights, not generic database access.
4. **NCH Sleep:** later, if pediatric sleep-state coverage warrants the credentialing overhead.

Nothing needs to be signed for the anonymous starting set. Future authorized work can begin with a small, version-pinned sample and record-level audit rather than full-corpus downloads.

### Questions to include in a permission inquiry

Describe the project accurately: noncommercial educational Atlas, quantitative clinical-versus-synthetic benchmarking, generator improvement, and original synthetic teaching examples. Ask whether permission includes:

- Local algorithmic analysis and ML evaluation/training, including which users and machines may access data.
- Public display of short attributed clinical traces and downloadable clinical excerpts (separate requests).
- Publication of aggregate statistics, derived feature tables, model weights, generator code and synthetic recordings (each separately).
- Hosted model/cloud processing, if desired; specify providers and what data would leave the approved environment.
- Retention, collaborators, commercial boundaries, and required acknowledgments or review before release.

No inquiries were sent. This register summarizes published terms; any unresolved permission is explicitly marked rather than assumed.
