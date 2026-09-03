# Writer A — plan for PQ-A-001 … PQ-A-025

Assignment (BLUEPRINT.md): `foundations` ×10, `seizure_detection` ×10,
`background_terminology` ×5 (pediatric/child focus; Writer B covers neonatal
aEEG classification). ≥5 `point_to_feature`; ≥5 neonatal/infant; every image
kind ≥2×; difficulty ≈30/45/25 %; all four `bloom` levels.

## Targets vs plan

| Constraint | Target | Planned |
|---|---|---|
| foundations | 10 | 10 (001–010) |
| seizure_detection | 10 | 10 (011–020) |
| background_terminology | 5 | 5 (021–025) |
| point_to_feature | ≥5 | 5 (007, 011, 014, 018, 023) |
| neonate or infant | ≥5 | 6 (001, 006, 009, 016, 017, 018) |
| difficulty intro/inter/adv | 30/45/25 % | 8 / 11 / 6 = 32/44/24 % |
| bloom coverage | all 4 | recall 4, interpretation 8, application 5, analysis 8 |
| image kinds ≥2× each | 4 kinds | qeeg_panel 15, aeeg 4, eeg_page 3, composite 3 |

## Item table

| ID | Title (working) | Domain | Type | Population | Setting | Diff | Bloom | Image | Primary evidence (PMID) |
|---|---|---|---|---|---|---|---|---|---|
| 001 | aEEG y-axis: linear 0–10 µV then log 10–100 µV | foundations | MC | neonate | NICU | intro | interpretation | aeeg | 36949358, 17067863 |
| 002 | Axes and color scale of the FFT spectrogram / CDSA | foundations | MC | child | PICU | intro | recall | qeeg_panel | 36949358, 15592009 |
| 003 | Computing the suppression ratio during pentobarbital titration | foundations | MC | child | PICU | inter | application | qeeg_panel | 36949358 |
| 004 | Sign convention of the relative asymmetry index | foundations | MC | adolescent | PICU | intro | interpretation | qeeg_panel | 36949358 |
| 005 | What the rhythmicity spectrogram measures — and its non-ictal hits | foundations | MC | child | PICU | inter | analysis | composite | 36949358, 29414138 |
| 006 | Why a right frontal neonatal seizure is absent from a C3–C4 aEEG | foundations | MC | neonate | NICU | inter | analysis | aeeg | 17908764, 19782640 |
| 007 | PTF: locate the pentobarbital effect on the suppression-ratio panel | foundations | PTF | child | PICU | intro | interpretation | qeeg_panel | 36949358 |
| 008 | Notch filter and artifact reduction: what they do and do not remove | foundations | MC | adolescent | PICU | inter | application | eeg_page | 36949358 |
| 009 | Envelope trend vs aEEG on the same panel | foundations | MC | infant | CICU | intro | recall | qeeg_panel | 36949358 |
| 010 | Why sedation drops total power but spares the alpha–delta ratio | foundations | MC | adolescent | PICU | adv | analysis | qeeg_panel | 36949358, 33417384 |
| 011 | PTF: click seizure onset on the left rhythmicity panel | seizure_detection | PTF | child | PICU | inter | interpretation | qeeg_panel | 20861452, 34510096 |
| 012 | The "solid flame" of a seizure on the FFT spectrogram | seizure_detection | MC | child | PICU | intro | recall | qeeg_panel | 36949358, 34510096 |
| 013 | Which spectrogram is most sensitive for a focal seizure | seizure_detection | MC | adolescent | EMU | inter | application | qeeg_panel | 29414138 |
| 014 | PTF: click the electrode chain where the seizure begins | seizure_detection | PTF | child | PICU | inter | interpretation | eeg_page | 32205601 |
| 015 | Recognizing cyclic seizures on a 12-hour panel | seizure_detection | MC | child | PICU | inter | analysis | qeeg_panel | 21307352, 34510096 |
| 016 | How many neonatal seizures a single-channel aEEG misses | seizure_detection | MC | neonate | NICU | adv | analysis | aeeg | 17908764, 26456517 |
| 017 | Multichannel vs single-channel neonatal aEEG | seizure_detection | MC | neonate | NICU | inter | application | aeeg | 19782640 |
| 018 | PTF: chest physiotherapy artifact vs the real seizure | seizure_detection | PTF | infant | PICU | inter | interpretation | qeeg_panel | 36949358, 20861452 |
| 019 | What a negative bedside trend screen excludes after cardiac arrest | seizure_detection | MC | child | PICU | adv | analysis | composite | 25651050, 28234810 |
| 020 | Trading detector sensitivity against false alarms | seizure_detection | MC | child | PICU | adv | analysis | qeeg_panel | 32205601, 30188384 |
| 021 | ACNS continuity categories and their trend correlates | background_terminology | MC | child | PICU | intro | recall | composite | 33475321 |
| 022 | ACNS burst suppression and the suppression-ratio correlate | background_terminology | MC | child | PICU | inter | interpretation | qeeg_panel | 33475321, 36949358 |
| 023 | PTF: click the abrupt diffuse attenuation | background_terminology | PTF | child | PICU | adv | interpretation | qeeg_panel | 33475321, 36949358 |
| 024 | LRDA, GPDs and the ictal–interictal continuum on trends | background_terminology | MC | adolescent | PICU | adv | analysis | eeg_page | 33475321, 36949358 |
| 025 | Testing reactivity and reading it off the trend panel | background_terminology | MC | child | PICU | intro | application | qeeg_panel | 33475321, 25626778 |

