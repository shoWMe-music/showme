import type { schema } from "@showme/db";
import type { SettlementResult } from "@showme/settlement";

type SettlementRow = typeof schema.settlements.$inferSelect;
type TransferRow = typeof schema.settlementTransfers.$inferSelect;

/**
 * One party's line, money as STRING (money.md: minor units past 2^53 are unsafe
 * as a JS number, so money never crosses the JSON boundary as a number). This is
 * exactly the shape persisted into `settlements.computed` (jsonb).
 */
export interface SerializedBreakdown {
  participantId: string;
  entitlement: string;
  collected: string;
  paid: string;
  held: string;
  net: string;
}

/** The compute summary: the pool plus every party's breakdown and the transfers. */
export interface SerializedSummary {
  baseCurrency: string;
  pool: string;
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

/** Turn one engine breakdown into its JSON-safe (string money) form. */
export function serializeBreakdown(
  breakdown: SettlementResult["breakdowns"][number],
): SerializedBreakdown {
  return {
    participantId: breakdown.participantId,
    entitlement: breakdown.entitlement.toString(),
    collected: breakdown.collected.toString(),
    paid: breakdown.paid.toString(),
    held: breakdown.held.toString(),
    net: breakdown.net.toString(),
  };
}

/** The full compute result as strings — the POST /compute response body. */
export function serializeSummary(result: SettlementResult): SerializedSummary {
  return {
    baseCurrency: result.baseCurrency,
    pool: result.pool.toString(),
    breakdowns: result.breakdowns.map(serializeBreakdown),
    transfers: result.transfers.map((transfer) => ({
      fromParticipantId: transfer.fromParticipantId,
      toParticipantId: transfer.toParticipantId,
      amount: transfer.amount.toString(),
    })),
  };
}

/** A stored settlement row — `computed` is already string money (jsonb). */
export function serializeSettlement(row: SettlementRow): SerializedSettlement {
  return {
    id: row.id,
    participantId: row.participantId,
    status: row.status,
    computed: (row.computed as SerializedBreakdown | null) ?? null,
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
