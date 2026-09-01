import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import { and, eq, gte, isNotNull, lte, ne, or } from "drizzle-orm";
import type { CalendarIntegration } from "./calendar-integration";
import {
  type MirrorableEvent,
  mirrorIsStale,
  mirrorPayloadForEvent,
  recordMirrorPush,
} from "./external-calendar";
import {
  GoogleAuthorizationRevokedError,
  deleteCalendarEvent,
  findOrCreateAppCalendar,
  hasAppCalendarScope,
  insertCalendarEvent,
  patchCalendarEvent,
} from "./google-calendar";

/**
 * THE OUTBOUND HALF, finally connected — shoWMe's shows onto the user's own
 * Google calendar.
 *
 * `lib/external-calendar.ts` has specified this seam for a long time
 * (`mirrorPayloadForEvent`, `recordMirrorPush`, `mirrorIsStale`,
 * `filterOutEchoedEvents`) and nothing has ever driven it. This module is the
 * Google adapter for that seam, and it keeps the same division the rest of the
 * integration keeps: `external-calendar.ts` knows Postgres and no provider,
 * `google-calendar.ts` knows Google and no database, and the joining-up happens
 * here.
 *
 * ── WHAT GETS MIRRORED ───────────────────────────────────────────────────────
 * The shows this profile is actually on — hosting, or standing on the bill — that
 * have a date and have not been cancelled. Not holds and not drafts: a hold is a
 * date somebody is thinking about, and putting it on a calendar that a manager or
 * a partner may also read announces a booking that does not exist yet.
 *
 * ── WHERE THEY LAND ──────────────────────────────────────────────────────────
 * A calendar named "shoWMe" that this application creates in the user's account,
 * never their primary one. `calendar.app.created` grants exactly the calendars we
 * made, so the grant cannot read the calendar they share with their family, and
 * disconnecting is one delete rather than a hunt through their own entries.
 *
 * ── WHO WINS AN EDIT ─────────────────────────────────────────────────────────
 * shoWMe, but never silently — the rule `external-calendar.ts` states and this
 * obeys. If the far side moved since we last pushed (`mirrorIsStale`), the push
 * is SKIPPED and counted, not sent. Blind overwriting is how somebody's
 * hand-edited note disappears without trace. It is reported so the skip is
 * visible rather than looking like nothing needed doing.
 *
 * ── THE ECHO TRAP IS ALREADY CLOSED ──────────────────────────────────────────
 * Every push is recorded in `external_calendar_mirrors`, and the inbound seam
 * checks that table before importing anything (`filterOutEchoedEvents`), so a
 * show we pushed cannot come back as an imported entry that blocks its own night
 * a second time. That guard was written before there was anything to guard
 * against; this is what makes it load-bearing.
 */

/** How far either side of today a push looks. Matches the inbound sync window. */
const PUSH_WINDOW_PAST_DAYS = 30;
const PUSH_WINDOW_FUTURE_DAYS = 400;

/** The name of the calendar this app makes. Also how it is found again. */
export const APP_CALENDAR_SUMMARY = "shoWMe";

export interface MirrorPushResult {
  /** Copies created on the far side. */
  created: number;
  /** Copies updated in place. */
  updated: number;
  /** Copies removed because the show was cancelled. */
  removed: number;
  /**
   * Pushes NOT sent because the far side had moved since we last wrote — the
   * count that must never be silently folded into "nothing to do".
   */
  skippedStale: number;
}

const EMPTY: MirrorPushResult = { created: 0, updated: 0, removed: 0, skippedStale: 0 };

/** `yyyy-mm-dd`, `offsetDays` from `now`, in UTC. */
function isoDayOffset(now: Date, offsetDays: number): string {
  const day = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return day.toISOString().slice(0, 10);
}

/**
 * The shows to mirror for this profile, plus their existing mirror row when they
 * have one. One query rather than one per event: a busy operator's window is
 * hundreds of nights, and a round trip each would make the sync quadratic in the
 * thing it is trying to keep cheap.
 *
 * Hosting OR on the bill, because both are "a night this person is working" —
 * `story.md` treats the operator's programme and the performer's bookings as the
 * same fact seen from two sides, and a calendar has no reason to tell them apart.
 */
