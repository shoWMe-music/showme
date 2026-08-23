import {
  type DealStructure,
  type SettlementBudgetLine,
  type SettlementDeal,
  type SettlementInput,
  type SettlementParticipant,
  type SettlementResult,
  assertBalanced,
  reconcile,
} from "@showme/settlement";

/**
 * The reference concluded event's money — ONE definition, used both to INSERT the
 * budget/deal rows and to DERIVE the settlement snapshot stored beside them.
 *
 * Audit A-13 is what two definitions cost. The seeds hand-wrote the figures, and
 * the hand arithmetic took 70% of **gross revenue** where the engine takes 70% of
 * the **pool** (revenue − external costs) — so the platform's own reference
 * settlement was 6 300.00 SEK away from what the engine would pay, and every screen
 * built against it was reading a lie. Numbers a human types beside data they
 * describe drift from the code that computes them; numbers the engine produces
 * cannot.
 *
 * So nothing here states a result. It states the *terms and the cash*, and calls
 * `reconcile()` — the same function `POST /events/:id/settlement/compute` calls —
 * to say what they come to. Change a budget line and the snapshot follows.
 */

/** Every amount below is minor units (öre) of this currency. */
export const REFERENCE_EVENT_CURRENCY = "SEK";

/**
 * The signed guarantee-vs-door terms of the concluded event. `splitBasisPoints` is a
 * share of the POOL, not of gross revenue — `deals.split_basis_points` means the same
 * thing everywhere, and the engine's `dealEntitlement` reads it that way.
 */
export const REFERENCE_GUARANTEE_VS_DOOR_TERMS = {
  structure: "guarantee_vs_door",
  guaranteeAmount: 1_800_000n, // 18 000.00 SEK floor
  splitBasisPoints: 7_000, // 70.00% of the pool
} as const;

/**
 * The shared door split of the upcoming album release — two performers on ONE deal.
 *
 * **The distinction this constant exists to hold on to:** `deals.split_basis_points`
 * SIZES the deal (what the payees take out of the pool, together), while each
 * `deal_parties.share.splitBasisPoints` only DIVIDES that between them. They are not
 * the same number and one cannot stand in for the other. The seeded fixture stated
 * only the party weights and left the deal-level column NULL, so `dealEntitlement`
 * computed `applyBasisPoints(pool, 0)` — the deal took nothing out of the pool, both
 * performers settled at zero, and the venue kept the lot. That is the residue A-01
 * flagged and A-13 owns: *"the seeded 'Door Split' deal has split_basis_points = NULL,
 * so it takes 0% of the pool and pays nobody"*.
 *
 * The split members take the WHOLE pool between them (10000 bp) and divide it 60/40 —
 * which is the signed snapshot A-01 records: on a 50 000.00 pool, Marlo Vance
 * 30 000.00 and Neon Tide 20 000.00, the two per-party amounts below.
 */
export const REFERENCE_DOOR_SPLIT_TERMS = {
  structure: "door_split",
  /** 100.00% — the deal-level column the ENGINE reads to size the entitlement. */
  splitBasisPoints: 10_000,
} as const;

/**
 * How the two split members divide that entitlement between themselves — weights, not
 * sizes (see above). `guaranteeAmount` is the signed per-line figure at the reference
 * 50 000.00 pool; note that the engine does **not** read a share's `guaranteeAmount`
 * as a floor — per-party guarantee floors are not implemented, and stating one here
 * does not create one.
 */
export const REFERENCE_DOOR_SPLIT_SHARES = {
  headlinerBasisPoints: 6_000, // Marlo Vance — 60.00%
  supportBasisPoints: 4_000, // Neon Tide — 40.00%
  headlinerAmount: 3_000_000n, // 30 000.00 SEK at the reference pool
  supportAmount: 2_000_000n, // 20 000.00 SEK at the reference pool
} as const;

/** The reference pool the door split's signed per-line amounts are quoted at. */
export const REFERENCE_DOOR_SPLIT_POOL = 5_000_000n; // 50 000.00 SEK

/**
 * The dev seed's flat guarantee on the upcoming album release — one payee, no split.
 * A guarantee is sized by `deals.guarantee_amount`, so that column is the one that
 * must not be null here.
 */
export const REFERENCE_GUARANTEE_TERMS = {
  structure: "guarantee",
  guaranteeAmount: 2_500_000n, // 25 000.00 SEK
} as const;

/**
 * Every deal the seeds insert, reduced to the DEAL-LEVEL terms `dealEntitlement`
 * reads. A deal missing from this list, or listed with nothing in it, is inert: it
 * pays its payees nothing however their `share` jsonb divides it. The guard test
 * walks this list and refuses a deal that sizes to zero out of a real pool.
 */
export const REFERENCE_DEALS = [
  { label: "Spring Warm-up — guarantee vs door", terms: REFERENCE_GUARANTEE_VS_DOOR_TERMS },
  { label: "Album Release — door split", terms: REFERENCE_DOOR_SPLIT_TERMS },
  { label: "Album Release — flat guarantee (dev seed)", terms: REFERENCE_GUARANTEE_TERMS },
] as const;

/** The ids a seed brings — each seed names its own rows; the economics are shared. */
export interface ReferenceEventSpine {
  /** The operator's `event_participants` row: collects the door, fronts the costs. */
  hostParticipantId: string;
  /** The performer's `event_participants` row: the deal's payee. */
  performerParticipantId: string;
  /** The guarantee-vs-door deal the door revenue belongs to. */
  dealId: string;
}

