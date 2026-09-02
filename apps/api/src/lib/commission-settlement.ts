import { schema } from "@showme/db";
import { settleRepresentation } from "@showme/settlement";
import { and, eq, isNotNull } from "drizzle-orm";
import type { Transaction } from "./audit";
import { isRepresentationActiveAt } from "./representation-rules";
import { type DesiredTransfer, reconcileTransfers } from "./settlement-transfers";

/**
 * The per-participant figures the event settlement produced (minor units).
 *
 * BOTH are needed, because the commissionable base is the entitlement BEFORE
 * deductibles and `entitlement` is the figure after them — see
 * `commissionableIncomeOf` below for why that is not the same number.
 */
interface Breakdown {
  participantId: string;
  entitlement: bigint;
  deductibles: bigint;
}

/**
 * WHAT AN AGENT'S COMMISSION IS A PERCENTAGE OF — the GROSS deal income, before
 * any cost the performer bore.
 *
 * `.claude/skills/settlement/SKILL.md` has always said reimbursements are **not**
 * commissionable, and this file's own header has always claimed it settles "the
 * performer's gross entitlement". Neither was true: it read `breakdown.entitlement`,
 * which `reconcile()` step 3 has already LOWERED by every cost borne by that party.
 * So a venue fronting a hotel quietly cut the agent's fee.
 *
 * The worked example from ClickUp `86cba8wtb`: performer entitled to 10 000, venue
 * paid a 1 000 hotel deducted from their cut, agent on 15%.
 *
 *   before — 15% of 9 000 = 1 350
 *   after  — 15% of 10 000 = 1 500
 *
 * 150 to the agent, on one hotel room, and it compounds across a roster. The
 * reason it goes this way round is not arithmetic: **the agent did not consume the
 * hotel.** An agent's commission is a share of what they booked the artist for,
 * not of what the artist happened to take home after the venue bought them a bed.
 * Industry practice commissions the gross fee, and our own documentation already
 * said so — this was code contradicting docs, not an open question.
 *
 * `entitlement + deductibles` reconstructs the gross exactly, because the
 * breakdown's own identity is
 *
 *   entitlement = Σ lines.amount + commissionEarned + residual − deductibles
 *
 * and an agented PERFORMER carries neither `commissionEarned` (a commission party
 * is never an agent — `assertPartiesAreEntitled` refuses it) nor `residual` (that
 * is the operator's alone). So for exactly the parties this runs for, the sum is
 * `Σ lines.amount`: the deal income, and nothing else.
 */
function commissionableIncomeOf(breakdown: Breakdown): bigint {
  return breakdown.entitlement + breakdown.deductibles;
}

/**
 * Representation commission settlements (decisions #14). On every event where an
 * agent is present for a performer, the commission settles PRIVATELY between the
 * two — never as a deal party, never as a term in the event's `Σ net = 0` (the
 * event keeps the performer at full gross). We (re)derive one representation-scoped
 * settlement + its single transfer per agented performer, from the performer's
 * gross entitlement × the representation's commission rate. Direction follows who
 * held the cash (see `settleRepresentation`). Settled manually like any transfer
 * (owed → paid → handled); auto-pay is a later, opt-in layer.
 *
 * Idempotent: called inside the event settlement compute, after the participant
 * rows are written, so it re-derives cleanly on every recompute — and the commission
 * TRANSFERS go through `reconcileTransfers`, so a commission the performer already
 * marked `paid` survives a recompute instead of reverting to `owed` (audit A-08).
 */
export async function syncCommissionSettlements(
  tx: Transaction,
  eventId: string,
  breakdowns: Breakdown[],
  baseCurrency: string,
): Promise<void> {
  // Recompute-safe: drop the prior representation-scoped settlements. Their
  // transfers are NOT dropped — they are reconciled at the end of this function, so
  // a recorded payment is never silently discarded.
  await tx
    .delete(schema.settlements)
    .where(
      and(eq(schema.settlements.eventId, eventId), isNotNull(schema.settlements.representationId)),
    );

  const commissionableByParticipant = new Map(
    breakdowns.map((breakdown) => [breakdown.participantId, commissionableIncomeOf(breakdown)]),
  );
  const desiredTransfers: DesiredTransfer[] = [];

  const participants = await tx
    .select()
    .from(schema.eventParticipants)
    .where(eq(schema.eventParticipants.eventId, eventId));

  // The agent is present as an `event_participants(role=agent)` row (materialized on
  // assignment) — the transfer points at that participant id.
  const agentParticipantByProfile = new Map(
    participants.filter((p) => p.role === "agent").map((p) => [p.profileId, p.id]),
  );

  for (const performer of participants) {
    // An erased participant (migration 0032) has no profile to hold a
    // representation, so there is no commission to compute for it.
    if (performer.profileId === null) continue;
    const details = performer.details as { delegatedToAgentProfileId?: string } | null;
    const agentProfileId = details?.delegatedToAgentProfileId;
    if (!agentProfileId) continue;

    const agentParticipantId = agentParticipantByProfile.get(agentProfileId);
    if (!agentParticipantId) continue; // agent no longer present — nothing to settle

    // The standing agreement carries the rate + who collects.
    const [representation] = await tx
      .select()
      .from(schema.representations)
      .where(
        and(
          eq(schema.representations.agentProfileId, agentProfileId),
          eq(schema.representations.performerProfileId, performer.profileId),
          eq(schema.representations.status, "active"),
        ),
      );
    // `status = 'active'` is the SQL prefilter; liveness is the shared helper —
    // a representation in its notice period still earns commission, one past its
    // effective moment does not, whether or not the sweep has run yet (A-19).
    if (!representation || !isRepresentationActiveAt(representation, new Date())) continue;
    if (representation.commissionRate == null) continue;

    const performerEntitlement = commissionableByParticipant.get(performer.id) ?? 0n;
    const { commission, transfer } = settleRepresentation({
      performerEntitlement,
      commissionBasisPoints: representation.commissionRate,
      agentCollects: representation.agentCollects,
    });

    await tx.insert(schema.settlements).values({
      eventId,
      representationId: representation.id,
      computed: {
        performerParticipantId: performer.id,
        agentParticipantId,
        performerEntitlement: performerEntitlement.toString(),
        commission: commission.toString(),
        agentCollects: representation.agentCollects,
      },
    });

    if (transfer) {
      const participantOf = (party: "performer" | "agent") =>
        party === "performer" ? performer.id : agentParticipantId;
      desiredTransfers.push({
        representationId: representation.id,
        fromParticipant: participantOf(transfer.from),
        toParticipant: participantOf(transfer.to),
        amount: transfer.amount,
        currency: baseCurrency,
      });
    }
  }

  await reconcileTransfers(tx, eventId, desiredTransfers, "representation");
}
