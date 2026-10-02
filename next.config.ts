import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
    // Local sources: any path without a query, plus question-bank PNGs with a
    // `?v=<content hash>` cache key (src/lib/image-version.ts). Next caps
    // localPatterns at 25 entries, so the qbank query cannot be pinned to the
    // exact hashes; the pattern is limited to that folder's PNGs instead.
    localPatterns: [
      { pathname: "/**", search: "" },
      { pathname: "/images/qbank/*.png" },
    ],
    // 60: small card thumbnails; 75: default; 85: full EEG figures (thin traces).
    qualities: [60, 75, 85],
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
    // The lab's prose mode reads IMAGE_SPEC.md at request time for the same reason.
    "/api/admin/lab/jobs": ["./content/qbank/**/*"],
    // The review route's `revise` action reads it too.
    "/api/admin/lab/jobs/[id]/review": ["./content/qbank/**/*"],
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
    // The lab viewer loads signed recordings straight from the homelab store
    // (EEG_LAB_BASE_URL), so its origin must be allowed when CSP is enforced.
    let eeglabOrigin = "";
    try {
      const base = (process.env.EEG_LAB_BASE_URL ?? "").trim();
      if (base) eeglabOrigin = new URL(base).origin;
    } catch { /* malformed URL: leave it out */ }
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
      `img-src 'self' data: blob: https://*.supabase.co https://*.tile.openstreetmap.org${eeglabOrigin ? ` ${eeglabOrigin}` : ""}`,
      "font-src 'self' data:",
      // Supabase REST/realtime, Vercel Analytics beacons, Authentik sign-in,
      // and the homelab recording store.
      `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.vercel-insights.com https://va.vercel-scripts.com https://auth.presshome.net${eeglabOrigin ? ` ${eeglabOrigin}` : ""}`,
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
    return [
      { source: "/:path*", headers: securityHeaders },
      // A versioned bank PNG never changes (a re-render gets a new hash), so the
      // browser, the CDN and the image optimizer — whose TTL follows the
      // upstream max-age — may keep it for a year. Unversioned requests keep the
      // default revalidating headers.
      {
        source: "/images/qbank/:file*",
        has: [{ type: "query", key: "v" }],
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
