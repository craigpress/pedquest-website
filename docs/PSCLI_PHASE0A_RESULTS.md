# PSCLI proof — Phases 0a and 0c

**Phase 0a** (below) proved PSCLI runs unattended against Persyst's own sample.
**Phase 0c** (§ at the end) ran the same chain against a *generated* recording and answered every
question 0a left open. Read 0c first if you want the result; 0a is the method and the negative controls.

---

## Phase 0a — PSCLI unattended proof

Run 2026-09-11 on CraigsRig against the **bundled Persyst sample**
(`C:\ProgramData\Persyst\Samples\SK000.LAY`), copied to a scratch directory first. No patient data
touched, no code written. This resolves the highest-risk unknown in the EEG Teaching Lab plan.

**Sample:** 19 channels, 200 Hz, 1,128,448 bytes → 29,696 samples → **148.48 s**.
`PSCLI.exe /Version` → `15C3:2026.05.07`.

## Result: the chain works, unattended

| Step | Exit | Wall clock |
|---|---|---|
| `/Process /MMX="Trend Settings Version P15.mmx"` | **0** | 11.8 s |
| `/DetectSeizures` | **0** | 0.3 s |
| `/ExportCSV /Panel="VsBaseline Comprehensive" /MMX=… /ArtifactReduction=Off` | **0** | 0.4 s |

**No modal licence dialog, no prompt, no hang.** The 48-hour `.plek` refresh and the April 2026
"License Expired" dialog in the logs did not bite here, but a worker must still carry a hard timeout —
one clean run is not proof the dialog can never appear.

