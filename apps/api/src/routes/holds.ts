import { schema } from "@showme/db";
import {
  type HoldSibling,
  competingHoldIds,
  computeDeclinePromotion,
  computeRankShift,
} from "@showme/shared";
import { type Column, type SQL, and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { forbidden, notFound } from "../errors";
import { writeAudit } from "../lib/audit";
import { requireEventCapability } from "../lib/authorize";

const EventParams = z.object({ id: z.string().uuid() });

const RankBody = z.object({ holdRank: z.number().int().positive() });

const RankResponse = z.object({
  ranks: z.array(z.object({ id: z.string(), holdRank: z.number().nullable() })),
});

const ConfirmResponse = z.object({
  id: z.string(),
  status: z.string(),
  cancelled: z.array(z.string()),
});

const DeclineResponse = z.object({
  id: z.string(),
  status: z.string(),
  promoted: z.array(z.object({ id: z.string(), holdRank: z.number().nullable() })),
});

type EventRow = typeof schema.events.$inferSelect;

/** `= value`, or `IS NULL` when the value is null — SQL `= null` never matches. */
function matchNullable(column: Column, value: unknown): SQL {
  return value === null ? isNull(column) : eq(column, value);
}

/**
 * The competing holds for an event: other `on_hold` events sharing the exact
 * `(event_date, venue_profile_id, stage_id)`. `includeTarget` keeps the event
 * itself in the pool (the rank math needs the full picture); confirm/decline
 * exclude it (they act on the siblings around a fixed target).
 */
async function loadSiblings(
  request: FastifyRequest,
  event: EventRow,
  includeTarget: boolean,
): Promise<EventRow[]> {
  const { database } = request.server;
  return database
    .select()
    .from(schema.events)
    .where(
      and(
        eq(schema.events.status, "on_hold"),
        matchNullable(schema.events.eventDate, event.eventDate),
        matchNullable(schema.events.venueProfileId, event.venueProfileId),
        matchNullable(schema.events.stageId, event.stageId),
        includeTarget ? undefined : ne(schema.events.id, event.id),
      ),
    );
}

/** Shape event rows into the pure-logic `HoldSibling[]` (rank defaults to 1). */
function toHoldSiblings(rows: EventRow[]): HoldSibling[] {
  return rows.map((row) => ({
    id: row.id,
    holdRank: row.holdRank ?? 1,
    holdAutoPromote: row.holdAutoPromote,
  }));
}

/**
 * Assert the caller is the BOOKED performer on this event — one of their profiles
 * joins it as a `performer`/`support` participant (PLAN §G: only the booked
 * performer confirms/declines a date). Wrong relationship is a 403.
 */
async function requireBookedPerformer(request: FastifyRequest, eventId: string): Promise<void> {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");
  const profileIds = principal.memberships.map((membership) => membership.profileId);
  if (profileIds.length === 0) {
    throw forbidden("Only the booked performer can confirm or decline this hold");
  }
  const rows = await request.server.database
    .select({ id: schema.eventParticipants.id })
    .from(schema.eventParticipants)
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        inArray(schema.eventParticipants.profileId, profileIds),
        inArray(schema.eventParticipants.role, ["performer", "support"]),
      ),
    );
  if (rows.length === 0) {
    throw forbidden("Only the booked performer can confirm or decline this hold");
  }
}

