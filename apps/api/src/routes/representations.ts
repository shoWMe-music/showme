import { schema } from "@showme/db";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, forbidden, notFound } from "../errors";
import {
  assignAgentToEvents,
  delegatableEvents,
  unassignAgentFromOpenEvents,
} from "../lib/agent-assignment";
import { writeAudit } from "../lib/audit";
import { requireProfileRole } from "../lib/authorize";
import {
  type RepresentationParty,
  applyCounter,
  assertDisjoint,
} from "../lib/representation-rules";

/**
 * Representations — the standing agent↔performer agreement (decisions.md #14).
 * Symmetric two-party handshake: either side proposes, the proposer auto-confirms,
 * the counterparty accepts (→ active) or counters (edit terms, re-stamp proposer,
 * clear the counterparty's confirmation). Either side may terminate unilaterally.
 *
 * Authorization is per-profile ownership: a caller acts for a representation only
 * if they own/admin the profile on the side they are acting as. No event
 * capabilities here — this agreement is set OFF-event; its projection onto events
 * (`event_participants(role=agent)`) is a separate concern.
 *
 * Agent assignment (decisions #14): on accept the performer picks which CURRENT
 * (non-concluded) in-region events to hand over — `GET .../delegatable-events` for
 * the picker, `POST .../events` with `{eventIds}` or `{all:true}`. FUTURE in-region
 * events assign automatically when the performer joins them (participants route).
 * Assigning materializes the agent as a participant and drops the performer to
 * view-only; on termination the performer regains every still-open event. See
 * `lib/agent-assignment.ts`. The representation-scoped commission settlement
 * (`settlements.representation_id`) is derived on settlement compute — see
 * `lib/commission-settlement.ts`.
 */

const RepresentationParams = z.object({ id: z.string().uuid() });
const representationParty = z.enum(["agent", "performer"]);

const ProposeBody = z.object({
  agentProfileId: z.string().uuid(),
  performerProfileId: z.string().uuid(),
  region: z.array(z.string()).default([]),
  isWorldwide: z.boolean().optional(),
  commissionRate: z.number().int(), // basis points
  commissionableBasis: z.string().optional(),
  agentCollects: z.boolean().optional(),
  proposedBy: representationParty,
});

const PatchBody = z.object({
  action: z.enum(["accept", "counter", "terminate"]),
  // accept-only: the current (non-concluded) events the performer hands the agent.
  eventIds: z.array(z.string().uuid()).optional(),
  // counter-only term edits (all optional)
  region: z.array(z.string()).optional(),
  isWorldwide: z.boolean().optional(),
  commissionRate: z.number().int().optional(),
  commissionableBasis: z.string().optional(),
  agentCollects: z.boolean().optional(),
  // terminate-only
  terminatedEffectiveAt: z.string().datetime().optional(),
});

// The performer either selects specific current events, or hands over "all" of them.
const GrantEventsBody = z.union([
  z.object({ eventIds: z.array(z.string().uuid()).min(1) }),
  z.object({ all: z.literal(true) }),
]);

const DelegatableEventsResponse = z.object({
  events: z.array(
    z.object({ eventId: z.string(), title: z.string(), alreadyAssigned: z.boolean() }),
  ),
});

const RepresentationResponse = z.object({
  id: z.string(),
  agentProfileId: z.string(),
  performerProfileId: z.string(),
  region: z.array(z.string()).nullable(),
  isWorldwide: z.boolean(),
  commissionRate: z.number().nullable(),
  commissionableBasis: z.string().nullable(),
  agentCollects: z.boolean(),
  proposedBy: z.string(),
  status: z.string(),
  confirmedByAgent: z.boolean(),
  confirmedByPerformer: z.boolean(),
  terminatedAt: z.string().nullable(),
  terminatedEffectiveAt: z.string().nullable(),
  terminatedBy: z.string().nullable(),
});

type RepresentationRow = typeof schema.representations.$inferSelect;

