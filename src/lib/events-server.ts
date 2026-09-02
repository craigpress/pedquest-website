// Server-only data access for events. Uses the SERVICE-ROLE client so join
// links and passcodes never depend on client-side RLS.
// NEVER import this from a "use client" module.
import { createServerClient } from "@/lib/supabase";
import { mapEventRow, toPublicEvent, type AdminEvent, type PublicEvent } from "@/lib/events";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Every published event, soonest first. */
export async function getPublicEvents(): Promise<PublicEvent[]> {
  const supabase = createServerClient();
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("status", "published")
    .order("starts_at", { ascending: true });
  if (error || !data) return [];
  return data.map((r: any) => toPublicEvent(mapEventRow(r)));
}

/** Full row including join details — for the register API and admin only. */
export async function getEventBySlug(slug: string): Promise<AdminEvent | null> {
  const supabase = createServerClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from("events").select("*").eq("slug", slug).limit(1);
  if (error || !data || data.length === 0) return null;
  return mapEventRow(data[0]);
}

/* eslint-enable @typescript-eslint/no-explicit-any */
