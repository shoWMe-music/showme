import type { PartyBreakdown } from "./types";

/**
 * One party's settlement line as it is **persisted and transported** — money as
 * STRING (money.md: minor units past 2^53 are unsafe as a JS number, so money
 * never crosses the JSON boundary as a number).
 *
 * This shape is the contract between three places that used to each know it
 * separately: the engine, `settlements.computed` (jsonb), and the API's
 * `BreakdownResponse`. Audit A-13 is what a fourth, hand-written copy costs — the
 * seed stored `cashHeld` and no `participantId`, so the reference concluded event
 * failed response validation with a 500 for every viewer. One definition, imported
 * by everything that writes a snapshot, is what stops that recurring.
 */
export interface SerializedBreakdown {
  participantId: string;
  entitlement: string;
  collected: string;
  paid: string;
  held: string;
  net: string;
}

/** Turn one engine breakdown into its JSON-safe (string money) form. */
export function serializeBreakdown(breakdown: PartyBreakdown): SerializedBreakdown {
  return {
    participantId: breakdown.participantId,
    entitlement: breakdown.entitlement.toString(),
    collected: breakdown.collected.toString(),
    paid: breakdown.paid.toString(),
    held: breakdown.held.toString(),
    net: breakdown.net.toString(),
  };
}

/**
 * The private agent↔performer commission as it is persisted into a
 * representation-scoped `settlements.computed` (decisions #14). Same reasoning as
 * the breakdown above: the API reads exactly these keys to decide who may see the
 * row and what it says, so nothing may write the shape from memory. The seeded
 * commission did, spelling none of the keys the reader looks for, which made the
 * reference commission invisible to the two people it belongs to.
 */
export interface SerializedCommissionSnapshot {
  performerParticipantId: string;
  agentParticipantId: string;
  performerEntitlement: string;
  commission: string;
  agentCollects: boolean;
}

/** Turn one representation settlement into its JSON-safe (string money) form. */
export function serializeCommissionSnapshot(input: {
  performerParticipantId: string;
  agentParticipantId: string;
  performerEntitlement: bigint;
  commission: bigint;
  agentCollects: boolean;
}): SerializedCommissionSnapshot {
  return {
    performerParticipantId: input.performerParticipantId,
    agentParticipantId: input.agentParticipantId,
    performerEntitlement: input.performerEntitlement.toString(),
    commission: input.commission.toString(),
    agentCollects: input.agentCollects,
  };
}
