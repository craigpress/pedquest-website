# Scientific image rendering

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
