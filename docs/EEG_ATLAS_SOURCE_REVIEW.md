# EEG Atlas P1 source review

2026-09-15 — **P1 complete with explicit access gaps. P2 not started.**

Machine-readable handoff: [source register](EEG_ATLAS_SOURCE_REGISTER.json). Private document assets: [research source folder](../../research/eeg-atlas/sources). Retrieval/audit scripts and request list are in its parent folder. These are document procurement tools, not generator code.

## Supplied sources

| ID | Source | Verified result | P2 use |
|---|---|---|---|
| S01 | ACNS 2021 | PDF downloaded and parsed: 29 pages | Non-neonatal definition authority |
| S02 | ACNS guideline index | HTML snapshot | Version and companion-source discovery |
| S03 | Supplemental examples | PDF downloaded and parsed: 36 pages | Visual anchors; not raw EEG |
| S04 | Combined training module | PPTX: 153 slides, 106 embedded media files, 117 notes slides | Training reference; slide first-text index in register |
| S05 | Ovid neonatal terminology | Publisher HTML retrieved with substantive text | Companion to S09 official neonatal PDF, 40 pages |
| S06 | Developmental EEG chapter | HTML retrieved | Developmental context; CC BY-NC-SA 4.0 except where indicated |
| S07 | Nature neonatal HIE descriptor | Article HTML retrieved | Cohort/method description; article CC BY 4.0, dataset license separately recorded |
| S08 | IEEE hypsarrhythmia article | Empty direct response; unusable | S21 Crossref metadata verifies identity; full-text method extraction deferred |

All eight original URLs remain in the register. S05/S09 are the same neonatal authority, not independent evidence. The index dates the neonatal guideline to 2012; its journal publication is 2013. Preserve both rather than silently changing the citation year.

## Dataset and license evidence

S10–S14 register the five selected core dataset versions; S15 registers the reserve normal-infant dataset. Only metadata/pages were fetched. The Helsinki selected version is 4940267; the earlier version is not a second cohort. I-CARE here is PhysioNet v2.1, not the differently governed BDSP release. S18–S20 contain license snapshots. Raw data, publication text, code and model-weight permissions remain distinct.

CC BY applies to Cork/Helsinki metadata and Siena; CHB-MIT lists ODC-By; I-CARE lists CC BY-NC-SA; the infant metadata lists CC0. Record-level suitability and third-party exclusions still belong to P3. No new rights to redistribute ACNS materials are inferred from downloading them.

## Gaps and checks

- S08 full text remains unavailable. This companion module does not block ACNS terminology work. Use S21 only for bibliographic identity, not numerical methods.
- Direct PubMed snapshots S16/S17 returned cookie challenges. Their saved bytes are marked unusable; web-reader metadata was available during review. S07 supplies the Nature full text and S21 supplies the IEEE metadata alternative.
- HTTP success alone was insufficient: empty and challenge responses were explicitly rejected as usable content.
- PDF page counts and PPTX ZIP/XML structure were checked. This does not constitute visual review of every page/slide or clinical adjudication. Embedded media have not been interpreted or exported.
- All local source hashes were recomputed and matched; IDs are unique; exactly eight entries are marked user-supplied. Total registered bytes: approximately **42.9 MB**, under the 500 MB ceiling.
- **Zero raw EEG downloads, zero clinical thresholds extracted, zero model installations, zero site changes.**

## Portable handoff

Run `register_sources.py` then `audit_register.py` from `../../research/eeg-atlas/` using the bundled Python with pypdf to refresh retrievals. A refresh changes timestamps/hashes; retain the accepted register before intentionally refreshing. Current register version: `2026-09-15.p1`.

P2 should first use S01/S09 for their separate terminology tracks, then S03/S04 for example linkage and S06 for developmental context. Create the full source-section coverage inventory and pilot-first contracts under the P0 charter. Do not treat the PPTX's first-text index as an authoritative definition extraction.

P1 used one session, no subagents, no external paid compute and no human review time. Exact hosted token/billing totals are not exposed by this runtime. Source registration is complete; clinical review remains pending. **Next: P2 only when requested.**
