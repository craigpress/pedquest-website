import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { isRateLimited, getClientIp } from "@/lib/rate-limit";
import { isValidEmail, checkHoneypot, checkOrigin, truncate } from "@/lib/validation";
import { sendDiscordNotification, sendTelegramNotification } from "@/lib/notifications";

export async function POST(request: NextRequest) {
  const originCheck = checkOrigin(request);
  if (originCheck) return originCheck;

  const ip = getClientIp(request);

  if (isRateLimited(ip, "sponsor", 3)) {
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

  const {
    companyName,
    contactName,
    contactEmail,
    phone,
    website,
    tier,
    areas,
    description,
    budgetRange,
    howHeard,
    honeypot,
  } = body;

  const honeypotResponse = checkHoneypot(honeypot);
  if (honeypotResponse) return honeypotResponse;

  if (!companyName?.trim() || !contactName?.trim() || !contactEmail?.trim()) {
    return NextResponse.json(
      { error: "Company name, contact name, and contact email are required." },
      { status: 400 }
    );
  }

  if (!isValidEmail(contactEmail)) {
    return NextResponse.json(
      { error: "Please provide a valid email address." },
      { status: 400 }
    );
  }

  // Store in Supabase
  const supabase = createServerClient();
  if (supabase) {
    const { error } = await supabase.from("sponsor_inquiries").insert({
      company_name: truncate(companyName.trim(), 300),
      contact_name: truncate(contactName.trim(), 200),
      contact_email: truncate(contactEmail.trim(), 254),
      contact_phone: phone?.trim() ? truncate(phone.trim(), 30) : null,
      website: website?.trim() ? truncate(website.trim(), 500) : null,
      sponsorship_tier: tier?.trim() ? truncate(tier.trim(), 100) : null,
      areas_of_interest: areas?.trim() ? truncate(areas.trim(), 1000) : null,
      collaboration_description: description?.trim() ? truncate(description.trim(), 5000) : null,
      budget_range: budgetRange?.trim() ? truncate(budgetRange.trim(), 100) : null,
      how_heard: howHeard?.trim() ? truncate(howHeard.trim(), 500) : null,
    });
    if (error) {
      console.error("[Sponsor] Supabase insert failed:", error.message);
      return NextResponse.json(
        { error: "Submission failed. Please try again later." },
        { status: 500 }
      );
    }
  } else {
    console.log("[Sponsor] Supabase not configured — logging submission only");
    console.log(`Company: ${companyName} | Contact: ${contactEmail}`);
  }

  // Must be awaited: on Vercel the function can be frozen as soon as the
  // response is sent, dropping any in-flight fetch and silently losing the
  // notification. allSettled so one failing webhook can't stop the other.
  const safeCompany = truncate(companyName.trim(), 300);
  const safeContact = truncate(contactName.trim(), 200);
  const safeContactEmail = truncate(contactEmail.trim(), 254);

  await Promise.allSettled([
    sendDiscordNotification({
      title: `🤝 Sponsor enquiry: ${safeCompany}`,
      channel: "site",
      color: 0x3ecb8e,
      fields: [
        { name: "Contact", value: safeContact, inline: true },
        { name: "Email", value: safeContactEmail, inline: true },
        { name: "Tier", value: tier?.trim() ? truncate(tier.trim(), 100) : "—", inline: true },
        { name: "Budget", value: budgetRange?.trim() ? truncate(budgetRange.trim(), 100) : "—", inline: true },
        { name: "Website", value: website?.trim() ? truncate(website.trim(), 500) : "—", inline: true },
        { name: "Areas of interest", value: areas?.trim() ? truncate(areas.trim(), 1000) : "—" },
        { name: "Description", value: description?.trim() ? truncate(description.trim(), 1000) : "—" },
      ],
      footer: "PedQuEST Sponsor Enquiry",
    }),
    sendTelegramNotification(
      `🤝 New PedQuEST sponsor enquiry\n\nCompany: ${safeCompany}\nContact: ${safeContact}\nEmail: ${safeContactEmail}`
    ),
  ]);

  console.log(`[Sponsor] ${safeCompany} — ${safeContactEmail}`);

  return NextResponse.json({ success: true });
}
