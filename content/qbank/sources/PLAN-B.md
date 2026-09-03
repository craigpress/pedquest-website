# PLAN-B — Writer B assignment (PQ-B-001 … PQ-B-025)

Author: Writer B (claude-opus). Planned 2026-09-03.
Blueprint allocation: `clinical_prognosis` ×12, `monitoring_practice` ×6,
`special_populations_pitfalls` ×4, `background_terminology` ×3 (neonatal).

## Verified evidence base (all PMIDs confirmed by PubMed MCP `get_article_metadata` 2026-09-03)

| PMID | Short cite | Population / n | Numbers used |
|---|---|---|---|
| 23164815 | Topjian AA, Crit Care Med 2013;41(1):215-23 | PICU, non-neonatal, n=200 cEEG | seizures 84 (42%); ES 41 (20.5%); ESE 43 (21.5%); died 36 (18%); PCPC worsening 88 (44%); ESE→mortality OR 5.1 (1.4–18) p=0.01; ESE→PCPC worsening OR 17.3 (3.7–80) p<0.001; ES→mortality OR 1.3 (0.3–5.1) p=0.74 |
| 24595203 | Payne ET, Brain 2014;137(Pt 5):1429-38 | PICU+CICU, n=259, median age 2.2 y | seizures 93 (36%); SE 23 (9%); median cVEEG 37 h (IQR 21–56); max hourly seizure burden 15.7 %/h with decline vs 1.8 %/h without (p<0.0001); threshold >20 %/h (12 min) p<0.0001; OR 1.13 (1.05–1.21) per 1 % p=0.0016; no mortality association |
| 24384638 | Wagenman KL, Neurology 2014;82(5):396-404 | PICU, n=300 enrolled; 137 premorbid-normal; 60 followed at median 2.7 y | ES 12 (20%); ESE 14 (23%); ESE→unfavorable GOS-E Peds OR 6.36 p=0.01; PedsQL 23 points lower p=0.001; new epilepsy OR 13.3 p=0.002 |
| 27097270 | Topjian AA, Pediatr Crit Care Med 2016;17(6):547-57 | PICU/CICU post-arrest, no TH, n=128 | normal 4 (3%), slow-disorganized 58 (45%), discontinuous/burst-suppression 24 (19%), attenuated-flat 42 (33%); reactive 46 (36%); seizure 20 (15%); per worse background category death OR 3.63 (2.18–6.0) p<0.001, unfavorable outcome OR 4.38 (2.51–7.17) p=0.001 |
| 27164188 | Ostendorf AP, Pediatr Crit Care Med 2016;17(7):667-76 | non-neonatal post-arrest, n=73 multivariable | arrest <20 min OR continuous background within 12 h of ROSC → good short-term outcome; change in background score over time and data after the first hour not associated with outcome |
| 29438177 | Abend NS, J Clin Neurophysiol 2018;35(3):251-5 | post-arrest, n=89, 453 EEG segments | two factors (background; intermittent); factor scores stable across 12-h epochs to 72 h |
| 20890677 | Kessler SK, Neurocrit Care 2011;14(1):37-43 | children TH after arrest, n=35 | cat 1 continuous+reactive; cat 2 continuous unreactive; cat 3 any discontinuity/burst suppression/absent cerebral activity. During hypothermia cat 2 OR 10.7 p=0.023, cat 3 OR 35 p=0.004; during normothermia cat 2 OR 27 p=0.006, cat 3 OR 18 p=0.02 |
| 32690798 | Fung FW, Neurology 2020;95(11):e1599-608 | prospective PICU, n=719 | ES 184 (26%); <5 % residual ES risk after 6 h (≥1 y, no prior seizures/EEG risks); 1 day (<1 y no risks; ≥1 y with either risk); 2 days (≥1 y both risks; <1 y EEG risks only); 2.5 days (<1 y with prior seizures) |
| 21307352 | Abend NS, Neurology 2011;76(12):1071-7 | prospective PICU, n=100 | ES 46, ESE 19, exclusively nonconvulsive 32; only 52 % of patients with seizures had one in the first hour, 87 % within 24 h; younger age only clinical risk factor (p=0.03) |
| 26057408 | Abend NS, J Clin Neurophysiol 2015;32(6):486-94 | decision-analytic model | 48 h of monitoring is cost-effective if ESE identification/management improves outcome by ≥7 %; 24 h if ≥3 % |
| 25626778 | Herman ST, J Clin Neurophysiol 2015;32(2):87-95 | ACNS consensus, adults+children | recommends cEEG for nonconvulsive seizures/NCSE and treatment assessment; suggests cEEG for ischemia in high-risk patients, for level of consciousness during IV sedation/pharmacologic coma, and for prognostication after cardiac arrest |
| 22146359 | Shellhaas RA, J Clin Neurophysiol 2011;28(6):611-7 | ACNS neonatal cEEG guideline | guideline recommendation itself |
| 39752571 | Wusthoff CJ, J Clin Neurophysiol 2025;42(1):1-11 | ACNS neonatal indications guideline | 18,167 records screened → 217 articles; overall quality of evidence very low; conditional recommendations |
| 23545767 | Tsuchida TN, J Clin Neurophysiol 2013;30(2):161-73 | ACNS neonatal terminology | category definitions only (no numbers quoted) |
| 33475321 | Hirsch LJ, J Clin Neurophysiol 2021;38(1):1-29 | ACNS 2021 terminology | definitions only (suppression <10 µV, attenuation, burst suppression, IIC) |
| 20566612 | Thoresen M, Pediatrics 2010;126(1):e131-9 | CoolCap criteria, n=74, Bayley II at 18 mo | PPV of abnormal aEEG pattern at 3–6 h: 84 % normothermia vs 59 % hypothermia; moderately abnormal voltage at 3–6 h did not predict; recovery time to normal pattern best predictor (96.2 % hypothermia, 90.9 % normothermia); never developing SWC always predicted poor outcome; time to SWC 88.5 % hypothermia vs 63.6 % normothermia; good-outcome infants normalized by 24 h (normothermia) and by 48 h (hypothermia) |
| 20050830 | Hallberg B, Acta Paediatr 2010;99(4):531-6 | n=23 cooled, birth cohort 28,837 | 10/15 infants with burst-suppression-or-worse at 6 h had normal 1-year outcome; only abnormalities persisting at and beyond 24 h had poor outcome; severe abnormalities significantly predictive after 36 h |
| 10375357 | Toet MC, Arch Dis Child Fetal Neonatal Ed 1999;81(1):F19-23 | n=73 asphyxiated term (68 followed ≥12 mo) | FT/CLV/BS/DNV/CNV pattern recognition; BS+FT+CLV for poor outcome: 3 h sens 0.85 spec 0.77 PPV 78 % NPV 84 %; 6 h sens 0.91 spec 0.86 PPV 86 % NPV 91 %; 21/68 (31 %) changed pattern between 3 and 6 h |
| 10353940 | al Naqeeb N, Pediatrics 1999;103(6 Pt 1):1263-71 | n=56 encephalopathy + 14 controls | control upper margin median 37.5 µV (30–48), lower margin 8 µV (6.5–11); normal = upper >10 and lower >5 µV; moderately abnormal = upper >10 and lower ≤5; suppressed = upper <10 and lower <5; κ 0.85 amplitude, 0.76 seizures; overall sens 0.93 spec 0.70 PPV 0.77 NPV 0.90; <12 h subgroup (n=24) sens 1.0 spec 0.82 PPV 0.85 NPV 1 |
| 15687440 | Osredkar D, Pediatrics 2005;115(2):327-32 | n=171 term HIE | SWC in 95.4 % of survivors, 8.1 % of those who died; median time to SWC 7 / 33 / 62 h for HIE grade I / II / III; +30.5 h delay with seizure discharges; Griffiths DQ difference 8.5 points for SWC onset before vs after 36 h; 36-h cutoff classified outcome correctly in 82 % |
| 27595841 | Kharoshankaya L, Dev Med Child Neurol 2016;58(12):1242-8 | n=47 term HIE, cEEG median 57.1 h (IQR 33.5–80.5) | seizures 29/47 (62 %); abnormal outcome 25/47 (53 %); presence of seizures alone p=0.126; total burden >40 min OR 9.56 (2.43–37.67) p=0.001; max hourly burden >13 min/h OR 8.00 (2.06–31.07) p=0.003 |
| 26482675 | Srinivasakumar P, Pediatrics 2015;136(5):e1302-9 | RCT, n=69 ≥36 wk moderate/severe HIE | 35/69 (51 %) had seizures (15 electrographic-treatment arm, 20 clinical arm); excluding SE, median cumulative burden 449 s (IQR 113–2070) vs 2226 s (760–7654), p=0.02; higher burden → higher MRI injury score (p<0.03) and lower Bayley III scores across all 3 domains (p=0.03) |
| 30790268 | Glass HC, Epilepsia 2019;60(3):e20-4 | Neonatal Seizure Registry, n=534 | 66 % had incomplete response to the first loading dose; response did not differ by gestational age, sex, medication or dose |
| 17908764 | Shellhaas RA, Pediatrics 2007;120(4):770-7 | 851 seizures on 125 cEEGs, 34–50 wk CA | ≥1 seizure visible in C3→C4 on 94 % of records; 78 % of individual seizures appeared in C3→C4; neonatologists identified seizures on 22–57 % of records and 12–38 % of individual seizures; detection correlated with duration, amplitude, count/h and reader experience |
| 25957454 | Naim MY, J Thorac Cardiovasc Surg 2015;150(1):169-78 | n=161/172 (94 %) neonates monitored after CPB | ES in 13 (8 %) starting median 20 h after ICU return; EEG-only in 11 (85 %); SE in 8 (62 %); mortality 38 % vs 3 % (p<0.001) |
| 32738224 | Naim MY, Ann Thorac Surg 2021;111(6):2041-8 | multicenter, n=1053 neonates after CPB | ES 7.4 % (78/1053); derivation c-statistic 0.77, validation c-statistic 0.61 with no net benefit between 8 % and 18 % threshold probability; findings support cEEG of all neonates after CPB |
| 32631921 | Sansevere AJ, Neurology 2020;95(10):e1372-80 | n=201 children on ECMO, first 24 h cEEG | severely abnormal background 25/201 (12 %), associated with death (sens 0.23, spec 0.97); ES 33/201 (16 %) at median 3.2 h (IQR 0.6–20.3) after cEEG start; ES always ipsilateral to injury (p=0.006) but present in only ~1/3 of abnormal-imaging cases; right carotid cannulation ↔ right hemisphere, ascending aorta ↔ left hemisphere (OR 0.29, 0.08–0.98, p=0.03) |
| 34387276 | Chahine A, J Clin Neurophysiol 2023;40(4):317-24 | n=73 neonates/children on ECMO | 24-h aEEG background score >17 → unfavorable outcome sens 44 %, spec 97 %, PPV 95 %, NPV 57 %; multivariable HR 6.1 (2.31–16.24) p=0.001; seizures not associated with outcome at discharge |
| 35526326 | Appavu BL, Epilepsy Res 2022;183:106935 | n=61 surviving children with TBI | PTE in 10 (16.4 %); epileptiform discharges OR 8.06 (1.85–35.17); abnormal sleep spindles OR 4.88 (1.18–20.00); early post-traumatic seizures within 7 days OR 7.58 (1.81–39.68); seizures 24–168 h OR 21.47 (4.18–110.38); seizures <24 h not associated; more time in seizure OR 7.28 (2.05–73.14) |
| 36007060 | Appavu BL, J Clin Neurophysiol 2024;41(3):257-64 | n=72 children, 146 seizures in 19 patients | ICP negatively associated with ictal spectral edge frequency (−0.12, 99 % CrI −0.21 to −0.04); heart rate positively associated with peak value frequency (0.16, 0.00–0.31) |
| 36731228 | Benedetti GM, Pediatr Neurol 2023;141:1-8 | survey, 50 respondents / 39 institutions (53 % of 74) | qEEG used in 22/39 (56 %) institutions; 24/26 users (92 %) felt qEEG enhanced care; 22/26 (85 %) named lack of qEEG training as a barrier; training required at 3/22 (14 %); established curriculum at 7/22 (32 %) |
| 36949358 | Benedetti GM, Neurocrit Care 2023;39(3):618-38 | narrative review (member-authored, Press CA) | supporting reference for qEEG roles and sedation/physiologic confounders |
| 37966836 | Variane GFT, JAMA Netw Open 2023;6(11):e2343429 | n=872 cooled neonates, 32 Brazilian hospitals, 3-channel aEEG | ES in 296 (33.9 %); electrographic-only 213/296 (71.9 %); electroclinical uncoupling after a clinical seizure 50 (16.9 %); flat trace → seizures in 58 (68.2 %), OR 12.90 (7.57–22.22) vs CNV; absent SWC OR 2.22 (1.67–2.96); onset 6–24 h of life in 181 (61.1 %); 34 (11.5 %) first seized during rewarming; single ASM controlled 192 (64.9 %); phenobarbital first line in 294 (99.3 %) |
| 31722551 | Duff JP, Circulation 2019;140(24):e904-14 | AHA PALS focused update | reasonable to use TTM 32–34 °C followed by 36–37.5 °C, or TTM 36–37.5 °C, for children comatose after OHCA or IHCA |
| 27500827 | Vaewpanich J, Epilepsy Behav 2016;62:225-30 | n=16 children with TBI on cEEG | seizures in 4 (25 %), 3 subclinical; nonreactive background, severe/burst suppression and absent sleep architecture associated with poor neurocognitive/functional outcome (small cohort — used as supporting only) |

