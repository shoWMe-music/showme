import { schema } from "@showme/db";
import { applyRepresentationTermination } from "@showme/db/representation-termination";
import { isCountryCode, normalizeCountryCodes } from "@showme/shared";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, forbidden, notFound } from "../errors";
import { assignAgentToEvents, delegatableEvents } from "../lib/agent-assignment";
import { writeAudit } from "../lib/audit";
import { requireProfileRole } from "../lib/authorize";
import {
  COMMISSIONABLE_BASES,
  COMMISSION_RATE_MESSAGE,
  DEFAULT_COMMISSIONABLE_BASIS,
  type HeldRegionScope,
  type RepresentationParty,
  applyCounter,
  assertCoherentTerritory,
  assertDisjoint,
  assertRepresentationPartyKinds,
  isCommissionRateInRange,
  isCommissionableBasis,
  isRepresentationActiveAt,
  terminationTakesEffectNow,
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

/**
 * The commission TERMS are validated, not taken on trust (audit A-18). The three
 * vocabularies live in `lib/representation-rules.ts` + `@showme/shared` so the
 * route only wires them up — the rules themselves are testable without Fastify.
 */

/**
 * Territory: ISO 3166-1 alpha-2, uppercased and de-duplicated on the way in, every
 * entry a country that actually exists. A code no country answers to is worse than
 * none — `["ATLANTIS","sweden",""]` was accepted and matched nothing, so the agent
 * read as holding a territory they could never be assigned an event in.
 */
const RegionCodes = z
  .array(z.string())
  .transform((codes) => normalizeCountryCodes(codes))
  .superRefine((codes, context) => {
    for (const code of codes) {
      if (isCountryCode(code)) continue;
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `"${code}" is not an ISO 3166-1 alpha-2 country code`,
      });
    }
  });

/** Basis points, above 0% and at most 50% — see COMMISSION_RATE_MESSAGE for why. */
const CommissionRate = z
  .number()
  .int()
  .refine((basisPoints) => isCommissionRateInRange(basisPoints), {
    message: COMMISSION_RATE_MESSAGE,
  });

/** A closed vocabulary — merch/publishing are excluded by definition (story.md:69). */
const CommissionableBasis = z.string().refine(isCommissionableBasis, (value) => ({
  message: `Unsupported commissionable basis "${value}" — commission is on live deal income only (${COMMISSIONABLE_BASES.join(", ")}); merchandise, publishing and other non-live revenue are never commissionable`,
}));

const ProposeBody = z.object({
  agentProfileId: z.string().uuid(),
  performerProfileId: z.string().uuid(),
  region: RegionCodes.default([]),
  isWorldwide: z.boolean().optional(),
  commissionRate: CommissionRate, // basis points
  commissionableBasis: CommissionableBasis.default(DEFAULT_COMMISSIONABLE_BASIS),
  agentCollects: z.boolean().optional(),
  proposedBy: representationParty,
});

