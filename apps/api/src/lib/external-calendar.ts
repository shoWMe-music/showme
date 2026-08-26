import type { Database } from "@showme/db";
import { schema } from "@showme/db";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

/**
 * THE CALENDAR SYNC SEAM — both directions, with no provider in it.
 *
 * Nothing here talks to Google. This module is the shape a provider adapter has
 * to fill: hand it normalized events and it makes the database agree with them,
 * idempotently; ask it what to push and it tells you, without knowing how.
 * Fetching (OAuth, `events.list`, `events.watch`) is deliberately absent — see
 * WHAT IS STILL MISSING at the bottom, which is honest about the parts that are
 * unsolved rather than nearly done.
 *
 * ── INBOUND: somebody else's calendar → `calendar_items` ──────────────────────
 * `upsertExternalCalendarEvents` writes `type = 'external'` rows keyed on
 * `(external_source, external_id)` (0009's unique index), so importing the same
 * calendar twice updates instead of duplicating. What it never overwrites is
 * shoWMe's own state on the row: `blocks_availability` (the user's "available
 * anyway") and `promoted_event_id` (the show it became) survive every re-sync,
 * because they are our answers about their event, not their facts.
 *
 * WHO WINS AN EDIT, inbound: the provider, on the CONTENT of an imported entry —
 * title, day, hours. It is their row; ours is a cached copy, and a copy that
 * argues with its original is just wrong. Last write wins, and the last write is
 * theirs by definition. The two shoWMe columns above are the exact complement of
 * that rule and are never touched.
 *
 * ── OUTBOUND: `events` → somebody else's calendar ────────────────────────────
 * `mirrorPayloadForEvent` turns a shoWMe event into a provider-agnostic payload;
 * `recordMirrorPush` stores where the copy landed in `external_calendar_mirrors`.
 *
 * WHO WINS AN EDIT, outbound: shoWMe — but never silently. The mirror keeps the
 * provider's `etag` and its `remote_updated_at`, and `mirrorIsStale` reports when
 * the far side has moved since we last pushed. A pusher must send the stored ETag
 * as `If-Match` and treat a 412 as a CONFLICT TO SURFACE, not as a retry with the
 * check removed. Blind overwriting is how a user's hand-edited door time
 * disappears with no trace, and an event's local times are load-bearing for
 * everyone else on it.
 *
 * ── THE ECHO TRAP ────────────────────────────────────────────────────────────
 * Push a shoWMe event to Google, then run the inbound sync, and the event comes
 * back as an imported entry that blocks its own night for a second time — a
 * duplicate that looks exactly like a real conflict. `filterOutEchoedEvents`
 * closes it: before importing anything, every incoming remote id is checked
 * against `external_calendar_mirrors`, and the ones we put there ourselves are
 * dropped. One indexed lookup on the mirror's unique key. Every inbound path must
 * go through it, which is why `upsertExternalCalendarEvents` calls it itself
 * rather than trusting a caller to remember.
 */

/** A provider's event, flattened to the only facts shoWMe stores. */
export interface NormalizedExternalEvent {
  /** The provider's own opaque id for the event — stable across edits. */
  externalId: string;
  /** What the owner calls it. Withheld from everyone else (`serialize/calendar.ts`). */
  title: string;
  /** First day, `yyyy-mm-dd`, in the calendar's own timezone. */
  date: string;
  /** Last day inclusive, or null when it starts and ends on `date`. */
  endDate?: string | null;
  /** Wall-clock `HH:MM` or `HH:MM:SS`; null for an all-day entry. */
  startTime?: string | null;
  endTime?: string | null;
  /** Where it happens, if the provider says. Free text — a room, an address. */
  location?: string | null;
}

export interface ExternalCalendarSyncInput {
  /** Which provider these came from — "google", "ics". */
  provider: string;
  /** WHOSE AVAILABILITY they occupy. Required: availability is profile-scoped. */
  ownerProfileId: string;
  /** WHOSE ACCOUNT they came from. Required: it is who may see the titles. */
  ownerUserId: string;
  events: readonly NormalizedExternalEvent[];
}

