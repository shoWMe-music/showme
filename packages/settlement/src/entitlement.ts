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

/** Split-of-pool with escalator tier selection and threshold bonus. */
function doorAmount(deal: SettlementDeal, pool: bigint, ticketsSold: number): bigint {
  const basisPoints = splitBasisPointsForSales(deal, ticketsSold);
  let amount = applyBasisPoints(pool, basisPoints);
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