export async function holdRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Rank: operator-only (`event.edit`). Re-rank the target within its hold pool,
  // shifting the colliding siblings, and persist the diff in one transaction.
  app.post(
    "/events/:id/hold/rank",
    { schema: { params: EventParams, body: RankBody, response: { 200: RankResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      await requireEventCapability(request, id, "event.edit");
      const [event] = await database.select().from(schema.events).where(eq(schema.events.id, id));
      if (!event) throw notFound("Event not found");

      const siblingRows = await loadSiblings(request, event, true);
      const updates = computeRankShift({
        siblings: toHoldSiblings(siblingRows),
        targetId: event.id,
        oldRank: event.holdRank ?? 1,
        newRank: request.body.holdRank,
      });

      await database.transaction(async (tx) => {
        for (const update of updates) {
          await tx
            .update(schema.events)
            .set({
              holdRank: update.holdRank,
              version: sql`${schema.events.version} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(schema.events.id, update.id));
        }
        await writeAudit(tx, request, {
          capability: "event.edit",
          action: "hold.rank",
          targetKind: "event",
          targetId: event.id,
          eventId: event.id,
          before: { holdRank: event.holdRank },
          after: { holdRank: request.body.holdRank, updates },
        });
      });

      const ranked = await loadSiblings(request, event, true);
      return {
        ranks: ranked
          .sort((left, right) => (left.holdRank ?? 1) - (right.holdRank ?? 1))
          .map((row) => ({ id: row.id, holdRank: row.holdRank })),
      };
    },
  );

  // Confirm: the booked performer accepts the date. The event becomes
  // `confirmed`; every competing sibling hold is `cancelled`.
  app.post(
    "/events/:id/hold/confirm",
    { schema: { params: EventParams, response: { 200: ConfirmResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      await requireEventCapability(request, id, "event.view");
      await requireBookedPerformer(request, id);

      const [event] = await database.select().from(schema.events).where(eq(schema.events.id, id));
      if (!event) throw notFound("Event not found");

      const siblingRows = await loadSiblings(request, event, false);
      const cancelledIds = competingHoldIds({ siblings: toHoldSiblings(siblingRows) });

      await database.transaction(async (tx) => {
        await tx
          .update(schema.events)
          .set({
            status: "confirmed",
            version: sql`${schema.events.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(schema.events.id, event.id));
        if (cancelledIds.length > 0) {
          await tx
            .update(schema.events)
            .set({
              status: "cancelled",
              version: sql`${schema.events.version} + 1`,
              updatedAt: new Date(),
            })
            .where(inArray(schema.events.id, cancelledIds));
        }
        await writeAudit(tx, request, {
          capability: "event.view",
          action: "hold.confirm",
          targetKind: "event",
          targetId: event.id,
          eventId: event.id,
          before: { status: event.status },
          after: { status: "confirmed", cancelled: cancelledIds },
        });
      });

      return { id: event.id, status: "confirmed", cancelled: cancelledIds };
    },
  );

  // Decline: the booked performer rejects the date. The event is `cancelled`;
  // the surviving auto-promote holds compact down to fill the vacated rank.
  app.post(
    "/events/:id/hold/decline",
    { schema: { params: EventParams, response: { 200: DeclineResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      await requireEventCapability(request, id, "event.view");
      await requireBookedPerformer(request, id);

      const [event] = await database.select().from(schema.events).where(eq(schema.events.id, id));
      if (!event) throw notFound("Event not found");

      const remainingSiblings = await loadSiblings(request, event, false);
      const promotions = computeDeclinePromotion({
        siblings: toHoldSiblings(remainingSiblings),
        removedRank: event.holdRank ?? 1,
      });

      await database.transaction(async (tx) => {
        await tx
          .update(schema.events)
          .set({
            status: "cancelled",
            version: sql`${schema.events.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(schema.events.id, event.id));
        for (const promotion of promotions) {
          await tx
            .update(schema.events)
            .set({
              holdRank: promotion.holdRank,
              version: sql`${schema.events.version} + 1`,
              updatedAt: new Date(),
            })
            .where(eq(schema.events.id, promotion.id));
        }
        await writeAudit(tx, request, {
          capability: "event.view",
          action: "hold.decline",
          targetKind: "event",
          targetId: event.id,
          eventId: event.id,
          before: { status: event.status, holdRank: event.holdRank },
          after: { status: "cancelled", promoted: promotions },
        });
      });

      return { id: event.id, status: "cancelled", promoted: promotions };
    },
  );
}
