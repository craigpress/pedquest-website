// Tell the editors that a recording is waiting for review, and tell an author
// what a reviewer decided. Same transport as src/lib/qbank/notify.ts: no-ops
// unless RESEND_API_KEY / DISCORD_WEBHOOK_* are configured.
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendDiscordNotification, sendEmail } from "@/lib/notifications";
import { editorEmails } from "@/lib/qbank/notify";
import type { LabReviewDecision } from "./types";

export interface PendingRecordingNotice {
  jobId: string;
  recordingId: string | null;
  title: string;
  qbankId: string | null;
  authorEmail: string | null;
}

/** One digest per call. Returns how many recipients were addressed. */
export async function notifyEditorsOfPendingRecordings(
  supabase: SupabaseClient,
  items: PendingRecordingNotice[],
  context: { origin?: string; source: string },
): Promise<number> {
  if (items.length === 0) return 0;
  const recipients = await editorEmails(supabase);
  const base = context.origin?.replace(/\/$/, "") ?? "https://pedquest.org";

  const lines = items.map(
    (i) => `- ${i.recordingId ?? i.jobId.slice(0, 8)}${i.qbankId ? ` (${i.qbankId})` : ""} — ${i.title}` +
      `${i.authorEmail ? ` · by ${i.authorEmail}` : " · AI generated"}\n  ${base}/admin/eeg-lab/library/${i.jobId}`,
  );
  const body = [
    `${items.length} EEG Library recording(s) need editor review (${context.source}).`,
    "",
    ...lines,
    "",
    "A recording is held until an editor who is not its author reviews it.",
    "Open it in the viewer, check the record against its title and description,",
    "then approve, request changes or reject on the recording page.",
    "",
    `Queue: ${base}/admin/eeg-lab/review`,
  ].join("\n");

  await sendDiscordNotification({
    channel: "site",
    title: `EEG Library: ${items.length} recording(s) awaiting review`,
    color: 0x2ed6c6,
    fields: items.slice(0, 10).map((i) => ({
      name: i.recordingId ?? i.jobId.slice(0, 8),
      value: `${i.title}${i.qbankId ? `\n${i.qbankId}` : ""}`,
    })),
    footer: `PedQuEST · ${context.source}`,
  });

  for (const to of recipients) {
    await sendEmail({
      to,
      subject: `PedQuEST EEG Library: ${items.length} recording(s) awaiting review`,
      text: body,
    });
  }
  return recipients.length;
}

const DECISION_TEXT: Record<LabReviewDecision, string> = {
  approved: "was approved and is now in the EEG Library",
  changes_requested: "needs changes before it can be published",
  rejected: "was rejected and archived",
};

/** The author hears the decision and the reviewer's note. */
export async function notifyAuthorOfDecision(
  to: string,
  item: { jobId: string; recordingId: string | null; title: string; decision: LabReviewDecision; notes: string | null },
  context: { origin?: string },
): Promise<void> {
  const base = context.origin?.replace(/\/$/, "") ?? "https://pedquest.org";
  const name = item.recordingId ?? item.jobId.slice(0, 8);
  await sendEmail({
    to,
    subject: `PedQuEST EEG Library: ${name} ${item.decision.replace("_", " ")}`,
    text: [
      `Your recording ${name} — ${item.title} — ${DECISION_TEXT[item.decision]}.`,
      "",
      item.notes ? `Reviewer's note:\n${item.notes}` : "The reviewer left no note.",
      "",
      `${base}/admin/eeg-lab/library/${item.jobId}`,
    ].join("\n"),
  });
}