export interface ExternalCalendarSyncResult {
  /** Rows written or refreshed. */
  upserted: number;
  /** Incoming events dropped because they were copies of our own events. */
  echoesSkipped: number;
  /** The `calendar_items.id` of every row the batch touched. */
  itemIds: string[];
}

/**
 * Drop the incoming events that are copies of shoWMe events we pushed out.
 * Exported so a future poller can report the count honestly; the upsert applies
 * it unconditionally.
 */
export async function filterOutEchoedEvents(
  database: Database,
  provider: string,
  events: readonly NormalizedExternalEvent[],
): Promise<{ kept: NormalizedExternalEvent[]; echoes: NormalizedExternalEvent[] }> {
  if (events.length === 0) return { kept: [], echoes: [] };

  const mirrored = await database
    .select({ providerEventId: schema.externalCalendarMirrors.providerEventId })
    .from(schema.externalCalendarMirrors)
    .where(
      and(
        eq(schema.externalCalendarMirrors.provider, provider),
        inArray(
          schema.externalCalendarMirrors.providerEventId,
          events.map((event) => event.externalId),
        ),
      ),
    );

  const ours = new Set(mirrored.map((row) => row.providerEventId));
  const kept: NormalizedExternalEvent[] = [];
  const echoes: NormalizedExternalEvent[] = [];
  for (const event of events) (ours.has(event.externalId) ? echoes : kept).push(event);
  return { kept, echoes };
}

/**
 * THE INBOUND SEAM. Make `calendar_items` agree with a batch of normalized
 * events, without duplicating anything and without trampling the user's own
 * decisions about them.
 */
