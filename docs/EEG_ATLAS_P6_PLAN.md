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

## Deliverables

- renderer 0.4.0 (`spec.py`, `synth.py`, `schema.py`, tests: `test_p6_realism.py`, `test_display_calibration.py`)
- `tools/eeg-render/pin_spec_version.py`; 48 YAMLs pinned; sidecars restamped
- P5 candidates revised per card (`p5_candidates.py`), re-rendered, gallery rebuilt, CSV rows for changed specs reset to pending
- workers deployed (Moltbot + CraigsRig)
