import { notFound, redirect } from "next/navigation";
import { getEventBySlug } from "@/lib/events-server";

// Permalink for one event: /events/mnm-lecture-4 → /events#mnm-lecture-4.
// Per request so a newly published event resolves without a redeploy.
export const dynamic = "force-dynamic";

export default async function EventPermalink({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ev = await getEventBySlug(slug);
  if (!ev || ev.status !== "published") notFound();
  redirect(`/events#${slug}`);
}
