# Synthetic EEG for qEEG education — landscape, feasibility, and what realism would cost

PedQuEST research note · 2026-09-11 · Craig A. Press

This note answers four questions asked of the PedQuEST EEG Teaching Lab proposal: what else exists for
**generating** EEG, what exists for **viewing** it on the web (including from BDSP/Westover and other
academic groups), what has been **published**, and what it would actually **cost** to make synthetic
waveforms convincing to an epileptologist. It is written to be shared with Persyst, with CDAC/BDSP, and
with the PedQuEST education group.

Claims are linked. Where something is unverified it says so.

---

## 1. Summary

PedQuEST already runs a deterministic synthetic-EEG engine that synthesizes referential scalp potentials
for a full electrode array from a declarative scenario spec, and then **computes** aEEG, alpha-delta
ratio, suppression ratio, asymmetry, rhythmicity and spectrograms from those voltages using the same
algorithms a review station uses. It does not draw trends — it derives them. Fifty-two teaching items are
already built on it.

Two things follow, and this note is about whether they hold up.

**First, the engine can emit recordings, not just pictures.** Because it can synthesize any time window,
it can synthesize hours, and export them as Persyst `.lay/.dat` or EDF+ so they open in any review
station. That makes a teaching case a *thing a learner can scroll through*, not a figure.

**Second, that closes a loop nobody else can close.** A generated recording can be processed by Persyst's
own production engine and detectors, so the trends a learner sees are the trends the vendor's software
produces, and the vendor's detectors become an external check on the synthesis. We proved that loop runs
unattended on 2026-09-11 (§3).

The honest state of the art: **no published system generates controllable, hours-long, clinically
labelled pediatric critical-care EEG with matched qEEG trends.** Existing generative EEG work is
second-to-trial-scale, few-channel, and aimed at classifier augmentation. Existing web EEG viewers are
either research-data browsers or full platforms, not embeddable teaching components. Existing EEG
teaching tools use *real* data and teach one task at a time.

---

## 2. What the engine already does

| | |
|---|---|
| Synthesis | Referential potentials per electrode, 10-20 array or 9-electrode neonatal, spectrally shaped background plus explicit events |
| Determinism | Bit-exact; any window regenerable in isolation via overlap-add of independently keyed frames |
| Scenario control | ~10 event types — seizures, clusters, status, sedation change, attenuation transients, temperature, stimulation, artifact, state change, ACNS rhythmic/periodic patterns |
| Trends | Computed from the voltages: aEEG, ADR, TDR, suppression ratio, asymmetry (relative + index), rhythmicity, FFT spectrogram, peak envelope |
| Provenance | Every image carries a sidecar with a SHA-256 over the normalized spec plus the renderer version; an importer rejects any mismatch |
| Ground truth | The scenario spec *is* the answer key |

That last row is the whole argument. A model trained on real EEG gives you realism and takes away labels.
A forward simulator gives you exact labels and, today, less realism. §6 is about closing that gap without
giving up the labels.

**Known limitation, stated plainly.** An internal review this week found that the synthesizer is
currently *partition-dependent*: five code paths (artifact RNG keyed to the request window, per-request
ECG jitter, chunk-normalized neonatal delta brushes, envelope convolutions padded at request edges, and
per-request `sosfiltfilt`) mean the same absolute second can yield slightly different samples depending
on how the window was requested. That is being fixed before any recording is exported, because
"the image and the file are the same recording" has to be literally true.

---

## 3. The Persyst loop is proven to run unattended

Run 2026-09-11 on a licensed Persyst 15 workstation (`15C3:2026.05.07`) against Persyst's own bundled
sample (19 ch, 200 Hz, 148 s), copied to a scratch directory:

| Step | Exit | Wall clock |
|---|---|---|
| `PSCLI /Process /MMX="Trend Settings Version P15.mmx"` | 0 | 11.8 s |
| `PSCLI /DetectSeizures` | 0 | 0.3 s |
| `PSCLI /ExportCSV /Panel="VsBaseline Comprehensive"` | 0 | 0.4 s |