Products: `SK000.Persyst\` (one `.raw` + one `.ar` per instrument), `SK000.mg2`, `.mg2.af1`, `.mg2.af2`,
`.mg2.indx`, `.mg2.mmx` (548 KB — the MMX copied into the study), `.mg2.ntf.xml`, `.mg2.xml`, and
**`SK000.Persyst\mg2.montages.xml`** — the montage configuration actually used, which is the provenance
record to capture alongside the MMX hash.

## Finding 1 — a failed baseline is silent, and looks like a valid result

The sample is 148 s. The adult MMX's `AutoSearch` starts at `StartTime=270`, so **no baseline window
exists**. Persyst did not warn, did not fail, and did not emit `NaN`:

| Instrument group | n values | zeros | min | max |
|---|---|---|---|---|
| `I16` VsBaseline, FFT Spectrogram, Left Hemisphere, 0–20 Hz | 5,960 | **5,960** | 0.0 | 0.0 |
| `I17` VsBaseline, FFT Spectrogram, Right Hemisphere, 0–20 Hz | 5,960 | **5,960** | 0.0 | 0.0 |
| `I15` Heart Rate | 149 | **149** | 0.0 | 0.0 |
| `I1` Artifact Intensity | 447 | 287 | 0.0 | 8.44 |
| `I8`/`I9` Rhythmicity Spectrogram L/R | 14,453 ea. | ~8.4k | 0.0 | 11.70 / 10.23 |
| `I10`/`I11` FFT Spectrogram L/R | 5,960 ea. | 1,800 | 0.0 | 2.45 / 2.30 |
| `I12` Asymmetry, Relative Spectrogram | 5,960 | 1,800 | −35.04 | 38.41 |
| `I13`/`I14` aEEG L/R | 745 ea. | 240 | 0.0 | 40.37 / 36.98 |

**An all-zero VsBaseline column is indistinguishable from "signal equals baseline".** Exit code 0,
clean stderr. So a worker *cannot* infer baseline validity from the exit code, from `NaN`, or from the
absence of an error — it must read back the accepted baseline explicitly, or treat an all-zero
VsBaseline trace as `baseline unavailable`. This is the concrete form of the plan's requirement for an
*observed accepted baseline*.

**Heart Rate is all zero for the same class of reason**: the sample is `Ref-Transverse` 19-channel with
no channel name matching `AutoEKGChannels`. This is exactly the failure predicted for carrying ECG on
synthesized ears — confirming the exporter must emit a dedicated, correctly-named ECG channel or declare
heart-rate outputs unavailable.

## Finding 2 — the planned acceptance gate is currently unreachable

The plan's gate was "the CSV reconciles via `parse_persyst_csv()` + `match()`'s `one_to_one`".

`parse_persyst_csv()` is clean: 149 rows, `trend_row_index=6`, `code_row_index=7`, 17 descriptions,
417 codes, metadata parsed (`patient_id='SK000'`, `test_date='1900.01.31'`).

`mmx_label_resolver.match()` returns **`one_to_one: False`** — on a *known-good Persyst-authored file*:

- `n_unmatched: 3` — **`I16` and `I17`, the two VsBaseline instruments**, plus `I18 Comment`.
  `build_labels()` cannot reconstruct a `VsBaseline, …` CSV label, because it does not handle the
  `VsBaselineNValue <24> [ … ]` derived-instrument wrapper. `Comment` is a pseudo-instrument with no
  MMX definition at all.
- `n_ambiguous: 7` — `I2`/`I3` collapse to `SeizureProbabilityP14 Probability` vs `Detections`, and
  `I4`–`I7` collapse across the four spike-lateralisation booleans.
- `n_mmx_instruments: 289`, of which only **9** resolve uniquely.

So the gate must be restated. Either fix the resolver (add `VsBaselineNValue`, disambiguate by
`InstanceID`/panel membership as the review recommended, special-case `Comment`/`Time`), or map by panel
membership + `InstanceID` instead of by reconstructed name. **"No unmatched columns" was not merely
insufficient as an acceptance test — it is not currently achievable.**

## Smaller confirmations

- **`/DetectSeizures` writes into the source `.lay`.** After the run, `[Comments]` contained:
  `0.000000,0.000000,0,65536,@Warning: Persyst is post processing. Detection notifications are turned OFF.`
  That is a real-world sample of the comment grammar: `time,duration,state,type,text`, `%.6f` times,
  `state=0`, `type=65536`, `@`-prefixed text. Working on a copy is mandatory, not hygiene.
- **No `.SD4` was produced**, despite exit 0. The log read
  `P14 seizure detector: Duration=148 sec, Process Time=0 sec`. Detection ran under the **Persyst 14**
  detector as documented — not the MMX's engine selection.
- **Date formats differ between file and export.** `.lay` holds `TestDate=1900/01/31` (YYYY/MM/DD);
  the CSV emits `TestDate,1900.01.31` (dot-separated). Both are among MNE's three accepted forms.
- **Adult sub-column axes match the hardcoded schema**: FFT spectrogram = 40 bins, rhythmicity = 97 bins,
  exactly as `subcol_schema.py` assumes. The review's caution about hardcoded axes therefore applies to
  neonatal and custom instruments, not to this adult preset.
- **The sample `.lay` has no `[ChannelMap]` section** — it references an external named map
  (`ChannelMap=CdwTrans19Map`) and carries `Sensitivity=150`, `Montage=Ref-Transverse`,
  `MainsFrequency=60`. Whether an *inline* `[ChannelMap]` is accepted is still untested and is the first
  thing Phase 0c must probe.
- **The qEEG pipeline refuses to load without `QEEG_EXPORT_DIR`**, deliberately, because real export
  directory names are patient identifiers. Any worker integration must set it to a scoped work directory.

## What this changes in the plan

1. Phase 0a is **green** — PSCLI is viable for an unattended worker. Phase 2 is unblocked.
2. The VsBaseline acceptance check becomes: read back the accepted baseline, and treat all-zero as
   unavailable. Never infer success from exit code.
3. The reconciliation gate needs resolver work before it can pass; budget it in Phase 2 rather than
   assuming the existing tooling reconciles.
4. Phase 0c's first probe is the inline `[ChannelMap]`, since the bundled sample does not demonstrate one.

---

# Phase 0c — generated recording through the same chain

Run 2026-09-11. A **30-minute synthetic recording** written straight from `eeg_render`'s synthesizer to
Persyst `.lay/.dat` by a ~90-line probe script, then put through the identical PSCLI sequence.

**Recording:** 22 channels (`standard_19` + `A1`, `A2`, and a dedicated `EKG` row at 900 µV),
200 Hz, 1,800 s, `Calibration=0.1` µV/count, `DataType=0` (int16), 15,840,000 bytes, **zero samples
clipped**. Written with an **inline `[ChannelMap]`** and an empty `[Comments]` section.

**Spec:** `age_group: child`, continuous 7 Hz background at 45 µV, and **one left-temporal seizure at
18:00 lasting 110 s** (4.0 → 1.8 Hz, 60 → 170 µV, hemispheric spread, 60 s postictal attenuation).
Deliberately placed clear of the 270–570 s baseline window.

| Step | Exit | Wall clock |
|---|---|---|
| `/Process /MMX=…` | 0 | 57.1 s |
| `/DetectSeizures` | 0 | 32.5 s |
| `/ExportCSV /Panel="VsBaseline Comprehensive" /ArtifactReduction=Off` | 0 | 1.7 s |

≈31× real time for processing. The CSV is 5.3 MB, 1,801 rows at 1 Hz.

## The headline: Persyst's production detector found the synthetic seizure

`/DetectSeizures` wrote three comments into the `.lay`:

```
0.000000,0.000000,0,65536,@Warning: Persyst is post processing. Detection notifications are turned OFF.
0.500000,1799.000000,0,65536,@SeizuresProcessed(P14) v=2026.05.07 alg=5 p=0.10 d=2
1083.000000,103.000000,0,65536,@SeizureDetected(P14) p=0.949
```

| | Ground truth | P14 detector | Error |
|---|---|---|---|
| Onset | 1080.0 s | 1083.0 s | **+3.0 s** |
| Offset | 1190.0 s | 1186.0 s | **−4.0 s** |
| Duration | 110 s | 103 s | −7 s |
| Confidence | — | **p = 0.949** | — |

The seizure-probability trend holds 0.949 continuously from 1083 s to 1186 s and sits at **0.000
everywhere else** — 1,698 of 1,801 seconds are zero, so there were **no false positives** across the
30-minute record.

**Read this carefully.** It shows the export is faithful enough that a commercial, clinically validated
detector responds to it, and that the event lands where the answer key says. It does **not** show the
waveform would convince an epileptologist — detector-plausibility is not human realism, and a parametric
rhythmic run may well be *easier* to detect than a real seizure. If anything, *p = 0.949 with zero false
positives over 30 minutes is suspiciously clean*: real records generate false positives, and a synthetic
one that generates none may simply be too quiet. That is a realism signal pointing the wrong way, and it
is an argument for §5c's DSP work, not against it.

Also note `alg=5 p=0.10 **d=2**` — the applied duration threshold was 2, not the `1.0` the CLI help
documents as default, confirming that unspecified flags come from persisted GUI state. Pass them all.

## Every Phase 0a open question resolved

| Question | Answer |
|---|---|
| Does Persyst accept an **inline `[ChannelMap]`**? | **Yes.** The file processed, detected and exported normally. No external named map needed. |
| Does a named ECG channel fix Heart Rate? | **Yes.** Heart Rate went from *all zero* (0a) to 0–101.7 bpm with only 51 zero seconds of 1,801. A channel literally named `EKG` is enough. |
| Do VsBaseline instruments produce values when a baseline exists? | **Yes.** I16/I17 went from *all zero* (0a) to −3.60…+5.17 and −4.05…+3.31. The all-zero signature in 0a was purely baseline unavailability — which makes it a usable sentinel for it. |

## The trends are correctly lateralized

The spec placed the seizure left-temporal. Persyst's own engine, with no knowledge of that:

| Trend | Left | Right | Ratio |
|---|---|---|---|
| Rhythmicity spectrogram (max) | **35.97** | 4.31 | 8.3× |
| aEEG (max, µV) | **67.25** | 17.56 | 3.8× |
| FFT spectrogram (max) | **3.71** | 1.54 | 2.4× |
| Asymmetry, relative | −91.64 … **+77.91** | | strongly lateralized |

Spike-density instruments for the right hemisphere and generalized channels stayed at exactly zero —
correct, since the spec contained no spikes.

---

# Phase 1 — production exporter through the same chain

Run 2026-09-12 with `eeg_render.export` (not the probe script), exporting `PQ-A-012` at its native
120 minutes / 256 Hz: 1,843,200 samples × 21 channels, peak 250 µV, **zero clipped**.

## The detector found both seizures

| | Ground truth | P14 detector | Error |
|---|---|---|---|
| Seizure 1 onset | 1920.0 s | 1933.0 s | +13.0 s (p = 0.948) |
| Seizure 2 onset | 5040.0 s | 5042.0 s | **+2.0 s** (p = 0.922) |

Both found, correct order, no false positives across two hours. The answer key recorded both as
`generalized`, matching the spec. The detector reports shorter durations than the truth (31 s and 43 s
against 90 s) — it marks the electrographically evolving core, not the full commanded event, which is a
useful reminder that a detector's extent and a generator's extent are different quantities.

## `/Process` faults intermittently — plan for retries

`/Process` returned **`0xC0000005` (access violation)** on that run. Chasing it produced a controlled
result worth recording, because the obvious conclusions were all wrong:

- **Not the exporter.** The same writer, duration, sample rate, channel set and EKG row produced a file
  that processed to exit 0 under a different spec.
- **Not the `[Comments]` block.** Faults identically with an empty one.
- **Not the sample rate or the missing EKG channel.** All four combinations of {200, 256 Hz} ×
  {with, without EKG} faulted.
- **Not degenerate signal.** The background is an ordinary continuous 4 Hz / 55 µV: per-channel σ
  3.8–12.5 µV, longest constant run 6 samples, 787 distinct quantised values, peak 86 µV.

A background-parameter sweep then appeared to isolate `amplitude_uv=55`. **It did not.** Re-running the
*identical bytes* three times each, with a fresh working directory per trial:

| Variant | trial 1 | trial 2 | trial 3 |
|---|---|---|---|
| baseline (0c spec) | FAULT | FAULT | OK |
| dominant_hz 4.0 | OK | OK | OK |
| amplitude 55 | OK | FAULT | OK |
| slow_fraction 0.65 | OK | OK | OK |
| all three | OK | OK | FAULT |
| baseline, other seed | OK | FAULT | OK |

**Five faults in eighteen runs on unchanged input.** Four of six variants flipped verdict between
trials. The fault is **intermittent, not content-determined**, and the apparent parameter sensitivity was
sampling noise.

### It scales with recording length, and long recordings do not recover

A first pass concluded "roughly one run in three, so retry and move on". **That was wrong**, and the
error mattered: it made an unusable configuration look merely flaky. Measuring against duration — same
spec, same MMX, fresh working directory per trial:

| Recording | samples/channel | Trials |
|---|---|---|
| Persyst's own `SK000` sample (148 s, 19 ch) | 29,696 | OK ×4 |
| Ours, 2.5 min | 38,400 | OK, OK, OK |
| 5 min | 76,800 | FAULT, OK, FAULT |
| 10 min | 153,600 | FAULT, OK, FAULT |
| 20 min | 307,200 | FAULT, OK, FAULT |
| 30 min | 460,800 | FAULT, FAULT, OK |
| **40 min** | 614,400 | **FAULT ×8** (3 sweep + 5 consecutive worker retries) |

So: reliable at ≈2.5 minutes and below, roughly two failures in three from 5 to 30 minutes, and **eight
consecutive failures at 40 minutes** — where the worker's full five-attempt retry ladder did not recover.

Ruled out along the way, each by direct test rather than inference: file content (identical bytes flip
verdict), sample rate, channel count, the presence of an `EKG` row, pre-existing `[Comments]`, disk space
(238 GB free), lingering Persyst processes (none), and machine degradation — **Persyst's own bundled
sample still passes 3/3 at the end of the session**, on the same install and MMX that was failing our
40-minute file moments earlier. The crash does not reach the Windows Application event log.

### Consequences

1. **Retry `/Process` on `0xC0000005`, and only that code.** It genuinely recovers the 5–30 minute band;
   at a ~⅔ per-attempt rate, five attempts leave ~1% residual. Treat every other non-zero exit as a real
   failure — blanket retrying would hide bugs.
2. **Retries do not rescue long recordings.** The worker must surface "faulted on all attempts" as a
   first-class outcome, not an edge case, and the page must present a case whose trends failed as
   *unprocessed* rather than silently trend-less.
3. **Persyst processing is an enrichment, not a dependency.** The architecture already computes every
   trend locally, which is what makes this survivable: a case without vendor trends is still a complete
   teaching case. Do not let the lab's critical path run through PSCLI.
4. **Re-process into a fresh working directory each attempt**; a faulted run leaves partial
   `<name>.Persyst\` products behind.
5. Verify the trend outputs after a *successful* exit too — this is a memory fault, so a run that exits 0
   after a near-miss deserves the same all-zero sentinel checks as §Finding 1.
6. **This is a reportable vendor defect** with a minimal reproduction: a valid `.lay/.dat` above roughly
   five minutes, `/Process` with a stock P15 MMX, on Persyst `15C3:2026.05.07`. Worth raising with Persyst
   directly — it blocks exactly the hours-long records the product exists to process.

## Incidental: Persyst renames channels on processing

`/Process` **rewrites the `.lay`**, suffixing every channel in `[ChannelMap]` with `-Ref`
(`Fp1` → `Fp1-Ref`). Both faulting and succeeding files came back renamed, so it happens early. Anything
that reads a `.lay` back after processing must tolerate the suffix — MNE already strips it.

## Carry into Phase 1

- The `.lay` header that works: `[FileInfo]` with `File`, `FileType=Interleaved`, `SamplingRate`,
  `HeaderLength=0`, `Calibration`, `WaveformCount`, `DataType=0`, `MainsFrequency=60`; an inline
  `[ChannelMap]` with contiguous 1-based indices in binary order; `[Patient]` with `TestDate` as
  `YYYY/MM/DD` and `TestTime` as `HH:MM:SS`; an empty `[Comments]`. ASCII, CRLF. **No `[SampleTimes]`,
  no `Montage=`, no `Sensitivity=`, no `ChannelMap=` key** — all omitted, all fine.
- `Calibration=0.1` µV/count over int16 gave ±3,276.7 µV of headroom and zero clipping on a 45 µV
  background with a 170 µV seizure. Keep it.
- Emit the dedicated `EKG` row. It costs one channel and switches on a whole engine.
- Probe script: `scratchpad/make_lay.py` (not production — it synthesizes in a single call to avoid the
  known chunk-seam defects, which Phase 1 fixes before any streaming exporter ships).
