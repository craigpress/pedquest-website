# Item-Writing Style Guide — PedQuEST qEEG Question Bank

Audience: pediatric neurology / epilepsy / neurocritical care fellows, PICU and
NICU attendings, EEG technologists, and bedside nurses learning quantitative
EEG (qEEG) trend interpretation. Items are used for self-assessment and for a
daily "Case of the Day", not for high-stakes certification, but they are
written to NBME one-best-answer standards so they can be reused for CME later.

## 1. Format (NBME-style single best answer)

- **Stem = vignette + image caption + lead-in.** The vignette gives age, sex,
  setting, relevant history, current meds/sedation, temperature if relevant,
  and why EEG is running. The image caption tells the learner exactly what the
  image shows (trend types, time span, montage, display scale). The lead-in is
  a single direct question answerable *from the stem and image alone*.
- **Cover test:** a competent reader should be able to answer without seeing
  the options. If the item only works as "which of the following is true",
  rewrite it.
- **Options:** 4 or 5, homogeneous in type and length, alphabetized or
  logically ordered (e.g., numeric ascending). Exactly one is correct. No
  "all of the above", "none of the above", double negatives, absolutes
  ("always/never") in distractors, or grammatical cues.
- **Distractors** must be plausible errors a real learner makes (e.g., calling
  chewing artifact a seizure; reading a suppression-ratio rise as seizure).
- **Length:** vignette 60–140 words; lead-in ≤ 25 words; each option ≤ 18
  words; explanation 120–260 words; each option rationale 1–3 sentences.

## 2. Content standards

- **Terminology:** use the ACNS Standardized Critical Care EEG Terminology
  (2021 version) for adults/children and the ACNS neonatal terminology for
  neonates. Say "electrographic seizure", "electroclinical seizure",
  "ictal–interictal continuum", "burst suppression", "background continuity",
  "attenuation", "suppression (<10 µV)". Avoid "subclinical" unless quoting a
  study that used it.
- **Trends:** name them generically (FFT spectrogram / color density spectral
  array, rhythmicity spectrogram, asymmetry index / relative asymmetry
  spectrogram, amplitude-integrated EEG (aEEG), suppression ratio, seizure
  probability). Vendor names (Persyst, Natus, Nihon Kohden) may appear only
  when the teaching point is vendor-specific and then must be cited.
- **Numbers must be exact and sourced.** Any sensitivity, specificity,
  percentage, cutoff, odds ratio, or time window in the stem or explanation
  must appear in a cited paper and be quoted with its population (e.g.,
  "pediatric ICU, n = 84 recordings"). Never round a study's number to a
  cleaner one. If you cannot find the number, do not state it.
- **Pediatric first.** Prefer pediatric/neonatal evidence. When only adult
  evidence exists, say so in the explanation ("adult data; pediatric
  validation is limited").
- **Member scholarship preferred, not exclusive.** Where a PedQuEST member
  publication is the best evidence, cite it. Do not cite a weaker member paper
  over a stronger non-member paper.
- **Difficulty calibration:**
  - *introductory* — recognize a single well-formed pattern or define a trend.
  - *intermediate* — integrate trend + raw EEG + clinical context; discriminate
    from one common mimic.
  - *advanced* — weigh evidence, choose management, or reason about pitfalls,
    prognosis, or study limitations.
- **Bloom tags:** `recall`, `interpretation`, `application`, `analysis`.

## 3. Evidence and citation rules

- `references[]` needs ≥ 1 `primary` reference; most items should have 2–3.
- **Every PMID must be verified by lookup** (PubMed E-utilities / PubMed MCP /
  EndNote library). Set `verified: true` only after you have confirmed title,
  first author, journal and year match. Unverified references block import.
- Record `open_access` honestly (`cc-by`, `cc-by-nc`, `pmc-oa`, `none`,
  `unknown`). This governs whether the site may later link a figure; it does
  **not** permit copying a figure into our image.
- Guideline/consensus documents (ACNS, ILAE, AAN, AHA) are `primary` when the
  item tests the recommendation itself.
- Textbooks may be `supporting` only, with ISBN in `citation`.

## 4. Copyright and privacy

- Never reproduce, trace, redraw, or "describe so it can be redrawn" a
  published figure. Our images are rendered from **our own `image.spec`** or
  from openly licensed raw datasets listed in IMAGE_SPEC.md.
- Quotations from papers ≤ 15 words, in quotation marks, attributed.
- Vignettes are composites. No real initials, dates, MRNs, or identifiable
  combinations. Ages are stated in rounded units (e.g., "a 4-year-old",
  "a term neonate, day of life 2").

## 5. Explanation structure

1. **Answer + one-sentence why.**
2. **What the image shows**, naming the trend features that support it.
3. **Why each distractor is wrong** (in `options[].rationale`, not repeated here).
4. **Evidence paragraph** with the cited numbers and population.
5. **Bedside takeaway** (1–2 sentences).

`key_points` = 3 bullets, ≤ 20 words each, that could stand alone as flashcards.

## 6. Image spec discipline

- The `image.spec` **is** the ground truth. Write it so the rendered image
  supports exactly one best answer. State onset times, sides, frequencies and
  durations explicitly; the renderer is deterministic from the spec.
- For `point_to_feature`, the correct region is derived from the spec event
  (e.g., seizure onset on the left rhythmicity panel); do not hand-draw it.
- Include one deliberate, labeled *distractor feature* where it teaches (e.g.,
  an EMG artifact 30 min before the seizure) and mention it in the caption
  only if the learner would have that information at the bedside.

## 7. Writer checklist (paste into `metadata.checklist` as booleans)

- [ ] cover test passes
- [ ] one best answer, options homogeneous, no cues
- [ ] every number sourced; every PMID verified
- [ ] ACNS terminology used
- [ ] image spec explicit enough to render deterministically
- [ ] no copyrighted text or figure reproduced
- [ ] de-identified composite vignette
- [ ] explanation follows §5 structure
