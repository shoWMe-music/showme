# shoWMe — Time zones

shoWMe has **two fundamentally different kinds of time**, and the classic bug is treating them the same.

## The core distinction

| Kind | Examples | Store as |
|---|---|---|
| **Absolute instant** (a moment that happened) | `*_at`, `finalized_at`, OTP expiry, payment events, audit | **UTC `timestamptz`** |
| **Local wall-clock** (a time humans scheduled *at a place*) | door_time "20:00", set times, curfew, load-in | **local datetime (no offset) + an IANA zone** (`Europe/Stockholm`) |

**The trap:** storing a *future* event's "20:00 door" as a UTC instant. If DST rules change, the venue's tz data
updates, or the event moves, that instant no longer means "20:00 local." A future scheduled local time must keep its
**wall-clock + zone** and resolve to an instant only when needed.

## Classifying shoWMe's times

- **Venue-local (local + zone):** `events.event_date/door_time/start_time/end_time/curfew`, `schedule_items`, crew
  call times — *what the venue clock says*.
- **UTC instants:** all `*_at` audit/timestamps, `share_otps.expires_at`, `settlements.finalized_at` + locked-FX
  timestamp, notification/message times, payment events.
- **User-local:** `task_reminders` ("remind me 9am"), the user's calendar/availability display.

## Two schema anchors

1. **`events.timezone`** (IANA) — anchors **all** of an event's local times. **Default from the venue location**
   (`profile_locations` lat/lng or country → IANA lookup) and **snapshot onto the event**, so later moving the venue
   profile doesn't silently shift the event's times.
2. **`users.timezone`** (IANA) — display + user-local reminders. (Users already have `date_format`/`time_format`/`country`.)

## Reapers & background jobs

- **Duration-based** (offer expiry 30d, handoff 90d) → computed from a UTC `created_at`; **no tz issue** (instant +
  interval). Leave in UTC.
- **Local-time reminders** ("the day before at 9am") → resolve the wall-clock in the **owner's** tz to a UTC firing
  instant.
- **Date-bucket queries** ("events today") → "today" is tz-relative; define the day boundary in the **relevant** tz
  (venue for events, user for personal).

## Display rules

- **Event times → venue-local, with a label** ("Doors 20:00 CET") — what attendees/parties expect, NOT the viewer's
  tz. Public event pages especially.
- **Personal items** (tasks, reminders, own calendar) → the **user's** tz.
- **Never** rely on the server's or browser's implicit tz — always explicit.

## Storage types (Postgres / Drizzle)

- Instants → `timestamptz` (stored UTC).
- Local wall times → `timestamp` (no tz) + the event's `timezone text` (or split date/time cols + tz).
- Dates (`event_date`, `profile_unavailability`) → `date`, understood as **venue-local** (or profile-local).

## API contract

- Instants → **ISO-8601 UTC**. Event local times → **`{ localDateTime, timezone }`** so the client renders
  "20:00 Europe/Stockholm" without guessing.
- Use a real tz library (**Temporal**, Luxon, date-fns-tz) — never the JS `Date`'s implicit local zone.

## Edge cases (aware, not blockers)

- **DST transitions** — a set time at 02:30 on a spring-forward night doesn't exist; the IANA resolution handles it,
  just don't hand-roll offset math.
- **Multi-day festivals spanning a DST change** — the local+zone model handles it; a fixed-offset model wouldn't.

## The one-line rule

> "A moment that happened" → **UTC `timestamptz`**. "A time humans scheduled at a place" → **local wall-clock + IANA
> zone**, resolved to an instant on demand. Events hang local times off `events.timezone` (from the venue); users
> have a `timezone` for personal times.
