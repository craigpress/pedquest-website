import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { isRateLimited, getClientIp } from "@/lib/rate-limit";
import { isValidEmail, checkHoneypot, checkOrigin, truncate } from "@/lib/validation";
import { sendDiscordNotification, sendTelegramNotification, sendEmail } from "@/lib/notifications";
import { members } from "@/data/members";

/** Individual affiliate signup — the non-institutional half of /join.
 *  The institutional track is /api/join. */
export async function POST(request: NextRequest) {
  const originCheck = checkOrigin(request);
  if (originCheck) return originCheck;

  // IP is used for rate limiting only and is never stored (see /privacy).
  const ip = getClientIp(request);
  if (isRateLimited(ip, "join-individual", 5)) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429 }
    );
  }

  let body: Record<string, string | boolean>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const honeypotResponse = checkHoneypot(body.honeypot as string | undefined);
  if (honeypotResponse) return honeypotResponse;

  const name = (body.name as string | undefined)?.trim() ?? "";
  const email = (body.email as string | undefined)?.trim() ?? "";
  const institution = (body.institution as string | undefined)?.trim() ?? "";
  const country = (body.country as string | undefined)?.trim() ?? "";
  const roleTitle = (body.roleTitle as string | undefined)?.trim() ?? "";
  const interests = (body.interests as string | undefined)?.trim() ?? "";
  const consentEmail = body.consentEmail === true;

  if (!name) {
    return NextResponse.json({ error: "Your name is required." }, { status: 400 });
  }
  if (!email) {
    return NextResponse.json({ error: "Email is required." }, { status: 400 });
  }
  if (!isValidEmail(email)) {
    return NextResponse.json(
      { error: "Please provide a valid email address." },
      { status: 400 }
    );
  }
  if (!consentEmail) {
    return NextResponse.json(
      { error: "Please confirm you'd like to receive PedQuEST email." },
      { status: 400 }
    );
  }

  const safeEmail = truncate(email.toLowerCase(), 254);

  // Does this email already belong to someone in the member registry? If so we
  // still record the signup, but the UI points them at sign-in instead of
  // creating a second identity for the same person.
  const existing = members.find(
    (m) =>
      m.email?.toLowerCase() === safeEmail || m.authEmail?.toLowerCase() === safeEmail
  );

  const row = {
    name: truncate(name, 200),
    email: safeEmail,
    institution: institution ? truncate(institution, 300) : null,
    country: country ? truncate(country, 100) : null,
    role_title: roleTitle ? truncate(roleTitle, 200) : null,
    interests: interests ? truncate(interests, 2000) : null,
    matched_member_id: existing?.id ?? null,
    consent_email: true,
    consent_at: new Date().toISOString(),
  };

  const supabase = createServerClient();
  if (supabase) {
    // A repeat signup is a person updating their details, not an error.
    const { error } = await supabase
      .from("individual_signups")
      .upsert(row, { onConflict: "email" });
    if (error) {
      console.error("[JoinIndividual] Supabase upsert failed:", error.message);
      return NextResponse.json(
        { error: "Submission failed. Please try again later." },
        { status: 500 }
      );
    }
  } else {
    console.log("[JoinIndividual] Supabase not configured — logging submission only");
    console.log(`Name: ${row.name} | Institution: ${row.institution ?? "—"}`);
  }

  const adminFields = [
    { name: "Email", value: row.email, inline: true },
    { name: "Institution", value: row.institution ?? "—", inline: true },
    { name: "Country", value: row.country ?? "—", inline: true },
    { name: "Role", value: row.role_title ?? "—", inline: true },
    { name: "Interests", value: row.interests ?? "—" },
    ...(existing
      ? [{ name: "⚠ Already a member", value: `${existing.name} (${existing.id})` }]
      : []),
  ];

  const adminText = [
    "New individual signup",
    `Name: ${row.name}`,
    ...adminFields.map((f) => `${f.name}: ${f.value}`),
  ].join("\n");

  await Promise.all([
    sendDiscordNotification({
      title: `✉️ New individual signup: ${row.name}`,
      color: 0x2ed6c6,
      fields: adminFields,
    }),
    sendTelegramNotification(adminText),
    sendEmail({
      to: row.email,
      subject: "You're on the PedQuEST list",
      text: [
        `Hi ${row.name},`,
        "",
        "Thanks for signing up. You'll get invitations to PedQuEST meetings and education sessions, plus occasional consortium news. Nothing else — we don't share your address with anyone.",
        "",
        existing
          ? "You're also already listed as a PedQuEST member. You can sign in at https://pedquest.org/login to update your bio, interests, and CV."
          : "If your centre later wants to join as a member site and contribute qEEG data, the application is at https://pedquest.org/join/site.",
        "",
        "To be removed from the list at any time, just reply to this email, or use the form at https://pedquest.org/contact.",
        "",
        "— PedQuEST",
        "Pediatric Quantitative EEG Strategic Taskforce",
      ].join("\n"),
    }),
  ]);

  return NextResponse.json({
    success: true,
    existingMember: existing ? { id: existing.id, name: existing.name } : null,
  });
}
