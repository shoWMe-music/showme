import { schema } from "@showme/db";
import { and, asc, eq, exists, ne, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, conflict, notFound } from "../errors";
import { writeAudit } from "../lib/audit";
import { eventCapabilities, requireEventCapability } from "../lib/authorize";
import { PaginationQuery, decodeCursor, paginate } from "../lib/pagination";
import { serializeEvent } from "../serialize/event";

const EventParams = z.object({ id: z.string().uuid() });

/** Keyset cursor over the `(created_at, id)` order — opaque to the client. */
interface EventCursor {
  createdAt: string;
  id: string;
}

const ListQuery = PaginationQuery.extend({
  status: z
    .enum(["draft", "suggested", "pending", "confirmed", "on_hold", "concluded", "cancelled"])
    .optional(),
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
  stageId: z.string().nullable(),
  version: z.number(),
  holdRank: z.number().nullable().optional(),
  holdAutoPromote: z.boolean().optional(),
});

const ListResponse = z.object({
  items: z.array(EventResponse),
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
      const { cursor, limit, status } = request.query;

      // Correlated EXISTS keeps the result one row per event (a caller may reach
      // an event through several participants) while folding access into the WHERE.
      const reachable = exists(
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
            ),
          ),
      );

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
        .select()
        .from(schema.events)
        .where(and(reachable, status ? eq(schema.events.status, status) : undefined, afterCursor))
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
          return serializeEvent(event, capabilities);
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

      const subject = `Event update: ${event.title}`;
      const text = `There is an update to the event "${event.title}". Sign in to shoWMe to view the details.`;
      for (const recipient of recipients) {
        try {
          await request.server.emailSink.sendEmail({ to: recipient.email, subject, text });
        } catch (error) {
          request.log.error({ error }, "event notify email failed");
        }
      }

      return { queued: true };
    },
  );
}
