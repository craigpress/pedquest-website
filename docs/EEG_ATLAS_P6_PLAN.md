# EEG Atlas P6 — renderer 0.4.0: Craig's P5 verdicts into the generator

Date: 2026-09-16 (evening). Authorization: Craig, in session: "make the best decision scientifically to make the EEGs most
realistic", "add all the specs", brushes "should be higher amplitude". Inputs: `EEG_ATLAS_P5_CANDIDATE_REVIEW.csv`
(10 accept, 12 revise, 2 reject, 8 pending at the time of writing) and the per-card JSON in `research/eeg-atlas/p5/review/decisions/`.

## Craig's findings, grouped

| Defect | Cards | Fix (0.4.0) |
|---|---|---|
| Seizures do not evolve: no build-up, frequency does not speed up then slow, "starts hard", stationary | C17 C18 C19 C26 | `evolution.profile: recruit` — low-voltage fast onset, stepwise log-frequency random walk toward `end_hz`, amplitude climbing to `amplitude_end_uv`, late clonic bursting; per-third dominant frequency now differs |
| Muscle at focal onset | C15 C19 | seizure `muscle` defaults to `none` when `spread: none`, `modest` otherwise; muscle still follows clinical spread |
| Brushes: fast burst must ride a high-voltage negative delta wave | C02 | `DELTA_BRUSH_PMA` amplitudes ×1.7 (270 µV p2p at the 30–33 w peak), burst/wave ratio 0.30 → 0.22; neonatal pages read at LFF 0.5 Hz |
| Term "low voltage continuous" should be burst suppression with flat interburst intervals; encephalopathic discontinuity needs lower interburst voltage and longer intervals, controlled by gestational age | C03 C05 C07 | new `background.ibi_range_s: [lo, hi]` and `background.ibi_floor_uv` (absolute) beside the PMA table; C03/C05 re-authored |
| Patting too quiet and continuous; chewing not like the atlas; blinks too small and not sharp | C12 C16 C20 | artifact model 2: patting 90 µV in 3–8 s bouts, chewing 1.2–1.6 Hz irregular EMG bursts with glossokinetic slow wave; blinks 160 µV with a fast rise and slower decay (`blink_amplitude_uv`) |
| 40 % attenuation not visible; PDR field too wide; "low voltage" reads as slow | C04 C13 C23 | `asymmetry.profile: hemispheric` (full attenuation on every electrode of that side); tighter posterior PDR field; display-referenced amplitude below |
| BRD too regular | C11 | `brd` morphology `ictal` with fluctuation |
| GPD too stationary | C26 | ±10 % per-run rate jitter and 0.30 amplitude fluctuation for periodic patterns (still no evolution: evolution would make it a seizure) |

## Amplitude semantics (Craig delegated the decision)

`amplitude_uv`, `amplitude_start_uv`, `amplitude_end_uv` become the **peak-to-peak a reader measures on the display
montage** (longitudinal bipolar for children and adults, the neonatal reduced montage for neonates), 1-s windows, median
over the derivations of the region concerned. That is the quantity ACNS criteria are defined on (low voltage < 20 µV,
suppression < 10 µV, neonatal voltage categories), so request equals what the page shows. Implementation: per-kind
calibration constants measured with the P4 estimators (`DISPLAY_CAL` in `synth.py`; a test keeps delivered/requested
within ±15 %). The hidden type multipliers (`suppressed` 0.06, `low_voltage` 0.28, `burst_suppression` 1.10) go away:
a suppressed record is authored as the voltage wanted on screen. Legacy meaning stays available as
`amplitude_reference: referential`.

## Version upgrade without silently changing the bank

Every default flip lives behind `spec_version` (normalized into the spec, so it is in the hash). A spec that omits it is
version 2 and gets the new defaults (riding brushes, gain cap 2.0, blinks off when unreactive or suppressed, PDR gain
2.5, display amplitude reference, hemispheric asymmetry, recruit evolution, spread-dependent muscle, artifact model 2,
blink 160 µV). The 48 committed questions are pinned by writing `spec_version: 1` into their YAML (`pin_spec_version.py`),
so they normalize to their old dictionaries and synthesize byte-identically (test + re-render check); their sidecars
are restamped for the version/hash. Migrating a question to version 2 is then a deliberate per-item edit with a
side-by-side render.

