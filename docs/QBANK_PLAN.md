# PedQuEST qEEG Question Bank — Plan for a robust, self-sustaining education product

**Written:** 2026-09-03 · **Status:** v1 plan accompanying the `feat/question-bank` branch ·
**Owner:** Craig Press · **Editors (proposed):** Laura Caligiuri, Anuj Jayakar (education leads), Giulia Benedetti

This document is the "why and how" for the question bank. Implementation detail lives in
`docs/QBANK_PLATFORM.md` (platform), `tools/eeg-render/README.md` (images), and
`content/qbank/*` (content rules). Section 8 answers "what was missing from the original
prompt" and Section 9 is the improved prompt.

---

## 1. Design principles (three hats)

**Educator.** Items exist to change bedside behavior: recognize a seizure on a trend, know
when to open the raw EEG, know what a background pattern means for a family conversation.
So every item has a learning objective mapped to a blueprint domain, a Bloom level, per-option
rationales (learners learn most from *why the distractor is wrong*), and three flashcard-grade
key points. Practice is spaced and adaptive later (Section 6), not now.

**Website designer.** One decision per screen. Learner path: pick a domain → answer → reveal →
read → next. Editor path: queue → item → approve. Mobile first (many members will do a
"Case of the Day" on a phone between patients). Images must be legible at phone width, with
a zoom, and color-blind-safe colormaps. Dark "instrument panel" design system already exists;
reuse it.

**AI engineer.** Generation is cheap; trust is expensive. The pipeline therefore optimizes for
*verifiable provenance* rather than volume: every number traces to a verified PMID, every image
traces to a deterministic spec or an openly licensed dataset, and nothing reaches learners
without an editor. AI output is a *draft queue*, never a publish path.

## 2. Architecture (what the branch builds)

```
content/qbank/questions/*.yaml   ──► qbank-validate (schema, PMIDs, duplicates)
        │                                   │
        ▼                                   ▼
tools/eeg-render  ──► public/images/qbank/<ID>.png + .json sidecar
        │
        ▼
scripts/qbank-import ──► Supabase eeg_cases (+options, references, revisions, reviews)
                                │            status: pending_review
                                ▼
                     /admin/qbank  (editors approve / request changes / reject)
                                │            DB publish gate: license + verified ref + four-eyes
                                ▼
          /education/question-bank (members) · /education/case-of-the-day (public daily)
```

Sustaining loop: `cron qbank-generate` (weekly) → pick lowest-coverage domain → PubMed
retrieval → LLM draft → LLM critic → PMID verification → render job → `pending_review` →
editor notification. Editors' edits and rejection reasons are stored and fed back as
few-shot exemplars and critic rules (Section 5).

**Content as code.** The YAML files are the canonical source for authored items, reviewed via
git like any other change. The database is canonical for *status, reviews, revisions and
responses*. Import never downgrades a reviewed item; it opens a re-review instead.

## 3. Governance

| Role | Who | Can |
|---|---|---|
| member | every Authentik `pedquest` user | practice, see progress, flag an item |
| editor | designated in `/admin/users` | edit any item, approve/reject, schedule Case of the Day, trigger re-render |
| admin | Craig (+ whoever he designates) | everything above, manage roles, run generation, change blueprint |

Rules enforced in the database, not just the UI:

- **Four-eyes:** the approver cannot be the author.
- **Publish gate:** image license set (`CASE_IMAGE_SOURCING_POLICY.md`), at least one verified
  reference, review recorded.
- **Versioning:** every content edit writes a revision; published items that are edited return
  to review.
- **Retirement:** items are archived (never deleted) when evidence changes; the archive keeps the
  response history for psychometrics.
- **Conflict of interest:** editors should not approve items that cite only their own papers
  as primary evidence (policy, enforce socially for now; flag in UI later).

## 4. Content quality system

1. **Blueprint** (`BLUEPRINT.md`): six domains with target weights; the generator targets gaps.
2. **Style guide** (`STYLE_GUIDE.md`): NBME one-best-answer rules, ACNS terminology, exact
   sourced numbers, pediatric-first evidence, de-identification, copyright.
3. **Schema** (`schema/question.schema.json`): machine-enforced structure, including a writer
   checklist that must be truthfully set.
4. **Evidence verification**: PMIDs resolved against NCBI; open-access status recorded;
   member-authored flag for the publications page cross-link.
5. **Image provenance**: `synthetic-original` (deterministic spec → renderer) or
   `dataset-derived` (CHB-MIT ODC-BY 1.0; Helsinki neonatal CC BY 4.0) with attribution written
   into the sidecar and rendered under the image. No published figures, ever.
