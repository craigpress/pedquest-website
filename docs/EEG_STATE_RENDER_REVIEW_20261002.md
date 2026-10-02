# Renderer 0.5.5 state and muscle review

Clinical awake/drowsy/asleep/sedated/comatose context is separate from natural sleep stages, cerebral reactivity and drug/coma morphology. Emitted variants, sleep transients, NREM activation, markers and answer intervals use the actual eligible timeline. Unknown unreactive context remains indeterminate. Neonatal native behavioral states are retained. See [authoring rules and primary sources](EEG_STATE_AUTHORING.md).

Automatic tonic muscle now fluctuates continuously and irregularly across independent left/right frontal and temporal sources, with weaker posterior and much weaker central fields. It is independent of cerebral amplitude/envelopes. Current non-myoclonic burst-suppression examples receive no automatic tonic muscle. Existing authored ictal motor, movement and chewing streams retain their field/timing behavior. Regression testing caught and corrected both a missing authored clonic component and sleep-activated discharges extending across a coma interval.

All 166 gallery PNGs and 52 bank PNGs were individually reviewed at full resolution, including the final affected motor exports. Comparisons distinguish matched named-pattern figures, adjacent component evidence and unavailable matching figures; prior clinical figure pixel inspections were reused and new state-specific primary sources inspected. This is technical illustration review, not human clinical acceptance. Updated captions qualify alpha-coma variability, preceding N2 in frontal arousal rhythm, and the neonatal HIE lower margin. Accessible per-item scale legends explain seconds, microvolts and trend units at resized display sizes.

Four bank specifications gain only an initial clinical state matching their vignette: A004/A014 sedated, A005 drowsy, B018 comatose. Question wording and human review fields are preserved. The full bank and affected motor examples are regenerated with 0.5.5 provenance; existing Lab recordings are excluded from migration.

The editor [review viewer](https://pedquest.org/admin/eeg-lab/muscle-review) includes current G/H/I recordings and six clearly labeled earlier comparisons. G demonstrates eligibility transitions, rather than a typical anesthetic or coma waveform. H/I demonstrate regional awake muscle and non-myoclonic burst suppression. Actual viewer component checks covered longitudinal bipolar and average reference, 70/35 Hz filtering and multiple windows; an authenticated production browser check remains distinct from these fixture checks.

Final source tests: **847 renderer tests passed, one existing skip; 33 TypeScript tests passed; 28 export-bridge tests passed**. Accepted generalized cerebral component hashes match their historical baselines, with motor/artifact components tested separately. TypeScript checking passes. Targeted lint has no errors and one pre-existing Lab polling-effect warning. Detailed per-module logs, per-ID visual observations, source impact inventories and release receipts live in the owning project's `research/eeg-atlas/state-review-20261001/`.

## Pending content/reference corrections

These findings are retained for the next content review; they are not hidden by the state migration.

| Example | Remaining issue |
|---|---|
| B002 | Measured upper maxima are 12.595/12.003 µV, above the claimed 10 µV threshold; left lower maximum 5.306 µV also exceeds the claimed 5 µV threshold. Unchanged pre-existing illustration needs amplitude/content alignment. |
| A017 | Explanation refers to additional events outside its single short raw inset. |
| B013 | Claimed right postictal suppression-ratio rise is not visible at the configured threshold. |
| A023 | Authored attenuation ramps gradually; prose calls the change abrupt. |
| B005, B016/B021, B019, B025 | “Flat,” “empty,” or “brief” wording overstates the actual threshold trend/background bands/motor duration; B019 has sustained suppression-ratio rises during low-amplitude quiet-sleep discontinuity. |
| B018 | Explicit motor contamination is an authored assumption; eye deviation alone does not establish bilateral muscle contraction. |
| A015/A025/B024 | Initial stated sedative exposure lacks a drug profile or specified consciousness depth; do not infer coma from exposure alone. |
| B024 | After pentobarbital the lower aEEG margin falls while retained burst peaks keep the upper margin high; wording that both margins fall needs correction. |
| B015 and long trend overviews | Compressed events require zoom/raw EEG to assess individual frequency evolution. |
| B017 | Accepted answer rectangle includes the rejected suctioning time. Narrow the point tolerance and regenerate answer geometry in the next content pass. |
| B023 | Previously identified weak short raw-inset seizure confirmation remains a clinical review item. |

Quantitative pediatric muscle norms, measured ranges from multiple reference figures and Craig's clinical acceptance remain in PQW-112. Rare REM wickets, pediatric SREDA exception authoring and dedicated BETS/6-Hz phantom generators remain documented coverage limits. Relative/heuristic trend measures are not validated clinical detectors.
