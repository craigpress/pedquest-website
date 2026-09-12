"""PSCLI bridge for the PedQuEST EEG Teaching Lab.

Two modules, both derived from measured behaviour in
``docs/PSCLI_PHASE0A_RESULTS.md``:

* :mod:`persyst_bridge.pscli` -- invoking PSCLI.exe unattended.
* :mod:`persyst_bridge.readback` -- reading back what it produced, because a
  zero exit code does not mean the trends are meaningful.
"""

__all__ = ["pscli", "readback"]