6. **Editor review**: structured form, per-option rationale editing, PMID re-verify button,
   image re-render from an edited spec, decision + notes.
7. **Psychometrics (phase 2)**: per-item difficulty (p), discrimination (point-biserial),
   distractor uptake from `eeg_responses`; auto-flag items with p > 0.95, p < 0.2, or a
   distractor chosen more than the key.
8. **Learner flags**: "report a problem" on every item → editor queue.

## 5. AI generation with guardrails

- **Retrieval-grounded drafting.** The model only sees abstracts (and PMC-OA full text when
  available) it can cite; the critic rejects any number not present in the retrieved text.
- **Two-model discipline.** Drafter and critic are separate calls with separate prompts; the
  critic is adversarial (cover test, cueing, homogeneity, terminology, copyright risk).
- **Prompt-injection hygiene.** Retrieved text is data; the drafter prompt instructs the model to
  ignore any instructions inside abstracts, and the critic checks for leaked instructions.
- **Cost control.** Default provider is the existing OpenWebUI → Claude route already configured
  in Vercel (no incremental cost); optional Anthropic API key for reliability. Weekly cadence,
  three drafts per run, roughly 12 candidate items a month for editors to triage.
- **Feedback loop.** Approved-without-edit items become new few-shot exemplars; rejection
  notes are mined quarterly into critic rules. Track "approved without edit %" as the
  pipeline's quality KPI.
- **Rendering.** Drafts carry an `image.spec`; a render job is queued and a Python worker (on
  the CraigsRig workstation as a scheduled task, or any machine with Python) renders and
  uploads. Editors can re-render after editing the spec.

## 6. Learner experience roadmap

- **Now:** browse/filter, practice random unanswered items, reveal with rationales and
  references, progress by domain, daily Case of the Day.
- **Next:** spaced repetition (re-serve missed items at 3/7/21 days), streaks, "curriculum
  tracks" (fellow, nurse, EEG tech), certificate of completion per track.
- **Later:** CME. ACCME-style requirements (needs assessment, disclosures, evaluation,
  attestation) should be designed in before applying; the item metadata already supports it.

## 7. Resources — what exists and what is free

**Already in place:** Supabase (Postgres, auth, storage), Vercel (hosting, cron), Authentik SSO
with the `pedquest` group and a first-time-setup flow, Resend for email, OpenWebUI → Claude
gateway, Bifrost gateway, EndNote library MCP with full-text PDFs, PubMed MCP, OpenEvidence,
Discord notifications, ~250 indexed member publications.

**Free or already-licensed inputs:** NCBI E-utilities (free API key raises rate limit),
PMC Open Access subset (CC-licensed full text), PhysioNet CHB-MIT (ODC-BY 1.0), Zenodo
Helsinki neonatal EEG (CC BY 4.0), MNE-Python/NumPy/SciPy/Matplotlib for rendering, GitHub
Actions for validation on pull requests, Vercel cron (hobby tier allows daily; weekly is fine).

**Not needed:** image-generation models (they produce plausible-looking but physiologically
wrong EEG; our renderer computes trends from signals instead).

## 8. What the original prompt did not cover (gaps to decide)

1. **Audience and levels.** Fellows vs nurses vs EEG techs need different item difficulty and
   tracks. Decision: start mixed, tag difficulty, add tracks in phase 2.
2. **Legal sign-off.** `CASE_IMAGE_SOURCING_POLICY.md` still lists counsel sign-off, IRB/data-use
   coverage for consortium images, and non-commercial status as open. Synthetic images sidestep
   most of this, but the policy should still be signed before any consortium-derived image is used.
3. **Learner data.** Response data is educational data about identifiable members, some in the
   EU/Canada/Australia. Add a privacy note to the bank page, a retention rule, and an export/
   delete path. Do not store IP addresses (already removed elsewhere on the site).
4. **Editorial operations.** Who are the editors, what is the review SLA, how are disagreements
   resolved, who owns the blueprint? Proposal: education leads as editors, monthly 30-minute
   editorial call, Craig as tie-breaker.
5. **Account lifecycle.** The membership spreadsheet is the source of truth for accounts;
   nothing removes access when someone leaves. Add a quarterly sync (diff spreadsheet vs
   Authentik group; deactivate leavers) and a documented onboarding email template.
6. **Passkey policy.** Authentik will prompt passkey enrollment on first login (existing
   MFA-required flow). Decide whether TOTP is an acceptable fallback for members without
   passkey-capable devices (current stage allows it).
