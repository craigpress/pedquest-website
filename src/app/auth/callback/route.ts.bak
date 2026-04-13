import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (code) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

    if (!supabaseUrl || !supabaseAnonKey) {
      console.error("[Auth Callback] Supabase not configured");
      return NextResponse.redirect(new URL("/login?error=config", request.url));
    }

    try {
      const supabase = createClient(supabaseUrl, supabaseAnonKey);
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        console.error("[Auth Callback] Code exchange failed:", error.message);
        return NextResponse.redirect(new URL("/login?error=callback", request.url));
      }
    } catch (e) {
      console.error("[Auth Callback] Unexpected error:", e);
      return NextResponse.redirect(new URL("/login?error=callback", request.url));
    }
  } else {
    return NextResponse.redirect(new URL("/login?error=nocode", request.url));
  }

  return NextResponse.redirect(new URL("/profile", request.url));
}