Member authors flagged in `references[].member_author`: Abend NS, Topjian AA, Hahn CD,
Wusthoff CJ, Glass HC, Benedetti GM, Press CA, Sansevere AJ, Loddenkemper T,
Ostendorf AP, Riviello JJ, Kessler SK, Fung FW, Naim MY, Payne ET, Appavu B,
Harrar DB, Shellhaas RA is *not* on the member list and is not flagged.

## Item plan

| ID | Title (working) | Domain | Type | Population / setting | Difficulty | Image kind | Primary anchor |
|---|---|---|---|---|---|---|---|
| PQ-B-001 | aEEG pattern classification: burst suppression vs DNV | background_terminology | multiple_choice | neonate / NICU | introductory | aeeg | Toet 1999 (10375357); Variane 2023 (37966836) |
| PQ-B-002 | aEEG voltage criteria: suppressed vs moderately abnormal margins | background_terminology | multiple_choice | neonate / NICU | introductory | aeeg | al Naqeeb 1999 (10353940) |
| PQ-B-003 | Emergence of sleep–wake cycling and its prognostic weight | background_terminology | multiple_choice | neonate / NICU | intermediate | aeeg | Osredkar 2005 (15687440); Thoresen 2010 (20566612) |
| PQ-B-004 | Attenuated-flat background 12 h after pediatric arrest | clinical_prognosis | multiple_choice | child / PICU | intermediate | composite | Topjian 2016 (27097270) |
| PQ-B-005 | Continuous but unreactive background during targeted temperature management | clinical_prognosis | multiple_choice | child / PICU | advanced | qeeg_panel | Kessler 2011 (20890677); Duff 2019 (31722551) |
| PQ-B-006 | When to assess background after arrest: first 12 h vs serial change | clinical_prognosis | multiple_choice | adolescent / PICU | intermediate | eeg_page | Ostendorf 2016 (27164188); Abend 2018 (29438177) |
| PQ-B-007 | Hourly seizure burden threshold and neurologic decline | clinical_prognosis | multiple_choice | child / PICU | intermediate | qeeg_panel | Payne 2014 (24595203) |
| PQ-B-008 | Electrographic status epilepticus vs isolated seizures and mortality | clinical_prognosis | multiple_choice | child / PICU | intermediate | qeeg_panel | Topjian 2013 (23164815) |
| PQ-B-009 | Counselling a family about long-term risk after ESE | clinical_prognosis | multiple_choice | child / PICU | advanced | qeeg_panel | Wagenman 2014 (24384638) |
| PQ-B-010 | Hypothermia shifts the aEEG prognostic window to 48 h | clinical_prognosis | multiple_choice | neonate / NICU | advanced | aeeg | Thoresen 2010 (20566612); Hallberg 2010 (20050830) |
| PQ-B-011 | Neonatal HIE seizure burden thresholds and outcome | clinical_prognosis | multiple_choice | neonate / NICU | intermediate | aeeg | Kharoshankaya 2016 (27595841) |
| PQ-B-012 | Treating electrographic-only seizures reduces burden in HIE | clinical_prognosis | multiple_choice | neonate / NICU | intermediate | composite | Srinivasakumar 2015 (26482675); Glass 2019 (30790268) |
| PQ-B-013 | Post-CPB neonatal seizure onset — point to the first seizure | clinical_prognosis | point_to_feature | neonate / CICU | intermediate | qeeg_panel | Naim 2015 (25957454) |
| PQ-B-014 | aEEG background at 24 h of ECMO and outcome | clinical_prognosis | multiple_choice | child / ECMO | advanced | aeeg | Chahine 2021 (34387276); Sansevere 2020 (32631921) |
| PQ-B-015 | Early post-traumatic seizures and later epilepsy risk | clinical_prognosis | multiple_choice | child / PICU | advanced | qeeg_panel | Appavu 2022 (35526326) |
| PQ-B-016 | How long to monitor: risk-stratified cEEG duration | monitoring_practice | multiple_choice | child / PICU | introductory | qeeg_panel | Fung 2020 (32690798) |
| PQ-B-017 | Time to first electrographic seizure — point to it | monitoring_practice | point_to_feature | child / PICU | introductory | qeeg_panel | Abend 2011 (21307352) |
| PQ-B-018 | ACNS indication for cEEG in unexplained encephalopathy | monitoring_practice | multiple_choice | child / PICU | introductory | eeg_page | Herman 2015 (25626778) |
| PQ-B-019 | Should every neonate get cEEG after cardiopulmonary bypass? | monitoring_practice | multiple_choice | neonate / CICU | introductory | qeeg_panel | Naim 2020 (32738224); Shellhaas 2011 (22146359) |
| PQ-B-020 | Escalating from two-channel aEEG to full-array cEEG | monitoring_practice | multiple_choice | neonate / NICU | intermediate | aeeg | Shellhaas 2007 (17908764); Wusthoff 2025 (39752571) |
| PQ-B-021 | Documenting and communicating a qEEG review | monitoring_practice | multiple_choice | child / PICU | introductory | qeeg_panel | Benedetti 2023 (36731228) |
| PQ-B-022 | ECMO: pump artifact and cannulation-side injury — point to the seizure | special_populations_pitfalls | point_to_feature | child / ECMO | intermediate | composite | Sansevere 2020 (32631921) |
| PQ-B-023 | Seizures during rewarming in a cooled neonate | special_populations_pitfalls | multiple_choice | neonate / NICU | introductory | aeeg | Variane 2023 (37966836) |
| PQ-B-024 | Sedation bolus vs worsening injury — point to the sedation effect | special_populations_pitfalls | point_to_feature | child / PICU | advanced | qeeg_panel | Herman 2015 (25626778); Benedetti 2023 (36949358) |
| PQ-B-025 | Post-ictal attenuation after prolonged status epilepticus | special_populations_pitfalls | multiple_choice | child / PICU | intermediate | composite | Payne 2014 (24595203); Hirsch 2021 (33475321) |

