// Draft one question-bank item from retrieved evidence.
//
// The system prompt is assembled from the content contract itself — STYLE_GUIDE.md,
// the JSON Schema, and the worked exemplar in content/qbank/examples — so the
// rules the model follows are the same rules scripts/qbank-validate.ts enforces.
// The only facts it may use are the abstracts retrieve.ts fetched.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { chat, extractJson, providerModel, selectProvider } from "./provider";
import { formatEvidence, type RetrievedArticle } from "./retrieve";
import type { QbankQuestion } from "./question";

export const PROMPT_VERSION = "qbank-draft-2";

const QBANK_DIR = join(process.cwd(), "content", "qbank");

async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

/** The first exemplar in content/qbank/examples, raw. Written by another agent;
 *  absent on a fresh checkout, in which case the prompt simply omits it. */
async function readExemplar(): Promise<string> {
  try {
    const dir = join(QBANK_DIR, "examples");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml")).sort();
    if (files.length === 0) return "";
    return await readFile(join(dir, files[0]), "utf8");
  } catch {
    return "";
  }
}

export interface PromptContext {
  styleGuide: string;
  imageSpec: string;
  schema: string;
  exemplar: string;
  missing: string[];
}

export async function loadPromptContext(): Promise<PromptContext> {
  const [styleGuide, imageSpec, schema, exemplar] = await Promise.all([
    readOptional(join(QBANK_DIR, "STYLE_GUIDE.md")),
    readOptional(join(QBANK_DIR, "IMAGE_SPEC.md")),
    readOptional(join(QBANK_DIR, "schema", "question.schema.json")),
    readExemplar(),
  ]);
  const missing: string[] = [];
  if (!styleGuide) missing.push("STYLE_GUIDE.md");
  if (!imageSpec) missing.push("IMAGE_SPEC.md");
  if (!schema) missing.push("schema/question.schema.json");
  if (!exemplar) missing.push("examples/*.yaml");
  return { styleGuide, imageSpec, schema, exemplar, missing };
}

export function buildSystemPrompt(ctx: PromptContext): string {
  return [
    "You are a pediatric epileptologist and clinical neurophysiologist writing ONE item",
    "for the PedQuEST quantitative-EEG question bank. You write to NBME one-best-answer",
    "standards and you never state a number that does not appear in the supplied abstracts.",
    "",
    "Return ONE JSON object and nothing else — no prose, no markdown fences. It must",
    "validate against the JSON Schema below. Set metadata.source_method to",
    '"ai-generated-pipeline". Leave every metadata.checklist flag false unless you have',
    "actually satisfied it. Use only the PMIDs supplied in the evidence block, and set",
    "references[].verified to false — a separate step verifies them.",
    "",
    "=== ITEM-WRITING STYLE GUIDE (binding) ===",
    ctx.styleGuide || "(style guide unavailable — follow NBME one-best-answer conventions)",
    "",
    "=== IMAGE SPECIFICATION DSL (binding) ===",
    ctx.imageSpec || "(image specification unavailable)",
    "",
    "=== JSON SCHEMA (binding) ===",
    ctx.schema || "(schema unavailable)",
    ...(ctx.exemplar
      ? ["", "=== WORKED EXEMPLAR (YAML — return the same structure as JSON) ===", ctx.exemplar]
      : []),
  ].join("\n");
}

export function buildUserPrompt(input: {
  id: string;
  domain: string;
  topic: string;
  articles: RetrievedArticle[];
}): string {
  return [
    `Write item ${input.id}.`,
    `domain: ${input.domain}`,
    `topic / learning objective to test: ${input.topic}`,
    "",
    "Use ONLY the following abstracts as evidence. Every number, cutoff, sensitivity,",
    "specificity, threshold or time window in the stem or explanation must appear in one",
    "of them, quoted with its population. If a number you want is not here, do not state it.",
    "Do not describe, trace or paraphrase any published figure — the image is rendered",
    "from the image.spec you write, per IMAGE_SPEC.md.",
    "",
    "=== EVIDENCE ===",
    formatEvidence(input.articles),
    "",
    `Set id to exactly "${input.id}", version to 1 and status to "draft".`,
    "Your response must begin with { and end with }. Do not use tools, create files,",
    "or describe what you would write; return the JSON object itself.",
  ].join("\n");
}

export interface DraftResult {
  question: QbankQuestion;
  provider: string;
  model: string;
  promptVersion: string;
  raw: unknown;
}

/**
 * Ask the model for one item. Throws when the response is not JSON or the id
 * came back wrong; the caller marks the generation job failed with the reason.
 */
export async function draftQuestion(input: {
  id: string;
  domain: string;
  topic: string;
  articles: RetrievedArticle[];
  timeoutMs?: number;
}): Promise<DraftResult> {
  const ctx = await loadPromptContext();
  const system = buildSystemPrompt(ctx);
  const user = buildUserPrompt(input);

  const result = await chat({ system, user, timeoutMs: input.timeoutMs });
  let raw: unknown;
  try {
    raw = extractJson(result.text);
  } catch (error) {
    const preview = result.text.replace(/\s+/g, " ").trim().slice(0, 240);
    throw new Error(`${(error as Error).message}${preview ? ` Response began: ${preview}` : ""}`);
  }

  if (typeof raw !== "object" || raw === null) {
    throw new Error("The model returned JSON that is not an object.");
  }
  const q = raw as QbankQuestion;
  if ((raw as Record<string, unknown>).mock) {
    throw new Error(
      "No LLM provider is configured — the mock provider cannot produce an item. " +
      "Set OPENWEBUI_BASE_URL/OPENWEBUI_API_KEY/OPENWEBUI_MODEL or ANTHROPIC_API_KEY.",
    );
  }
  if (q.id !== input.id) {
    // The id is ours to assign; correcting it is safer than rejecting the draft.
    q.id = input.id;
  }
  q.version = 1;
  q.status = "draft";
  q.domain = input.domain;
  if (!q.metadata) {
    throw new Error("The drafted item has no metadata block.");
  }
  q.metadata.source_method = "ai-generated-pipeline";
  q.metadata.model = result.model;

  return {
    question: q,
    provider: result.provider,
    model: result.model,
    promptVersion: PROMPT_VERSION,
    raw,
  };
}

export function describeProvider(): { provider: string; model: string } {
  const provider = selectProvider();
  return { provider, model: providerModel(provider) };
}
