# EEG gallery and implementation review — 2026-10-01

All 163 deployed originals were reviewed individually at full resolution before the targeted renderer revision. All 163 private production PNGs matched the local originals by SHA256. Three parallel clinical groups covered 53 developmental/normal, 47 interictal/seizure/generalized and 63 critical-care/artifact/trend examples. A separate code review checked integration and performance. These are AI technical/neurophysiology findings; existing human review states were preserved.

The final catalog has 166 examples: 3 additions (Ciganek and paired bilateral independent SeLECTS), 27 revised existing images, and 24 caption-only corrections. Seven accepted generalized examples remain byte-for-byte represented by their original manifest records. No clinical acceptance, review status, or user note was written by this work.

## Implemented corrections

- Existing controls: age/state captions, photic stimulation frequency, preterm continuity with delta brushes, clearer seizure recruitment window and tonic muscle activity, average-reference slow spike-wave views, LRDA fluctuation window, shared spectrogram power scale/color legends and aEEG grids.
- Renderer: optional Cz-maximal Ciganek theta; mu train length and POSTS spacing; optional triphasic SeLECTS sharp complex; neonatal graphoelements follow actual suppression; focal cerebral attenuation preserves the muscle floor; optional central spindle field and K-complex/spindle timing. Unspecified author controls retain their prior behavior.
- Gallery performance: memoized cards with stable callbacks; in-flight/TTL cache for image signing while authentication and review data remain fresh. Timebase guidance and outside-image calibration/axis/color legends explain resized EEG displays.
- Homepage performance: LCP wordmark uses eager loading and high fetch priority; the EEG animation draws at approximately 30 frames/s and suspends drawing offscreen or when the page is hidden.
- ILAE EpilepsyDiagnosis is included in local example-reference documentation. LearningEEG comparisons use actual reference images and account for montage/state differences.

## Evidence and limits

The same local React workload fell from 489 card renders to 164 (163 initial, zero on viewer open, one on status change). Viewer-open commit duration fell from 24.8 to 6.6 ms and status-update commit duration from 30.1 to 7.9 ms. The fixture used the actual gallery component with stubbed auth/data and omitted image transfer; these are local UI-update measurements.

Google's external PageSpeed reports measured current production before these branch changes, using Lighthouse 13.5 on 2026-10-01 at 00:10/00:15 EDT. On simulated slow 4G, the [homepage mobile report](https://pagespeed.web.dev/analysis/https-pedquest-org/isafgdo7st?form_factor=mobile) scored 87: FCP 0.9 s, LCP 4.0 s, TBT 20 ms, CLS 0, speed index 2.9 s. The [homepage desktop report](https://pagespeed.web.dev/analysis/https-pedquest-org/isafgdo7st?form_factor=desktop) scored 71: FCP 0.2 s, LCP 0.8 s, TBT 980 ms, speed index 0.9 s. The [question-bank mobile report](https://pagespeed.web.dev/analysis/https-pedquest-org-education-question-bank/q197atet1j?form_factor=mobile) scored 92: FCP 1.8 s, LCP 3.1 s, TBT 0 ms, CLS 0, speed index 3.0 s. Parent inspected these report pages directly; the earlier API attempt was quota-limited. External preview testing on October 1 at 00:52 EDT used [Google PageSpeed](https://pagespeed.web.dev/analysis/https-pedquest-site-8h657gmba-craigpress-vercel-app/3nmadqlcou): mobile score 87, FCP 0.9 s, LCP 3.9 s, TBT 100 ms, CLS 0, speed index 2.4 s; desktop score 100, FCP 0.2 s, LCP 0.5 s, TBT 10 ms, CLS 0, speed index 0.6 s. Mobile performance score was unchanged; desktop improved in this run. These are single lab runs on different production/preview hostnames and cannot isolate code changes from CDN, deployment and run variability. The authenticated gallery still requires post-rollout external verification.

Public HTTPS endpoint/storage probes from the LAN desktop and local signing-cache benchmarks are separate evidence. They do not measure off-LAN browser load time. A new serverless instance still pays cold signing and live auth/review queries. Local canvas operation counts support reduced drawing work, without measuring browser rasterization/GPU costs or proving an external performance improvement.

All 166 final examples have an explicit reference-comparison record: 82 direct same-pattern figures, 68 adjacent/component figures, 6 schematics, 9 description-only comparisons, and 1 unmatched. "Direct" means the same named pattern, not exact clinical validation. Each item lists source URLs/figure locators, actual figure-inspection status and residual limits. Some clinical-source figures omit a usable calibration; image pixels cannot establish amplitude equality across montages/gains. The Ciganek comparison used the supplied clinical screenshot, with EEGpedia attribution.

Single excerpts cannot establish seizure burden, behavioral correlation, reactivity, drug response or population-wide physiological limits. BETS/SSS and dedicated 6-Hz phantom spike-wave examples remain coverage gaps. LearningEEG supplies no directly matched SREDA or frontal-arousal figure in the requested chapter. Frontal arousal classification and residual sedative/neonatal fidelity uncertainties remain identified for clinical review; an attractive render is not a clinical acceptance.

## Per-item original review and final action

### nrm-term-neonate-awake — Retained

Continuous mixed delta/theta without PDR or interburst gaps; central greater than frontal voltage and temporal noise are plausible. Caption eye transient at 2 s is subtle.

Final: Term neonate (40 weeks) awake: continuous low-to-medium voltage mixed delta and theta in all regions (activite moyenne), with no posterior dominant rhythm and no interburst periods. Muscle over the right temporal chains and an eye movement at 2 s.

Reference comparison: **direct figure**. Continuous mixed neonatal activity matches; polygraphy and movement differ.

