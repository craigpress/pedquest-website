"""eeg_render - deterministic renderer for PedQuEST qEEG question-bank images.

Turns a question YAML's ``image.spec`` (the DSL in content/qbank/IMAGE_SPEC.md)
into a clinical-looking PNG plus a JSON sidecar.  Trends are *computed* from a
synthesized multichannel EEG with the same algorithms a review station uses -
they are not drawn.
"""

# 0.3.8 changes the waveform for GENERALIZED events only: the field now reaches
# the electrode rim and is frontally maximal, and a spike-and-wave morphology is
# available whose spike keeps its millisecond width as the rate evolves.  Focal
# regions are byte-identical to 0.3.7 (asserted in tests).
#
# ``spec_hash`` mixes this string in, so the bump marks all 52 rendered images
# stale.  It does NOT regenerate anything - only ``render-all`` does that, and
# it is deliberately not being run while the morphology work is in flight.
RENDERER_VERSION = "0.3.9"

__all__ = ["RENDERER_VERSION"]
