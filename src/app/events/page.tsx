import type { Metadata } from "next";
import EventsView from "@/components/EventsView";
import { getPublicEvents } from "@/lib/events-server";

// cached render, regenerated every 5 min and on admin saves (revalidatePath)
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Events — PedQuEST",
  description:
    "The PNCRG Multimodal Neuromonitoring lecture series: Advancing and Integrating EEG Monitoring into Pediatric Neurocritical Care. Register by email to get the Zoom link.",
};

export default async function EventsPage() {
  const events = await getPublicEvents();
  return <EventsView events={events} />;
}