No prompt, no modal dialog. The export is a 418-column CSV covering 17 instruments — artifact intensity,
seizure probability, spike lateralisation, rhythmicity and FFT spectrograms, asymmetry, aEEG, heart rate
and the two VsBaseline instruments.

Two operational findings worth recording for anyone attempting the same:

- **A failed baseline is silent.** The 148 s sample is shorter than the adult MMX's baseline auto-search
  start (270 s), so no baseline exists. Persyst emitted **5,960 zeros per VsBaseline instrument**, exit
  code 0, clean stderr — indistinguishable from "signal equals baseline". Baseline validity has to be
  read back explicitly; it cannot be inferred from success.
- **Heart rate was also all-zero**, because no channel name matched the MMX's `AutoEKGChannels` list.
  Any synthetic recording intended for heart-rate or ECG-dependent processing needs a dedicated,
  correctly-named ECG channel — ECG contamination carried on ear electrodes does not satisfy it.

### A generated recording, through the same chain

The same day, a **30-minute synthetic recording** was written straight from the synthesizer to
`.lay/.dat` — 22 channels (19 electrodes, both ears, and a dedicated `EKG` row), 200 Hz, 0.1 µV/count,
zero samples clipped — carrying **one left-temporal seizure at 18:00 lasting 110 s**, deliberately placed
clear of the baseline window. All three PSCLI steps again exited 0 (57.1 s / 32.5 s / 1.7 s; ≈31× real
time for processing).

**Persyst's production P14 detector found it:**

| | Ground truth | P14 detector | Error |
|---|---|---|---|
| Onset | 1080.0 s | 1083.0 s | **+3.0 s** |
| Offset | 1190.0 s | 1186.0 s | **−4.0 s** |
| Confidence | — | **p = 0.949** | — |

The probability trend holds 0.949 from 1083 s to 1186 s and is 0.000 everywhere else — no false
positives across 30 minutes. The vendor's own trend engine also lateralized it correctly with no
knowledge of the spec: left/right rhythmicity maxima of 35.97 vs 4.31 (8.3×), aEEG 67.3 vs 17.6 µV,
relative asymmetry spanning −91.6 to +77.9.

Both Phase 0a null results resolved as predicted: with a baseline window present, VsBaseline produced
real values (−3.60…+5.17); with a channel literally named `EKG`, heart rate produced 0–101.7 bpm. An
**inline `[ChannelMap]` was accepted**, so no external named montage map is required.

**This result should be read narrowly.** It shows the export is faithful enough that a clinically
validated detector responds to it, and that events land where the answer key says. It does *not* show the
waveform would convince an epileptologist. Detector-plausibility is not human realism, and a parametric
rhythmic run may be *easier* to detect than a real seizure. Indeed *p = 0.949 with zero false positives
over 30 minutes is suspiciously clean* — real records generate false positives, and a synthetic one that
generates none is plausibly too quiet. That is a realism signal pointing the wrong way, and an argument
for the differentiable-DSP work in §7.2, not against it.

Full detail: `docs/PSCLI_PHASE0A_RESULTS.md`.

---

## 4. Landscape — EEG generation

