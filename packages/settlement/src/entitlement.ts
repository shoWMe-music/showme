import { applyBasisPoints } from "@showme/shared";
import type { EntitlementBasis, SettlementDeal } from "./types";

/**
 * What one deal pays, AND the rule it paid under.
 *
 * The rule used to be thrown away the moment the number was produced, so a
 * settlement could say a performer was owed 50 750 and nothing on the screen
 * could say why — which of the guarantee and the door share had won, or what the
 * percentage was a percentage of. The parties reading a settlement are checking
 * it against a contract, and a figure with no rule attached cannot be checked.
 */
export interface DealEntitlement {
  /** The whole deal's payout, bonus included. */
  amount: bigint;
  basis: EntitlementBasis;
  /** The threshold bonus, already included in `amount`. */
  bonus: bigint;
  /** True when ticket sales reached a tier that replaced the deal's base split. */
  escalatorApplied: boolean;
}

/**
 * The per-deal entitlement math — ported from the reference app's
 * `calculateSettlement`, re-expressed in `bigint` minor units (money.md). This
 * is the total the deal pays its payee(s); allocation across multiple payees and
 * commissions happens in the orchestration.
 */
export function dealEntitlement(deal: SettlementDeal, pool: bigint, ticketsSold: number): bigint {
  return dealEntitlementDetailed(deal, pool, ticketsSold).amount;
}

/** The same math, keeping the rule it settled under. */
export function dealEntitlementDetailed(
  deal: SettlementDeal,
  pool: bigint,
  ticketsSold: number,
): DealEntitlement {
  switch (deal.structure) {
    case "guarantee": {
      const guarantee = deal.guaranteeAmount ?? 0n;
      return {
        amount: guarantee,
        basis: { kind: "guarantee", guarantee },
        bonus: 0n,
        escalatorApplied: false,
      };
    }
    case "rental": {
      const rental = deal.guaranteeAmount ?? 0n;
      return {
        amount: rental,
        basis: { kind: "rental", rental },
        bonus: 0n,
        escalatorApplied: false,
      };
    }
    case "door_split": {
      const door = doorDetail(deal, pool, ticketsSold);
      return {
        amount: door.amount,
        basis: { kind: "door_split", basisPoints: door.basisPoints, pool },
        bonus: door.bonus,
        escalatorApplied: door.escalatorApplied,
      };
    }
    case "guarantee_vs_door": {
      // The performer takes whichever is larger — the classic vs-door protection.
      const guarantee = deal.guaranteeAmount ?? 0n;
      const door = doorDetail(deal, pool, ticketsSold);
      const guaranteeWins = guarantee > door.amount;
      return {
        amount: guaranteeWins ? guarantee : door.amount,
        basis: {
          kind: "guarantee_vs_door",
          won: guaranteeWins ? "guarantee" : "door",
          guarantee,
          door: door.amount,
          basisPoints: door.basisPoints,
          pool,
        },
        // A guarantee that beat the door share pays the guarantee and nothing else;
        // the bonus is part of what the door arm offered and loses with it.
        bonus: guaranteeWins ? 0n : door.bonus,
        escalatorApplied: guaranteeWins ? false : door.escalatorApplied,
      };
    }
    default:
      // null / paper-only agreement — no computed entitlement
      return { amount: 0n, basis: { kind: "paper" }, bonus: 0n, escalatorApplied: false };
  }
}

interface DoorDetail {
  /** The floored share of the pool, plus the bonus if it was earned. */
  amount: bigint;
  basisPoints: number;
  bonus: bigint;
  escalatorApplied: boolean;
}

/**
 * Split-of-pool with escalator tier selection and threshold bonus.
 *
 * **A share of the pool is floored at zero** (product owner, 2026-08-26: *"Should
 * not be negative no"*). A percentage deal is a share of an upside, not a share of
 * a liability: on a pool of −3 000 a 50% door split used to hand the performer an
 * entitlement of −1 500, i.e. the performer *owes* the operator for having played
 * (the reference app does the same — `../showme-settle-fast`
 * `src/lib/models.ts:437`, reproduced as case 5 of `docs/old-app-analysis-settlement.md`).
 * The loss stays with the operator, which needs no special case: the operator's
 * entitlement is the residual `pool − Σ others`, so whatever the floor spares the
 * performer lands there and `Σ net = 0` still holds exactly.
 *
 * **Scope, precisely.** This floors the *percentage-of-pool* component only.
 * A `guarantee` is untouched (it never was negative), `guarantee_vs_door` is
 * unaffected in substance (a non-negative guarantee already won every comparison a
 * negative door could enter), and — most importantly — a party's NET may still go
 * negative afterwards. Deductibles are applied in `reconcile()` AFTER this: a
 * performer whose hotel the venue fronted, or who was advanced more than the night
 * earned, genuinely owes that money back and is not floored.
 */
function doorDetail(deal: SettlementDeal, pool: bigint, ticketsSold: number): DoorDetail {
  const basisPoints = splitBasisPointsForSales(deal, ticketsSold);
  const share = applyBasisPoints(pool, basisPoints);
  let amount = share > 0n ? share : 0n;
  let bonus = 0n;
  if (deal.bonusThreshold != null && pool >= deal.bonusThreshold) {
    bonus = deal.bonusAmount ?? 0n;
    amount += bonus;
  }
  return {
    amount,
    basisPoints,
    bonus,
    escalatorApplied: basisPoints !== (deal.splitBasisPoints ?? 0),
  };
}

/** The effective split (basis points) given ticket sales — the highest tier reached, else the base. */
export function splitBasisPointsForSales(deal: SettlementDeal, ticketsSold: number): number {
  let basisPoints = deal.splitBasisPoints ?? 0;
  if (!deal.escalators?.length) {
    return basisPoints;
  }
  for (const tier of [...deal.escalators].sort((a, b) => a.thresholdSold - b.thresholdSold)) {
    if (ticketsSold >= tier.thresholdSold) {
      basisPoints = tier.splitBasisPoints;
    }
  }
  return basisPoints;
}
