import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { isRateLimited, getClientIp } from "@/lib/rate-limit";
import { isValidEmail, checkHoneypot, checkOrigin, truncate } from "@/lib/validation";
import { sendDiscordNotification, sendTelegramNotification } from "@/lib/notifications";

export async function POST(request: NextRequest) {
  const originCheck = checkOrigin(request);
  if (originCheck) return originCheck;

  const ip = getClientIp(request);

  if (isRateLimited(ip, "contact", 3)) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    );
  }

  let body: Record<string, string>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 }
    );
  }

  const { name, email, subject, message, honeypot } = body;

  const honeypotResponse = checkHoneypot(honeypot);
  if (honeypotResponse) return honeypotResponse;

  if (!name?.trim() || !email?.trim() || !subject?.trim() || !message?.trim()) {
    return NextResponse.json(
      { error: "All fields are required." },
      { status: 400 }
    );
  }

  if (!isValidEmail(email)) {
    return NextResponse.json(
      { error: "Please provide a valid email address." },
      { status: 400 }
    );
  }

  const safeName = truncate(name.trim(), 200);
  const safeEmail = truncate(email.trim(), 254);
  const safeSubject = truncate(subject.trim(), 300);
  const safeMessage = truncate(message.trim(), 5000);

  // Store in Supabase
  const supabase = createServerClient();
  if (supabase) {
    const { error } = await supabase.from("contact_messages").insert({
      name: safeName,
      email: safeEmail,
      subject: safeSubject,
      message: safeMessage,
      ip_address: ip,
    });
    if (error) {
      console.error("[Contact] Supabase insert failed:", error.message);
      return NextResponse.json(
        { error: "Submission failed. Please try again later." },
        { status: 500 }
      );
    }
  }

  // Send notifications (non-blocking)
  sendDiscordNotification({
    title: `📬 New Contact: ${safeSubject}`,
    color: 0xd4603a,
    fields: [
      { name: "Name", value: safeName, inline: true },
      { name: "Email", value: safeEmail, inline: true },
      { name: "Message", value: safeMessage },
    ],
    footer: "PedQuEST Contact Form",
  });

  sendTelegramNotification(
    `📬 New PedQuEST Contact\n\nFrom: ${safeName}\nEmail: ${safeEmail}\nSubject: ${safeSubject}\n\n${safeMessage}`
  );

  console.log(`[Contact] ${safeName} <${safeEmail}> — ${safeSubject}`);

  return NextResponse.json({ success: true });
}
