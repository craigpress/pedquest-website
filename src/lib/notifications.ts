function escapeTelegramMarkdown(text: string): string {
  return text.replace(/([_*[\]()~`>#+=|{}.!-])/g, "\\$1");
}

export async function sendDiscordNotification(opts: {
  title: string;
  color: number;
  fields: { name: string; value: string; inline?: boolean }[];
  footer?: string;
}): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [
          {
            title: opts.title,
            color: opts.color,
            fields: opts.fields.map((f) => ({
              name: f.name,
              value: f.value.slice(0, 1024),
              inline: f.inline ?? false,
            })),
            timestamp: new Date().toISOString(),
            footer: { text: opts.footer || "PedQuEST" },
          },
        ],
      }),
    });
  } catch (e) {
    console.log("Discord webhook failed:", e);
  }
}

/** Transactional email via Resend. No-op unless RESEND_API_KEY is set, so the
 *  caller can always fire it and fall back to showing the content on screen. */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  /** Resend takes attachment content base64-encoded. */
  attachments?: { filename: string; content: string; contentType?: string }[];
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "PedQuEST <noreply@pedquest.org>",
        to: [opts.to],
        subject: opts.subject,
        text: opts.text,
        // The sending domain may have no inbound MX (a send-only subdomain), in
        // which case replies would bounce — point them at a real mailbox.
        ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}),
        ...(opts.attachments?.length
          ? {
              attachments: opts.attachments.map((a) => ({
                filename: a.filename,
                content: a.content,
                ...(a.contentType ? { content_type: a.contentType } : {}),
              })),
            }
          : {}),
      }),
    });
    if (!res.ok) {
      console.error("[Email] Resend rejected the send:", res.status, await res.text());
    }
  } catch (e) {
    console.error("[Email] send failed:", e);
  }
}

export async function sendTelegramNotification(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    const escaped = escapeTelegramMarkdown(text);
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: escaped,
        parse_mode: "MarkdownV2",
      }),
    });
  } catch (e) {
    console.log("Telegram notification failed:", e);
  }
}
