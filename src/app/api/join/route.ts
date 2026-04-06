import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { isRateLimited, getClientIp } from "@/lib/rate-limit";
import { isValidEmail, checkHoneypot, checkOrigin, truncate } from "@/lib/validation";

export async function POST(request: NextRequest) {
  const originCheck = checkOrigin(request);
  if (originCheck) return originCheck;

  const ip = getClientIp(request);

  if (isRateLimited(ip, "join", 5)) {
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

  const honeypotResponse = checkHoneypot(honeypot);
  if (honeypotResponse) return honeypotResponse;

  if (!hospital?.trim() || !piEmail?.trim() || !piPhone?.trim()) {
    return NextResponse.json(
      { error: "Hospital, PI email, and PI phone are required." },
      { status: 400 }
    );
  }

  if (!isValidEmail(piEmail)) {
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
      hospital: truncate(hospital.trim(), 300),
      affiliated_university: affiliatedUniversity?.trim() ? truncate(affiliatedUniversity.trim(), 300) : null,
      pi_name: piName?.trim() ? truncate(piName.trim(), 200) : null,
      pi_email: truncate(piEmail.trim(), 254),
      pi_phone: truncate(piPhone.trim(), 30),
      role_title: roleTitle?.trim() ? truncate(roleTitle.trim(), 200) : null,
      research_interests: researchInterests?.trim() ? truncate(researchInterests.trim(), 2000) : null,
      how_heard: howHeard?.trim() ? truncate(howHeard.trim(), 500) : null,
      statement_of_interest: statementOfInterest?.trim() ? truncate(statementOfInterest.trim(), 5000) : null,
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
