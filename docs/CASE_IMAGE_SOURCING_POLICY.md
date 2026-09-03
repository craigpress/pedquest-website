---
tags:
  - domain/eeg-monitoring
  - type/reference
  - project/pedquest
  - domain/seizures-and-epilepsy
  - domain/research-methods
---
# Case of the Day — Image Sourcing & Licensing Policy

**Status:** draft for review · **Written:** 2026-07-13 · **Applies to:** every image
attached to an `eeg_cases` row (the qEEG Case of the Day feature).

> **Not legal advice.** This is an operating policy to keep the consortium on
> safe ground by default. Because the site carries institutional affiliations
> (CHOP and member centers), get a one-time sign-off on this policy from
> institutional counsel before the AI-assisted path goes live, and re-check if
> the feature's use changes (e.g. anything commercial).

---

## 1. The rule in one sentence

Every published case image must be **one of**: (a) the consortium's own
de-identified recording, (b) an image under a license that actually permits our
use, or (c) an **original synthetic image of the finding** — never an AI
restyling of a specific copyrighted figure. Attribution is required where the
license demands it, but **attribution is not permission**.

---

## 2. Source tiers (prefer top to bottom)

### Tier 1 — Consortium-owned, de-identified  *(best)*
De-identified EEG/qEEG images from member sites. Cleanest rights, most realistic
teaching material, no external license to track. Requires site IRB/data-use
coverage for education and PHI scrubbing (no names, MRNs, dates, device serials,
or burned-in identifiers). This is the default first choice.

### Tier 2 — Openly licensed third-party images
Reusable **only if** the license permits it. "Free to read" is **not** a
license — most PubMed Central articles are viewable but fully copyrighted.

| License | Verbatim use | Adapt / annotate / crop | Notes |
|---|---|---|---|
| Public domain / CC0 | ✅ | ✅ | No attribution required (give it anyway) |
| CC BY | ✅ | ✅ | Attribution required |
| CC BY-SA | ✅ | ✅ | Derivative must carry CC BY-SA too |
| CC BY-ND | ✅ | ❌ | **No** cropping/annotating/adapting |
| CC BY-NC / -NC-SA / -NC-ND | ✅* | per -SA/-ND | Non-commercial only — OK for this site while non-commercial |
| "Free full text" / publisher OA with no CC tag | ❌ | ❌ | Viewable ≠ licensed. Treat as All rights reserved |
| All rights reserved | ❌ | ❌ | → use Tier 3 instead |

\* NC is acceptable **only** as long as the site stays non-commercial. If the
site ever runs ads, sells access, or is used in paid CME, NC images must be
pulled — flag this at that transition.

**Where the license actually lives:** for PMC, read the machine-readable license
field on the open-access subset — do **not** infer a license from "it's on PMC."
For anything else, require an explicit license statement on the source page.

### Tier 3 — Original synthetic images  *(when Tier 1/2 unavailable)*
When the finding you want to teach only exists in a copyrighted figure, the AI
generates an **original image of the same phenomenon** — a fresh
burst-suppression spectrogram, a synthetic seizure trend, a new amplitude-
integrated EEG panel. This is legitimate because **facts, patterns, and EEG
phenomena are not copyrightable — only the specific figure's expression is.**

The paper is then cited as *reading*, not as the image source:
"Pattern illustrated is discussed in Fig 2 of Smith et al. 2024 [link]."

**Hard line:** do **not** feed a specific copyrighted figure to an image model
and ask it to "adapt / redraw / restyle" that figure. A close adaptation of a
particular figure is a **derivative work** — one of the rights copyright
reserves — and linking to the original does not cure it. Generate from the
*concept and clinical description*, not from the source image.

---

## 3. Decision flow (for the scanner / AI prompt)