/** Shape a representation row for the wire (Date columns → ISO strings). */
function serializeRepresentation(row: RepresentationRow): z.infer<typeof RepresentationResponse> {
  return {
    id: row.id,
    agentProfileId: row.agentProfileId,
    performerProfileId: row.performerProfileId,
    region: row.region,
    isWorldwide: row.isWorldwide,
    commissionRate: row.commissionRate,
    commissionableBasis: row.commissionableBasis,
    agentCollects: row.agentCollects,
    proposedBy: row.proposedBy,
    status: row.status,
    confirmedByAgent: row.confirmedByAgent,
    confirmedByPerformer: row.confirmedByPerformer,
    terminatedAt: row.terminatedAt?.toISOString() ?? null,
    terminatedEffectiveAt: row.terminatedEffectiveAt?.toISOString() ?? null,
    terminatedBy: row.terminatedBy,
  };
}

const CONTROL_ROLES = ["owner", "admin"] as const;

/**
 * Does the caller own/admin `profileId`? Uses `requireProfileRole` (the canonical
 * per-profile role check) and folds its throw into a boolean so the route can try
 * the relevant side, then decide the status code itself (403 for "neither side").
 */
function controlsProfile(request: FastifyRequest, profileId: string): boolean {
  try {
    requireProfileRole(request, profileId, [...CONTROL_ROLES]);
    return true;
  } catch {
    return false;
  }
}

/** Assert the caller controls `profileId`, else 403 (they cannot act as that side). */
function requireControls(request: FastifyRequest, profileId: string): void {
  if (!controlsProfile(request, profileId)) {
    throw forbidden("You do not control this side of the representation");
  }
}

/** Which side (agent/performer) the caller acts as, or null if neither. */
function callerSide(request: FastifyRequest, row: RepresentationRow): RepresentationParty | null {
  if (controlsProfile(request, row.agentProfileId)) return "agent";
  if (controlsProfile(request, row.performerProfileId)) return "performer";
  return null;
}

/** The side of the current offer that did NOT make it — the one who may accept. */
function counterpartyOf(row: RepresentationRow): RepresentationParty {
  return row.proposedBy === "agent" ? "performer" : "agent";
}

/** The profile id on a given side of the representation. */
function profileIdForSide(row: RepresentationRow, side: RepresentationParty): string {
  return side === "agent" ? row.agentProfileId : row.performerProfileId;
}

/** Load a representation by id, or 404. */
async function loadRepresentation(request: FastifyRequest, id: string): Promise<RepresentationRow> {
  const [row] = await request.server.database
    .select()
    .from(schema.representations)
    .where(eq(schema.representations.id, id));
  if (!row) throw notFound("Representation not found");
  return row;
}

