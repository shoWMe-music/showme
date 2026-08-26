import { schema } from "@showme/db";
import { and, asc, eq, exists, getTableColumns, inArray, isNull, ne, not, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, conflict, notFound } from "../errors";
import { writeActivity } from "../lib/activity";
import { writeAudit } from "../lib/audit";
import { eventCapabilities, requireEventCapability } from "../lib/authorize";
import { renderEventNotificationEmail } from "../lib/email-templates";
import { PaginationQuery, decodeCursor, paginate } from "../lib/pagination";
import { serializeEvent } from "../serialize/event";

const EventParams = z.object({ id: z.string().uuid() });

/** Keyset cursor over the `(created_at, id)` order — opaque to the client. */
interface EventCursor {
  createdAt: string;
  id: string;
}

const EventStatus = z.enum([
  "draft",
  "suggested",
  "pending",
  "confirmed",
  "on_hold",
  "concluded",
  "cancelled",
]);

/**
 * `?status=pending` or `?status=pending,suggested` — one status or a list.
 *
 * The list is not a convenience: a status CHIP in the UI does not always map to
 * one row value. "Pending" means an event awaiting a response, which is
 * `pending` OR `suggested` (an offer someone else has yet to answer). With only
 * a single-value filter that chip could be honest only by filtering in the
 * browser, i.e. over the current page — so the answer would depend on how far
 * the reader had scrolled. One query, one complete answer.
 *
 * A comma-separated value is split here; repeated params (`?status=a&status=b`)
 * already arrive as an array and pass straight through.
 */
const StatusFilter = z.preprocess(
  (value) => (typeof value === "string" ? value.split(",").filter(Boolean) : value),
  z.array(EventStatus).min(1),
);

/**
 * What to do about events the caller has FILED AWAY (`event_participants.archived_at`,
 * migration 0020).
 *
 * `exclude` is the default and the point of the feature: an archived event leaves
 * the everyday list. `only` is the way back — the Events screen's "Archived" chip
 * — because a feature that hides things with no way to find them again is a
 * delete that lies about itself. `include` exists for the reader that wants the
 * whole picture in one pass (an export, a count).
 *
 * Orthogonal to `status` on purpose, and combinable with it: archiving is not a
 * status (see `routes/events.ts`), so it cannot be one more value in that list.
 */
const ArchivedFilter = z.enum(["exclude", "include", "only"]);

const ListQuery = PaginationQuery.extend({
  status: StatusFilter.optional(),
  archived: ArchivedFilter.optional().default("exclude"),
});

const EventResponse = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  published: z.boolean(),
  baseCurrency: z.string(),
  eventDate: z.string().nullable(),
  timezone: z.string().nullable(),
  venueProfileId: z.string().nullable(),
  /**
   * `serializeEvent` has always returned this; the list schema simply never
   * declared it, so Fastify stripped it on the way out and every list screen had
   * only a title to search. The Calendar's "Venue / Room…" filter was the visible
   * cost: it advertised a search it could not perform.
   */
  venueName: z.string().nullable(),
  stageId: z.string().nullable(),
  version: z.number(),
  holdRank: z.number().nullable().optional(),
  holdAutoPromote: z.boolean().optional(),
});

/**
 * A LIST row: the event, plus the one fact that belongs to the reader rather than
 * to the event — has the caller filed this one away?
 *
 * Its own schema rather than a field on `EventResponse` because `archived` is not
 * a property of the event. The same show is archived for the venue and live for
 * the act standing on it (`event_participants.archived_at`, migration 0020), so
 * it can only ever be answered per request, and only where the request is "show
 * me my events". `POST /events/:id/publish` returns the event and has no reader
 * scope to answer it from.
 */
const ListEventResponse = EventResponse.extend({ archived: z.boolean() });

const ListResponse = z.object({
  items: z.array(ListEventResponse),
  nextCursor: z.string().nullable(),
});

const DeleteResponse = z.object({ id: z.string(), deleted: z.boolean() });
const NotifyResponse = z.object({ queued: z.boolean() });

/** Optional optimistic-lock version, shared by the mutating routes. The whole
 * body is nullish so a caller may omit it (a bare DELETE arrives with body `null`). */
const OptimisticLockBody = z.object({ expectedVersion: z.number().int().optional() }).nullish();

