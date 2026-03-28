import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// In-memory rate limiting (resets on server restart)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return true;
  }

  entry.count++;
  return false;
}

export async function POST(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";

  if (isRateLimited(ip)) {
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

  // Honeypot — silently accept to not tip off bots
  if (honeypot) {
    return NextResponse.json({ success: true });
  }

  // Validate required fields
  if (!companyName?.trim() || !contactName?.trim() || !contactEmail?.trim()) {
    return NextResponse.json(
      { error: "Company name, contact name, and contact email are required." },
      { status: 400 }
    );
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(contactEmail)) {
    return NextResponse.json(
      { error: "Please provide a valid email address." },
      { status: 400 }
    );
  }

  // Store in Supabase
  const supabase = createServerClient();
  if (supabase) {
    const { error } = await supabase.from("sponsor_inquiries").insert({
      company_name: companyName.trim(),
      contact_name: contactName.trim(),
      contact_email: contactEmail.trim(),
      contact_phone: phone?.trim() || null,
      website: website?.trim() || null,
      sponsorship_tier: tier?.trim() || null,
      areas_of_interest: areas?.trim() || null,
      collaboration_description: description?.trim() || null,
      budget_range: budgetRange?.trim() || null,
      how_heard: howHeard?.trim() || null,
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
