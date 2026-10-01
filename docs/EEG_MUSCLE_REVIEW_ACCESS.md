# Experimental muscle comparison access

`/admin/eeg-lab/muscle-review` opens six existing three-minute synthetic EDF trials in the standard LabViewer. This is a review surface for Craig's pending EMG findings, not a renderer change or an accepted gallery revision.

The page and signing API require PedQuEST editor access. `/api/admin/lab/muscle-review?recording=<id>` accepts only the six manifest IDs, signs one hash-addressed object in the private `eeg-gallery` bucket for 900 seconds, and returns a private/no-store response. Files live under `experiments/muscle-20261001/`; the manifest contains their SHA256 hashes. No patient recordings, saved Lab jobs, gallery review rows or bank cases are modified.

A/B/C compare current awake muscle, a graded envelope with the same carrier, and independently varying regional sources. A/B/C match T3 muscle RMS only. D/E share the same calibrated cerebral signal, with E removing D's tonic muscle. F is the existing absent-reactivity control with separate calibration. All headers identify the experimental renderer version; candidate parameters are engineering settings, not validated clinical ranges.

The browser downloads only the selected EDF. File identity is stable across opens so local annotations and cached trends persist. These annotations stay in that browser and are not shared gallery review notes. Montage, sensitivity and filter controls are reused without modifying LabViewer.

Publication checks verified all six private stored hashes and signed downloads. Route tests cover anonymous/member denial, allowlist validation, signing limits and storage failures. The actual new page opened all six trials in an isolated local UI fixture; authenticated production UI validation requires Craig's editor session.

Research, generation provenance, pending issue list and publication receipts remain in the owning project's `research/eeg-atlas/muscle-review-20261001/` (PQW-116). Reverting the access-page commit removes this review surface; existing educational content and renderer 0.5.4 remain intact.
