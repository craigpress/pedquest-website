# Events page + email-gated registration

Public page: `/events`. Admin console: `/admin/events` (linked from the admin sidebar).

## What it does

The page is framed around the PNCRG **Multimodal Neuromonitoring (MNM) lecture
series** and renders every published event, split into *Next up*, *Also coming
up*, and an *Archive* — all derived from `starts_at`/`ends_at`, so nothing needs
manual re-filing once an event passes.

Each event picks one of three sign-up modes:

| `registration` | Behavior |
|---|---|
| `email` | Shows a short form (email required, name/institution optional). On submit the join link, meeting ID, and passcode are returned and displayed, and emailed if Resend is configured. |
| `external` | Shows a button to `registration_url` (used for the PNCRG member-only fall meeting). |
| `none` | Information only — a save-the-date. |

**The join link is never in the page payload.** `toPublicEvent()` strips
`join_url` / `meeting_id` / `passcode`, and `/api/events/register` hands them
back only after an email is recorded. That is the whole point of the gate: don't
put the link in `src/data` or in any client component.

## Files

| Piece | Path |
|---|---|
| DB migration + series seed | `supabase/migrations/20260902_events.sql` |
| Types, series copy, date/TZ helpers | `src/lib/events.ts` |
| Server reads (service role) | `src/lib/events-server.ts` |
| Public page / view | `src/app/events/page.tsx`, `src/components/EventsView.tsx` |
| Register form | `src/components/EventRegisterForm.tsx` |
| Register API | `src/app/api/events/register/route.ts` |
| Admin console + API | `src/app/admin/events/page.tsx`, `src/app/api/admin/events/route.ts` |
| PNCRG artwork | `public/images/events/` |

## Setup

1. **Run the migration** in the Supabase SQL editor: paste
   `supabase/migrations/20260902_events.sql`. It is idempotent and seeds the four
   MNM lectures plus the Seattle fall meeting (`ON CONFLICT (slug) DO NOTHING`).
   Until it runs, `/events` shows its empty state and registration returns 404.
2. **Optional — real email.** Set `RESEND_API_KEY` (and `EMAIL_FROM`) in Vercel.
   Without it registration still works: the link is shown on screen and the
   address is recorded, it just isn't emailed.
3. Discord/Telegram notifications reuse the existing webhook env vars — each
   registration pings them like a contact-form submission.

## Adding an event

`/admin/events` → **New event**. Notes:

- Times are entered as wall-clock in the event's own zone (ET/CT/MT/PT) and
  stored as absolute timestamps, so a Seattle meeting displays in PT.
- The **slug** identifies the event in `event_registrations`. Leave it blank to
  derive it from the title; don't change it after people have registered.
- Save as **Draft** to stage an event; only `published` rows reach `/events`.
- An email-gated event can't be published without a join link.
- Each row shows its registration count with **Copy emails** and **CSV** for
  follow-up.
