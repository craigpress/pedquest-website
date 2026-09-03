# Question Bank Blueprint — v1 (initial 50 items)

Domain codes are used in `question.domain`. Counts are targets for the first
50-item library; the sustaining pipeline uses this table to pick topics with
the lowest coverage.

| Code | Domain | Target | Writer | Scope (learning objectives) |
|---|---|---|---|---|
| `foundations` | How qEEG trends are generated and displayed | 10 | A | FFT spectrogram/CDSA (power vs frequency vs time, color scale), aEEG (rectification, envelope, semilog display), asymmetry index & relative asymmetry spectrogram (formula, sign convention), rhythmicity spectrogram, suppression ratio (definition, threshold), seizure-probability trend; effects of montage/reference, filters, sensitivity and time compression; how artifacts propagate into each trend. |
| `seizure_detection` | Recognizing seizures and mimics on trends | 10 | A | Ictal signatures on each trend (evolving rhythmicity band, "flame"/arch on spectrogram, rising aEEG margin, asymmetry deflection); cyclic seizures; brief/low-amplitude seizures that trends miss; mimics (chewing/EMG, patting, chest PT, ventilator, ECMO pump, electrode pop, state change, sedation bolus); published pediatric performance of qEEG screening (sensitivity/specificity/false-alarm rates by reader type and trend combination); neonatal single-/dual-channel aEEG detection limits and automated algorithms. |
| `background_terminology` | ACNS terminology applied to trends | 8 | A (5) + B (3, neonatal) | ACNS 2021 critical-care EEG terminology (continuity, voltage, burst suppression, reactivity, IIC, RDA/PDs/SW) and how each looks on trends; ACNS neonatal terminology background categories; aEEG pattern classification (CNV, DNV, BS, CLV, FT) and sleep–wake cycling; trend correlates of discontinuity and burst suppression. |
| `clinical_prognosis` | Clinical application and outcome evidence | 12 | B | Pediatric cardiac arrest: EEG background categories and outcome, timing of assessment, hypothermia effects; neonatal HIE: aEEG pattern and time-to-normal-trace prognostics under therapeutic hypothermia; electrographic status epilepticus / seizure burden thresholds and mortality or neurologic outcome; TBI and ECMO monitoring findings; post-cardiac-surgery seizures; asymmetry in focal ischemia/stroke; neonatal seizure burden and outcome. |
| `monitoring_practice` | Indications, duration, workflow | 6 | B | ACNS consensus indications for cEEG in critically ill children/neonates; time-to-first-seizure data and recommended monitoring duration; who reads qEEG (trainee/nurse/technologist accuracy studies); page-by-page vs trend-first review; alarm thresholds and workflow; documentation and communication with the bedside team. |
| `special_populations_pitfalls` | Confounders and pitfalls | 4 | B | Sedative/anesthetic effects (propofol, dexmedetomidine, pentobarbital burst-suppression targeting); hypothermia/rewarming; ECMO cannulation and pump artifact; skull defect/breach; medication-induced patterns; post-ictal vs sedation attenuation; DKA/cerebral edema. |

**Question types:** ≥ 42 `multiple_choice`, ≥ 8 `point_to_feature`
(spread across A and B, mostly in `seizure_detection` and
`background_terminology`).

**Populations:** ≥ 12 neonatal (NICU) items overall; the rest infant→adolescent.

**Difficulty mix (target):** 30 % introductory, 45 % intermediate, 25 % advanced.

## ID scheme

`PQ-<Writer>-<NNN>` (e.g., `PQ-A-007`). One YAML file per ID under
`questions/`. IDs are permanent; never renumber.

## Evidence anchors writers should consider (verify each PMID before use)

These are *suggested starting points*, not a citation list. Confirm every
PMID by lookup and prefer the primary paper over reviews when a number is quoted.

- ACNS Standardized Critical Care EEG Terminology 2021 (Hirsch LJ et al., J Clin Neurophysiol 2021).
- ACNS neonatal EEG terminology (Tsuchida TN et al., J Clin Neurophysiol 2013) and ACNS neonatal cEEG guideline (Shellhaas RA et al., 2011).
- ACNS consensus statement on cEEG in critically ill adults and children (Herman ST et al., J Clin Neurophysiol 2015, parts I and II).
- Pediatric qEEG seizure identification studies: Stewart CP et al. (Neurology 2010); Pensirikul AD et al. (J Clin Neurophysiol 2013); Topjian AA et al. (Neurocrit Care 2015); Akman CI et al. (Epilepsy Res 2011); Lalgudi Ganesan S et al. (Pediatr Crit Care Med 2018 / Epilepsia); Du Pont-Thibodeau G et al. (J Clin Neurophysiol 2017); Sansevere AJ et al.
- Seizure burden and outcome: Payne ET et al. (Brain 2014); Topjian AA et al. (Crit Care Med 2013); Wagenman KL et al. (Neurology 2014); Abend NS et al. (Neurology 2013 / Crit Care Med); Lambrechtsen FA & Buchhalter JR (Epilepsia 2008).
- Time to first seizure / monitoring duration: Abend NS et al. (Neurology 2011); Shellhaas RA (neonatal).
- Cardiac arrest prognostication: Topjian AA et al. (Pediatr Crit Care Med 2016); Ostendorf AP et al. (Pediatr Crit Care Med 2016); Fung FW et al. (2019); Ducharme-Crevier L et al.; Kessler SK et al. (Neurocrit Care 2011).
- Neonatal HIE aEEG: Thoresen M et al. (Pediatrics 2010); Hallberg B et al. (Acta Paediatr 2010); Hellström-Westas L et al. (aEEG classification); al Naqeeb N et al. (Pediatrics 1999).
- Neonatal seizure detection: Shellhaas RA et al. (Pediatrics 2007, aEEG sensitivity); Stevenson NJ et al. (Sci Data 2019 Helsinki dataset); Shah DK et al.
- Post-cardiac-surgery: Naim MY et al. (J Thorac Cardiovasc Surg 2015).
- TBI/ECMO/ICU cohorts by PedQuEST members (Appavu B; Sansevere AJ; Harrar DB; Press CA; Benedetti GM; Hahn CD; Wusthoff CJ; Glass HC). Search the EndNote library and PubMed by author.
