// Shared types + helpers for the Events page and its admin CMS.
// Framework-agnostic (safe to import from server routes AND client components).

export type EventFormat = "virtual" | "in_person" | "hybrid";
export type EventRegistration = "email" | "external" | "none";
export type EventStatus = "draft" | "published" | "archived";

export interface EventTalk {
  presenter: string;
  institution?: string;
  title: string;
}

/** What the public page is allowed to see — no join link, no passcode. */
export interface PublicEvent {
  id: string;
  slug: string;
  series: string | null;
  title: string;
  summary: string | null;
  host: string;
  hostUrl: string | null;
  hostLogo: string | null;
  startsAt: string;
  endsAt: string | null;
  timezone: string;
  format: EventFormat;
  location: string | null;
  talks: EventTalk[];
  registration: EventRegistration;
  registrationUrl: string | null;
  registrationNote: string | null;
}

/** Full row, including the gated join details. Server-side only. */
export interface AdminEvent extends PublicEvent {
  joinUrl: string | null;
  meetingId: string | null;
  passcode: string | null;
  status: EventStatus;
  createdAt: string;
}

export const FORMAT_LABELS: Record<EventFormat, string> = {
  virtual: "Virtual",
  in_person: "In person",
  hybrid: "Hybrid",
};

/** The lecture series the Events page is framed around. */
export const lectureSeries = {
  name: "Multimodal Neuromonitoring Lecture Series",
  title: "Advancing and Integrating EEG Monitoring into Pediatric Neurocritical Care",
  description:
    "A four-part virtual lecture series from the PNCRG Multimodal Neuromonitoring (MNM) Subgroup. The series culminates in a hybrid workshop at the Fall 2026 PNCRG meeting in Seattle, with the goal of producing a peer-reviewed consensus publication on practical EEG implementation in pediatric neurocritical care.",
  hostUrl: "https://www.pncrg.org/",
  logo: "/images/events/pncrg-logo.png",
  chairs: [
    { name: "Craig A. Press, MD, PhD", institution: "Children's Hospital of Philadelphia" },
    { name: "Bradley De Souza, MD", institution: "Children's Hospital Los Angeles / USC" },
  ],
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapEventRow(row: any): AdminEvent {
  return {
    id: row.id,
    slug: row.slug,
    series: row.series ?? null,
    title: row.title,
    summary: row.summary ?? null,
    host: row.host,
    hostUrl: row.host_url ?? null,
    hostLogo: row.host_logo ?? null,
    startsAt: row.starts_at,
    endsAt: row.ends_at ?? null,
    timezone: row.timezone ?? "ET",
    format: (row.format ?? "virtual") as EventFormat,
    location: row.location ?? null,
    talks: Array.isArray(row.talks) ? (row.talks as EventTalk[]) : [],
    registration: (row.registration ?? "none") as EventRegistration,
    registrationUrl: row.registration_url ?? null,
    registrationNote: row.registration_note ?? null,
    joinUrl: row.join_url ?? null,
    meetingId: row.meeting_id ?? null,
    passcode: row.passcode ?? null,
    status: (row.status ?? "published") as EventStatus,
    createdAt: row.created_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Strip the gated join details before an event reaches the browser. */
export function toPublicEvent(e: AdminEvent): PublicEvent {
  return {
    id: e.id,
    slug: e.slug,
    series: e.series,
    title: e.title,
    summary: e.summary,
    host: e.host,
    hostUrl: e.hostUrl,
    hostLogo: e.hostLogo,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    timezone: e.timezone,
    format: e.format,
    location: e.location,
    talks: e.talks,
    registration: e.registration,
    registrationUrl: e.registrationUrl,
    registrationNote: e.registrationNote,
  };
}

export function isPastEvent(e: Pick<PublicEvent, "startsAt" | "endsAt">): boolean {
  return new Date(e.endsAt ?? e.startsAt).getTime() < Date.now();
}

/** Render times in the event's own zone, so a Seattle meeting doesn't read as ET. */
const ZONES: Record<string, string> = {
  ET: "America/New_York",
  EST: "America/New_York",
  EDT: "America/New_York",
  CT: "America/Chicago",
  MT: "America/Denver",
  PT: "America/Los_Angeles",
};

function zoneFor(label: string): string {
  return ZONES[label.toUpperCase()] ?? "America/New_York";
}

export const TZ_LABELS = ["ET", "CT", "MT", "PT"];

/** Wall-clock fields of `date` as seen in `tz`, minus its UTC value. */
function zoneOffsetMs(tz: string, date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - date.getTime();
}

/** `<input type="datetime-local">` value (e.g. "2026-09-03T14:00") read as a
 *  wall-clock time in `tzLabel` → absolute ISO string. Two passes so a value
 *  that straddles a DST change lands on the right offset. */
export function localInputToIso(local: string, tzLabel: string): string {
  if (!local) return "";
  const tz = zoneFor(tzLabel);
  const naive = Date.parse(`${local.length === 16 ? `${local}:00` : local}Z`);
  if (Number.isNaN(naive)) return "";
  let ts = naive - zoneOffsetMs(tz, new Date(naive));
  ts = naive - zoneOffsetMs(tz, new Date(ts));
  return new Date(ts).toISOString();
}

/** Absolute ISO → `<input type="datetime-local">` value in `tzLabel`. */
export function isoToLocalInput(iso: string | null, tzLabel: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: zoneFor(tzLabel),
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .formatToParts(d)
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
  return `${p.year}-${p.month}-${p.day}T${String(Number(p.hour) % 24).padStart(2, "0")}:${p.minute}`;
}

export function fmtEventDate(iso: string, tzLabel = "ET"): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: zoneFor(tzLabel),
  });
}

export function fmtEventTimeRange(
  e: Pick<PublicEvent, "startsAt" | "endsAt" | "timezone">
): string {
  const opts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    timeZone: zoneFor(e.timezone),
  };
  const start = new Date(e.startsAt).toLocaleTimeString("en-US", opts);
  if (!e.endsAt) return `${start} ${e.timezone}`;
  const end = new Date(e.endsAt).toLocaleTimeString("en-US", opts);
  return `${start} – ${end} ${e.timezone}`;
}
