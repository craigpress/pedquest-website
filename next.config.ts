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
};

export default nextConfig;
