import { applyBasisPoints } from "@showme/shared";
import type { SettlementDeal } from "./types";

/**
 * The per-deal entitlement math — ported from the reference app's
 * `calculateSettlement`, re-expressed in `bigint` minor units (money.md). This
 * is the total the deal pays its payee(s); allocation across multiple payees and
 * commissions happens in the orchestration.
 */
export function dealEntitlement(deal: SettlementDeal, pool: bigint, ticketsSold: number): bigint {
  switch (deal.structure) {
    case "guarantee":
    case "rental":
      return deal.guaranteeAmount ?? 0n;
    case "door_split":
      return doorAmount(deal, pool, ticketsSold);
    case "guarantee_vs_door": {
      // The performer takes whichever is larger — the classic vs-door protection.
      const guarantee = deal.guaranteeAmount ?? 0n;
      const door = doorAmount(deal, pool, ticketsSold);
      return guarantee > door ? guarantee : door;
    }
    default:
      return 0n; // null / paper-only agreement — no computed entitlement
  }
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
function doorAmount(deal: SettlementDeal, pool: bigint, ticketsSold: number): bigint {
  const basisPoints = splitBasisPointsForSales(deal, ticketsSold);
  const share = applyBasisPoints(pool, basisPoints);
  let amount = share > 0n ? share : 0n;
  if (deal.bonusThreshold != null && pool >= deal.bonusThreshold) {
    amount += deal.bonusAmount ?? 0n;
  }
  return amount;
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
