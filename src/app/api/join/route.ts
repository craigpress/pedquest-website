import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// In-memory rate limiting (resets on server restart)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

const RATE_LIMIT_MAX = 5;
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
    hospital,
    affiliatedUniversity,
    piName,
    piEmail,
    piPhone,
    roleTitle,
    researchInterests,
    howHeard,
    statementOfInterest,
    agreeToTerms,
    honeypot,
  } = body;

  // Honeypot — silently accept to not tip off bots
  if (honeypot) {
    return NextResponse.json({ success: true });
  }

  // Validate required fields
  if (!hospital?.trim() || !piEmail?.trim() || !piPhone?.trim()) {
    return NextResponse.json(
      { error: "Hospital, PI email, and PI phone are required." },
      { status: 400 }
    );
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(piEmail)) {
    return NextResponse.json(
      { error: "Please provide a valid PI email address." },
      { status: 400 }
    );
  }

  if (agreeToTerms !== "true") {
    return NextResponse.json(
      { error: "You must agree to the consortium terms to proceed." },
      { status: 400 }
    );
  }

  // Store in Supabase
  const supabase = createServerClient();
  if (supabase) {
    const { error } = await supabase.from("membership_applications").insert({
      hospital: hospital.trim(),
      affiliated_university: affiliatedUniversity?.trim() || null,
      pi_name: piName?.trim() || null,
      pi_email: piEmail.trim(),
      pi_phone: piPhone.trim(),
      role_title: roleTitle?.trim() || null,
      research_interests: researchInterests?.trim() || null,
      how_heard: howHeard?.trim() || null,
      statement_of_interest: statementOfInterest?.trim() || null,
      ip_address: ip,
    });
    if (error) {
      console.error("[Join] Supabase insert failed:", error.message);
      return NextResponse.json(
        { error: "Submission failed. Please try again later." },
        { status: 500 }
      );
    }
  } else {
    console.log("[Join] Supabase not configured — logging submission only");
    console.log(`Hospital: ${hospital} | PI: ${piEmail} | IP: ${ip}`);
  }

  return NextResponse.json({ success: true });
}
