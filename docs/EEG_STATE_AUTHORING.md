# Clinical state in renderer 0.5.5

For `spec_version: 3`, author `background.clinical_state` as `awake`, `drowsy`, `asleep`, `sedated` or `comatose`. Timed `state_change` events support these contexts through `wake`, `drowsy`, `sleep`, `sedated`, `comatose`, `rem` and `arousal`. Drug LOC profiles can establish sedation independently. Clinical state is separate from cerebral reactivity, visible sleep architecture and the internal morphology used for anesthetic or coma rhythms.

An unspecified, unreactive behavioral context remains `indeterminate`. Explicitly awake examples may remain unreactive and still blink or have muscle. Neonatal native awake/active/quiet/indeterminate states retain their own PMA-dependent physiology; they are not adult NREM stages. State labels and feature answer keys follow the emitted timeline.

| Feature | Current teaching support |
|---|---|
| PDR and spontaneous eye behavior | Natural state and eye context; recover after authored waking |
| Mu; Ciganek | W/N1; Ciganek's authored awake/drowsy context selects W/N1 respectively |
| Lambda, photic driving, hyperventilation buildup | Awake, with the corresponding authored task |
| Posterior slow waves of youth | Awake with closed eyes/PDR context |
| Wickets, RMTD | Drowsy context: N1/N2; explicit relaxed-wake context: W |
| 14 & 6 positive bursts; POSTS | N1/N2 |
| Hypnagogic/hypnopompic hypersynchrony | N1 or a genuine NREM arousal |
| Frontal arousal rhythm | Genuine preceding NREM sleep; an arousal event never fabricates prior sleep |
| SREDA | Natural W/N1/N2/N3/REM; existing adult teaching restriction retained |
| Natural sleep transients and NREM epileptiform activation | Actual natural stages; sedation/coma morphology proxies cannot activate them |
| Drug oscillations and spindle/alpha coma | Separate generators retain their intended cerebral activity |

These are supported authoring contexts, not universal absence claims. Rare REM wickets and pediatric SREDA are documented but their dedicated exception authoring is outside the current teaching policy. BETS/small sharp spikes and 6-Hz phantom spike-wave have no dedicated generator. Epileptiform activity may obscure normal architecture without eliminating genuine NREM activation.

Automatic tonic muscle uses independent, continuous irregular left/right frontal, temporal and weaker posterior sources, with much smaller central fields. Clinical tone varies with state, drugs, temperature and explicit blockade. Current non-myoclonic background/drug burst-suppression examples receive zero automatic tonic muscle. Separately authored movement, chewing and seizure motor activity remain separate. Source weights and stage-rate factors are engineering settings, not measured pediatric norms.

Primary references: [RMTD pediatric cases](https://pmc.ncbi.nlm.nih.gov/articles/PMC9884947/), [wicket case-control study](https://www.sciencedirect.com/science/article/pii/S1059131112002518), [REM wicket cases](https://pubmed.ncbi.nlm.nih.gov/25240557/), [pediatric SREDA](https://pmc.ncbi.nlm.nih.gov/articles/PMC11829623/), [lambda experiment](https://pubmed.ncbi.nlm.nih.gov/1913148/), [hypnopompic hypersynchrony](https://pmc.ncbi.nlm.nih.gov/articles/PMC8379435/), [ACNS neonatal guideline](https://www.acns.org/pdf/guidelines/Guideline-16.pdf), [anesthetic EEG](https://pubmed.ncbi.nlm.nih.gov/26275092/), [reactive spindle coma](https://pubmed.ncbi.nlm.nih.gov/10727908/), [ILAE SeLECTS](https://www.epilepsydiagnosis.org/syndrome/ects-eeg.html), [ILAE DEE-SWAS](https://www.epilepsydiagnosis.org/syndrome/ee-csws-eeg.html), [ILAE Lennox–Gastaut](https://www.epilepsydiagnosis.org/syndrome/lgs-eeg.html).

Reproducible per-item review, source matrices, probes and rollout receipts: owning project's `research/eeg-atlas/state-review-20261001/`. Earlier source-image comparisons remain in `gallery-20261001-review/`. New renders are required after a renderer version change; existing Lab recordings are not automatically migrated.
