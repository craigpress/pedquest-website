# EEG state and muscle review access

`/admin/eeg-lab/muscle-review` opens nine synthetic EDF recordings in the standard LabViewer: three examples from renderer 0.5.5 and six earlier experimental comparisons. G demonstrates clinical-state transitions over ten minutes; H demonstrates continuous regional awake muscle; I demonstrates non-myoclonic burst suppression with zero automatic tonic muscle. G is an eligibility demonstration, not a representative anesthetic or coma morphology.

The page and signing API require PedQuEST editor access. `/api/admin/lab/muscle-review?recording=<id>` accepts only the manifest IDs, signs one hash-addressed object in the private `eeg-gallery` bucket for 900 seconds, and returns a private/no-store response. Files live under `experiments/muscle-20261001/`; the manifest contains their SHA256 hashes. The review page does not modify saved Lab jobs, shared gallery reviews or bank cases.

A/B/C compare current awake muscle, a graded envelope with the same carrier, and independently varying regional sources. A/B/C match T3 muscle RMS only. D/E share the same calibrated cerebral signal, with E removing D's tonic muscle. F is the existing absent-reactivity control with separate calibration. All headers identify the experimental renderer version; candidate parameters are engineering settings, not validated clinical ranges.

The browser downloads only the selected EDF. File identity is stable across opens so local annotations and cached trends persist. These annotations stay in that browser and are not shared gallery review notes. Montage, sensitivity and filter controls are reused without modifying LabViewer.

Route tests cover anonymous/member denial, allowlist validation, signing limits and storage failures. Publication receipts record stored and downloaded hashes. The actual page is checked in an isolated local UI fixture; authenticated production UI validation requires Craig's editor session.

Earlier research and comparisons remain in `research/eeg-atlas/muscle-review-20261001/`. Renderer 0.5.5 state rules, visual review and rollout receipts are in `research/eeg-atlas/state-review-20261001/` (PQW-116). Clinical acceptance and quantitative reference validation remain part of PQW-112. Existing Lab recordings are not automatically re-exported.
