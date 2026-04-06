import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { isRateLimited, getClientIp } from "@/lib/rate-limit";
import { isValidEmail, checkHoneypot, checkOrigin, truncate } from "@/lib/validation";

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
      ip_address: ip,
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
    console.log(`Company: ${companyName} | Contact: ${contactEmail} | IP: ${ip}`);
  }

  return NextResponse.json({ success: true });
}
