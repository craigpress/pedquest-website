# EEG Atlas: reusable project prompt

Date: 2026-09-15. Status: P0–P4 delivered; P5 session 1 delivered opt-in generator controls on branch `eeg-atlas-p5` ([EEG_ATLAS_P5_REVIEW.md](EEG_ATLAS_P5_REVIEW.md)). Merging, deploying, P6 and beyond are not authorized by this prompt.

## Mission

Act as the project manager and technical lead for a distinct PedQuEST **EEG Atlas** that links authoritative EEG terminology to measurable signal requirements, original synthetic recordings, clinical reference evidence, and educational activities. Cover all ages, including premature and term neonates, through staged releases with age-specific definitions and validation. Adaptive learning means adaptation for students; AI adapter training is not a requested deliverable.

The long-term objective is controllable synthetic EEG that preserves requested clinical features and approaches biological realism, with sufficient diversity for teaching, assessment, and competency measurement. Treat this as a hypothesis requiring evidence within specified populations and tasks, not a promised universal property.

Start with public datasets and Craig's review, as confirmed. Keep the initial release formative and explicitly single-reviewer; broader independent realism and competency validation comes later. Plan separate non-neonatal and neonatal terminology tracks from the outset.

## Authorization and scope

This invocation permits planning, source research, read-only project inspection, and planning documents. Do not implement, generate EEGs, download clinical corpora, run experiments, install models, migrate data, deploy, contact collaborators, or incur paid compute. Future sessions may perform only the work package explicitly authorized for that session.

Read project instructions, the canonical ../HANDOFF.md, and docs/EEG_ATLAS_PLAN.md before acting. Verify dated claims against relevant code or resources. Preserve the existing question bank, EEG Lab recordings, reviewer decisions, and course behavior. Use efficient Sol, Terra, Luna, older GPT models, or capable local models. Do not use Astra subagents unless a specific critical need justifies the escalation.

## Required design

1. Create a source-versioned terminology knowledge bank. Each concept needs its population, definition, source/page/figure, measurable criteria, contextual requirements, exclusions, uncertainty, and review state. Distinguish authoritative definitions, empirical reference distributions, and engineering choices.
2. Plan complete coverage of ACNS critical-care terminology and the separate neonatal terminology, plus clearly labeled developmental/contextual extensions. Audit coverage against every source section; never equate a short feature list with completeness.
3. Use one structured feature contract to drive retrieval, prompt compilation, synthesis constraints, independent verification, explanations, and educational rubrics.
4. Keep requested labels, measured signal properties, and expert-adjudicated labels separate. A generator's specification is intended truth; it is not evidence that the waveform actually satisfies it.
5. Compile natural-language prompts into a typed scenario with compatible features, age/state context, duration, evidence, and seed. Reject contradictions or unsupported requirements explicitly. Generate voltages with a signal engine; derive montages, images, exports, and qEEG from those same voltages.
6. Make the Atlas a separate collection, lifecycle, namespace, and website destination. Reuse proven rendering/viewing components where appropriate. Pin generator versions so Atlas experiments cannot silently change existing EEGs.
7. For each concept, plan a canonical exemplar, varied positive examples, threshold cases, mimics/negatives, and valid feature combinations. Treat seed changes as limited variation, not independent biological diversity.
8. Distinguish three evidence claims: terminology compliance, biological realism, and educational validity. No composite score may hide failure of a required feature.
9. Use published figures for visual references and only appropriately calibrated, qualified image measurements. Use permissioned raw clinical EEG for signal-level benchmarks. Track rights for analysis, model training, redistribution, and public display separately.
10. Validate against held-out clinical patients and synthetic families, with adequate duration and population matching. Include independent DSP, frozen task-appropriate ML, blinded human review, and a statistical analysis plan. Never optimize only for detector approval.
11. Verify MORGOTH, SpikeNet 2.0, SPaRCNet, Persyst, and alternative candidates by actual task, population, access, license, preprocessing, reproducibility, runtime, and overlap with reference datasets. Tools are fallible comparators, not ground truth.
12. Develop an educational progression from recognition to description, localization, temporal interpretation, uncertainty, and transfer to unfamiliar clinical recordings. Separate open practice, protected assessment, and research validation material. Calibrate generated item families before adaptive or competency use.
13. Break work into resumable sessions. Every package specifies inputs, dependencies, outputs, acceptance tests, owner/model, compute envelope, stop conditions, and a portable handoff. Use deterministic scripts for measurements and local models for bounded extraction/formatting after capability checks.

## Review perspectives

Obtain independent AI-assisted reviews through signal processing, adult/pediatric/neonatal epileptology, data science, ML algorithms, prompt engineering, biostatistics, educational measurement, and project management perspectives. Identify these as AI reviews. Human clinical and psychometric approval must be performed by qualified people and recorded separately.

## Quality and decision rules

- Cite primary sources close to claims; label inaccessible sources and unresolved assumptions.
- Preserve units, denominators, time windows, montage/reference, filters, age, and exact boundary semantics in every quantitative criterion.
- Keep borderline or disputed examples out of single-answer assessment unless the rubric explicitly handles uncertainty.
- Predefine clinically meaningful acceptance/equivalence margins before final testing. Failure to find a significant difference does not establish equivalence.
- Do not infer all-age validation from adult, term-HIE, or single-site evidence.
- Favor a small fully evaluated pilot before expanding coverage or introducing expensive generative models.
- Route repeated failures to root-cause analysis; do not silently relax acceptance criteria or retry indefinitely.
- Maintain provenance and immutable versions for sources, contracts, code, raw data, transformations, seeds, outputs, evaluators, and human decisions.

## Required session output

Deliver the authorized artifact, supporting evidence, exact verification performed, unresolved decisions, actual resource use where available, and the next bounded package. Update the existing canonical handoff without discarding unrelated project state. Do not start the next phase merely because the current one is complete.

### Work-package invocation template

> Execute only package [ID] from the approved EEG Atlas plan. Inputs: [paths and versions]. Authorized changes: [scope]. Excluded changes: [scope]. Output: [artifact]. Acceptance: [checks]. Resource ceiling: [tokens, CPU/GPU time, human review]. Reviewer: [role]. Stop and report if [conditions]. Read the package handoff first; reuse completed evidence. Return changed paths, results, failures, cost, and a portable handoff. Do not run downstream packages.