async function mirrorableEvents(
  database: Database,
  profileId: string,
  now: Date,
): Promise<
  {
    event: MirrorableEvent & { status: string };
    mirror: { providerEventId: string; pushedAt: Date; remoteUpdatedAt: Date | null } | null;
  }[]
> {
  const rows = await database
    .selectDistinctOn([schema.events.id], {
      id: schema.events.id,
      title: schema.events.title,
      status: schema.events.status,
      eventDate: schema.events.eventDate,
      doorTime: schema.events.doorTime,
      startTime: schema.events.startTime,
      endTime: schema.events.endTime,
      timezone: schema.events.timezone,
      venueName: schema.events.venueName,
      providerEventId: schema.externalCalendarMirrors.providerEventId,
      pushedAt: schema.externalCalendarMirrors.pushedAt,
      remoteUpdatedAt: schema.externalCalendarMirrors.remoteUpdatedAt,
    })
    .from(schema.events)
    .leftJoin(
      schema.eventParticipants,
      and(
        eq(schema.eventParticipants.eventId, schema.events.id),
        eq(schema.eventParticipants.profileId, profileId),
        ne(schema.eventParticipants.status, "removed"),
      ),
    )
    .leftJoin(
      schema.externalCalendarMirrors,
      eq(schema.externalCalendarMirrors.eventId, schema.events.id),
    )
    .where(
      and(
        // Hosting it, or standing on it.
        or(eq(schema.events.hostProfileId, profileId), isNotNull(schema.eventParticipants.id)),
        isNotNull(schema.events.eventDate),
        gte(schema.events.eventDate, isoDayOffset(now, -PUSH_WINDOW_PAST_DAYS)),
        lte(schema.events.eventDate, isoDayOffset(now, PUSH_WINDOW_FUTURE_DAYS)),
      ),
    );

  return rows.map((row) => ({
    event: {
      id: row.id,
      title: row.title,
      status: row.status,
      eventDate: row.eventDate,
      doorTime: row.doorTime,
      startTime: row.startTime,
      endTime: row.endTime,
      timezone: row.timezone,
      venueName: row.venueName,
    },
    mirror: row.providerEventId
      ? {
          providerEventId: row.providerEventId,
          pushedAt: row.pushedAt as Date,
          remoteUpdatedAt: row.remoteUpdatedAt,
        }
      : null,
  }));
}

/**
 * The statuses worth putting on somebody's calendar.
 *
 * `draft` and `on_hold` are excluded on purpose: a hold is a date under
 * consideration, and mirroring it announces a booking nobody has agreed to — on a
 * calendar that a manager, a partner or an assistant may well be reading.
 */
const MIRRORED_EVENT_STATUSES = new Set(["confirmed", "concluded"]);

/**
 * Make the user's shoWMe calendar agree with their shoWMe bookings.
 *
 * Returns zeroes and touches nothing unless this connection actually holds
 * `calendar.app.created` — read from the scope Google GRANTED, never from what
 * the deployment asked for, because a user may decline one scope of several and
 * every connection made before this feature has only the read one.
 */