const PatchBody = z.object({
  action: z.enum(["accept", "counter", "terminate"]),
  // accept-only: the current (non-concluded) events the performer hands the agent.
  eventIds: z.array(z.string().uuid()).optional(),
  // counter-only term edits (all optional)
  region: RegionCodes.optional(),
  isWorldwide: z.boolean().optional(),
  commissionRate: CommissionRate.optional(),
  commissionableBasis: CommissionableBasis.optional(),
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

/**
 * Assert the two sides are the kinds a representation is DEFINED between
 * (`agent` → `performer`) — audit A-16. `story.md` separates crew from agents by
 * exactly this line (fixed fee vs. a percentage of someone else's income), so an
 * agent↔crew or operator-as-agent row is not a lenient case of the same agreement,
 * it is a product shoWMe does not sell.
 */
async function assertPartyKinds(
  request: FastifyRequest,
  agentProfileId: string,
  performerProfileId: string,
): Promise<void> {
  const rows = await request.server.database
    .select({ id: schema.profiles.id, kind: schema.profiles.kind })
    .from(schema.profiles)
    .where(inArray(schema.profiles.id, [agentProfileId, performerProfileId]));
  const kindOf = (profileId: string) => rows.find((row) => row.id === profileId)?.kind;
  assertRepresentationPartyKinds(kindOf(agentProfileId), kindOf(performerProfileId));
}

/**
 * The territories of this performer that are LIVE at `now`, each tagged with the
 * agent holding it so a conflict can name them. Liveness is
 * `isRepresentationActiveAt`, never the `status` column alone — which also means a
 * representation working out its notice period still blocks a successor over the
 * same region, because the outgoing agent is still working it (A-17 + A-19).
 */
function heldRegions(rows: readonly RepresentationRow[], now: Date): HeldRegionScope[] {
  return rows
    .filter((row) => isRepresentationActiveAt(row, now))
    .map((row) => ({
      region: row.region,
      isWorldwide: row.isWorldwide,
      agentProfileId: row.agentProfileId,
    }));
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

      // Only an agent may represent, and only a performer may be represented (A-16).
      await assertPartyKinds(request, body.agentProfileId, body.performerProfileId);

      // A territory says exactly one thing: a country list, or worldwide (A-18).
      const territory = { region: body.region, isWorldwide: body.isWorldwide ?? false };
      assertCoherentTerritory(territory);

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
      assertDisjoint(heldRegions(activeReps, new Date()), territory);

      const created = await database.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.representations)
          .values({
            agentProfileId: body.agentProfileId,
            performerProfileId: body.performerProfileId,
            region: body.region,
            isWorldwide: body.isWorldwide ?? false,
            commissionRate: body.commissionRate,
            commissionableBasis: body.commissionableBasis,
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

        // The kind rule again, at the moment the agreement becomes BINDING (A-16).
        // Kinds cannot change, so this can only ever fire for a row that predates
        // the rule — and those must not be allowed to activate either.
        await assertPartyKinds(request, before.agentProfileId, before.performerProfileId);

        const confirmedByAgent = before.confirmedByAgent || accepting === "agent";
        const confirmedByPerformer = before.confirmedByPerformer || accepting === "performer";
        const status = confirmedByAgent && confirmedByPerformer ? "active" : "proposed";

        const updated = await database.transaction(async (tx) => {
          // The disjoint-region invariant is enforced HERE too, not only at propose
          // (audit A-17): two offers can be raised while both are still inactive —
          // each passing its propose-time check against an empty active set — and
          // then both accepted, leaving the performer with two agents on one region
          // at two different rates, and two commissions off one entitlement.
          //
          // `SELECT ... FOR UPDATE` over ALL of this performer's representations is
          // what makes two CONCURRENT accepts safe: both accepts lock the same row
          // set, so the second one waits for the first to commit and then re-reads
          // it as active — instead of both reading a stale "nobody is active yet".
          if (status === "active") {
            const siblings = await tx
              .select()
              .from(schema.representations)
              .where(eq(schema.representations.performerProfileId, before.performerProfileId))
              .for("update");
            assertDisjoint(
              heldRegions(
                siblings.filter((sibling) => sibling.id !== before.id),
                new Date(),
              ),
              { region: before.region, isWorldwide: before.isWorldwide },
            );
          }

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

        // Coherence is checked on the MERGED terms — a counter can flip either half
        // of the territory, so neither the body nor the stored row is the whole
        // picture (A-18).
        assertCoherentTerritory({ region, isWorldwide });

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
          assertDisjoint(heldRegions(activeReps, new Date()), { region, isWorldwide });
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

      // terminate — either side, unilateral, effective-dated: immediate, or an
      // agreed-future moment (decisions.md #14). A FUTURE moment is a notice period,
      // not a done deal (audit A-19): the row stays `active`, nothing is unassigned,
      // and the agent keeps negotiating and keeps being auto-assigned onto new
      // in-region events for as long as they are still contractually working it.
      // Readers stop honouring it the instant the moment passes
      // (`isRepresentationActiveAt`); the `apps/jobs` sweep then makes the stored
      // state agree. Nothing waits on that sweep for correctness.
      const side = callerSide(request, before);
      if (!side) throw forbidden("You do not control either side of this representation");
      const now = new Date();
      const effectiveAt = body.terminatedEffectiveAt ? new Date(body.terminatedEffectiveAt) : now;
      const takesEffectNow = terminationTakesEffectNow(before.status, effectiveAt, now);

      const updated = await database.transaction(async (tx) => {
        // Always stamp WHO ended it and WHEN it bites — that record is the notice.
        const [stamped] = await tx
          .update(schema.representations)
          .set({
            terminatedAt: now,
            terminatedEffectiveAt: effectiveAt,
            terminatedBy: principal.userId,
          })
          .where(eq(schema.representations.id, before.id))
          .returning();
        if (!stamped) throw new Error("representation terminate failed");

        // Only a termination that is live NOW takes the events back (decisions #14 #6),
        // through the same code path the scheduled sweep uses.
        const row = takesEffectNow
          ? (await applyRepresentationTermination(tx, stamped)).representation
          : stamped;

        await writeAudit(tx, request, {
          capability: "members.manage",
          action: takesEffectNow
            ? "representation.terminate"
            : "representation.terminate_scheduled",
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
      // Liveness, not the status column: a representation whose agreed termination
      // moment has passed takes no new events even before the sweep flips it (A-19).
      if (!isRepresentationActiveAt(representation, new Date())) {
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
