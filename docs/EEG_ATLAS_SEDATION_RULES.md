# EEG Atlas sedation and neuromuscular-blockade controls

Status: authored simulation rules for PQW-109 review. These rules are not dosing guidance,
validated pharmacodynamic models, or clinical acceptance of generated candidates.

`sedation.level` is a unitless value from 0 to 1. It does not convert a dose, infusion rate,
serum concentration, or clinical sedation score. `sedation_change.level` is the target of a
linear authored ramp. For new level events, an explicit `effect.suppression_ratio_target_pct` is
the only route to a requested suppression target; level alone never implies a universal
burst-suppression ratio. Legacy `sedation_change` events without `level` retain their prior
defaults (25% on increase, 0% on decrease) and byte-identical signal behavior.

| Agent/control | Population support reviewed | Authored signal rule | Boundary |
|---|---|---|---|
| Propofol | Healthy adults 18–36 (S23) | increasing slow activity and frontal alpha | Illustrative outside adults; no dose conversion |
| Dexmedetomidine | Healthy adults 18–36 (S23) | increasing slow and spindle-range activity | Illustrative outside adults, including children and neonates |
| Midazolam | Adult male volunteers (S24) | increasing beta in non-neonatal specs | Pediatric extrapolation; neonatal rule is separate |
| Midazolam, neonatal | Eleven term neonates with stroke (S25) | reduced total amplitude; no adult beta rule | Injury and small cohort limit generalization |
| Ketamine | Adult induction cohort (S26); refractory-status cohort (S27) | slow-delta plus gamma profile | Context dependent; no monotonic GABAergic suppression rule |
| Pentobarbital | Pediatric refractory status, n=30 (S28) | modest slow/beta profile; burst suppression only when an author supplies a target | No dose-to-level or universal suppression mapping |
| Remifentanil | Healthy adult volunteers (S29) | increased delta and reduced theta/alpha | Named remifentanil profile, not an opioid-class rule |
| Complete neuromuscular blockade | Two-subject comparison (S30) | remove generated tonic, ictal and chewing EMG | Cerebral fast activity, ECG, ventilator and other nonmuscle artifacts remain |

Absent `sedation` and `neuromuscular_blockade` controls preserve the prior samples. Complete
blockade is deliberately categorical because the reviewed evidence does not establish a partial
blockade simulation scale. Candidate morphology remains pending Craig's visual read.
