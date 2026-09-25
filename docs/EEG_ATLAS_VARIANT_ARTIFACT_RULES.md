# EEG Atlas normal-variant, activation and artifact controls

Status: authored simulation contract for PQW-110 candidate review. Sources support
morphology, field and context directions. Unless stated otherwise, frequency, amplitude,
rate and duration defaults are authored teaching choices and are not clinical thresholds.

## Explicit variants and activation responses

| Control | Source-supported direction | Authored control and teaching eligibility | Emitted key |
|---|---|---|---|
| Mu | Central arciform 7–13 Hz; voluntary movement or sensorimotor stimulation may block it (S33) | 10 Hz, central, explicit movement-test context; optional blocking interval; no eye-opening/PDR coupling | `normal_variant`, split around block |
| Lambda | Positive occipital transients during awake visual scanning (S06) | Child/adolescent teaching policy; gated to awake visual-scanning context | `normal_variant` |
| Wickets | Arciform temporal, non-evolving (S31) | Explicit drowsy temporal run; no epileptiform or seizure label | `normal_variant` |
| 14-and-6 | Positive posterior-temporal short bursts in drowsiness/light sleep (S31) | Authored selection of a 14 Hz or 6 Hz positive burst; light-sleep gate | `normal_variant` |
| RMTD | Non-evolving temporal theta associated with drowsiness (S31) | 5.5 Hz temporal run; drowsy gate | `normal_variant` |
| SREDA | Bilateral temporoparietal theta, predominantly adult context (S31) | Adult teaching eligibility; no claim that younger occurrence is biologically impossible | `normal_variant` |
| Frontal arousal rhythm | Published named FAR series had frequent seizure histories; a case report argues ictal classification (S36–S37). S06 also describes childhood anterior arousal rhythm | Infant/child authored arousal window. It is not declared benign | `arousal_pattern_pending_review`; classification pending Craig |
| Photic driving | Posterior response entrained to stimulus or harmonic; normal absence is possible (S34) | Explicit awake stimulus window; response is opt-in | `activation_response` |
| Hyperventilation buildup | Pediatric high-voltage theta/delta buildup, with developmental cooperation limits (S06) | Explicit awake activation/recovery window; age does not trigger it automatically | `activation_response` |

The context gate must match the control and the synthesized state across the full emitted
interval. A control whose age/state teaching eligibility is not met emits neither waveform
nor key row.

## Ocular and noncerebral artifacts

| Control | Distinction | Implementation |
|---|---|---|
| Lateral eye movement | Corneo-fundal dipole gives opposed left/right frontal fields (S32) | Explicit abrupt lateral-eye artifact |
| Slow roving eyes | Slow lateral oscillation in drowsiness/N1 context (S34) | Explicit slow event; not a renamed blink |
| REM eye movements | Lateral eye bursts with desynchronized background context (S34) | Requires an explicit modeled REM interval; key says eye movements alone do not establish full PSG REM stage |
| ECG | Electrical cardiac field (S35) | Existing QRS-like waveform retained |
| Pulse | Mechanical pulse-linked movement (S35) | Separate waveform and key from ECG |
| Chewing EMG | High-frequency muscle | Existing `emg_chewing` retained |
| Glossokinetic | Tongue dipole slow movement (S35) | Separate slow opposed frontotemporal field |
| Sweat, electrode pop, movement, ventilator, 60 Hz | Existing artifact families (S35) | Existing waveforms retained; frequency/rate/decay knobs exposed where used |

Complete neuromuscular blockade remains the PQW-109 modeled-EMG approximation. It
suppresses modeled muscle from existing chewing/movement controls while preserving their
non-muscle components. Specs combining blockade with newly authored tongue or eye motion
are rejected rather than implying that voluntary motion persists during complete blockade.
Existing eleven artifact branches, three scheduled pediatric variants and all absent-control
samples remain unchanged.
