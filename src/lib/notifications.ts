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