export async function upsertExternalCalendarEvents(
  database: Database,
  input: ExternalCalendarSyncInput,
): Promise<ExternalCalendarSyncResult> {
  const { kept, echoes } = await filterOutEchoedEvents(database, input.provider, input.events);
  if (kept.length === 0) return { upserted: 0, echoesSkipped: echoes.length, itemIds: [] };

  const rows = await database
    .insert(schema.calendarItems)
    .values(
      kept.map((event) => ({
        ownerProfileId: input.ownerProfileId,
        ownerUserId: input.ownerUserId,
        type: "external" as const,
        // A provider may hand back an untitled entry (Google does for anything
        // marked private). "Busy" is what it is, and it is also exactly what a
        // non-owner would have been shown anyway.
        title: event.title.trim() || "Busy",
        date: event.date,
        endDate: event.endDate ?? null,
        startTime: event.startTime ?? null,
        endTime: event.endTime ?? null,
        entity: event.location ?? null,
        externalSource: input.provider,
        externalId: event.externalId,
      })),
    )
    .onConflictDoUpdate({
      target: [
        schema.calendarItems.externalSource,
        schema.calendarItems.externalId,
        schema.calendarItems.ownerUserId,
        schema.calendarItems.ownerProfileId,
      ],
      // 0009's index is PARTIAL (`WHERE external_id IS NOT NULL`), so the
      // conflict target has to name the same predicate or Postgres cannot match
      // it to an arbiter and the upsert becomes a plain failing insert.
      targetWhere: isNotNull(schema.calendarItems.externalId),
      set: {
        // Their facts, refreshed. NOT `blocks_availability` and NOT
        // `promoted_event_id`: those are shoWMe's answers about their event, and
        // a re-sync that reset them would undo "available anyway" every hour and
        // orphan a show from the entry it came from.
        title: sql`excluded.title`,
        date: sql`excluded.date`,
        endDate: sql`excluded.end_date`,
        startTime: sql`excluded.start_time`,
        endTime: sql`excluded.end_time`,
        entity: sql`excluded.entity`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: schema.calendarItems.id });

  return {
    upserted: rows.length,
    echoesSkipped: echoes.length,
    itemIds: rows.map((row) => row.id),
  };
}

/**
 * An entry that has gone from the remote calendar.
 *
 * A plain delete for the ordinary case: the commitment is not there any more, so
 * it must stop occupying the night — leaving it would keep the user unbookable
 * over a meeting that was cancelled weeks ago, which is the failure mode a
 * materialized design suffers from permanently.
 *
 * An entry that was PROMOTED is the exception and keeps its row. It became a
 * shoWMe show; the show is the source of truth now and `promoted_event_id` is the
 * only record of where it came from. It stops blocking (the event stands on its
 * own) but it is not erased.
 */
export async function applyExternalCalendarDeletions(
  database: Database,
  input: { provider: string; ownerProfileId: string; ownerUserId: string; externalIds: string[] },
): Promise<{ deleted: number; keptBecausePromoted: number }> {
  if (input.externalIds.length === 0) return { deleted: 0, keptBecausePromoted: 0 };

  const scope = and(
    eq(schema.calendarItems.externalSource, input.provider),
    eq(schema.calendarItems.ownerProfileId, input.ownerProfileId),
    eq(schema.calendarItems.ownerUserId, input.ownerUserId),
    inArray(schema.calendarItems.externalId, input.externalIds),
  );

  const promoted = await database
    .update(schema.calendarItems)
    .set({ blocksAvailability: false, updatedAt: new Date() })
    .where(and(scope, isNotNull(schema.calendarItems.promotedEventId)))
    .returning({ id: schema.calendarItems.id });

  const removed = await database
    .delete(schema.calendarItems)
    .where(and(scope, sql`${schema.calendarItems.promotedEventId} IS NULL`))
    .returning({ id: schema.calendarItems.id });

  return { deleted: removed.length, keptBecausePromoted: promoted.length };
}

/* ────────────────────────────────────────────────────────── outbound ──────── */

/** A shoWMe event flattened for a provider — the fields any calendar can hold. */
export interface MirrorPayload {
  /** What the copy is called on the far side. */
  title: string;
  date: string;
  /** Wall-clock, or null for an all-day entry. */
  startTime: string | null;
  endTime: string | null;
  /** The IANA zone the wall-clock times are anchored in (`events.timezone`). */
  timezone: string | null;
  location: string | null;
  /** Round-trip breadcrumb: which shoWMe event this copy is of. */
  showmeEventId: string;
}

/** The event columns the payload is built from — plain rows, no ORM required. */
export interface MirrorableEvent {
  id: string;
  title: string;
  eventDate: string | null;
  doorTime: string | null;
  startTime: string | null;
  endTime: string | null;
  timezone: string | null;
  venueName: string | null;
}

/**
 * THE OUTBOUND SEAM, pure half: what a shoWMe event looks like on somebody else's
 * calendar. An undated event has nothing to mirror and returns null rather than
 * inventing a day.
 *
 * The window is door → end where both are known, because door time is when the
 * night starts occupying the operator, and falls back to the stage times. An
 * event with a date and no clock is an all-day entry, which is the truth.
 */
export function mirrorPayloadForEvent(event: MirrorableEvent): MirrorPayload | null {
  if (!event.eventDate) return null;
  const startTime = event.doorTime ?? event.startTime ?? null;
  const endTime = event.endTime ?? null;
  return {
    title: event.title,
    date: event.eventDate,
    // Only a complete window is a window; a start with no end would mirror as a
    // zero-length blip on the far side, which is worse than an all-day entry.
    startTime: startTime && endTime ? startTime : null,
    endTime: startTime && endTime ? endTime : null,
    timezone: event.timezone,
    location: event.venueName,
    showmeEventId: event.id,
  };
}

/**
 * Record where a pushed copy landed, so the next push can address it, the echo
 * filter can recognise it, and a stale check can tell whether the far side moved.
 * Idempotent on the remote identity.
 */
export async function recordMirrorPush(
  database: Database,
  input: {
    eventId: string;
    provider: string;
    providerCalendarId: string;
    providerEventId: string;
    etag?: string | null;
    remoteUpdatedAt?: Date | null;
  },
): Promise<void> {
  const now = new Date();
  await database
    .insert(schema.externalCalendarMirrors)
    .values({
      eventId: input.eventId,
      provider: input.provider,
      providerCalendarId: input.providerCalendarId,
      providerEventId: input.providerEventId,
      etag: input.etag ?? null,
      remoteUpdatedAt: input.remoteUpdatedAt ?? null,
      pushedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.externalCalendarMirrors.provider,
        schema.externalCalendarMirrors.providerCalendarId,
        schema.externalCalendarMirrors.providerEventId,
      ],
      set: {
        eventId: input.eventId,
        etag: input.etag ?? null,
        remoteUpdatedAt: input.remoteUpdatedAt ?? null,
        pushedAt: now,
      },
    });
}