## Verified evidence pool (all confirmed by `pubmed-mcp get_article_metadata` 2026-09-03)

| PMID | Short citation | Population | Members |
|---|---|---|---|
| 33475321 | Hirsch LJ et al. ACNS Standardized Critical Care EEG Terminology: 2021 Version. J Clin Neurophysiol 2021;38(1):1-29 | adults + children | Abend, Wusthoff, Hahn |
| 23545767 | Tsuchida TN et al. ACNS standardized neonatal EEG terminology. J Clin Neurophysiol 2013;30(2):161-73 | neonates | Tsuchida, Wusthoff, Shellhaas, Abend, Hahn, Riviello |
| 22146359 | Shellhaas RA et al. ACNS guideline on cEEG in neonates. J Clin Neurophysiol 2011;28(6):611-7 | neonates | Shellhaas, Tsuchida, Riviello, Abend, Wusthoff |
| 25626778 | Herman ST et al. Consensus statement on cEEG, part I: indications. J Clin Neurophysiol 2015;32(2):87-95 | adults + children | Abend, Hahn, Riviello, Tsuchida |
| 36949358 | Benedetti GM, Guerriero RM, Press CA. Noninvasive neuromonitoring II: EEG, qEEG. Neurocrit Care 2023;39(3):618-38 | children | Benedetti, Press |
| 36731228 | Benedetti GM et al. Spectrum of qEEG utilization across North America. Pediatr Neurol 2023;141:1-8 | survey | Benedetti, Sansevere, Harrar, Wainwright, Press |
| 20861452 | Stewart CP et al. Seizure identification in the ICU using quantitative EEG displays. Neurology 2010;75(17):1501-8 | PICU, 27 recordings | Hahn |
| 23912575 | Pensirikul AD et al. Density spectral array for seizure identification in critically ill children. J Clin Neurophysiol 2013;30(4):371-5 | PICU, 21 children | Kessler, Topjian, Abend |
| 30188384 | Lalgudi Ganesan S et al. Seizure identification by critical care providers using qEEG. Crit Care Med 2018;46(12):e1105-11 | PICU, 27 recordings | Hahn |
| 32205601 | Din F et al. Seizure detection algorithms in critically ill children. Crit Care Med 2020;48(4):545-52 | PICU, 19 recordings | Hahn |
| 34510096 | Lalgudi Ganesan S, Hahn CD. Spectrograms for seizure detection in critically ill children. J Clin Neurophysiol 2022;39(3):195-206 | children (review) | Hahn |
| 25651050 | Topjian AA et al. Detection of electrographic seizures by critical care providers using CDSA. Pediatr Crit Care Med 2015;16(5):461-7 | post-arrest children | Topjian, Abend |
| 28234810 | Du Pont-Thibodeau G et al. Seizure detection using aEEG and CDSA in pediatric cardiac arrest. Pediatr Crit Care Med 2017;18(4):363-9 | post-arrest children | Topjian, Abend |
| 21307352 | Abend NS et al. Nonconvulsive seizures are common in critically ill children. Neurology 2011;76(12):1071-7 | PICU, 100 children | Abend, Topjian |
| 32077099 | Fung FW et al. Development of a model to predict electrographic seizures. Epilepsia 2020;61(3):498-508 | PICU, 719 children | Fung, Topjian, Abend |
| 17908764 | Shellhaas RA et al. Sensitivity of aEEG for neonatal seizure detection. Pediatrics 2007;120(4):770-7 | 125 neonatal EEGs, 851 seizures | Shellhaas |
| 19782640 | Bourez-Swart MD et al. Multichannel aEEG in full-term neonates. Clin Neurophysiol 2009;120(11):1916-22 | 12 term HIE neonates | — |
| 26456517 | Rakshasbhuvankar A et al. aEEG for detection of neonatal seizures: systematic review. Seizure 2015;33:90-8 | 10 studies, n = 433 | — |
| 10353940 | al Naqeeb N et al. Assessment of neonatal encephalopathy by aEEG. Pediatrics 1999;103(6 Pt 1):1263-71 | 56 encephalopathic + 14 healthy | — |
| 17067863 | Hellström-Westas L, Rosén I. Continuous brain-function monitoring. Semin Fetal Neonatal Med 2006;11(6):503-11 | neonates (review) | — |
| 29414138 | Goenka A, Boro A, Yozawitz E. Comparative sensitivity of qEEG spectrograms. Seizure 2018;55:70-5 | 562 seizures, ages 5–64 y | — |
| 26241242 | Swisher CB et al. Diagnostic accuracy of seizure detection using a qEEG panel. J Clin Neurophysiol 2015;32(4):324-30 | **adult** ICU, 45 patients | — |
| 15592009 | Scheuer ML, Wilson SB. Data analysis for cEEG in the ICU. J Clin Neurophysiol 2004;21(5):353-78 | ICU (review) | — |
| 33417384 | Appavu BL et al. qEEG after pediatric anterior circulation stroke. J Clin Neurophysiol 2022;39(7):610-5 | 11 children | Appavu |
| 30528098 | Sansevere AJ, Hahn CD, Abend NS. Conventional and quantitative EEG in status epilepticus. Seizure 2018;68:38-45 | children (review) | Sansevere, Hahn, Abend |

