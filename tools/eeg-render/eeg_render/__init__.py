"""eeg_render - deterministic renderer for PedQuEST qEEG question-bank images.

Turns a question YAML's ``image.spec`` (the DSL in content/qbank/IMAGE_SPEC.md)
into a clinical-looking PNG plus a JSON sidecar.  Trends are *computed* from a
synthesized multichannel EEG with the same algorithms a review station uses -
they are not drawn.
"""

# 0.3.10 gives hypsarrhythmia six asynchronous focal generators that reuse the
# lower-voltage LPD sharp-slow morphology. Existing qbank PNGs are byte-identical
# to 0.3.9; their sidecars were restamped after representative render checks.
# 0.5.0 (2026-09-26): spec_version 3 - causal page filter, reference-matched artifacts / variants / seizures /
# sleep staging / ACNS 2021 patterns / generalized and focal seizure types, key-vs-visible contracts, viewer montages.
# spec_version 1 and 2 renders are byte-identical to 0.4.4/0.4.5.  The version string moves to 0.5.0 at rollout,
# together with render-all / sidecar restamp (test_verify_sidecars pins committed sidecars to this string).
# 0.5.1 (2026-09-29, research/eeg-atlas/generalized-review-20260928): generalized family round 8 - whole-head cycle
# jitter, rebuilt GTC / photoparoxysmal / LGS slow spike-wave / GPFA, GTC EMG field and movement artifact, GPD
# per-cycle jitter, generalized sporadic polyspike scatter (spec_version 3 only).
RENDERER_VERSION = "0.5.1"

__all__ = ["RENDERER_VERSION"]
