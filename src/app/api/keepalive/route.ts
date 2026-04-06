import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function GET(request: Request) {
  // Verify cron secret in production
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