export async function eventListRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // List: the access predicate IS the authorization — return only events the
  // caller can reach via `events ⋈ event_participants ⋈ profile_members`. No
  // per-event `requireEventCapability`; the WHERE is the rule. Keyset paginated.
  app.get(
    "/events",
    { schema: { querystring: ListQuery, response: { 200: ListResponse } } },
    async (request) => {
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");
      const { database } = request.server;
      const { cursor, limit, status, archived } = request.query;

      // Correlated EXISTS keeps the result one row per event (a caller may reach
      // an event through several participants) while folding access into the WHERE.
      //
      // `onlyUnfiled` adds one predicate to that same join: the row must not be
      // one the reader FILED AWAY (`archived_at`, migration 0020). Two spellings
      // of the one query, because "can I reach this?" and "have I put it away?"
      // are different questions and the archived view needs both.
      const reachableThrough = (onlyUnfiled: boolean) =>
        exists(
          database
            .select({ present: sql`1` })
            .from(schema.eventParticipants)
            .innerJoin(
              schema.profileMembers,
              eq(schema.profileMembers.profileId, schema.eventParticipants.profileId),
            )
            .where(
              and(
                eq(schema.eventParticipants.eventId, schema.events.id),
                eq(schema.profileMembers.userId, principal.userId),
                eq(schema.profileMembers.status, "active"),
                ne(schema.eventParticipants.status, "removed"),
                onlyUnfiled ? isNull(schema.eventParticipants.archivedAt) : undefined,
              ),
            ),
        );

      const reachable = reachableThrough(false);
      const reachableAndLive = reachableThrough(true);

      /**
       * Filed away = EVERY way the caller reaches this event is archived.
       *
       * The "every" matters for the reader who is on one show through two profiles
       * (their venue and their promoter company). Filing it as the venue must not
       * take it off the promoter's list, so the event only leaves the everyday
       * view once there is no live route to it left.
       */
      const filedAway = and(reachable, not(reachableAndLive));

      const archiveScope =
        archived === "only" ? filedAway : archived === "include" ? reachable : reachableAndLive;

      // `created_at` is timestamptz (microsecond) but the cursor round-trips
      // through a JS Date (millisecond) — truncate the column to milliseconds so
      // the keyset stays exact and never re-emits the boundary row. Bind the
      // cursor values as ISO/UUID strings (postgres.js can't bind a Date param
      // under a raw SQL comparison) with explicit casts.
      const createdAtMillis = sql`date_trunc('milliseconds', ${schema.events.createdAt})`;
      const decoded = cursor ? decodeCursor<EventCursor>(cursor) : null;
      const afterCursor = decoded
        ? sql`(${createdAtMillis}, ${schema.events.id}) > (${decoded.createdAt}::timestamptz, ${decoded.id}::uuid)`
        : undefined;

      const rows = await database
        // The event's own columns plus the one fact that belongs to the READER
        // rather than to the row — computed in the same pass, so no screen has to
        // infer "is this archived?" from which filter it happens to be showing.
        .select({ ...getTableColumns(schema.events), archived: sql<boolean>`${filedAway}` })
        .from(schema.events)
        .where(
          and(
            archiveScope,
            status ? inArray(schema.events.status, status) : undefined,
            afterCursor,
          ),
        )
        .orderBy(asc(createdAtMillis), asc(schema.events.id))
        .limit(limit + 1);

      const { items, nextCursor } = paginate(rows, limit, (event) => ({
        createdAt: event.createdAt,
        id: event.id,
      }));

      // Serialize each by the caller's capabilities on that specific event.
      const serialized = await Promise.all(
        items.map(async (event) => {
          const capabilities = await eventCapabilities(request, event.id);
          return { ...serializeEvent(event, capabilities), archived: event.archived };
        }),
      );

      return { items: serialized, nextCursor };
    },
  );

  // Delete: authorize `event.delete`, optimistic-lock, cascade + audit.
  app.delete(
    "/events/:id",
    {
      schema: { params: EventParams, body: OptimisticLockBody, response: { 200: DeleteResponse } },
    },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;
      const { expectedVersion } = request.body ?? {};

      await requireEventCapability(request, id, "event.delete");
      const [before] = await database.select().from(schema.events).where(eq(schema.events.id, id));
      if (!before) throw notFound("Event not found");

      const where =
        expectedVersion != null
          ? and(eq(schema.events.id, id), eq(schema.events.version, expectedVersion))
          : eq(schema.events.id, id);

      await database.transaction(async (tx) => {
        const [deleted] = await tx.delete(schema.events).where(where).returning();
        if (!deleted) {
          // Row exists (checked above) but the version moved → conflict.
          throw conflict("Event was changed by someone else; reload and retry");
        }
        // `eventId` is recorded even though the row is gone: `audit_log.event_id`
        // carries no foreign key precisely so the trail survives the deletion.
        await writeAudit(tx, request, {
          capability: "event.delete",
          action: "event.delete",
          targetKind: "event",
          targetId: id,
          eventId: id,
          before,
        });
      });

      return { id, deleted: true };
    },
  );

  // Publish: authorize `event.publish`, check the public-page preconditions,
  // optimistic-lock, flip the flag + audit.
  //
  // Publishing is a promise to the world, so only a `confirmed` event may be
  // published (PLAN.md:620 — "published+confirmed events") and it must carry the
  // date the poster needs: `serializePublicEvent` renders eventDate/doorTime/
  // startTime, and of those only `eventDate` is genuinely load-bearing — a page
  // with no date is not an announcement. Door/start times are honestly "TBA" on
  // plenty of real posters, and the public response declares them nullable.
  //
  // The mirror rule lives in `routes/public.ts`: `published` is NOT recomputed
  // when an event is later cancelled — it stays as the host's publishing intent,
  // and the public read is the single gate that hides it. So a cancelled show
  // goes dark without losing its intent, and re-confirming brings the page back.
  app.post(
    "/events/:id/publish",
    { schema: { params: EventParams, body: OptimisticLockBody, response: { 200: EventResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;
      const { expectedVersion } = request.body ?? {};

      const capabilities = await requireEventCapability(request, id, "event.publish");
      const [before] = await database.select().from(schema.events).where(eq(schema.events.id, id));
      if (!before) throw notFound("Event not found");

      if (before.status !== "confirmed") {
        throw badRequest(`Only a confirmed event can be published (this one is ${before.status})`);
      }
      if (!before.eventDate) {
        throw badRequest("An event needs a date before it can be published");
      }

      const where =
        expectedVersion != null
          ? and(eq(schema.events.id, id), eq(schema.events.version, expectedVersion))
          : eq(schema.events.id, id);

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.events)
          .set({ published: true, version: before.version + 1, updatedAt: new Date() })
          .where(where)
          .returning();
        if (!after) {
          throw conflict("Event was changed by someone else; reload and retry");
        }
        await writeAudit(tx, request, {
          capability: "event.publish",
          action: "event.publish",
          targetKind: "event",
          targetId: id,
          eventId: id,
          before,
          after,
        });
        // Going public is a promise to the world — everyone on the bill should be
        // able to see the moment it was made, and by whom.
        await writeActivity(tx, request, {
          eventId: id,
          type: "event.published",
          targetKind: "event",
          targetId: id,
        });
        return after;
      });

      return serializeEvent(updated, capabilities);
    },
  );

  // Notify: authorize `event.send_info_email`, audit, and email the event's
  // reachable users (participants' active members) the info notice via the Brevo
  // sink. A mail failure is logged, never surfaced — the audited intent still holds.
  app.post(
    "/events/:id/notify",
    { schema: { params: EventParams, response: { 200: NotifyResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      await requireEventCapability(request, id, "event.send_info_email");

      const [event] = await database.select().from(schema.events).where(eq(schema.events.id, id));
      if (!event) throw notFound("Event not found");

      await database.transaction(async (tx) => {
        await writeAudit(tx, request, {
          capability: "event.send_info_email",
          action: "event.notify",
          targetKind: "event",
          targetId: id,
          eventId: id,
        });
        // Everyone reachable on the event receives this mail, so everyone may read
        // that it was sent — and "did anyone tell the crew?" is exactly the
        // question a history tab exists to answer.
        await writeActivity(tx, request, {
          eventId: id,
          type: "event.info_email_sent",
          targetKind: "event",
          targetId: id,
        });
      });

      // Resolve the reachable recipients: every active member of a profile that
      // participates in the event. Distinct emails so no user is mailed twice.
      const recipients = await database
        .selectDistinct({ email: schema.users.email })
        .from(schema.eventParticipants)
        .innerJoin(
          schema.profileMembers,
          eq(schema.profileMembers.profileId, schema.eventParticipants.profileId),
        )
        .innerJoin(schema.users, eq(schema.users.id, schema.profileMembers.userId))
        .where(
          and(
            eq(schema.eventParticipants.eventId, id),
            eq(schema.profileMembers.status, "active"),
            ne(schema.eventParticipants.status, "removed"),
          ),
        );

      // Rendered ONCE — every recipient gets the identical notice. It names the
      // show and links to it; what actually changed is deliberately not in the
      // email, because these addresses span every participating profile and the
      // event page is the only surface that can show each reader their own slice.
      const message = renderEventNotificationEmail({ event });
      for (const recipient of recipients) {
        try {
          await request.server.emailSink.sendEmail({ to: recipient.email, ...message });
        } catch (error) {
          request.log.error({ error }, "event notify email failed");
        }
      }

      return { queued: true };
    },
  );
}
