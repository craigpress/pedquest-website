import type { MetadataRoute } from "next";

const SITE_URL = "https://pedquest.org";

// Public, indexable content routes.
const routes: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "", priority: 1.0, changeFrequency: "weekly" },
  { path: "/about", priority: 0.8, changeFrequency: "monthly" },
  { path: "/members", priority: 0.8, changeFrequency: "weekly" },
  { path: "/publications", priority: 0.8, changeFrequency: "weekly" },
  { path: "/education", priority: 0.7, changeFrequency: "monthly" },
  { path: "/events", priority: 0.7, changeFrequency: "weekly" },
  { path: "/contact", priority: 0.4, changeFrequency: "yearly" },
  { path: "/join", priority: 0.5, changeFrequency: "yearly" },
  { path: "/sponsor", priority: 0.4, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((r) => ({
    url: `${SITE_URL}${r.path}`,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
