import type { schema } from "@showme/db";
import {
  type SerializedBreakdown,
  type SerializedLadder,
  type SettlementResult,
  type StoredBreakdown,
  serializeBreakdown,
  serializeLadder,
  storeBreakdown,
} from "@showme/settlement";

type SettlementRow = typeof schema.settlements.$inferSelect;
type TransferRow = typeof schema.settlementTransfers.$inferSelect;

/**
 * One party's line, money as STRING (money.md), and the shape persisted into
 * `settlements.computed` (jsonb). Defined ONCE, in the engine — every writer of a
 * snapshot (this route, the seeds) imports the same type and the same serializer,
 * because a second hand-written copy is exactly what audit A-13 was.
 */
export type { SerializedBreakdown, SerializedLadder, StoredBreakdown };
export { serializeBreakdown, storeBreakdown };

/**
 * The event's pool ladder, read back off whichever stored row carries it.
 *
 * Every row of one compute carries the same ladder, so the first one that has it
 * is the answer; rows snapshotted before the ladder existed carry none, and null
 * is the honest reading of that — "this event has not been recomputed since",
 * not a zero.
 */
export function ladderOf(rows: { computed: unknown }[]): SerializedLadder | null {
  for (const row of rows) {
    const ladder = (row.computed as StoredBreakdown | null)?.ladder;
    if (ladder) return ladder;
  }
  return null;
}

/** The compute summary: the pool plus every party's breakdown and the transfers. */
export interface SerializedSummary {
  baseCurrency: string;
  pool: string;
  /** Gross revenue → adjusted net, the number every percentage below it is of. */
  ladder: SerializedLadder;
  breakdowns: SerializedBreakdown[];
  transfers: SerializedTransfer[];
}

export interface SerializedTransfer {
  id?: string;
  fromParticipantId: string;
  toParticipantId: string;
  amount: string;
  state?: string;
  version?: number;
  /** Set → a private agent↔performer commission transfer (decisions #14). */
  representationId?: string | null;
}

/**
 * A private agent↔performer commission settlement (decisions #14). Shaped
 * distinctly from a participant breakdown — the operator never receives one.
 */
export interface SerializedCommission {
  id: string;
  representationId: string;
  performerParticipantId: string;
  agentParticipantId: string;
  performerEntitlement: string;
  commission: string;
  agentCollects: boolean;
  status: string;
  version: number;
}

export interface SerializedSettlement {
  id: string;
  participantId: string | null;
  status: string;
  computed: SerializedBreakdown | null;
  version: number;
}

/** The full compute result as strings — the POST /compute response body. */
export function serializeSummary(result: SettlementResult): SerializedSummary {
  return {
    baseCurrency: result.baseCurrency,
    pool: result.pool.toString(),
    ladder: serializeLadder(result.ladder),
    breakdowns: result.breakdowns.map(serializeBreakdown),
    transfers: result.transfers.map((transfer) => ({
      fromParticipantId: transfer.fromParticipantId,
      toParticipantId: transfer.toParticipantId,
      amount: transfer.amount.toString(),
    })),
  };
}

/**
 * Strip the POOL out of the rule a line settled under.
 *
 * `basis` names the operands the engine compared, and on a percentage arm two of
 * them are the pool itself: `pool` IS `ladder.splitPool`, and `door` divided by
 * `basisPoints` gives it straight back. Serving those on a party row would hand a
 * performer the event's adjusted net through the side door, while `ladder` — the
 * same figure — is withheld two lines below. story.md:44 draws that boundary and
 * calls it inviolable: a performer sees "only their own slice — never the event
 * budget/pool … even if an operator wanted to show them", and
 * `POOL_CAPABILITIES` in `packages/auth` is that sentence as code.
 *
 * What survives is the party's OWN terms — which rule fired, their percentage,
 * their guarantee, which side won — so the line still says what it is, just not
 * what the whole room took. The stored snapshot keeps every operand; this is a
 * transport-time redaction, so an operator's view loses nothing.
 *
 * **This is not, and cannot be, arithmetically airtight, and no reader should
 * believe otherwise.** A sole payee who is told she took 70% and that the deal paid
 * 4 830 000 can divide. Hiding the base while stating the percentage and the amount
 * is not a thing a redaction can achieve — the only way to close that would be to
 * withhold her own percentage, which is a term she signed and the one number that
 * makes the line checkable at all. What this DOES remove is the event's takings and
 * costs (`ladder`) and any pool figure for a party whose deal does not already
 * imply one — a guarantee, a rental, a shared split. That is the disclosure the
 * ceiling is actually about; the rest is a consequence of percentage deals existing.
 */
function redactPool(breakdown: SerializedBreakdown): SerializedBreakdown {
  if (!breakdown.lines) return breakdown;
  return {
    ...breakdown,
    lines: breakdown.lines.map((line) => {
      switch (line.basis.kind) {
        case "door_split": {
          const { pool: _pool, ...basis } = line.basis;
          return { ...line, basis };
        }
        case "guarantee_vs_door": {
          const { pool: _pool, door: _door, ...basis } = line.basis;
          return { ...line, basis };
        }
        default:
          // `guarantee`, `rental` and `paper` name no pool to begin with.
          return line;
      }
    }),
  };
}

/**
 * A stored settlement row — `computed` is already string money (jsonb).
 *
 * The pool ladder stored alongside the breakdown is STRIPPED here, unconditionally,
 * and so are the pool operands inside each line's `basis` unless the caller is
 * explicitly known to hold pool visibility. It is the operator's view of the whole
 * night (what the room took, what it cost), and a party row is exactly the payload
 * that goes to a performer. Whoever may see the ladder gets it from `ladderOf` at
 * the top level of the response, where the route has just decided they may.
 *
 * `includePool` DEFAULTS TO FALSE on purpose: a new caller that forgets to think
 * about this leaks nothing, and the one route that may show the pool has to say so.
 */
export function serializeSettlement(
  row: SettlementRow,
  { includePool = false }: { includePool?: boolean } = {},
): SerializedSettlement {
  const stored = (row.computed as StoredBreakdown | null) ?? null;
  let computed: SerializedBreakdown | null = null;
  if (stored) {
    const { ladder: _ladder, ...breakdown } = stored;
    computed = includePool ? breakdown : redactPool(breakdown);
  }
  return {
    id: row.id,
    participantId: row.participantId,
    status: row.status,
    computed,
    version: row.version,
  };
}

/** A stored transfer row — amount back to STRING, DB column names normalized. */
export function serializeTransfer(row: TransferRow): SerializedTransfer {
  return {
    id: row.id,
    fromParticipantId: row.fromParticipant,
    toParticipantId: row.toParticipant,
    amount: row.amount.toString(),
    state: row.state,
    version: row.version,
    representationId: row.representationId,
  };
}

/** Shape a representation-scoped settlement row from its `computed` jsonb. */
export function serializeCommission(row: SettlementRow): SerializedCommission {
  const computed = (row.computed ?? {}) as {
    performerParticipantId?: string;
    agentParticipantId?: string;
    performerEntitlement?: string;
    commission?: string;
    agentCollects?: boolean;
  };
  return {
    id: row.id,
    representationId: row.representationId as string,
    performerParticipantId: computed.performerParticipantId ?? "",
    agentParticipantId: computed.agentParticipantId ?? "",
    performerEntitlement: computed.performerEntitlement ?? "0",
    commission: computed.commission ?? "0",
    agentCollects: computed.agentCollects ?? false,
    status: row.status,
    version: row.version,
  };
}
