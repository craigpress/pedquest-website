// Prose -> recording spec, with a critique-and-repair round.
//
// Same shape as src/lib/qbank/draft.ts: the binding rules in the prompt are the
// contract document itself (content/qbank/IMAGE_SPEC.md), so the model is told
// the same DSL the renderer implements. The difference is what comes back — a
// bare image block for a RECORDING, not a question.
//
// Runtime file read: this loads content/qbank/IMAGE_SPEC.md, so the route that
// calls it needs an `outputFileTracingIncludes` entry in next.config.ts or the
// file is missing from the Vercel bundle.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chat, extractJson, providerModel, selectProvider } from "@/lib/qbank/provider";
import { normalizeSpecInput, validateLabSpec, DURATION_MIN_MINUTES, DURATION_MAX_MINUTES } from "./spec";
import { SYNTHETIC_STAMP, type LabValidation } from "./types";

export const LAB_PROMPT_VERSION = "lab-spec-1";

async function readImageSpecDoc(): Promise<string> {
  try {
    return await readFile(join(process.cwd(), "content", "qbank", "IMAGE_SPEC.md"), "utf8");
  } catch {
    return "";
  }
}

function systemPrompt(imageSpecDoc: string): string {
  return [
    "You are a pediatric epileptologist and clinical neurophysiologist specifying a",
    "SYNTHETIC teaching recording for the PedQuEST EEG Teaching Lab. Nothing you write",
    "describes a real patient, and the recording is stamped",
    `"${SYNTHETIC_STAMP}".`,
    "",
    "Return ONE JSON object and nothing else — no prose, no markdown fences. It is an",
    "image block:",
    '  { "kind": "qeeg_panel", "license": "synthetic-original", "attribution": null,',
    '    "spec": { … } }',
    "",
    "Rules that are not negotiable:",
    "- Use only keys defined in the specification below. Unknown keys are rejected.",
    "- spec.seed must be an integer. spec.duration_min is the recording length in",
    `  minutes and must be between ${DURATION_MIN_MINUTES} and ${DURATION_MAX_MINUTES}.`,
    "- Every event time must fall inside the recording.",
    "- Match the background, the age band and the event set so the case hangs together:",
    "  a sedated delta-dominant infant does not have a 9 Hz posterior rhythm.",
    "- An attenuation_transient whose delta_depth_pct equals its depth_pct leaves every",
    "  band ratio flat and makes the case unanswerable. Give ischemia a delta_depth_pct",
    "  well below its depth_pct.",
    "- annotations[] are what the BEDSIDE TEAM wrote and they are visible to the",
    "  learner. Never name the finding in one. \"Lorazepam 0.1 mg/kg\" is fine;",
    "  \"seizure onset\" is the answer key and belongs nowhere near the recording.",
    "- Do not invent a `panels`, `style` or `source` block unless asked.",
    "",
    "=== IMAGE SPECIFICATION DSL (binding) ===",
    imageSpecDoc || "(specification unavailable — follow the key names above exactly)",
  ].join("\n");
}

function userPrompt(input: { prose: string; durationMin: number; seed: number; runPersyst: boolean }): string {
  return [
    "Write the image block for this teaching recording.",
    "",
    "=== WHAT THE EDITOR ASKED FOR ===",
    input.prose,
    "",
    `Unless the description says otherwise, set spec.duration_min to ${input.durationMin}`,
    `and spec.seed to ${input.seed}.`,
    ...(input.runPersyst
      ? ["This recording will be processed by Persyst, so it must be long enough for a",
         "baseline window and must not rely on channels outside the standard array."]
      : []),
    "",
    "Your response must begin with { and end with }.",
  ].join("\n");
}

function repairPrompt(errors: string[], warnings: string[]): string {
  return [
    "That block did not validate. Fix every error and return the corrected block —",
    "the whole object again, not a patch.",
    "",
    "ERRORS (must fix):",
    ...errors.map((e) => `- ${e}`),
    ...(warnings.length ? ["", "WARNINGS (fix if it does not change the teaching point):",
      ...warnings.map((w) => `- ${w}`)] : []),
    "",
    "Your response must begin with { and end with }.",
  ].join("\n");
}

export interface LabDraftResult {
  spec: unknown;
  validation: LabValidation;
  provider: string;
  model: string;
  promptVersion: string;
  notes: string[];
  repaired: boolean;
}

/**
 * One drafting attempt plus, when the deterministic checks fail, one repair
 * round. Two calls is the cap: a model that cannot produce a valid block twice
 * is not going to on the third try, and the editor can fix it by hand in Expert
 * mode faster than the loop can.
 */