/**
 * Has the far side changed since we last wrote it? True means a push would
 * overwrite somebody's edit and must be surfaced instead of sent.
 */
export function mirrorIsStale(mirror: {
  pushedAt: Date;
  remoteUpdatedAt: Date | null;
}): boolean {
  if (!mirror.remoteUpdatedAt) return false;
  return mirror.remoteUpdatedAt.getTime() > mirror.pushedAt.getTime();
}

/**
 * WHAT IS STILL MISSING before either direction can run — stated plainly, because
 * the gap is not code volume, it is two unsolved decisions.
 *
 * 1. **Per-user credentials, and where they may live.** Everything above assumes
 *    somebody already holds an authorized client for this user. Google hands back
 *    a REFRESH TOKEN, which is a long-lived key to a person's whole calendar, and
 *    there is no table for one — deliberately. Where it may be stored (Secret
 *    Manager per user, an encrypted column with a KMS-wrapped key, the envelope
 *    scheme, the revocation path, what GDPR erasure does to it) is a security
 *    decision, not a schema chore, and inventing a `text` column for it here would
 *    settle that decision by accident. The connection row it eventually lands on
 *    also needs: `provider_calendar_id` (which calendar), and Google's
 *    `nextSyncToken`.
 *
 * 2. **`nextSyncToken`, and why it belongs with the connection.** Google returns a
 *    sync token per calendar per full listing; passing it back to `events.list`
 *    returns only what changed — including cancellations, which is how
 *    `applyExternalCalendarDeletions` learns what to remove. It is a CURSOR, not a
 *    credential, but it is per (user, calendar), so it has nowhere to live until
 *    the connection row exists. Without it every sync is a full re-list: correct,
 *    thanks to the idempotent upsert, but it can never learn about a deletion.
 *
 * 3. **"Sync dynamically" means a webhook, and a webhook needs a public URL.**
 *    Google pushes via `events.watch`: register a channel pointing at an HTTPS
 *    endpoint, Google POSTs a content-free ping when anything changes, the handler
 *    does an incremental list with the sync token. That needs the API deployed on
 *    a reachable host, a channel registration to store (`channel_id`,
 *    `resource_id`, `expiration` — channels expire and must be re-registered), and
 *    a verification token to reject forged pings. A poller on a timer is the
 *    honest interim and drives the exact same code path; nothing above changes.
 *
 * 4. **Normalisation is provider-shaped and belongs in the adapter.** Google
 *    returns `start.date` for all-day entries and `start.dateTime` + `timeZone`
 *    for timed ones; an event may be `cancelled` (a deletion), recurring (a
 *    `recurringEventId` with instances that each carry their own id), or declined
 *    by this user (`attendees[].responseStatus`, which arguably should not block).
 *    `NormalizedExternalEvent` is the line: everything provider-shaped stops on
 *    the far side of it, and a wall-clock time reaching `date`/`startTime` has
 *    already been resolved into the calendar's own zone.
 */
