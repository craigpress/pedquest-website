import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/admin-auth";
import { createServerClient } from "@/lib/supabase";
import { isSupportedImageType } from "@/lib/qbank/provider";
import {
  ATTACHMENT_BUCKET, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_PROMPT,
  extractPdfText, loadAttachments,
} from "@/lib/qbank/attachments";

export const runtime = "nodejs";
export const maxDuration = 120;

/* eslint-disable @typescript-eslint/no-explicit-any */

// Source material an editor attaches to a generation prompt: a PDF to ground
// the item on, or a figure to synthesize an original version of. Editor-only,
// never learner-facing — see src/lib/qbank/attachments.ts.

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, "editor");
  if (!auth.ok) return auth.response;

  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "Invalid upload." }, { status: 400 }); }

  const file = form.get("file");
  const batch = String(form.get("batch") ?? "").trim();
  const note = String(form.get("note") ?? "").trim().slice(0, 400) || null;

  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided." }, { status: 400 });
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(batch)) {
    return NextResponse.json({ error: "A valid upload batch id is required." }, { status: 400 });
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: `Files must be under ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.` }, { status: 400 });
  }

  const mime = (file.type || "").toLowerCase();
  const isPdf = mime === "application/pdf";
  const isImage = isSupportedImageType(mime);
  if (!isPdf && !isImage) {
    return NextResponse.json(
      { error: "Attach a PDF, or a PNG, JPEG, GIF or WebP image." },
      { status: 400 },
    );
  }

  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: "Server not configured." }, { status: 503 });

  const existing = await loadAttachments(supabase, { batch });
  if (existing.length >= MAX_ATTACHMENTS_PER_PROMPT) {
    return NextResponse.json(
      { error: `At most ${MAX_ATTACHMENTS_PER_PROMPT} attachments per prompt.` },
      { status: 400 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // Read the PDF now rather than at generation time: a scan with no text
  // layer should be reported to the editor while they can still act on it.
  let extracted: string | null = null;
  if (isPdf) {
    try {
      extracted = await extractPdfText(bytes);
    } catch (e) {
      console.error("[QbankAttachment] PDF extraction failed:", (e as Error).message);
      extracted = "";
    }
  }

  const ext = isPdf ? "pdf" : (mime.split("/")[1] || "png").replace(/[^a-z0-9]/g, "");
  const path = `${batch}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (upErr) {
    console.error("[QbankAttachment] upload failed:", upErr.message);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("eeg_case_attachments")
    .insert({
      batch,
      kind: isPdf ? "pdf" : "image",
      filename: file.name.slice(0, 200),
      mime_type: mime,
      byte_size: bytes.byteLength,
      storage_path: path,
      extracted_text: extracted,
      note,
      uploaded_by: auth.userId,
    })
    .select("id")
    .single();
  if (error) {
    await supabase.storage.from(ATTACHMENT_BUCKET).remove([path]);
    return NextResponse.json({ error: "Could not record the attachment." }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    id: (data as any).id,
    kind: isPdf ? "pdf" : "image",
    filename: file.name,
    // tell the editor straight away if a PDF gave us nothing to read
    textChars: extracted === null ? null : extracted.length,
    warning:
      isPdf && extracted !== null && extracted.length < 200
        ? "This PDF has little or no extractable text (it may be a scan), so it will not be used as evidence."
        : null,
  });
}

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, "editor");
  if (!auth.ok) return auth.response;
  const batch = request.nextUrl.searchParams.get("batch") ?? "";
  if (!batch) return NextResponse.json({ error: "batch is required." }, { status: 400 });
  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: "Server not configured." }, { status: 503 });
  const items = await loadAttachments(supabase, { batch });
  return NextResponse.json({
    success: true,
    items: items.map((a) => ({
      id: a.id, kind: a.kind, filename: a.filename, byteSize: a.byteSize,
      note: a.note, textChars: a.extractedText?.length ?? null,
    })),
  });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireRole(request, "editor");
  if (!auth.ok) return auth.response;
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const supabase = createServerClient();
  if (!supabase) return NextResponse.json({ error: "Server not configured." }, { status: 503 });

  const { data } = await supabase
    .from("eeg_case_attachments").select("storage_path").eq("id", id).maybeSingle();
  if ((data as any)?.storage_path) {
    await supabase.storage.from(ATTACHMENT_BUCKET).remove([(data as any).storage_path]);
  }
  const { error } = await supabase.from("eeg_case_attachments").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Could not remove the attachment." }, { status: 500 });
  return NextResponse.json({ success: true });
}
