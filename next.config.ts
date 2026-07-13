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
  async headers() {
    // Baseline security headers for all routes. (A tuned Content-Security-Policy
    // is intentionally deferred — it needs allowances for Supabase, Leaflet tiles,
    // Vercel Analytics, and Next's inline hydration/style, so it warrants its own
    // change to avoid breaking the app.)
    const securityHeaders = [
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
    ];
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
