"""eeg_render - deterministic renderer for PedQuEST qEEG question-bank images.

Turns a question YAML's ``image.spec`` (the DSL in content/qbank/IMAGE_SPEC.md)
into a clinical-looking PNG plus a JSON sidecar.  Trends are *computed* from a
synthesized multichannel EEG with the same algorithms a review station uses -
they are not drawn.
"""

# 0.3.10 gives hypsarrhythmia six asynchronous focal generators that reuse the
# lower-voltage LPD sharp-slow morphology. Existing qbank PNGs are byte-identical
# to 0.3.9; their sidecars were restamped after representative render checks.
RENDERER_VERSION = "0.4.0"

__all__ = ["RENDERER_VERSION"]