- [5eda590e4bc6a5c1eb10992c_more-more-Awake-4-day-old-full-term-girl-normal-study-at-15uV.webp — 5eda590e4bc6a5c1eb10992c_more-more-Awake-4-day-old-full-term-girl-normal-study-at-15uV.webp](<https://www.learningeeg.com/neonatal>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/neonatal/5eda590e4bc6a5c1eb10992c_more-more-Awake-4-day-old-full-term-girl-normal-study-at-15uV.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### nrm-infant-awake — Retained

Approximately 5 Hz posterior rhythm with mixed slower background, bilateral posterior maximum; plausible 6-month maturation. Brief temporal noise is realistic.

Final: Six-month-old awake, eyes closed: a 5-6 Hz posterior rhythm, largest in T5-O1, P3-O1, T6-O2 and P4-O2, over mixed theta and delta.

Reference comparison: **adjacent figure**. Reference has a 6 Hz PDR at eight months; gallery is six months, about 5 Hz.

- [Normal-awake-8-month-old.webp — Normal-awake-8-month-old.webp](<https://www.learningeeg.com/pediatric>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/pediatric/Normal-awake-8-month-old.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### nrm-toddler-awake — Retained

6–7 Hz posterior rhythm, symmetric waxing amplitude, intermixed theta/delta and lower frontal voltage; late temporal EMG plausible.

Final: Two-year-old awake, eyes closed: a 6-7 Hz posterior rhythm in the occipital and parietal chains with intermixed theta; lower-voltage faster activity in the frontal derivations.

Reference comparison: **adjacent figure**. Reference annotation says three years despite filename; gallery two-year PDR is slower.

- [2yo-normal-awake-background_1.webp — 2yo-normal-awake-background_1.webp](<https://www.learningeeg.com/pediatric>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/pediatric/2yo-normal-awake-background_1.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### nrm-child-eyes-closed-pdr — Caption corrected

8–9 Hz bilateral posterior rhythm and gradient plausible; temporal EMG is strongest near 10–13 s rather than caption from 7 s.

Final: Eight-year-old awake, eyes closed: symmetric 8–9 Hz posterior dominant rhythm, with lower-voltage frontal activity and a brief burst of temporal muscle artifact.

Reference comparison: **direct figure**. Eight-year reference supports 9 Hz posterior rhythm and mixed activity; artifact differs.

- [Mu-again-8yo-F.webp — Mu-again-8yo-F.webp](<https://www.learningeeg.com/pediatric>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/pediatric/Mu-again-8yo-F.webp>)

- [normal-awake-pdr-8-9.webp — normal-awake-pdr-8-9.webp](<https://www.learningeeg.com/normal-awake>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/normal-awake/clean/normal-awake-pdr-8-9.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### nrm-adolescent-awake — Caption corrected

9–10 Hz bilateral posterior activity with amplitude variability and appropriate gradient; captioned prominent muscle at 0–2/9–11 s is not visible.

Final: Adolescent awake, eyes closed: a 9.5–10 Hz posterior dominant rhythm, waxing and waning in the posterior derivations, with a clear anterior-posterior gradient.

Reference comparison: **adjacent figure**. Posterior gradient agrees; reference 8–9 Hz is slower than gallery 9.5–10 Hz.

- [normal-awake-pdr-8-9.webp — normal-awake-pdr-8-9.webp](<https://www.learningeeg.com/normal-awake>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/normal-awake/clean/normal-awake-pdr-8-9.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### nrm-adult-awake — Caption corrected

Low-voltage posterior alpha and modest slow component plausible; captioned frontotemporal muscle at 5–7/12–14 s is absent or too subtle to teach.

Final: Adult awake, eyes closed: a low-voltage 10 Hz posterior dominant rhythm in the posterior derivations with little slow activity.

Reference comparison: **adjacent figure**. Posterior gradient agrees; gallery low-voltage 10 Hz is not this reference patient.

- [normal-awake-pdr-8-9.webp — normal-awake-pdr-8-9.webp](<https://www.learningeeg.com/normal-awake>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/normal-awake/clean/normal-awake-pdr-8-9.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### nrm-eyes-open-reactivity — Caption corrected

Posterior rhythm clearly attenuates atabout 8 s; frontopolar opening transient/eye movement near 8–9 s. Later blink transients occur nearer 12/18 s than 11/14 s.

Final: Child awake: the 8.5 Hz posterior rhythm attenuates with the frontopolar eye-opening deflection near 8 s. Later blinks are visible; the background is reactive.

Reference comparison: **direct figure**. Eye-linked posterior rhythm change agrees; behavioral timing requires authored event context.

- [normal-alpha-eye-closure.webp — normal-alpha-eye-closure.webp](<https://www.learningeeg.com/normal-awake>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/normal-awake/clean/normal-alpha-eye-closure.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### nrm-hyperventilation-buildup — Retained

Diffuse irregular high-voltage 1.5–3 Hz delta with frontal/central prominence and residual waking background; child/HV context plausible, no evolving spike-wave.

Final: Child near the end of 3 minutes of hyperventilation: diffuse, irregular 1.5-3 Hz delta, largest frontally (Fp1-F3, Fp2-F4), mixed with the waking background. Symmetric; a normal build-up in a child.

Reference comparison: **direct figure**. Diffuse pediatric high-voltage slow buildup agrees; activation duration is not fully shown.

- [hv-slowing-pediatric-2.webp — hv-slowing-pediatric-2.webp](<https://www.learningeeg.com/normal-awake>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/normal-awake/annotated/hv-slowing-pediatric-2.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### nrm-photic-driving — Revised image

Visible stimulus pulses are~6/s. Catalog a_normal.yaml:226 explicitly stimulus_frequency_hz:6, while title/caption say 12 flashes/s. Posterior response may be a 12 Hz harmonic, which is different from 12 Hz stimulation.

Final: Photic stimulation at 12 flashes per second (Photic channel, 3-13 s): a 12 Hz occipital response time-locked to the flashes, symmetric and maximal in P3-O1, P4-O2, T5-O1 and T6-O2, stopping with the train.

Reference comparison: **direct figure**. Final 12 Hz posterior driving agrees; source flash markers differ.

- [perfect-photic-driving-12-hz.webp — perfect-photic-driving-12-hz.webp](<https://www.learningeeg.com/normal-awake>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/normal-awake/clean/perfect-photic-driving-12-hz.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### slp-drowsiness — Caption corrected

Posterior rhythm is prominent near 2–8 s and attenuates near 9–10 s; caption says first 5 s/dropout 5–8 s. A clean vertex at 15 s is not evident. Background transition itself is plausible.

Final: Child falling asleep: the posterior rhythm visible early in the page becomes less prominent around 9–10 s and gives way to lower-voltage mixed theta as drowsiness develops.

Reference comparison: **direct figure**. Lower-voltage theta and opposing roving-eye deflections agree.

- [Drowsy state.webp — Drowsy state.webp](<https://www.learningeeg.com/normal-asleep>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/normal-asleep/clean/Drowsy state.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### slp-n1-vertex-waves — Caption corrected

Sharply contoured bilateral central/midline phase reversals around 3,9.8,13.8 s on low-voltage theta, appropriate adolescentN1. Caption lists 1.6/7.8/13.2 s. Temporal EMG long but does not obscure vertex.

Final: Adolescent in N1: sharply contoured vertex waves, maximal at Cz, with phase reversals in Fz-Cz/Cz-Pz and the central parasagittal chains, over low-voltage theta.

Reference comparison: **direct figure**. Central sharp transient and bipolar phase reversal agree.

- [Vertex wave.webp — Vertex wave.webp](<https://www.learningeeg.com/normal-asleep>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/normal-asleep/annotated/Vertex wave.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### slp-n2-spindles — Revised image

Spindle packets around 2–4 s and 14–15 s wax/wane at fast sigma frequency. P-O/T-O amplitudes rival or exceed central derivations; conflicts with intended central emphasis . Caption times 4/7.5/9.5 s also wrong.

Final: Child in N2: bilateral waxing and waning sleep spindles at 12–14 Hz, lasting about 1–2 s, with centroparietal prominence and lower-voltage spread to the temporal chains.

Reference comparison: **direct figure**. Waxing sigma packets agree. Reference is broad centroparietal/posterior; central prominence is optional teaching emphasis.

- [Spindles.webp — Spindles.webp](<https://www.learningeeg.com/normal-asleep>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/normal-asleep/annotated/Spindles.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### slp-n2-k-complexes — Revised image

Biphasic frontocentralK-complexes about 1.3/5.8/18.3 s, normal morphology. First sigma packet begins during negativeK-complex and continues through it; does not demonstrate delayed spindle needed for the intended timing example. Caption 8/12.2/17.6 s and spindle 9 s inaccurate.

Final: Adolescent in N2: frontocentral K-complexes with an initial sharp negative wave followed by a slower positive wave. A central sleep spindle follows the first completed complex.

Reference comparison: **direct figure**. Biphasic frontocentral K-complex and following sigma agree after final timing fix.

- [K Complex, Spindles, POSTs.webp — K Complex, Spindles, POSTs.webp](<https://www.learningeeg.com/normal-asleep>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/normal-asleep/annotated/K Complex, Spindles, POSTs.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### slp-infant-spindles — Caption corrected

Long independent/asymmetric infant sigma trains are plausible, with overlap permitted physiologically. Left dominant 4–8 s/right 1.5–8 s and 12–15 s rather than sequential caption 5.5–9/10–15 s.

Final: Six-month-old in N2: long spindle trains lasting several seconds, independently prominent over each hemisphere. Asynchronous and overlapping spindles are normal at this age.

Reference comparison: **adjacent figure**. Long asynchronous spindles agree; reference four months versus gallery six months.

- [normal-4-month-old-asleep-long-spindle-with-vertex-and-asynchronous-spindle_1.webp — normal-4-month-old-asleep-long-spindle-with-vertex-and-asynchronous-spindle_1.webp](<https://www.learningeeg.com/pediatric>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/pediatric/normal-4-month-old-asleep-long-spindle-with-vertex-and-asynchronous-spindle_1.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### slp-n3-slow-wave-sleep — Caption corrected

Diffuse irregular slow waves, frontocentral emphasis and residual sigma consistent withN3; actual prominent channelsF3-C3/C3-P3 rather than captionFp 1-F3 strongest. No clear isolated 2–4 s spindle.

Final: Child in N3: diffuse high-voltage 0.5–2 Hz slow waves, prominent in the frontocentral chains and smaller posteriorly, on a mixed sleep background.

Reference comparison: **direct figure**. Broad high-voltage slow activity agrees; stage percentage needs a longer epoch.

- [Slow Wave Sleep I.webp — Slow Wave Sleep I.webp](<https://www.learningeeg.com/normal-asleep>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/normal-asleep/annotated/Slow Wave Sleep I.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### slp-rem — Caption corrected

Attenuated mixed-frequency cerebral background with opposing frontotemporal ocular deflections near 4–5/12–13.5 s, plausibleREM; caption 6.5–8/11–13.5 s partly wrong.

Final: Adolescent in an authored REM interval: low-voltage mixed-frequency cerebral activity without spindles or K-complexes, with bursts of opposing frontotemporal rapid eye movement deflections.

Reference comparison: **direct figure**. Low mixed background and opposite frontal ocular deflections agree; chin atonia unavailable.

- [REM Sleep ex 3.webp — REM Sleep ex 3.webp](<https://www.learningeeg.com/normal-asleep>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/normal-asleep/annotated/REM Sleep ex 3.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### slp-rem-sawtooth — Caption corrected

Vertex-central sawtooth train near 4.5–6 s preceding eye burst 5–6.5 s, with later ocular burst 11–12 s; frequency/morphology plausible. Caption 7–9/8.3–9.3 s incorrect.

Final: Adult in an authored REM interval (5 uV/mm): a brief 2–4 Hz sawtooth train, maximal centrally and at the vertex, precedes a burst of opposing frontotemporal eye movements.

Reference comparison: **adjacent figure**. REM ocular/background context agrees; this figure does not establish classic sawtooth morphology.

- [REM Sleep ex 3.webp — REM Sleep ex 3.webp](<https://www.learningeeg.com/normal-asleep>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/normal-asleep/annotated/REM Sleep ex 3.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### slp-arousal — Revised image

Arousal EMG begins 6 s; pre-arousal segment is low-voltage mixed theta with little convincing delta/K-complex. Caption asserts architecture not evident.

Final: Child arousal from an authored N2 interval: a slower mixed sleep background and a frontocentral K-complex just before 6 s precede the shift to faster activity, frontotemporal muscle and movement.

Reference comparison: **adjacent figure**. Pre-arousal K-complex context agrees; no matched clinical arousal EMG sequence inspected.

- [K Complex, Spindles, POSTs.webp — K Complex, Spindles, POSTs.webp](<https://www.learningeeg.com/normal-asleep>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/normal-asleep/annotated/K Complex, Spindles, POSTs.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### var-mu — Revised image

Central arch-like~10 Hz field is recognizable, but clean high-amplitude bilateral trains recur with abrupt gaps and little background mixing; supports revision of train amplitude and background mixing. LearningEEG reference is sustained and less isolated.

Final: Right-predominant mu rhythm: sustained, waxing and waning 10 Hz arciform activity over the right sensorimotor region, mixed with the awake background; much smaller on the left. No ictal evolution or after-going slow wave.

Reference comparison: **direct figure**. Central arch-shaped trains agree; clinical mu can be large and bilateral.

- [Mu-Rhythm-III — Mu-Rhythm-III](<https://www.learningeeg.com/normal-variants>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/normal-variants/Mu-Rhythm-III.webp>)

- [Mu-again-8yo-F.webp — Mu-again-8yo-F.webp](<https://www.learningeeg.com/pediatric>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/pediatric/Mu-again-8yo-F.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### var-lambda — Caption corrected

Repeated positive occipital sail-like transients in waking/ocular context; positive polarity and posterior field agree withLearningEEG. Caption blink times 2.3/5.7/10.2 s differ fromactual~3.1/9/10/14 s.

Final: Lambda waves during visual scanning: repeated surface-positive, sail-like occipital transients in P3-O1, P4-O2, T5-O1 and T6-O2, with blinks and other evidence of wakefulness; no posterior dominant rhythm.

Reference comparison: **direct figure**. Posterior positive sharp transients agree; scanning behavior is authored rather than observed.

- [lambda-waves-at-10uV-2 — lambda-waves-at-10uV-2](<https://www.learningeeg.com/normal-variants>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/normal-variants/lambda-waves-at-10uV-2.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### var-pswy — Caption corrected

Isolated posterior slower waves fused with child posterior rhythm, plausible amplitude/asymmetric timing againstLearningEEG example. Caption 4.5/8/11 s is too precise for scattered actual posterior transients.

Final: Posterior slow waves of youth, eyes closed: isolated 2.5–4 Hz waves fused with the 9 Hz posterior rhythm in the occipital derivations. A normal finding in children and adolescents.

Reference comparison: **direct figure**. Posterior slow transients interrupt an otherwise formed posterior rhythm.

- [PSWY — PSWY](<https://www.learningeeg.com/pediatric>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/pediatric/posterior-slow-waves-of-youth-again_1.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### var-hypnagogic-hypersynchrony — Revised image

High-voltage generalized 3–4 Hz train has plausible rhythm; surrounding background is disproportionately low/fast and onset is abrupt at 5 s, with a short lead-in. Caption 4–12.5 s also differs from 5–10 s.

Final: Hypnagogic hypersynchrony on a slower, higher-voltage drowsy background. The wider window shows the lead-in before the high-voltage frontocentral delta-theta burst, followed by return to the drowsy background.

Reference comparison: **adjacent figure**. Generalized high-voltage slow trains resemble the figure, but source is hypnopompic arousal.

- [HH — HH](<https://www.learningeeg.com/pediatric>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/pediatric/Hypnapompic-Hypersynchrony.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### var-posts — Revised image

Positive occipital triangular transients are correct polarity/field, but very dense continuous repeated events are too densely repeated for the intended example. K-complex~11.8 s rather than 13 s.

Final: Occasional surface-positive occipital sharp transients in N2, separated by irregular intervals rather than a nearly continuous train; a normal sleep finding.

Reference comparison: **direct figure**. Posterior positive sleep transients agree; final spacing avoids dense regular repetition.

- [POSTs — POSTs](<https://www.learningeeg.com/normal-asleep>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/normal-asleep/clean/POSTs.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### var-wicket — Revised image

Temporal arch-likealpha trains without after-slow wave have correct field, but amplitude is far greater than surrounding background andLearningEEG example, with nearly continuous conspicuous bursts;

Final: Low-amplitude 7-9 Hz arciform temporal runs and single wicket waves in drowsiness, with no after-going slow wave or ictal evolution.

Reference comparison: **direct figure**. Temporal arch-shaped trains without distinct after-going slow waves agree.

- [Wickets — Wickets](<https://www.learningeeg.com/normal-variants>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/normal-variants/Wickets.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### var-rmtd — Caption corrected

Notched temporal 5–6 Hz trains without clear evolution are appropriateRMTD; actualright 0–5.5 s/left 2–6 and 9–10.5 s do not matchcaption laterality/timing. SomeEMG overlays target.

Final: RMTD in drowsiness: independent runs of rhythmic, notched 5–6 Hz theta over the left and right mid-temporal chains, without evolution in frequency or field.

Reference comparison: **direct figure**. Temporal rhythmic theta agrees; reference has more superimposed background variation.

- [RMTD — RMTD](<https://www.learningeeg.com/normal-variants>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/normal-variants/RMTD.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### var-14-and-6 — Caption corrected

Brief posterior positive comb-like 6 Hzleft near 2.5–3.2 s and 14 Hzright near 11.2–11.8 s in ear-reference display, appropriate drowsy adolescent; caption 1.4/12.2 s wrong.

Final: 14 and 6 Hz positive bursts in light sleep (ear reference): brief positive comb-like bursts, at 6–7 Hz on the left and 14 Hz on the right, with a posterior temporal/occipital maximum.

Reference comparison: **direct figure**. Posterior temporal positive runs agree; ear reference improves polarity assessment.

- [14-and-6-positive-spikes-at-10uV-in-a-13yo-F — 14-and-6-positive-spikes-at-10uV-in-a-13yo-F](<https://www.learningeeg.com/normal-variants>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/normal-variants/14-and-6-positive-spikes-at-10uV-in-a-13yo-F.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### var-frontal-arousal-rhythm — Revised image

Strong sustained frontotemporalEMG after 3 s obscures target frontocentral rhythm; initialvisible central 8 Hz packet appears 0–1.5 s rather than caption 5–13 s. K-complex 0.7 s not convincing.

Final: Child arousing from N2: a frontocentral K-complex near 2.2 s precedes arousal with frontotemporal muscle at 5 s. Independently waxing rhythmic 8 Hz trains follow in the frontal and frontocentral chains, with smaller posterior spread.

Reference comparison: **adjacent figure**. Final frontal 8 Hz trains follow preserved N2/arousal context; no exact FAR figure inspected.

- [K Complex, Spindles, POSTs.webp — K Complex, Spindles, POSTs.webp](<https://www.learningeeg.com/normal-asleep>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/normal-asleep/annotated/K Complex, Spindles, POSTs.webp>)

- [HH — HH](<https://www.learningeeg.com/pediatric>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/pediatric/Hypnapompic-Hypersynchrony.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### var-sreda — Caption corrected

Sustained left-predominant posterior 5–6 Hz rhythm builds near 8–10 s with little evolution afterward; plausibleSREDA morphology/field. Image cannot establish alertness, minute-longduration, or abrupt offset beyond this 20 s excerpt; no clear blinks.

Final: SREDA onset in an authored awake adult interval: sharply contoured slowing builds into sustained 5–6 Hz activity with a posterior maximum and left predominance. This page shows the onset of a simulated 60-s run.

Reference comparison: **text only**. No comparable SREDA waveform figure inspected; earlier physiology review remains provisional.

- [Description-only source — Description only; no matching waveform figure inspected](<https://pubmed.ncbi.nlm.nih.gov/31393275/>) — text only; figure pixels not claimed inspected.

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation. Public SREDA figure pages encountered a reCAPTCHA challenge; no figure inspection claimed.

### art-eye-blink — Retained

Symmetric frontopolar sharp-rise blinks with filter undershoot; posterior chains remain intact.

Final: Symmetric bifrontal deflections maximal in Fp1-F3/Fp2-F4 and Fp1-F7/Fp2-F8, each with a fast rise and a slightly slower return, fading by F3-C3. Posterior chains are unaffected.

Reference comparison: **direct figure**. Anterior sharp rise and slower filtered return match; source has denser blink clusters.

- [LearningEEG: Eye blinks — artifacts__PDR-10-to-10-point-5.png](<https://www.learningeeg.com/images/artifacts/PDR-10-to-10-point-5.webp>) — clinical figure; figure pixels inspected.

Limits: Source age/state not established by the image.

### art-lateral-eye — Retained

Correct F7/F8 phase reversals and opposed sides; temporal muscle at4–7 and12–14s competes with teaching feature.

Final: Box-shaped deflections of opposite polarity at F7 and F8: Fp1-F7 and F7-T3 deflect in opposite directions (phase reversal at F7), mirrored on the right, so the two sides are always opposed. Each saccade rises in tens of milliseconds and returns through the low-frequency filter.

Reference comparison: **direct figure**. Opposed F7/F8 ocular fields match.

- [LearningEEG: Positive and Negative Phase Reversals — montages__clean__lateral-eye-movements.png](<https://www.learningeeg.com/images/montages/clean/lateral-eye-movements.webp>) — clinical figure; figure pixels inspected.

Limits: Synthetic temporal muscle competes with the eye feature; video absent.

### art-slow-roving-eye — Retained

Opposed slow anterior eye movements and central vertex waves match drowsiness. A seconds ruler is needed when the screen is resized.

Final: Irregular slow lateral eye movements (half-waves of about 1-2 s) in Fp1-F7 and Fp2-F8, opposite in F7-T3/F8-T4 and opposed between the two sides, in drowsiness as the posterior rhythm drops out; vertex waves appear in the parasagittal chains.

Reference comparison: **direct figure**. Slow opposing anterior waves on a drowsy background match.

- [LearningEEG: Slow lateral eye movements — artifacts__Drowsy-state.png](<https://www.learningeeg.com/images/artifacts/Drowsy-state.webp>) — clinical figure; figure pixels inspected.

Limits: Displayed screen time is a digital ruler; physical paper speed is only a convention. The seconds ruler governs timing after resizing.

### art-rem-eye — Retained

Opposed ocular deflections cluster near8,12–14 and19–20s; low-voltage mixed background without obvious PDR.

Final: Clusters of rapid conjugate eye movements in REM sleep: steep opposite-polarity deflections at F7 and F8 in groups of 2-4 over 1-2 s, on a low-voltage mixed-frequency background without posterior alpha.

Reference comparison: **direct figure**. Clustered rapid ocular shifts with low-voltage mixed activity are plausible.

- [LearningEEG: Lateral eye movement in REM — artifacts__REM-Sleep-ex-3.png](<https://www.learningeeg.com/images/artifacts/REM-Sleep-ex-3.webp>) — clinical figure; figure pixels inspected.

Limits: REM stage needs polysomnographic context; image alone cannot establish state.

### art-chewing — Retained

Repeated high-frequency temporal bursts at roughly1–2Hz, with smaller parasagittal spread and obscured background.

Final: Rhythmic bursts of high-frequency muscle potentials at about 1-2 Hz, maximal in the temporal chains (Fp1-F7 to T5-O1 and Fp2-F8 to T6-O2), obscuring the background during each jaw closure.

Reference comparison: **direct figure**. Temporal high-frequency rhythmic muscle bursts match.

- [LearningEEG: Chewing — artifacts__chewing-artifact-2_1.png](<https://www.learningeeg.com/images/artifacts/chewing-artifact-2_1.webp>) — clinical figure; figure pixels inspected.

Limits: Jaw activity needs video; burst density differs from reference.

### art-glossokinetic — Retained

Broad irregular slow in-phase anterior/parasagittal activity has visible field and no sustained evolution; tongue/video correlation remains required.

Final: Irregular 1-3 Hz slow potentials from tongue movement, in phase over both hemispheres and broad, from the frontotemporal to the posterior chains, unlike the opposed field of lateral eye movements. It can mimic diffuse delta; its irregularity and lack of evolution help.

Reference comparison: **direct figure**. Broad anterior slow tongue-like potentials match qualitatively.

- [LearningEEG: Hypoglossal artifact — artifacts__Tongue-Artifact.png](<https://www.learningeeg.com/images/artifacts/Tongue-Artifact.webp>) — clinical figure; figure pixels inspected.

Limits: Exact tongue movement and phase cannot be verified without video.

### art-electrode-pop — Retained

Abrupt paired opposite T3-T5/T5-O1 transients and recovery with no cerebral field.

Final: Abrupt vertical deflections with exponential decay confined to the two derivations that share T5 (T3-T5 and T5-O1, mirror images), with no field in neighbouring chains.

Reference comparison: **direct figure**. Abrupt opposite paired derivations and recovery match electrode-local events.

- [LearningEEG: F7 electrode pop — artifacts__F7-Electrode-Pop_1.png](<https://www.learningeeg.com/images/artifacts/F7-Electrode-Pop_1.webp>) — clinical figure; figure pixels inspected.

Limits: Reference F7 versus gallery T5; localization differs appropriately.

### art-sixty-hz — Retained

Dense continuous line interference correctly involves Fp2,F3,C4 derivations; clean unaffected chains; header notch off is fixed.

Final: With the notch filter off, a dense uniform 60 Hz band thickens the traces of the derivations that contain the high-impedance electrodes (here Fp2, F3 and C4); derivations without them are clean.

Reference comparison: **direct figure**. Continuous dense electrode-local interference matches.

- [LearningEEG: Notch Filter Off — montages__clean__60hz-artifact.png](<https://www.learningeeg.com/images/montages/clean/60hz-artifact.webp>) — clinical figure; figure pixels inspected.

Limits: Exact 60 Hz comes from signal/spec and seconds scale, not appearance alone.

### art-ecg — Retained

Small posterior/midline sharp deflections recur with ECG QRS; ancillary channel makes timing comparison feasible.

Final: A small sharp transient on every beat, time-locked to the QRS in the ECG channel, clearest in the posterior and midline chains (T5-O1, P3-O1, Cz-Pz, C4-P4). Its regularity and fixed relation to the QRS mark it as artifact.

Reference comparison: **direct figure**. Repetitive sharp contamination is time-locked to the displayed QRS.

- [LearningEEG: ECG artifact — artifacts__ECG-artifact-on-an-uncalibrated-screen_1.png](<https://www.learningeeg.com/images/artifacts/ECG-artifact-on-an-uncalibrated-screen_1.webp>) — clinical figure; figure pixels inspected.

Limits: Reference has different electrode distribution and an uncalibrated screen.

### art-pulse — Retained

Slow delayed Cz-localized wave with Fz-Cz/Cz-Pz inversion follows ECG; other chains preserved.

Final: A smooth slow wave filling each R-R interval at one electrode (Cz): Fz-Cz and Cz-Pz are mirror images, every other chain is clean, and each wave follows the QRS in the ECG channel by a fixed delay.

Reference comparison: **direct figure**. Delayed Cz-localized broad waves and paired inversions match.

- [LearningEEG: Cardioballistic — artifacts__cardioballistic-artifact-clean.png](<https://www.learningeeg.com/images/artifacts/cardioballistic-artifact-clean.webp>) — clinical figure; figure pixels inspected.

Limits: Source timing correlation supports pulse, but gallery lacks video proof.

### art-sweat — Caption corrected

Slow right frontopolar baseline sway is present at2–4s scale; approximate half-row prominence is less than caption one-row claim.

Final: Very slow (2-4 s) baseline sway in the right frontopolar chains (Fp2-F8, Fp2-F4, F4-C4), with the posterior chains unaffected; it remains visible with the 1 Hz low-frequency filter.

Reference comparison: **direct figure**. Slow restricted baseline sway is plausible; source also contains electrode pop.

- [LearningEEG: Sweat — artifacts__Sweat-and-electrode-pop.png](<https://www.learningeeg.com/images/artifacts/Sweat-and-electrode-pop.webp>) — clinical figure; figure pixels inspected.

Limits: Caption-only correction removes unsupported one-row amplitude. High-pass filtering attenuates such slow waves.

### art-movement — Retained

Irregular changing frontotemporal transients with synchronous muscle; background recoveries and absence of persistent cerebral field visible.

Final: Abrupt, irregular high-amplitude transients over one region at a time, with electrode-to-electrode differences and co-timed muscle; posterior chains stay quiet. The lack of a consistent field or evolution separates it from cerebral activity.

Reference comparison: **direct figure**. Irregular transient fields and concomitant muscle match.

- [LearningEEG: Head shaking — artifacts__shaking-head-artifact_1.png](<https://www.learningeeg.com/images/artifacts/shaking-head-artifact_1.webp>) — clinical figure; figure pixels inspected.

Limits: Reference shakes head; gallery movement subtype requires video.

### art-patting — Retained

Posterior temporal/parasagittal rhythmic bouts with T5/T6 reversal and preserved intervals; requires patting context to distinguish from cerebral rhythm.

Final: Rhythmic 1-4 Hz slow transients from patting, in bouts, maximal posterior-temporal and parasagittal with a phase reversal at T5/T6; the background between bouts is unchanged.

Reference comparison: **text only**. Widespread rhythmic bouts are compatible with the reference caption.

- [AES developmental EEG atlas — Figure 22 caption only](<https://www.ncbi.nlm.nih.gov/books/NBK390356/figure/f22/>) — text only; figure pixels not claimed inspected.

Limits: Figure pixels were unavailable; posterior reversals and patting source remain an authored scenario.

### art-chest-pt — Retained

3Hz artifact is subtle at Fp2-F8 and buried under broad infant slow background; most prominent visible slow waves are posterior/central.

Final: Rhythmic 3 Hz waves from chest percussion, most prominent in Fp2-F8 and throughout the page, perfectly regular and without evolution, in an ICU infant.

Reference comparison: **direct figure**. Rhythmic non-evolving contamination is compatible.

- [LearningEEG: Chest PT — artifacts__chest-PT-artifact.png](<https://www.learningeeg.com/images/artifacts/chest-PT-artifact.webp>) — clinical figure; figure pixels inspected.

Limits: Gallery artifact is subtler and differently distributed; chest PT attribution needs event/video correlation.

### art-ventilator — Retained

Short anterior oscillation recurs about every2.5s with small homologous copy; parasagittal chains spared.

Final: A brief burst of 5-12 Hz oscillation with every breath at a fixed rate (0.4 Hz, 24/min), focal in Fp1-F7 with a smaller homologous copy, parasagittal chains clean.

Reference comparison: **adjacent figure**. Anterior repetitive non-evolving activity is plausible equipment contamination.

- [LearningEEG: Ventilator artifact — artifacts__ventilator-artifact-water-motion-in-the-tubes.png](<https://www.learningeeg.com/images/artifacts/ventilator-artifact-water-motion-in-the-tubes.webp>) — clinical figure; figure pixels inspected.

Limits: Reference depicts water moving in tubes, not the exact smooth respiratory-cycle subtype modeled here.

### art-ecmo-pump — Retained

Continuous approximately1.5Hz Cz-neighbour/C4 localized rhythm with F4-C4/C4-P4 inversion and no evolution; context identifies pump.

Final: Continuous monotonous rhythmic activity at the pump rate (about 1.5 Hz) in the derivations containing C4 (F4-C4 and C4-P4, mirror images), with no evolution in frequency, amplitude or field, in a neonate on ECMO.

Reference comparison: **text only**. Stable localized 1.5 Hz contamination with no evolution is plausible as an equipment scenario.

- [Cho et al., ECMO cEEG prognostication — Methods: device artifact reduction; text only](<https://pmc.ncbi.nlm.nih.gov/articles/PMC9439883/>) — text only; figure pixels not claimed inspected.

Limits: Primary source confirms ECMO device contamination but provides no matched pump frequency/field image; exact model unvalidated.

### sed-propofol — Retained

Frontal coherent alpha is present, but the slow component is modest for a classic slow-alpha anesthetic exemplar.

Final: Propofol: frontally predominant alpha with large frontal slow waves beneath it, the anesthetic pattern, on a slower background.

Reference comparison: **direct figure**. Alpha with slower activity agrees; gallery slow component is modest, depth uncertain.

- [Purdon Figure 3 — Purdon Figure 3](<https://pmc.ncbi.nlm.nih.gov/articles/PMC4573341/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/d0c4/4573341/aaa54d2cc87b/nihms709731f3.jpg>)

- [Purdon Figure 6 — Purdon Figure 6](<https://pmc.ncbi.nlm.nih.gov/articles/PMC4573341/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/d0c4/4573341/d4ce7d990364/nihms709731f6.jpg>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### sed-midazolam — Retained

Diffuse fast beta over a mixed background is plausible for benzodiazepine exposure; age, amplitude and spatial spread agree with the caption.

Final: Diffuse waxing and waning 14-20 Hz beta dominates every chain after midazolam, exceeding alpha; the posterior rhythm and blinks are absent.

Reference comparison: **adjacent figure**. Fast sedative activity is compatible; figure is propofol rather than midazolam.

- [Purdon Figure 2 — Purdon Figure 2](<https://pmc.ncbi.nlm.nih.gov/articles/PMC4573341/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/d0c4/4573341/beb8ff56238f/nihms709731f2.jpg>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### sed-dexmedetomidine — Retained

Waxing and waning sigma packets on a slow background are compatible with an N2-like dexmedetomidine pattern. No prominent waking eye or muscle activity obscures the cerebral signal.

Final: A sleep-like slow background with 11-15 Hz spindle-like bursts of 1-2 s, frontocentral, at irregular intervals, resembling N2 spindles; no posterior dominant rhythm.

Reference comparison: **direct figure**. Intermittent spindles and slow activity agree; single-channel reference cannot validate spatial field.

- [Purdon Figure 10 — Purdon Figure 10](<https://pmc.ncbi.nlm.nih.gov/articles/PMC4573341/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/d0c4/4573341/e27ef13990d9/nihms709731f10.jpg>)

- [Purdon Figure 11 — Purdon Figure 11](<https://pmc.ncbi.nlm.nih.gov/articles/PMC4573341/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/d0c4/4573341/5d483cf4ef32/nihms709731f11.jpg>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### sed-ketamine — Retained

A short fast burst near 7–8 s is most conspicuous in temporal chains and can still read as muscle artifact despite the prior fixed note. Frequency alone cannot establish cerebral gamma.

Final: Ketamine increases theta and adds low-voltage 25-32 Hz gamma that alternates with slow-delta epochs; alpha and the posterior rhythm are absent.

Reference comparison: **direct figure**. Fast mixed activity agrees; gallery temporal fast burst could include muscle, unresolved.

- [Purdon Figure 9 — Purdon Figure 9](<https://pmc.ncbi.nlm.nih.gov/articles/PMC4573341/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/d0c4/4573341/f00ac1543245/nihms709731f9.jpg>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### sed-remifentanil — Retained

Posterior alpha and repeated frontopolar blinks remain visible, with modest slowing and brief temporal noise. An opioid-alone awake scenario is plausible; behavioral wakefulness is authored context.

Final: With an opioid alone the patient remains awake: the posterior dominant rhythm and blinks persist, with only a modest shift toward slower frequencies.

Reference comparison: **adjacent figure**. Slow sedated background is adjacent physiology; opioid-specific EEG equivalence is unproven.

- [Purdon Figure 2 — Purdon Figure 2](<https://pmc.ncbi.nlm.nih.gov/articles/PMC4573341/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/d0c4/4573341/beb8ff56238f/nihms709731f2.jpg>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### sed-pentobarbital-beta — Retained

Diffuse predominantly 13–16 Hz activity on a slower background, without a prominent posterior rhythm or blinks, is plausible barbiturate-associated fast activity.

Final: Before any discontinuity, pentobarbital adds diffuse 13-16 Hz fast activity over slower background; occipital alpha and blinks are gone.

Reference comparison: **adjacent figure**. Beta-rich sedation is adjacent GABA physiology; no pentobarbital-specific figure inspected.

- [Purdon Figure 2 — Purdon Figure 2](<https://pmc.ncbi.nlm.nih.gov/articles/PMC4573341/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/d0c4/4573341/beb8ff56238f/nihms709731f2.jpg>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### sed-pentobarbital-bs — Retained

Irregular short bursts of sharp, slow and fast activity alternate with longer low-voltage intervals. The page illustrates drug burst suppression; it does not independently establish the whole-record 60% target.

Final: Pentobarbital titrated to 60 % suppression: 1-2 s bursts of polyphasic sharp and slow waves separated by irregular suppressions below 10 uV that still carry low-voltage residual activity.

Reference comparison: **adjacent figure**. Burst suppression morphology agrees; reference uses propofol rather than pentobarbital.

- [Purdon Figure 6 — Purdon Figure 6](<https://pmc.ncbi.nlm.nih.gov/articles/PMC4573341/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/d0c4/4573341/d4ce7d990364/nihms709731f6.jpg>)

- [Purdon Figure 8 — Purdon Figure 8](<https://pmc.ncbi.nlm.nih.gov/articles/PMC4573341/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/d0c4/4573341/f3449fcf6868/nihms709731f8.jpg>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### sed-propofol-bs — Retained

Irregular burst durations and intervals, mixed sharp/alpha/slow content and low-voltage suppressions are plausible for deep propofol exposure.

Final: Deep propofol with a high suppression target: irregular 1-2 s bursts of sharp, alpha and slow activity separated by suppressions below 10 uV.

Reference comparison: **direct figure**. Abrupt bursts alternating with markedly suppressed periods agree.

- [Purdon Figure 6 — Purdon Figure 6](<https://pmc.ncbi.nlm.nih.gov/articles/PMC4573341/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/d0c4/4573341/d4ce7d990364/nihms709731f6.jpg>)

- [Purdon Figure 8 — Purdon Figure 8](<https://pmc.ncbi.nlm.nih.gov/articles/PMC4573341/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/d0c4/4573341/f3449fcf6868/nihms709731f8.jpg>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### sed-blockade-seizure — Retained

Evolving left temporal and parasagittal sharp theta with amplitude growth, preserved contralateral background and negligible muscle artifact makes the seizure recognizable. Paralysis is authored clinical context.

Final: A left hemispheric seizure 30 s after onset in a paralysed child: rhythmic 4-6 Hz activity over the left temporal and parasagittal chains, building in amplitude, free of the muscle artifact a clinical seizure would carry. Blockade removes scalp EMG only; the cerebral discharge is unchanged.

Reference comparison: **adjacent figure**. Evolving focal rhythmic activity has adjacent seizure evidence; neuromuscular blockade is not visually verifiable.

- [Neonatal Figure 8 — Neonatal Figure 8](<https://pmc.ncbi.nlm.nih.gov/articles/PMC2811985/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/04e5/2811985/c68180630cd3/AIAN-12-58-g008.jpg>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### slw-focal-polymorphic — Retained

Regional slowing numerically present: F7-T3 delta RMS6.76uV vsF8-T4 3.32, fractions69% vs29%; visually subtle against larger posterior theta. Renderer0.5.3 is implemented.

Final: Irregular 1-3 Hz polymorphic delta confined to the left temporal chain (Fp1-F7, F7-T3, T3-T5) with the parasagittal chains and the right side preserved - a regional structural abnormality.

Reference comparison: **direct figure**. Left temporal irregular delta field matches at lower visual prominence.

- [LearningEEG: Intermittent on continuous left temporal delta — left-temporal-slowing.png](<https://www.learningeeg.com/images/nonepileptiform/tinc-left-temporal-slowing.webp>) — clinical figure; figure pixels inspected.

Limits: Retain: quantitative delta RMS 6.76 versus 3.32 µV supports subtle lateralization. Reference is more conspicuous; clinical severity cannot be matched.

### slw-generalized — Retained

Diffuse irregular delta/theta without PDR; prominent temporal muscle during0–4 and11–14s obscures slowing.

Final: Diffuse continuous 2-4 Hz delta-theta activity over both hemispheres with no posterior dominant rhythm, in a child with encephalopathy; the background remains reactive.

Reference comparison: **adjacent figure**. Diffuse irregular slowing agrees with the reference background component.

- [LearningEEG: Inconsistent GPDs with triphasic morphology — tinyc-mod-gen-slowing-with-triphasics.png](<https://www.learningeeg.com/images/nonepileptiform/tinyc-mod-gen-slowing-with-triphasics.webp>) — clinical figure; figure pixels inspected.

Limits: Reference contains triphasic discharges absent here; gallery muscle partly obscures background.

### slw-hemi-attenuation — Retained

Stable lower right hemisphere voltage across both chains, with preserved frequency and diminished posterior rhythm.

Final: Persistently lower voltage across every derivation of the right hemisphere (about half the left), without added slowing; the posterior rhythm is reduced on the same side.

Reference comparison: **schematic**. Stable right lower amplitude matches the marked asymmetry concept.

- [ACNS 2021 terminology — Figure 1](<https://www.acns.org/UserFiles/file/ACNSStandardizedCriticalCareEEGTerminology_rev2021.pdf#page=4>) — schematic; figure pixels inspected.

Limits: Schematic is sinusoidal and referential; gallery bipolar field/etiology not directly matched to a patient.

### slw-attenuation-transient — Retained

Left faster activity and amplitude thin after10s while right remains comparable to prechange; static page cannot itself establish ischemia.

Final: Ten seconds into the page the left hemisphere abruptly loses voltage and its faster frequencies (F7-T3, T3-T5, C3-P3 and Fp1-F7 thin out over about 6 s) while some delta is spared, as in acute ischemia; the right hemisphere is unchanged.

Reference comparison: **schematic**. Left voltage loss after 10 s is visually clear.

- [ACNS 2021 terminology — Figure 1](<https://www.acns.org/UserFiles/file/ACNSStandardizedCriticalCareEEGTerminology_rev2021.pdf#page=4>) — schematic; figure pixels inspected.

Limits: Reference covers asymmetry, not ischemic onset; ischemia is scenario context and not diagnosable from this still.

### slw-breach — Retained

Left F3-C3/C3-P3 amplitude increased with sharp fast contours; spatial extent is plausible for stated central defect.

Final: Over a left central skull defect (C3 and neighbours) the background is about twice the voltage of the homologous right side, with accentuated sharply contoured beta; this should not be read as epileptiform.

Reference comparison: **text only**. Left central higher-amplitude sharpened fast activity is compatible with a skull-defect effect.

- [ACNS 2021 terminology — Section 10 breach effect](<https://www.acns.org/UserFiles/file/ACNSStandardizedCriticalCareEEGTerminology_rev2021.pdf#page=8>) — text only; figure pixels not claimed inspected.

Limits: No matched clinical breach figure inspected; exact defect contour is a scenario assumption.

### slw-low-voltage — Retained

Continuous tiny featureless mixed activity below calibration20uV; low-voltage morphology plausible.

Final: Continuous but mostly below 20 uV in every derivation, a featureless mixed slow background with no posterior dominant rhythm, unreactive.

Reference comparison: **text only**. Very low continuous voltage is compatible with the defined category.

- [ACNS 2021 terminology — Section 8 voltage](<https://www.acns.org/UserFiles/file/ACNSStandardizedCriticalCareEEGTerminology_rev2021.pdf#page=7>) — text only; figure pixels not claimed inspected.

Limits: Definition reviewed on PDF page 7; no direct low-voltage patient figure comparison.

### slw-suppressed — Retained

Tiny residual activity at3uV/mm, below10uV; suppression is clear.

Final: All activity below 10 uV throughout the page, featureless and unreactive; shown at the higher sensitivity of 3 uV/mm, where only low-amplitude residual activity is seen.

Reference comparison: **schematic**. Tiny continuous residual activity resembles the suppressed schematic class.

- [ACNS 2021 terminology — Figure 2](<https://www.acns.org/UserFiles/file/ACNSStandardizedCriticalCareEEGTerminology_rev2021.pdf#page=5>) — schematic; figure pixels inspected.

Limits: Amplitude depends on the calibration; residual artifacts need not be zero. Static image does not establish cause.

### slw-burst-suppression — Retained

Two mixed-frequency generalized bursts with low residual intervals occupying majority of20s; low noise is plausible, not required to add artifact.

Final: Generalized bursts of mixed slow and sharp activity separated by suppressions below 10 uV occupying most of the page, in an unreactive child without sedation.

Reference comparison: **direct figure**. Generalized mixed bursts separated by long low-voltage intervals match.

- [ACNS 2021 supplemental EEG examples — EEG 2](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=3>) — clinical figure; figure pixels inspected.

Limits: Clean gallery suppression is plausible; duration distribution and etiology differ between records.

### slw-discontinuous — Retained

Approx4–5s low-voltage period within20s (minority), background mixed slow; discontinuity distinction visible.

Final: Periods of attenuation interrupt an otherwise slow background for a minority of the page (ACNS discontinuous: 10-49 % attenuation or suppression), in an encephalopathic child.

Reference comparison: **direct figure**. Clear lower-voltage intervals interspersed with mixed slow activity match the pattern class.

- [LearningEEG: Discontinuity with severe generalized slowing — discont_slow.png](<https://www.learningeeg.com/images/nonepileptiform/tinyc-Discontinuity-with-gen-slowing.webp>) — clinical figure; figure pixels inspected.

Limits: Reference age unknown and source more severe; gallery has a minority low-voltage interval, not burst suppression.

### slw-cape — Retained

Amplitude/state contrast at13s visible; caption supplies longer six-cycle record context, which single page cannot prove.

Final: The background alternates between an attenuated phase and a higher-voltage slow phase every 20 s (40 s cycle); this 30-s page starts in the attenuated phase and the higher-voltage phase returns at about 13 s. The pattern repeats for more than six cycles (ACNS CAPE).

Reference comparison: **schematic**. Two contrasting background segments illustrate one state transition.

- [ACNS 2021 terminology — Figure 9](<https://www.acns.org/UserFiles/file/ACNSStandardizedCriticalCareEEGTerminology_rev2021.pdf#page=8>) — schematic; figure pixels inspected.

Limits: CAPE requires longer cycling context; one 20 s image cannot prove six cycles. Caption supplies the longer scenario.

### slw-spindle-coma — Caption corrected

Frontocentral12–14Hz spindles and K/vertex transients at~13 and19s visible; caption13–15s includes spindle period and should localize K precisely.

Final: Frontocentral 12-14 Hz spindles, vertex waves and K-complexes near 13 s and 19 s in an unresponsive child. Unreactivity and absent sleep-wake cycling are clinical and longer-record context for this synthetic example.

Reference comparison: **text only**. Frontocentral spindle bursts on slowing are compatible with the case report concept.

- [Nowack et al. Coexisting alpha, theta and spindle coma — Primary case report abstract only](<https://pubmed.ncbi.nlm.nih.gov/3594924/>) — text only; figure pixels not claimed inspected.

Limits: No direct clinical figure inspected; coma/reactivity are clinical context. Caption corrected K-complex locations to about 13 and 19 s.

### slw-alpha-coma — Retained

Frontal alpha dominates over smaller posterior activity, monotonous morphology; coma/unreactivity are scenario context not inferable from snapshot.

Final: Diffuse, frontally predominant, monotonous alpha-frequency activity with no posterior dominant rhythm, no variability and no reactivity, in a comatose adolescent.

Reference comparison: **text only**. Monotonous frontal alpha predominance is compatible with the described coma pattern.

- [Alpha coma EEG pattern in severe COVID encephalopathy — Figures 1–2 captions only; pixels not inspected](<https://pmc.ncbi.nlm.nih.gov/articles/PMC7527310/>) — text only; figure pixels not claimed inspected.

Limits: Figure captions were read, pixels not viewed; coma and absence of reactivity cannot be established by a still.

### slw-hypothermia — Revised image

Bilateral spectral fading and ADR reduction around10–30min agree with caption; linked45min raw page lower voltage; cooling is scenario-specific, not universal quantitative response.

Final: Cooling from 36.5 to 33 C between 10 and 30 minutes fades the alpha band and the alpha/delta ratio falls from about 1 to 0.45. The page, at target temperature, is lower in voltage and slower, with little posterior dominant rhythm.

Reference comparison: **adjacent figure**. Bilateral spectral power fades with a low-amplitude linked raw page.

- [ACNS 2021 supplemental EEG examples — EEG 30](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=36>) — clinical figure; figure pixels inspected.

- [Clinical EEG for Anesthesiologists and Intensivists, Part 2 — Figure 2 and cooling spectrogram captions only](<https://pubmed.ncbi.nlm.nih.gov/41537509/>) — text only; figure pixels not claimed inspected.

Limits: Viewed CSA source is an IIC case, not cooling; cooling source was caption-only. Exact temperature/drug response is illustrative.

### iid-left-temporal-spike-slow — Retained

Left T3 reversal and aftergoing slow wave visible; mixed child awake background and intermittent temporal EMG plausible.

Final: Abundant (about one per 5 s) spikes at T3, each followed by a slow wave, phase-reversing at T3 between F7-T3 and T3-T5, on an awake child background with temporal muscle artifact.

Reference comparison: **adjacent figure**. Matching pointed spike/aftergoing slow wave and temporal reversal; hemisphere differs. Synthetic mixed pediatric background and intermittent muscle are plausible but more active than the reference.

- [Right temporal spike with slow wave/background interruption — TEMP](<https://www.learningeeg.com/epileptiform>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/epileptiform/spike-criteria-4-6-background-duration.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### iid-right-temporal-spike-no-slow — Retained

Brief T4 discharges without a consistent aftergoing slow wave; N2 vertex and spindle distinct from spikes.

Final: Brief spikes (<70 ms) at T4 with no after-going slow wave, phase-reversing at T4 between F8-T4 and T4-T6, in N2 sleep (vertex wave at 6.6 s, spindle at 9 s).

Reference comparison: **adjacent figure**. T4 spatial reversal agrees; the reference has a conspicuous slow wave, deliberately absent from this example. Reduced specificity without a slow wave should be explained by field and repeated discrete morphology.

- [Right temporal spike with slow wave/background interruption — TEMP](<https://www.learningeeg.com/epileptiform>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/epileptiform/spike-criteria-4-6-background-duration.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### iid-anterior-temporal-sharp-f8 — Retained

F8 maximum and Fp2-F8/F8-T4 reversal clear; broader sharp waves with slow waves and N2 transient plausible.

Final: Sharp waves (70-200 ms) with an after-going slow wave, maximal at F8, phase-reversing between Fp2-F8 and F8-T4 in the right temporal chain (3, 5.3, 7 and 10 s), in N2 sleep; the diffuse transient at 8.8 s is a vertex wave.

Reference comparison: **direct figure**. Same anterior-temporal negative reversal region with aftergoing slow wave; authored broader sharp duration differs from the sharper reference. Similar sleep context, without copying its bad T3 artifact.

- [Right anterior temporal spike and wave — F8T2](<https://www.learningeeg.com/epileptiform>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/epileptiform/5e7b6d9fd734b6ff0df80a61_more-right-temporal-spike_1.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### iid-mesial-temporal-t2 — Retained

T2 reversal stronger than conventional right temporal endpoints; low-voltage background is possible, though this crop carries little independent N2 evidence.

Final: Right mesial (subtemporal) temporal spikes on the longitudinal montage with T1/T2: the phase reversal is at T2 (F8-T2 against T2-T4), with smaller deflections in Fp2-F8 and T4-T6; the standard temporal chain alone would under-show them.

Reference comparison: **direct figure**. T2-containing chains correctly accentuate anterior/inferior temporal field. Both scalp examples support regional localization, not proof of a mesial generator.

- [Right anterior temporal spike and wave — F8T2](<https://www.learningeeg.com/epileptiform>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/epileptiform/5e7b6d9fd734b6ff0df80a61_more-right-temporal-spike_1.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### iid-left-frontal-spike — Retained

F3 reversal and smaller F7/midline field visible; spindle and vertex morphology plausible for child N2.

Final: Spikes with an after-going slow wave maximal at F3, phase-reversing at F3 between Fp1-F3 and F3-C3 in the left parasagittal chain, with a smaller field at F7 and Fz, in N2 sleep.

Reference comparison: **adjacent figure**. Anatomically coherent focal frontal spike and smaller surrounding field; reference is frontopolar/right or mixed Fp1 rather than isolated F3. Left F3 reversal remains plausible.

- [Frontopolar/frontal spike field — FRONT](<https://www.learningeeg.com/epileptiform>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/epileptiform/5e7b7024f3fbc1514e68bc17_spike-at-Fp2_1.webp>)

- [Multifocal discharges and focal PFA in slow sleep — MULTI](<https://www.learningeeg.com/epileptiform>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/epileptiform/5e7d06858a3130bbd1c316a7_T6-Fp1-sharps-plus-left-frontal-fast-activity.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### iid-left-central-spike — Caption corrected

C3 reversal is correct, but caption timestamps do not match the displayed sample: visible discharges approximately 2.7, 5.6, 8.9, 12 and 13.2 s.

Final: Spikes maximal at C3, phase-reversing at C3 between F3-C3 and C3-P3 (several independent discharges across the page), with little involvement of the temporal chain, in N2 sleep.

Reference comparison: **adjacent figure**. C3 reversal compares to C4 central components, with different hemisphere and without requiring a rolandic dipole. Revised caption removes erroneous fixed timestamps; sleep transients remain distinct.

- [C4/T4 spikes in sleep — CT](<https://www.learningeeg.com/epileptiform>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/epileptiform/5ed66ba438e40988d45ff3ba_C4-and-T4-spikes.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### iid-centrotemporal-selects-n2 — Retained

Right C4 and T4 reversals visible on normal N2 architecture. This is unilateral, consistent with SeLECTS, but does not satisfy the newly requested bilateral paired illustration by itself.

Final: Abundant right centrotemporal spikes in N2 sleep, phase-reversing at C4 (F4-C4 / C4-P4) and at T4 (F8-T4 / T4-T6), with a horizontal dipole (frontal positivity). Sleep spindles and vertex waves are present.

Reference comparison: **direct figure**. Centrotemporal negative reversal and sleep activation agree. Earlier simple asymmetric waveform is a regional-spike teaching example; paired new examples supply the fuller classic tangential triphasic dipole.

- [C4/T4 spikes in sleep — CT](<https://www.learningeeg.com/epileptiform>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/epileptiform/5ed66ba438e40988d45ff3ba_C4-and-T4-spikes.webp>)

- [ILAE centrotemporal tangential dipole in paired montages — SELECTS](<https://www.epilepsydiagnosis.org/syndrome/ects-eeg.html>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.epilepsydiagnosis.org/img/CTspikes_Bipolar_30mV_30mm.jpg>)
  [Figure](<https://www.epilepsydiagnosis.org/img/CTspikes_Ref_30mV_30mm.jpg>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### iid-left-occipital-spike — Retained

O1 end-of-chain negativity represented in both left posterior chains without fictitious beyond-O1 reversal; plausible sleep background.

Final: Spikes maximal at O1, seen at the ends of the left temporal (T5-O1) and parasagittal (P3-O1) chains: with no electrode beyond O1 there is no phase reversal, and the focus is read from the end-of-chain maximum.

Reference comparison: **direct figure**. Same O1 region and pointed discharge; reference circumferential montage shows the reversal that longitudinal bipolar cannot. Gallery end-of-chain deflection is therefore expected, not missing physiology.

- [Circumferential O1 phase reversal — O1](<https://www.learningeeg.com/epileptiform>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/epileptiform/phase-reversal-o1-circumferential-annotated.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### iid-right-central-polyspike — Retained

Right central brief multispike bursts and slow waves visible; long bilateral spindle partly overlays later discharge but does not prevent recognition.

Final: Polyspikes (brief trains of several spikes) with an after-going slow wave, maximal at C4 and seen across the right parasagittal chain (Fp2-F4 to P4-O2) in N2 sleep; a sleep spindle runs at 8-10 s.

Reference comparison: **adjacent figure**. Central spatial field is compared with CT spikes, and multiple contiguous sharp components with generalized JME morphology. Neither figure is an exact focal C4 polyspike case; do not infer a syndrome.

- [C4/T4 spikes in sleep — CT](<https://www.learningeeg.com/epileptiform>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/epileptiform/5ed66ba438e40988d45ff3ba_C4-and-T4-spikes.webp>)

- [JME generalized spike/polyspike-wave burst — JME](<https://www.learningeeg.com/pediatric>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/pediatric/4-6-Hz-spike-and-waves-with-JME-annotated.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### iid-multifocal-spikes — Retained

Different times and distinct temporal, frontal, central and occipital fields establish multifocal independence; appropriate N2 context.

Final: Independent spikes from four foci (T3, F4, O2, C3), each with its own field and firing at different times, in N2 sleep: multifocal independent sporadic discharges.

Reference comparison: **direct figure**. Distinct times/fields rather than simultaneous generic spikes agree with the clinical multifocal page; synthetic background is less disorganized than the LGS reference, appropriate for a generic focal-discharge lesson.

- [Multifocal discharges and focal PFA in slow sleep — MULTI](<https://www.learningeeg.com/epileptiform>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/epileptiform/5e7d06858a3130bbd1c316a7_T6-Fp1-sharps-plus-left-frontal-fast-activity.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### iid-referential-t4 — Retained

T4 ear-reference spike maximum with graded neighboring field and no bipolar reversal; large child vertex transient is separately described.

Final: The same kind of T4 spike on a referential (ear) montage: the discharge is largest at T4 and falls off at F8 and T6, with no phase reversal; amplitude, not reversal, localizes it here. The large diffuse wave at 2.4 s is a vertex wave of N2 sleep.

Reference comparison: **adjacent figure**. T4 voltage maximum with surrounding field agrees with temporal spike and referential dipole principles, but linked-ear reference and isolated temporal generator differ from the inspected reference montages.

- [Right temporal spike with slow wave/background interruption — TEMP](<https://www.learningeeg.com/epileptiform>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/epileptiform/spike-criteria-4-6-background-duration.webp>)

- [ILAE centrotemporal tangential dipole in paired montages — SELECTS](<https://www.epilepsydiagnosis.org/syndrome/ects-eeg.html>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.epilepsydiagnosis.org/img/CTspikes_Bipolar_30mV_30mm.jpg>)
  [Figure](<https://www.epilepsydiagnosis.org/img/CTspikes_Ref_30mV_30mm.jpg>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### iid-birds-right-temporal — Retained

Approximately 7-second right temporal >4-Hz rhythmic run on slow background with no clear evolution; cautious possible-BIRDs label is appropriate.

Final: A 4-5 Hz rhythmic run lasting about 7 s over the right temporal chain (F8-T4 / T4-T6), shorter than 10 s and without evolution: BIRDs (possible), on a slow ICU background.

Reference comparison: **direct figure**. Brief right-temporal sharply contoured train and restricted field agree; gallery frequency is faster and approximately 7 seconds, still sub-10-second. Scalp field distinguishes it from temporal muscle.

- [Right temporal brief rhythmic discharge — BIRDS](<https://www.learningeeg.com/atlas>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/rhythmicity-periodicity/birds-clean.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### iid-birds-evolving — Retained

Sub-10-second left temporal run increases in frequency and voltage with a coherent local field; definite evolving BIRDs is plausible.

Final: A brief (<10 s) left temporal run that changes in frequency and voltage during the run: BIRDs with evolution (definite BIRDs).

Reference comparison: **adjacent figure**. Short focal train is visually anchored by BIRDs references; progressive change in frequency/amplitude is compared with seizure evolution. No exact evolving-left-temporal BIRDs clinical figure was found in the inspected subset.

- [Right temporal brief rhythmic discharge — BIRDS](<https://www.learningeeg.com/atlas>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/rhythmicity-periodicity/birds-clean.webp>)

- [Possible left temporoparietal BIRDs — POSSBIRDS](<https://www.learningeeg.com/atlas>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/rhythmicity-periodicity/possible-birds-ty-clean.webp>)

- [Three-page left anterior temporal seizure evolution — TEMPSEIZ](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/l-temporal-focal-seizure-tabs-annotated/p1.webp>)
  [Figure](<https://www.learningeeg.com/images/seizures/l-temporal-focal-seizure-tabs-annotated/p2.webp>)
  [Figure](<https://www.learningeeg.com/images/seizures/l-temporal-focal-seizure-tabs-annotated/p3.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### szf-mesial-temporal-left — Caption corrected

Left anterior temporal theta recruitment begins around 3 s and grows, consistent with the repaired r9 target. Caption simultaneously says present from the first second, which conflicts with the preictal baseline.

Final: Onset of a left mesial temporal seizure at 3 s: rhythmic 7 Hz theta that is present from the first ictal second, maximal in Fp1-F7 and F7-T3 (anterior temporal), without a low-voltage fast onset, slowing slightly over the page.

Reference comparison: **adjacent figure**. Left anterior-temporal recruitment and changing rhythm agree, but gallery begins with theta while the clinical example has a delta/spike-wave precursor. Caption now describes the first ictal second; scalp pattern does not prove mesial origin.

- [Three-page left anterior temporal seizure evolution — TEMPSEIZ](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/l-temporal-focal-seizure-tabs-annotated/p1.webp>)
  [Figure](<https://www.learningeeg.com/images/seizures/l-temporal-focal-seizure-tabs-annotated/p2.webp>)
  [Figure](<https://www.learningeeg.com/images/seizures/l-temporal-focal-seizure-tabs-annotated/p3.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### szf-neocortical-temporal-right — Retained

Right temporal fast onset around 3 s slows and gains voltage into theta; correct local field and variable noisy background.

Final: Right neocortical temporal onset: low-voltage fast activity appears over T4 (F8-T4, T4-T6) at about 3 s, then slows and builds into a 5-6 Hz rhythmic run in the right temporal chain by 10-20 s.

Reference comparison: **adjacent figure**. Right temporal restricted onset and fast recruitment are plausible; inspected right-temporal clinical example begins slower. Neither scalp morphology nor a synthetic region label establishes neocortical anatomy.

- [Right temporal seizure before bilateral propagation, first page — RTSPREAD](<https://www.learningeeg.com/atlas>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/atlas-r-temporal-to-bilateral-tcs/p1.webp>)

- [Tonic seizure with subtle left lead-in — TONIC](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/tinyc-tonic-seizure-subtle-left-predominance-maybe.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### szf-temporal-evolution — Retained

Long page demonstrates left temporal fast-to-theta-to-slower evolution and voltage increase; sleep transients later do not erase the ictal field.

Final: The first 28 s of a left temporal seizure on one 30-s page: low-voltage fast activity in the left temporal chain becomes rhythmic 6-7 Hz activity, then slows toward 3 Hz while its voltage roughly triples: evolution in frequency and amplitude, the feature that separates a seizure from a rhythmic pattern.

Reference comparison: **direct figure**. Long page demonstrates organization, amplitude/frequency change and field recruitment like the clinical three-page sequence. The time course is compressed and background differs; evolution should be judged in calibrated seconds.

- [Three-page left anterior temporal seizure evolution — TEMPSEIZ](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/l-temporal-focal-seizure-tabs-annotated/p1.webp>)
  [Figure](<https://www.learningeeg.com/images/seizures/l-temporal-focal-seizure-tabs-annotated/p2.webp>)
  [Figure](<https://www.learningeeg.com/images/seizures/l-temporal-focal-seizure-tabs-annotated/p3.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### szf-frontal-left — Revised image

Left frontal decrement and fast recruitment clear at 5-9 s, but pre-existing dense left frontal EMG also vanishes exactly during decrement then returns, unlike neuronal suppression alone.

Final: Left frontal onset: at 5 s the left frontal region attenuates (electrodecrement) and carries low-voltage fast activity in Fp1-F7, F7-T3 and F3-C3; at 9-10 s high-voltage rhythmic activity builds over the left frontal and temporal chains.

Reference comparison: **adjacent figure**. Frontal focal field and sustained fast recruitment are compared with the clinical anterior-quadrant/tonic examples. The revised 0.5.4 page preserves baseline muscle during neural decrement; exact decrement onset is not matched by FRSEIZ.

- [Left anterior quadrant rhythmic-spike seizure — FRSEIZ](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/tinym-L-anterior-quadrant-seizure-with-several-RNS-spikes-within-it.webp>)

- [Tonic seizure with subtle left lead-in — TONIC](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/tinyc-tonic-seizure-subtle-left-predominance-maybe.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### szf-central-left — Retained

Left C3 sharply contoured 5-6-Hz onset around 5 s with voltage growth and little temporal spread; clinical clonic correlate is authored context, not demonstrated by EEG alone.

Final: Abrupt onset at 5 s of rhythmic 5-6 Hz sharply contoured activity at C3, phase-reversing between F3-C3 and C3-P3 and building in voltage over the next seconds, with little spread to the temporal chain; the seizure has a focal clonic correlate.

Reference comparison: **adjacent figure**. Left parasagittal rhythmic spikes and focal recruitment agree with an anterior-quadrant seizure; isolated C3 onset is an adjacent field rather than the identical clinical pattern.

- [Left anterior quadrant rhythmic-spike seizure — FRSEIZ](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/tinym-L-anterior-quadrant-seizure-with-several-RNS-spikes-within-it.webp>)

- [C4/T4 spikes in sleep — CT](<https://www.learningeeg.com/epileptiform>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/epileptiform/5ed66ba438e40988d45ff3ba_C4-and-T4-spikes.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### szf-occipital-right — Retained

Right O2 end-of-chain fast spiky onset at about 5.5 s then theta evolution/voltage growth; r9 repair matches caption.

Final: Right occipital onset at 5.5 s: fast rhythmic spiky activity at O2 at the ends of the right temporal and parasagittal chains (T6-O2, P4-O2), slowing to theta and building over the following seconds.

Reference comparison: **adjacent figure**. Posterior fast/spiky end-of-chain recruitment is compared with left occipital onset; hemisphere differs and only the first clinical onset page was inspected. Definitive occipital localization requires additional montage/context.

- [Left occipital ictal onset, bipolar first page — OCCSEIZ](<https://www.learningeeg.com/atlas>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/o1-onset-seizure-bipolar/p1.webp>)

- [Circumferential O1 phase reversal — O1](<https://www.learningeeg.com/epileptiform>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/epileptiform/phase-reversal-o1-circumferential-annotated.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### szf-parietal-right — Retained

Right posterior parasagittal fast onset around 5.5 s evolves into theta with voltage growth and plausible adjacent T4-T6 field.

Final: Right parietal onset at 5.5 s: low-voltage fast activity at P4 (C4-P4, P4-O2, T4-T6) that slows into rhythmic theta and builds in voltage over the right parasagittal chain.

Reference comparison: **adjacent figure**. Posterior parasagittal recruitment is plausible relative to posterior-quadrant sharp-alpha activity; the clinical first page is left temporo-occipital, not a verified isolated P4 onset.

- [Left posterior quadrant ictal onset, first page — POSTSEIZ](<https://www.learningeeg.com/atlas>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/atlas-l-posterior-quadrant-seizure/p1.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### szf-hemispheric-spread — Revised image

Contralateral ictal activity now exists (r9 repair successful), but the crop begins 60 s into the 110-s event and is bilateral throughout; it does not display the captioned temporal-to-hemispheric-to-bilateral recruitment.

Final: A right temporal seizure already in progress recruits the right hemisphere and then the left, with increasing voltage and muscle artifact. This 30-second page spans the transition toward bilateral activity.

Reference comparison: **adjacent figure**. Revised 30-second page now shows sustained right-sided ictal activity before clear contralateral recruitment around 10-12 seconds. References anchor focal recruitment and later diffuse activity; no single inspected clinical page exactly matches this transition.

- [Right temporal seizure before bilateral propagation, first page — RTSPREAD](<https://www.learningeeg.com/atlas>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/atlas-r-temporal-to-bilateral-tcs/p1.webp>)

- [Three-page left anterior temporal seizure evolution — TEMPSEIZ](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/l-temporal-focal-seizure-tabs-annotated/p1.webp>)
  [Figure](<https://www.learningeeg.com/images/seizures/l-temporal-focal-seizure-tabs-annotated/p2.webp>)
  [Figure](<https://www.learningeeg.com/images/seizures/l-temporal-focal-seizure-tabs-annotated/p3.webp>)

- [Three-page generalized tonic-clonic sequence — GTC](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/gtc-at-20uv-annotated/p1.webp>)
  [Figure](<https://www.learningeeg.com/images/seizures/gtc-at-20uv-annotated/p2.webp>)
  [Figure](<https://www.learningeeg.com/images/seizures/gtc-at-20uv-annotated/p3.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### szf-postictal-attenuation — Retained

Left temporal rhythmic run ends around 7 s and the left posterior temporal amplitude is lower afterward than the right; residual bilateral EMG remains plausible.

Final: The end of a left temporal seizure: the rhythmic 2 Hz run in the left temporal chain stops at about 7 s and is followed by lower-voltage, slower activity over the left temporal region (T3-T5, T5-O1) compared with the right.

Reference comparison: **adjacent figure**. Offset followed by localized attenuation/slowing agrees with recovery principles; generalized postictal attenuation in the clinical GTC is broader and accompanied by more artifact.

- [Three-page left anterior temporal seizure evolution — TEMPSEIZ](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/l-temporal-focal-seizure-tabs-annotated/p1.webp>)
  [Figure](<https://www.learningeeg.com/images/seizures/l-temporal-focal-seizure-tabs-annotated/p2.webp>)
  [Figure](<https://www.learningeeg.com/images/seizures/l-temporal-focal-seizure-tabs-annotated/p3.webp>)

- [Three-page generalized tonic-clonic sequence — GTC](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/gtc-at-20uv-annotated/p1.webp>)
  [Figure](<https://www.learningeeg.com/images/seizures/gtc-at-20uv-annotated/p2.webp>)
  [Figure](<https://www.learningeeg.com/images/seizures/gtc-at-20uv-annotated/p3.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### szf-status-electrographic — Retained

Continuous left temporal rhythmic approximately 3-Hz activity on a slow low-voltage contralateral background is plausible. Status duration is supplied by authored 20-minute event, not inferable from the 15-second image alone.

Final: Continuous left temporal rhythmic 2-4 Hz ictal activity in a comatose patient with no clinical correlate, ten minutes into a 20-minute run: electrographic status epilepticus.

Reference comparison: **adjacent figure**. Sustained focal rhythmic morphology is visually coherent with an ongoing temporal seizure. A short crop cannot establish the duration/burden criterion for electrographic status; status is authored in the long recording.

- [Three-page left anterior temporal seizure evolution — TEMPSEIZ](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/l-temporal-focal-seizure-tabs-annotated/p1.webp>)
  [Figure](<https://www.learningeeg.com/images/seizures/l-temporal-focal-seizure-tabs-annotated/p2.webp>)
  [Figure](<https://www.learningeeg.com/images/seizures/l-temporal-focal-seizure-tabs-annotated/p3.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### szf-seizure-cluster-trend — Retained

Approximately eleven to twelve clustered peaks align across right rhythmicity, spectrum and aEEG; left has normal variability without matching ictal peaks.

Final: Three hours of quantitative trends: about a dozen right central seizures roughly every 11 minutes between 0:30 and 2:30, each a seizure-probability peak with a right-sided rhythmicity and spectrogram arch and a rise of the right aEEG; the left trends stay flat.

Reference comparison: **unmatched**. Each panel was visually reviewed: right-sided time-aligned rhythmicity/spectrogram/aEEG excursions coincide with heuristic probability peaks. No directly comparable clinical trend figure was inspected; synthetic probability is a heuristic and raw EEG confirmation remains essential.

No comparable clinical reference figure inspected.

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### szf-hypsarrhythmia — Retained

Disorganized asynchronous large-amplitude delta and independent multifocal spikes/polyspikes, infant age and no PDR; voltage is plausible against 50-uV marker at 20-uV/mm.

Final: Hypsarrhythmia: very high-voltage (often >200 uV), chaotic, asynchronous delta with independent multifocal spikes and polyspikes and no organized background (20 uV/mm).

Reference comparison: **direct figure**. Chaotic asynchronous high-voltage slow activity and independent multifocal spikes agree with the infantile clinical page. Amplitude is assessed using the gallery calibration, not equal pixel height at different sensitivities.

- [Infantile hypsarrhythmia at reduced sensitivity — HYPS](<https://www.learningeeg.com/pediatric>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/pediatric/another-hypsarrhythmia-9mo-M-at-50uV.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### szf-spasm-cluster-hyps — Retained

Cluster around 12 and 22 s has diffuse slow transients and substantial 2-3-second attenuation on disorganized infant background; r9 shallow decrement concern is visually resolved.

Final: Epileptic spasms in a cluster about every 10 s on a hypsarrhythmic background: each (12 s, 22 s) is a generalized high-voltage slow wave followed by a short diffuse attenuation with low-voltage fast activity and a burst of muscle artifact.

Reference comparison: **adjacent figure**. Hypsarrhythmia background plus diffuse slow/decrement/fast spasm complexes is supported by separate inspected figures; the spasm figure itself is not a hypsarrhythmia cluster. Cluster timing is authored rather than empirically matched.

- [Infantile hypsarrhythmia at reduced sensitivity — HYPS](<https://www.learningeeg.com/pediatric>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/pediatric/another-hypsarrhythmia-9mo-M-at-50uV.webp>)

- [Infantile spasm with overriding fast activity — SPASM](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/5ef0f63477aa42095cd8288b_Infantile-Spasm-m.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### szf-tonic-seizure — Retained

Diffuse decrement precedes fast activity that gains voltage, with strong temporal muscle contamination appropriate to tonic stage.

Final: A tonic seizure: diffuse electrodecrement at 4-5.5 s, then generalized paroxysmal fast activity building in voltage over both hemispheres, overlaid by tonic muscle artifact in the temporal chains.

Reference comparison: **adjacent figure**. Diffuse slow/decrement into fast activity with sustained muscle agrees with tonic recruitment. The comparison clinical figure has a subtle left lead-in; a tonic clinical event still needs observed motor correlation.

- [Tonic seizure with subtle left lead-in — TONIC](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/tinyc-tonic-seizure-subtle-left-predominance-maybe.webp>)

- [Three-page generalized tonic-clonic sequence — GTC](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/gtc-at-20uv-annotated/p1.webp>)
  [Figure](<https://www.learningeeg.com/images/seizures/gtc-at-20uv-annotated/p2.webp>)
  [Figure](<https://www.learningeeg.com/images/seizures/gtc-at-20uv-annotated/p3.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### neo-26w-trace-discontinu — Retained

Long interburst intervals of about 5 s and mixed slow/fast bursts are compatible with prematurity. Bursts are less conspicuously high-voltage than the neighboring 30-week page. They appear head-wide synchronous in this excerpt; this cannot establish a synchrony distribution.

Final: Extreme prematurity (26 weeks PMA): high-voltage bursts of delta with superimposed fast activity separated by long, very low-voltage interburst intervals (normal discontinuity for this age).

Reference comparison: **direct figure**. Low interburst activity and active bursts agree; maturation schematic supports long early-prematurity intervals.

- [ACNS PDF page 28 — ACNS PDF page 28](<https://www.acns.org/pdf/guidelines/Guideline-16.pdf>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.acns.org/pdf/guidelines/Guideline-16.pdf#page=28>)

- [Neonatal Figure 2 — Neonatal Figure 2](<https://pmc.ncbi.nlm.nih.gov/articles/PMC2811985/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/04e5/2811985/165ec5c4781e/AIAN-12-58-g002.jpg>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### neo-30w-discontinuous — Retained

Discontinuous bursts and central delta brushes are recognizable. The original selected page has a median derivation whole-page peak-to-peak of 225.6 uV and a maximum of 318.5 uV against a 110-uV background target. This metric includes brush events and differs from the median-across-bursts calibration test.

Final: 30 weeks PMA: discontinuous record, bursts of several seconds separated by low-voltage interburst intervals shorter than at 26 weeks; central delta brushes (fast activity riding a delta wave at C3/C4) sit within the bursts.

Reference comparison: **direct figure**. Discontinuity agrees; gallery selected bursts are large, calibration target interpretation remains uncertain.

- [ACNS PDF page 28 — ACNS PDF page 28](<https://www.acns.org/pdf/guidelines/Guideline-16.pdf>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.acns.org/pdf/guidelines/Guideline-16.pdf#page=28>)

- [Neonatal Figure 2 — Neonatal Figure 2](<https://pmc.ncbi.nlm.nih.gov/articles/PMC2811985/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/04e5/2811985/165ec5c4781e/AIAN-12-58-g002.jpg>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### neo-34w-background — Revised image

The original page is nearly flat between isolated brushes; its median 1-s displayed peak-to-peak is 10.1 uV despite a 50-uV background target and nearly continuous description. It poorly illustrates the intended ongoing mixed background.

Final: 34 weeks PMA, awake/active-sleep-like continuous background: lower-voltage mixed activity with temporal delta brushes, showing a slow wave with riding 10–20 Hz fast activity and phase reversal at T3 or T4.

Reference comparison: **adjacent figure**. Maturity context and brush-on-slow-wave morphology support final continuous mixed background; waveform age differs.

- [Neonatal Figure 2 — Neonatal Figure 2](<https://pmc.ncbi.nlm.nih.gov/articles/PMC2811985/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/04e5/2811985/165ec5c4781e/AIAN-12-58-g002.jpg>)

- [Neonatal Figure 4 — Neonatal Figure 4](<https://pmc.ncbi.nlm.nih.gov/articles/PMC2811985/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/04e5/2811985/ba31957ca827/AIAN-12-58-g004.jpg>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### neo-term-continuous — Retained

Continuous mixed theta/delta without a posterior dominant rhythm or interburst intervals is symmetric and plausible term activite moyenne.

Final: Term neonate (40 weeks PMA): continuous mixed-frequency activity (activite moyenne) of 25-50 uV, symmetric and synchronous, without long interburst periods.

Reference comparison: **direct figure**. Term continuous mixed activity agrees; reference behavioral/polygraphic state is richer.

- [5eda5a3b800a23252764a1c6_likely-active-sleep-in-a-14-day-old-ex-39-week-M.webp — 5eda5a3b800a23252764a1c6_likely-active-sleep-in-a-14-day-old-ex-39-week-M.webp](<https://www.learningeeg.com/neonatal>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/neonatal/5eda5a3b800a23252764a1c6_likely-active-sleep-in-a-14-day-old-ex-39-week-M.webp>)

- [Neonatal Figure 3 — Neonatal Figure 3](<https://pmc.ncbi.nlm.nih.gov/articles/PMC2811985/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/04e5/2811985/3f839e1c0973/AIAN-12-58-g003.jpg>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### neo-trace-alternant — Retained

High-voltage bursts lasting several seconds alternate with visibly present lower-voltage mixed activity of similar duration, consistent with term quiet-sleep trace alternant.

Final: Term quiet sleep: 3-8 s bursts of high-voltage delta alternate with 25-50 uV mixed theta-delta interburst periods of similar length; the interburst is lower but not suppressed.

Reference comparison: **direct figure**. Alternating higher/lower voltage without fully flat interbursts agrees.

- [ACNS PDF page 29 — ACNS PDF page 29](<https://www.acns.org/pdf/guidelines/Guideline-16.pdf>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.acns.org/pdf/guidelines/Guideline-16.pdf#page=29>)

- [5eda61ca88d55a6bc40b3a2c_trace-alternan-14-day-old-ex-39-week-M.webp — 5eda61ca88d55a6bc40b3a2c_trace-alternan-14-day-old-ex-39-week-M.webp](<https://www.learningeeg.com/neonatal>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/neonatal/5eda61ca88d55a6bc40b3a2c_trace-alternan-14-day-old-ex-39-week-M.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### neo-excessive-discontinuity — Retained

The long low-voltage interval near 10–25 s is excessive for a term background. Isolated frontal waves in the interval do not constitute restoration of continuous activity.

Final: A 39-week neonate with interburst intervals longer than 6 s and interburst voltage under 25 uV: excessively discontinuous for age.

Reference comparison: **direct figure**. Prolonged low-voltage interbursts agree; full-record abnormality depends on age and state.

- [ACNS PDF page 30 — ACNS PDF page 30](<https://www.acns.org/pdf/guidelines/Guideline-16.pdf>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.acns.org/pdf/guidelines/Guideline-16.pdf#page=30>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### neo-delta-brushes-32w — Retained

Slow delta with riding fast activity has temporal phase reversals near 5, 7, 9 and 11 s. Brush morphology, field and PMA are appropriate, although the intervening background is low.

Final: Delta brushes at 32 weeks PMA: high-voltage 0.5-1.5 Hz delta waves carrying 10-20 Hz fast activity, occipito-temporal at this age, phase-reversing at T4 (Fp2-T4 against T4-O2, 5 s and 11 s) and at T3 (Fp1-T3 against T3-O1, 7 s and 9 s).

Reference comparison: **adjacent figure**. Fast activity rides slower waves; actual reference waveform is term, schematic supports preterm timing.

- [Neonatal Figure 4 — Neonatal Figure 4](<https://pmc.ncbi.nlm.nih.gov/articles/PMC2811985/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/04e5/2811985/ba31957ca827/AIAN-12-58-g004.jpg>)

- [Neonatal Figure 2 — Neonatal Figure 2](<https://pmc.ncbi.nlm.nih.gov/articles/PMC2811985/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/04e5/2811985/165ec5c4781e/AIAN-12-58-g002.jpg>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### neo-encoches-frontales — Retained

Bilateral, approximately synchronous biphasic frontal sharp waves near 3, 4.8, 7.5, 12.5 and 15.8 s on a mixed background are plausible at 36 weeks PMA.

Final: Frontal sharp transients (encoches frontales): biphasic, 50-150 uV, bilateral and roughly synchronous sharp waves at Fp1/Fp2, normal from 34-35 weeks PMA to term.

Reference comparison: **direct figure**. Synchronous bifrontal biphasic transient agrees; montage changes alter visible polarity.

- [ACNS PDF page 36 — ACNS PDF page 36](<https://www.acns.org/pdf/guidelines/Guideline-16.pdf>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.acns.org/pdf/guidelines/Guideline-16.pdf#page=36>)

- [5ecef700dc81feff5736c399_encoches-frontales-in-a-12-day-old-ex-39-week-M.webp — 5ecef700dc81feff5736c399_encoches-frontales-in-a-12-day-old-ex-39-week-M.webp](<https://www.learningeeg.com/neonatal>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/neonatal/5ecef700dc81feff5736c399_encoches-frontales-in-a-12-day-old-ex-39-week-M.webp>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### neo-anterior-slow-dysrhythmia — Retained

Frontal and frontopolar 1.5–2 Hz slow runs of about 50–100 uV clearly illustrate anterior slow dysrhythmia at 38 weeks PMA. A separate brush near 5.5 s does not invalidate the pattern.

Final: Runs of 1.5-2 Hz, 50-100 uV frontal delta (anterior slow dysrhythmia), a normal transitional-sleep pattern near term.

Reference comparison: **direct figure**. Frontal rounded slow trains and restricted anterior field agree; reference is less regular.

- [ACNS neonatal handout, slide 26 — ACNS neonatal handout, slide 26](<https://www.acns.org/UserFiles/file/NeonatalEEGBackground.pdf>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.acns.org/UserFiles/file/NeonatalEEGBackground.pdf#page=5>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### neo-temporal-theta-29w — Caption corrected

Brief 4–6 Hz temporal runs are visible on the left near 3.5 and 7.5 s within discontinuous bursts. The captioned right-sided run near 10 s is not evident.

Final: Temporal theta bursts at 29 weeks PMA: brief 4–6 Hz rhythmic runs with a left temporal maximum at T3, riding within bursts of a discontinuous background; typical of 26–32 weeks PMA.

Reference comparison: **text only**. No 29-week temporal-theta figure inspected; final caption follows observed left-dominant trains.

- [Description-only source — Description only; no matching waveform figure inspected](<https://pmc.ncbi.nlm.nih.gov/articles/PMC2811985/>) — text only; figure pixels not claimed inspected.

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation. Technical-standard text supports maturation; no matching waveform figure inspected.

### neo-stop-24w — Retained

Pointed negative occipital theta bursts near 3.5, 6.8 and 15.5 s are visible within the discontinuous background. The prior sharpness concern appears improved; caption timings are approximately correct.

Final: Sharp theta on the occipitals of prematurity (STOP) at 24 weeks PMA: brief 5-6 Hz sharply contoured theta runs at O1 (T3-O1, C3-O1) near 4, 7 and 16 s, within the bursts of a discontinuous record.

Reference comparison: **text only**. No STOP waveform figure inspected; early-prematurity maturation reference alone does not prove morphology.

- [Description-only source — Description only; no matching waveform figure inspected](<https://pmc.ncbi.nlm.nih.gov/articles/PMC2811985/>) — text only; figure pixels not claimed inspected.

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation. Technical-standard text supports maturation; no matching waveform figure inspected.

### neo-seizure-focal-clonic — Retained

Sustained sharp rhythmic 1–1.5 Hz left-central activity with a C3 phase reversal and fine jerk-linked artifact is a plausible neonatal focal clonic teaching example. The clinical correlate is authored.

Final: Neonatal seizure: rhythmic 1-1.5 Hz sharp delta at C3 in the left central chain, lasting well over 10 s, with a focal clonic correlate.

Reference comparison: **direct figure**. Focal rhythmic discharge with amplitude/frequency evolution agrees; clonic behavior requires external context.

- [Neonatal Figure 8 — Neonatal Figure 8](<https://pmc.ncbi.nlm.nih.gov/articles/PMC2811985/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/04e5/2811985/c68180630cd3/AIAN-12-58-g008.jpg>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### neo-seizure-rhythmic-temporal — Retained

Right temporal rhythmic activity changes in voltage and shape around 8–14 s, then attenuates. The earlier steady-pattern concern appears improved. A left temporal brush near 14 s agrees with the caption.

Final: Electrographic-only neonatal seizure 35 s after onset: rhythmic 2-3 Hz sharply contoured activity throughout the page in the right temporal chain (Fp2-T4, T4-O2) and C4-T4, absent on the left (the transient at 13.5 s over T3 is a delta brush).

Reference comparison: **direct figure**. Temporal seizure evolution agrees; clinical montage and asymmetry differ.

- [Neonatal Figure 8 — Neonatal Figure 8](<https://pmc.ncbi.nlm.nih.gov/articles/PMC2811985/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/04e5/2811985/c68180630cd3/AIAN-12-58-g008.jpg>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### neo-brd — Retained

A left-central run near 6–12 s shows changes in frequency, morphology and amplitude with a C3 field. Duration and context are appropriate for a brief rhythmic discharge.

Final: A 6-s evolving rhythmic run at C3 in a term neonate: shorter than the 10-s neonatal seizure minimum, so a brief rhythmic discharge rather than a seizure.

Reference comparison: **adjacent figure**. Seizure-like rhythmic morphology has adjacent evidence; reference duration does not validate brief-event classification.

- [Neonatal Figure 8 — Neonatal Figure 8](<https://pmc.ncbi.nlm.nih.gov/articles/PMC2811985/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/04e5/2811985/c68180630cd3/AIAN-12-58-g008.jpg>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### neo-burst-suppression — Revised image

The original page has broad frontal waves near 6–8 s producing 42.3-uV displayed peak-to-peak within purported suppression below 5 uV. Free physiological neonatal graphoelements were added after suppression gating. One image cannot establish full-record invariance or reactivity.

Final: Term neonate with burst suppression: high-voltage abnormal bursts separated by very low-voltage intervals. On this page, the central interburst intervals measure under 5 uV peak-to-peak after display filtering. Normal neonatal graphoelements are absent; this excerpt does not establish full-record invariance.

Reference comparison: **direct figure**. Final controlled interbursts below 5 µV peak-to-peak and abnormal bursts agree.

- [ACNS PDF page 31 — ACNS PDF page 31](<https://www.acns.org/pdf/guidelines/Guideline-16.pdf>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.acns.org/pdf/guidelines/Guideline-16.pdf#page=31>)

- [Neonatal Figure 6 — Neonatal Figure 6](<https://pmc.ncbi.nlm.nih.gov/articles/PMC2811985/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/04e5/2811985/1e2bfd209f9a/AIAN-12-58-g006.jpg>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### neo-hypothermia-aeeg — Caption corrected

The lower band is around 2 uV without sleep-wake cycling. The upper margin is mostly 15–30 uV with occasional peaks around 40–50 uV, rather than consistently 25–50 uV. The DNV appearance is plausible for the authored HIE/cooling scenario.

Final: Six hours of aEEG in an authored term-neonate HIE/cooling scenario: a discontinuous normal-voltage pattern, with an upper margin mostly 15–30 uV and intermittent higher peaks, a lower margin around 2 uV, and absent sleep-wake cycling.

Reference comparison: **adjacent figure**. Both margin concepts are supported; no exact cooled HIE DNV trend inspected.

- [Neonatal Figure 3 — Neonatal Figure 3](<https://pmc.ncbi.nlm.nih.gov/articles/PMC2811985/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/04e5/2811985/3f839e1c0973/AIAN-12-58-g003.jpg>)

- [Neonatal Figure 5 — Neonatal Figure 5](<https://pmc.ncbi.nlm.nih.gov/articles/PMC2811985/>) — clinical figure; figure pixels inspected.
  [Figure](<https://cdn.ncbi.nlm.nih.gov/pmc/blobs/04e5/2811985/547bd71cc8ba/AIAN-12-58-g005.jpg>)

Limits: Gain, filters, age, montage and excerpt timing are not identical; agreement supports teaching plausibility, not validated clinical simulation.

### acn-lpds-left-temporal — Retained

Approximately1Hz left temporal sharp/slow complexes with reversal and preserved right; clear baseline gaps.

Final: Lateralized periodic discharges at about 1 Hz over the left temporal chain (Fp1-F7, F7-T3, T3-T5): sharp, surface-negative discharges, each followed by a slow wave, on a low-voltage slow, unreactive background. The right hemisphere is spared.

Reference comparison: **direct figure**. Lateral periodic sharp/slow complexes and interdischarge gaps match.

- [ACNS 2021 supplemental EEG examples — LPD example; printed EEG 7, sequence EEG 8](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=9>) — clinical figure; figure pixels inspected.

Limits: Reference field is parasagittal, gallery temporal; exact morphology and amplitude need not match.

### acn-lpds-plus-f — Retained

Left hemispheric1Hz discharges clear, but fast contribution appears as only small short oscillations rather than readily appreciated14Hz burst.

Final: Left hemispheric LPDs at about 1 Hz with a burst of low-voltage fast activity (about 14 Hz) riding on each discharge (+F). The plus modifier makes the pattern more ictal-appearing and places it on the ictal-interictal continuum.

Reference comparison: **direct figure**. Periodic lateral complexes with added short fast oscillations fit the pattern.

- [ACNS 2021 supplemental EEG examples — EEG 19](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=20>) — clinical figure; figure pixels inspected.

Limits: Gallery fast component is small; reference has more conspicuous fast bursts and opposite laterality.

### acn-lpds-plus-r — Retained

Right temporal0.8Hz discharges coexist with independent rhythmic delta in frontopolar/posterior links; marked lateral field.

Final: Right temporal LPDs at about 0.8 Hz (F8-T4, T4-T6) with superimposed rhythmic delta near 1 Hz that is not time-locked to the discharges (+R), best seen in Fp2-F8 and T6-O2.

Reference comparison: **direct figure**. Lateral periodic discharges coexist with rhythmic delta.

- [ACNS 2021 supplemental EEG examples — EEG 28](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=32>) — clinical figure; figure pixels inspected.

Limits: Reference right temporal morphology differs; not a pixel replica or same patient state.

### acn-lpds-dipole-referential — Retained

T3 negative-up narrow phase with opposed frontal positive-down phase on ear-reference; explicit reference labels valid.

Final: Left temporal LPDs on an ipsilateral-ear referential montage: each discharge is surface-negative (upward) and maximal at T3, with an opposite, positive (downward) pole at Fp1 - a tangential dipole (ACNS polarity minor modifier).

Reference comparison: **adjacent figure**. Temporal negative and frontal positive components form a plausible referential dipole.

- [ACNS 2021 supplemental EEG examples — LPD example; printed EEG 7, sequence EEG 8](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=9>) — clinical figure; figure pixels inspected.

Limits: Inspected clinical source is bipolar and does not validate this exact referential dipole. Requires independent expert polarity/field signoff.

### acn-bipds — Retained

Left/right temporal discharges drift independently at nearby1Hz rates; occasional alignment does not undermine independence.

Final: Bilateral independent periodic discharges: left and right temporal periodic discharges, each near 1 Hz but at different rates and not time-locked to each other, so their timing drifts across the page.

Reference comparison: **direct figure**. Independent bilateral periodic events with drifting alignment match.

- [ACNS 2021 supplemental EEG examples — EEG 9](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=10>) — clinical figure; figure pixels inspected.

Limits: Reference posterior field differs from temporal example; occasional coincident discharges are compatible.

### acn-gpds-2hz — Retained

Bisynchronous2Hz generalized sharp/slow complexes with anterior-central prominence and smaller occipital links.

Final: Generalized periodic discharges at about 2 Hz, bisynchronous, largest in the frontal and central derivations and smallest in the occipital links, with a diffusely slow, unreactive background between them.

Reference comparison: **direct figure**. Generalized bisynchronous periodic sharp/slow complexes are plausible.

- [ACNS 2021 supplemental EEG examples — EEG 5](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=6>) — clinical figure; figure pixels inspected.

Limits: Reference is 1 Hz; gallery is 2 Hz. Frequency difference is intentional and measured against seconds scale.

### acn-gpds-plus-f — Retained

Approximately1Hz generalized discharges contain multiple faster wiggles; no sustained rate evolution.

Final: Generalized periodic discharges at about 1 Hz, each carrying superimposed fast activity (+F).

Reference comparison: **direct figure**. Generalized discharges with embedded fast oscillations match.

- [ACNS 2021 supplemental EEG examples — EEG 18](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=19>) — clinical figure; figure pixels inspected.

Limits: Relative fast amplitude differs; no direct drug/age match inferred.

### acn-triphasic-gpds — Retained

Blunt generalized~1.8Hz multicomponent complexes and visible A-P timing shift; bipolar polarity must be interpreted as differences. Referential view would support phase teaching but not necessary renderer change.

Final: Blunt generalized periodic discharges at about 1.8 Hz with triphasic morphology (small negative, dominant positive, then slower negative phase) and an anterior-to-posterior lag: each complex appears in the frontal derivations before the occipital ones.

Reference comparison: **direct figure**. Blunt multicomponent complexes and temporal lag are compatible.

- [ACNS 2021 supplemental EEG examples — EEG 23](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=24>) — clinical figure; figure pixels inspected.

Limits: Bipolar differences complicate individual phase polarity; reference lag is more obvious. Etiology cannot be inferred.

### acn-lpds-spiky — Retained

Narrow dominant left temporal phase and aftergoing wave, clearly narrower than blunt paired example; waveform occasionally has neighbouring component.

Final: Left temporal LPDs at about 0.8 Hz whose dominant phase is spiky (under 70 ms at the baseline); the 10-second page spreads each discharge so its narrow base is easy to judge. Compare with the blunt example.

Reference comparison: **direct figure**. Narrow dominant temporal phase contrasts with the blunt gallery example.

- [ACNS 2021 supplemental EEG examples — LPD example; printed EEG 7, sequence EEG 8](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=9>) — clinical figure; figure pixels inspected.

Limits: Reference field differs; some gallery waves have a neighboring component, which is permissible.

### acn-lpds-blunt — Retained

Rounded left temporal periodic complexes with broad base and short intervening baseline; matches intended contrast.

Final: Left temporal LPDs at about 0.9 Hz drawn blunt: rounded discharges with a broad base, still periodic with a clear interval between them and confined to the left temporal chain. Compare with the spiky example.

Reference comparison: **adjacent figure**. Broad rounded periodic complexes provide a plausible blunt contrast.

- [ACNS 2021 supplemental EEG examples — EEG 23](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=24>) — clinical figure; figure pixels inspected.

Limits: Viewed reference is generalized triphasic, not a matched lateral blunt patient case.

### acn-lrda-left-temporal — Retained

Continuous uniform~1.5Hz left temporal delta with no sustained evolution; right stays low voltage.

Final: Lateralized rhythmic delta activity at about 1.5 Hz over the left frontotemporal chain (Fp1-F7, F7-T3, T3-T5): a continuous train of uniform delta waves with no interval between them and no evolution in frequency or location.

Reference comparison: **direct figure**. Continuous lateral rhythmic delta is physiologically plausible.

- [ACNS 2021 supplemental EEG examples — EEG 16](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=17>) — clinical figure; figure pixels inspected.

Limits: Reference evolves and is parasagittal; gallery deliberately remains stable and temporal.

### acn-lrda-plus-s — Retained

Sharp transients intermittently embedded in left temporal delta train; distinct from plain LRDA.

Final: Left temporal rhythmic delta at about 1.3-1.5 Hz with sharp waves embedded in the delta train (+S), seen as narrow transients on the rising phase in F7-T3 and T3-T5.

Reference comparison: **direct figure**. Sharp elements embedded in rhythmic lateral delta match.

- [ACNS 2021 supplemental EEG examples — EEG 20](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=21>) — clinical figure; figure pixels inspected.

Limits: Spatial extent and sharp-transient density differ from source.

### acn-lrda-plus-f — Retained

Left temporal delta with readily visible continuous~13Hz contribution, less phase-locked than EDB example.

Final: Left temporal rhythmic delta at about 1.6 Hz with superimposed fast activity near 13 Hz (+F) riding on each delta wave. Lateralized RDA above 1 Hz with a plus modifier falls on the ictal-interictal continuum.

Reference comparison: **schematic**. Fast activity occurs with lateral delta, compatible with +F.

- [ACNS 2021 terminology — Figure 31](<https://www.acns.org/UserFiles/file/ACNSStandardizedCriticalCareEEGTerminology_rev2021.pdf>) — schematic; figure pixels inspected.

Limits: The inspected reference is a schematic; phase coupling is less marked than EDB and background fast activity must remain distinguished.

### acn-lrda-fluctuating — Revised image

Displayed978–1008s window crosses13.4s gap and only two frequency changes; does not demonstrate caption's≥3 changes. Run starting999.27s contains changes5.8,15.2,17.6,25.1s; select at_min16.66,window30.

Final: Left temporal LRDA whose frequency changes repeatedly by at least 0.5 Hz within the page, up and down, without a sustained trend (fluctuating, not evolving). A 30-second page shows the changes.

Reference comparison: **adjacent figure**. Final crop shows continuous left delta with four frequency changes that do not sustain evolution.

- [ACNS 2021 supplemental EEG examples — EEG 17](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=18>) — clinical figure; figure pixels inspected.

- [ACNS 2021 supplemental EEG examples — EEG 16](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=17>) — clinical figure; figure pixels inspected.

Limits: Clinical fluctuation reference uses LPDs rather than LRDA; validates frequency behavior component only. Original crop failed and was replaced.

### acn-grda-frontal — Retained

Bisynchronous~2Hz rounded delta largest Fp-F links with smaller posterior activity; field fix survives bipolar montage.

Final: Generalized rhythmic delta activity at about 2 Hz, bisynchronous, largest in the frontal and frontocentral derivations and smallest in the occipital links, filling the page without evolution.

Reference comparison: **direct figure**. Bisynchronous rounded delta with anterior prominence matches.

- [ACNS 2021 supplemental EEG examples — EEG 6](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=7>) — clinical figure; figure pixels inspected.

Limits: Amplitude and exact rate differ; frontal field remains clear in bipolar montage.

### acn-grda-occipital — Retained

Occipital3Hz rhythm most conspicuous4–12s with posterior phase/amplitude predominance; blinks and muscle add realistic noise.

Final: Generalized rhythmic delta at about 3 Hz with an occipital predominance: largest in P3-O1, P4-O2, T5-O1 and T6-O2 on the longitudinal bipolar montage.

Reference comparison: **adjacent figure**. Same rhythmic generalized delta class with posterior predominance is plausible.

- [ACNS 2021 supplemental EEG examples — EEG 6](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=7>) — clinical figure; figure pixels inspected.

Limits: Viewed clinical reference is frontal; no exact occipital GRDA patient figure was inspected.

### acn-edb — Retained

Large frontally predominant~1.5Hz delta with stereotyped20–30Hz brushes phase-locked to successive waves; appropriate EDB teaching.

Final: Continuous, frontally predominant rhythmic delta at about 1.5 Hz with 20-30 Hz fast activity riding on each delta wave (extreme delta brush, a form of RDA+F).

Reference comparison: **direct figure**. Repeated fast brushes coupled to large frontal delta match.

- [ACNS 2021 supplemental EEG examples — EEG 22](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=23>) — clinical figure; figure pixels inspected.

Limits: Exact fast rate and amplitude vary between examples; diagnosis is not established by the pattern alone.

### acn-birds — Caption corrected

6s sharply contoured right temporal>4Hz run present; duration alone does not define BIRDs. Caption needs sharply-contoured possible BIRDs plus exclusion of known benign rhythm and lack of clinical correlate.

Final: A sharply contoured 6-second run of rhythmic activity above 4 Hz over the right temporal chain (F8-T4, T4-T6), starting and stopping abruptly. In the stated setting without a clinical correlate or a known benign rhythm, this illustrates possible BIRDs; brief duration alone does not define BIRDs.

Reference comparison: **direct figure**. Brief sharply contoured temporal run fits possible BIRDs.

- [ACNS 2021 supplemental EEG examples — EEG 27](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=31>) — clinical figure; figure pixels inspected.

Limits: Reference also has matching-location interictal discharges absent in gallery; duration alone is insufficient. Revised caption explicitly qualifies possible BIRDs.

### acn-sirpids — Retained

Marked stimulus precedes generalized1.3Hz discharge onset by~3s; absent prestimulus, valid single-instance SI demonstration.

Final: Generalized periodic discharges at about 1.3 Hz that begin about 3 s after a sternal rub (marked) and are absent before it: stimulus-induced (SI-) GPDs, SIRPIDs.

Reference comparison: **direct figure**. Marked stimulus followed by new generalized rhythmic/periodic activity is compatible.

- [ACNS 2021 supplemental EEG examples — EEG 15](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=16>) — clinical figure; figure pixels inspected.

Limits: Reference SI-GRDA versus gallery SI-GPD. One marked event illustrates temporal association, not reproducible causality.

### acn-lpds-evolving-esz — Retained

Left temporal train1→2→3Hz with≥10s duration and clear stops~23s; seizure evolution demonstrated.

Final: Left temporal LPDs beginning at about 1 Hz speed up in steps to about 2 Hz and then 3 Hz while growing in voltage, and stop after about 23 s. Definite evolution lasting 10 s or more meets ACNS criterion B for an electrographic seizure.

Reference comparison: **direct figure**. Temporal onset with sequential frequency increase and a definite offset is seizure-like.

- [ACNS 2021 supplemental EEG examples — EEG 24a](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=25>) — clinical figure; figure pixels inspected.

Limits: Reference and gallery evolution trajectories differ; raw full duration supports gallery criterion.

### acn-gpds-3hz-esz — Retained

Generalized sharp complexes approximately3Hz throughout15s; meets displayed ACNS rate/duration seizure example.

Final: Generalized sharp periodic discharges at about 3 Hz, frontocentrally maximal and sustained across the page: epileptiform discharges averaging more than 2.5 Hz for 10 s or more meet ACNS criterion A for an electrographic seizure, even without evolution.

Reference comparison: **adjacent figure**. Generalized approximately 3 Hz discharges sustained 15 s are compatible with electrographic seizure criteria.

- [ACNS 2021 supplemental EEG examples — EEG 5](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=6>) — clinical figure; figure pixels inspected.

- [ACNS 2021 supplemental EEG examples — EEG 24a](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=25>) — clinical figure; figure pixels inspected.

Limits: Viewed GPD reference is 1 Hz and seizure reference focal; no exact generalized 3 Hz clinical example inspected.

### trd-aeeg-term-swc — Caption corrected

Coordinated widening/lower-margin dips over15–30min recur~hourly; occasional lower dips below5uV contradict literal lower stays≥5 caption.

Final: Term neonatal aEEG (day 3), predominantly continuous normal voltage: the lower margin is generally around or above 5 uV and the upper margin well above 10 uV, with brief lower-margin dips. Sleep-wake cycling appears as recurring 15-30-minute stretches of band widening and lower-margin dips toward 5 uV (quiet sleep, trace alternant), alternating with narrower continuous stretches.

Reference comparison: **adjacent figure**. Coordinated band widening and lower-margin dips form plausible sleep cycling.

- [ACNS neonatal terminology — Figure 2b](<https://www.acns.org/pdf/guidelines/Guideline-16.pdf#page=29>) — clinical figure; figure pixels inspected.

- [Amplitude Integrated EEG: The Child Neurologist’s Perspective — Figure 1 captions/background classifications; pixels not inspected](<https://pmc.ncbi.nlm.nih.gov/articles/PMC4091988/>) — text only; figure pixels not claimed inspected.

- [Quantification of Neonatal Amplitude-Integrated EEG Patterns — aEEG processing and discontinuity descriptions; no direct figure](<https://pmc.ncbi.nlm.nih.gov/articles/PMC3858205/>) — text only; figure pixels not claimed inspected.

Limits: Raw neonatal reference shows tracé alternant, not aEEG; aEEG figures are caption-only. Brief lower <5 µV is now stated; no raw excerpt in this image.

### trd-aeeg-dnv — Caption corrected

Lower margin largely3–5uV upper~25–35uV, broad band without clear mature cycling; raw shows burst THEN low-amplitude interval, reverse of caption.

Final: Discontinuous normal voltage aEEG: the lower margin is predominantly below 5 uV while the upper margin stays above 10 uV, with a broad band and no clear mature sleep-wake cycling. The raw strip shows a burst followed by a lower-voltage interval.

Reference comparison: **adjacent figure**. Broad band with a low lower margin agrees with discontinuity classification.

- [ACNS neonatal terminology — Figure 2a](<https://www.acns.org/pdf/guidelines/Guideline-16.pdf#page=28>) — clinical figure; figure pixels inspected.

- [Amplitude Integrated EEG: The Child Neurologist’s Perspective — Figure 1 captions/background classifications; pixels not inspected](<https://pmc.ncbi.nlm.nih.gov/articles/PMC4091988/>) — text only; figure pixels not claimed inspected.

Limits: Viewed reference is raw neonatal EEG, not aEEG; exact processed envelope is not clinically validated. Corrected raw ordering is burst then quiet interval.

### trd-aeeg-burst-suppression — Retained

Lower1–2uV upper~25–40uV with no cycles and raw brief burst/suppressed intervals; broadly consistent.

Final: Burst-suppression aEEG: the lower margin sits at 1-2 uV and the upper margin near 25-30 uV, a band with no sleep-wake cycling. The raw strip shows brief bursts separated by suppressed intervals of several seconds.

Reference comparison: **adjacent figure**. Low lower margin with intermittent bursts and suppressed raw interval is compatible.

- [ACNS neonatal terminology — Figure 2d](<https://www.acns.org/pdf/guidelines/Guideline-16.pdf#page=31>) — clinical figure; figure pixels inspected.

- [Amplitude Integrated EEG: The Child Neurologist’s Perspective — Figure 1 captions/background classifications; pixels not inspected](<https://pmc.ncbi.nlm.nih.gov/articles/PMC4091988/>) — text only; figure pixels not claimed inspected.

Limits: Matched raw class only; aEEG source figure pixels unavailable. Compression/filter/window choices alter exact margins.

### trd-aeeg-seizures — Retained

Five discrete left margin rises with little matched right change; raw at3.45h has rhythmic delta. Raw snapshot alone does not show full evolution.

Final: Continuous normal voltage aEEG with five abrupt rises of the lower and upper margins on the left channel (C3-P3), each lasting a few minutes: recurrent electrographic seizures. The right channel (C4-P4) does not change. The raw strip is taken during the fourth seizure and shows rhythmic delta.

Reference comparison: **adjacent figure**. Discrete unilateral band rises with linked rhythmic raw activity are plausible.

- [Alix et al.: An introduction to neonatal EEG (2017) — Figure 4; PDF page 6, printed page 140](<https://doi.org/10.1016/j.paed.2016.11.003>) — clinical figure; figure pixels inspected.

- [Amplitude Integrated EEG: The Child Neurologist’s Perspective — Figure 1 captions/background classifications; pixels not inspected](<https://pmc.ncbi.nlm.nih.gov/articles/PMC4091988/>) — text only; figure pixels not claimed inspected.

Limits: Viewed reference is neonatal raw seizure evolution, not an exact aEEG record. Single raw snapshot cannot prove complete seizure evolution.

### trd-csa-seizures — Revised image

Three left downward spectral streaks align with envelope/aEEG rise and small right effects; color units/range omitted.

Final: Four hours of trends with three left hemispheric seizures: each shows on the left FFT spectrogram as a bright streak sweeping down from about 4 Hz to 1.5 Hz, with a matching rise of the left aEEG band and envelope and a brief postictal dip. The right-sided trends change far less.

Reference comparison: **adjacent figure**. Descending spectral ridges align with envelope changes and laterality.

- [ACNS 2021 supplemental EEG examples — EEG 30](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=36>) — clinical figure; figure pixels inspected.

- [ACNS 2021 supplemental EEG examples — EEG 24a](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=25>) — clinical figure; figure pixels inspected.

Limits: Viewed CSA is an IIC case and different display; absolute source power scale differs from gallery dB palette.

### trd-seizure-probability — Revised image

Four right spectral/rhythmicity streaks align with heuristic peaks and rightward asymmetry; explicitly heuristic labeling appropriate; color key omitted.

Final: Four right temporal seizures appear as seizure-probability peaks aligned with brief streaks on the right rhythmicity and right FFT spectrograms; the asymmetry index swings toward the right (+) with each one while the left trends stay unchanged.

Reference comparison: **adjacent figure**. Right spectral/rhythmicity streaks align with the displayed heuristic peaks.

- [ACNS 2021 supplemental EEG examples — EEG 30](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=36>) — clinical figure; figure pixels inspected.

Limits: Reference does not validate gallery detector; scores are 0–1 heuristic values, not calibrated clinical probability.

### trd-lpds-vs-seizure — Revised image

Left harmonic comb begins30min, heuristic remains nearzero until150min seizure peak; illustrates heuristic discrimination for this synthetic case only; color key omitted.

Final: Continuous left temporal LPDs at 1 Hz leave the seizure-probability trace flat and add only a faint harmonic comb on the spectrogram; the real seizure at 150 min stands out as a probability peak, a rhythmicity band and an evolving CSA arc.

Reference comparison: **adjacent figure**. Persistent harmonic comb contrasts with isolated seizure ridge/score rise.

- [ACNS 2021 supplemental EEG examples — EEG 30](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=36>) — clinical figure; figure pixels inspected.

- [ACNS 2021 supplemental EEG examples — LPD example; printed EEG 7, sequence EEG 8](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=9>) — clinical figure; figure pixels inspected.

Limits: Source CSA illustrates a different IIC case; apparent discrimination is specific to this synthetic example, not detector validation.

### trd-ese-trends — Revised image

Left sustained band45–135min varies and tails off, duration90min; right much less affected; supports status trend claim; color key omitted.

Final: Electrographic status epilepticus for 90 minutes: sustained rhythmicity and a spectrogram band that wanders in frequency and waxes and wanes in power, then slows, fragments and fades out over the last minutes rather than stopping abruptly.

Reference comparison: **adjacent figure**. Long sustained left spectral/rhythmicity bands are compatible with prolonged seizure activity.

- [ACNS 2021 supplemental EEG examples — EEG 30](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=36>) — clinical figure; figure pixels inspected.

- [ACNS 2021 supplemental EEG examples — EEG 24a](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=25>) — clinical figure; figure pixels inspected.

Limits: Reference does not reproduce a 90 min status course; treatment association and duration are authored signal context.

### trd-asymmetry-index — Revised image

Persistently negative~40–50% asymmetry with blue delta/theta relative asymmetry and dimmer right PSD; side/scale correct but color key omitted.

Final: A persistent right hemispheric attenuation holds the asymmetry index near -40 to -50% (left greater than right) for the whole record, and the relative asymmetry spectrogram is blue (left-greater), most intensely in the delta-theta band. The right FFT spectrogram is correspondingly dimmer than the left.

Reference comparison: **schematic**. Negative index and reduced right power agree with left dominance.

- [ACNS 2021 terminology — Figure 1](<https://www.acns.org/UserFiles/file/ACNSStandardizedCriticalCareEEGTerminology_rev2021.pdf#page=4>) — schematic; figure pixels inspected.

Limits: Reference validates hemispheric asymmetry concept, not this spectral index formula or its numerical magnitude.

### trd-suppression-ratio — Revised image

Two bilateral SR rises~25→55→80% after annotations; aEEG upper margin frequently clipped at top, so burst amplitude cannot be assessed; color key omitted.

Final: Burst suppression deepens in two steps after pentobarbital increases at 40 and 95 min: the bilateral suppression ratio climbs from about 25% to 55% and then to about 80%, the top of the shaded 60-80% target band. The aEEG lower margin stays near 1 uV while the upper-margin excursions from bursts become sparser.

Reference comparison: **adjacent figure**. Higher percent low-voltage time follows the annotated treatment and repeated bursts remain.

- [ACNS 2021 supplemental EEG examples — EEG 2](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=3>) — clinical figure; figure pixels inspected.

- [ACNS 2021 terminology — Figure 2](<https://www.acns.org/UserFiles/file/ACNSStandardizedCriticalCareEEGTerminology_rev2021.pdf#page=5>) — schematic; figure pixels inspected.

Limits: Raw pattern reference only; no matched pentobarbital qEEG course viewed. Gallery threshold <5 µV differs from adult ACNS <10 µV suppression definition.

### trd-sedation-power — Revised image

Bilateral ADR decrease and12–16Hz band after90–100min, total power similar; symmetric dexmedetomidine example plausible; color key omitted.

Final: After a dexmedetomidine increase at 90 min, the alpha/delta ratio falls on both sides together and a 12-16 Hz spindle-like band appears on both FFT spectrograms, a symmetric, sleep-like drug effect rather than a focal change. Total power changes little.

Reference comparison: **adjacent figure**. Symmetric 12–16 Hz power enhancement and ADR reduction are internally consistent.

- [ACNS 2021 supplemental EEG examples — EEG 30](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=36>) — clinical figure; figure pixels inspected.

Limits: Reference is not dexmedetomidine; exact drug signature and amplitude response are illustrative, not a matched clinical curve.

### trd-composite-seizure — Revised image

Time marker126min aligns left trend event and raw left temporal~2Hz high-voltage rhythm; right muscle exists but cerebral seizure field remains lateral; color key omitted.

Final: The trend panel (top) marks the time of the raw page (bottom): a left temporal seizure seen on the trends as a seizure-probability peak and a streak on the left rhythmicity and FFT spectrograms is, on the page, high-voltage rhythmic delta at about 2 Hz over the left temporal chain, with the right temporal chain spared.

Reference comparison: **adjacent figure**. Selected time aligns the left spectral event with lateral rhythmic raw activity.

- [ACNS 2021 supplemental EEG examples — EEG 30](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=36>) — clinical figure; figure pixels inspected.

- [ACNS 2021 supplemental EEG examples — EEG 24a](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=25>) — clinical figure; figure pixels inspected.

Limits: No source matches the exact composite/heuristic display; linked still shows one part of evolution.

### trd-composite-burst-suppression — Revised image

Raw generalized bursts0–1 and11–15s with suppressed~1–11s match SR60–70%; aEEG upper boundary clipped, color key omitted.

Final: A suppression ratio of about 60-70% on the trend (top) corresponds, on the raw page (bottom), to generalized bursts of mixed-frequency activity lasting 1-4 s separated by suppressed intervals under 5 uV lasting up to about 10 s.

Reference comparison: **adjacent figure**. Raw burst/quiet proportions agree approximately with the trended suppression ratio.

- [ACNS 2021 supplemental EEG examples — EEG 2](<https://cdn-links.lww.com/permalink/jcnp/a/jcnp_2020_11_20_fong_1_sdc1.pdf#page=3>) — clinical figure; figure pixels inspected.

- [ACNS 2021 terminology — Figure 2](<https://www.acns.org/UserFiles/file/ACNSStandardizedCriticalCareEEGTerminology_rev2021.pdf#page=5>) — schematic; figure pixels inspected.

Limits: Reference is raw rather than this composite; the gallery <5 µV threshold is a detector convention, not interchangeable with adult ACNS voltage definition.

### gen-typical-absence — Retained

Bisynchronous approximately 3-Hz spike-wave starts/ends abruptly, slight slowing and immediate normal background recovery; age appropriate.

Final: Generalized 3-Hz spike-and-wave, faster at onset and slowing toward 2.5 Hz, frontal maximum, abrupt onset and offset; the background returns at once.

Reference comparison: **direct figure**. Abrupt symmetric approximately 3-Hz sharp/slow train and rapid return agree with the ILAE figure. Clinical reference amplitude is larger; no requirement that all absence discharges reach that voltage.

- [ILAE CAE ictal 3-Hz generalized spike-wave — CAE](<https://www.epilepsydiagnosis.org/syndrome/cae-eeg.html>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.epilepsydiagnosis.org/img/3HzGSW_30mm_50uV.jpg>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### gen-atypical-absence — Revised image

Gradual irregular slow complexes are visible, but sharp components are inconsistent/subtle in the final bipolar image and pre/post slow pathological background is visually faint at 20-uV/mm. A reviewer may still read notched rhythmic delta.

Final: Slow (<2.5 Hz), irregular sharp-and-slow-wave complexes with gradual onset and offset on a slow background; the sharp component precedes each slow wave. Average reference exposes the preceding sharp component in the frontocentral channels and the subsequent slower wave; the background is diffusely slow.

Reference comparison: **adjacent figure**. Final average-reference page exposes sharp-before-slow components with slower irregular rate and gradual envelope. LGS reference anchors morphology; CAE illustrates the faster abrupt comparator. The image alone cannot verify impaired awareness.

- [LGS slow spike-wave and disorganized background — LGS](<https://www.learningeeg.com/pediatric>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/pediatric/different-LGS-background-at-10uV.webp>)

- [ILAE CAE ictal 3-Hz generalized spike-wave — CAE](<https://www.epilepsydiagnosis.org/syndrome/cae-eeg.html>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.epilepsydiagnosis.org/img/3HzGSW_30mm_50uV.jpg>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### gen-myoclonic — Retained

Brief generalized polyspikes with following slow wave and scalp-muscle burst, with normal adolescent background between; field and voltage plausible.

Final: Brief generalized polyspike-and-wave, frontocentral maximum, each with a short burst of scalp muscle (the jerk).

Reference comparison: **direct figure**. Brief generalized polyspike with concurrent synthetic muscle agrees with clinical frontocentral jerk-related discharge. A rendered muscle envelope models a clinical correlate; it is not patient video or measured EMG.

- [Generalized polyspike correlated with myoclonic jerk — MYOC](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/myoclonic-jerk-examples/p1.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### gen-myoclonic-atonic — Retained

Generalized polyspike-wave followed by slow wave aligns with EMG loss of tone; appropriate child context and clear polygraphic evidence.

Final: Polyspike-and-wave followed by a larger slow wave while the EMG row falls silent (loss of tone).

Reference comparison: **adjacent figure**. Generalized polyspike/slow morphology is anchored visually, but no clinical myoclonic-atonic figure was inspected. Official ILAE text supports spike-associated jerk followed by slow-wave atonia; synthetic EMG change is an authored illustration.

- [Generalized polyspike correlated with myoclonic jerk — MYOC](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/myoclonic-jerk-examples/p1.webp>)

- [JME generalized spike/polyspike-wave burst — JME](<https://www.learningeeg.com/pediatric>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/pediatric/4-6-Hz-spike-and-waves-with-JME-annotated.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### gen-myoclonic-tonic — Retained

Polyspikes transition into fast activity with increased EMG, clearly different from the atonic example.

Final: A myoclonic polyspike-and-wave that runs into low-voltage fast activity with tonic EMG.

Reference comparison: **adjacent figure**. The two component morphologies agree with separate visual anchors. No exact clinical myoclonic-to-tonic sequence was inspected; this remains a composite teaching example requiring semiologic context.

- [Generalized polyspike correlated with myoclonic jerk — MYOC](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/myoclonic-jerk-examples/p1.webp>)

- [Tonic seizure with subtle left lead-in — TONIC](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/tinyc-tonic-seizure-subtle-left-predominance-maybe.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### gen-tonic — Revised image

Large initial slow complex, decrement and building fast activity visible, but the added EMG row barely changes across tonic phase. Code uses resting 15-uV RMS and default event 120/6=20-uV RMS, so tone increase is weak despite caption.

Final: A diffuse high-voltage sharp-and-slow wave, then electrodecrement and bisynchronous 15-25 Hz paroxysmal fast activity building in voltage, frontally predominant, with tonic EMG.

Reference comparison: **adjacent figure**. Revised stronger sustained muscle and slow/decrement/fast sequence agree with tonic reference; the reference has a subtle left lead-in and larger irregular muscle contribution. Parent inspected the final 0.5.4 page.

- [Tonic seizure with subtle left lead-in — TONIC](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/tinyc-tonic-seizure-subtle-left-predominance-maybe.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### gen-atonic — Retained

Vertex maximum sharp/slow transient aligns with abrupt EMG silence; background and field appropriate.

Final: A single vertex-maximal sharp-and-slow wave with an abrupt silent period on the EMG row.

Reference comparison: **adjacent figure**. Generalized sharp-slow complex is visually plausible, but no exact clinical atonic example was inspected. Official ILAE text supports tone loss with the slow wave; synthesized resting-tone drop cannot independently diagnose atonia.

- [JME generalized spike/polyspike-wave burst — JME](<https://www.learningeeg.com/pediatric>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/pediatric/4-6-Hz-spike-and-waves-with-JME-annotated.webp>)

- [Generalized polyspike correlated with myoclonic jerk — MYOC](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/myoclonic-jerk-examples/p1.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### gen-gtc-onset — Retained

Fast recruitment builds into roughly 10-Hz ictal rhythm with heavy temporal muscle; midline remains relatively readable as captioned.

Final: Low-voltage fast activity recruiting into a high-voltage ~10-Hz rhythm under muscle that soon obscures every derivation except the vertex.

Reference comparison: **direct figure**. Herald/decrement and sustained fast/tonic-muscle recruitment agree with clinical p1; gallery intentionally leaves more neural activity readable than the heavily obscured clinical page.

- [Three-page generalized tonic-clonic sequence — GTC](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/gtc-at-20uv-annotated/p1.webp>)
  [Figure](<https://www.learningeeg.com/images/seizures/gtc-at-20uv-annotated/p2.webp>)
  [Figure](<https://www.learningeeg.com/images/seizures/gtc-at-20uv-annotated/p3.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### gen-gtc-clonic — Retained

Separated ictal/muscle bursts become further apart; electrode movement and attenuated intervening periods are plausible for late tonic-clonic phase.

Final: Polyspike bursts locked to muscle bursts, separated by near-flat intervals that lengthen as the bursts slow; electrode movement with each jerk.

Reference comparison: **direct figure**. Separated spike/muscle bursts and increasing interburst intervals agree with clinical p2. Variable amplitude/noise remain simplified compared with a real motor seizure.

- [Three-page generalized tonic-clonic sequence — GTC](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/gtc-at-20uv-annotated/p1.webp>)
  [Figure](<https://www.learningeeg.com/images/seizures/gtc-at-20uv-annotated/p2.webp>)
  [Figure](<https://www.learningeeg.com/images/seizures/gtc-at-20uv-annotated/p3.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### gen-gtc-end — Retained

Terminal sparse fading bursts give way to very low-voltage generalized suppression; age and preceding phase context plausible.

Final: The last discharges come further apart (here they fade), then generalized postictal suppression below 10 uV.

Reference comparison: **direct figure**. Terminal fading bursts, attenuation and irregular slowing agree with p2/p3 sequence. Artifact recovery and patient movement are more complex in the reference.

- [Three-page generalized tonic-clonic sequence — GTC](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/gtc-at-20uv-annotated/p1.webp>)
  [Figure](<https://www.learningeeg.com/images/seizures/gtc-at-20uv-annotated/p2.webp>)
  [Figure](<https://www.learningeeg.com/images/seizures/gtc-at-20uv-annotated/p3.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### gen-eyelid-myoclonia — Retained

Eye closure transient precedes brief generalized fast polyspike-wave and repetitive frontal artifact; normal child background between.

Final: Eye closure (Fp blink deflection), then 3-6 Hz generalized polyspike-and-wave within about a second, with repetitive eyelid-jerk artifact on the frontal poles.

Reference comparison: **adjacent figure**. Fast generalized spike/polyspike shape is anchored by inspected figures. No exact eyelid-myoclonia figure was inspected; eye closure trigger agrees with ILAE text, but eyelid jerks/awareness require clinical observation.

- [JME generalized spike/polyspike-wave burst — JME](<https://www.learningeeg.com/pediatric>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/pediatric/4-6-Hz-spike-and-waves-with-JME-annotated.webp>)

- [Generalized polyspike correlated with myoclonic jerk — MYOC](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/myoclonic-jerk-examples/p1.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### gen-photoparoxysmal — Retained

Generalized spike-wave during explicitly marked 18-Hz photic train is not flash-locked and stops with train; no confusion with normal photic driving.

Final: Generalized 3-4 Hz spike-and-wave during an 18-Hz flash train (photic row), not locked to the flashes, stopping with the train (Waltz type 4).

Reference comparison: **adjacent figure**. Generalized polyspike/spike-wave morphology agrees with the visual anchor. Trigger/flash locking is authored and text-supported; the inspected JME figure does not show photic activation.

- [JME generalized spike/polyspike-wave burst — JME](<https://www.learningeeg.com/pediatric>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/pediatric/4-6-Hz-spike-and-waves-with-JME-annotated.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### gen-photoparoxysmal-outlasting — Retained

Generalized discharge continues about 3 seconds after photic markers stop, clearly illustrating outlasting response.

Final: As above, but the generalized discharge outlasts the flash train by 1-3 s.

Reference comparison: **adjacent figure**. Discharge morphology agrees with generalized reference; continuing past explicit flash markers is visible in the synthetic page. No matched clinical outlasting-PPR figure was inspected.

- [JME generalized spike/polyspike-wave burst — JME](<https://www.learningeeg.com/pediatric>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/pediatric/4-6-Hz-spike-and-waves-with-JME-annotated.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### gen-interictal-gsw — Retained

Brief generalized roughly 3-4-Hz spike-wave amid organized normal posterior background, plausible child interictal EEG.

Final: Brief bursts of generalized 3-4 Hz spike-and-wave between normal background.

Reference comparison: **adjacent figure**. Brief bilateral spike-wave bursts have appropriate frontocentral field and sharp-slow ordering; CAE figure is ictal and longer, JME faster, so neither proves identical syndrome or state.

- [ILAE CAE ictal 3-Hz generalized spike-wave — CAE](<https://www.epilepsydiagnosis.org/syndrome/cae-eeg.html>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.epilepsydiagnosis.org/img/3HzGSW_30mm_50uV.jpg>)

- [JME generalized spike/polyspike-wave burst — JME](<https://www.learningeeg.com/pediatric>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/pediatric/4-6-Hz-spike-and-waves-with-JME-annotated.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### gen-interictal-psw-jme — Retained

Generalized irregular fast polyspike-wave bursts on organized adolescent background, plausible JME pattern with no persistent unilateral origin.

Final: 4-6 Hz generalized polyspike-and-wave bursts in every chain, as in juvenile myoclonic epilepsy.

Reference comparison: **direct figure**. Short synchronous frontocentral multiple-sharp/slow bursts match JME visual morphology with plausible otherwise organized adolescent background.

- [JME generalized spike/polyspike-wave burst — JME](<https://www.learningeeg.com/pediatric>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/pediatric/4-6-Hz-spike-and-waves-with-JME-annotated.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### gen-polyspike-sporadic — Retained

Isolated broad frontocentral polyspikes and slow wave with per-channel height variability; two blinks and EMG separated from cerebral event.

Final: Isolated frontocentral polyspikes with a slow wave; each electrode has its own lag and spike heights.

Reference comparison: **adjacent figure**. Isolated generalized contiguous sharp components agree morphologically; lack of synthetic EMG jerk makes this an interictal illustration rather than a myoclonic seizure.

- [Generalized polyspike correlated with myoclonic jerk — MYOC](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/myoclonic-jerk-examples/p1.webp>)

- [JME generalized spike/polyspike-wave burst — JME](<https://www.learningeeg.com/pediatric>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/pediatric/4-6-Hz-spike-and-waves-with-JME-annotated.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### gen-lgs-slow-spike-wave — Revised image

Irregular slow approximately 2-Hz complexes on child background; most cycles in final bipolar look like smooth delta, with insufficient conspicuous preceding sharp wave for a teaching LGS SSW exemplar. Existing morphology test isolates Fz referential, not this final bipolar image.

Final: Irregular 1.5-2.5 Hz sharp-and-slow-wave complexes, frontal maximum, on a slow background. Average reference exposes the preceding sharp component in the frontocentral channels and the subsequent slower wave; the background is diffusely slow.

Reference comparison: **direct figure**. Final average-reference 20-uV/mm page has irregular slower sharp-slow complexes on abnormal background; clear sharp components are best frontocentrally. Reference montage and degree of disorganization differ; official ILAE <2.5-Hz target takes precedence over reference annotation.

- [LGS slow spike-wave and disorganized background — LGS](<https://www.learningeeg.com/pediatric>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/pediatric/different-LGS-background-at-10uV.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### gen-gpfa-n2 — Retained

Abrupt bisynchronous fast bursts around 20 Hz interrupt slower background, variable height/frequency and stronger frontocentral bipolar field; unlike ordinary gradual spindle.

Final: Abrupt bisynchronous ~20 Hz bursts, frontally predominant, with the background attenuated beneath them; irregular in height and frequency, not spindle-like.

Reference comparison: **adjacent figure**. Fast burst morphology is anchored by focal PFA and diffuse tonic-fast examples; synchronous generalization and N2 state are assessed on the gallery itself. No exact clinical generalized N2 PFA figure was inspected.

- [Multifocal discharges and focal PFA in slow sleep — MULTI](<https://www.learningeeg.com/epileptiform>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/epileptiform/5e7d06858a3130bbd1c316a7_T6-Fp1-sharps-plus-left-frontal-fast-activity.webp>)

- [Tonic seizure with subtle left lead-in — TONIC](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/tinyc-tonic-seizure-subtle-left-predominance-maybe.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### gen-gpfa-n3 — Retained

Abrupt synchronous fast run on high-voltage slow sleep background with background attenuation; plausible N3 GPFA.

Final: Abrupt bisynchronous ~20 Hz bursts, frontally predominant, with the background attenuated beneath them; irregular in height and frequency, not spindle-like.

Reference comparison: **adjacent figure**. Abrupt fast bursts over high-amplitude slow sleep compare with PFA/tonic anchors. Generalized field and N3 background are plausible; no identical clinical GPFA-in-N3 case was inspected.

- [Multifocal discharges and focal PFA in slow sleep — MULTI](<https://www.learningeeg.com/epileptiform>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/epileptiform/5e7d06858a3130bbd1c316a7_T6-Fp1-sharps-plus-left-frontal-fast-activity.webp>)

- [Tonic seizure with subtle left lead-in — TONIC](<https://www.learningeeg.com/seizures>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/seizures/tinyc-tonic-seizure-subtle-left-predominance-maybe.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### gen-eses — Retained

Near-continuous irregular slow spike-wave, left centro-parietal predominance and sleep context plausible for SWAS pattern.

Final: Near-continuous 1.5-2 Hz spike-and-wave in NREM sleep, centro-parietal and left-predominant.

Reference comparison: **direct figure**. Dense sleep spike-wave activity agrees with the sleep-activation figure; gallery is more bilaterally diffuse than its left-emphasized reference. A page cannot establish whole-night spike-wave burden or a developmental syndrome.

- [Sleep spike-wave activation with left hemispheric emphasis — ESES](<https://www.learningeeg.com/pediatric>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/pediatric/ESES-example-left-hemispheric-predominance-at-20uV.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### iid-selects-bilateral-bipolar — Added

New requested teaching example; compared with the cited reference in the final montage.

Final: Independent left and right centrotemporal discharges on the same normal drowsy background. Negative peaks reverse at C3/T3 or C4/T4, with the frontal positive pole of a transverse dipole and an after-going slow wave. Paired with the referential view of this same recording and time window.

Reference comparison: **direct figure**. Both independent spike populations have classic centrotemporal negative reversals and tangential frontal/CT field with triphasic contour. Bilateral independent times are an added synthetic teaching feature, not copied from one reference crop.

- [ILAE centrotemporal tangential dipole in paired montages — SELECTS](<https://www.epilepsydiagnosis.org/syndrome/ects-eeg.html>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.epilepsydiagnosis.org/img/CTspikes_Bipolar_30mV_30mm.jpg>)
  [Figure](<https://www.epilepsydiagnosis.org/img/CTspikes_Ref_30mV_30mm.jpg>)

- [C4/T4 spikes in sleep — CT](<https://www.learningeeg.com/epileptiform>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.learningeeg.com/images/epileptiform/5ed66ba438e40988d45ff3ba_C4-and-T4-spikes.webp>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### iid-selects-bilateral-referential — Added

New requested teaching example; compared with the cited reference in the final montage.

Final: The same recording and time window as the paired bipolar view, using average reference as in the ILAE example. Centrotemporal negativity at C3/T3 or C4/T4 points upward; the simultaneous frontal positive pole points downward. The left and right discharges occur independently on a normal drowsy background.

Reference comparison: **direct figure**. Same events across average reference expose centrotemporal negativity with ipsilateral frontal positivity, matching the reference dipole direction. Average-reference common-field redistribution differs from a linked-ear montage.

- [ILAE centrotemporal tangential dipole in paired montages — SELECTS](<https://www.epilepsydiagnosis.org/syndrome/ects-eeg.html>) — clinical figure; figure pixels inspected.
  [Figure](<https://www.epilepsydiagnosis.org/img/CTspikes_Bipolar_30mV_30mm.jpg>)
  [Figure](<https://www.epilepsydiagnosis.org/img/CTspikes_Ref_30mV_30mm.jpg>)

Limits: Reference montage, age, state, gain or event coverage differs; the comparison supports teaching plausibility and does not establish exact clinical equivalence.

### var-ciganek — Added

New requested teaching example; compared with the cited reference in the final montage.

Final: A waxing and waning 6 Hz midline theta train, maximal at Cz with Fz greater than Pz and only a small parasagittal field. Smooth rhythmic activity in an awake adult; a normal variant without ictal evolution.

Reference comparison: **direct figure**. Cz-maximal waxing and waning 6-Hz theta with a small parasagittal field agrees with the supplied Ciganek screenshot; the smooth adult awake scenario is an authored teaching choice.

- [EEGpedia midline theta rhythm (Ciganek) — User-supplied Ciganek rhythm screenshot (codex-clipboard-ebf78cdf-ddb3-41f3-a464-02eacf09b1c8.png)](<http://www.eegpedia.org/index.php?title=Midline_theta_rhythm_(Ciganek)>) — supplied clinical figure; figure pixels inspected.

Limits: The supplied clinical screenshot has a different montage, gain, background and annotation layout. No pixel-amplitude equivalence or population-wide age/state validation is claimed.
