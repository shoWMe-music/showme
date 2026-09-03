/**
 * Settlement engine inputs and outputs — plain TS, framework-agnostic. Every
 * amount is `bigint` **minor units in the event's `baseCurrency`** (money.md:
 * the `Σ net = 0` invariant runs in base-currency minor units). The API maps DB
 * rows onto these and converts non-base budget lines with the locked FX rate
 * BEFORE calling; percentages are basis points (4000 = 40.00%).
 */

/** The settlement math a deal uses (matches the DB `deal_structure` enum). */
export type DealStructure = "guarantee" | "door_split" | "guarantee_vs_door" | "rental";

/** `deals.payment_timing` — WHEN the deal's money moves, relative to the night. */
export type PaymentTiming = "before_event" | "at_settlement" | "due_date";

/** A tiered escalator: at/above `thresholdSold` tickets, the split becomes `splitBasisPoints`. */
export interface EscalatorTier {
  thresholdSold: number;
  splitBasisPoints: number;
}

/**
 * A DISCLOSED commission — deducted from the payee's own line, credited to
 * `participantId`. Populated from a `deal_parties` row with
 * `role_in_deal = 'commission'`; the arithmetic (and the parallel-vs-cascading
 * question) lives in `commissions.ts`. A booking **agent**'s private
 * representation commission is never one of these — see `representation.ts`.
 */
/**
 * Which stacking rule a deal's disclosed commissions follow — `parallel` (each
 * cut off the same base) or `cascading` (each cut off what the previous left).
 * Mirrors the `commission_mode` DB enum; see `commissions.ts` for the worked
 * example and why `parallel` is the default.
 */
export type CommissionMode = "parallel" | "cascading";

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
  /**
   * How several disclosed commissions on this deal compose (ClickUp `86cba8wmb`).
   * Omitted = `parallel`, which is what the engine did before the choice existed.
   */
  commissionMode?: CommissionMode;
  /**
   * Money this deal ALREADY MOVED, before the night — a rental paid to hold the
   * room, a guarantee paid to secure the booking. See `prepaid.ts` for how it is
   * read off the terms.
   *
   * It never touches the entitlement: the deal says what a party earned, and an
   * advance is part of that same fee arriving early. It settles as cash held, so
   * only the REMAINING transfer shrinks.
   */
  prepaidAmount?: bigint;
  /**
   * Who paid it. Required whenever `prepaidAmount` is set — an advance has two
   * ends, and booking only the receiving one would put money into the settlement
   * from nowhere and break `Σ net = 0`.
   */
  payerParticipantId?: string;
}

/** An external-cash budget line. `payeeParticipantId` set = a deductible on that party. */
export interface SettlementBudgetLine {
  kind: "revenue" | "cost";
  amount: bigint;
  /**
   * What the line is CALLED — "Green-room catering", "Venue's cut of merch".
   *
   * The engine does no arithmetic with it and never will. It exists so a party
   * whose entitlement came up short can be told WHICH costs did it, instead of
   * being handed one `deductibles` figure and left to ask (ClickUp `86cbcn1ue`:
   * *"A detailed view of all items divided to each collaborator's share"*).
   *
   * Optional, so every existing caller and every stored snapshot is unaffected.
   */
  label?: string;
  collectedBy?: string; // participantId who received the revenue
  paidBy?: string; // participantId who fronted the cost
  payeeParticipantId?: string; // cost on behalf of this party; undefined = external supplier
  /**
   * The cost SPLIT rule — participantId → basis points of this line that party
   * bears. The generalisation of `payeeParticipantId` (which is a split of 100%
   * to one party); anything left unallocated stays a pool cost. See
   * `cost-bearing.ts` for why the two halves must always sum to the line.
   */
  costSplit?: Record<string, number>;
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
  /**
   * Net moved BEFORE the event under a deal: positive for a party that received
   * an advance, negative for the party that paid one out. Kept apart from
   * `collected`/`paid`, which are external cash off the budget — an advance is
   * neither the door takings nor a cost, and folding it into either would make
   * the board say the performer took money off the bar.
   */
  prepaid: bigint;
  /**
   * The parties on the OTHER end of that early money, so the settlement can say
   * "paid in advance by X" rather than printing a figure with no counterparty.
   * Empty whenever `prepaid` is 0. Sorted, so the same night renders the same way
   * twice.
   */
  prepaidCounterpartyIds: string[];
  /**
   * WHICH costs made up `deductibles`, itemised — the answer to "why is my share
   * short". Empty whenever `deductibles` is 0.
   *
   * Each entry is this party's OWN portion of the line, not the line's total: a
   * cost split 60/40 shows each bearer their 60 and their 40. Summing them gives
   * `deductibles` exactly, which is what makes the list checkable rather than
   * decorative.
   */
  deductibleLines: { label: string; amount: bigint }[];
  held: bigint; // collected − paid + prepaid
  net: bigint; // entitlement − held (+ owed to them, − holding too much)
  /**
   * What `entitlement` is MADE OF, and it adds up exactly:
   *   entitlement = Σ lines.amount + commissionEarned + residual − deductibles
   *
   * The four members are the four ways `reconcile()` credits a party, kept apart
   * because they answer different questions. A performer asks which agreement
   * paid them and under which rule (`lines`); an operator asks what was left after
   * everyone else (`residual`); a party whose hotel somebody else fronted asks why
   * their line is short (`deductibles`).
   */
  lines: EntitlementLine[];
  /** Disclosed commissions this party EARNED on other parties' lines. */
  commissionEarned: bigint;
  /** Costs borne on this party's behalf, deducted from what it is owed. */
  deductibles: bigint;
  /** An operator's share of `pool − Σ deal entitlements`. Zero for everyone else. */
  residual: bigint;
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
  /**
   * Gross → adjusted net, the operator's ladder. `ladder.pool === pool`; the
   * scalar stays because every existing caller reads it and because the pool is
   * the number the conservation law is stated against.
   */
  ladder: PoolLadder;
  breakdowns: PartyBreakdown[];
  transfers: Transfer[];
}

