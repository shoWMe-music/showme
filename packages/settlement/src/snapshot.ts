import type { EntitlementBasis, EntitlementLine, PartyBreakdown, PoolLadder } from "./types";

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
  /**
   * WHY the entitlement is what it is. Optional on the way IN because rows
   * snapshotted before this existed do not carry it and must keep reading back —
   * a settlement already finalized is a legal record and is never rewritten.
   * Everything `reconcile()` produces from now on carries all four.
   */
  lines?: SerializedEntitlementLine[];
  commissionEarned?: string;
  deductibles?: string;
  residual?: string;
}

/** One deal's contribution to a party's entitlement, money as STRING. */
export interface SerializedEntitlementLine {
  dealId: string;
  dealTotal: string;
  amount: string;
  basis: SerializedBasis;
  bonus?: string;
  escalatorApplied?: boolean;
  commissionCharged?: string;
}

/**
 * `EntitlementBasis` with its money as strings — same discriminants.
 *
 * `pool` and `door` are OPTIONAL, and only because this type is transported as
 * well as persisted. As WRITTEN they are always present — `serializeBasis` below
 * fills every operand the engine compared. On the way OUT to a party who may not
 * read the pool, the API redacts exactly these two (`redactPool` in
 * `apps/api/src/serialize/settlement.ts`): `pool` IS the adjusted net, and
 * `door / basisPoints` hands it straight back. A reader must therefore cope with
 * their absence, which is what making them optional says.
 */
export type SerializedBasis =
  | { kind: "guarantee"; guarantee: string }
  | { kind: "rental"; rental: string }
  | { kind: "door_split"; basisPoints: number; pool?: string }
  | {
      kind: "guarantee_vs_door";
      won: "guarantee" | "door";
      guarantee: string;
      door?: string;
      basisPoints: number;
      pool?: string;
    }
  | { kind: "paper" };

/** The gross → adjusted-net ladder, money as STRING. */
export interface SerializedLadder {
  revenue: string;
  costs: string;
  pool: string;
  offTheTop: string;
  splitPool: string;
}

/** Turn the pool ladder into its JSON-safe (string money) form. */
export function serializeLadder(ladder: PoolLadder): SerializedLadder {
  return {
    revenue: ladder.revenue.toString(),
    costs: ladder.costs.toString(),
    pool: ladder.pool.toString(),
    offTheTop: ladder.offTheTop.toString(),
    splitPool: ladder.splitPool.toString(),
  };
}

function serializeBasis(basis: EntitlementBasis): SerializedBasis {
  switch (basis.kind) {
    case "guarantee":
      return { kind: "guarantee", guarantee: basis.guarantee.toString() };
    case "rental":
      return { kind: "rental", rental: basis.rental.toString() };
    case "door_split":
      return {
        kind: "door_split",
        basisPoints: basis.basisPoints,
        pool: basis.pool.toString(),
      };
    case "guarantee_vs_door":
      return {
        kind: "guarantee_vs_door",
        won: basis.won,
        guarantee: basis.guarantee.toString(),
        door: basis.door.toString(),
        basisPoints: basis.basisPoints,
        pool: basis.pool.toString(),
      };
    default:
      return { kind: "paper" };
  }
}

function serializeLine(line: EntitlementLine): SerializedEntitlementLine {
  return {
    dealId: line.dealId,
    dealTotal: line.dealTotal.toString(),
    amount: line.amount.toString(),
    basis: serializeBasis(line.basis),
    ...(line.bonus != null ? { bonus: line.bonus.toString() } : {}),
    ...(line.escalatorApplied ? { escalatorApplied: true } : {}),
    ...(line.commissionCharged != null
      ? { commissionCharged: line.commissionCharged.toString() }
      : {}),
  };
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
    lines: breakdown.lines.map(serializeLine),
    commissionEarned: breakdown.commissionEarned.toString(),
    deductibles: breakdown.deductibles.toString(),
    residual: breakdown.residual.toString(),
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

/**
 * What actually goes into `settlements.computed` (jsonb) — one party's breakdown,
 * plus a copy of the event-level POOL LADDER that produced it.
 *
 * The ladder is a fact about the night, not about the party, so duplicating it
 * onto every row looks wrong until you ask where else it could live: `settlements`
 * is per participant or per representation by CHECK, so there is no event-level row
 * to hang it on, and recomputing it on read would show figures that disagree with
 * the frozen ones the moment a budget line moved. A snapshot repeating a shared
 * header is the ordinary shape of a snapshot.
 *
 * It lives here, beside `serializeBreakdown`, for the reason that comment gives:
 * the route and the seeds both write this column, and audit A-13 is what a second
 * hand-written copy of the shape costs.
 *
 * **It is never SERVED from a party row.** The API's `serializeSettlement` strips
 * the ladder every time and hands it back only at the top level of a response, to
 * a caller the route has just checked may read the pool.
 */
export interface StoredBreakdown extends SerializedBreakdown {
  ladder?: SerializedLadder;
}

/** A party's breakdown plus the ladder, as a snapshot writer persists it. */
export function storeBreakdown(breakdown: PartyBreakdown, ladder: PoolLadder): StoredBreakdown {
  return { ...serializeBreakdown(breakdown), ladder: serializeLadder(ladder) };
}
