import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";

// Upload a (de-identified) case image to the 'eeg-cases' storage bucket. Admin only.
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "Invalid upload." }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided." }, { status: 400 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "File must be an image." }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: "Image must be under 8 MB." }, { status: 400 });

  const supabase = createServerClient()!;
  const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("eeg-cases").upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    console.error("[CaseUpload] failed:", error.message);
    return NextResponse.json({ error: "Upload failed." }, { status: 500 });
  }
  const { data } = supabase.storage.from("eeg-cases").getPublicUrl(path);
  return NextResponse.json({ success: true, url: data.publicUrl });
}
