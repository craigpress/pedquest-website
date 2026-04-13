import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function GET(request: Request) {
  // Vercel cron jobs automatically send the CRON_SECRET in the Authorization header.
  // For a simple keepalive that only reads from the database, we don't need strict auth.

  const supabase = createServerClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, reason: "Supabase not configured" }, { status: 503 });
  }

  // Lightweight query to keep the project active
  const { error } = await supabase.from("contact_messages").select("id", { count: "exact", head: true });

  if (error) {
    console.error("[Keepalive] Supabase query failed:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  console.log(`[Keepalive] Supabase pinged successfully at ${new Date().toISOString()}`);
  return NextResponse.json({ ok: true, timestamp: new Date().toISOString() });
}
