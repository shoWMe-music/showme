import {
  type DealPartyRole,
  type EventRole,
  dealPartyBaselineCapabilities,
  effectiveEventCapabilitiesForEvents,
  liveEventDelegations,
} from "@showme/auth";
import { type Database, schema } from "@showme/db";
import { dealPartyRecipients, notifyUsers } from "@showme/db/notify";
import { type PrepaidTerms, prepaidAmountOf } from "@showme/settlement";
import {
  type Capability,
  dealDeletability,
  sealedTermsReason,
  termsAreSealed,
} from "@showme/shared";
import { and, eq, inArray, ne } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { TERMS_SEALED_CODE, badRequest, conflict, forbidden, notFound } from "../errors";
import { writeActivity } from "../lib/activity";
import { type Transaction, writeAudit } from "../lib/audit";
import { requireEventCapability } from "../lib/authorize";
import {
  type DealAuthority,
  loadDealParties,
  requireDealAccess,
  resolveDealAuthority,
  resolveDealAuthorityForEvents,
} from "../lib/deal-authority";
import {
  allSignatoriesConfirmed,
  assertAgreementSignable,
  confirmDealIfComplete,
  movedSignedTerms,
} from "../lib/deal-confirmation";
import { renderNotificationEmail } from "../lib/email-templates";
import { OptimisticLockBody } from "../lib/optimistic-lock-body";
import { withIdempotency } from "../plugins/idempotency";
import { isDealReachable, serializeDeal, serializeDealUnredacted } from "../serialize/deal";

const EventParams = z.object({ id: z.string().uuid() });
const DealParams = z.object({ did: z.string().uuid() });

/**
 * One deal that is waiting for the caller's signature — the dashboard's row (QA7-18).
 *
 * Carries the night and the count, not the terms: it exists to route somebody to the Deals
 * tab, and every figure on the deal itself is already party-scoped there. `signedCount` and
 * `signatoryCount` are the same pair the Budget Planner's sentence uses, so the dashboard
 * and the planner say the same thing about the same deal.
 */
const AwaitingSignatureResponse = z.object({
  items: z.array(
    z.object({
      dealId: z.string(),
      eventId: z.string(),
      eventTitle: z.string(),
      eventDate: z.string().nullable(),
      dealName: z.string().nullable(),
      signedCount: z.number(),
      signatoryCount: z.number(),
    }),
  ),
});

/**
 * Read straight off the Postgres enum, so this surface can never again outlive the
 * column it writes into. `custom` was removed (PLAN.md:139, decisions.md #16.2 — free
 * text broke the settlement engine, which can only reconcile a shape it recognises);
 * the route kept accepting it for a while precisely because this list was hand-copied.
 * An uncovered arrangement is a NULL-structure paper-only deal, not a new type.
 */
const dealTypeEnum = z.enum(schema.dealType.enumValues);
const dealStructureEnum = z.enum(["guarantee", "door_split", "guarantee_vs_door", "rental"]);
const paymentTimingEnum = z.enum(["before_event", "at_settlement", "due_date"]);
/**
 * How several DISCLOSED commissions on this deal stack (ClickUp `86cba8wmb`).
 * Absent on create = `parallel`, the column default and what the engine has
 * always done — so an existing integration that never sends it is unaffected.
 */
const commissionModeEnum = z.enum(["parallel", "cascading"]);
const dealStatusEnum = z.enum(["draft", "confirmed", "cancelled"]);
const dealPartyRoleEnum = z.enum(["payer", "payee", "split_member", "commission", "observer"]);

/**
 * A party's agreed line on the deal. `share` was `z.unknown()`, which is how the writers and
 * the settlement engine drifted onto different key names without anything failing — the
 * engine read `basisPoints`, every real writer stored `splitBasisPoints`, and the mismatch
 * surfaced only as a silently equal split. Naming the shape here is what keeps the two ends
 * honest; `settlement.ts` reads exactly these keys.
 *
 * `splitBasisPoints` is basis points of the pool (4000 = 40.00%), matching
 * `deals.split_basis_points`. Money stays a minor-unit decimal string on the wire (money.md).
 *
 * ONE EXCEPTION, and it is the only place the reading changes: on a party with
 * `roleInDeal: "commission"`, `splitBasisPoints` is the commission RATE — basis points of
 * each payee's line on this deal, not of the pool. That is the rate the engine now really
 * pays (`routes/settlement.ts::commissionBasisPointsFromShare`); a commission party whose
 * share states no rate is refused rather than settled at zero.
 *
 * `illustrativeAmount` was called `guaranteeAmount` until 2026-08-26 (audit A-36), and the
 * rename is the whole point: the engine never read it as a floor, so a share saying
 * "guarantee: 30 000.00" promised a performer something no code would ever pay — and
 * `freezeSnapshot` copied that promise verbatim into the record both parties signed. A floor
 * is not missing from the model; it lives one level up, as the `guarantee_vs_door` deal
 * STRUCTURE, which the engine really does settle as `max(guarantee, door)`. A per-party floor
 * inside a `door_split` would re-implement that a second time and break the invariant that
 * split members divide 100% of the pool (PLAN.md:161) — it can only be paid by pushing the
 * operator's residual negative. So the amount stays, honestly named: what this line is worth
 * at the projected pool, not what it is owed.
 */
const DealPartyShare = z
  .object({
    splitBasisPoints: z.number().int().min(0).max(10000).optional(),
    /** What this line comes to at the PROJECTED pool. Illustrative — never a floor. */
    illustrativeAmount: z
      .string()
      .regex(/^-?\d+$/)
      .optional(),
    // Named so the old key fails LOUDLY with an explanation rather than as a bare
    // "unrecognized key" — the A-01 lesson: a silently-dropped money key is how the
    // writers and the engine drifted apart in the first place.
    guaranteeAmount: z
      .undefined({
        invalid_type_error:
          "A party's share has no guarantee floor: an amount on a share is illustrative at the projected pool, so it is `illustrativeAmount`. For a real floor, give the DEAL the `guarantee_vs_door` structure, which settles as max(guarantee, door).",
      })
      .optional(),
    currency: z.string().min(1).optional(),
    terms: z.string().optional(),
  })
  // STRICT on purpose. Zod's default strips unknown keys, so a client sending the old
  // `basisPoints` would get a silent `share: {}` — no stated weight, equal split, exactly the
  // failure this schema exists to prevent. Rejecting the write is how the caller finds out.
  .strict();

const DealPartyInput = z.object({
  participantId: z.string().uuid(),
  roleInDeal: dealPartyRoleEnum,
  share: DealPartyShare.optional(),
});