/** A budget line as the seeds insert it, minus the ids only the seed knows. */
export interface ReferenceBudgetLine {
  kind: "revenue" | "cost";
  label: string;
  amount: bigint;
  currency: string;
  collectedBy?: string;
  paidBy?: string;
  payeeParticipantId?: string;
  dealId?: string;
}

/**
 * The three external-cash lines of the reference event.
 *
 * Note which cost is which: "Sound & production" has no `payeeParticipantId`, so it
 * is an EXTERNAL cost and lowers the pool. "Artist hotel" names the performer, so it
 * is a DEDUCTIBLE — it leaves the pool alone and comes off that performer's
 * entitlement instead. Getting those two backwards is the whole of A-13.
 */
export function referenceBudgetLines(spine: ReferenceEventSpine): ReferenceBudgetLine[] {
  return [
    {
      kind: "revenue",
      label: "Ticket sales (312 @ 250 SEK)",
      amount: 7_800_000n, // 78 000.00 SEK door, collected by the operator
      currency: REFERENCE_EVENT_CURRENCY,
      collectedBy: spine.hostParticipantId,
      dealId: spine.dealId,
    },
    {
      kind: "cost",
      label: "Sound & production",
      amount: 900_000n, // 9 000.00 SEK to an external supplier, fronted by the operator
      currency: REFERENCE_EVENT_CURRENCY,
      paidBy: spine.hostParticipantId,
    },
    {
      kind: "cost",
      label: "Artist hotel",
      amount: 180_000n, // 1 800.00 SEK incurred FOR the performer — a deductible
      currency: REFERENCE_EVENT_CURRENCY,
      paidBy: spine.hostParticipantId,
      payeeParticipantId: spine.performerParticipantId,
    },
  ];
}

/** The reference event as the settlement engine sees it — the same view the API builds. */
export function referenceSettlementInput(spine: ReferenceEventSpine): SettlementInput {
  const participants: SettlementParticipant[] = [
    { participantId: spine.hostParticipantId, isOperator: true },
    { participantId: spine.performerParticipantId },
  ];

  const deal: SettlementDeal = {
    dealId: spine.dealId,
    structure: REFERENCE_GUARANTEE_VS_DOOR_TERMS.structure,
    payeeParticipantIds: [spine.performerParticipantId],
    guaranteeAmount: REFERENCE_GUARANTEE_VS_DOOR_TERMS.guaranteeAmount,
    splitBasisPoints: REFERENCE_GUARANTEE_VS_DOOR_TERMS.splitBasisPoints,
  };

  const budgetLines: SettlementBudgetLine[] = referenceBudgetLines(spine).map((line) => ({
    kind: line.kind,
    amount: line.amount,
    collectedBy: line.collectedBy,
    paidBy: line.paidBy,
    payeeParticipantId: line.payeeParticipantId,
  }));

  return {
    baseCurrency: REFERENCE_EVENT_CURRENCY,
    participants,
    deals: [deal],
    budgetLines,
  };
}

/**
 * Reconcile the reference event. What it comes to, in SEK:
 *
 *   pool        = 78 000 revenue − 9 000 external cost            = 69 000
 *   performer   = max(18 000 guarantee, 70% × 69 000 = 48 300)    = 48 300
 *                 less the 1 800 hotel deductible                 = 46 500
 *   operator    = residual 69 000 − 48 300 = 20 700
 *   held        = operator 78 000 − 10 800 = 67 200 · performer 0
 *   net         = operator 20 700 − 67 200 = −46 500 · performer +46 500   (Σ = 0)
 *   transfer    = operator → performer 46 500
 *
 * Those numbers are here to be read, not to be trusted — `reconcile()` produces the
 * ones that are stored, and `assertBalanced` refuses to hand back books that do not
 * balance.
 */
export function referenceSettlement(spine: ReferenceEventSpine): SettlementResult {
  const result = reconcile(referenceSettlementInput(spine));
  assertBalanced(result);
  return result;
}

/** One party's line out of a reconciliation. Throws if the party is not in it. */
export function breakdownFor(
  result: SettlementResult,
  participantId: string,
): SettlementResult["breakdowns"][number] {
  const breakdown = result.breakdowns.find((row) => row.participantId === participantId);
  if (!breakdown) {
    throw new Error(`No settlement breakdown for participant ${participantId}`);
  }
  return breakdown;
}

/**
 * One reference deal's terms as the ENGINE sees them, with a stand-in payee — the
 * shape `dealEntitlement` is handed when `POST /settlement/compute` maps the DB rows.
 * Used by the guard test to ask each seeded deal the only question that matters
 * before anyone's `share` weights get involved: out of a real pool, does this deal
 * size to anything at all?
 */
export function dealTermsAsTheEngineSeesThem(terms: {
  structure: DealStructure;
  guaranteeAmount?: bigint;
  splitBasisPoints?: number;
}): SettlementDeal {
  return {
    dealId: "reference-deal",
    structure: terms.structure,
    payeeParticipantIds: ["reference-payee"],
    guaranteeAmount: terms.guaranteeAmount,
    splitBasisPoints: terms.splitBasisPoints,
  };
}