## Status 2026-09-16 (paused at Craig's request)

Renderer 0.4.0 is committed on `eeg-teaching-lab` (not on main, not deployed): all generator changes above, the
spec_version pin of the bank (3 questions re-rendered byte-identical), sidecars restamped, 115 tests passing.
Additional maturation facts folded in from the sources Craig supplied (Hrachovy/Mizrahi/Kellaway table; NCBI NBK390356;
obgynkey ch. 4; Alix et al. intro): brush field central < 31 w and occipito-temporal after, gone by 39 w; burst
fraction 0.34 at 34–35 w; temporal theta 20–200 µV, alpha bursts at 33 w only; reactivity absent below 34 w; longest
acceptable IBI 6 s at 37–40 w, 10 s at 34–36, 20 s at 31–33 (already the shape of `PMA_TABLE`); interburst < 2 µV at
24–29 w; tracé alternant attenuation 3–15 s, bursts 50–100 µV every 4–5 s, interburst < 50 µV 4–7 Hz.
Not done: P5 candidate revisions and re-render, the background calibration test, merge/deploy, docs — listed in
HANDOFF.md.

## Status 2026-09-19 (renderer 0.4.1, on `eeg-teaching-lab`, not yet merged or deployed)

0.4.0 was merged and deployed on 2026-09-18 (main `5913c80`, both worker fleets). This session finished the rest and
found three generator defects while re-rendering the candidates, fixed in **0.4.1** (all behind the version-2 defaults
or the new 0.4.0 keys, so the 52 pinned bank images stay byte-identical; sidecars restamped, 52/52 verified):

- **Background calibration estimator.** The 1.14–1.23× over-delivery reported on 09-18 was the check, not the
  calibration: six 60 s windows sampled a ±24 % envelope and counted blink seconds on F-anchored pairs. Measured
  whole-record and between blinks the child/neonate cases are 1.07/1.02; the synthesizer's own calibration re-measures
  to 1.000 and scales linearly. `calibrate_display.py` now reads the whole record, blink-free; new
  `tests/test_display_calibration.py` (10 cases, ±15 %).
- **Burst-type calibration measured the interburst.** The 80th percentile of all seconds sits in the interburst once
  bursts occupy under a fifth of the record (a 2 s burst every 17 s); the scale clipped at 4.0 and C03 rendered 2–3×
  bursts over a 10 µV "flat" interburst. 0.4.1 measures inside the scheduled bursts. Delivered: BS 30 → 29.1 µV bursts,
  3 µV floor → 3.3; discontinuous 40 → 41.1; adult BS 50 → 50.7.
- **`ibi_range_s` was rescaled.** The suppression-fraction cycle model multiplied an authored 10–30 s into 28–40 s
  with 8 s bursts. An authored range is now drawn directly (log-normal, `burst_s`-long bursts); the PMA/preset path is
  unchanged for specs without it.
- **Fragment runs.** A rhythmic-pattern run truncated at the pattern window's end put a 1.6 s "LPD run" in C25's
  answer key. Version 2 does not start a run that cannot fit its cycles.
- **Graphoelement fields on the reduced array** (Craig, second pass, same day: "no field to the other electrodes";
  positive sharps / negative frontal deflections absent from adjacent channels). The field tables name 10-20
  electrodes, and `neonatal_9` has no F3/F4/Fz/F7/F8, so a frontal sharp transient existed at Fp1/Fp2 only. Version 2
  spills a tabled field onto every acquired electrode the table does not name (`max_k v_k·exp(-(d/0.65)²)`, a fifth of
  that across the midline for unilateral elements): frontal sharp now Fp 1.0, C3/C4 0.32, Cz 0.33, T3/T4 0.18; brushes
  reach C3 0.35 and the contralateral occiput 0.08. Named electrodes keep their tabled values, so a full 10-20 array
  renders as authored, and version 1 keeps the bare lookup. Applies to graphoelements and brush events; spontaneous
  blinks keep their own steep field.