## Blueprint compliance check

- Domains: clinical_prognosis 12 (004–015), monitoring_practice 6 (016–021),
  special_populations_pitfalls 4 (022–025), background_terminology 3 (001–003). ✔
- `point_to_feature`: 4 items (013, 017, 022, 024) ≥ 3. ✔
- Neonatal population: 10 items (001, 002, 003, 010, 011, 012, 013, 019, 020, 023) ≥ 7. ✔
- PICU cardiac arrest: 3 (004, 005, 006). Status epilepticus / seizure burden: 5
  (007, 008, 009, 011, 025). ECMO: 2 (014, 022). TBI: 1 (015).
  Post-cardiac-surgery: 2 (013, 019). ✔
- Difficulty: introductory 8 (32 %), intermediate 11 (44 %), advanced 6 (24 %). ✔
- Image kinds: `aeeg` 8, `qeeg_panel` 11, `eeg_page` 2, `composite` 4 — each ≥ 2. ✔

## Standing judgment calls

1. **No unverifiable numbers.** Every percentage, odds ratio and cutoff in a stem or
   explanation is taken from the table above and is quoted with its population.
   Where a source reports a range across readers or recordings (Shellhaas 2007,
   Toet 1999) the range is reproduced rather than a midpoint.
2. **ACNS documents.** For 23545767, 33475321, 22146359 and 39752571 only the
   *definitions and recommendations themselves* are used; no numeric thresholds are
   attributed to them because the full text is not open access and could not be read.
   The one exception is 39752571, whose abstract states the search yield (18,167 →
   217) and the very-low quality-of-evidence grading.
3. **Adult data.** No item in this block relies on adult-only evidence, so no
   "adult data" caveat is needed. Where pediatric evidence is single-center or small
   (Kessler 2011 n=35, Vaewpanich 2016 n=16, Chahine 2021 n=73) the explanation says so.
4. **Open access.** `open_access` is filled from `get_copyright_status`. Only
   37966836 returned an explicit open licence (CC BY 4.0 → `cc-by`). Items whose
   copyright statement asserted all rights reserved are recorded `none`; items where
   PubMed/PMC returned no copyright metadata are recorded `unknown`. Presence of a
   PMC author manuscript is **not** treated as evidence of an open licence.
5. **Images.** Every image is `synthetic-original`, rendered from the spec in the
   YAML. No published figure is described, traced or paraphrased for redrawing.
   Seed values are arbitrary integers derived from the item number, not from any
   dataset record identifier.
6. **Vignettes.** All composites. No initials, dates, MRNs, hospitals or
   identifiable combinations; ages in rounded units.
7. **`point_to_feature` items** carry `options: []` (the schema permits `minItems: 0`)
   because the learner clicks a region rather than choosing among distractors; the
   teaching contrast is instead carried by a labelled distractor feature in the
   image spec and by the explanation.