export async function representationRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // List representations where the caller owns/admins the agent or performer side.
  app.get(
    "/representations",
    { schema: { response: { 200: z.array(RepresentationResponse) } } },
    async (request) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const controlledIds = principal.memberships
        .filter((membership) => (CONTROL_ROLES as readonly string[]).includes(membership.role))
        .map((membership) => membership.profileId);
      if (controlledIds.length === 0) return [];

      const rows = await database
        .select()
        .from(schema.representations)
        .where(
          or(
            inArray(schema.representations.agentProfileId, controlledIds),
            inArray(schema.representations.performerProfileId, controlledIds),
          ),
        );
      return rows.map(serializeRepresentation);
    },
  );

  // Propose — either side opens the offer, auto-confirming its own side. The
  // disjoint-region invariant is enforced against the performer's ACTIVE reps.
  app.post(
    "/representations",
    { schema: { body: ProposeBody, response: { 201: RepresentationResponse } } },
    async (request, reply) => {
      const { database } = request.server;
      const body = request.body;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      // Authorize the side the caller claims to be proposing as.
      const proposerProfileId =
        body.proposedBy === "agent" ? body.agentProfileId : body.performerProfileId;
      requireControls(request, proposerProfileId);

      // One active agent per performer per region — proposed region must be disjoint.
      const activeReps = await database
        .select()
        .from(schema.representations)
        .where(
          and(
            eq(schema.representations.performerProfileId, body.performerProfileId),
            eq(schema.representations.status, "active"),
          ),
        );
      assertDisjoint(
        activeReps.map((rep) => ({ region: rep.region, isWorldwide: rep.isWorldwide })),
        { region: body.region, isWorldwide: body.isWorldwide ?? false },
      );

      const created = await database.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.representations)
          .values({
            agentProfileId: body.agentProfileId,
            performerProfileId: body.performerProfileId,
            region: body.region,
            isWorldwide: body.isWorldwide ?? false,
            commissionRate: body.commissionRate,
            commissionableBasis: body.commissionableBasis ?? null,
            agentCollects: body.agentCollects ?? false,
            proposedBy: body.proposedBy,
            status: "proposed",
            confirmedByAgent: body.proposedBy === "agent",
            confirmedByPerformer: body.proposedBy === "performer",
          })
          .returning();
        if (!row) throw new Error("representation create failed");
        await writeAudit(tx, request, {
          capability: "members.manage",
          action: "representation.propose",
          targetKind: "representation",
          targetId: row.id,
          after: row,
        });
        return row;
      });

      return reply.status(201).send(serializeRepresentation(created));
    },
  );

  // Respond to an offer — accept / counter / terminate.
  app.patch(
    "/representations/:id",
    {
      schema: {
        params: RepresentationParams,
        body: PatchBody,
        response: { 200: RepresentationResponse },
      },
    },
    async (request) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const before = await loadRepresentation(request, request.params.id);
      const body = request.body;

      if (body.action === "accept") {
        // Only the counterparty (the side that did NOT make the current offer) accepts.
        const accepting = counterpartyOf(before);
        requireControls(request, profileIdForSide(before, accepting));
        if (before.status !== "proposed") {
          throw badRequest("Only a proposed representation can be accepted");
        }

        const confirmedByAgent = before.confirmedByAgent || accepting === "agent";
        const confirmedByPerformer = before.confirmedByPerformer || accepting === "performer";
        const status = confirmedByAgent && confirmedByPerformer ? "active" : "proposed";

        const updated = await database.transaction(async (tx) => {
          const [row] = await tx
            .update(schema.representations)
            .set({ confirmedByAgent, confirmedByPerformer, status })
            .where(eq(schema.representations.id, before.id))
            .returning();
          if (!row) throw new Error("representation accept failed");
          // On activation, the PERFORMER may hand the agent their chosen current
          // events (decisions #14). Future in-region events fan out automatically.
          if (row.status === "active" && accepting === "performer" && body.eventIds?.length) {
            await assignAgentToEvents(tx, row, body.eventIds);
          }
          await writeAudit(tx, request, {
            capability: "members.manage",
            action: "representation.accept",
            targetKind: "representation",
            targetId: row.id,
            before,
            after: row,
          });
          return row;
        });
        return serializeRepresentation(updated);
      }

      if (body.action === "counter") {
        // Either side may counter; the caller becomes the new proposer.
        const side = callerSide(request, before);
        if (!side) throw forbidden("You do not control either side of this representation");
        if (before.status === "terminated") {
          throw badRequest("A terminated representation cannot be countered");
        }

        const region = body.region ?? before.region;
        const isWorldwide = body.isWorldwide ?? before.isWorldwide;

        // Re-check the disjoint invariant if the territory changed (excluding self).
        if (body.region !== undefined || body.isWorldwide !== undefined) {
          const activeReps = await database
            .select()
            .from(schema.representations)
            .where(
              and(
                eq(schema.representations.performerProfileId, before.performerProfileId),
                eq(schema.representations.status, "active"),
                ne(schema.representations.id, before.id),
              ),
            );
          assertDisjoint(
            activeReps.map((rep) => ({ region: rep.region, isWorldwide: rep.isWorldwide })),
            { region, isWorldwide },
          );
        }

        const flags = applyCounter(before, side);
        const updated = await database.transaction(async (tx) => {
          const [row] = await tx
            .update(schema.representations)
            .set({
              region,
              isWorldwide,
              commissionRate: body.commissionRate ?? before.commissionRate,
              commissionableBasis: body.commissionableBasis ?? before.commissionableBasis,
              agentCollects: body.agentCollects ?? before.agentCollects,
              proposedBy: flags.proposedBy,
              confirmedByAgent: flags.confirmedByAgent,
              confirmedByPerformer: flags.confirmedByPerformer,
              status: "proposed",
            })
            .where(eq(schema.representations.id, before.id))
            .returning();
          if (!row) throw new Error("representation counter failed");
          await writeAudit(tx, request, {
            capability: "members.manage",
            action: "representation.counter",
            targetKind: "representation",
            targetId: row.id,
            before,
            after: row,
          });
          return row;
        });
        return serializeRepresentation(updated);
      }

      // terminate — either side, unilateral, effective-dated (defaults to now).
      const side = callerSide(request, before);
      if (!side) throw forbidden("You do not control either side of this representation");
      const now = new Date();
      const effectiveAt = body.terminatedEffectiveAt ? new Date(body.terminatedEffectiveAt) : now;

      const updated = await database.transaction(async (tx) => {
        const [row] = await tx
          .update(schema.representations)
          .set({
            status: "terminated",
            terminatedAt: now,
            terminatedEffectiveAt: effectiveAt,
            terminatedBy: principal.userId,
          })
          .where(eq(schema.representations.id, before.id))
          .returning();
        if (!row) throw new Error("representation terminate failed");
        // The performer regains control of every still-open event (decisions #14 #6).
        await unassignAgentFromOpenEvents(tx, row);
        await writeAudit(tx, request, {
          capability: "members.manage",
          action: "representation.terminate",
          targetKind: "representation",
          targetId: row.id,
          before,
          after: row,
        });
        return row;
      });
      return serializeRepresentation(updated);
    },
  );

  // The delegation PICKER: the performer's current (non-concluded) in-region events,
  // each flagged whether it's already assigned. Performer side only.
  app.get(
    "/representations/:id/delegatable-events",
    { schema: { params: RepresentationParams, response: { 200: DelegatableEventsResponse } } },
    async (request) => {
      const representation = await loadRepresentation(request, request.params.id);
      requireControls(request, representation.performerProfileId);
      const events = await request.server.database.transaction((tx) =>
        delegatableEvents(tx, representation),
      );
      return { events };
    },
  );

  // The performer hands the agent control of chosen CURRENT events (or "all" of
  // them). Only the performer side chooses; future in-region events assign
  // automatically. Assigning means: agent → participant, performer → view-only.
  app.post(
    "/representations/:id/events",
    {
      schema: {
        params: RepresentationParams,
        body: GrantEventsBody,
        response: { 200: z.object({ assigned: z.number() }) },
      },
    },
    async (request) => {
      const { database } = request.server;
      const representation = await loadRepresentation(request, request.params.id);
      requireControls(request, representation.performerProfileId); // performer's choice only
      if (representation.status !== "active") {
        throw badRequest("Only an active representation can be given events");
      }
      const body = request.body;

      const assigned = await database.transaction(async (tx) => {
        const eventIds =
          "all" in body
            ? (await delegatableEvents(tx, representation)).map((event) => event.eventId)
            : body.eventIds;
        const count = await assignAgentToEvents(tx, representation, eventIds);
        await writeAudit(tx, request, {
          capability: "members.manage",
          action: "representation.assign_events",
          targetKind: "representation",
          targetId: representation.id,
          after: { eventIds, assigned: count },
        });
        return count;
      });
      return { assigned };
    },
  );
}