export async function draftSpecFromProse(input: {
  prose: string;
  durationMin: number;
  seed: number;
  runPersyst: boolean;
  timeoutMs?: number;
}): Promise<LabDraftResult> {
  const provider = selectProvider();
  if (provider === "mock") {
    throw new Error(
      "No LLM provider is configured, so prose drafting is unavailable. Set " +
      "OPENWEBUI_BASE_URL/OPENWEBUI_API_KEY/OPENWEBUI_MODEL or ANTHROPIC_API_KEY, " +
      "or build the scenario in Guided mode.",
    );
  }

  const doc = await readImageSpecDoc();
  const notes: string[] = [];
  if (!doc) notes.push("IMAGE_SPEC.md was not readable at runtime — the prompt ran without it.");

  const system = systemPrompt(doc);
  const first = await chat({
    system,
    user: userPrompt(input),
    timeoutMs: input.timeoutMs ?? 120_000,
  });

  let block = normalizeSpecInput(extractJson(first.text));
  if (!block) throw new Error("The model returned JSON that is not a spec block.");

  let validation = validateLabSpec(block, {
    runPersyst: input.runPersyst,
    durationS: input.durationMin * 60,
  });
  let repaired = false;

  if (!validation.ok) {
    notes.push(`First draft failed ${validation.errors.length} check(s); asked for a repair.`);
    const second = await chat({
      system,
      user: [
        userPrompt(input),
        "",
        "=== YOUR PREVIOUS ANSWER ===",
        JSON.stringify(block),
        "",
        repairPrompt(validation.errors, validation.warnings),
      ].join("\n"),
      timeoutMs: input.timeoutMs ?? 120_000,
    });
    const retry = normalizeSpecInput(extractJson(second.text));
    if (retry) {
      const retryValidation = validateLabSpec(retry, {
        runPersyst: input.runPersyst,
        durationS: input.durationMin * 60,
      });
      // Keep the repair only when it is actually better — a "fix" that trades
      // three errors for four is not one.
      if (retryValidation.errors.length < validation.errors.length) {
        block = retry;
        validation = retryValidation;
        repaired = true;
      } else {
        notes.push("The repair did not improve the block; the first draft is what is shown.");
      }
    }
  }

  return {
    spec: block,
    validation,
    provider: first.provider,
    model: first.model || providerModel(provider),
    promptVersion: LAB_PROMPT_VERSION,
    notes,
    repaired,
  };
}

// ── revision from review feedback ──────────────────────────────────────────

function reviseUserPrompt(input: {
  spec: unknown;
  feedback: string;
  title: string | null;
  durationMin: number;
  runPersyst: boolean;
}): string {
  return [
    "Revise the recording spec below to address the editor's review feedback.",
    "This is an EDIT, not a new recording: keep the seed, the age band, the",
    "background, every event and every annotation the feedback does not ask you",
    "to change. Return the WHOLE corrected image block, not a patch.",
    "",
    "If the feedback describes something the spec cannot express (a montage",
    "artefact, a renderer bug), change the nearest spec knob that addresses the",
    "teaching intent — a different montage, region, spread, depth or timing — and",
    "leave everything else alone. Do not add a `panels`, `style` or `source`",
    "block unless the feedback asks for one.",
    "",
    ...(input.title ? [`=== RECORDING TITLE ===`, input.title, ""] : []),
    "=== EDITOR FEEDBACK ===",
    input.feedback,
    "",
    `Keep spec.duration_min at ${input.durationMin} unless the feedback says otherwise.`,
    ...(input.runPersyst
      ? ["This recording is processed by Persyst: keep a baseline window and stay",
         "within the standard array."]
      : []),
    "",
    "=== CURRENT SPEC (JSON) ===",
    JSON.stringify(input.spec, null, 2),
    "",
    "Your response must begin with { and end with }.",
  ].join("\n");
}

/**
 * Feedback + current spec -> revised spec, with the same one-repair cap as
 * drafting. The caller enqueues the export; nothing here touches the database.
 */
export async function reviseSpecFromFeedback(input: {
  spec: unknown;
  feedback: string;
  title: string | null;
  durationMin: number;
  runPersyst: boolean;
  timeoutMs?: number;
}): Promise<LabDraftResult> {
  const provider = selectProvider();
  if (provider === "mock") {
    throw new Error(
      "No LLM provider is configured, so AI revision is unavailable. Set " +
      "OPENWEBUI_BASE_URL/OPENWEBUI_API_KEY/OPENWEBUI_MODEL or ANTHROPIC_API_KEY, " +
      "or edit the spec by hand in Expert mode.",
    );
  }

  const doc = await readImageSpecDoc();
  const notes: string[] = [];
  if (!doc) notes.push("IMAGE_SPEC.md was not readable at runtime — the prompt ran without it.");

  const system = systemPrompt(doc);
  const user = reviseUserPrompt(input);
  const first = await chat({ system, user, timeoutMs: input.timeoutMs ?? 120_000 });

  let block = normalizeSpecInput(extractJson(first.text));
  if (!block) throw new Error("The model returned JSON that is not a spec block.");

  const validateOpts = { runPersyst: input.runPersyst, durationS: input.durationMin * 60 };
  let validation = validateLabSpec(block, validateOpts);
  let repaired = false;

  if (!validation.ok) {
    notes.push(`The revision failed ${validation.errors.length} check(s); asked for a repair.`);
    const second = await chat({
      system,
      user: [user, "", "=== YOUR PREVIOUS ANSWER ===", JSON.stringify(block), "",
        repairPrompt(validation.errors, validation.warnings)].join("\n"),
      timeoutMs: input.timeoutMs ?? 120_000,
    });
    const retry = normalizeSpecInput(extractJson(second.text));
    if (retry) {
      const retryValidation = validateLabSpec(retry, validateOpts);
      if (retryValidation.errors.length < validation.errors.length) {
        block = retry;
        validation = retryValidation;
        repaired = true;
      } else {
        notes.push("The repair did not improve the block; the first revision is what is shown.");
      }
    }
  }

  return {
    spec: block,
    validation,
    provider: first.provider,
    model: first.model || providerModel(provider),
    promptVersion: LAB_PROMPT_VERSION,
    notes,
    repaired,
  };
}
