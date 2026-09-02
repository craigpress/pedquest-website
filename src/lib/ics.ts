// iCalendar (RFC 5545) generation for event registrations.
//
// Two rules break ICS files in practice and both are handled here: text values
// must escape \ ; , and newlines, and content lines must be folded at 75
// OCTETS (not characters). Outlook in particular rejects unfolded long lines,
// and a join URL inside DESCRIPTION always exceeds the limit.
//
// Server-side only — uses Buffer for the octet-accurate fold.
import type { AdminEvent } from "@/lib/events";

/** Escape a text value: RFC 5545 §3.3.11. */
function esc(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fold one content line at 75 octets, continuations prefixed with a space. */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const parts: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    // Continuation lines carry a leading space, so they hold one octet less.
    const limit = parts.length === 0 ? 75 : 74;
    let end = Math.min(start + limit, bytes.length);
    // Never split inside a multi-byte character.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
  }
  return parts.join("\r\n ");
}

/** ISO timestamp -> UTC basic format, e.g. 20260903T180000Z. */
function toIcsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export interface IcsResult {
  filename: string;
  /** Full text, CRLF-terminated per spec. */
  content: string;
}

/** A single-event calendar for `event`, including the gated join details.
 *  `reminderMinutes` adds one VALARM per entry, soonest listed last. */
export function buildEventIcs(
  event: AdminEvent,
  reminderMinutes: number[] = [1440, 15]
): IcsResult {
  const start = toIcsUtc(event.startsAt);
  // Default to a two-hour block when no end time is recorded.
  const end = toIcsUtc(
    event.endsAt ?? new Date(new Date(event.startsAt).getTime() + 2 * 60 * 60 * 1000).toISOString()
  );

  const descriptionParts = [
    event.summary ?? "",
    "",
    event.joinUrl ? `Join: ${event.joinUrl}` : "",
    event.meetingId ? `Meeting ID: ${event.meetingId}` : "",
    event.passcode ? `Passcode: ${event.passcode}` : "",
    "",
    event.talks.length ? "Featured presentations:" : "",
    ...event.talks.map(
      (t, i) => `${i + 1}. ${t.title} — ${t.presenter}${t.institution ? ` (${t.institution})` : ""}`
    ),
    "",
    `Hosted by ${event.host}.`,
    "https://pedquest.org/events",
  ].filter((line, i, arr) => !(line === "" && arr[i - 1] === ""));

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PedQuEST//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    // Stable per event, so re-registering updates the entry instead of
    // creating a duplicate alongside it.
    `UID:${event.slug}@pedquest.org`,
    `DTSTAMP:${toIcsUtc(new Date().toISOString())}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${esc(`${event.series ? `${event.series}: ` : ""}${event.title}`)}`,
    `DESCRIPTION:${esc(descriptionParts.join("\n"))}`,
    `LOCATION:${esc(event.joinUrl ?? event.location ?? "Virtual")}`,
    ...(event.joinUrl ? [`URL:${event.joinUrl}`] : []),
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "TRANSP:OPAQUE",
  ];

  for (const minutes of reminderMinutes) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `TRIGGER:-PT${minutes}M`,
      `DESCRIPTION:${esc(event.title)}`,
      "END:VALARM"
    );
  }

  lines.push("END:VEVENT", "END:VCALENDAR");

  return {
    filename: `${event.slug}.ics`,
    content: lines.map(fold).join("\r\n") + "\r\n",
  };
}