## Judgment calls made up front

1. **Open access** — `get_copyright_status` returned no license metadata for most
   of these (PubMed/PMC simply do not carry it). Recorded as `unknown` unless an
   explicit all-rights-reserved statement came back, in which case `none`.
   A PMC identifier alone was **not** treated as evidence of an open licence.
2. **Adult evidence is labelled.** Swisher 2015 is adult ICU and is always
   introduced as such in the explanation, never used as the sole primary.
3. **Goenka 2018** enrolled ages 5–64 y (mean 36 y); it is described as a
   mixed-age cohort, not a pediatric study.
4. **Stewart 2010 (PMID 20861452)** is used as a primary reference in at most
   two items (011 and 018), per the assignment.
5. **Vendor names** appear only where the teaching point is vendor-specific
   (rhythmicity spectrogram, seizure-detection algorithms) and are cited.
6. **No figure is described for redrawing.** Every image comes from an original
   `image.spec` with `license: synthetic-original`.

## Post-authoring notes for the editor and renderer team

1. **Asymmetry-index axis range.** `IMAGE_SPEC.md` sets a renderer default of
   -50 to +50 % for `asymmetry_index`. PQ-A-004 and PQ-A-010 override it to
   -100 to +100 % in `spec.style`, because that is the published convention the
   items test (Benedetti 2023). Either honour the override or change the default.
2. **`rhythmic_pattern` event type.** PQ-A-024 needs an ACNS rhythmic/periodic
   pattern (LRDA at 1.5 Hz with fluctuation) that is explicitly *not* a seizure.
   `IMAGE_SPEC.md` has no `events[]` type for RPPs. The item uses
   `type: rhythmic_pattern` with `pattern`, `side`, `frequency_hz`,
   `run_duration_s`, `modifier`, `evolution` and `plus_modifier`. Please add it
   to the vocabulary or advise an alternative encoding.
3. **Panel names used beyond the IMAGE_SPEC list.** `envelope_L` / `envelope_R`
   (PQ-A-009, 012, 023, 025), `total_power_L` / `total_power_R` and
   `alpha_delta_ratio_L` / `alpha_delta_ratio_R` (PQ-A-010). All three trends are
   described in Benedetti 2023; the panel list in IMAGE_SPEC.md does not yet
   include them.
4. **`style` blocks.** Every item carries a `spec.style` block naming axis ranges,
   colour bars, thresholds and (for PQ-A-013) `panel_labels: hidden`. These are
   load-bearing for the answer in several items, not cosmetic.
5. **Reference-count concentration.** PMID 36949358 (Benedetti/Guerriero/Press
   2023) appears in 17 of 25 items. It is the only pediatric source that defines
   every trend technically, so it is the correct primary for the `foundations`
   block; it is `supporting` wherever a study with numbers is the real evidence.
6. **Stewart 2010 (PMID 20861452)** is primary in exactly two items, PQ-A-011 and
   PQ-A-018, per the assignment cap.
