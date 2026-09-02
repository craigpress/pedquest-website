import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { mapEventRow, type EventTalk } from "@/lib/events";

/* eslint-disable @typescript-eslint/no-explicit-any */

const FORMATS = ["virtual", "in_person", "hybrid"];
const REGISTRATIONS = ["email", "external", "none"];
const STATUSES = ["draft", "published", "archived"];

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function cleanTalks(input: any): EventTalk[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((t) => t && String(t.title || "").trim() && String(t.presenter || "").trim())
    .map((t) => ({
      presenter: String(t.presenter).slice(0, 200),
      title: String(t.title).slice(0, 400),
      ...(t.institution?.trim() ? { institution: String(t.institution).slice(0, 300) } : {}),
    }));
}

// GET: every event (all statuses) with its registration count and the emails
// collected for it, so an admin can follow up. Admin only.
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const supabase = createServerClient()!;

  const { data: rows, error } = await supabase
    .from("events")
    .select("*")
    .order("starts_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Failed to load events." }, { status: 500 });

  const { data: regs } = await supabase
    .from("event_registrations")
    .select("event_slug,email,name,institution,created_at")
    .order("created_at", { ascending: false });

  const bySlug: Record<string, any[]> = {};
  for (const r of regs ?? []) (bySlug[r.event_slug] ||= []).push(r);

  const events = (rows ?? []).map((r: any) => ({
    ...mapEventRow(r),
    registrations: bySlug[r.slug] ?? [],
  }));

  return NextResponse.json({ success: true, events });
}

// POST: save (create or update) or delete an event. Admin only.
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const supabase = createServerClient()!;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const action = String(body.action || "save");

  if (action === "delete") {
    const id = String(body.id || "");
    if (!id) return NextResponse.json({ error: "Missing event id." }, { status: 400 });
    const { error } = await supabase.from("events").delete().eq("id", id);
    if (error) return NextResponse.json({ error: "Delete failed." }, { status: 500 });
    return NextResponse.json({ success: true });
  }

  const input = body.event as any;
  if (!input?.title?.trim() || !input?.startsAt || !input?.host?.trim()) {
    return NextResponse.json(
      { error: "Title, host, and start date/time are required." },
      { status: 400 }
    );
  }

  const registration = REGISTRATIONS.includes(input.registration) ? input.registration : "none";
  if (registration === "external" && !input.registrationUrl?.trim()) {
    return NextResponse.json(
      { error: "An external-registration event needs a registration URL." },
      { status: 400 }
    );
  }

  const row: any = {
    slug: slugify(input.slug?.trim() || input.title),
    series: input.series?.trim() || null,
    title: String(input.title).trim().slice(0, 300),
    summary: input.summary?.trim() || null,
    host: String(input.host).trim().slice(0, 300),
    host_url: input.hostUrl?.trim() || null,
    host_logo: input.hostLogo?.trim() || null,
    starts_at: input.startsAt,
    ends_at: input.endsAt || null,
    timezone: (input.timezone?.trim() || "ET").slice(0, 8),
    format: FORMATS.includes(input.format) ? input.format : "virtual",
    location: input.location?.trim() || null,
    talks: cleanTalks(input.talks),
    registration,
    registration_url: input.registrationUrl?.trim() || null,
    registration_note: input.registrationNote?.trim() || null,
    join_url: input.joinUrl?.trim() || null,
    meeting_id: input.meetingId?.trim() || null,
    passcode: input.passcode?.trim() || null,
    status: STATUSES.includes(input.status) ? input.status : "draft",
    updated_at: new Date().toISOString(),
  };

  if (!row.slug) {
    return NextResponse.json({ error: "Could not derive a slug from the title." }, { status: 400 });
  }

  const id = String(input.id || "");
  if (id) {
    const { error } = await supabase.from("events").update(row).eq("id", id);
    if (error) {
      const msg = error.code === "23505" ? "Another event already uses that slug." : "Save failed.";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
    return NextResponse.json({ success: true, id });
  }

  row.created_by = auth.userId;
  const { data, error } = await supabase.from("events").insert(row).select("id").single();
  if (error || !data) {
    const msg = error?.code === "23505" ? "Another event already uses that slug." : "Create failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  return NextResponse.json({ success: true, id: data.id });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