/**
 * HOW a party's entitlement was arrived at — the RULE behind the number.
 *
 * A settlement that shows only figures looks arbitrary, and the parties reading
 * it cannot check it against the contract they signed. Every branch below is one
 * arm of `dealEntitlement()`, carrying the operands the branch actually compared
 * so the reader can redo the comparison: which of a guarantee and a door share
 * won, what percentage was applied, and to which pool.
 *
 * It is STRUCTURED, not a sentence. The engine decides which rule fired; how that
 * reads in a given language and currency is the UI's job, and a string baked here
 * would be a second money formatter living in a framework-agnostic module.
 */
export type EntitlementBasis =
  /** A fixed amount, whatever the night did. */
  | { kind: "guarantee"; guarantee: bigint }
  /** A fixed amount for the room — settled OFF THE TOP (`deal-order.ts`). */
  | { kind: "rental"; rental: bigint }
  /** A share of the pool the percentage deals divide. */
  | { kind: "door_split"; basisPoints: number; pool: bigint }
  /** Whichever of the two was larger, and which one won. */
  | {
      kind: "guarantee_vs_door";
      won: "guarantee" | "door";
      guarantee: bigint;
      door: bigint;
      basisPoints: number;
      pool: bigint;
    }
  /** A paper-only agreement: signed, recorded, never computed. */
  | { kind: "paper" };

/**
 * One deal's contribution to one party's entitlement.
 *
 * `dealTotal` is what the whole agreement pays; `amount` is this party's portion
 * of it after `allocate()` split it across the deal's payees. On a single-payee
 * deal they are equal — keeping both is what lets a performer on a 60/40 shared
 * split see that the deal paid 10 000 and that 6 000 of it is theirs, which is
 * the one thing a split line has to say.
 */
export interface EntitlementLine {
  dealId: string;
  dealTotal: bigint;
  amount: bigint;
  basis: EntitlementBasis;
  /** The threshold bonus, already included in `dealTotal` and `amount`. */
  bonus?: bigint;
  /** Set when ticket sales reached a tier that replaced the deal's base split. */
  escalatorApplied?: boolean;
  /** Disclosed commissions charged against this party's own portion. */
  commissionCharged?: bigint;
}

/**
 * The ladder from gross money to the pool the percentage deals actually divide —
 * the operator's view of the night, and the number every percentage below it is
 * taken from.
 *
 * `splitPool` is what the industry calls **adjusted net** and what the reference
 * app called `adjustedNet` (`../showme-settle-fast/src/lib/models.ts:368`). It is
 * derived inside `reconcile()` either way; returning it is what stops a settlement
 * reading as an arbitrary set of figures, because a 20% line that does not name
 * the number it is 20% OF cannot be checked by the party being paid it.
 *
 * `costs` is only the share of the cost lines that nobody was charged for.
 * Costs borne by a named party never touch the pool — they come off that party's
 * own entitlement as a deductible (`cost-bearing.ts`), and show on its line.
 */
export interface PoolLadder {
  revenue: bigint;
  costs: bigint;
  /** `revenue − costs`. */
  pool: bigint;
  /** Σ of the off-the-top deals (rentals), settled before the rest divide. */
  offTheTop: bigint;
  /** `pool − offTheTop` — the adjusted net every percentage deal is a share of. */
  splitPool: bigint;
}
