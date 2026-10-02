// AI draft generation for qEEG cases, via an OpenAI-compatible endpoint
// (the team's self-hosted OpenWebUI, which proxies to Claude).
//
// Config (env):
//   OPENWEBUI_BASE_URL   e.g. https://ai.example.org  (no trailing /api)
//   OPENWEBUI_API_KEY    bearer token from OpenWebUI
//   OPENWEBUI_MODEL      e.g. "claude-opus-4-8" (whatever the instance exposes)
//
// IMPORTANT: the model drafts the QUESTION, answer, explanation and teaching
// points around a described finding. It does NOT supply the clinical image — a
// human reviewer attaches a properly LICENSED, DE-IDENTIFIED image before the
// case is published. Every generated case lands in status 'pending_review'.
import type { QuestionType, Difficulty } from "@/lib/cases";

export interface GeneratedCaseDraft {
  title: string;
  clinicalVignette: string;
  questionType: QuestionType;
  questionPrompt: string;
  options: { label: string; isCorrect: boolean; optionExplanation: string }[];
  suggestedRegionDescription: string;   // for point_to_feature: where the target should be
  explanation: string;
  teachingPoints: string[];
  tags: string[];
  difficulty: Difficulty;
  suggestedImage: string;               // what image the reviewer should source (de-identified)
  referenceUrl: string;
}

const SYSTEM_PROMPT = `You are a pediatric epileptologist and clinical neurophysiologist creating a single teaching case for a quantitative-EEG (qEEG) "Case of the Day" aimed at pediatric neurology and critical-care trainees.

Return ONE JSON object ONLY (no prose, no markdown fences) with EXACTLY these keys:
{
  "title": string,                         // short, specific
  "clinicalVignette": string,              // 1-2 sentences, DE-IDENTIFIED, no real patient data
  "questionType": "multiple_choice" | "point_to_feature",
  "questionPrompt": string,
  "options": [ { "label": string, "isCorrect": boolean, "optionExplanation": string } ],  // 3-5 items for multiple_choice; [] for point_to_feature. EXACTLY one isCorrect:true
  "suggestedRegionDescription": string,    // for point_to_feature, describe where in the tracing the target feature sits; "" for multiple_choice
  "explanation": string,                   // the full teaching explanation shown after answering
  "teachingPoints": [ string ],            // 2-4 concise bullets
  "tags": [ string ],
  "difficulty": "introductory" | "intermediate" | "advanced",
  "suggestedImage": string,                // describe the ideal LICENSED, DE-IDENTIFIED EEG/qEEG image a human should attach
  "referenceUrl": string                   // a citation/URL supporting the teaching point, if known, else ""
}

Rules: be clinically accurate; never invent patient identifiers; base findings on established qEEG/EEG literature; if you cite a URL it must be a real, reputable source (journal, ILAE, ACNS) — otherwise use "".`;

interface ChatResponse { choices?: { message?: { content?: string } }[] }

export function generatorConfigured(): boolean {
  return !!(process.env.OPENWEBUI_BASE_URL && process.env.OPENWEBUI_API_KEY && process.env.OPENWEBUI_MODEL);
}

export async function generateCaseDraft(input: {
  topic: string; difficulty?: Difficulty; questionType?: QuestionType;
}): Promise<GeneratedCaseDraft> {
  const base = process.env.OPENWEBUI_BASE_URL;
  const key = process.env.OPENWEBUI_API_KEY;
  const model = process.env.OPENWEBUI_MODEL;
  if (!base || !key || !model) {
    throw new Error("AI generator not configured (set OPENWEBUI_BASE_URL, OPENWEBUI_API_KEY, OPENWEBUI_MODEL).");
  }

  const userMsg =
    `Create a ${input.difficulty || "intermediate"} ${input.questionType || "multiple_choice"} qEEG case about: ${input.topic}.`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, "")}/api/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMsg },
        ],
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    throw new Error(`AI endpoint returned ${res.status}`);
  }
  const json = (await res.json()) as ChatResponse;
  const content = json.choices?.[0]?.message?.content?.trim() || "";
  const draft = parseDraft(content);
  // enforce our invariants
  if (draft.questionType === "multiple_choice") {
    const correct = draft.options.filter((o) => o.isCorrect).length;
    if (draft.options.length < 2 || correct !== 1) {
      throw new Error("AI draft rejected: multiple-choice needs ≥2 options and exactly one correct.");
    }
  }
  return draft;
}

function parseDraft(content: string): GeneratedCaseDraft {
  let text = content;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("AI response was not valid JSON.");
  const obj = JSON.parse(text.slice(start, end + 1));
  return {
    title: String(obj.title || "Untitled case"),
    clinicalVignette: String(obj.clinicalVignette || ""),
    questionType: obj.questionType === "point_to_feature" ? "point_to_feature" : "multiple_choice",
    questionPrompt: String(obj.questionPrompt || ""),
    options: Array.isArray(obj.options)
      ? obj.options.map((o: Record<string, unknown>) => ({
          label: String(o.label || ""),
          isCorrect: !!o.isCorrect,
          optionExplanation: String(o.optionExplanation || ""),
        }))
      : [],
    suggestedRegionDescription: String(obj.suggestedRegionDescription || ""),
    explanation: String(obj.explanation || ""),
    teachingPoints: Array.isArray(obj.teachingPoints) ? obj.teachingPoints.map(String) : [],
    tags: Array.isArray(obj.tags) ? obj.tags.map(String) : [],
    difficulty: ["introductory", "intermediate", "advanced"].includes(obj.difficulty) ? obj.difficulty : "intermediate",
    suggestedImage: String(obj.suggestedImage || ""),
    referenceUrl: String(obj.referenceUrl || ""),
  };
}
