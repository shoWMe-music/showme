import { schema } from "@showme/db";
import { settleRepresentation } from "@showme/settlement";
import { and, eq, isNotNull } from "drizzle-orm";
import type { Transaction } from "./audit";
import { isRepresentationActiveAt } from "./representation-rules";
import { type DesiredTransfer, reconcileTransfers } from "./settlement-transfers";

/** The per-participant entitlement the event settlement produced (gross, minor units). */
interface Breakdown {
  participantId: string;
  entitlement: bigint;
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

  const entitlementByParticipant = new Map(breakdowns.map((b) => [b.participantId, b.entitlement]));
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

    const performerEntitlement = entitlementByParticipant.get(performer.id) ?? 0n;
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
