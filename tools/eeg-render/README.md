# Scientific image rendering and waveform export

## Waveform export (0.3.7)

The same spec that renders an image can write a **reviewable recording** — Persyst `.lay/.dat` and
conforming EDF+ — so a teaching case becomes something a learner scrolls through in a review station
rather than a figure they look at.

```powershell
python -m eeg_render export content/qbank/questions/PQ-A-012.yaml --out exports --format lay,edf
python -m eeg_render export content/qbank/questions/PQ-A-012.yaml --out exports --answers   # instructor
```

- **Learner copies carry no ground truth by default.** Withholding a written answer does not blind a case
  if the annotations, event labels and filename give it away. `--answers` produces the instructor copy;
  the answer-key JSON is written separately either way.
- The answer key records **realized** events — cluster onsets are jittered, rhythmic-pattern runs are
  expanded, and a ramped attenuation's image sidecar deliberately boxes the ramp rather than the event —
  so neither the spec nor the sidecar describes where the signal actually changed. Each entry is marked
  `label_type: "commanded"`: it is what the generator was told to produce, not an adjudicated finding.
- **Duration is part of a recording's identity.** The slow amplitude-modulation grids normalise over the
  whole record, so changing `--duration` changes samples everywhere, including at t=0. `Recording.recording_id`
  hashes the spec, duration, channel order, sample rate and reference convention together.
- Persyst header specifics (inline `[ChannelMap]`, `TestDate=YYYY/MM/DD`, what to omit) are documented in
  `eeg_render/export/persyst.py` and were verified against Persyst 15 — see `docs/PSCLI_PHASE0A_RESULTS.md`.
- Validate EDF+ against an **independent** implementation (EDFbrowser, pyedflib). `datasets.edf.read_signals`
  rejects mixed sample rates, so a correct EDF+ export fails our own reader by design.

### Partition independence

`segment()` guarantees that *the same absolute sample interval yields the same samples however it was
requested* — the property a chunked export depends on. Four classes of violation were fixed in 0.3.7
(RNG keyed to the request, event times drawn across the request, normalisers taken from the request's own
statistics, window functions convolved against edge-padded requests); `tests/test_partition_independence.py`
holds the line. One case remains and cannot be fixed inside the accessor: the zero-phase filter in the
frequency-selective attenuation branch settles against its input block, so **callers that chunk must
request a margin and trim it** — `compute_trends` and `export.iter_blocks` both do.

---

# Image rendering

The renderer computes every trend from the same synthetic multichannel voltage recording used for its raw excerpts. Version 0.3.0 corrects the question-bank image issues documented in the September 2026 scientific review.

- Suppression measurements use a 5 µV default peak-to-peak threshold, 0.5-second epochs and a trailing one-minute average. The independent sensor floor is 0.25 µV RMS; it does not rise with background amplitude. A requested sedation suppression fraction replaces the prior target, including during a reduction.
- Background amplitude gain and interburst residual amplitude can vary through `background.amplitude_gain_at_h` and `background.ibi_floor_at_h`. These are piecewise linear controls applied to raw voltage before filtering. The A001 controls were calibrated against actual filtered margins; no plotted margin is overwritten.
- Requested aEEG electrode pairs must exist. Parietal derivations use an array containing P3/P4; unavailable explicit pairs raise an error. Diagnostic pattern and cycling labels are omitted from learner images.
- aEEG comparisons and reference strips use the same recording and realized events. `raw_strip_window_s`, `start_h`, and `time_axis: hours_of_life` control displayed duration and age labels. Elapsed event coordinates remain unchanged.
- Extended semilog aEEG scales honor their configured upper voltage limit; ticks and traces share the same transform. Raw excerpts mark an actual stimulus when it falls within the displayed interval.
- Highly epileptiform burst specifications generate transient discharges inside actual burst windows. Spindle specifications modulate real sigma activity into brief bursts within repeated three-minute trains; raw excerpts and trends share this activity.
- Envelope trends use a separate 2–20 Hz filter and show a median line. The detector illustration uses a fixed initial five-minute reference plus a sustained slow-rhythmic-activity criterion. It can flag rhythmic artifact and is **not a validated clinical detector or an implementation of a commercial detector**.
- Render jobs upload versioned asset names and attach their output only when the case version still matches. A superseded job cannot overwrite the current image.

Run the regression checks from the site root:

```powershell
$env:OPENBLAS_NUM_THREADS = '1'
python -m pytest tools/eeg-render/tests -q
```

Regression checks establish the stated numerical and software invariants. Clinical interpretation and publication approval remain separate from rendering.

`requirements-runtime.txt` pins the numerical/plotting libraries used for the verified September 2026 image set. Install these before deploying the worker. The importer runs `verify_sidecars.py` before accessing Supabase; it rejects images whose question identity, kind, normalized specification, renderer version, or PNG dimensions differ from the sidecar.
