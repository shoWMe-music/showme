import { liveEventDelegations } from "@showme/auth";
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
import { writeActivity } from "../lib/activity";
import { writeAudit } from "../lib/audit";
import { requireEventCapability } from "../lib/authorize";
import { assertEventCapAllows } from "../lib/entitlements";
import { eventParticipantRecipients, notifyUsers } from "../lib/notify";

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
 * Assert the caller may ACCEPT OR DECLINE this date. Two conditions, both required:
 *
 * 1. `agreement.confirm` — decided by the capability engine, never by a role string
 *    (`.claude/skills/authorization`: one module, never split across layers). A
 *    performer whose participation is DELEGATED to their agent (decisions #14) has
 *    handed this capability over and is read-only here; crew never held it.
 * 2. The caller stands on this event as the BOOKED act — a `performer` participant
 *    (the act the date is held for), or the AGENT that act delegated to on this very
 *    event, whose job this is: *"the agent negotiates and confirms while the
 *    performer's own screens go read-only"* (`docs/story.md`). Resolved per-event
 *    from the delegation stamp — never a blanket event-level grant.
 *
 * A `support` act holds `agreement.confirm` for its OWN agreement but is not the
 * booked act: confirming here would confirm — or cancel — the headliner's show. The
 * operator holds the date open; they never accept it on the act's behalf.
 */
async function requireBookingDecision(request: FastifyRequest, eventId: string): Promise<void> {
  // The one authorization module decides the capability. 404 without `event.view`.
  await requireEventCapability(request, eventId, "agreement.confirm");

  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");
  const profileIds = new Set(principal.memberships.map((membership) => membership.profileId));

  const participants = await request.server.database
    .select({
      profileId: schema.eventParticipants.profileId,
      role: schema.eventParticipants.role,
      details: schema.eventParticipants.details,
    })
    .from(schema.eventParticipants)
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        ne(schema.eventParticipants.status, "removed"),
      ),
    );

  const bookedActs = participants.filter((row) => row.role === "performer");
  const isBookedAct = bookedActs.some((row) => profileIds.has(row.profileId));

  // "Their agent" means an agent a LIVE representation still puts behind a booked
  // act. The `delegatedToAgentProfileId` stamp survives an effective-dated
  // termination until the sweep clears it, so reading it raw would let an agent
  // whose notice has already expired accept or decline a hold on the act's behalf
  // (A-19 follow-up). One keyed query answers it the same way the capability engine
  // does — the stamp is the candidate, the representation is the authority.
  const bookedActProfileIds = new Set(bookedActs.map((row) => row.profileId));
  const delegations = await liveEventDelegations(request.server.database, eventId);
  const representsBookedAct = delegations.some(
    (delegation) =>
      profileIds.has(delegation.agentProfileId) &&
      bookedActProfileIds.has(delegation.performerProfileId),
  );

  if (!isBookedAct && !representsBookedAct) {
    throw forbidden("Only the booked performer, or their agent, can confirm or decline this hold");
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
        // Kind `hold`, NOT `event`: where an act sits in the hold pool is the
        // operator's private competitive information — `serialize/event.ts` keeps
        // `holdRank` behind `event.edit`, and the feed keeps the same line.
        await writeActivity(tx, request, {
          eventId: event.id,
          type: "hold.ranked",
          targetKind: "hold",
          targetId: event.id,
          summary: { from: event.holdRank, to: request.body.holdRank },
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

  // Confirm: the booked performer — or the agent they delegated to — accepts the
  // date. The event becomes `confirmed`; every competing sibling hold is `cancelled`.
  app.post(
    "/events/:id/hold/confirm",
    { schema: { params: EventParams, response: { 200: ConfirmResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      await requireBookingDecision(request, id);

      const [event] = await database.select().from(schema.events).where(eq(schema.events.id, id));
      if (!event) throw notFound("Event not found");

      // Entitlement gate (decisions #4/§C, PLAN.md:613): accepting a hold moves the
      // event `on_hold` -> `confirmed`, i.e. INTO the counted set — the same cap the
      // PATCH path charges, so it runs through the same helper (audit A-20). Charged
      // to the HOST's plan, not the confirming performer's. Composed AFTER the
      // authorization check above, never conflated with it.
      await assertEventCapAllows(database, event, "confirmed");

      const siblingRows = await loadSiblings(request, event, false);
      const cancelledIds = competingHoldIds({ siblings: toHoldSiblings(siblingRows) });
      // The cascade only ever writes `cancelled` (and, on decline, `hold_rank`) —
      // transitions OUT of the counted set consume no cap and are never gated.

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
          capability: "agreement.confirm",
          action: "hold.confirm",
          targetKind: "event",
          targetId: event.id,
          eventId: event.id,
          before: { status: event.status },
          after: { status: "confirmed", cancelled: cancelledIds },
        });
        await writeActivity(tx, request, {
          eventId: event.id,
          type: "hold.confirmed",
          targetKind: "event",
          targetId: event.id,
          summary: { from: event.status, to: "confirmed" },
        });
        // The losing holds are separate EVENTS, each with its own history, and each
        // just got cancelled out from under its participants. The count of siblings
        // is deliberately absent: an operator's other pencils are not this event's
        // business, only the fact that this one lost the date.
        for (const cancelledId of cancelledIds) {
          await writeActivity(tx, request, {
            eventId: cancelledId,
            type: "hold.lost",
            targetKind: "event",
            targetId: cancelledId,
            summary: { to: "cancelled" },
          });
        }
      });

      // Realtime + feed: a hold confirmation resolves a date for everyone waiting on
      // it — and the losing side needs it MORE than the winner, because their event
      // just got cancelled out from under them. Both sides, best-effort, post-commit.
      try {
        const actorUserId = request.principal?.userId ?? null;
        const won = await eventParticipantRecipients(database, event.id, actorUserId);
        await notifyUsers(database, won, actorUserId, {
          type: "hold.confirmed",
          title: `"${event.title ?? "The event"}" is confirmed`,
          body: "The date is yours.",
          eventId: event.id,
          actorDisplay: request.firebaseUser?.name ?? undefined,
          link: `/events/${event.id}`,
        });
        for (const cancelledId of cancelledIds) {
          const lost = await eventParticipantRecipients(database, cancelledId, actorUserId);
          await notifyUsers(database, lost, actorUserId, {
            type: "hold.lost",
            title: "A held date was released",
            body: "Another hold on this date was confirmed, so yours was cancelled.",
            eventId: cancelledId,
            link: `/events/${cancelledId}`,
          });
        }
      } catch (error) {
        request.log.error({ error, eventId: event.id }, "hold-confirm notification failed");
      }

      return { id: event.id, status: "confirmed", cancelled: cancelledIds };
    },
  );

  // Decline: the booked performer — or their agent — rejects the date. The event is
  // `cancelled`; the surviving auto-promote holds compact down to fill the vacated rank.
  app.post(
    "/events/:id/hold/decline",
    { schema: { params: EventParams, response: { 200: DeclineResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      await requireBookingDecision(request, id);

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
          capability: "agreement.confirm",
          action: "hold.decline",
          targetKind: "event",
          targetId: event.id,
          eventId: event.id,
          before: { status: event.status, holdRank: event.holdRank },
          after: { status: "cancelled", promoted: promotions },
        });
        await writeActivity(tx, request, {
          eventId: event.id,
          type: "hold.declined",
          targetKind: "event",
          targetId: event.id,
          summary: { from: event.status, to: "cancelled" },
        });
        // A promotion is a rank move on ANOTHER event — operator-only there, for the
        // same reason the rank route is.
        for (const promotion of promotions) {
          await writeActivity(tx, request, {
            eventId: promotion.id,
            type: "hold.promoted",
            targetKind: "hold",
            targetId: promotion.id,
            summary: { to: promotion.holdRank },
          });
        }
      });

      return { id: event.id, status: "cancelled", promoted: promotions };
    },
  );
}