/**
 * THE TERMS THE ENGINE COULD ALREADY SETTLE BUT NOBODY COULD WRITE.
 *
 * `splitBasisPointsForSales()` has sorted escalator tiers and `doorDetail()` has
 * applied a threshold bonus since the engine was written, with tests on both —
 * and neither could ever fire, because no route accepted them and the settlement
 * mapper never read them. `routes/settlement.ts` even serialized
 * `escalatorApplied`, and `settlementDocument.ts` rendered "Includes the bonus
 * and the escalator tier the night reached": a label that could not be true.
 * ClickUp 123qy9rnwud reports it as missing; it was unreachable.
 *
 * Stored in `deals.terms`, which the schema has named "escalator tiers, bonus,
 * commissions" all along. Money is minor units as a STRING inside jsonb, the same
 * spelling `deal_parties.share.illustrativeAmount` uses — jsonb has no bigint and
 * a number would round a large guarantee.
 */
const DealTermsBody = z.object({
  /**
   * Tiers that REPLACE the base split once ticket sales reach them — Ran's
   * "60/40 until 300 tickets, 70/30 from 300, 80/20 from 900" (123qy9rnwud).
   * The highest tier reached wins; the engine sorts, so order here is free.
   */
  escalators: z
    .array(
      z.object({
        thresholdSold: z.number().int().nonnegative(),
        splitBasisPoints: z.number().int().min(0).max(10_000),
      }),
    )
    .max(10)
    .optional(),
  /**
   * A flat bonus once GROSS revenue reaches this (#23.3 — never the pool, which a
   * promoter could defeat by spending more). Both halves or neither: a threshold
   * with no amount pays nothing and an amount with no threshold would pay always.
   */
  bonusThreshold: z.string().regex(/^\d+$/).optional(),
  bonusAmount: z.string().regex(/^\d+$/).optional(),
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
  commissionMode: commissionModeEnum.optional(),
  priority: z.number().int().optional(),
  /** Escalator tiers and a threshold bonus — see `DealTermsBody`. */
  terms: DealTermsBody.optional(),
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
  /**
   * The agreement's TERMS & CONDITIONS — plain text, written on the Deals tab
   * after the figures are agreed (product owner: the wizard collects the money,
   * the terms are written on the tab).
   *
   * Deliberately not on `CreateDealBody`: composing a deal states what it pays,
   * and a contract body inside that modal is the "agreements app" this product is
   * explicitly not (*"we are not an agreements app"*). It is a text field and a
   * saved template, nothing more — no clause library, no e-signature, and the only
   * PDF is the Share & Export that already prints this column.
   *
   * `null` clears it. `freezeDealSnapshot` copies it into `confirmed_snapshot`, so
   * the words a party signed are frozen with the figures.
   */
  agreementBodyText: z.string().nullable().optional(),
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
  commissionMode: commissionModeEnum.optional(),
  priority: z.number().int().optional(),
  /** Replaces the stored terms wholesale; `null` clears them. */
  terms: DealTermsBody.nullable().optional(),
  /**
   * `draft` or `cancelled` only — see the guard in the handler. `confirmed` is
   * derived from the parties' signatures and is refused here.
   */
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
  /** Whether the CALLER stands behind this line — the one they may confirm (#1). */
  isYours: z.boolean(),
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
  commissionMode: z.string(),
  priority: z.number(),
  status: z.string(),
  agreementStatus: z.string(),
  /** The terms & conditions text, or null when none has been written. */
  agreementBodyText: z.string().nullable(),
  /** Escalator tiers and the threshold bonus, or null when the deal has neither. */
  terms: DealTermsBody.nullable(),
  /** Why the agreement was reopened, when whoever reopened it said (`123qy9rnh3f`). */
  reopenReason: z.string().nullable(),
  version: z.number(),
  parties: z.array(DealPartyResponse),
});

type DealRow = typeof schema.deals.$inferSelect;
type DealPartyRow = typeof schema.dealParties.$inferSelect;

/**
 * Every party line on a deal must belong to a participant on THIS event, and an
 * `agent` participant may never hold an entitled line.
 *
 * decisions #14: the agent "is **never a separate entitled party**, so it never
 * enters the event Σ net = 0" — it acts FOR the performer, whose own `deal_party`
 * stays the entitled one (agent-as-payee is a payout *destination* on the
 * representation, not a line here). `observer` is the one role that carries no
 * entitlement, so it is the only one an agent participant may take.
 */
async function assertPartiesAreEntitled(
  request: FastifyRequest,
  eventId: string,
  parties: { participantId: string; roleInDeal: string }[],
): Promise<void> {
  const wanted = [...new Set(parties.map((party) => party.participantId))];
  const rows = await request.server.database
    .select({ id: schema.eventParticipants.id, role: schema.eventParticipants.role })
    .from(schema.eventParticipants)
    .where(
      and(
        eq(schema.eventParticipants.eventId, eventId),
        inArray(schema.eventParticipants.id, wanted),
      ),
    );
  if (rows.length !== wanted.length) {
    throw badRequest("Every deal party must be a participant on this event");
  }
  const roleByParticipant = new Map(rows.map((row) => [row.id, row.role]));
  for (const party of parties) {
    if (roleByParticipant.get(party.participantId) === "agent" && party.roleInDeal !== "observer") {
      throw badRequest(
        "An agent is never an entitled party on a deal — it acts for the performer it represents",
      );
    }
  }
}

/**
 * A DEAL MAY PAY NOBODY. IT MAY NOT PREPAY NOBODY.
 *
 * The composer used to refuse any settling deal with no entitled line, which is
 * what stopped a standalone operator writing a deal at all: alone on their own
 * event the only party they can name is themselves, and the rule then demanded
 * they mark themselves "Is paid". That refusal is gone (`@showme/shared`
 * `dealDraftProblems`), and the money is unaffected — `settleDeal` claims `0n`
 * from a deal with no payees, so the whole pool lands on the operator's residual
 * and `Σ net = 0` holds exactly (`settlement.test.ts`, "a deal that entitles
 * nobody").
 *
 * Exactly one shape had to keep being refused, and it is not a policy choice.
 * `reconcile()` throws a bare `Error` on money moved before the event with no
 * payee to have received it, so a row in that state 500s every compute of its
 * event, forever, with `{"error":{"code":"internal"}}` as the only diagnosis. It
 * is refused here — at both doors, create and update, because a rule enforced at
 * one call site is enforced nowhere — and `reconcileEvent` turns the same shape
 * into a legible 409 for any row written before this guard existed.
 */
function assertPrepaymentNamesAPayee(
  deal: { name: string },
  terms: PrepaidTerms,
  parties: { roleInDeal: string }[],
): void {
  const entitled = parties.some(
    (party) => party.roleInDeal === "payee" || party.roleInDeal === "split_member",
  );
  if (entitled) return;
  if (prepaidAmountOf(terms) === 0n) return;
  throw badRequest(
    `"${deal.name}" says money was paid before the event, but names nobody it was paid to. Give a party the Is paid role, or set it to settle at the event.`,
  );
}

/**
 * An agent's `deal.edit` is a per-deal authority, not an event-level one (A-02).
 * When the caller reaches this event ONLY through an `agent` participant row, the
 * deal it writes must carry a party line for a performer it actually represents
 * here — the representation, resolved per performer, IS the authority.
 */
