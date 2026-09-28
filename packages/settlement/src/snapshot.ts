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
  /**
   * Money moved before the night under a deal (`prepaid.ts`). Optional on the way
   * IN for the same reason as the four above: a settlement finalized before this
   * existed is a legal record and is never rewritten, so it reads back as absent
   * and means zero.
   */
  prepaid?: string;
  /**
   * The parties on the other end of that early money, so a settlement can be read
   * as *"paid in advance by X"* rather than as an unattributed figure — which is
   * how the product owner asked for it (ClickUp `86cbcn1ue`).
   *
   * Optional and absent-means-none, for the same reason as `prepaid` itself: a
   * settlement finalized before this existed is a legal record and is never
   * rewritten to add a field.
   */
  prepaidCounterpartyIds?: string[];
  /**
   * The deductions behind `deductibles`, itemised. Money as STRING like every
   * other figure here. Optional and absent-means-none: a settlement finalized
   * before this existed is a legal record and is never rewritten to add a field.
   */
  deductibleLines?: { label: string; amount: string }[];
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
  /** This party's share OF THE DEAL, in basis points. Absent on a single-payee deal. */
  partyBasisPoints?: number;
}

/**
 * `EntitlementBasis` with its money as strings — same discriminants.
 *
 * `base` and `door` are OPTIONAL, and only because this type is transported as
 * well as persisted. As WRITTEN they are always present — `serializeBasis` below
 * fills every operand the engine compared. On the way OUT to a party who may not
 * read the whole night's takings, the API redacts exactly these two (`redactPool`
 * in `apps/api/src/serialize/settlement.ts`), because `door / basisPoints` hands
 * the base straight back. A reader must therefore cope with their absence, which
 * is what making them optional says.
 *
 * `base` WAS `pool` and the rename is the point (#23.1): it is gross ticket
 * revenue, not the adjusted net, and a field still called `pool` would keep
 * telling every future reader that costs had already come off it.
 */
export type SerializedBasis =
  | { kind: "guarantee"; guarantee: string }
  | { kind: "rental"; rental: string; borneByPayer?: boolean }
  | { kind: "door_split"; basisPoints: number; base?: string }
  | {
      kind: "guarantee_vs_door";
      won: "guarantee" | "door";
      guarantee: string;
      door?: string;
      basisPoints: number;
      base?: string;
    }
  | { kind: "paper" };

/**
 * The gross → adjusted-net waterfall, money as STRING.
 *
 * Every field is optional to READ and required to WRITE, and that asymmetry is
 * deliberate. Snapshots frozen before 2026-09-15 carry the previous shape
 * (`pool` / `splitPool` / `doorBase`) and are immutable legal records, so a
 * reader must cope with their absence rather than a migration rewriting them.
 * `poolLadderOf` below is the one place that decides what a missing row means.
 */
export interface SerializedLadder {
  revenue: string;
  attributed: string;
  costs: string;
  netRevenue: string;
  offTheTop: string;
  adjustedNet: string;
}

/**
 * A ladder as it was stored, which may predate the waterfall — the shape written
 * before 2026-09-15 named the same money differently and had no `attributed` row.
 */
export interface StoredLadder extends Partial<SerializedLadder> {
  /** The pre-2026-09-15 name for `netRevenue`. */
  pool?: string;
  /** The pre-2026-09-15 name for `adjustedNet` — it equalled `pool` then. */
  splitPool?: string;
  /** The pre-2026-09-15 split base: gross ticket revenue, which nothing else held. */
  doorBase?: string;
}

/** Turn the waterfall into its JSON-safe (string money) form. */
export function serializeLadder(ladder: PoolLadder): SerializedLadder {
  return {
    revenue: ladder.revenue.toString(),
    attributed: ladder.attributed.toString(),
    costs: ladder.costs.toString(),
    netRevenue: ladder.netRevenue.toString(),
    offTheTop: ladder.offTheTop.toString(),
    adjustedNet: ladder.adjustedNet.toString(),
  };
}

