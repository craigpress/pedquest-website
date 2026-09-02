import type { Metadata } from "next";
import EventsView from "@/components/EventsView";
import { getPublicEvents } from "@/lib/events-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Events — PedQuEST",
  description:
    "The PNCRG Multimodal Neuromonitoring lecture series: Advancing and Integrating EEG Monitoring into Pediatric Neurocritical Care. Register by email to get the Zoom link.",
};

export default async function EventsPage() {
  const events = await getPublicEvents();
  return <EventsView events={events} />;
}