Candidates: C03 re-authored as term encephalopathic burst suppression (30 µV bursts, 3 µV interburst, 10–30 s); C05 as
encephalopathic discontinuity (interburst 10–25 s at 8 µV, Cork grade 3); C23 as 18 µV on the display montage with a
diffuse 7 Hz mix and no posterior rhythm; new **C33**, the sub-term brush exemplar Craig asked for on C02 (32 w tracé
discontinu, riding brushes at their PMA peak). The other revise cards (C02, C11, C12, C15–C20, C26) are answered by the
version-2 defaults. All 33 specs hash differently under version 2, so every CSV row is `pending` again; the 09-16
verdicts are kept in `research/eeg-atlas/p5/review/decisions/` (per-card JSON and the dated CSV backup).

**Craig's second pass (same day, live gallery): 24 accept, 3 revise (C08, C17, C26), 3 reject (C22, C23, C32),
3 not scored (C03, C18, C24).** Acted on, all spec_version 2 only:

- **Page polarity.** `render_page` drew `row + offset` with matplotlib's y-up, i.e. positive-UP, the opposite of the
  clinical negative-up convention, of every atlas, and of the site's own Lab viewer (`src/lib/eeg/montage.ts` paints
  negative-up). That is why blinks rose ("should be sharper down") and why the encoches' large positive phase pointed
  up. `page_polarity(spec)` now returns −1 for version 2 (EEG page and the aEEG raw strip); version 1 keeps the
  pinned bank's pixels. **The 52 pinned bank pages are therefore drawn positive-up and stay so until each is migrated
  to version 2 deliberately** (Craig's call; the P6 migration path already exists).
- **Blinks** (C17, C20): field steepened (F3/F7 0.30/0.32 of Fp, C3/T3 ≤ 0.06 — 0.4.0's F3 = 0.5 made Fp1-F3 and F3-C3
  equal, the "second blink" a row down), 45 ms rise / 120 ms decay (0.14 s at half height, ~0.4 s in all), and the
  `eye_blink` artifact event shares the same blink. Combined with negative-up they now dip at Fp.
- **Muscle** (C08 "shouldn't have fast muscle"): `reactivity: absent` silences the tonic EMG floor, bursts included.
- **Candidates, one revision each** (P0 stop rule): C22 → 4 µV featureless, no PDR, 3 µV/mm; C23 → 15 µV, no PDR
  stream, 5 Hz mix; C26 → GPD 110 µV on a 15 µV featureless slow background; C32 → 30 % attenuation with 4 Hz of
  slowing.
- **S22 (Castro Conde 2017, Craig-supplied PDF)** encoded: `GRAPHOELEMENT_PMA_V2` frontal_sharp 0.5/min at 40 w
  (30/h on day 3; the table had 1.8/min), `DELTA_BRUSH_PMA` tail 0.15/min at 40 w → 0 at 41 w (5 % of bursts
  brushed on day 3). Not modelled yet: the first-six-hours state, term transient sharp waves (7.6/h, mostly temporal).

Every version-2 page changed under the polarity flip, so the accepted rows describe pages that now look different
(inverted, with new blinks). The neonatal specs also re-hashed (the version-2 graphoelement defaults enter the
normalized spec), which made `p5_run.py` reset Craig's same-day neonatal verdicts; they were restored from the per-card
JSON (`decisions/<id>.json`, `saved_at` 2026-09-19) onto the new hashes, and only the four re-authored candidates
(C22, C23, C26, C32) plus the three never scored (C03 was scored in the second pass; C18, C24 were not) stay pending.
Backup: `decisions/EEG_ATLAS_P5_CANDIDATE_REVIEW.backup-20260919-secondpass.csv`. Craig should glance at the accepted
pages once more rather than re-score them.

Remaining: merge `eeg-teaching-lab` → main, deploy 0.4.1 to both worker fleets (until then new Lab renders are stamped
0.4.0 and `verify_sidecars` would reject them), Craig's look at the re-rendered gallery, decision on migrating the
bank pages to negative-up.

## Deliverables

- renderer 0.4.0 (`spec.py`, `synth.py`, `schema.py`, tests: `test_p6_realism.py`, `test_display_calibration.py`)
- `tools/eeg-render/pin_spec_version.py`; 48 YAMLs pinned; sidecars restamped
- P5 candidates revised per card (`p5_candidates.py`), re-rendered, gallery rebuilt, CSV rows for changed specs reset to pending — done 2026-09-19 (0.4.1, 33 candidates)
- workers deployed (Moltbot + CraigsRig) — 0.4.0 done 2026-09-18; 0.4.1 pending
