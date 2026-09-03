import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/admin-auth";
import { rowToMember, memberToRow, type MemberRow } from "@/lib/members-server";

/**
 * Admin CRUD for members. The Supabase table is the source of truth;
 * src/data/members.generated.ts is rebuilt from it by `prebuild`, so an edit
 * here reaches the site on the next deploy (see POST action "publish" on
 * /api/admin/publish).
 */

// GET: every member, all statuses. Admin only.
export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const supabase = createServerClient()!;

  const { data, error } = await supabase
    .from("members")
    .select("*")
    .order("status", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    console.error("[AdminMembers] list failed:", error.message);
    return NextResponse.json({ error: "Failed to load members." }, { status: 500 });
  }

  const members = (data ?? []).map((r) => rowToMember(r as MemberRow));
  return NextResponse.json({
    success: true,
    members,
    counts: members.reduce<Record<string, number>>((acc, m) => {
      acc[m.status] = (acc[m.status] ?? 0) + 1;
      return acc;
    }, {}),
  });
}

// POST: { action: "save" | "archive" | "restore" | "delete", member?, id? }
export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const supabase = createServerClient()!;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "save";

  if (action === "save") {
    const parsed = memberToRow((body.member ?? {}) as Record<string, unknown>);
    if (parsed.error !== undefined) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const row = parsed.row;

    const { data, error } = await supabase
      .from("members")
      .upsert(row, { onConflict: "id" })
      .select()
      .single();

    if (error) {
      console.error("[AdminMembers] save failed:", error.message);
      return NextResponse.json({ error: "Failed to save member." }, { status: 500 });
    }
    console.log(`[AdminMembers] ${auth.email} saved ${row.id}`);
    return NextResponse.json({ success: true, member: rowToMember(data as MemberRow) });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ error: "Member id is required." }, { status: 400 });

  if (action === "archive" || action === "restore") {
    const status = action === "archive" ? "archived" : "active";
    const { data, error } = await supabase
      .from("members")
      .update({ status })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error(`[AdminMembers] ${action} failed:`, error.message);
      return NextResponse.json({ error: `Failed to ${action} member.` }, { status: 500 });
    }
    console.log(`[AdminMembers] ${auth.email} ${action}d ${id}`);
    return NextResponse.json({ success: true, member: rowToMember(data as MemberRow) });
  }

  // Hard delete is deliberately separate from archive: archiving is the normal
  // way to remove someone from the site and keeps the record.
  if (action === "delete") {
    const { error } = await supabase.from("members").delete().eq("id", id);
    if (error) {
      console.error("[AdminMembers] delete failed:", error.message);
      return NextResponse.json({ error: "Failed to delete member." }, { status: 500 });
    }
    console.log(`[AdminMembers] ${auth.email} DELETED ${id}`);
    return NextResponse.json({ success: true, deleted: id });
  }

  return NextResponse.json({ error: `Unknown action "${action}".` }, { status: 400 });
}
