/**
 * Settlement engine inputs and outputs — plain TS, framework-agnostic. Every
 * amount is `bigint` **minor units in the event's `baseCurrency`** (money.md:
 * the `Σ net = 0` invariant runs in base-currency minor units). The API maps DB
 * rows onto these and converts non-base budget lines with the locked FX rate
 * BEFORE calling; percentages are basis points (4000 = 40.00%).
 */

/** The settlement math a deal uses (matches the DB `deal_structure` enum). */
export type DealStructure = "guarantee" | "door_split" | "guarantee_vs_door" | "rental";

/** A tiered escalator: at/above `thresholdSold` tickets, the split becomes `splitBasisPoints`. */
export interface EscalatorTier {
  thresholdSold: number;
  splitBasisPoints: number;
}

/** A disclosed, off-the-top commission — deducted from the payee, credited to `participantId`. */
export interface DisclosedCommission {
  participantId: string;
  basisPoints: number;
}

/** A participant in the reconciliation. Operators split the residual (pool − Σ entitlements). */
export interface SettlementParticipant {
  participantId: string;
  isOperator?: boolean;
  /** Integer weight for splitting the residual across co-operators (default: equal). */
  operatorResidualShare?: number;
}

/** A deal reduced to what the engine needs: its structure, amounts, and entitled parties. */
export interface SettlementDeal {
  dealId: string;
  structure: DealStructure | null; // null = paper-only, no computed entitlement
  payeeParticipantIds: string[];
  guaranteeAmount?: bigint;
  splitBasisPoints?: number; // of the pool
  bonusThreshold?: bigint; // bonus applies when the pool reaches this
  bonusAmount?: bigint;
  escalators?: EscalatorTier[];
  /** Basis points per payee for a split deal (keys are participantIds, values sum to 10000). */
  partyShares?: Record<string, number>;
  commissions?: DisclosedCommission[];
}

/** An external-cash budget line. `payeeParticipantId` set = a deductible on that party. */
export interface SettlementBudgetLine {
  kind: "revenue" | "cost";
  amount: bigint;
  collectedBy?: string; // participantId who received the revenue
  paidBy?: string; // participantId who fronted the cost
  payeeParticipantId?: string; // cost on behalf of this party; undefined = external supplier
}

/** Everything the engine needs to reconcile one event. */
export interface SettlementInput {
  baseCurrency: string;
  ticketsSold?: number; // drives escalator tiers
  participants: SettlementParticipant[];
  deals: SettlementDeal[];
  budgetLines: SettlementBudgetLine[];
}

/** One party's line in the settlement: entitlement vs cash held → net position (minor units). */
export interface PartyBreakdown {
  participantId: string;
  entitlement: bigint;
  collected: bigint;
  paid: bigint;
  held: bigint; // collected − paid
  net: bigint; // entitlement − held (+ owed to them, − holding too much)
}

/** A single money movement, greedily matched to minimize the transfer count. */
export interface Transfer {
  fromParticipantId: string;
  toParticipantId: string;
  amount: bigint;
}

/** The reconciliation result. `Σ breakdowns[].net === 0n` exactly (conservation law). */
export interface SettlementResult {
  baseCurrency: string;
  pool: bigint;
  breakdowns: PartyBreakdown[];
  transfers: Transfer[];
}
