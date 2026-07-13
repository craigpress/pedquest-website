import type { MetadataRoute } from "next";

const SITE_URL = "https://pedquest.org";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Keep private / non-content routes out of the index.
      disallow: ["/admin", "/profile", "/login", "/auth", "/api"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
