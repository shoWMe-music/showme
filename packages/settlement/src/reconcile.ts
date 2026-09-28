import { allocate } from "@showme/shared";
import { applyCommissions } from "./commissions";
import { costBearingOf } from "./cost-bearing";
import { isOffTheTop } from "./deal-order";
import { type EntitlementBases, dealEntitlementDetailed } from "./entitlement";
import { reachesThePool, revenueSharesOf } from "./revenue-shares";
import { greedyTransfers } from "./transfers";
import type {
  EntitlementLine,
  PartyBreakdown,
  SettlementDeal,
  SettlementInput,
  SettlementResult,
} from "./types";

const sumBigint = (values: bigint[]): bigint =>
  values.reduce((running, value) => running + value, 0n);

/**
 * Reconcile one event into per-participant net positions and minimal transfers.
 *
 * The orchestration (new; the per-deal math is ported), all in `bigint` minor
 * units so nothing rounds:
 *   1. pool        = Σ revenue − Σ external costs
 *   2. adjustedNet = pool − rentals (settled first, off the top)
 *      entitlement = each remaining deal's share of the adjusted net (allocate)
 *                    + commissions, operator = residual (allocate)
 *   3. deductibles = costs on behalf of a party reduce that party's entitlement
 *   4. held        = collected − paid
 *   5. net         = entitlement − held   →   Σ net === 0n exactly, by construction
 *   6. transfers   = greedy debtor→creditor match
 *
 * The event must have at least one operator (the residual has nowhere to go
 * otherwise). `allocate()` guarantees each split's parts sum to the total.
 */