/**
 * Read a stored ladder as a waterfall, whenever it is old enough to need it.
 *
 * An old snapshot has `pool` where this one has `netRevenue`, and no row at all
 * for `attributed`. Filling those in from the old names is not a rewrite of
 * history — the money is identical, only the vocabulary moved — but `adjustedNet`
 * is the one row where the two eras genuinely disagree: before 2026-09-15 a split
 * divided `doorBase`, which is a different figure from anything in this shape.
 * Where that is all there is, `doorBase` is returned as the split base it was, and
 * the screen says the settlement predates the waterfall rather than drawing a
 * chain that never happened.
 */
export function poolLadderOf(stored: StoredLadder): SerializedLadder & { legacy: boolean } {
  const legacy = stored.netRevenue == null;
  const netRevenue = stored.netRevenue ?? stored.pool ?? "0";
  return {
    revenue: stored.revenue ?? "0",
    attributed: stored.attributed ?? "0",
    costs: stored.costs ?? "0",
    netRevenue,
    offTheTop: stored.offTheTop ?? "0",
    adjustedNet: stored.adjustedNet ?? stored.doorBase ?? stored.splitPool ?? netRevenue,
    legacy,
  };
}

function serializeBasis(basis: EntitlementBasis): SerializedBasis {
  switch (basis.kind) {
    case "guarantee":
      return { kind: "guarantee", guarantee: basis.guarantee.toString() };
    case "rental":
      return {
        kind: "rental",
        rental: basis.rental.toString(),
        ...(basis.borneByPayer ? { borneByPayer: true } : {}),
      };
    case "door_split":
      return {
        kind: "door_split",
        basisPoints: basis.basisPoints,
        base: basis.base.toString(),
      };
    case "guarantee_vs_door":
      return {
        kind: "guarantee_vs_door",
        won: basis.won,
        guarantee: basis.guarantee.toString(),
        door: basis.door.toString(),
        basisPoints: basis.basisPoints,
        base: basis.base.toString(),
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
    ...(line.partyBasisPoints != null ? { partyBasisPoints: line.partyBasisPoints } : {}),
  };
}

/** Turn one engine breakdown into its JSON-safe (string money) form. */
export function serializeBreakdown(breakdown: PartyBreakdown): SerializedBreakdown {
  return {
    participantId: breakdown.participantId,
    entitlement: breakdown.entitlement.toString(),
    collected: breakdown.collected.toString(),
    paid: breakdown.paid.toString(),
    prepaid: breakdown.prepaid.toString(),
    // Omitted rather than written empty when nothing moved early — a stored `[]`
    // on every settlement in the product is noise in a `jsonb` column that is read
    // back as a legal record.
    ...(breakdown.prepaidCounterpartyIds.length > 0
      ? { prepaidCounterpartyIds: breakdown.prepaidCounterpartyIds }
      : {}),
    // Omitted rather than written empty, for the same reason: most parties on most
    // nights carry no deduction at all, and an `[]` on each of them is noise in a
    // column that is read back as a legal record.
    ...(breakdown.deductibleLines.length > 0
      ? {
          deductibleLines: breakdown.deductibleLines.map((line) => ({
            label: line.label,
            amount: line.amount.toString(),
          })),
        }
      : {}),
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
  commissionableIncome: string;
  commission: string;
  agentCollects: boolean;
}

/** Turn one representation settlement into its JSON-safe (string money) form. */
export function serializeCommissionSnapshot(input: {
  performerParticipantId: string;
  agentParticipantId: string;
  commissionableIncome: bigint;
  commission: bigint;
  agentCollects: boolean;
}): SerializedCommissionSnapshot {
  return {
    performerParticipantId: input.performerParticipantId,
    agentParticipantId: input.agentParticipantId,
    commissionableIncome: input.commissionableIncome.toString(),
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