| Work | Approach | Scale it operates at | Strengths | Limits for clinical teaching |
|---|---|---|---|---|
| **PedQuEST `eeg_render`** | DSP forward synthesis from a declarative spec | Minutes to 24 h, 9–21 ch | Exact intended labels; deterministic; trends computed not drawn; no PHI | Parametric texture; hand-built spike/transient morphology |
| [EEG-GAN (AutoResearch)](https://github.com/AutoResearch/EEG-GAN) | GAN, trial-level | Single ERP epochs | The best-benchmarked augmentation toolkit — beat six baselines in 69% of comparisons across 4 datasets × 5 classifiers × 7 sample sizes, with a documented evaluation protocol | ERP epochs, few channels; no clinical events; no continuity |
| [Conditional diffusion for ERP](https://arxiv.org/pdf/2403.18486) | DDPM conditioned on paradigm | Seconds | Better spectral fidelity than GANs; conditioning is natural | Experimental paradigms, not pathology |
| [Improved DDPM for EEG augmentation](https://pubmed.ncbi.nlm.nih.gov/39693767/) | Diffusion + sampling improvements | Seconds | Strong augmentation gains | Same ceiling |
| [Conditional flow matching for EEG](https://arxiv.org/abs/2608.00048) (2026) | Flow matching, spatial/temporal attention, spectral consistency | Seconds | Current best architecture candidate | Not clinical, not pediatric |
| [LaBraM](https://arxiv.org/abs/2405.18765), [CBraMod](https://arxiv.org/abs/2412.07236), [BIOT](https://github.com/ycq091044/BIOT), [EEGPT](https://github.com/BINE022/EEGPT) | Masked pretraining on thousands of hours | Seconds-scale patches | Real pretrained EEG weights; reusable inside a generative system | Representation models — no waveform decoder, no generative objective |
| [NeuroGPT](https://arxiv.org/html/2311.03764v4) | EEG encoder + decoder-only GPT | Seconds | Genuinely has a decoder | Predicts embeddings, not calibrated voltages |
| [NeuroRVQ](https://arxiv.org/abs/2510.13068) | Multi-scale residual-VQ tokenizer + generative masked modelling | Seconds | The most credible generative tokenizer line | Tokenization ≠ validated long-form, pathology-conditioned generation |
| Neural-mass models — Jansen–Rit, Wendling, Epileptor; [The Virtual Brain](https://www.thevirtualbrain.org/), [VBI](https://elifesciences.org/articles/106194), [Virtual Epileptic Patient](https://pubmed.ncbi.nlm.nih.gov/36972720/) | Biophysical population models + lead-field forward projection | Hours, whole-brain | Mechanistic; seizure onset and propagation *emerge* rather than being scripted; ~20 nodes runs faster than real time on CPU | Parameter→phenotype mapping is indirect; not turnkey for "a NICU burst-suppression case" |
| [NeuroKit2](https://neuropsychology.github.io/NeuroKit/), MNE `simulate_raw` | Simple simulators | Seconds | Trivial to run; good for tests | Toy realism |

Review of the field: [Virtual Electroencephalogram Acquisition: A Review on EEG Generative Methods](https://pubmed.ncbi.nlm.nih.gov/40431969/),
*Sensors* 2025 — covers VAE, GAN and diffusion approaches and confirms the augmentation-oriented framing.

## 5. Landscape — viewers and web platforms

Sorted by usefulness *as a viewer embedded in a teaching site*.

| Tool | Origin | Language / licence | Deployment | Embeddable? |
|---|---|---|---|---|
| **[Epicurrents](https://github.com/epicurrents)** | Univ. of Eastern Finland; [*Clin Neurophysiol Pract* 2026;11:115–125](https://pubmed.ncbi.nlm.nih.gov/41717536/) | TypeScript, **Apache-2.0** | Library / PWA, offline-capable | **Yes** — the only true library here, and the only surveyed tool that does real **range-request streaming** of EDF (`Range: bytes=` per record-aligned chunk). Also ships a **trend engine** — aEEG, FFT spectrogram, band ratio, pdBSI — that *computes* but does not *draw*. Caveats are serious: bus factor 1, **zero releases or tags**, only 3 of 20 packages on npm, and the published `edf-reader` / `eeg-module` pin core `0.x` and cannot install against core `1.0.3`. Adoption means a commit-pinned build, not `npm install` |
| [squiggly](https://github.com/alexdni/squiggly) | independent | **No licence at all** — no `license` field, `"private": true`, no LICENSE file, GitHub licence endpoint 404s | Self-hosted app | **Not usable.** Default copyright: readable, not copyable. Also React 18 / Next 14, and it downloads the whole file rather than streaming |
| **[Pennsieve](https://docs.pennsieve.io/docs/timeseries-viewer)** | Univ. of Pennsylvania (ex-Blackfynn); [*Sci Data* 2025](https://www.nature.com/articles/s41597-025-06075-5) | Open source | Cloud platform, on-prem deployable | No — but it is the right answer for **hosting real consortium recordings**: browser EEG timeseries viewer with annotation and streaming, 80+ groups, 125 TB. PedQuEST already exports to this ecosystem |
| **[BDSP](https://bdsp.io/) / [CDAC @ Stanford](https://bdsp-core.github.io/code/)** (Westover) | Harvard → Stanford | 260-repo catalog | Mixed | **Their web applications are private.** `bdsp.io_webapp_prod` / `_dev`, `CDAC_Data_Portal`, `morgoth-viewer`, `bdsp-reports-search-web-app` are all closed. Public tooling is analysis and labeling: [IIIC-SPaRCNet](https://github.com/bdsp-core/IIIC-SPaRCNet), [ELROND](https://github.com/bdsp-core/ELROND) (PyQt6 spectrogram seizure annotation), [timeline-viewer](https://github.com/bdsp-core/timeline-viewer) — which is **CC BY-NC 4.0, commercial use prohibited**, and 6 commits with an unmodified Create React App README, so it cannot be vendored. **BDSP's value to this project is data, expert labels and an evaluation panel — not a viewer** |
| [LightWAVE](https://pubmed.ncbi.nlm.nih.gov/26525640/) | Moody, PhysioNet | JS (jQuery) + C CGI | Self-hosted | Architecturally instructive (thin client, server-side range fetch), implementation dated and ECG-centric |
| [Moonlight](https://zzz.bwh.harvard.edu/luna/apps/moonlight) (Luna) | Purcell, BWH/Harvard; NSRR | R + Shiny | Hosted | No — but it will open an EDF from a **URL**, so it can review a file we generate without any integration work. Sleep/PSG focus |
| [RAVE](https://github.com/rave-ieeg) | Beauchamp/Magnotti; [PMC7821728](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7821728/) | R + Shiny | Browser-delivered | No — iEEG analysis platform |
| [IEEG Portal](https://github.com/ieeg-portal) | Litt, Penn | Web platform | Hosted | No — data portal with a viewer |
| [Neurosift](https://neurosift.app) | Flatiron; [PMC13343578](https://pmc.ncbi.nlm.nih.gov/articles/PMC13343578/) | TS, browser | Hosted / self-host | No — NWB/DANDI, but its **remote range-request streaming model is the one to copy** |
| [NEMAR](https://nemar.org) / [EEGDash](https://arxiv.org/abs/2606.16041) | UCSD / OpenNeuro | Web | Hosted | No — BIDS/HED research gateways; good "inspect before download" precedent |
| [EDFbrowser](https://www.teuniz.net/edfbrowser/) | Teunissen | C++, GPL | Desktop | No — but the **free, independent verification target** for our EDF+ export |
| Persyst 15 / Persyst Mobile Cloud | Persyst | Commercial | Windows / web | No — but it is what ~85% of NICUs actually teach on, it automates through PSCLI, and Persyst 14 Rev. D exposes a Data API |

**Conclusion.** The embeddable-viewer question has essentially one answer, **Epicurrents**, and no viable
fallback — squiggly turns out to be unlicensed and BDSP's timeline-viewer is non-commercial, so neither
can be copied from. Adoption is at the *library* level inside our own React chrome, from a commit-pinned
build rather than npm.

Two corrections to an earlier draft of this note, both from reading the source rather than the READMEs:
Epicurrents **does** stream by HTTP range, which removes the main objection to it; and it **does** ship
qEEG trend *computation* (aEEG, FFT spectrogram, band ratio, pdBSI). What no surveyed tool provides is
the trend **rendering** — upstream assigns the draw method to the consuming package, and the only
renderers live in a Vue package that is not on npm. So the trend strip is still ours to build, but the
maths underneath it may not have to be.

Detail, including the CSP analysis and what remains unverified: `docs/VIEWER_SPIKE.md`.

## 6. Landscape — EEG teaching tools

| Work | Design | What it establishes | Gap |
|---|---|---|---|
| [DiagnosUs IED training](https://www.sciencedirect.com/science/article/pii/S2467981X23000240) (*Clin Neurophysiol Pract* 2023) | 13,262 real candidate IEDs, 8-expert consensus, gamified competition | **Effect size**: mean +13% accuracy over 1,000 items, ending at 81% | Real data, one binary task; no trends, no longitudinal ICU cases |
| [Online screen-based EEG simulator](https://link.springer.com/article/10.1007/s10072-020-04610-3) (*Neurol Sci* 2020) | 10 scripted scenarios, dynamic tracings, free-text answers | Self-paced asynchronous EEG interpretation works | Fixed library; cannot generate new cases |
| [Interactive and open educational resources for advanced EEG analysis](https://onlinelibrary.wiley.com/doi/10.1002/epd2.70209) (*Epileptic Disord* 2026) | Courses / Demos / **procedurally generated quizzes** | Closest philosophy to ours — generation as pedagogy | iEEG/HD-EEG source localization, not critical-care trends |
| [Impact of simulation on critical care fellows' EEG learning](https://pubmed.ncbi.nlm.nih.gov/35637804/) (Cureus 2022); [virtual EEG training for community neurologists](https://pubmed.ncbi.nlm.nih.gov/22250932/) (*Teach Learn Med* 2012) | Simulation and synchronous virtual teaching | Simulation improves EEG learning in exactly our audience | No generation, no export |
| [Online EEG learning platforms for residents and fellows](https://www.neurology.org/doi/10.1212/NE9.0000000000200356) (*Neurology Education*) | Systematic characterization of public platforms | Establishes what the field currently offers | — |

Context for why trends specifically matter: [Quantitative EEG in the neonatal intensive care unit](https://onlinelibrary.wiley.com/doi/full/10.1002/cns3.20042)
(Keene et al., *Ann Child Neurol Soc* 2023) reports **85% of institutions use Persyst**, with aEEG and
color spectrogram the dominant bedside displays — which is the case for teaching on the same trend set
clinicians actually see.

**Nobody is generating exportable, review-station-loadable, ground-truth-labelled teaching recordings
with paired qEEG trends.** That is the contribution on offer.

---

## 7. What raising realism would actually take

### 7.1 Two different problems, wrongly merged

The request that prompted this note was "train an LLM/LoRA/safetensor to make the most realistic EEGs."
That merges two separable problems with different right answers.

| | Scenario realism | Signal realism |
|---|---|---|
| The question | Would a real 6-month-old post-arrest look like this over 12 hours? | Would an epileptologist believe this 10-second page? |
| Current weakness | Implausible combinations, evolution that doesn't hang together | Texture too stationary; parametric morphology; simplified spatial covariance |
| Right tool | **An LLM, and a LoRA is a reasonable fit** | **A signal model** |

To be precise about the second cell, because the loose version of this claim is wrong: LoRA is a
parameter-adaptation method, routinely applied to generative diffusion networks; safetensors is a
weight-storage format. Neither determines output modality. The defensible statement is narrower — *a
text-oriented assistant should author structured scenarios rather than emit millions of numeric samples*
— and the reason is arithmetic: four hours × 21 channels × 256 Hz is ≈77 million samples. That argues
against a naive one-token-per-sample encoding, not against the model class; an autoregressive model over
*compressed waveform tokens* is exactly what NeuroRVQ-style work proposes.

What does survive: **there is no off-the-shelf conditional clinical-EEG generator.** LaBraM, CBraMod,
BIOT and EEGPT are representation models with no waveform decoder. NeuroGPT has a decoder but predicts
embeddings. NeuroRVQ is a tokenizer. Their encoder weights are reusable *inside* a generative system —
"not directly usable" is true; "cannot be adapted" is not.

### 7.2 Ordered by value per unit effort

**(a) Differentiable DSP — weeks, no GPU cluster, no data licensing.** The synthesizer is already
parametric. Fitting its parameters (1/f slope, band peaks, amplitude-modulation statistics, spatial
covariance) to real cohorts *by gradient* converts hand-tuning into learning while keeping determinism
and exact labels. This is the cheapest realism per unit effort available and nothing else should start
before it.

**(b) Structural upgrades — weeks.** Lead-field-based spatial covariance instead of hand-set weights;
template-library morphology for spikes, sharps and sleep transients sampled from open data; measured
artifact templates (chewing, ECG, electrode pop, patting, high-frequency oscillatory ventilation); and a
**neural-mass network** (Jansen–Rit / Wendling / Epileptor, ~20 nodes, faster than real time on CPU) to
make ictal evolution, discontinuity and postictal suppression *emerge* rather than be scheduled.

**(c) LoRA for scenario authoring — days, negligible cost.** A corpus already exists: 52 validated
scenario specs plus their critic reports and revision history. Step one is few-shot plus the existing
critic loop, measured. Only if that measurably fails is a LoRA (rank 16 on attention projections, a few
hundred prose→spec pairs, one consumer GPU, hours) worth training. The artifact is a ~50 MB adapter —
this is where "LoRA / safetensors" is the correct instinct.

**(d) A learned signal model — the real project.** Design constraint: **conditioning, not residuals.**
Subtracting a stochastic random-phase scaffold from real EEG yields a phase-misaligned difference with
higher variance than the signal itself; it is not a meaningful "texture residual". Instead, condition the
generator on the spec's envelopes, band-power targets, state, region and event masks. The conditioning
*is* the label, so ground truth survives — but the output still has to be verified to express the
intended events rather than smear or overwrite them.

Two consequences that are easy to miss:
- **Random access is lost.** An autoregressive or diffusion model generally cannot regenerate hour six
  from the seed alone. Either define absolute noise keys with checkpointed context, or generate once and
  store — which changes the storage and viewer architecture, not just the model.
- **Cross-window coherence needs context conditioning.** Independently sampled overlap-added windows seam
  in texture even when they join smoothly in amplitude.

### 7.3 Honest sizing

The estimates below are **assumption-dependent**, and the assumptions are stated so they can be argued
with. They are not measurements.

*Assumed target:* conditional generator over 4-second, 21-channel, 256 Hz windows (21,504 samples per
window), 10–50 M parameters, diffusion or flow matching, trained to a few hundred thousand steps at batch
32–64.

| Line item | Estimate | Basis / caveat |
|---|---|---|
| Compute for a first model on open data | **Hundreds of GPU-hours**, fits one workstation-class GPU | Extrapolated from comparable audio/time-series diffusion at this parameter count. Not measured. Re-estimate after a throughput test before committing |
| Engineering, first model | 4–8 person-weeks | Assumes the DSP baseline (a) already exists to benchmark against |
| **Data access, de-identification, IRB/DUA** | **Months** | This, not compute, is the gating item |
| Clinical-grade, validated version | 6–12 months + a partnership | Requires expert adjudication at scale |

**Available training data, with licences:**

| Source | Content | Licence / access |
|---|---|---|
| [CHB-MIT Scalp EEG](https://physionet.org/content/chbmit/1.0.0/) | Pediatric scalp EEG, Children's Hospital Boston, 23 subjects, bipolar 10-20 | **ODC-BY 1.0** — open. Loader already in-repo |
| [Helsinki neonatal EEG](https://zenodo.org/records/2547147) (Stevenson et al., *Sci Data* 2019;6:190039) | 79 neonates, 19-ch referential, seizure annotations | **CC BY 4.0** — open. Loader already in-repo |
| [TUH EEG Corpus](https://isip.piconepress.com/projects/nedc/html/tuh_eeg/) | The largest open clinical corpus | Registration + data agreement |
| [BDSP Harvard EEG](https://bdsp.io/) / [Neurotech EEG](https://bdsp.io/content/nf89816gtxbon11kbr9a/1.0/) | Harvard four-hospital corpus; Neurotech: 23,607 recordings, 4,914 patients, **212,186 hours**, 10.2 TB | Credentialed access — **this is the collaboration to ask CDAC/Westover for** |
| PedQuEST / POCCA | Pediatric critical-care cEEG with qEEG trends | Under IRB |

**Pediatric and neonatal critical-care coverage is thin in every open source.** That shortage, not GPU
budget, decides whether (d) is feasible.

### 7.4 How realism would be measured

Three experiments, run and reported **separately** — conflating them is the standard mistake.

1. **Export fidelity.** Do voltages, labels, timing and calibration survive the round trip into a review
   station and back?
2. **Algorithm comparison.** Our computed trends vs Persyst's, with montage, filtering, epoch length,
   units and definitions matched. Disagreement here does *not* localize a synthesis error, because the
   algorithms already differ — our suppression ratio uses a 60 s window with a 2 s minimum run, while the
   adult Persyst amplitude engine uses 10 s epochs. The identical pipeline must first be run over **real**
   recordings to establish a reference distribution.
3. **Clinical realism.** Blinded expert assessment plus held-out real-data comparison. This is the study.

On using Persyst's detectors as a realism check: they are a valuable *external* benchmark, but detector
acceptance is not physiological realism, and optimizing against one detector invites detector-specific
overfitting. Parametric rhythmic runs may well be *easier* for a detector than real seizures, which would
make agreement overstate realism. Report the operating point, freeze detector version and thresholds,
define event-matching and false-positive-per-hour rules, and do not compare synthetic sensitivity against
published cohort figures without harmonizing conditions.

A note on the in-repo real-data adapter: it maps bipolar dataset channels (e.g. `FP1-F7`) onto single
electrodes and then re-derives a montage, so a reconstructed `Fp1-F7` is actually `V_Fp1 − 2·V_F7 + V_T3`.
That is a deliberate choice for *rendering* comparison and it is documented as such, but it makes the
adapter unsuitable as a fidelity benchmark. Real-data controls must process native EDFs directly.

---

## 8. Collaboration asks

**Persyst.** The PSCLI loop works today under a research licence. What would make it a platform rather
than a local workflow: clarity on whether batch processing of synthetic recordings for education is in
scope for the licence; whether detector-performance comparisons may be published; and whether Persyst
Mobile Cloud or the Persyst 14 Data API could serve trends to a teaching site directly.

**CDAC / BDSP (Westover).** Two asks, in order of value. First, **credentialed access to pediatric and
neonatal critical-care EEG** for parameter fitting and evaluation — the Harvard EEG and Neurotech corpora
are the only realistic route to the age coverage this needs. Second, **participation in a blinded
real-vs-synthetic evaluation panel**, which is the experiment that would make any realism claim credible.
We are not asking for a viewer; their public tooling is analysis and labeling, and that is the right
division of labour.

**Pennsieve (Penn).** PedQuEST already exports into this ecosystem. Worth a separate conversation about
hosting real consortium recordings there while teaching artifacts stay on the PedQuEST site.

---

## 9. Open questions

Unresolved, and each one changes a design decision:

1. **What does the MMX `AutoSearch Duration` attribute actually mean** — candidate baseline length, search
   interval extent, or something else? The XML establishes intent, not algorithm.
2. **Is an inline `[ChannelMap]` accepted by Persyst 15?** The bundled sample uses an external named map,
   so this is untested.
3. **What does `MissingAsOpen=1` do to artifact reduction for a file carrying no impedance data?** We will
   not fabricate impedance values to find out.
4. **Which `/FileType` token selects EDF in PSCLI?** Documented default is `PersystLayout`; GUI extension
   recognition is not evidence of CLI behaviour.
5. **Redistribution rights for the stock MMX presets** — until established, they stay referenced on the
   processing host rather than shipped.
6. **Whether generative memorisation is a re-identification risk** once models are trained on credentialed
   corpora. "Everything is synthetic" stops being true at that point.

---

## 10. Recommendation

Build the export path and the Persyst loop, because both are proven and neither requires a model. Fit the
existing simulator's parameters to real data before training anything generative. Treat an LLM as the
author of scenarios, not of samples. And measure realism with a blinded expert panel rather than a
detector, because the detector can be satisfied by things an epileptologist would not believe.

The differentiator is not the waveform. It is that every teaching case comes with exact ground truth,
opens in the software clinicians already use, and carries the trends they are actually taught on.
