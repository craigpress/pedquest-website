import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { isRateLimited, getClientIp } from "@/lib/rate-limit";
import { isValidEmail, checkHoneypot, checkOrigin, truncate } from "@/lib/validation";
import { sendDiscordNotification, sendTelegramNotification, sendEmail } from "@/lib/notifications";
import { getEventBySlug } from "@/lib/events-server";
import { fmtEventDate, fmtEventTimeRange } from "@/lib/events";
import { buildEventIcs } from "@/lib/ics";

export async function POST(request: NextRequest) {
  const originCheck = checkOrigin(request);
  if (originCheck) return originCheck;

  const ip = getClientIp(request);

  if (isRateLimited(ip, "event-register", 10)) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    );
  }

  let body: Record<string, string>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { slug, email, name, institution, honeypot } = body;

  const honeypotResponse = checkHoneypot(honeypot);
  if (honeypotResponse) return honeypotResponse;

  const event = slug ? await getEventBySlug(slug) : null;
  if (!event || event.status !== "published" || event.registration !== "email") {
    return NextResponse.json({ error: "Registration is not open for this event." }, { status: 404 });
  }
  if (!event.joinUrl) {
    return NextResponse.json(
      { error: "The join link for this event hasn't been posted yet. Please check back shortly." },
      { status: 400 }
    );
  }

  if (!email?.trim()) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json(
      { error: "Please provide a valid email address." },
      { status: 400 }
    );
  }

  const safeEmail = truncate(email.trim().toLowerCase(), 254);
  const safeName = name?.trim() ? truncate(name.trim(), 200) : null;
  const safeInstitution = institution?.trim() ? truncate(institution.trim(), 300) : null;

  const supabase = createServerClient();
  if (supabase) {
    const { error } = await supabase.from("event_registrations").insert({
      event_slug: event.slug,
      email: safeEmail,
      name: safeName,
      institution: safeInstitution,
    });
    // A repeat registration is fine — the person just wants the link again.
    if (error && error.code !== "23505") {
      console.error("[EventRegister] Supabase insert failed:", error.message);
      return NextResponse.json(
        { error: "Registration failed. Please try again later." },
        { status: 500 }
      );
    }
  }

  const ics = buildEventIcs(event);

  // These MUST be awaited before responding. On Vercel the function can be
  // frozen the moment the response is sent, which drops any in-flight fetch —
  // fire-and-forget silently lost a registration email in testing. allSettled
  // so a failing webhook can't stop the email (or vice versa).
  const emailPromise = sendEmail({
    to: safeEmail,
    subject: `Your link: ${event.series ? `${event.series} — ` : ""}${event.title}`,
    text: [
      `You're registered for ${event.title}.`,
      "",
      `When: ${fmtEventDate(event.startsAt, event.timezone)}, ${fmtEventTimeRange(event)}`,
      `Where: ${event.location ?? "Virtual"}`,
      "",
      `Join link: ${event.joinUrl}`,
      event.meetingId ? `Meeting ID: ${event.meetingId}` : "",
      event.passcode ? `Passcode: ${event.passcode}` : "",
      "",
      "The attached calendar invite carries the same details, with reminders a",
      "day before and 15 minutes before.",
      "",
      `Hosted by ${event.host}.`,
      "PedQuEST — https://pedquest.org/events",
    ]
      .filter(Boolean)
      .join("\n"),
    attachments: [
      {
        filename: ics.filename,
        content: Buffer.from(ics.content, "utf8").toString("base64"),
        contentType: "text/calendar",
      },
    ],
  });

  const discordPromise = sendDiscordNotification({
    title: `🎟️ Event registration: ${event.title}`,
    color: 0x2ed6c6,
    fields: [
      { name: "Email", value: safeEmail, inline: true },
      { name: "Name", value: safeName ?? "—", inline: true },
      { name: "Institution", value: safeInstitution ?? "—" },
    ],
    footer: `PedQuEST Events · ${event.slug}`,
  });

  const telegramPromise = sendTelegramNotification(
    `🎟️ New registration for ${event.title}\n\n${safeEmail}${safeName ? ` (${safeName})` : ""}${
      safeInstitution ? `\n${safeInstitution}` : ""
    }`
  );

  await Promise.allSettled([emailPromise, discordPromise, telegramPromise]);

  return NextResponse.json({
    success: true,
    access: {
      joinUrl: event.joinUrl,
      meetingId: event.meetingId,
      passcode: event.passcode,
    },
    // Handed back so the success screen can offer the same invite as a
    // download. Deliberately not a public GET route — that would serve the
    // gated join details to anyone who guessed the URL.
    calendar: { filename: ics.filename, content: ics.content },
    emailed: Boolean(process.env.RESEND_API_KEY),
  });
}
