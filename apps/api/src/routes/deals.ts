import { schema } from "@showme/db";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { badRequest, conflict, notFound } from "../errors";
import { writeActivity } from "../lib/activity";
import { writeAudit } from "../lib/audit";
import { requireEventCapability } from "../lib/authorize";
import { dealPartyRecipients, notifyUsers } from "../lib/notify";
import { withIdempotency } from "../plugins/idempotency";
import { type DealViewer, isDealVisible, serializeDeal } from "../serialize/deal";

const EventParams = z.object({ id: z.string().uuid() });
const DealParams = z.object({ did: z.string().uuid() });

const dealTypeEnum = z.enum(["performance", "rental", "fee", "split", "custom"]);
const dealStructureEnum = z.enum(["guarantee", "door_split", "guarantee_vs_door", "rental"]);
const paymentTimingEnum = z.enum(["before_event", "at_settlement", "due_date"]);
const dealStatusEnum = z.enum(["draft", "confirmed", "cancelled"]);
const dealPartyRoleEnum = z.enum(["payer", "payee", "split_member", "commission", "observer"]);

const DealPartyInput = z.object({
  participantId: z.string().uuid(),
  roleInDeal: dealPartyRoleEnum,
  share: z.unknown().optional(),
});

const CreateDealBody = z.object({
  type: dealTypeEnum,
  structure: dealStructureEnum.optional(),
  name: z.string().min(1),
  currency: z.string().min(1).optional(),
  /** Minor units as a decimal string (money.md) — parsed to bigint server-side. */
  guaranteeAmount: z
    .string()
    .regex(/^-?\d+$/)
    .optional(),
  /** The portion paid IN ADVANCE (before the event), minor units as a string (#1). */
  advanceAmount: z
    .string()
    .regex(/^-?\d+$/)
    .optional(),
  splitBasisPoints: z.number().int().optional(),
  paymentTiming: paymentTimingEnum.optional(),
  priority: z.number().int().optional(),
  parties: z.array(DealPartyInput).min(1),
});

const ReopenBody = z.object({
  reason: z.string().min(1).optional(),
  /** Expected deal version for optimistic locking (decisions #8); mismatch → 409. */
  expectedVersion: z.number().int().optional(),
});

const UpdateDealBody = z.object({
  name: z.string().min(1).optional(),
  structure: dealStructureEnum.optional(),
  currency: z.string().min(1).optional(),
  guaranteeAmount: z
    .string()
    .regex(/^-?\d+$/)
    .optional(),
  advanceAmount: z
    .string()
    .regex(/^-?\d+$/)
    .nullable()
    .optional(),
  splitBasisPoints: z.number().int().optional(),
  paymentTiming: paymentTimingEnum.optional(),
  priority: z.number().int().optional(),
  status: dealStatusEnum.optional(),
  /** Expected version for optimistic locking (decisions #8); mismatch → 409. */
  expectedVersion: z.number().int().optional(),
});

const DealPartyResponse = z.object({
  id: z.string(),
  participantId: z.string(),
  roleInDeal: z.string(),
  share: z.unknown().nullable(),
  confirmedAt: z.string().nullable(),
  version: z.number(),
});

const DealResponse = z.object({
  id: z.string(),
  eventId: z.string(),
  type: z.string(),
  structure: z.string().nullable(),
  name: z.string(),
  currency: z.string().nullable(),
  guaranteeAmount: z.string().nullable(),
  advanceAmount: z.string().nullable(),
  splitBasisPoints: z.number().nullable(),
  paymentTiming: z.string(),
  priority: z.number(),
  status: z.string(),
  agreementStatus: z.string(),
  version: z.number(),
  parties: z.array(DealPartyResponse),
});

type DealRow = typeof schema.deals.$inferSelect;
type DealPartyRow = typeof schema.dealParties.$inferSelect;

/**
 * The caller's viewing relationship to an event's deals. `isOperator` is the
 * `budget.view` signal — the ceiling grants it only to managing operators
 * (host/co_host), so it cleanly separates "sees all party lines" from
 * "sees only my own". `viewerParticipantIds` are the event participants the
 * caller stands behind (their active profile memberships joined to the event).
 */
async function resolveDealViewer(
  request: FastifyRequest,
  eventId: string,
  capabilities: Set<string>,
): Promise<DealViewer> {
  const principal = request.principal;
  if (!principal) throw new Error("principal missing after authentication");
  const rows = await request.server.database
    .select({ id: schema.eventParticipants.id })
    .from(schema.eventParticipants)
    .innerJoin(
      schema.profileMembers,
      eq(schema.profileMembers.profileId, schema.eventParticipants.profileId),
    )
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        eq(schema.profileMembers.userId, principal.userId),
        eq(schema.profileMembers.status, "active"),
      ),
    );
  return {
    viewerParticipantIds: rows.map((row) => row.id),
    isOperator: capabilities.has("budget.view"),
  };
}