export async function pushMirroredEvents(
  database: Database,
  integration: CalendarIntegration,
  connection: {
    id: string;
    profileId: string;
    provider: string;
    scope: string | null;
    appCalendarId: string | null;
  },
  accessToken: string,
  now: Date = new Date(),
): Promise<MirrorPushResult> {
  if (!hasAppCalendarScope(connection.scope)) return EMPTY;

  const fetchImplementation = integration.googleOAuthClient.fetchImplementation;

  // Find (or make) our calendar once per sync, and remember it. The listing this
  // performs is itself a 403 without the app-calendar scope, which is the second
  // reason the guard above comes first rather than letting the call fail.
  let calendarId = connection.appCalendarId;
  if (!calendarId) {
    calendarId = await findOrCreateAppCalendar({
      accessToken,
      summary: APP_CALENDAR_SUMMARY,
      fetchImplementation,
    });
    await database
      .update(schema.calendarConnections)
      .set({ appCalendarId: calendarId })
      .where(eq(schema.calendarConnections.id, connection.id));
  }

  const result: MirrorPushResult = { created: 0, updated: 0, removed: 0, skippedStale: 0 };

  for (const { event, mirror } of await mirrorableEvents(database, connection.profileId, now)) {
    const cancelled = !MIRRORED_EVENT_STATUSES.has(event.status);

    // A show that stopped being a show: take the copy back off their calendar.
    // Only meaningful when we put one there — there is nothing to withdraw
    // otherwise, and a cancelled event that was never mirrored is not a task.
    if (cancelled) {
      if (!mirror) continue;
      await deleteCalendarEvent({
        accessToken,
        calendarId,
        eventId: mirror.providerEventId,
        fetchImplementation,
      });
      await database
        .delete(schema.externalCalendarMirrors)
        .where(
          and(
            eq(schema.externalCalendarMirrors.provider, connection.provider),
            eq(schema.externalCalendarMirrors.providerCalendarId, calendarId),
            eq(schema.externalCalendarMirrors.providerEventId, mirror.providerEventId),
          ),
        );
      result.removed += 1;
      continue;
    }

    const payload = mirrorPayloadForEvent(event);
    // An undated event has nothing to mirror; the seam already refuses to invent
    // a day for one, and this is what that refusal means here.
    if (!payload) continue;

    const write = {
      summary: payload.title,
      date: payload.date,
      startTime: payload.startTime,
      endTime: payload.endTime,
      timeZone: payload.timezone,
      location: payload.location,
    };

    if (!mirror) {
      const written = await insertCalendarEvent({
        accessToken,
        calendarId,
        event: write,
        // Nobody is invited to a mirrored show: it is a copy for the owner's own
        // calendar, not an invitation to anyone. Attendee mail belongs to the
        // appointment flow, which is a different feature with a different consent.
        notifyAttendees: false,
        fetchImplementation,
      });
      await recordMirrorPush(database, {
        eventId: event.id,
        provider: connection.provider,
        providerCalendarId: calendarId,
        providerEventId: written.eventId,
      });
      result.created += 1;
      continue;
    }

    // THE FAR SIDE MOVED. Skip and count it — never overwrite. The user edited
    // their own copy, and an integration that quietly reverts a person's edit
    // teaches them not to trust it.
    if (mirrorIsStale(mirror)) {
      result.skippedStale += 1;
      continue;
    }

    await patchCalendarEvent({
      accessToken,
      calendarId,
      eventId: mirror.providerEventId,
      event: write,
      notifyAttendees: false,
      fetchImplementation,
    });
    await recordMirrorPush(database, {
      eventId: event.id,
      provider: connection.provider,
      providerCalendarId: calendarId,
      providerEventId: mirror.providerEventId,
    });
    result.updated += 1;
  }

  return result;
}

/**
 * The push, wrapped so it can never fail a sync that otherwise worked.
 *
 * The inbound direction is the one people notice and the one availability
 * depends on; the outbound copy is a convenience. A Google hiccup while writing
 * must not cost the user their import, so this reports the failure and returns
 * zeroes. A REVOKED grant is the exception worth re-raising — the caller already
 * knows how to mark a connection for reconnection, and swallowing it would leave
 * a dead connection looking healthy.
 */
export async function pushMirroredEventsBestEffort(
  database: Database,
  integration: CalendarIntegration,
  connection: {
    id: string;
    profileId: string;
    provider: string;
    scope: string | null;
    appCalendarId: string | null;
  },
  accessToken: string,
  now: Date = new Date(),
): Promise<MirrorPushResult> {
  try {
    return await pushMirroredEvents(database, integration, connection, accessToken, now);
  } catch (error) {
    if (error instanceof GoogleAuthorizationRevokedError) throw error;
    return EMPTY;
  }
}
