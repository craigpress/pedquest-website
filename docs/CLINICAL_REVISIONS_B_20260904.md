# B-series clinical revisions — 2026-09-04

Scope: `PQ-B-001` through `PQ-B-025`. All remain draft; no expert approval or publication state was added. Current verified renderer 0.3.0 image specifications and captions were preserved. The revisions distinguish observed cohort associations from individual prognosis or causality, identify denominators/endpoints/time points, and align text with the repaired images.

| Item | Clinical/content change | Main supporting source(s) | Remaining limitation |
|---|---|---|---|
| B-001 | Qualified early severe-background outcome data as pre-cooling cohort evidence. | Toet 1999, PMID 10375357 | Historical cohort does not predict an individual cooled infant. |
| B-002 | Separated al Naqeeb amplitude criteria from five-pattern terminology. | al Naqeeb 1999, PMID 10353940 | Synthetic trace still requires expert morphology review. |
| B-003 | Reframed 8.5-point DQ result as a historical group median; preserved corrected cycling description. | Osredkar 2005, PMID 15687440 | Observational group result is not an individual forecast. |
| B-004 | Named the 2016 cohort and required serial multimodal prognostication. | Topjian 2016, PMID 27097270; 2025 AHA/AAP, PMID 41122885 | Early EEG association is not determinative. |
| B-005 | Converted OR 10.7 to a cohort critical-appraisal question; stated absent reactivity alone is insufficient. | Kessler 2011, PMID 20890677; 2025 AHA/AAP, PMID 41122885 | Single-center n=35; OR is not absolute probability. |
| B-006 | Removed the claim that later EEG trajectory is generally uninformative. | Ostendorf 2016, PMID 27164188; Abend 2018, PMID 29438177 | Retrospective null result does not prove no trajectory value. |
| B-007 | Labeled 12 min/h as an observational inflection and potential target. | Payne 2014, PMID 24595203 | No causal treatment deadline was tested. |
| B-008 | Preserved status classification while qualifying mortality association by cohort and etiology. | Topjian 2013, PMID 23164815 | Association does not establish causation. |
| B-009 | Asked for the adjusted cohort association and explained follow-up/selection limits. | Wagenman 2014, PMID 24384638 | Only 60/137 eligible children followed; OR is not absolute risk. |
| B-010 | Replaced a universal 48-hour deadline with serial reassessment language. | Thoresen 2010, PMID 20566612; Hallberg 2010, PMID 20050830 | Cohort timing does not define a universal cutoff. |
| B-011 | Preserved 13 min/h and 40-minute cohort thresholds but removed causal treatment framing. | Kharoshankaya 2016, PMID 27595841 | Small observational mixed-era cohort. |
| B-012 | Replaced “expect first load to fail” with registry-specific incomplete response and EEG-guided reassessment. | Srinivasakumar 2015, PMID 26482675; Glass 2019, PMID 30790268 | Treatment choice remains patient-specific. |
| B-013 | Identified 20 hours as a cohort median rather than a highest-yield boundary. | Naim 2015, PMID 25957454 | Small number of seizure-positive infants. |
| B-014 | Tied test characteristics to the study threshold and expert artifact assessment; retained pump-contamination caveat. | Chahine 2023, PMID 34387276 | Low sensitivity; specificity is not individual certainty. |
| B-015 | Reframed as the association observed in the 61-child cohort and noted lack of a formal subgroup contrast. | Appavu 2022, PMID 35526326 | Wide confidence intervals and small subgroup counts. |
| B-016 | Made the 6-hour value explicitly model-derived and contingent on expert raw review and clinical context. | Fung 2020, PMID 32690798 | Model does not independently authorize stopping monitoring. |
| B-017 | Corrected the 52% denominator to seizure-positive patients. | Abend 2011, PMID 21307352 | Detection timing does not directly give post-test risk for one child. |
| B-018 | Changed definite NCSE to possible NCSE; a 15-second seizure does not establish status duration/burden. | Herman 2015, PMID 25626778; ACNS 2021, PMID 33475321 | Continuous record and electroclinical correlation are required. |
| B-019 | Restricted the conclusion to the externally validated model rather than all current scores. | Naim 2021, PMID 32738224 | Monitoring policy also depends on current guidance and resources. |
| B-020 | Replaced categorical “cannot resolve anything” language with limited spatial coverage/diagnostic uncertainty. | Shellhaas 2007, PMID 17908764; ACNS neonatal guideline 2025, PMID 39752571 | aEEG performance varies by seizure and reader. |
| B-021 | Kept the exact survey denominator and separated reported barrier prevalence from intervention effectiveness. | Benedetti 2023, PMID 36731228 | Cross-sectional survey cannot rank causal interventions. |
| B-022 | Aligned the explanation with the repaired ictal raw page at minute 180.5 and the elevated heuristic detector trace. | Sansevere 2020, PMID 32631921 | Synthetic detector is not a validated commercial algorithm. |
| B-023 | Made 34/296 seizure-positive infants explicit and preserved corrected bilateral rewarming image description. | Variane 2023, PMID 37966836 | 11.5% is not the rate among all cooled infants. |
| B-024 | Replaced exclusive pharmacologic attribution with a supported contribution requiring clinical correlation. | Herman 2015, PMID 25626778; Benedetti 2023, PMID 36949358 | Bilaterality/timing do not exclude global injury or metabolic causes. |
| B-025 | Reconciled production v3 text with the current verified image: flat SR means continuous low voltage; answer now permits lorazepam and post-ictal contributions and does not exclude other causes. | ACNS 2021, PMID 33475321; Payne 2014, PMID 24595203 | Simultaneous seizure offset and lorazepam prevent causal separation. |