/** Load a deal's party lines (unscoped — the serializer applies party-scoping). */
async function loadParties(request: FastifyRequest, dealId: string): Promise<DealPartyRow[]> {
  return request.server.database
    .select()
    .from(schema.dealParties)
    .where(eq(schema.dealParties.dealId, dealId));
}

export async function dealRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // List an event's deals — authorize `deal.view.own`, return only VISIBLE deals
  // (party or operator), each party-scoped.
  app.get(
    "/events/:id/deals",
    { schema: { params: EventParams, response: { 200: z.array(DealResponse) } } },
    async (request) => {
      const { database } = request.server;
      const eventId = request.params.id;

      const capabilities = await requireEventCapability(request, eventId, "deal.view.own");
      const viewer = await resolveDealViewer(request, eventId, capabilities);

      const deals = await database
        .select()
        .from(schema.deals)
        .where(eq(schema.deals.eventId, eventId));
      if (deals.length === 0) return [];

      const parties = await database
        .select()
        .from(schema.dealParties)
        .where(
          inArray(
            schema.dealParties.dealId,
            deals.map((deal) => deal.id),
          ),
        );
      const partiesByDeal = new Map<string, DealPartyRow[]>();
      for (const party of parties) {
        const bucket = partiesByDeal.get(party.dealId) ?? [];
        bucket.push(party);
        partiesByDeal.set(party.dealId, bucket);
      }

      return deals
        .map((deal) => ({ deal, dealParties: partiesByDeal.get(deal.id) ?? [] }))
        .filter(({ dealParties }) => isDealVisible(dealParties, viewer))
        .map(({ deal, dealParties }) => serializeDeal(deal, dealParties, viewer));
    },
  );

  // Create a deal + its party lines — `deal.edit`, idempotent, audited.
  app.post(
    "/events/:id/deals",
    { schema: { params: EventParams, body: CreateDealBody, response: { 201: DealResponse } } },
    async (request, reply) => {
      const { database } = request.server;
      const eventId = request.params.id;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const capabilities = await requireEventCapability(request, eventId, "deal.edit");
      const viewer = await resolveDealViewer(request, eventId, capabilities);
      const body = request.body;

      const { statusCode, body: result } = await withIdempotency(
        request,
        "POST /events/:id/deals",
        async () => {
          const { deal, parties } = await database.transaction(async (tx) => {
            const [deal] = await tx
              .insert(schema.deals)
              .values({
                eventId,
                type: body.type,
                structure: body.structure,
                name: body.name,
                currency: body.currency,
                guaranteeAmount:
                  body.guaranteeAmount != null ? BigInt(body.guaranteeAmount) : undefined,
                advanceAmount: body.advanceAmount != null ? BigInt(body.advanceAmount) : undefined,
                splitBasisPoints: body.splitBasisPoints,
                paymentTiming: body.paymentTiming,
                priority: body.priority,
                createdBy: principal.userId,
              })
              .returning();
            if (!deal) throw new Error("deal create failed");

            const parties = await tx
              .insert(schema.dealParties)
              .values(
                body.parties.map((party) => ({
                  dealId: deal.id,
                  participantId: party.participantId,
                  roleInDeal: party.roleInDeal,
                  share: party.share ?? null,
                })),
              )
              .returning();

            await writeAudit(tx, request, {
              capability: "deal.edit",
              action: "deal.create",
              targetKind: "deal",
              targetId: deal.id,
              eventId,
              after: serializeDeal(deal, parties, { viewerParticipantIds: [], isOperator: true }),
            });
            // Party-scoped activity — only the deal's parties (and operators) see it.
            await writeActivity(tx, request, {
              eventId,
              type: "deal.created",
              targetKind: "deal",
              targetId: deal.id,
              summary: { name: deal.name, type: deal.type },
            });
            return { deal, parties };
          });

          return { statusCode: 201, body: serializeDeal(deal, parties, viewer) };
        },
      );

      return reply.status(statusCode as 201).send(result);
    },
  );

  // Read one deal — authorize via its event, then party-scope. Non-party,
  // non-operator callers get a 404 (visibility is not an existence leak).
  app.get(
    "/deals/:did",
    { schema: { params: DealParams, response: { 200: DealResponse } } },
    async (request) => {
      const deal = await loadDeal(request, request.params.did);
      const capabilities = await requireEventCapability(request, deal.eventId, "deal.view.own");
      const viewer = await resolveDealViewer(request, deal.eventId, capabilities);
      const parties = await loadParties(request, deal.id);
      if (!isDealVisible(parties, viewer)) throw notFound("Deal not found");
      return serializeDeal(deal, parties, viewer);
    },
  );

  // Update a deal — `deal.edit`, optimistic-lock on version, audited.
  app.patch(
    "/deals/:did",
    { schema: { params: DealParams, body: UpdateDealBody, response: { 200: DealResponse } } },
    async (request) => {
      const { database } = request.server;
      const before = await loadDeal(request, request.params.did);
      const capabilities = await requireEventCapability(request, before.eventId, "deal.edit");
      const viewer = await resolveDealViewer(request, before.eventId, capabilities);

      const { expectedVersion, guaranteeAmount, advanceAmount, ...rest } = request.body;
      const fields = {
        ...rest,
        ...(guaranteeAmount != null ? { guaranteeAmount: BigInt(guaranteeAmount) } : {}),
        ...(advanceAmount !== undefined
          ? { advanceAmount: advanceAmount === null ? null : BigInt(advanceAmount) }
          : {}),
      };
      const where =
        expectedVersion != null
          ? and(eq(schema.deals.id, before.id), eq(schema.deals.version, expectedVersion))
          : eq(schema.deals.id, before.id);

      const updated = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.deals)
          .set({ ...fields, version: before.version + 1, updatedAt: new Date() })
          .where(where)
          .returning();
        if (!after) {
          throw conflict("Deal was changed by someone else; reload and retry");
        }
        await writeAudit(tx, request, {
          capability: "deal.edit",
          action: "deal.update",
          targetKind: "deal",
          targetId: before.id,
          eventId: before.eventId,
          before,
          after,
        });
        return after;
      });

      const parties = await loadParties(request, updated.id);
      return serializeDeal(updated, parties, viewer);
    },
  );

  // Send the agreement to its parties for confirmation — `agreement.manage`, moves
  // draft → sent (decisions #1). `sent` is otherwise only reachable via reopen; this
  // is the forward transition. Only a draft can be sent.
  app.post(
    "/deals/:did/send",
    { schema: { params: DealParams, response: { 200: DealResponse } } },
    async (request) => {
      const { database } = request.server;
      const deal = await loadDeal(request, request.params.did);
      const capabilities = await requireEventCapability(request, deal.eventId, "agreement.manage");
      const viewer = await resolveDealViewer(request, deal.eventId, capabilities);
      if (deal.agreementStatus !== "draft") {
        throw conflict("Only a draft agreement can be sent");
      }

      const result = await database.transaction(async (tx) => {
        const [after] = await tx
          .update(schema.deals)
          .set({ agreementStatus: "sent", version: deal.version + 1, updatedAt: new Date() })
          .where(eq(schema.deals.id, deal.id))
          .returning();
        if (!after) throw new Error("deal send failed");
        await writeAudit(tx, request, {
          capability: "agreement.manage",
          action: "deal.send",
          targetKind: "deal",
          targetId: deal.id,
          eventId: deal.eventId,
          before: { agreementStatus: deal.agreementStatus },
          after: { agreementStatus: after.agreementStatus },
        });
        await writeActivity(tx, request, {
          eventId: deal.eventId,
          type: "deal.sent",
          targetKind: "deal",
          targetId: deal.id,
          summary: { name: deal.name },
        });
        const parties = await tx
          .select()
          .from(schema.dealParties)
          .where(eq(schema.dealParties.dealId, deal.id));
        return { deal: after, parties };
      });

      // Realtime + feed: PARTY-scoped, not event-scoped — a performer must not learn
      // that another party's terms moved (`deal.view.own`). Best-effort, post-commit.
      try {
        const actorUserId = request.principal?.userId ?? null;
        const recipients = await dealPartyRecipients(database, deal.id, actorUserId);
        await notifyUsers(database, recipients, actorUserId, {
          type: "deal.sent",
          title: `Agreement sent for "${deal.name ?? "a deal"}"`,
          body: "Terms are ready for your review.",
          eventId: deal.eventId,
          actorDisplay: request.firebaseUser?.name ?? undefined,
          link: `/events/${deal.eventId}`,
          metadata: { dealId: deal.id },
        });
      } catch (error) {
        request.log.error({ error, dealId: deal.id }, "deal.sent notification failed");
      }

      return serializeDeal(result.deal, result.parties, viewer);
    },
  );

  // Confirm the CALLER'S OWN party line(s) — `agreement.confirm` (decisions #1).
  // Confirmation is a per-party act, so it stamps only the deal_parties the caller
  // stands behind. When the last signatory confirms, the live terms FREEZE into
  // `confirmed_snapshot` and the agreement advances to `confirmed`.
  app.post(
    "/deals/:did/confirm",
    { schema: { params: DealParams, response: { 200: DealResponse } } },
    async (request) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const deal = await loadDeal(request, request.params.did);
      const capabilities = await requireEventCapability(request, deal.eventId, "agreement.confirm");
      const viewer = await resolveDealViewer(request, deal.eventId, capabilities);

      const result = await database.transaction(async (tx) => {
        const parties = await tx
          .select()
          .from(schema.dealParties)
          .where(eq(schema.dealParties.dealId, deal.id));
        const mine = parties.filter((party) =>
          viewer.viewerParticipantIds.includes(party.participantId),
        );
        if (mine.length === 0) throw badRequest("You are not a party to this deal");

        const now = new Date();
        for (const party of mine) {
          if (party.confirmedAt) continue; // idempotent — already confirmed
          await tx
            .update(schema.dealParties)
            .set({ confirmedAt: now, confirmedBy: principal.userId, version: party.version + 1 })
            .where(eq(schema.dealParties.id, party.id));
        }

        // Re-read to evaluate the rollup. Observers watch but don't sign, so they
        // don't gate the freeze — every non-observer party must have confirmed.
        const fresh = await tx
          .select()
          .from(schema.dealParties)
          .where(eq(schema.dealParties.dealId, deal.id));
        const signatories = fresh.filter((party) => party.roleInDeal !== "observer");
        const allConfirmed =
          signatories.length > 0 && signatories.every((party) => party.confirmedAt != null);
        const alreadyFrozen =
          deal.agreementStatus === "confirmed" || deal.agreementStatus === "signed";

        let current = deal;
        if (allConfirmed && !alreadyFrozen) {
          const [frozen] = await tx
            .update(schema.deals)
            .set({
              agreementStatus: "confirmed",
              confirmedSnapshot: freezeSnapshot(deal, fresh),
              version: deal.version + 1,
              updatedAt: now,
            })
            .where(eq(schema.deals.id, deal.id))
            .returning();
          if (frozen) current = frozen;
        }

        await writeAudit(tx, request, {
          capability: "agreement.confirm",
          action: "deal.confirm",
          targetKind: "deal",
          targetId: deal.id,
          eventId: deal.eventId,
          after: {
            agreementStatus: current.agreementStatus,
            confirmedParticipantIds: mine.map((party) => party.participantId),
          },
        });
        await writeActivity(tx, request, {
          eventId: deal.eventId,
          type: allConfirmed ? "deal.confirmed" : "deal.party_confirmed",
          targetKind: "deal",
          targetId: deal.id,
          summary: { name: deal.name, agreementStatus: current.agreementStatus },
        });
        return { deal: current, parties: fresh };
      });

      // Realtime + feed: PARTY-scoped, not event-scoped — a performer must not learn
      // that another party's terms moved (`deal.view.own`). Best-effort, post-commit.
      try {
        const actorUserId = request.principal?.userId ?? null;
        const recipients = await dealPartyRecipients(database, deal.id, actorUserId);
        await notifyUsers(database, recipients, actorUserId, {
          type: "deal.confirmed",
          title: `Agreement confirmed on "${deal.name ?? "a deal"}"`,
          body: "A party has confirmed their line.",
          eventId: deal.eventId,
          actorDisplay: request.firebaseUser?.name ?? undefined,
          link: `/events/${deal.eventId}`,
          metadata: { dealId: deal.id },
        });
      } catch (error) {
        request.log.error({ error, dealId: deal.id }, "deal.confirmed notification failed");
      }

      return serializeDeal(result.deal, result.parties, viewer);
    },
  );

  // Reopen a confirmed agreement for renegotiation — `agreement.manage` (decisions
  // #1). Clears every per-party confirmation, releases the frozen snapshot into
  // `reopen.priorSnapshot`, and records who/when/why. Agreement returns to `sent`.
  app.post(
    "/deals/:did/reopen",
    { schema: { params: DealParams, body: ReopenBody, response: { 200: DealResponse } } },
    async (request) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const deal = await loadDeal(request, request.params.did);
      const capabilities = await requireEventCapability(request, deal.eventId, "agreement.manage");
      const viewer = await resolveDealViewer(request, deal.eventId, capabilities);
      if (deal.agreementStatus !== "confirmed" && deal.agreementStatus !== "signed") {
        throw conflict("Only a confirmed agreement can be reopened");
      }

      const { expectedVersion, reason } = request.body;
      const where =
        expectedVersion != null
          ? and(eq(schema.deals.id, deal.id), eq(schema.deals.version, expectedVersion))
          : eq(schema.deals.id, deal.id);

      const result = await database.transaction(async (tx) => {
        const now = new Date();
        await tx
          .update(schema.dealParties)
          .set({ confirmedAt: null, confirmedBy: null })
          .where(eq(schema.dealParties.dealId, deal.id));
        const [after] = await tx
          .update(schema.deals)
          .set({
            agreementStatus: "sent",
            confirmedSnapshot: null,
            reopen: {
              reopenedBy: principal.userId,
              reopenedAt: now.toISOString(),
              reason: reason ?? null,
              priorSnapshot: deal.confirmedSnapshot,
            },
            version: deal.version + 1,
            updatedAt: now,
          })
          .where(where)
          .returning();
        if (!after) throw conflict("Deal was changed by someone else; reload and retry");

        const parties = await tx
          .select()
          .from(schema.dealParties)
          .where(eq(schema.dealParties.dealId, deal.id));
        await writeAudit(tx, request, {
          capability: "agreement.manage",
          action: "deal.reopen",
          targetKind: "deal",
          targetId: deal.id,
          eventId: deal.eventId,
          before: { agreementStatus: deal.agreementStatus },
          after: { agreementStatus: after.agreementStatus },
        });
        await writeActivity(tx, request, {
          eventId: deal.eventId,
          type: "deal.reopened",
          targetKind: "deal",
          targetId: deal.id,
          summary: { name: deal.name, reason: reason ?? null },
        });
        return { deal: after, parties };
      });

      return serializeDeal(result.deal, result.parties, viewer);
    },
  );

  // Delete a deal — `deal.edit`, optimistic-lock on version, audited.
  app.delete(
    "/deals/:did",
    {
      schema: {
        params: DealParams,
        body: z.object({ expectedVersion: z.number().int().optional() }),
      },
    },
    async (request, reply) => {
      const { database } = request.server;
      const before = await loadDeal(request, request.params.did);
      await requireEventCapability(request, before.eventId, "deal.edit");

      const expectedVersion = request.body?.expectedVersion;
      const where =
        expectedVersion != null
          ? and(eq(schema.deals.id, before.id), eq(schema.deals.version, expectedVersion))
          : eq(schema.deals.id, before.id);

      await database.transaction(async (tx) => {
        const [deleted] = await tx.delete(schema.deals).where(where).returning();
        if (!deleted) {
          throw conflict("Deal was changed by someone else; reload and retry");
        }
        await writeAudit(tx, request, {
          capability: "deal.edit",
          action: "deal.delete",
          targetKind: "deal",
          targetId: before.id,
          eventId: before.eventId,
          before,
        });
      });

      return reply.status(204).send();
    },
  );
}

