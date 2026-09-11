// LLM provider abstraction for the question-bank pipeline.
//
// Two real providers plus a mock:
//   * openwebui  (default) — the team's self-hosted OpenAI-compatible endpoint,
//                            already configured in Vercel as OPENWEBUI_*.
//   * anthropic             — direct Claude API via the official SDK, used when
//                            ANTHROPIC_API_KEY is set and QBANK_PROVIDER picks it.
//   * mock                  — no network. Returned when nothing is configured, so
//                            `qbank:generate --dry-run` still exercises the
//                            prompt assembly, the critic and the row mapping.
//
// Select explicitly with QBANK_PROVIDER=openwebui|anthropic|mock; otherwise the
// first configured provider wins (openwebui, then anthropic, then mock).
import Anthropic from "@anthropic-ai/sdk";

export type ProviderName = "openwebui" | "anthropic" | "mock";

/** An image put in front of the model as REFERENCE material. */
export interface ChatImage {
  /** image/png, image/jpeg, image/gif or image/webp */
  mediaType: string;
  /** raw base64, no data: prefix */
  base64: string;
  /** shown to the model so it can refer to the picture by name */
  label?: string;
}

export interface ChatRequest {
  system: string;
  user: string;
  /** Reference images (an editor's example figure, say). Both real providers
   *  support them; the mock ignores them. */
  images?: ChatImage[];
  /** Soft cap; both providers are asked for JSON only. */
  maxTokens?: number;
  timeoutMs?: number;
}

const IMAGE_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function isSupportedImageType(mediaType: string): boolean {
  return IMAGE_MEDIA_TYPES.has(mediaType.toLowerCase());
}

export interface ChatResult {
  text: string;
  provider: ProviderName;
  model: string;
}

const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";

export function openWebUiConfigured(): boolean {
  return !!(process.env.OPENWEBUI_BASE_URL && process.env.OPENWEBUI_API_KEY && process.env.OPENWEBUI_MODEL);
}
export function anthropicConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export function selectProvider(): ProviderName {
  const forced = process.env.QBANK_PROVIDER as ProviderName | undefined;
  if (forced === "openwebui" || forced === "anthropic" || forced === "mock") return forced;
  if (openWebUiConfigured()) return "openwebui";
  if (anthropicConfigured()) return "anthropic";
  return "mock";
}

export function providerModel(provider: ProviderName = selectProvider()): string {
  if (provider === "openwebui") return process.env.OPENWEBUI_MODEL ?? "unknown";
  if (provider === "anthropic") return process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
  return "mock";
}

// ---------------------------------------------------------------------------

async function chatOpenWebUi(req: ChatRequest): Promise<ChatResult> {
  const base = process.env.OPENWEBUI_BASE_URL!;
  const key = process.env.OPENWEBUI_API_KEY!;
  const model = process.env.OPENWEBUI_MODEL!;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 45000);
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          { role: "system", content: req.system },
          {
            role: "user",
            content: req.images?.length
              ? [
                  { type: "text", text: req.user },
                  ...req.images.map((img) => ({
                    type: "image_url",
                    image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
                  })),
                ]
              : req.user,
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`OpenWebUI returned ${res.status}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!text) throw new Error("OpenWebUI returned an empty completion");
    return { text, provider: "openwebui", model };
  } finally {
    clearTimeout(timer);
  }
}

async function chatAnthropic(req: ChatRequest): Promise<ChatResult> {
  const model = providerModel("anthropic");
  // The SDK reads ANTHROPIC_API_KEY from the environment.
  const client = new Anthropic({ timeout: req.timeoutMs ?? 45000 });
  const response = await client.messages.create({
    model,
    max_tokens: req.maxTokens ?? 16000,
    // Writing an NBME-standard item from abstracts is genuinely hard reasoning;
    // effort is kept at medium because the cron route runs inside Vercel's
    // function time limit.
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    system: req.system,
    messages: [
      {
        role: "user",
        content: req.images?.length
          ? [
              ...req.images.map((img) => ({
                type: "image" as const,
                source: { type: "base64" as const, media_type: img.mediaType as "image/png", data: img.base64 },
              })),
              { type: "text" as const, text: req.user },
            ]
          : req.user,
      },
    ],
  });
  if (response.stop_reason === "refusal") {
    throw new Error(
      `Claude declined the request (${response.stop_details?.category ?? "unspecified"}).`,
    );
  }
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!text) throw new Error("Claude returned no text content");
  return { text, provider: "anthropic", model };
}

/** Deterministic stub so the pipeline can be exercised with no LLM reachable. */
function chatMock(req: ChatRequest): ChatResult {
  return {
    text: JSON.stringify({
      mock: true,
      note:
        "No LLM provider is configured (set OPENWEBUI_BASE_URL/API_KEY/MODEL or " +
        "ANTHROPIC_API_KEY). This is a stub response so the pipeline can be dry-run.",
      promptChars: req.system.length + req.user.length,
    }),
    provider: "mock",
    model: "mock",
  };
}

export async function chat(req: ChatRequest): Promise<ChatResult> {
  const provider = selectProvider();
  if (provider === "openwebui") return chatOpenWebUi(req);
  if (provider === "anthropic") return chatAnthropic(req);
  return chatMock(req);
}

/** Pull the first JSON object out of a model response (fences, prose and all). */
export function extractJson(text: string): unknown {
  let body = text;
  const fenced = body.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) body = fenced[1];
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("The model response contained no JSON object.");
  }
  return JSON.parse(body.slice(start, end + 1));
}
