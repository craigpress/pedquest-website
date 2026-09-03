# PedQuEST Question Bank (qbank) — content root

This directory is the **source of truth for question content**. The website
imports it into Supabase (`eeg_cases` + companion tables) via
`scripts/qbank-import.ts`; nothing here is served directly.

```
content/qbank/
  README.md            this file
  STYLE_GUIDE.md       item-writing rules every question must follow
  BLUEPRINT.md         domain taxonomy, target counts, writer assignments
  IMAGE_SPEC.md        the image-spec DSL the renderer (tools/eeg-render) consumes
  schema/question.schema.json   JSON Schema for one question file
  examples/            one fully worked exemplar
  questions/           one YAML file per question: <ID>.yaml
  sources/             optional per-question source notes (verification trail)
```

## Lifecycle of a question

1. **Drafted** (human or agent) as `questions/<ID>.yaml`, `status: draft`.
2. **Validated** by `tools/qbank-validate` (schema, PMIDs resolve, image spec
   renders, no duplicate stems).
3. **Rendered**: `tools/eeg-render` produces `public/images/qbank/<ID>.png`
   (+ `.json` sidecar with the answer region and provenance).
4. **Imported** to Supabase as `pending_review`.
5. **Editor review** in `/admin/qbank`: approve, request changes, or reject.
   Every edit is versioned; only `approved` items can be scheduled/published.
6. **Published** to the bank and (optionally) as a Case of the Day.

## Hard rules (see STYLE_GUIDE.md for the full list)

- Every factual claim in an explanation traces to a `references[]` entry with
  a **verified PMID** (writers must confirm via PubMed lookup, not memory).
- No real patient data. Vignettes are composites; images are synthetic or
  derived from openly licensed datasets, never from a published figure.
- Never reproduce copyrighted text. Paraphrase; quotes ≤ 15 words with attribution.
- One best answer. Homogeneous options. No "all/none of the above".