/**
 * Freeze a deal's terms + every party's confirmation into an immutable jsonb
 * legal state (decisions #1) — the "render live, snapshot on confirm" step. Money
 * crosses as a STRING (money.md: minor units past 2^53 are unsafe as a number).
 */
function freezeSnapshot(deal: DealRow, parties: DealPartyRow[]) {
  return {
    frozenAt: new Date().toISOString(),
    terms: {
      type: deal.type,
      structure: deal.structure,
      currency: deal.currency,
      name: deal.name,
      guaranteeAmount: deal.guaranteeAmount != null ? deal.guaranteeAmount.toString() : null,
      advanceAmount: deal.advanceAmount != null ? deal.advanceAmount.toString() : null,
      splitBasisPoints: deal.splitBasisPoints,
      paymentTiming: deal.paymentTiming,
      terms: deal.terms,
      agreementBodyText: deal.agreementBodyText,
    },
    parties: parties.map((party) => ({
      participantId: party.participantId,
      roleInDeal: party.roleInDeal,
      share: party.share,
      confirmedAt: party.confirmedAt ? party.confirmedAt.toISOString() : null,
      confirmedBy: party.confirmedBy,
    })),
  };
}

/** Fetch a deal by id or 404 — the row that carries `eventId` for authorization. */
async function loadDeal(request: FastifyRequest, dealId: string): Promise<DealRow> {
  const [deal] = await request.server.database
    .select()
    .from(schema.deals)
    .where(eq(schema.deals.id, dealId));
  if (!deal) throw notFound("Deal not found");
  return deal;
}
