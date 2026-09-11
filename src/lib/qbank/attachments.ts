// Editor-supplied source material for a generation prompt: a PDF to ground
// the item on, and/or a reference image to synthesize an original version of.
//
// The hard rule, enforced here and stated to the model in the prompt: an
// uploaded image is REFERENCE ONLY. The published figure is always an
// original render from the item's own image.spec. Nothing uploaded is ever
// served to a learner, which is what keeps third-party figure copyright out
// of the bank (docs/CASE_IMAGE_SOURCING_POLICY.md).

import { isSupportedImageType, type ChatImage } from "./provider";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const ATTACHMENT_BUCKET = "qbank-attachments";
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_PROMPT = 6;
/** Keep the prompt affordable: a long paper is truncated, not dropped. */
export const MAX_PDF_CHARS = 60_000;

export interface Attachment {
  id: string;
  batch: string;
  kind: "pdf" | "image";
  filename: string;
  mimeType: string;
  byteSize: number;
  storagePath: string;
  extractedText: string | null;
  note: string | null;
}

export function mapAttachment(r: any): Attachment {
  return {
    id: r.id,
    batch: r.batch,
    kind: r.kind,
    filename: r.filename,
    mimeType: r.mime_type,
    byteSize: r.byte_size,
    storagePath: r.storage_path,
    extractedText: r.extracted_text ?? null,
    note: r.note ?? null,
  };
}

/** Pull the text out of a PDF. Returns "" when the file has no text layer
 *  (a scanned figure, say) — the caller reports that rather than pretending
 *  the paper was read. */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(bytes);
  const { text } = await extractText(doc, { mergePages: true });
  return (Array.isArray(text) ? text.join("\n") : text)
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function loadAttachments(
  supabase: any,
  where: { batch?: string; jobId?: string; caseId?: string },
): Promise<Attachment[]> {
  let q = supabase.from("eeg_case_attachments").select("*").order("created_at");
  if (where.batch) q = q.eq("batch", where.batch);
  if (where.jobId) q = q.eq("job_id", where.jobId);
  if (where.caseId) q = q.eq("case_id", where.caseId);
  const { data, error } = await q;
  if (error || !data) return [];
  return (data as any[]).map(mapAttachment);
}

/** Download the image attachments and encode them for the model. */
export async function imagesForPrompt(
  supabase: any,
  attachments: Attachment[],
): Promise<ChatImage[]> {
  const out: ChatImage[] = [];
  for (const a of attachments) {
    if (a.kind !== "image" || !isSupportedImageType(a.mimeType)) continue;
    const { data, error } = await supabase.storage.from(ATTACHMENT_BUCKET).download(a.storagePath);
    if (error || !data) continue;
    const buf = Buffer.from(await (data as Blob).arrayBuffer());
    out.push({ mediaType: a.mimeType.toLowerCase(), base64: buf.toString("base64"), label: a.filename });
  }
  return out;
}

/**
 * The prompt section describing what the editor attached. Written so the
 * model cannot mistake a reference figure for something to reproduce.
 */
export function formatAttachments(attachments: Attachment[]): string {
  if (attachments.length === 0) return "";
  const lines: string[] = [];
  const pdfs = attachments.filter((a) => a.kind === "pdf");
  const images = attachments.filter((a) => a.kind === "image");

  if (images.length) {
    lines.push(
      "=== EDITOR-SUPPLIED REFERENCE IMAGES ===",
      "The attached image(s) are REFERENCE MATERIAL, not content to reuse.",
      "You must NOT describe them as the item's figure and must NOT assume they",
      "will be shown to the learner - they will not be. Write an image.spec that",
      "makes the renderer draw an ORIGINAL synthetic figure showing the same",
      "teaching feature (same pattern, montage, panel mix and time scale as far",
      "as the spec supports it). Describe in image_caption only what your spec",
      "will actually produce.",
      "",
    );
    images.forEach((a, i) => {
      lines.push(`[image ${i + 1}] ${a.filename}${a.note ? ` — editor's note: ${a.note}` : ""}`);
    });
    lines.push("");
  }

  if (pdfs.length) {
    lines.push(
      "=== EDITOR-SUPPLIED DOCUMENTS ===",
      "Text extracted from files the editor attached. Treat these exactly like",
      "the retrieved abstracts: you may ground statements and numbers in them,",
      "and you must not go beyond them. Cite them only if you can give a real",
      "PMID or DOI that appears in the text.",
      "",
    );
    for (const a of pdfs) {
      const body = (a.extractedText ?? "").slice(0, MAX_PDF_CHARS);
      lines.push(`--- ${a.filename}${a.note ? ` (editor's note: ${a.note})` : ""} ---`);
      lines.push(
        body.length
          ? body + (a.extractedText && a.extractedText.length > MAX_PDF_CHARS ? "\n[...truncated]" : "")
          : "(no extractable text — this PDF appears to be a scan; ignore it)",
      );
      lines.push("");
    }
  }
  return lines.join("\n").trim();
}
