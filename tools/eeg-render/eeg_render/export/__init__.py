"""Waveform export - turn a spec into a recording a review station can open.

The question-bank path renders a *picture* of a recording.  This package writes
the recording itself, so a teaching case becomes something a learner scrolls
through in Persyst, EDFbrowser, or the in-browser viewer.

Three rules hold this together:

* **One synthesizer, at the full export duration.**  The slow amplitude-modulation
  grids are normalised over the whole record, so duration is part of a recording's
  identity, not a display option.  :class:`Recording` carries it.
* **Stream with a margin.**  ``segment`` is partition-independent except for the
  zero-phase filter in the frequency-selective attenuation branch, which settles
  against whatever block it is handed.  :func:`iter_blocks` requests a margin and
  trims it, exactly as ``compute_trends`` does.
* **Learner and instructor artifacts are different files.**  Ground truth does not
  ship in the learner's download: withholding a written answer does not blind a
  case if the annotations, the event labels and the filename give it away.
"""

from .channels import baseline_advisory, ekg_row
from .manifest import Recording, build_manifest, iter_blocks
from .persyst import write_lay_dat
from .edfplus import write_edf_plus

__all__ = [
    "Recording",
    "baseline_advisory",
    "build_manifest",
    "ekg_row",
    "iter_blocks",
    "write_lay_dat",
    "write_edf_plus",
]
