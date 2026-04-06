import { NextResponse } from "next/server";

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email) && email.length <= 254;
}

export function checkHoneypot(value: string | undefined): NextResponse | null {
  if (value) {
    return NextResponse.json({ success: true });
  }
  return null;
}

export function checkOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  // Allow requests with no origin (server-side, curl, etc.) in development
  if (!origin && !referer) {
    if (process.env.NODE_ENV === "development") return null;
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const allowedHosts = [
    "pedquest.vercel.app",
    "pedquest.org",
    "www.pedquest.org",
    "localhost",
  ];

  const checkUrl = origin || referer || "";
  try {
    const hostname = new URL(checkUrl).hostname;
    if (allowedHosts.some((h) => hostname === h || hostname.endsWith(`.${h}`))) {
      return null;
    }
  } catch {
    // Invalid URL
  }

  return NextResponse.json({ error: "Forbidden." }, { status: 403 });
}

export function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}