function requireRepresentedParty(
  authority: DealAuthority,
  parties: { participantId: string }[],
): void {
  if (!authority.actsOnlyAsAgent) return;
  const forAClient = parties.some((party) =>
    authority.representedParticipantIds.includes(party.participantId),
  );
  if (!forAClient) {
    throw forbidden("An agent may only write deals for a performer it represents on this event");
  }
}

/**
 * WHO IS TOLD WHEN A DEAL MOVES — the parties, AND the agent that has to sign for one.
 *
 * `dealPartyRecipients` joins through `deal_parties`, which is the right rule for the
 * parties and structurally cannot reach an agent: decisions #14 refuses an agent any
 * deal role but `observer`, precisely so its private commission never enters the deal.
 * The same decision then hands that agent `agreement.confirm` for the act it represents.
 * So the party that has to ACT on a sent, reopened or confirmed agreement was the one
 * party not told about it (measured 2026-09-26: `deal.reopened` and `deal.confirmed`
 * both reached the performers and the operator, and neither reached the agent).
 *
 * The delegation rule itself is NOT restated here — `liveEventDelegations` owns it,
 * including the part where a lapsed representation stops counting before the sweep has
 * run. This only asks it about the acts on this deal.
 */
async function dealRecipients(
  request: FastifyRequest,
  deal: { id: string; eventId: string },
): Promise<string[]> {
  const { database } = request.server;
  const actorUserId = request.principal?.userId ?? null;
  const parties = await dealPartyRecipients(database, deal.id, actorUserId);

  const delegations = await liveEventDelegations(database, deal.eventId);
  if (delegations.length === 0) return parties;

  const onThisDeal = new Set(
    (
      await database
        .select({ participantId: schema.dealParties.participantId })
        .from(schema.dealParties)
        .where(eq(schema.dealParties.dealId, deal.id))
    ).map((row: { participantId: string }) => row.participantId),
  );
  const agentProfileIds = delegations
    .filter((delegation) => onThisDeal.has(delegation.performerParticipantId))
    .map((delegation) => delegation.agentProfileId);
  if (agentProfileIds.length === 0) return parties;

  const agentUsers = await database
    .selectDistinct({ userId: schema.profileMembers.userId })
    .from(schema.profileMembers)
    .where(
      and(
        inArray(schema.profileMembers.profileId, agentProfileIds),
        eq(schema.profileMembers.status, "active"),
      ),
    );
  const everyone = new Set(parties);
  for (const row of agentUsers as { userId: string | null }[]) {
    if (row.userId && row.userId !== actorUserId) everyone.add(row.userId);
  }
  return [...everyone].sort();
}

