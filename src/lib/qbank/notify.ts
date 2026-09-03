// Tell the editors that something is waiting for review.
//
// Goes through the existing helpers in src/lib/notifications.ts, which are
// no-ops unless RESEND_API_KEY / DISCORD_WEBHOOK_* are configured — so calling
// this on a machine without those credentials sends nothing.
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendDiscordNotification, sendEmail } from "@/lib/notifications";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PendingItemNotice {
  qbankId: string;
  title: string;
  domain: string | null;
  caseId: string;
  caseStatus: string;
}

async function editorEmails(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("email,role")
    .in("role", ["editor", "admin"]);
  if (error || !data) return [];
  return (data as any[]).map((r) => String(r.email)).filter(Boolean);
}

/**
 * One digest per run rather than one message per item — 3 drafts a week should
 * not be 3 emails. Returns how many recipients were addressed.
 */
export async function notifyEditorsOfPendingItems(
  supabase: SupabaseClient,
  items: PendingItemNotice[],
  context: { origin?: string; source: string },
): Promise<number> {
  if (items.length === 0) return 0;
  const recipients = await editorEmails(supabase);
  const base = context.origin?.replace(/\/$/, "") ?? "https://pedquest.org";

  const lines = items.map(
    (i) => `- ${i.qbankId} (${i.domain ?? "no domain"}) — ${i.title} [${i.caseStatus}]\n  ${base}/admin/qbank/${i.caseId}`,
  );
  const body = [
    `${items.length} question-bank item(s) need editor review (${context.source}).`,
    "",
    ...lines,
    "",
    "Every item is held until an editor approves it. Approval requires an image",
    "license, at least one verified reference, and a reviewer who is not the author.",
    "",
    `Queue: ${base}/admin/qbank`,
  ].join("\n");

  await sendDiscordNotification({
    channel: "site",
    title: `qEEG question bank: ${items.length} item(s) awaiting review`,
    color: 0x2ed6c6,
    fields: items.slice(0, 10).map((i) => ({
      name: i.qbankId,
      value: `${i.title}\n${i.domain ?? "no domain"} · ${i.caseStatus}`,
    })),
    footer: `PedQuEST · ${context.source}`,
  });

  for (const to of recipients) {
    await sendEmail({
      to,
      subject: `PedQuEST question bank: ${items.length} item(s) awaiting review`,
      text: body,
    });
  }
  return recipients.length;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