7. **Accessibility.** Color-blind-safe colormaps, alt text generated from the spec, keyboard
   operation of point-to-feature, minimum contrast on the dark theme.
8. **Psychometrics and item retirement** (Section 4.7) were absent; without them the bank
   degrades silently.
9. **Feedback channel** for learners to report a wrong key or a stale reference.
10. **CME intent.** If CME is a goal, disclosures and needs assessment must be captured per item
    from the start.
11. **Operations.** Who runs the render worker, rotates `CRON_SECRET`, watches failures, and
    backs up the bank (the existing `npm run backup` should include the new tables).
12. **Success criteria.** Define them: 50 approved items by launch, ≥ 1 new approved item/week
    from the pipeline, ≥ 50 % of members answering ≥ 1 item/month, editor review time < 10 min
    per item, zero published items with unverified references.
13. **Model and vendor independence.** The provider abstraction exists; document the fallback
    order so a gateway outage does not stall the weekly run.
14. **Scope split.** Case of the Day (public, one per day, marketing value) vs the member-only
    bank should be an explicit product decision; the branch implements both with one data model.

## 9. Improved prompt (what to ask for next time)

> Build the PedQuEST qEEG question bank as an editor-governed, evidence-verified education
> product for consortium members (fellows, PICU/NICU attendings, EEG technologists, nurses).
>
> **Content:** author an initial library of 50 NBME-style one-best-answer items (≥ 8
> point-to-feature) across a six-domain blueprint (foundations, seizure detection, ACNS
> terminology, clinical prognosis, monitoring practice, pitfalls) with ≥ 12 neonatal items,
> difficulty 30/45/25 % introductory/intermediate/advanced, per-option rationales, three key
> points, and 1–3 references whose PMIDs are verified by lookup. Every number must be exact
> and sourced with its population. Prefer pediatric and PedQuEST-member evidence; label adult
> data. Follow ACNS 2021 and neonatal terminology.
>
> **Images:** render every item's image from a deterministic spec using computed qEEG trends
> (spectrogram, rhythmicity, asymmetry, aEEG, suppression ratio, seizure probability) and
> realistic raw EEG pages, or from openly licensed datasets (CHB-MIT, Helsinki neonatal) with
> attribution. Never reproduce published figures. Record license and provenance per image.
>
> **Platform:** extend the existing Case-of-the-Day schema with roles (member/editor/admin,
> designated in the site by admins), references, revisions, reviews, a DB-enforced publish
> gate (license + verified reference + four-eyes), an editor console, a member practice UI with
> progress, and import/validate tooling. Keep content as YAML in git.
>
> **Automation:** a weekly job that picks blueprint gaps, retrieves PubMed evidence, drafts
> with an LLM, critiques with a second pass, verifies PMIDs, renders the image, and queues to
> editors with notifications. Track approved-without-edit rate. Nothing publishes without an
> editor.
>
> **Access:** provision all roster members in Authentik in a dedicated group bound to the
> PedQuEST application, with a first-time-setup flow (set password, then passkey) and no
> outbound email until the launch announcement.
>
> **Also deliver:** privacy note and retention rule for learner responses, an accessibility
> pass, a learner "report a problem" path, a quarterly account-sync script against the
> membership list, KPIs, and an editorial operations proposal. Flag any legal sign-offs still
> open. Use Opus-class subagents for content, rendering, and platform work in parallel, with
> a final QA pass that validates schema, PMIDs, renders, and visual realism.

## 10. Launch checklist

- [ ] Apply `supabase/migrations/20260903_qbank.sql`; run `npm run qbank:validate` then
      `npm run qbank:import`.
- [ ] Render all items (`python -m eeg_render render-all content/qbank/questions`) and
      spot-check 10 images with a neurophysiologist.
- [ ] Editors designated in `/admin/users`; each approves ≥ 5 items to test the gate.
- [ ] Set Vercel env for generation (`OPENWEBUI_*` already; optional `ANTHROPIC_API_KEY`);
      confirm `CRON_SECRET`; enable the weekly cron.
- [ ] Register the render worker as a scheduled task; confirm one job round-trips.
- [ ] Counsel sign-off on the image policy (or restrict to synthetic images until then).
- [ ] Privacy note on the bank page; add new tables to `npm run backup`.
- [ ] Announcement email (Resend, from a pedquest.org address — task PQW-062) with the
      first-time-setup link `https://auth.presshome.net/if/flow/pedquest-recovery/`.