export async function dealRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // List an event's deals — authorize `deal.view.own`, then return only the deals
  // the caller is a PARTY to (their own lines plus the lines of performers they
  // represent as agent), each party-scoped. No operator see-all (decisions #4).
  app.get(
    "/events/:id/deals",
    {
      schema: {
        params: EventParams,
        /**
         * AN OBJECT, so the answer can say how much of itself is missing.
         *
         * `deals` is what this caller may read — story.md: an operator's breadth is
         * *emergent* from being a party to the event's deals, never god-mode, and
         * decisions.md #4 makes sharing one with a co-host an explicit
         * `deal_party` in a read-only role. A co-host who is not a party therefore
         * correctly sees nothing, and a bare array could not tell them so.
         *
         * `hiddenCount` is the consequence. The Budget Planner DERIVES the
         * performer fee from this list, so a caller missing a deal is missing a
         * cost — and used to be shown a confident `Profit / loss` computed without
         * it. Measured 2026-09-26 on a co-promoted night: the host read a
         * SEK 1,245 loss and the co-host, same ledger, same minute, read a
         * SEK 40,255 profit and a "48.5% margin". The count is the one bit a screen
         * needs to stop asserting a total it cannot compute; it discloses that a
         * deal exists, which a co-host already infers from the bill, and nothing
         * about its terms.
         */
        response: {
          200: z.object({
            deals: z.array(DealResponse),
            hiddenCount: z.number().int().min(0),
            /**
             * HAS THIS NIGHT BEEN SETTLED — for anybody on it, not for the reader.
             *
             * Here rather than on the event read because it qualifies the deals: it is half of
             * `dealDeletability` (decisions §25.7.2), and the screen deciding whether to offer
             * Delete or Cancel has the whole rule in one response with no second request.
             *
             * NOT `settlementStatus`, which is the name the events LIST uses for the caller's OWN
             * settlement (`routes/events-list.ts` scopes it by `profile_members.user_id`). Two
             * different facts: a co-host with no settlement of their own is still looking at a
             * night the host has settled, and a screen that read the reader-scoped field here
             * would offer them a delete the route refuses.
             */
            hasSettlement: z.boolean(),
          }),
        },
      },
    },
    async (request) => {
      const { database } = request.server;
      const eventId = request.params.id;

      const capabilities = await requireEventCapability(request, eventId, "deal.view.own");
      const viewer = await resolveDealAuthority(request, eventId, capabilities);

      const deals = await database
        .select()
        .from(schema.deals)
        .where(eq(schema.deals.eventId, eventId));
      const [settlement] = await database
        .select({ id: schema.settlements.id })
        .from(schema.settlements)
        .where(eq(schema.settlements.eventId, eventId))
        .limit(1);
      const hasSettlement = Boolean(settlement);
      if (deals.length === 0) return { deals: [], hiddenCount: 0, hasSettlement };

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

      const visible = deals
        .map((deal) => ({ deal, dealParties: partiesByDeal.get(deal.id) ?? [] }))
        // A party to it, or its author — the same rule the single-deal gate asks, so the list and
        // the card cannot disagree about whether a deal exists (run 13's BLOCKER). This is also what
        // stops `hiddenCount` below counting deals the reader wrote.
        .filter(({ deal, dealParties }) => isDealReachable(deal, dealParties, viewer));
      /*
       * A CANCELLED DEAL IS NOT A DEAL THE READER IS MISSING (QA sweep run 12).
       *
       * The count carries a claim about MONEY — the Budget Planner prints "…so what the night
       * costs is higher than the total above" — and a cancelled agreement pays nobody:
       * `routes/settlement.ts` reads `ne(status, "cancelled")` and `useBudgetSeed` filters it on
       * the client for the same reason. Measured: a co-host who was a party to neither of two
       * deals, one of them cancelled, was told TWO were adding cost.
       *
       * Counted, not FILTERED OUT — `deals` and the visibility split above are untouched on
       * purpose. The sweep suggested filtering before the split, which would have removed
       * cancelled deals from the list the Deals tab renders, and that tab is exactly where a
       * cancelled agreement must stay visible: `DealAgreementCard` has a "Cancelled — these terms
       * pay nobody" caption written for it. A party who cancelled a deal would have watched it
       * vanish.
       *
       * Cancelling is the NORMAL ending for an agreement (§25.7.2), so these accumulate over an
       * event's life and the drift is upward.
       */
      const paying = (deal: { status: string }) => deal.status !== "cancelled";
      return {
        deals: visible.map(({ deal, dealParties }) => serializeDeal(deal, dealParties, viewer)),
        hiddenCount:
          deals.filter(paying).length - visible.filter(({ deal }) => paying(deal)).length,
        hasSettlement,
      };
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
      const viewer = await resolveDealAuthority(request, eventId, capabilities);
      const body = request.body;

      await assertPartiesAreEntitled(request, eventId, body.parties);
      assertPrepaymentNamesAPayee(
        body,
        {
          structure: body.structure ?? null,
          paymentTiming: body.paymentTiming,
          guaranteeAmount: body.guaranteeAmount != null ? BigInt(body.guaranteeAmount) : undefined,
          advanceAmount: body.advanceAmount != null ? BigInt(body.advanceAmount) : undefined,
        },
        body.parties,
      );
      // A-02's create half: an agent's `deal.edit` is scoped to the performers it
      // represents on this event — never a licence to author deals it has no
      // standing on (and never one that makes the agent itself a party).
      requireRepresentedParty(viewer, body.parties);

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
                commissionMode: body.commissionMode,
                priority: body.priority,
                terms: body.terms,
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
              after: serializeDealUnredacted(deal, parties),
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

  // Read one deal — authorize via its event, then party-scope. A caller who is not
  // a party (directly or through a representation) gets a 404: visibility is not an
  // existence leak, and being the host is not itself the grant (decisions #4).
  /**
   * WHICH DEALS ARE WAITING FOR MY SIGNATURE — across every event (QA sweep run 7, QA7-18).
   *
   * The dashboard's "Needs attention" card states its own rule: *"what is left … is what
   * somebody ELSE is waiting on"*. A deal at `sent` with the reader's own line unsigned is
   * exactly that, and there was no way to ask the question: deals are reachable only per
   * event (`/events/:id/deals`) or by id, so the screen whose job is routing people to the
   * Confirm button said *"You're all caught up"*.
   *
   * THE PREDICATE IS THE CONFIRM ROUTE'S, term for term, because a row the reader cannot act
   * on would nag forever — and QA6-1 was precisely a party who could not sign:
   *
   *   · a line the caller stands behind (`viewerParticipantIds`, so an agent sees the lines
   *     of the performers they represent — that is the signature that unblocks the deal)
   *   · `confirmedAt IS NULL` — not already signed
   *   · `roleInDeal !== "observer"` — observers watch, they do not sign
   *   · the agreement is not `draft` and the deal is not `cancelled` — both of which
   *     `assertAgreementSignable` now refuses, so this list and that gate agree (QA10-9: the
   *     cancelled half was filtered HERE and enforced nowhere, which is how a cancelled agreement
   *     came to carry two signatures)
   *   · `maySignOwnLines`, the same function the confirm route calls
   *
   * Registered BEFORE `/deals/:did` for readability only — find-my-way prefers a static
   * segment over a parameter, so the order does not decide it.
   */
  app.get(
    "/deals/awaiting-signature",
    { schema: { response: { 200: AwaitingSignatureResponse } } },
    async (request) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const profileIds = principal.memberships.map((membership) => membership.profileId);
      if (profileIds.length === 0) return { items: [] };

      // The events the caller stands on at all — the same reachability `routes/activity.ts`
      // starts from, and the bound for everything below.
      const standing = await database
        .select({ eventId: schema.eventParticipants.eventId })
        .from(schema.eventParticipants)
        .where(
          and(
            inArray(schema.eventParticipants.profileId, profileIds),
            ne(schema.eventParticipants.status, "removed"),
          ),
        );
      const reachable = [...new Set(standing.map((row) => row.eventId))];
      if (reachable.length === 0) return { items: [] };

      const capabilitiesByEvent = await effectiveEventCapabilitiesForEvents(
        database,
        principal,
        reachable,
      );
      const authorityByEvent = await resolveDealAuthorityForEvents(
        request,
        reachable,
        capabilitiesByEvent,
      );

      /*
       * ONLY `sent` — the one state in which somebody is actually waiting on this reader.
       *
       * `cancelled` is not a deal anybody signs and `draft` is the reader's own unfinished work
       * rather than somebody waiting, which is the distinction that moved tasks off the
       * attention card. But excluding those two was not the same as including only the right
       * one: a `confirmed` or `signed` deal with an unsigned line was listed, and the Deals tab
       * it routes to offers nothing — `dealActionsFor` requires `sent` exactly. The Dashboard
       * card promised *"the event's Deals tab offers Confirm your line"* and dead-ended on both
       * seeded deals (QA sweep run 11, QA11-4).
       *
       * The seed was half of that and is fixed; this is the half that would come back without
       * it. `signed` is *"the same agreement once it has been countersigned off-platform"* — a
       * state whose party rows may legitimately carry no `confirmedAt` — so the first
       * off-platform countersignature would have rebuilt the dead end. Nobody is waiting on
       * your signature for an agreement that is already an agreement.
       */
      const deals = await database
        .select({
          id: schema.deals.id,
          eventId: schema.deals.eventId,
          name: schema.deals.name,
          eventTitle: schema.events.title,
          eventDate: schema.events.eventDate,
        })
        .from(schema.deals)
        .innerJoin(schema.events, eq(schema.events.id, schema.deals.eventId))
        .where(
          and(
            inArray(schema.deals.eventId, reachable),
            eq(schema.deals.agreementStatus, "sent"),
            ne(schema.deals.status, "cancelled"),
          ),
        );
      if (deals.length === 0) return { items: [] };

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
        const forDeal = partiesByDeal.get(party.dealId) ?? [];
        forDeal.push(party);
        partiesByDeal.set(party.dealId, forDeal);
      }

      const items: {
        dealId: string;
        eventId: string;
        eventTitle: string;
        eventDate: string | null;
        dealName: string | null;
        signedCount: number;
        signatoryCount: number;
      }[] = [];
      for (const deal of deals) {
        const authority = authorityByEvent.get(deal.eventId);
        if (!authority) continue;
        const dealParties = partiesByDeal.get(deal.id) ?? [];
        const mine = dealParties.filter(
          (party) =>
            authority.viewerParticipantIds.includes(party.participantId) &&
            party.confirmedAt == null &&
            party.roleInDeal !== "observer",
        );
        if (mine.length === 0) continue;
        const capabilities = capabilitiesByEvent.get(deal.eventId) ?? new Set<Capability>();
        if (!(await maySignOwnLines(database, capabilities, mine))) continue;

        const signatories = dealParties.filter((party) => party.roleInDeal !== "observer");
        items.push({
          dealId: deal.id,
          eventId: deal.eventId,
          eventTitle: deal.eventTitle,
          eventDate: deal.eventDate,
          dealName: deal.name,
          signedCount: signatories.filter((party) => party.confirmedAt != null).length,
          signatoryCount: signatories.length,
        });
      }
      return { items };
    },
  );

  app.get(
    "/deals/:did",
    { schema: { params: DealParams, response: { 200: DealResponse } } },
    async (request) => {
      const deal = await loadDeal(request, request.params.did);
      const { authority, parties } = await requireDealAccess(request, deal, "deal.view.own");
      return serializeDeal(deal, parties, authority);
    },
  );

  /**
   * Which of a deal's terms an update actually moved. NAMES only — `guaranteeAmount`,
   * `splitBasisPoints` and `advanceAmount` are the money the serializer scopes per
   * party, and kind `deal` admits every party plus the operators. "The guarantee
   * changed" is history a co-party is entitled to; "the guarantee is now 150 000" is
   * not, and the deal's own route already decides who may read that figure.
   */
  function changedDealTermNames(
    before: typeof schema.deals.$inferSelect,
    after: typeof schema.deals.$inferSelect,
  ): string[] {
    const tracked = [
      "name",
      "structure",
      "currency",
      "guaranteeAmount",
      "advanceAmount",
      "splitBasisPoints",
      "paymentTiming",
      "priority",
      "status",
      "agreementBodyText",
    ] as const;
    return tracked.filter((field) => String(before[field] ?? "") !== String(after[field] ?? ""));
  }

  // Update a deal — `deal.edit`, optimistic-lock on version, audited.
  app.patch(
    "/deals/:did",
    { schema: { params: DealParams, body: UpdateDealBody, response: { 200: DealResponse } } },
    async (request) => {
      const { database } = request.server;
      const before = await loadDeal(request, request.params.did);
      const { authority: viewer } = await requireDealAccess(request, before, "deal.edit");

      const { expectedVersion, guaranteeAmount, advanceAmount, ...rest } = request.body;
      // CONFIRMATION IS DERIVED FROM SIGNATURES, NEVER TYPED.
      //
      // This body has always accepted `status`, and while the column was inert
      // (nothing anywhere wrote it) that was harmless. It stopped being harmless
      // on 2026-08-31, when the last signature started advancing it: `deal.edit`
      // is held by ONE side of an agreement — the operator on its own deals, an
      // agent on its clients' — so a hand-set `confirmed` here would let that side
      // declare the other side's signature. Both readers would believe it: the
      // engine would settle a deal nobody signed, and the Budget Planner would
      // print it as agreed.
      //
      // That second reason got WEAKER on 2026-09-22 and the guard did not (ClickUp
      // `123qy9rnwud`). The planner now reads a DRAFT deal's fee too, so a false
      // `confirmed` no longer conjures a figure out of nothing — it relabels an
      // offer as an agreement, dropping the "still an offer, nobody has confirmed
      // it" sentence the row carries. The first reason was always the load-bearing
      // one: a signature is the other party's to give.
      //
      // `cancelled` and `draft` stay writable. Withdrawing an agreement is the
      // operator's own call, this PATCH is the only route in the product that does
      // it (`DELETE /deals/:did` hard-deletes the row instead), and it is what the
      // engine's `ne(status, 'cancelled')` filter reads.
      if (rest.status === "confirmed") {
        throw badRequest(
          "A deal is confirmed by its parties' signatures, not by hand — POST /deals/:did/confirm",
        );
      }
      const fields = {
        ...rest,
        ...(guaranteeAmount != null ? { guaranteeAmount: BigInt(guaranteeAmount) } : {}),
        ...(advanceAmount !== undefined
          ? { advanceAmount: advanceAmount === null ? null : BigInt(advanceAmount) }
          : {}),
      };
      /**
       * A SIGNED AGREEMENT'S TERMS STOP MOVING. The screen has always said so —
       * `DealAgreementCard.tsx` hides the figures editor and the terms editor the
       * moment `agreement_status` reaches `confirmed`, and the card reads "Confirmed
       * — terms frozen". This route did not, and the gap was not academic:
       * `routes/settlement.ts` pays the LIVE `deals` row, not `confirmed_snapshot`,
       * so a guarantee moved after signature is a guarantee that gets paid, quietly,
       * against a document that says something else. `confirmed_snapshot` would sit
       * beside it as evidence nothing reads.
       *
       * It mattered because the rule lived in a React component. The assistant /
       * agent-native surface (decisions #16.14) drives these same routes with no
       * component in the way, and so does any script.
       *
       * REFUSED, NOT SILENTLY DROPPED, and pointed at the door that already exists:
       * `POST /deals/:did/reopen` tears every signature up and puts the deal back to
       * `draft` — which is what renegotiating terms actually is, and what the Deals
       * tab already offers. 409 rather than 403: the caller has the capability, the
       * agreement is in the wrong state for it.
       *
       * A no-op save still passes. The Deals tab saves the whole form, so "sent
       * every term, moved none" has to stay an ordinary request, or this would
       * block editing everything beside the terms.
       */
      /*
       * SEALED BY THE FIRST SIGNATURE, NOT THE LAST (QA sweep run 11).
       *
       * The paragraph above was right and this line was not: the gate asked
       * `agreementIsFrozen`, which is `agreement_status === "confirmed" || "signed"`, and the
       * status only reaches `confirmed` when the LAST signatory stamps. So the window between
       * the first signature and the last was open, and the sweep walked through it — the
       * operator signed SEK 60,000, the act's agent edited it to **SEK 90,000** and signed,
       * and the agreement froze carrying the new figure beside the operator's original
       * `confirmedAt`. Exactly the document this comment says must not exist.
       *
       * `termsAreSealed` is asked by the Deals tab too, so the screen cannot offer an edit the
       * route will refuse. The parties are loaded only when a signed term actually MOVED,
       * which keeps "sent every term, moved none" the ordinary request it has to be.
       */
      const moved = movedSignedTerms(before, fields);
      if (moved.length > 0) {
        const signatories = await database
          .select({ confirmedAt: schema.dealParties.confirmedAt })
          .from(schema.dealParties)
          .where(eq(schema.dealParties.dealId, before.id));
        const sealed = sealedTermsReason(before, signatories);
        if (sealed !== null) {
          // The message stays as it is — it names the field and the route, which is what an API
          // caller needs (#16.14). The CODE is what lets the browser say it differently.
          throw conflict(
            sealed === "confirmed"
              ? `These terms are frozen — ${moved.join(", ")} cannot change on a confirmed agreement. Reopen it for renegotiation first: POST /deals/${before.id}/reopen`
              : `A party has already signed this agreement, so ${moved.join(", ")} cannot change — their signature is on the figures as they stand. Reopen it for renegotiation first, which tears every signature up: POST /deals/${before.id}/reopen`,
            TERMS_SEALED_CODE,
          );
        }
      }

      // The same rule as the create, measured against the deal this PATCH LEAVES
      // BEHIND: `paymentTiming: "before_event"` on its own is enough to turn a
      // fixed amount into a prepayment, so the terms have to be merged before the
      // question can be asked.
      assertPrepaymentNamesAPayee(
        { name: fields.name ?? before.name },
        {
          structure: fields.structure ?? before.structure,
          paymentTiming: fields.paymentTiming ?? before.paymentTiming,
          guaranteeAmount: fields.guaranteeAmount ?? before.guaranteeAmount ?? undefined,
          advanceAmount:
            advanceAmount !== undefined
              ? (fields.advanceAmount ?? undefined)
              : (before.advanceAmount ?? undefined),
        },
        await loadDealParties(request, before.id),
      );

      const where =
        expectedVersion != null
          ? and(eq(schema.deals.id, before.id), eq(schema.deals.version, expectedVersion))
          : eq(schema.deals.id, before.id);

      const result = await database.transaction(async (tx) => {
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
        // The terms moved under a party who may already have confirmed. The web app
        // saves the whole form, so a PATCH that moved nothing is audited but is not
        // history — same rule as `event.updated`.
        const changed = changedDealTermNames(before, after);
        /*
         * CANCELLING HAS ITS OWN NAME NOW (QA sweep run 12).
         *
         * It travels through this route like any other field, so the history read "Deal terms
         * changed · Changed: status" — while every other lifecycle move has its own type and its
         * own sentence (`deal.sent`, `deal.reopened`, `deal.deleted`, both confirm rows).
         * Cancelling is the ending a party is most likely to go looking for and was the only one
         * with no name.
         *
         * Two rows, not one, when a PATCH does both: the status transition is its own fact and
         * must not swallow a fee that moved in the same call, nor be swallowed by one.
         */
        const cancelled = after.status === "cancelled" && before.status !== "cancelled";
        if (cancelled) {
          await writeActivity(tx, request, {
            eventId: before.eventId,
            type: "deal.cancelled",
            targetKind: "deal",
            targetId: before.id,
            summary: { name: after.name, agreementStatus: after.agreementStatus },
          });
        }
        const otherFields = cancelled ? changed.filter((field) => field !== "status") : changed;
        if (otherFields.length > 0) {
          await writeActivity(tx, request, {
            eventId: before.eventId,
            type: "deal.updated",
            targetKind: "deal",
            targetId: before.id,
            summary: {
              name: after.name,
              fields: otherFields,
              agreementStatus: after.agreementStatus,
            },
          });
        }
        return { after, cancelled, otherFields };
      });
      const updated = result.after;

      /*
       * AND THE PARTIES ARE TOLD (QA sweep run 14's two-sided MAJOR).
       *
       * This handler wrote an audit row and an activity row and called `notifyUsers` NOWHERE, while
       * `deal.sent`, `deal.confirmed` and `deal.reopened` all do. Run 14 instrumented a crew member's
       * open Deals tab: `POST /send` moved the card in 6 s with zero focus events, so realtime works;
       * `PATCH {status:cancelled}` left it reading "Sent — awaiting confirmations · Your line
       * unsigned" for 22 s with **0 mutations** — inviting a signature `assertAgreementSignable`
       * answers 409 to. `notifyUsers` both persists the row and publishes the frame
       * `useRealtimeStream` invalidates on, so one call fixes the bell and the stale screen together.
       *
       * PARTY-scoped through `dealRecipients`, like its siblings: a performer must not learn that
       * another party's terms moved (`deal.view.own`), and the agent that has to sign for an act is
       * included because `dealPartyRecipients` structurally cannot reach them (#14). Best-effort and
       * post-commit, also like its siblings — a notification that throws must not undo the write.
       */
      try {
        const actorUserId = request.principal?.userId ?? null;
        const recipients = await dealRecipients(request, updated);
        if (result.cancelled) {
          await notifyUsers(database, recipients, actorUserId, {
            type: "deal.cancelled",
            title: `Agreement cancelled: "${updated.name ?? "a deal"}"`,
            body: "It pays nobody. Nothing more is needed from you.",
            eventId: updated.eventId,
            actorDisplay: request.firebaseUser?.name ?? undefined,
            link: `/events/${updated.eventId}`,
            metadata: { dealId: updated.id },
          });
        } else if (result.otherFields.length > 0 && updated.agreementStatus !== "draft") {
          /*
           * ONLY ONCE IT HAS BEEN SENT. An edit is reachable only before the first signature (the
           * terms seal there), so nobody has signed either way — but before sending, nobody has SEEN
           * it and there is nothing to correct. A notification per form-save on a draft would be
           * noise the reader cannot act on.
           */
          await notifyUsers(database, recipients, actorUserId, {
            type: "deal.updated",
            title: `Agreement changed: "${updated.name ?? "a deal"}"`,
            body: "The terms you were sent have moved. Read them before you confirm.",
            eventId: updated.eventId,
            actorDisplay: request.firebaseUser?.name ?? undefined,
            link: `/events/${updated.eventId}`,
            metadata: { dealId: updated.id, fields: result.otherFields },
          });
        }
      } catch (error) {
        request.log.error({ error, dealId: updated.id }, "deal PATCH notification failed");
      }

      const parties = await loadDealParties(request, updated.id);
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
      const { authority: viewer } = await requireDealAccess(request, deal, "agreement.manage");
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
        const recipients = await dealRecipients(request, deal);
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
  //
  // The capability is resolved on THIS DEAL, not on the event:
  //
  //     effective_here = effective_on_the_event ∪ ⋃ dealPartyBaselineCapabilities(own lines)
  //
  // because one of the parties who must sign — crew — deliberately holds no
  // `agreement.confirm` at event scope (that is what decides the show's DATE in
  // `routes/holds.ts`, which is no crew member's call). A venue↔crew deal has exactly
  // two signatories, so without the deal-scoped half it could be sent and could never
  // freeze. Order is therefore: `event.view` → 404, not a party → 400, and only then
  // the capability → 403 — the party question is what the capability now depends on.
  // The agreement's own state comes LAST (`assertAgreementSignable` → 409): a draft
  // is terms nobody was shown, and refusing it is "not yet", not "you may not".
  app.post(
    "/deals/:did/confirm",
    { schema: { params: DealParams, response: { 200: DealResponse } } },
    async (request) => {
      const { database } = request.server;
      const principal = request.principal;
      if (!principal) throw new Error("principal missing after authentication");

      const deal = await loadDeal(request, request.params.did);
      const capabilities = await requireEventCapability(request, deal.eventId, "event.view");
      const viewer = await resolveDealAuthority(request, deal.eventId, capabilities);

      const result = await database.transaction(async (tx) => {
        const parties = await tx
          .select()
          .from(schema.dealParties)
          .where(eq(schema.dealParties.dealId, deal.id));
        const mine = parties.filter((party) =>
          viewer.viewerParticipantIds.includes(party.participantId),
        );
        // `mine` includes the lines of performers the caller represents as agent —
        // A-03's fix: a delegated performer hands their `agreement.confirm` to their
        // agent, so the agent signing the performer's OWN line is what unblocks the
        // deal (docs/agent-representation.md: "the agent confirms the performer's own
        // `deal_party` line"). It stamps that line and no other.
        if (mine.length === 0) throw badRequest("You are not a party to this deal");

        if (!(await maySignOwnLines(tx, capabilities, mine))) {
          throw forbidden("Missing capability: agreement.confirm");
        }
        // ...and only now the LIFECYCLE. Last, deliberately: the order above is
        // 404 → 400 → 403, and a 409 that jumped the queue would tell an event
        // participant with no line on this deal exactly how far along it is.
        // Someone entitled to sign is entitled to hear "not yet".
        assertAgreementSignable(deal);

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
        const allConfirmed = allSignatoriesConfirmed(fresh);
        // The SAME rollup the off-platform door runs (`lib/deal-confirmation.ts`).
        // Signing in the app and signing by link must not differ by a line in what
        // signing DOES, and they did while this route carried its own copy of the
        // freeze — a divergence a test could only catch after it had already
        // shipped. One module, two authorization stories.
        const current = await confirmDealIfComplete(tx, deal, fresh, now);
        /*
         * WHICH SIGNATURE FROZE THE TERMS — and it is the FIRST, not the last.
         *
         * This read `current.agreementStatus === "confirmed" && deal.agreementStatus !==
         * "confirmed"` — the status TRANSITION, which is the last signature. Since part 29 moved
         * the seal to the first (`termsAreSealed`), Event History printed "Terms frozen at this
         * confirmation" two signatures after the terms actually stopped moving, and printed
         * nothing at the moment they did (QA sweep run 12).
         *
         * `parties` is the PRE-transaction read and `fresh` the post, so the answer is the SAME
         * function asked twice: it was not sealed before and it is now. No second copy of the
         * predicate to drift — and it inherits the observer rule for free, where a hand-rolled
         * version had already disagreed with `termsAreSealed` about exactly that.
         *
         * It also reads false on an idempotent repeat confirm, which stamps nothing and freezes
         * nothing.
         */
        const termsFrozen = !termsAreSealed(deal, parties) && termsAreSealed(current, fresh);

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
        // A consent moment, so the row must say HOW FAR ALONG the signatures are —
        // three parties confirming used to write three indistinguishable rows, and
        // the feed said "somebody confirmed something".
        //
        // The precise participant ids stay in `audit_log` (`confirmedParticipantIds`
        // above) rather than here. A uuid is not something a person reading a
        // timeline can use; `actor_display` names who performed the act, and the
        // deal's own party list — which every party can already read — shows which
        // lines now carry a `confirmedAt`. This matters most under agent delegation,
        // where the actor is the agent and the bound party is the performer: the
        // feed says who acted, the deal says who is bound, the audit says both.
        await writeActivity(tx, request, {
          eventId: deal.eventId,
          type: allConfirmed ? "deal.confirmed" : "deal.party_confirmed",
          targetKind: "deal",
          targetId: deal.id,
          summary: {
            name: deal.name,
            agreementStatus: current.agreementStatus,
            confirmedCount: signatories.filter((party) => party.confirmedAt != null).length,
            signatoryCount: signatories.length,
            // Whether THIS confirmation is the one that froze the terms. The frozen
            // copy lives in `deals.confirmed_snapshot`; the history says when the
            // freeze happened and on whose signature.
            termsFrozen,
          },
        });
        return { deal: current, parties: fresh };
      });

      // Realtime + feed: PARTY-scoped, not event-scoped — a performer must not learn
      // that another party's terms moved (`deal.view.own`). Best-effort, post-commit.
      try {
        const actorUserId = request.principal?.userId ?? null;
        const recipients = await dealRecipients(request, deal);
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
      const { authority: viewer } = await requireDealAccess(request, deal, "agreement.manage");
      /*
       * WHAT SEALS THE TERMS IS WHAT REOPEN UNSEALS — the same predicate, on purpose.
       *
       * This used to be `agreementStatus === "confirmed" || "signed"`, which was the right
       * question only while the PATCH gate asked it too. Sealing the figures at the FIRST
       * signature (QA sweep run 11) and leaving this one at the last would have built a
       * deadlock: a partly-signed deal could be neither edited nor reopened, and the 409
       * refusing the edit points the caller straight at this route. A refusal that advises an
       * action the API also refuses is the same defect as a screen offering a control the API
       * will refuse — it just takes one more request to discover.
       *
       * A `sent` agreement NOBODY has signed is still not reopenable, and that is unchanged:
       * there is nothing to tear up, and moving it back to draft is un-sending, a different
       * act with a different name.
       */
      const signatories = await database
        .select({ confirmedAt: schema.dealParties.confirmedAt })
        .from(schema.dealParties)
        .where(eq(schema.dealParties.dealId, deal.id));
      if (!termsAreSealed(deal, signatories)) {
        throw conflict("Only an agreement somebody has signed can be reopened");
      }

      const { expectedVersion, reason } = request.body;
      const where =
        expectedVersion != null
          ? and(eq(schema.deals.id, deal.id), eq(schema.deals.version, expectedVersion))
          : eq(schema.deals.id, deal.id);

      const result = await database.transaction(async (tx) => {
        const now = new Date();
        // An agent may sign and UNSIGN only the performers it manages. On a shared
        // split an agented and a self-managed act sit on one deal, and a deal-wide
        // clear would let the agent tear up the signature of an act it has no
        // relationship with — the case the per-deal invariant exists to govern
        // (`authorization/SKILL.md`: authority is "scoped to each represented
        // performer's deal / split-line"). `confirm` is already line-scoped; this
        // makes reopen agree with it.
        //
        // Anyone acting for themselves — the operator on its own deal, a performer
        // on their own line — keeps the deal-wide clear: renegotiating terms you are
        // a direct counterparty to invalidates every signature on them.
        const clearScope = viewer.actsOnlyAsAgent
          ? and(
              eq(schema.dealParties.dealId, deal.id),
              inArray(schema.dealParties.participantId, viewer.representedParticipantIds),
            )
          : eq(schema.dealParties.dealId, deal.id);
        await tx
          .update(schema.dealParties)
          .set({ confirmedAt: null, confirmedBy: null })
          .where(clearScope);
        const [after] = await tx
          .update(schema.deals)
          .set({
            agreementStatus: "sent",
            // AND THE DEAL GOES BACK WITH IT. `deals.status` is written forward by
            // the last signature (`lib/deal-confirmation.ts`); reopening tears
            // every signature up, so a `status` left reading `confirmed` would be
            // a high-water mark rather than a fact — and its two readers would act
            // on it. The Budget Planner would keep rendering the fee as a signed,
            // READ-ONLY heading ("a number you cannot edit had better be one both
            // parties have signed", `useBudgetSeed`) for terms that are back under
            // negotiation. A withdrawn deal stays withdrawn: reopening an
            // agreement is not a way to un-cancel the deal it belonged to.
            status: deal.status === "cancelled" ? "cancelled" : "draft",
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

      // Realtime + feed, PARTY-scoped like `sent` and `confirmed`. Reopening is the
      // one movement on this route that TAKES SOMETHING BACK — every signature on
      // the agreement is cleared and each party has to sign again — and it was the
      // one nobody was told about. A performer whose confirmed terms have been
      // reopened for renegotiation learns it from their own bell, not from noticing
      // the button has come back.
      try {
        const actorUserId = request.principal?.userId ?? null;
        const recipients = await dealRecipients(request, deal);
        const dealName = deal.name ?? "a deal";
        await notifyUsers(
          database,
          recipients,
          actorUserId,
          {
            type: "deal.reopened",
            title: `"${dealName}" was reopened for renegotiation`,
            // The REASON, when one was given (`123qy9rnh3f`). It is asked for in the
            // reopen dialog and was then kept from the one person it is addressed to:
            // a performer read that their confirmation had been cleared and could not
            // tell whether the fee, the date or a typo was being renegotiated.
            body: reason
              ? `${reason} — your confirmation was cleared, so the agreement needs signing again.`
              : "Your confirmation was cleared — the agreement needs signing again.",
            eventId: deal.eventId,
            actorDisplay: request.firebaseUser?.name ?? undefined,
            link: `/events/${deal.eventId}`,
            metadata: { dealId: deal.id },
          },
          {
            sink: request.server.emailSink,
            message: renderNotificationEmail({
              subject: `Agreement reopened: ${dealName}`,
              preheader: "Your confirmation was cleared and the terms are open again.",
              heading: "An agreement you signed was reopened",
              paragraphs: [
                `"${dealName}" has been reopened for renegotiation, so every confirmation on it — including yours — has been cleared.`,
                // NO TERMS IN THE MAIL. A deal is party-scoped (`deal.view.own`)
                // and this one message goes to every party, so it says that the
                // agreement moved and sends them to the screen that can show each
                // of them only their own line.
                "Open the event to read the current terms and sign again when they are right.",
              ],
              action: { label: "Open the event", path: `/events/${deal.eventId}` },
            }),
          },
        );
      } catch (error) {
        request.log.error({ error, dealId: deal.id }, "deal.reopened notification failed");
      }

      return serializeDeal(result.deal, result.parties, viewer);
    },
  );

  // Delete a deal — `deal.edit`, optimistic-lock on version, audited.
  app.delete(
    "/deals/:did",
    {
      schema: {
        params: DealParams,
        // Nullish (QA9-16): a bare `DELETE /deals/:did` with no body used to answer 400 about the
        // body it did not send, where `DELETE /events/:id` had always accepted one.
        body: OptimisticLockBody,
      },
    },
    async (request, reply) => {
      const { database } = request.server;
      const before = await loadDeal(request, request.params.did);
      await requireDealAccess(request, before, "deal.edit");

      /*
       * DRAFT, AND NOTHING SETTLED — decisions §25.7.2 (Daniel, 2026-09-28).
       *
       * The route had no caller in either front end (QA sweep run 8, QA8-1) and no guard at all:
       * it would happily destroy a signed agreement out of a settled night, taking with it the
       * entitlement the engine computed from it and leaving `settlement_lines` describing money
       * owed under a document that no longer exists.
       *
       * The rule is `dealDeletability` in `@showme/shared` and not written out here, because the
       * front end has to ask the same question to decide whether to OFFER the control — the
       * ruling says so in as many words ("the UI must not offer a delete the API will refuse").
       * The existence of a settlement is read for the EVENT, not for the caller: the caller's own
       * settlement is a different fact, and a co-host who has none of their own must not be able
       * to delete a deal out of a night the host has already settled.
       */
      const [settlement] = await database
        .select({ id: schema.settlements.id })
        .from(schema.settlements)
        .where(eq(schema.settlements.eventId, before.eventId))
        .limit(1);
      const deletability = dealDeletability(before, { hasSettlement: Boolean(settlement) });
      if (!deletability.deletable) {
        throw conflict(deletability.reason ?? "This agreement cannot be deleted.");
      }

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
        // Deleting an agreement is the largest single change that can happen to a
        // party's money, so it goes in the history. Note the reach: `deal_parties`
        // cascades with the deal, so the party-scoped read can no longer resolve
        // the erstwhile parties and this row lands for the OPERATORS only. The
        // forensic record — including who the parties were — is in `audit_log`.
        await writeActivity(tx, request, {
          eventId: before.eventId,
          type: "deal.deleted",
          targetKind: "deal",
          targetId: before.id,
          summary: { name: before.name, agreementStatus: before.agreementStatus },
        });
      });

      return reply.status(204).send();
    },
  );
}

/** Fetch a deal by id or 404 — the row that carries `eventId` for authorization. */
/**
 * May the caller sign the lines they stand behind on this deal?
 *
 * The event-level answer comes first — an operator, performer or agent already
 * carries `agreement.confirm` from the floor/band composition. What is left is the
 * DEAL-scoped half (`@showme/auth`'s `dealPartyBaselineCapabilities`): a crew member
 * named as a signatory party on this one agreement may sign this one agreement, and
 * nothing else, anywhere else. It is resolved from the caller's OWN party lines and
 * the event role each of those lines belongs to, so it can never reach a deal they
 * are not named on — and never a line of somebody else's on a deal they are.
 */
async function maySignOwnLines(
  /*
   * A transaction OR the pool: the confirm route asks inside its write, and
   * `GET /deals/awaiting-signature` asks outside one. Same question, same answer, one
   * implementation — a second copy of this is how a dashboard starts offering a row the
   * confirm route then refuses (QA6-1 was exactly a party who could not sign).
   */
  tx: Transaction | Database,
  capabilities: Set<Capability>,
  mine: DealPartyRow[],
): Promise<boolean> {
  if (capabilities.has("agreement.confirm")) return true;

  const participants = await tx
    .select({ id: schema.eventParticipants.id, role: schema.eventParticipants.role })
    .from(schema.eventParticipants)
    .where(
      inArray(
        schema.eventParticipants.id,
        mine.map((party) => party.participantId),
      ),
    );
  const roleByParticipantId = new Map(participants.map((row) => [row.id, row.role as EventRole]));

  return mine.some((party) => {
    const eventRole = roleByParticipantId.get(party.participantId);
    if (!eventRole) return false;
    return dealPartyBaselineCapabilities(eventRole, party.roleInDeal as DealPartyRole).includes(
      "agreement.confirm",
    );
  });
}

async function loadDeal(request: FastifyRequest, dealId: string): Promise<DealRow> {
  const [deal] = await request.server.database
    .select()
    .from(schema.deals)
    .where(eq(schema.deals.id, dealId));
  if (!deal) throw notFound("Deal not found");
  return deal;
}
