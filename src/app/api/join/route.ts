import { NextRequest, NextResponse } from "next/server";

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

  // Log submission (backend/email integration can be added here)
  console.log("=== New PedQuEST Membership Application ===");
  console.log(`Hospital:              ${hospital}`);
  console.log(`Affiliated University: ${affiliatedUniversity || "(none)"}`);
  console.log(`Site PI Name:          ${piName || "(none)"}`);
  console.log(`Site PI Email:         ${piEmail}`);
  console.log(`Site PI Phone:         ${piPhone}`);
  console.log(`Role/Title:            ${roleTitle || "(none)"}`);
  console.log(`Research Interests:    ${researchInterests || "(none)"}`);
  console.log(`How Heard:             ${howHeard || "(none)"}`);
  console.log(`Statement of Interest: ${statementOfInterest || "(none)"}`);
  console.log(`IP:                    ${ip}`);
  console.log(`Time:                  ${new Date().toISOString()}`);
  console.log("===========================================");

  return NextResponse.json({ success: true });
}