```
Need an image for this finding?
│
├─ Consortium de-identified image available?  ── yes ─▶ Tier 1. Verify PHI scrubbed.
│                                                        license = "consortium"
├─ Third-party image with a real reuse license?
│     │
│     ├─ CC0/PD/CC BY/CC BY-SA/CC BY-NC ──▶ Tier 2. Record license + attribution + source URL.
│     │        (SA → keep same license; NC → non-commercial only)
│     ├─ CC BY-ND ──▶ Tier 2 verbatim ONLY (no crop/annotate).
│     └─ No CC/OA license (viewable only) ──▶ NOT usable. Go to Tier 3.
│
└─ Otherwise ──▶ Tier 3. Generate an ORIGINAL synthetic image of the finding.
                 Cite the paper as reading (referenceUrl), NOT as image source.
                 Never adapt the specific copyrighted figure.
```

If none of the tiers can be satisfied, the AI leaves `imageUrl` empty and sets
`suggestedImage` describing what a human reviewer should attach — the case
stays `draft`/`pending_review` and is never auto-published without an image
whose provenance is recorded.

---

## 4. Data model — provenance is mandatory

The current `eeg_cases` schema (`src/lib/cases.ts`) tracks `imageUrl`,
`source` (`team` | `ai`), and `aiSourceUrl`, but has **no license or
attribution field**. Add these so provenance is auditable and attribution can
render on the case:

| Field | Type | Meaning |
|---|---|---|
| `imageLicense` | enum: `consortium` \| `cc0` \| `cc-by` \| `cc-by-sa` \| `cc-by-nc` \| `cc-by-nd` \| `public-domain` \| `ai-original` | how we're allowed to use it |
| `imageAttribution` | text \| null | rendered credit line (author, source, license) |
| `imageSourceUrl` | text \| null | canonical source of a Tier-2 image |
| `imageReferenceUrl` | text \| null | Tier-3 "further reading" paper (already `referenceUrl` in the draft type; `aiSourceUrl` on the row) |
| `aiModel` | text \| null | already present — record which model generated a Tier-3 image |

**Publish gate:** a case cannot move to `published` unless
`imageLicense` is set **and** (`imageLicense = 'consortium'` **or**
`imageLicense = 'ai-original'` **or** `imageAttribution` is non-empty). Enforce
this in the admin publish action and, ideally, as a DB/RLS check so it holds even
if the API is bypassed — same pattern as the existing admin allowlist + RLS.

---

## 5. Attribution rendering

For any Tier-2 image, show a caption/credit near the image, e.g.:

> Image: *[title]* by [author], via [source], licensed under [CC BY 4.0] ([link]).

For Tier-3: no image credit (it's original), but keep the "further reading"
citation to the paper that describes the finding.

---

## 6. AI prompt guardrails (drop-in for the generator / OpenWebUI path)

Add to the case-generation and image-generation system prompts:

- Never output a `imageUrl` pointing at a third-party image unless a machine-
  readable reuse license (CC0/PD/CC BY/BY-SA/BY-NC/BY-ND) is confirmed on the
  source; "free full text" or "open access" **without** a CC tag does not count.
- When generating an image, generate an **original** illustration of the
  described finding. Do **not** ingest, trace, redraw, or restyle a specific
  published figure. Base the image on the clinical description only.
- Never invent patient identifiers; vignettes stay de-identified (already
  enforced in `case-generator.ts`).
- Always populate `imageLicense`; for Tier 2 also populate `imageAttribution`
  and `imageSourceUrl`; for Tier 3 populate `aiModel` and the reading citation.
- If licensing is uncertain, leave the image empty and describe it in
  `suggestedImage` for human review — do not guess.

---

## 7. Open items before go-live

- [ ] Counsel sign-off on this policy (institutional affiliation raises the bar).
- [ ] Add the `imageLicense` / `imageAttribution` / `imageSourceUrl` columns +
      migration and the publish-gate check.
- [ ] Confirm site remains non-commercial (governs whether CC-NC is usable).
- [ ] Confirm member-site IRB/data-use coverage for Tier-1 educational reuse.
- [ ] Wire these rules into the OpenWebUI generation path.
