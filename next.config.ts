import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
  experimental: {
    // Limit dev server workers to prevent OOM on Windows (default = CPU count)
    cpus: 4,
  },
  // The question-bank generator reads its blueprint, style guide and exemplar
  // from content/qbank at request time. Those are plain files, not imports, so
  // Next's tracer cannot see them — include them explicitly or the cron route
  // finds nothing in the Vercel bundle.
  outputFileTracingIncludes: {
    "/api/cron/qbank-generate": ["./content/qbank/**/*"],
  },
  async headers() {
    // Content-Security-Policy. Ships as Report-Only first: violations show up in
    // the browser console without breaking the page, so the allowances below can
    // be tuned against real traffic before it is enforced. Flip
    // CSP_ENFORCE=1 in the Vercel env to switch it to the enforcing header.
    //
    // 'unsafe-inline' on script-src is required by Next's inline hydration
    // bootstrap unless a per-request nonce is added via middleware; style-src
    // needs it for styled-jsx and Next's inlined critical CSS.
    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'self'",
      "form-action 'self'",
      // Vercel Analytics loads its collector script from va.vercel-scripts.com.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://va.vercel-scripts.com",
      "style-src 'self' 'unsafe-inline'",
      // Supabase storage (case/member images) + OpenStreetMap tiles for MemberMap.
      "img-src 'self' data: blob: https://*.supabase.co https://*.tile.openstreetmap.org",
      "font-src 'self' data:",
      // Supabase REST/realtime, Vercel Analytics beacons, Authentik sign-in.
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.vercel-insights.com https://va.vercel-scripts.com https://auth.presshome.net",
      // Ignored by browsers in a report-only policy, so only emit it when enforcing.
      ...(process.env.CSP_ENFORCE === "1" ? ["upgrade-insecure-requests"] : []),
    ].join("; ");

    const securityHeaders = [
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
      {
        key: process.env.CSP_ENFORCE === "1"
          ? "Content-Security-Policy"
          : "Content-Security-Policy-Report-Only",
        value: csp,
      },
    ];
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