export function reconcile(input: SettlementInput): SettlementResult {
  const { baseCurrency, participants, deals, budgetLines } = input;
  const ticketsSold = input.ticketsSold ?? 0;

  // 1. Pool — revenue less the portion of each cost nobody is charged for.
  //
  //    Every cost line is partitioned by its BEARING RULE (`cost-bearing.ts`) into
  //    the share that lowers the pool and the shares deducted from named parties in
  //    step 3. The two halves always sum to the line, which is what keeps `Σ net = 0`
  //    true whether a cost is shared, deducted from one party, or split between
  //    several (the 2026-08 meeting's "either a cost split or a single payer").
  const revenueLines = budgetLines.filter((line) => line.kind === "revenue");
  /** Gross, for the ladder and for a threshold bonus (#23.3) — every line, whoever took it. */
  const revenue = sumBigint(revenueLines.map((line) => line.amount));
  const operatorParticipantIds = new Set(
    participants.filter((party) => party.isOperator).map((party) => party.participantId),
  );
  const bearings = budgetLines.map((line) => costBearingOf(line));
  const externalCosts = sumBigint(bearings.map((bearing) => bearing.poolShare));
  /**
   * ONLY WHAT THE EVENT ACTUALLY POOLS (#23.1, `revenue-shares.ts`). A line an
   * operator collected, or that names no collector, is the event's and reaches
   * here. A line the venue or the act took is THEIRS — it is credited to them in
   * step 2c instead, and the operator's residual never sees it.
   *
   * Before this the pool swallowed every line whatever `collected_by` said, so a
   * venue running its own bar was credited nothing while holding the cash, and
   * `net = entitlement − held` had it owing the operator its own takings.
   */
  const pooledRevenue = sumBigint(
    revenueLines
      .filter((line) => reachesThePool(line, operatorParticipantIds))
      .map((line) => line.amount),
  );
  const pool = pooledRevenue - externalCosts;

  // 2a. Base entitlements from deals — split each deal across its payees with
  //     allocate() (exact), then apply disclosed commissions.
  const entitlement = new Map<string, bigint>(
    participants.map((party) => [party.participantId, 0n]),
  );
  const credit = (participantId: string, amount: bigint) => {
    entitlement.set(participantId, (entitlement.get(participantId) ?? 0n) + amount);
  };

  // The same credits, kept apart by WHY they were made, so a party's line can say
  // what it is made of instead of arriving as one unexplained figure. None of this
  // participates in the arithmetic — `entitlement` above is still the only total.
  const lines = new Map<string, EntitlementLine[]>(
    participants.map((party) => [party.participantId, []]),
  );
  const commissionEarned = new Map<string, bigint>();
  const deductibles = new Map<string, bigint>();
  /**
   * The same deductions, itemised per party — the total above answers "how much",
   * this answers "which". Built in the same loop so the two can never disagree.
   */
  const deductibleLines = new Map<string, { label: string; amount: bigint }[]>();
  const residualOf = new Map<string, bigint>();
  const addTo = (map: Map<string, bigint>, participantId: string, amount: bigint) => {
    map.set(participantId, (map.get(participantId) ?? 0n) + amount);
  };

  /**
   * Settle one deal against the bases it is measured on; returns what it claims.
   *
   * The bases are an ARGUMENT and not a closure because the two passes below do
   * not share them: a rental is settled before the split base exists, and the
   * split base is what is left once the rentals have taken theirs.
   */
  const settleDeal = (
    deal: SettlementDeal,
    bases: EntitlementBases,
    /**
     * A party to CHARGE the whole of this deal to, instead of the pool (decisions §25.7.1).
     *
     * Only the rental pass passes it, and only when the deal names a payer. Booked here, in the
     * one place that already knows the deal's total and its basis, for the same reason the
     * prepayment loop books both ends in one place: a single-ended entry conjures money into the
     * settlement and `assertBalanced` then fails somewhere far from the cause.
     */
    chargeTo?: string,
  ): bigint => {
    if (deal.payeeParticipantIds.length === 0) return 0n;
    const settled = dealEntitlementDetailed(deal, bases, ticketsSold);
    const total = settled.amount;
    /*
     * The basis EVERY line of this deal carries. For a rental settled between its parties it gains
     * `borneByPayer`, which is the flag the settlement card reads to choose between "settled off
     * the top" and "settled between its parties" — one sentence used to be printed for both, and
     * on the payer's card it appeared beside a negative figure (decisions §25.7.1).
     *
     * Stamped here rather than in `dealEntitlementDetailed` because only this function knows the
     * answer: the rule is about who shares the event's residual, which the entitlement calculator
     * cannot see.
     */
    const basis =
      chargeTo !== undefined && settled.basis.kind === "rental"
        ? { ...settled.basis, borneByPayer: true }
        : settled.basis;
    const weights = deal.payeeParticipantIds.map((payee) => {
      const share = deal.partyShares?.[payee];
      return share != null ? BigInt(share) : 1n;
    });
    const portions = allocate(total, weights);
    // What each payee's weight IS, as a percentage of the deal — the number the
    // screen needs to say "your 60% of the deal's 50 000" instead of repeating the
    // deal's own rule under every party. Computed from the same weights `allocate`
    // divided by, so it can never describe a different split from the one that paid.
    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0n);
    const shared = deal.payeeParticipantIds.length > 1 && weightTotal > 0n;
    deal.payeeParticipantIds.forEach((payee, index) => {
      // Commissions are charged per ENTITLED LINE (`commissions.ts`), so each
      // payee on a split deal carries only the commission on its own portion.
      const { payeeAmount, charges } = applyCommissions(
        portions[index] ?? 0n,
        deal.commissions,
        deal.commissionMode,
      );
      credit(payee, payeeAmount);
      const charged = (portions[index] ?? 0n) - payeeAmount;
      lines.get(payee)?.push({
        dealId: deal.dealId,
        dealTotal: total,
        amount: payeeAmount,
        basis,
        ...(settled.bonus > 0n ? { bonus: settled.bonus } : {}),
        ...(settled.escalatorApplied ? { escalatorApplied: true } : {}),
        ...(charged > 0n ? { commissionCharged: charged } : {}),
        ...(shared
          ? {
              partyBasisPoints: Number(
                ((weights[index] ?? 0n) * 10000n + weightTotal / 2n) / weightTotal,
              ),
            }
          : {}),
      });
      for (const charge of charges) {
        // A commission credited to somebody who is not a participant on this event
        // would leave the books short by exactly that amount — visible only as an
        // opaque "does not balance" throw two steps later. Name it here instead.
        if (!entitlement.has(charge.participantId)) {
          throw new Error(
            `Deal ${deal.dealId} pays a commission to ${charge.participantId}, who is not a participant on this event.`,
          );
        }
        credit(charge.participantId, charge.amount);
        addTo(commissionEarned, charge.participantId, charge.amount);
      }
    });
    if (chargeTo !== undefined) {
      if (!entitlement.has(chargeTo)) {
        throw new Error(
          `Deal ${deal.dealId} is charged to ${chargeTo}, who is not a participant on this event.`,
        );
      }
      credit(chargeTo, -total);
      // The payer's own line, so their card can say what took the money rather than showing a
      // figure that is smaller for no stated reason. Negative `amount`, same `basis` as the
      // payee's line — it is one agreement seen from its two ends.
      lines.get(chargeTo)?.push({
        dealId: deal.dealId,
        dealTotal: total,
        amount: -total,
        basis,
      });
    }
    return total;
  };

  /**
   * RENTALS FIRST, AND THEY MOVE MONEY AGAIN (2026-09-15, reversing #23.1).
   *
   * A rental is the cost of the room, settled before anything divides, and the
   * percentage deals divide what is left — the design's waterfall
   * (`docs/design-settlement-2026-09-10.md` §3, chosen by the owner on
   * 2026-09-15 over the rule that replaced it two days earlier). On a 10 000 net
   * with a 2 000 rental, a 50% split is half of 8 000, not half of 10 000.
   *
   * Between 2026-09-13 and 2026-09-15 this pass deliberately changed nothing: a
   * split was a share of gross ticket revenue, which no rental was subtracted
   * from, so ordering had no arithmetic left to express. The ordering machinery
   * (`deal-order.ts`) was kept standing through that period, which is why turning
   * this back on is four lines rather than a rewrite.
   *
   * A rental is settled against `grossRevenue` alone — its amount is fixed, so it
   * needs no split base, and asking for one would be circular.
   */
  const rentalBases: EntitlementBases = { splitBase: 0n, grossRevenue: revenue };
  let offTheTop = 0n;
  for (const deal of deals) {
    if (!isOffTheTop(deal)) continue;
    /**
     * WHO ACTUALLY PAYS THE ROOM — decisions §25.7.1 (Daniel, 2026-09-28).
     *
     * **The pool pays a rental only when the pool is what owes it and the money leaves the pool
     * side.** In data: no payer named, or a payer who shares the event's residual paying somebody
     * who does not. Every other rental with a named payer is a transfer between its two parties.
     *
     * This pass used to read a rental's amount and its payee and never `role_in_deal`, so every
     * rental came off the pool and was divided by everyone sharing the adjusted net. Hand-checked
     * on a SEK 120,000 night with SEK 15,000 of costs, a 70/30 act deal and a SEK 5,000 room hire
     * the co-promoter owes the host, computed twice: **the act −3,500, the host +4,250 (the payee),
     * the co-promoter −750.** The act bore 70% of a room hire it never signed, and the party the
     * deal names as payer bore 15% of it. `reconcile.test.ts` runs that check both ways.
     *
     * The grounds, in one line: a party cannot be charged for an agreement it is not a party to.
     *
     * WHY THE TEST IS BOTH ENDS AND NOT JUST THE PAYER, which cost one failing test to find and
     * one surviving mutation to get right.
     *
     * "The deal names a payer" alone would have been simpler, and it would have REVERSED #24.1 in
     * #24.1's own case. `settlement.test.ts`'s rental fixture names the host — the pool operator —
     * as the payer of a venue rental, which is precisely *the promoter rents from the venue*, the
     * case #24.1 settled and is explicit that the act shares. Every rental authored through the app
     * names a payer, so the simple rule would have made #24.1's behaviour unreachable rather than
     * narrower, and it would have done it silently: the only thing standing in the way was one
     * assertion whose stated reason ("the rental, taken first") was a claim about the code.
     *
     * §25.6 framed the open question as *a rental between two co-operators* and said in as many
     * words that #24.1 governs the other case. So the line is drawn at what #24.1 is actually
     * about: the SHOW paying for its room. That is the pool (an operator) paying somebody outside
     * the pool, and it is the only shape where calling the rental a cost of the night — a thing
     * everyone dividing the night shares — is true.
     *
     * "Both ends are co-operators" was the first attempt and a mutation showed it was too narrow:
     * deleting the payer-is-an-operator half changed nothing, because no test covered an ACT
     * renting the room from the operator. Under that rule the act's own room hire came off the
     * pool, so the act shared its own rental with everybody and the operator was credited twice —
     * the same defect as the co-operator case, wearing different clothes. The rule is stated from
     * the pool's side now, which covers every arrangement rather than the two that were asked about.
     *
     * The pool is untouched either way — what a transfer rental does NOT do is shrink the adjusted
     * net, which is exactly how the act stops paying for it.
     */
    /*
     * A NAMED PAYER WHO IS NOT ON THE EVENT is refused, by `settleDeal`'s own check rather than a
     * second one here. There WAS a second one here and a surviving mutation showed it was dead: an
     * unrecognised payer is not in `operatorParticipantIds` either, so it can never satisfy the
     * clause below and always reaches the transfer branch, where `settleDeal` throws naming the
     * deal and the stranger. Two guards for one case is one guard nothing can fail on.
     */
    // The show paying for its room: the party that owes it shares the residual, and nobody being
    // paid does. That is #24.1's case, and the only one where the pool is what is paying.
    const theShowPaysForItsRoom =
      deal.payerParticipantId === undefined ||
      (operatorParticipantIds.has(deal.payerParticipantId) &&
        !deal.payeeParticipantIds.some((payee) => operatorParticipantIds.has(payee)));
    if (theShowPaysForItsRoom) {
      offTheTop += settleDeal(deal, rentalBases);
      continue;
    }
    // Otherwise the deal names somebody who owes it and the money does not leave the pool side:
    // it moves between the two parties and the adjusted net never sees it.
    settleDeal(deal, rentalBases, deal.payerParticipantId);
  }

  /**
   * THE ADJUSTED NET — the bottom of the waterfall, and the base every percentage
   * deal is a percentage of.
   *
   * `pool` is the design's "Net revenue": what the event pooled, less the costs
   * nobody was charged for. Take the rentals off it and what remains is what the
   * splits divide.
   *
   * It is NOT floored at zero. A night that lost money divides a negative
   * adjusted net, and `doorDetail` floors each percentage share at zero on the way
   * out — so the loss stays with the operators through the residual, which is the
   * rule the product owner set on 2026-08-26 and the one thing about a bad night
   * that must not change.
   */
  const adjustedNet = pool - offTheTop;
  const bases: EntitlementBases = { splitBase: adjustedNet, grossRevenue: revenue };
  for (const deal of deals) {
    if (!isOffTheTop(deal)) settleDeal(deal, bases);
  }

  /**
   * 2c. REVENUE ATTRIBUTION — who each line's money belongs to (#23.1/#23.2).
   *
   * Computed here, credited below the residual, because the two have to agree
   * about one thing: a slice taken off a line that REACHED the pool comes out of
   * the operator's share, so the residual must be told about it; a slice off a
   * line the venue collected never touched the pool and must not be.
   *
   * Getting that backwards is what broke `Σ net = 0` the first time this was
   * written — the residual subtracted attributions that had never been in it.
   */
  const attribution = revenueLines.map((line) => ({
    line,
    slices: revenueSharesOf(line),
    pooled: reachesThePool(line, operatorParticipantIds),
  }));
  const slicesOffPooledRevenue = sumBigint(
    attribution.filter((entry) => entry.pooled).flatMap((entry) => [...entry.slices.values()]),
  );

  // 2b. Operator residual = what is left of the pool once the deals and any shares
  //     taken off the event's own revenue have claimed. Allocated across operators.
  const dealBaseSum = sumBigint([...entitlement.values()]);
  const residual = pool - dealBaseSum - slicesOffPooledRevenue;
  const operators = participants.filter((party) => party.isOperator);
  if (operators.length > 0) {
    const weights = operators.map((operator) => BigInt(operator.operatorResidualShare ?? 1));
    const parts = allocate(residual, weights);
    operators.forEach((operator, index) => {
      credit(operator.participantId, parts[index] ?? 0n);
      addTo(residualOf, operator.participantId, parts[index] ?? 0n);
    });
  }

  // …and now the attributions themselves. A non-operator collector keeps what is
  // left of its own line, so its `net` lands on zero and no transfer is written
  // for money that was never the event's.
  for (const { line, slices, pooled } of attribution) {
    let movedAway = 0n;
    for (const [recipient, slice] of slices) {
      if (!entitlement.has(recipient)) {
        throw new Error(
          `A revenue line gives ${slice} to ${recipient}, who is not a participant on this event.`,
        );
      }
      credit(recipient, slice);
      movedAway += slice;
    }
    if (!pooled && line.collectedBy) credit(line.collectedBy, line.amount - movedAway);
  }

  // 3. Deductibles — the borne half of each cost lowers those parties' entitlements.
  //    One party at the whole amount is the classic deductible (a venue paying for
  //    the band); several at stated percentages is the meeting's cost split.
  bearings.forEach((bearing, index) => {
    for (const [participantId, amount] of bearing.borne) {
      credit(participantId, -amount);
      addTo(deductibles, participantId, amount);
      // THIS PARTY'S PORTION, not the line's total: a cost split 60/40 tells each
      // bearer their own share, so the itemised list sums to `deductibles` exactly.
      // A line with no label still gets an entry — "one of your deductions, 500"
      // is a worse answer than a name, and a better one than silence.
      const named = deductibleLines.get(participantId) ?? [];
      named.push({ label: budgetLines[index]?.label ?? "Cost", amount });
      deductibleLines.set(participantId, named);
    }
  });

  // 4. Cash held per participant.
  const collected = new Map<string, bigint>();
  const paid = new Map<string, bigint>();
  for (const line of budgetLines) {
    if (line.kind === "revenue" && line.collectedBy) {
      collected.set(line.collectedBy, (collected.get(line.collectedBy) ?? 0n) + line.amount);
    }
    if (line.kind === "cost" && line.paidBy) {
      paid.set(line.paidBy, (paid.get(line.paidBy) ?? 0n) + line.amount);
    }
  }

  // 4b. Money a DEAL already moved before the night — a rental paid to hold the
  //     room, a guarantee paid to secure the booking (`prepaid.ts`).
  //
  //     Cash, not entitlement. The deal drives the transaction, so the payee is
  //     still owed exactly what the deal says they earned; an advance simply means
  //     part of it is already in their hands, so only the REMAINING transfer
  //     shrinks. Booking it here rather than in step 2a is what keeps that true —
  //     and keeps the pool out of it, because an advance is not a cost and must
  //     never lower what the percentage deals divide.
  //
  //     Both ends, always. The payee's `prepaid` goes up and the payer's goes down
  //     by the same amount, so the conservation law is untouched: one party holds
  //     more of what it is owed and the other has already parted with it.
  const prepaid = new Map<string, bigint>();
  /**
   * WHO THE EARLY MONEY WAS WITH — the other end, per party.
   *
   * `prepaid` is a net figure and a party can be on both sides of the night, so
   * the amount alone cannot say *"paid in advance BY X TO Y"* — which is exactly
   * how the product owner asked for it to read (ClickUp `86cbcn1ue`): *"even if
   * paid in advance it should be included in the final settlement and marked
   * 'paid in advance' by X to Y."*
   *
   * Recorded here rather than re-derived by a caller, because this loop is the
   * only place that already knows both ends of every advance. A screen that had
   * to work it out again would have to re-implement `allocate` and the payer
   * fallback to do it, and would then be a second opinion about who was paid.
   */
  const prepaidCounterparties = new Map<string, Set<string>>();
  const noteCounterparty = (party: string, other: string) => {
    const existing = prepaidCounterparties.get(party) ?? new Set<string>();
    existing.add(other);
    prepaidCounterparties.set(party, existing);
  };
  for (const deal of deals) {
    const amount = deal.prepaidAmount ?? 0n;
    if (amount === 0n) continue;
    if (!deal.payerParticipantId) {
      // Refusing to guess, in the manner of `weightFromShare`: a one-ended advance
      // would conjure money into the settlement and `assertBalanced` would fail
      // somewhere far from the cause. Fail here, naming the deal.
      throw new Error(`deal ${deal.dealId} states money paid before the event but names no payer`);
    }
    const payees = deal.payeeParticipantIds;
    if (payees.length === 0) {
      throw new Error(`deal ${deal.dealId} states money paid before the event but names no payee`);
    }
    // Divided by the SAME weights the entitlement uses, so a shared split's
    // advance lands in the same proportion as the fee it is part of. `allocate`
    // keeps it exact — the remainder is distributed, never dropped.
    const weights = payees.map((payee) => BigInt(deal.partyShares?.[payee] ?? 1));
    const parts = allocate(amount, weights);
    payees.forEach((payee, index) => {
      addTo(prepaid, payee, parts[index] ?? 0n);
      noteCounterparty(payee, deal.payerParticipantId as string);
      noteCounterparty(deal.payerParticipantId as string, payee);
    });
    addTo(prepaid, deal.payerParticipantId, -amount);
  }

  // 5. Breakdowns — no rounding, so nets sum to exactly zero.
  const breakdowns: PartyBreakdown[] = participants.map((party) => {
    const owed = entitlement.get(party.participantId) ?? 0n;
    const received = collected.get(party.participantId) ?? 0n;
    const fronted = paid.get(party.participantId) ?? 0n;
    const early = prepaid.get(party.participantId) ?? 0n;
    const held = received - fronted + early;
    return {
      participantId: party.participantId,
      entitlement: owed,
      collected: received,
      paid: fronted,
      prepaid: early,
      prepaidCounterpartyIds: [...(prepaidCounterparties.get(party.participantId) ?? [])].sort(),
      deductibleLines: deductibleLines.get(party.participantId) ?? [],
      held,
      net: owed - held,
      lines: lines.get(party.participantId) ?? [],
      commissionEarned: commissionEarned.get(party.participantId) ?? 0n,
      deductibles: deductibles.get(party.participantId) ?? 0n,
      residual: residualOf.get(party.participantId) ?? 0n,
    };
  });

  // 6. Transfers.
  return {
    baseCurrency,
    pool,
    ladder: {
      revenue,
      // What the event never pooled because another party collected and kept it
      // (#23.2). Zero on an ordinary night, and the row the screen hides when it is.
      attributed: revenue - pooledRevenue,
      costs: externalCosts,
      netRevenue: pool,
      offTheTop,
      adjustedNet,
    },
    breakdowns,
    transfers: greedyTransfers(breakdowns),
  };
}

/**
 * The conservation law: net positions must sum to exactly zero. Throws otherwise.
 *
 * The check itself is absolute and stays that way — an imbalance means money has
 * appeared or vanished, and no settlement may be persisted on top of it. The message
 * carries the pool and every party's net because the sum alone says only *that* the
 * books are wrong, never *where* (audit A-14: an imbalance of exactly the amount of
 * one mis-attributed budget line surfaced as an opaque 500).
 */
export function assertBalanced(result: SettlementResult): void {
  const netSum = sumBigint(result.breakdowns.map((party) => party.net));
  if (netSum !== 0n) {
    const positions = result.breakdowns
      .map(
        (party) =>
          `${party.participantId} net=${party.net} (entitlement=${party.entitlement}, held=${party.held})`,
      )
      .join("; ");
    throw new Error(
      `Settlement does not balance: Σ net = ${netSum} (pool=${result.pool} ${result.baseCurrency}). Positions: ${positions || "none"}`,
    );
  }
}
