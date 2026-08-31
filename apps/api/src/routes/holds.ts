import { liveEventDelegations } from "@showme/auth";
import { schema } from "@showme/db";
import { eventParticipantRecipients, notifyUsers } from "@showme/db/notify";
import {
  type Capability,
  type HoldRankUpdate,
  type HoldSibling,
  competingHoldIds,
  computeDeclinePromotion,
  computeRankShift,
} from "@showme/shared";
import { type Column, type SQL, and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { conflict, forbidden, notFound } from "../errors";
import { writeActivity } from "../lib/activity";
import { writeAudit } from "../lib/audit";
import { eventCapabilities, requireEventCapability } from "../lib/authorize";
import { assertEventCapAllows } from "../lib/entitlements";

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

const AutoPromoteBody = z.object({ holdAutoPromote: z.boolean() });

const AutoPromoteResponse = z.object({ id: z.string(), holdAutoPromote: z.boolean() });

/**
 * What the holds panel reads. Every operator-only fact is `null`/empty for a
 * caller without `event.edit` — the same line `serialize/event.ts` draws around
 * `hold_rank`, drawn again here because this route bypasses that serializer.
 *
 * `canManageRank` / `canDecide` are the caller's OWN authority stated outright,
 * not inferred from the presence of a redacted field. `canDecide` in particular
 * cannot be derived from `capabilities[]` at all: `operator_full` carries
 * `agreement.confirm`, and the host is still never the act.
 */
const HoldStateResponse = z.object({
  id: z.string(),
  status: z.string(),
  eventDate: z.string().nullable(),
  holdRank: z.number().nullable(),
  holdAutoPromote: z.boolean().nullable(),
  pool: z.array(
    z.object({
      id: z.string(),
      /** `null` when the caller has no standing on that competing hold. */
      title: z.string().nullable(),
      holdRank: z.number(),
      holdAutoPromote: z.boolean(),
      isSelf: z.boolean(),
      /**
       * Whether the caller holds `event.edit` on THIS entry — i.e. whether a move
       * across it is theirs to make. The panel needs it to stop offering a rank
       * the rank route will refuse: taking a rank pushes the holds at or below it
       * down one, and a shared pool contains rows the caller may not push.
       *
       * Not derivable from `title === null`, which answers a different question
       * (`event.view`): a `view_only` co-host on a competing hold can read its
       * name and still may not reorder it. Stated outright, for the same reason
       * `canManageRank` and `canDecide` are.
       */
      canReorder: z.boolean(),
    }),
  ),
  canManageRank: z.boolean(),
  canDecide: z.boolean(),
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
 *
 * TWO NULLS THAT ARE NOT SHARED QUEUES. `matchNullable` turns a null column into
 * `IS NULL`, and on two of these columns that quietly pooled strangers together.
 * The shared queue is justified by ONE PHYSICAL ROOM that only one show can
 * occupy (decisions #20); where there is no room and no night, there is nothing
 * to share, and the null match was the bug rather than the rule.
 *
 * - **No date** → no pool at all. A hold is a claim on a date; without one it
 *   claims nothing. `event_date IS NULL` had matched every dateless hold in the
 *   database against every other.
 * - **No venue profile** → this host's own holds only. The create-event wizard
 *   captures a free-text venue NAME, so its holds carry neither `venue_profile_id`
 *   nor `stage_id`, and `IS NULL` put every unpinned hold on a date into one
 *   platform-wide queue: taking "1st hold" from the wizard silently demoted a
 *   stranger's pencil in another city. An operator still cannot run two shows on
 *   one night, so their OWN unpinned holds keep queueing together.
 *
 * `stage_id IS NULL` under a real venue profile stays a shared pool, and should:
 * that is one venue's unassigned room, and two operators pencilling it are
 * competing for the same building on the same night.
 */
async function loadSiblings(
  request: FastifyRequest,
  event: EventRow,
  includeTarget: boolean,
): Promise<EventRow[]> {
  if (event.eventDate === null) return includeTarget ? [event] : [];
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
        // No room, no shared queue — see the second bullet above.
        event.venueProfileId === null
          ? eq(schema.events.hostProfileId, event.hostProfileId)
          : undefined,
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
 * Of these holds, the ones the caller may WRITE — resolved through the one
 * authorization module, per hold, exactly as the pool read resolves each title.
 *
 * THE POOL IS SHARED; THE ROWS ARE NOT. A pool is keyed on (date, venue, stage)
 * and deliberately not scoped to one host, because one physical room on one night
 * is one queue and two operators courting that night genuinely are in it together
 * — separate queues would tell both of them they are first in line. But every
 * pencil in it is a separate EVENT belonging to a separate operator, and an
 * operator's authority stops at their own row. So every cascade in this file asks
 * this first: it decides which rank moves a caller is allowed to make at all, and
 * whose name may go on the ones the cascade makes anyway.
 *
 * Reads are untouched by any of it — a rival's title is withheld and stays
 * withheld (`GET /events/:id/hold`); this is about the WRITES.
 */
async function writableHoldIds(request: FastifyRequest, rows: EventRow[]): Promise<Set<string>> {
  const writable = new Set<string>();
  for (const row of rows) {
    const capabilities = await eventCapabilities(request, row.id);
    if (capabilities.has("event.edit")) writable.add(row.id);
  }
  return writable;
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
  if (!(await callerIsBookedAct(request, eventId))) {
    throw forbidden("Only the booked performer, or their agent, can confirm or decline this hold");
  }
}

/**
 * Condition 2 of the rule above, asked WITHOUT throwing: is this caller the act
 * the date is held for, or the agent that act delegated to on this very event?
 *
 * Split out because `GET /events/:id/hold` has to answer "may I accept or turn
 * down this date?" honestly, and `agreement.confirm` alone is not that answer —
 * `operator_full` carries it, and the operator is never the act. A panel that
 * gated its buttons on the capability would offer the host a Confirm button whose
 * click comes back 403, which is exactly what `capabilities[]` exists to end
 * (`serialize/event.ts`).
 */
async function callerIsBookedAct(request: FastifyRequest, eventId: string): Promise<boolean> {
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

  return isBookedAct || representsBookedAct;
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

      // TAKING A RANK PUSHES THE HOLDS AT OR BELOW IT DOWN ONE — and in a pool
      // this caller shares with another operator, some of those rows are not
      // theirs. Nobody demotes a pencil they do not hold: an operator who could
      // would simply declare themselves first on every date in the building.
      //
      // Refused rather than silently trimmed. Writing the caller's own half of the
      // shift and dropping the rest would leave two holds claiming one number,
      // which is the same lie in the other direction. 409 rather than 403 because
      // the caller IS allowed to rank this hold — it is the pool's contents that
      // refuse this particular number, and they change.
      const writableSiblings = await writableHoldIds(request, siblingRows);
      // The target itself: `event.edit` on it was asserted before anything was read.
      writableSiblings.add(event.id);
      if (updates.some((update) => !writableSiblings.has(update.id))) {
        throw conflict(
          "Another operator holds that rank on this date — you can only reorder your own holds",
        );
      }

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
        // THE ROOM IS TAKEN. The losing holds are separate EVENTS, each with its
        // own history and its own operator — who may be a total stranger to this
        // one — and each just lost the date. Their rows are written here because
        // that is what one queue for one room means; they are NOT written as this
        // caller's act, and the trail must not say otherwise.
        //
        // `actor: "system"` on both rows, always, even inside a single operator's
        // own pool: whoever confirms confirms exactly ONE event, the one they were
        // authorized on. They did not cancel the third pencil on the date — the
        // venue's state changing did. `capability: null` follows the same rule the
        // platform-admin routes use: no capability was checked here, so naming one
        // would record a check that never happened.
        //
        // The audit row is new. Until it existed, a rival's hold could go from
        // `on_hold` to `cancelled` with nothing on its own event to show for it —
        // the only record lived in the winner's audit entry, on an event that
        // operator cannot read. The count of siblings stays deliberately absent
        // from the feed line: an operator's other pencils are not this event's
        // business, only the fact that this one lost the date.
        for (const cancelledId of cancelledIds) {
          await writeAudit(tx, request, {
            actor: "system",
            capability: null,
            action: "hold.released_room_taken",
            targetKind: "event",
            targetId: cancelledId,
            eventId: cancelledId,
            before: { status: "on_hold" },
            after: { status: "cancelled", reason: "room_taken" },
          });
          await writeActivity(tx, request, {
            actor: "system",
            eventId: cancelledId,
            type: "hold.lost",
            targetKind: "event",
            targetId: cancelledId,
            summary: { to: "cancelled", reason: "room_taken" },
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
          // Recipients are resolved WITH the actor (they never need telling about
          // their own click); the notification is then stored with NO actor. The
          // bell renders `actorDisplay` beside the line, and a rival operator must
          // not read a stranger's name against the loss of their own date — the
          // room was taken, and the body already says exactly that. The `hold.*`
          // prefix puts this under the "holds" preference category, so the one
          // gate inside `notifyUsers` decides delivery; nothing is gated here.
          const lost = await eventParticipantRecipients(database, cancelledId, actorUserId);
          await notifyUsers(database, lost, null, {
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
      const { id } = request.params;
      await requireBookingDecision(request, id);
      return dropHoldAndRepack(request, id, {
        capability: "agreement.confirm",
        auditAction: "hold.decline",
        activityType: "hold.declined",
      });
    },
  );

  // Release: the OPERATOR withdraws their own pencil. Same effect on the pool as a
  // decline — the date is given up and the survivors compact — but a different act
  // with a different authority, so it is a different route rather than a widened
  // `decline`. `decline` is the act TURNING THE DATE DOWN, and `requireBookingDecision`
  // exists precisely to keep the host out of that sentence; the history has to be
  // able to say which of the two happened.
  app.post(
    "/events/:id/hold/release",
    { schema: { params: EventParams, response: { 200: DeclineResponse } } },
    async (request) => {
      const { id } = request.params;
      await requireEventCapability(request, id, "event.edit");
      return dropHoldAndRepack(request, id, {
        capability: "event.edit",
        auditAction: "hold.release",
        activityType: "hold.released",
      });
    },
  );

  // Auto-promote: operator-only (`event.edit`). The ONLY writer of the column —
  // until now `hold_auto_promote` was reachable from no route at all, so every hold
  // sat on the schema default (`false`, `packages/db/src/schema/events.ts`) and was
  // FROZEN: `computeDeclinePromotion` skips a hold with `holdAutoPromote === false`,
  // so a 2nd hold never moved up when the 1st was turned down. The column was read
  // by the math and written by nobody.
  app.post(
    "/events/:id/hold/auto-promote",
    {
      schema: {
        params: EventParams,
        body: AutoPromoteBody,
        response: { 200: AutoPromoteResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;
      const { holdAutoPromote } = request.body;

      await requireEventCapability(request, id, "event.edit");
      const [event] = await database.select().from(schema.events).where(eq(schema.events.id, id));
      if (!event) throw notFound("Event not found");

      await database.transaction(async (tx) => {
        await tx
          .update(schema.events)
          .set({
            holdAutoPromote,
            version: sql`${schema.events.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(schema.events.id, event.id));
        await writeAudit(tx, request, {
          capability: "event.edit",
          action: "hold.auto_promote",
          targetKind: "event",
          targetId: event.id,
          eventId: event.id,
          before: { holdAutoPromote: event.holdAutoPromote },
          after: { holdAutoPromote },
        });
        // Kind `hold`, like the rank line: whether a pencil moves up on its own is
        // the same private queue business as the number it moves from.
        await writeActivity(tx, request, {
          eventId: event.id,
          type: "hold.auto_promote_set",
          targetKind: "hold",
          targetId: event.id,
          summary: { from: event.holdAutoPromote, to: holdAutoPromote },
        });
      });

      return { id: event.id, holdAutoPromote };
    },
  );

  // The panel's one read. `event.view` (404 below it), and every operator-only fact
  // — the rank, the freeze flag, the pool — is withheld from everyone else, exactly
  // as `serialize/event.ts` withholds `hold_rank`: a performer authorized to VIEW
  // the event still never sees where they rank.
  app.get(
    "/events/:id/hold",
    { schema: { params: EventParams, response: { 200: HoldStateResponse } } },
    async (request) => {
      const { database } = request.server;
      const { id } = request.params;

      const capabilities = await requireEventCapability(request, id, "event.view");
      const [event] = await database.select().from(schema.events).where(eq(schema.events.id, id));
      if (!event) throw notFound("Event not found");

      const canManageRank = capabilities.has("event.edit");
      const canDecide =
        capabilities.has("agreement.confirm") && (await callerIsBookedAct(request, id));

      if (!canManageRank) {
        return {
          id: event.id,
          status: event.status,
          eventDate: event.eventDate,
          holdRank: null,
          holdAutoPromote: null,
          pool: [],
          canManageRank: false,
          canDecide,
        };
      }

      // The pool the SERVER ranks by, not one re-derived on the client from its own
      // event list — those two disagree the moment a hold the caller cannot see
      // joins the date, and the client's version would offer a rank the rank route
      // would not honour.
      const siblingRows =
        event.status === "on_hold" ? await loadSiblings(request, event, true) : [];
      const pool = [];
      for (const row of siblingRows) {
        // A pool is matched by (date, venue, stage) and is NOT scoped to one host, so
        // a competing pencil can belong to an operator this caller has no standing
        // with. The rank route already discloses those ids in its response; the
        // TITLE — who is being courted for the date — is somebody else's business, so
        // it is fetched through the same authorization module as every other read.
        const rowCapabilities =
          row.id === event.id ? capabilities : await eventCapabilities(request, row.id);
        pool.push({
          id: row.id,
          title: rowCapabilities.has("event.view") ? row.title : null,
          holdRank: row.holdRank ?? 1,
          holdAutoPromote: row.holdAutoPromote,
          isSelf: row.id === event.id,
          canReorder: rowCapabilities.has("event.edit"),
        });
      }
      pool.sort((left, right) => left.holdRank - right.holdRank);

      return {
        id: event.id,
        status: event.status,
        eventDate: event.eventDate,
        holdRank: event.holdRank,
        holdAutoPromote: event.holdAutoPromote,
        pool,
        canManageRank: true,
        canDecide,
      };
    },
  );
}

/**
 * Give up a hold and let the queue close behind it — the shared body of `decline`
 * (the act turns the date down) and `release` (the operator withdraws it). The two
 * differ only in who is allowed to ask and what the history calls it, which is what
 * `intent` carries; the effect on the pool is one rule and stays in one place.
 */
async function dropHoldAndRepack(
  request: FastifyRequest,
  eventId: string,
  intent: { capability: Capability; auditAction: string; activityType: string },
): Promise<{ id: string; status: string; promoted: HoldRankUpdate[] }> {
  const { database } = request.server;

  const [event] = await database.select().from(schema.events).where(eq(schema.events.id, eventId));
  if (!event) throw notFound("Event not found");

  const remainingSiblings = await loadSiblings(request, event, false);
  const promotions = computeDeclinePromotion({
    siblings: toHoldSiblings(remainingSiblings),
    removedRank: event.holdRank ?? 1,
  });
  // Resolved BEFORE the transaction opens: the test pool is `max: 1`, so a query
  // nested inside `database.transaction` deadlocks rather than failing.
  const writableSiblings = await writableHoldIds(request, remainingSiblings);

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
      capability: intent.capability,
      action: intent.auditAction,
      targetKind: "event",
      targetId: event.id,
      eventId: event.id,
      before: { status: event.status, holdRank: event.holdRank },
      after: { status: "cancelled", promoted: promotions },
    });
    await writeActivity(tx, request, {
      eventId: event.id,
      type: intent.activityType,
      targetKind: "event",
      targetId: event.id,
      summary: { from: event.status, to: "cancelled" },
    });
    // A promotion is a rank move on ANOTHER event — operator-only there, for the
    // same reason the rank route is.
    //
    // Whose move it was depends on whose hold it is. An operator withdrawing one of
    // their own pencils and watching the next one step up is doing their own
    // housekeeping, and their name belongs on it. A pencil belonging to somebody
    // else moves up because the queue closed, not because this caller touched it —
    // and on the decline path the caller is the ACT, who holds no authority over any
    // hold in the pool, so every promotion there is a consequence. That row gets its
    // own actor-less audit entry too: it is the only trace of the write that lands
    // on an event its own operator can actually read.
    for (const promotion of promotions) {
      const isOwn = writableSiblings.has(promotion.id);
      if (!isOwn) {
        const previous = remainingSiblings.find((row) => row.id === promotion.id);
        await writeAudit(tx, request, {
          actor: "system",
          capability: null,
          action: "hold.promoted_queue_closed",
          targetKind: "event",
          targetId: promotion.id,
          eventId: promotion.id,
          before: { holdRank: previous?.holdRank ?? null },
          after: { holdRank: promotion.holdRank, reason: "queue_closed" },
        });
      }
      await writeActivity(tx, request, {
        actor: isOwn ? "caller" : "system",
        eventId: promotion.id,
        type: "hold.promoted",
        targetKind: "hold",
        targetId: promotion.id,
        summary: { to: promotion.holdRank, reason: "queue_closed" },
      });
    }
  });

  return { id: event.id, status: "cancelled", promoted: promotions };
}