## B-025 production reconciliation

Production contained version 3 with a 55%/40-minute attenuation specification and sidecar hash `d4828816...`; the current locally verified renderer 0.3.0 source uses the subsequently repaired 65%/55-minute specification. The current image/spec was retained. Valid production v3 text about a flat suppression ratio and continuous low voltage was merged, then revised to remove unsupported exclusive post-ictal attribution. File version remains 3 so import logic can advance from the production revision.

## Verification

- `npm run qbank:validate -- --skip-pmid`: 51/51 files valid, zero warnings or failures.
- `git diff --check`: no whitespace errors.
- Targeted quantitative claims were checked against the primary abstracts or indexed primary full text, rather than PMID resolution alone:
  - [B-003 Osredkar](https://pubmed.ncbi.nlm.nih.gov/15687440/): 171 infants; SWC in 95.4% of survivors and 8.1% of deaths; grade medians 7/33/62 hours; 30.5-hour delay with seizures; median DQ difference 8.5; 82% classification at 36 hours.
  - [B-004 Topjian](https://pubmed.ncbi.nlm.nih.gov/27097270/): 128 non-cooled children; background counts 4/58/24/42; reactivity 46; seizures 20; adjusted OR 3.63 for death and 4.38 for unfavorable discharge outcome per worse category.
  - [B-005 Kessler](https://pubmed.ncbi.nlm.nih.gov/20890677/): prospective 35-child cohort; PCPC 4–6 at discharge; hypothermia ORs 10.7 and 35 and normothermia ORs 27 and 18 for categories 2/3 versus category 1.
  - [B-007 Payne](https://pubmed.ncbi.nlm.nih.gov/24595203/): prospective 259-child cohort; 20%/hour (12 minutes) inflection; adjusted OR 1.13 per 1% burden increase; discharge PCPC decline endpoint; no mortality association.
  - [B-009 Wagenman](https://pubmed.ncbi.nlm.nih.gov/24384638/): 60/137 followed at median 2.7 years; ESE 14/60; adjusted OR 13.3 for later epilepsy, OR 6.36 for unfavorable extended GOS, and 23-point lower PedsQL.
  - [B-010 Thoresen](https://pubmed.ncbi.nlm.nih.gov/20566612/): 74 infants, Bayley II at 18 months; abnormal 3–6-hour aEEG PPV 84% normothermia/59% hypothermia; recovery predictor 90.9%/96.2%; good-outcome normalization by 24/48 hours.
  - [B-011 Kharoshankaya](https://pubmed.ncbi.nlm.nih.gov/27595841/): 47 term HIE neonates; 24–48-month composite outcome; OR 9.56 above 40 total minutes and OR 8.00 above 13 min/h.
  - [B-012 Srinivasakumar](https://pubmed.ncbi.nlm.nih.gov/26482675/) indexed full text: 69 randomized neonates, 35 with seizures; excluding status, median burden 449 seconds (IQR 113–2070) versus 2226 (760–7654), p=.02. [Glass](https://pubmed.ncbi.nlm.nih.gov/30790268/): 534 neonates; 66% incomplete initial-load response.
  - [B-013 Naim](https://pubmed.ncbi.nlm.nih.gov/25957454/): 161/172 monitored; 13/161 seizures, median onset 20 hours; 11/13 EEG-only; 8/13 status; mortality 38% versus 3%.
  - [B-014 Chahine](https://pubmed.ncbi.nlm.nih.gov/34387276/): 73 ECMO patients; PCPC at discharge; score >17; sensitivity 44%, specificity 97%, PPV 95%, NPV 57%; HR 6.1. The stem/explanation now state the verified >17 cutoff.
  - [B-015 Appavu](https://pubmed.ncbi.nlm.nih.gov/35526326/): 61 survivors, 10 PTE; OR 7.58 for first-week seizures and 21.47 for 24–168 hours; outcome definition unprovoked seizure after 2 months or ASM at 12 months. The item retains the subgroup-comparison caveat.
  - [B-016 Fung](https://pubmed.ncbi.nlm.nih.gov/32690798/): prospective 719-child model cohort, 184 seizures; the six <5% durations and two <2% extensions match the item.
  - [B-017 Abend](https://pubmed.ncbi.nlm.nih.gov/21307352/): 100 children; 46 seizure-positive; among those, 52% detected in hour 1 and 87% by 24 hours.
  - [B-019 Naim](https://pubmed.ncbi.nlm.nih.gov/32738224/): 78/1053 seizures; derivation c=.77; validation c=.61; no net benefit at 8–18%; conclusion supports monitoring all neonates after bypass.
  - [B-021 Benedetti](https://pubmed.ncbi.nlm.nih.gov/36731228/): 50 respondents/39 institutions; institutional response 39/74; use 22/39; training barrier 22/26; required training 3/22; curriculum 7/22.
  - [B-023 Variane](https://pubmed.ncbi.nlm.nih.gov/37966836/): 872 cooled infants; 296 seizures; 213 electrographic-only; 181 onset at 6–24 hours; 34/296 during rewarming; 192/296 controlled with one drug.
- These checks required two content corrections: B-012's explanation now matches the repaired raw excerpt at minute 93, and B-014 now states the verified score cutoff `>17`. No other flagged quantitative claim required removal.
- These edits are scientific/editorial revisions, not independent pediatric EEG sign-off. Synthetic waveform morphology and final item validity still require the existing expert review gate.
