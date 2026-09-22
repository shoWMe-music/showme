import { useGetApiV1EventsIdBudgets, useGetApiV1EventsIdDeals } from "@showme/api-client";
import { type EntitlementBasis, dealEntitlementDetailed } from "@showme/settlement";
import { allocate, basisPointsToPercent } from "@showme/shared";
import { useMemo } from "react";

/**
 * What the event ALREADY KNOWS, offered into a blank Budget Planner.
 *
 * The bug this exists to fix: an operator opened the planner on an event that
 * knew its capacity and had a signed guarantee, and got an empty sheet — "it
 * looks like no data is migrating anywhere". Every figure here is one the app was
 * already holding somewhere else.
 *
 * A SUGGESTION, not a sync — the rule the venue prefill established
 * (`useEventVenuePrefill` / `routes/events.ts` "Venue-profile prefill"): a field
 * is filled only when it is BLANK, the value lands in the VISIBLE form rather
 * than being written behind the operator's back, and anything they typed stands.
 * A seeded figure they disagree with is one they can see and change.
 *
 * Amounts are MINOR UNITS as strings, the same spelling `deal.guaranteeAmount`
 * and `budget_lines.amount` already use, so nothing is converted on the way.
 */
/**
 * THE PERFORMER FEE IS RENDERED FROM THE DEAL AND NEVER WRITTEN.
 *
 * `docs/design-handoff-budget-planner.md` §1 says `performerFee` seeds from the
 * deal guarantee, and §6 says that same fee "becomes a deal ENTITLEMENT, not a
 * budget line — assign the line to the deal via `deal_id` so it is never
 * double-counted". Those two sentences pull in opposite directions the moment a
 * seeded FIELD becomes a stored ROW, which is what this editor does: a standing
 * heading carrying a figure is written as a `budget_lines` row on the next flush.
 *
 * And a written row is not inert. `packages/settlement` reads budget lines as
 * EXTERNAL CASH: a cost line with `payee_participant_id` LOWERS that party's
 * entitlement, and one with `paid_by` counts as cash that participant ALREADY
 * FRONTED. Auto-seeding the guarantee would tell the engine the operator has paid
 * the artist, while the deal separately entitles the artist to the same money — a
 * wrong transfer in a real settlement, not a cosmetic duplicate.
 *
 * So the fee is neither hidden nor stored: it is READ from the deal every time the
 * screen renders, shown as a read-only row in the Costs card, and counted in every
 * total. `select count(*) from budget_lines where label = 'Performer fee'` stays 0
 * on a freshly seeded event, and the profit is still right. The operator changes
 * the figure by changing the deal — which is where the figure lives, and the only
 * place changing it also changes what the artist is owed.
 *
 * An operator who genuinely paid something in cash may still enter it by hand
 * under a heading of their own. What must not happen is the app asserting it on
 * their behalf.
 *
 * WHY IT IS STILL A SUGGESTION NOW THAT THE DEAL IS CONFIRMED (ClickUp 86cbaxvf5).
 * The obvious alternative is to WRITE the confirmed deal's figure as a
 * `budget_lines` row with `deal_id` set — the schema models exactly that, and such
 * a row really is inert to the engine (`routes/settlement.ts` drops it at the
 * boundary). It is still the wrong trade, for reasons that have nothing to do with
 * the settlement math:
 *
 * - **Nothing but a page view would be doing the writing.** The only actor here is
 *   an operator OPENING the Budget tab. A screen that mutates the ledger on mount
 *   takes a version off every row it touches, so a co-host editing the same budget
 *   409s against somebody who merely looked — the collateral-write defect fixed in
 *   `useBudgetEditor` this session, re-introduced through a different door.
 * - **A stored copy drifts; a read never does.** Renegotiate the deal and the row
 *   is stale until something syncs it — which is why `DealFigureDriftWarning`
 *   exists at all. Reading the deal every render has no stale state to warn about.
 * - **The operator could not argue with it.** "Performer fee" is a standing
 *   heading with no remove control, so an auto-written figure they disagree with
 *   is one they can neither delete nor explain.
 *
 * `deal_id` is still the right column and still gets written — by the operator, on
 * a row they typed, through the Deal selector on the cost line. What changed is
 * that the app no longer types on their behalf.
 */

/** A figure a deal already holds, offered to the planner to DISPLAY, never to store. */
export interface BudgetSeedDealFigure {
  dealId: string;
  /**
   * WHERE THE FIGURE CAME FROM, in words — the deal's name, plus the RULE when the
   * figure is a share rather than a fixed fee ("Album Release — Door Split · 100%
   * of the door").
   *
   * The rule is part of the source and not decoration. A percentage deal's figure
   * is *what this line is worth at the projected pool* (`routes/deals.ts`,
   * `illustrativeAmount`), so it moves when the night moves — and a bare "50,000"
   * sitting in a list of fixed costs reads as a fee that will not. An operator who
   * raises the ticket price and sees the performer fee stand still has been told
   * something untrue; naming the rule is what stops that.
   */
  dealName: string;
  /** Minor units, the spelling `deal.guaranteeAmount` already uses. */
  amount: string;
  /**
   * NOBODY HAS SIGNED THIS YET — the figure is what the offer on the table comes
   * to, not what the event owes.
   *
   * It is read and counted exactly like a confirmed one; that is the point of
   * Ran's spec (`123qy9rnwud`, 2026-09-21). What the flag buys is the sentence
   * under the row. A number that will move when the counterparty answers, drawn
   * identically to one that will not, is the confident half-truth `docs/money.md`
   * exists to keep off a money screen.
   */
  pending: boolean;
}

export interface BudgetSeed {
  /** Head count from `events.capacity` — itself snapshotted from the venue. */
  capacity: number | null;
  /**
   * Every deal STILL ON THE TABLE that pays somebody on the bill and states a
   * figure — draft or confirmed alike, cancelled never — a LIST, because a bill
   * with a support act has more than one and the Costs card shows one "Performer
   * fee". Displayed, never written; see the note above.
   */
  performerFees: BudgetSeedDealFigure[];
  /** The venue's rental fee, minor units — only when a rental deal exists. */
  venueCost: string | null;
  /** The event's own ticket tiers, carried through untouched. */
  ticketTiers: EventTicketTier[];
  /** How the door divides, in minor units — see `TicketSplitRaw`. */
  ticketSplit: TicketSplitRaw;
}

/** The share of capacity a seeded "General Admission" tier expects to sell. */
export const SEEDED_TICKET_SHARE = 0.8;

/** The provider cut a budget assumes until the operator says otherwise: 1.50%. */
export const DEFAULT_PROCESSING_PERCENT = "1.5";

/** The one seeded ticket tier's name, per the handoff. */
export const SEEDED_TICKET_NAME = "General Admission";

interface DealParty {
  participantId: string;
  roleInDeal: string;
  /**
   * The party's own line. `splitBasisPoints` is its weight in the deal;
   * `illustrativeAmount` is what that weight comes to at the projected pool —
   * illustrative, never a floor (migration 0007, `routes/deals.ts`).
   */
  share?: { splitBasisPoints?: number; illustrativeAmount?: string } | null;
}

export interface Deal {
  id: string;
  name: string;
  type: string;
  structure?: string | null;
  /** `draft` | `confirmed` | `cancelled`. Only a confirmed deal is read in. */
  status?: string;
  guaranteeAmount?: string | null;
  /** The deal's share, basis points — 10000 = the whole of what it divides. */
  splitBasisPoints?: number | null;
  parties?: DealParty[];
}

/**
 * The guarantee on the first deal of a given shape.
 *
 * The shape test is mandatory and is the whole point. A RENTAL deal carries a
 * `guaranteeAmount` too — it is the room hire — so seeding "Performer fee" from
 * `deals[0]` would put the venue's fee in the artist's row. That is the bug this
 * function exists to make impossible.
 */
function guaranteeOf(deals: Deal[], matches: (deal: Deal) => boolean): string | null {
  const deal = deals.find((candidate) => matches(candidate) && candidate.guaranteeAmount != null);
  return deal?.guaranteeAmount ?? null;
}

/**
 * The party roles a deal actually PAYS — and `payee` alone is not the set.
 *
 * A door split names its performers `split_member`, which is the whole reason a
 * confirmed 60/40 agreement contributed nothing to the planner (ClickUp
 * 86cbaxvf5): the only shape that matched here was a single-payee guarantee. The
 * two roles left out are left out for cause — a `payer` funds the deal rather
 * than being paid by it, a `commission` line is a cut of somebody else's payment
 * (never a cost of the night in its own right), and an `observer` is paid
 * nothing at all. `routes/settlement.ts` reads exactly this pair when it builds
 * `payeeParticipantIds`, so the planner and the engine agree on who gets paid.
 */
const ENTITLED_DEAL_ROLES = new Set(["payee", "split_member"]);

/** Room hire, not an artist fee — it belongs under "Venue cost" and nowhere else. */
function isRental(deal: Deal): boolean {
  return deal.type === "rental" || deal.structure === "rental";
}

/**
 * What a deal commits — or offers — to the people on the bill, and the rule it
 * commits it under, or `null` when the deal says nothing the planner can use.
 *
 * **FROM THE DRAFT DEAL, NOT FROM CONFIRMATION** (ClickUp `123qy9rnwud`, Ran,
 * 2026-09-21). This required `status = 'confirmed'` until today, on the argument
 * that the heading it feeds is READ-ONLY — the operator cannot argue with the
 * figure here, they have to go and change the agreement, so a number you cannot
 * edit had better be one both parties have signed.
 *
 * Ran answered that argument rather than working around it: *"if a venue wants to
 * create a budget plan and have a performer fee in it with a split deal, do they
 * now have to wait for the deal to be confirmed by the other side? If so, that's a
 * problem cause they need to make the budgeting before anyone agrees to the
 * deal."* The planner is the tool for deciding whether to MAKE the offer. A blank
 * fee until everybody signs is a risk assessment withheld until the risk is taken.
 *
 * The read-only affordance stays, and his spec is explicit about why: *"the
 * operator edits the assumptions ... the fee is always computed from those, so it
 * is never a free-typed figure that can drift from the deal."* There are two
 * assumptions to edit and this row is neither — the ticket quantity and price on
 * the sheet, and the offered terms ON THE DEAL. Both flow straight back here,
 * because nothing is stored.
 *
 * **Cancelled is the one status that says nothing.** A withdrawn offer forecasts
 * no night, and it is the only deal on an event that nobody is still arguing over
 * — the same `ne(status, 'cancelled')` the settlement engine reads.
 *
 * *(The rental below was already ungated, for the affordance reason above: it
 * fills an ordinary editable blank. The two now agree.)*
 *
 * **The figure is the deal's own.** A party line that states an
 * `illustrativeAmount` states it: *what this line is worth at the projected
 * pool*. Summed across the entitled parties who are on THIS bill, so a 60/40
 * split contributes both performers' lines and a deal that also pays somebody
 * off the bill contributes only the part that belongs here. Failing that, a
 * deal-level `guaranteeAmount` is the whole agreement's fee — usable only when
 * every entitled party is on the bill, because otherwise the row would book the
 * whole fee under a fraction of the people earning it.
 */
export function performerFeeOf(
  deal: Deal,
  performers: Set<string>,
  door: DoorForecast,
): BudgetSeedDealFigure | null {
  if (deal.status === "cancelled" || isRental(deal)) return null;
  const pending = deal.status !== "confirmed";

  const entitled = (deal.parties ?? []).filter((party) =>
    ENTITLED_DEAL_ROLES.has(party.roleInDeal),
  );
  const onTheBill = entitled.filter((party) => performers.has(party.participantId));
  if (onTheBill.length === 0) return null;

  /**
   * A PERCENTAGE DEAL IS DERIVED FROM THE DOOR, not read off a stored figure
   * (#23.1). `illustrativeAmount` is what a party line was worth at the pool
   * somebody projected when the deal was written — it does not move when the
   * ticket forecast does, which is exactly the fault Ran's prototype has in the
   * other direction: a fee frozen at one attendance and then treated as fixed.
   *
   * SETTLEMENT'S OWN FUNCTION does the arithmetic, deliberately. The planner
   * forecasts what `reconcile()` will later compute, so running a second formula
   * here is how the two come to disagree — which is the whole finding behind #23,
   * where Ran's planner split gross tickets and his settlement split adjusted net
   * and both called it 70%.
   *
   * Only when the sheet knows its door. A budget with no ticket tiers yet has no
   * base to take a percentage of, so it falls through to the stated figures
   * below rather than seeding a confident zero.
   */
  if (door.ticketRevenue > 0n && onTheBill.length === entitled.length) {
    const structure = deal.structure;
    if (structure === "door_split" || structure === "guarantee_vs_door") {
      const settled = dealEntitlementDetailed(
        {
          dealId: deal.id,
          structure,
          payeeParticipantIds: onTheBill.map((party) => party.participantId),
          ...(deal.guaranteeAmount != null
            ? { guaranteeAmount: BigInt(deal.guaranteeAmount) }
            : {}),
          ...(deal.splitBasisPoints != null ? { splitBasisPoints: deal.splitBasisPoints } : {}),
        },
        { splitBase: door.splitBase, grossRevenue: door.totalRevenue },
        door.ticketsSold,
      );
      if (settled.amount > 0n) {
        return {
          dealId: deal.id,
          dealName: derivedLabel(deal, settled.basis),
          amount: settled.amount.toString(),
          pending,
        };
      }
    }
  }

  const stated = onTheBill.filter((party) => party.share?.illustrativeAmount != null);
  if (stated.length > 0) {
    const amount = stated.reduce(
      (running, party) => running + BigInt(party.share?.illustrativeAmount as string),
      0n,
    );
    return {
      dealId: deal.id,
      dealName: sourceLabel(deal, stated),
      amount: amount.toString(),
      pending,
    };
  }

  if (deal.guaranteeAmount != null && onTheBill.length === entitled.length) {
    return { dealId: deal.id, dealName: deal.name, amount: deal.guaranteeAmount, pending };
  }
  return null;
}

/**
 * The non-tier revenue bases the planner stamps on a line's `details`. A ticket
 * tier is the one with none of them — the same rule `routes/settlement.ts` applies
 * when it decides which revenue is the door, and deliberately the same list, so
 * the planner and the settlement cannot disagree about what a ticket is.
 */
const NON_TICKET_BASES = new Set(["bar_spend", "merch_spend", "other_revenue", "custom_revenue"]);

function isTicketLine(details: unknown): boolean {
  const basis = (details as { basis?: string } | null)?.basis;
  return basis == null || !NON_TICKET_BASES.has(basis);
}

/**
 * HOW THE DOOR DIVIDES — one line per party, plus whatever the operators keep.
 *
 * The prototype's most distinctive block, and the only place the screen says what
 * a percentage deal actually comes to. Amounts stay in minor units here; the
 * formatting and the participant names are applied in `budgetPlannerView`, which
 * is where the currency and the labels live.
 *
 * The operators' line is a REMAINDER, not a deal: no deal pays them, they keep
 * what the deals do not claim. That is `reconcile()`'s residual, and saying so on
 * the planner is what stops an operator reading their share as an entitlement
 * somebody could renegotiate.
 */
export interface TicketSplitShare {
  participantId: string;
  amountMinor: bigint;
  /** Share OF THE DOOR, basis points — derived from the amount, not the deal. */
  basisPoints: number;
}

export interface TicketSplitRaw {
  doorMinor: bigint;
  shares: TicketSplitShare[];
  /** What no deal claimed. Negative when the deals promise more than the door. */
  operatorRemainderMinor: bigint;
  /** "Guarantee vs Door" / "Door Split" — the shape of the deal driving the split. */
  badge: string | null;
  /** The sentence under the bars, in the engine's own terms. */
  summary: string | null;
}

/** What the sheet currently forecasts, in the currency the budget is kept in. */
export interface DoorForecast {
  /**
   * Gross TICKET revenue. Not the split base since 2026-09-15 — it is the base of
   * the design's "Ticket revenue split" card, which is explicitly *"box office
   * only, before costs and rental"* and says so on the card.
   */
  ticketRevenue: bigint;
  /** Every revenue line, for a threshold bonus (#23.3). */
  totalRevenue: bigint;
  /**
   * THE ADJUSTED NET the settlement will divide — revenue, less the costs nobody
   * is charged for, less any rental off the top (`PoolLadder`).
   *
   * This is the figure a percentage deal is actually measured against, so it is
   * the one the planner must derive a performer fee from. Deriving it from ticket
   * revenue instead is how the planner comes to promise a fee the settlement will
   * not pay, which is the disagreement in Ran's own prototype: its Deal-structure
   * sentence states €53,760 (70% of the box office) while its Overview pays
   * €50,750 (70% of the adjusted net) for the same deal on the same night.
   */
  splitBase: bigint;
  /** Tickets expected across every tier — what escalator tiers are measured against. */
  ticketsSold: number;
}

/**
 * The deal's name plus the rule that produced the figure, in words — "… · the 70%
 * door share beats the guarantee".
 *
 * The RULE, not just the percentage, because a derived fee moves when the ticket
 * forecast does and an operator who sees it change is owed the reason. This is the
 * planner's half of the same sentence `settlementDocument.ts` prints afterwards.
 */
function derivedLabel(deal: Deal, basis: EntitlementBasis): string {
  // The same vocabulary `settlementDocument.describeBasis` uses, because this is
  // the planner's half of the sentence the settlement prints afterwards and the
  // two disagreeing about what the percentage is OF is exactly the confusion the
  // fee derivation exists to remove.
  if (basis.kind === "door_split") {
    return `${deal.name} · ${basisPointsToPercent(basis.basisPoints)}% of the adjusted net`;
  }
  if (basis.kind === "guarantee_vs_door") {
    return basis.won === "door"
      ? `${deal.name} · the ${basisPointsToPercent(basis.basisPoints)}% door share beats the guarantee`
      : `${deal.name} · the guarantee beats the ${basisPointsToPercent(basis.basisPoints)}% door share`;
  }
  return deal.name;
}

/**
 * Every entitled party's slice of the door, and what the operators keep.
 *
 * Runs the SETTLEMENT ENGINE, like the fee beside it: the bar an operator reads
 * while planning has to be the arithmetic that settles later, or the screen is
 * quietly promising something the settlement will not pay (#23, and the €2 300
 * disagreement in Ran's own prototype).
 */
export function ticketSplitOf(
  deals: Deal[],
  performers: Set<string>,
  door: DoorForecast,
): TicketSplitRaw {
  const shares: TicketSplitShare[] = [];
  let badge: string | null = null;
  let summary: string | null = null;
  let claimed = 0n;

  if (door.ticketRevenue <= 0n) {
    return { doorMinor: 0n, shares, operatorRemainderMinor: 0n, badge, summary };
  }

  for (const deal of deals) {
    // The SAME deals the fee is read from, for the same reason (`performerFeeOf`)
    // — and it has to be the same set. These bars and the "Performer fee" row are
    // two drawings of one agreement, so a card showing the operators keeping the
    // whole door beside a cost row paying 70% of it away is the screen
    // contradicting itself on the one question the operator opened it to answer.
    if (deal.status === "cancelled" || isRental(deal)) continue;
    const structure = deal.structure;
    if (structure !== "door_split" && structure !== "guarantee_vs_door") continue;

    const entitled = (deal.parties ?? []).filter((party) =>
      ENTITLED_DEAL_ROLES.has(party.roleInDeal),
    );
    const onTheBill = entitled.filter((party) => performers.has(party.participantId));
    if (onTheBill.length === 0 || onTheBill.length !== entitled.length) continue;

    const settled = dealEntitlementDetailed(
      {
        dealId: deal.id,
        structure,
        payeeParticipantIds: onTheBill.map((party) => party.participantId),
        ...(deal.guaranteeAmount != null ? { guaranteeAmount: BigInt(deal.guaranteeAmount) } : {}),
        ...(deal.splitBasisPoints != null ? { splitBasisPoints: deal.splitBasisPoints } : {}),
      },
      // The CARD's own base, deliberately: this is the ticket-revenue split, which
      // the design draws before costs and rental. The entitlement it illustrates
      // is on the settlement, computed from `splitBase`.
      { splitBase: door.ticketRevenue, grossRevenue: door.totalRevenue },
      door.ticketsSold,
    );
    if (settled.amount <= 0n) continue;

    // Divided across the deal's payees the way the engine divides it, so a 60/40
    // split shows two lines that sum to the deal — never a rounded pair that does
    // not add up to what the deal pays.
    const weights = onTheBill.map((party) => BigInt(party.share?.splitBasisPoints ?? 1));
    const parts = allocate(settled.amount, weights);
    onTheBill.forEach((party, index) => {
      const amountMinor = parts[index] ?? 0n;
      if (amountMinor <= 0n) return;
      shares.push({
        participantId: party.participantId,
        amountMinor,
        basisPoints: Number((amountMinor * 10_000n) / door.ticketRevenue),
      });
      claimed += amountMinor;
    });

    if (badge === null) {
      const shape = structure === "guarantee_vs_door" ? "Guarantee vs Door" : "Door Split";
      // SAID ON THE CHIP, not left to be inferred from the Deals tab. The bars are
      // the most confident thing on the screen — named parties, exact amounts —
      // and an unsigned offer drawn identically to a signed one is the reader's
      // mistake to make only if we let them make it.
      const unconfirmed = deal.status !== "confirmed";
      badge = unconfirmed ? `${shape} · proposed` : shape;
      const sentence = splitSummarySentence(settled.basis);
      summary =
        unconfirmed && sentence
          ? `${sentence} Nobody has confirmed these terms yet, so they can still move.`
          : sentence;
    }
  }

  return {
    doorMinor: door.ticketRevenue,
    shares,
    operatorRemainderMinor: door.ticketRevenue - claimed,
    badge,
    summary,
  };
}

/**
 * The rule in one sentence, from the operands the engine actually compared.
 *
 * "The door" here is LITERAL and stays: this sentence belongs to the ticket-revenue
 * split card, whose base really is the box office — the design captions that card
 * *"box office only, before costs and rental"*. The performer fee next to it is a
 * share of the adjusted net and `derivedLabel` says so. Two different bases, two
 * different sentences, both true.
 */
function splitSummarySentence(basis: EntitlementBasis): string | null {
  if (basis.kind === "door_split") {
    return `${basisPointsToPercent(basis.basisPoints)}% of the door.`;
  }
  if (basis.kind === "guarantee_vs_door") {
    return basis.won === "door"
      ? `The door beats the guarantee — ${basisPointsToPercent(basis.basisPoints)}% of the door is more than the guarantee, so the split governs.`
      : `The guarantee beats the door — ${basisPointsToPercent(basis.basisPoints)}% of the door falls short of it, so the guarantee is paid.`;
  }
  return null;
}

/**
 * The deal's name, and — on a door split — the share of the night these lines are.
 *
 * Only `door_split` earns the suffix. It is the one structure whose entitlement is
 * purely a percentage of the door, so the sentence is exactly true. A
 * `guarantee_vs_door` settles as `max(guarantee, door)` and calling it a
 * percentage would describe an outcome it may never reach, which is the kind of
 * confident half-truth `docs/money.md` exists to keep off a money screen.
 */
function sourceLabel(deal: Deal, lines: DealParty[]): string {
  const dealShare = deal.splitBasisPoints;
  if (deal.structure !== "door_split" || dealShare == null) return deal.name;
  const lineWeight = lines.reduce(
    (running, party) => running + (party.share?.splitBasisPoints ?? 0),
    0,
  );
  if (lineWeight === 0) return deal.name;
  // The deal takes `dealShare` of the door and these lines take `lineWeight` of
  // that, so together they are a share of the door worth the product.
  //
  // "the door", not "the adjusted net" — #23.1 moved the base, and this string was
  // still telling every operator that costs had come off the number their act is
  // paid a percentage of. It is the sentence the planner actually prints under a
  // derived Performer fee row.
  const shareOfDoor = Math.round((dealShare * lineWeight) / 10000);
  return `${deal.name} · ${basisPointsToPercent(shareOfDoor)}% of the door`;
}

/** One ticket tier as the EVENT states it (`events.extras.ticketTiers`). */
export interface EventTicketTier {
  id: string;
  name: string;
  /** Major units, as the Ticketing card on Event Details takes it. */
  price: number;
  /** Inventory cap for the tier. */
  max: number;
  /** What the operator expects to SELL — the forecast, which is what a budget wants. */
  est: number;
}

export interface BudgetSeedSources {
  /** `events.capacity`. */
  capacity: number | null;
  /**
   * The tiers the operator already wrote on Event Details.
   *
   * ClickUp `86cbcn1ue`: *"Ticketing info still missing and does not migrate from
   * the event ticketing details - it should first go to budget planner from event
   * details and then to settlement."*
   *
   * The chain's last hop has always worked — the settlement takes its copy of the
   * budget on the first compute. The FIRST hop did not exist: the event has had a
   * Ticketing card since `extras.ticketTiers` was typed, and the planner ignored
   * it and opened on one invented "General Admission" row at 80% of the room
   * instead. So an operator who had already listed Advance and Walk-up tiers was
   * asked to type them again, and the two lists then disagreed with nothing to say
   * which was right.
   */
  ticketTiers: EventTicketTier[];
  /**
   * Every participant on the bill who could be a performance deal's payee.
   *
   * A LIST, not the one "the" performer: an event with a support act has several,
   * and the guarantee belongs to whichever of them the deal actually names.
   * Matching only the first performer would silently seed nothing on exactly the
   * multi-act bills where a budget matters most.
   */
  performerParticipantIds: string[];
}

export function useBudgetSeed(eventId: string, sources: BudgetSeedSources): BudgetSeed {
  // Shares TanStack's cache with the Details and Agreement tabs, so this is free
  // whenever either has been opened and one request otherwise.
  const dealsQuery = useGetApiV1EventsIdDeals(eventId);
  /**
   * The sheet's own ticket lines, for the door a percentage deal is measured
   * against.
   *
   * Without this the percentage derivation is dead on most events.
   * `sources.ticketTiers` is `events.extras.ticketTiers` — what the operator typed
   * on Event Details — and the seeded reference event has none: its tiers were
   * written straight into the budget. The door read zero, the percentage branch
   * never fired, and the fee fell back to `illustrativeAmount`, a figure frozen
   * when the deal was written. That is the exact fault the derivation exists to
   * remove, and it was found by opening the planner, not by a test.
   *
   * `useBudgetEditor` already fetches this, so TanStack serves it from cache.
   */
  const budgetsQuery = useGetApiV1EventsIdBudgets(eventId);

  return useMemo(() => {
    const deals = (dealsQuery.data ?? []) as Deal[];
    const performers = new Set(sources.performerParticipantIds);

    /**
     * The door the percentage deals are measured against, off the tiers the
     * operator has already written on Event Details.
     *
     * EVENT-SCOPED, not book-scoped (#23.2). The tiers belong to the event, so a
     * co-operator opening their own private book still derives the act's fee from
     * the same door the shared ledger sees — deriving it from whatever slice of
     * ticket revenue happened to be in the book being viewed would produce a
     * number that is not the performer's fee and never will be.
     *
     * Major units × 100, because the Ticketing card takes a price in major units
     * and every figure past this boundary is minor (money.md).
     */
    const fromEventTiers = sources.ticketTiers.reduce(
      (total, tier) => total + BigInt(Math.round(tier.price * 100)) * BigInt(Math.trunc(tier.est)),
      0n,
    );
    // The SHEET wins when it has tiers of its own: it is the later statement of the
    // same fact, and the one the operator is looking at. Read off the SHARED
    // ledger, never a private book — the act's fee is a fact about the event, not
    // about whichever slice of it a co-operator happens to be looking at (#23.2).
    const sharedLines =
      (budgetsQuery.data ?? []).find((budget) => budget.scope === "shared")?.lines ?? [];
    const fromSheet = sharedLines
      .filter((line) => line.kind === "revenue" && isTicketLine(line.details))
      .reduce((total, line) => total + BigInt(line.amount), 0n);
    const ticketRevenue = fromSheet > 0n ? fromSheet : fromEventTiers;

    /**
     * The sheet's own revenue and costs, which is what turns a ticket forecast
     * into the ADJUSTED NET the settlement will divide.
     *
     * A cost line carrying a `dealId` is the deal's OWN figure — the performer fee
     * the planner derived — and the engine drops it at its boundary
     * (`routes/settlement.ts`). Counting it here would charge the night for the
     * fee and then pay the fee out of what is left, which is the circularity the
     * two-column rule on `budget_lines` exists to prevent.
     */
    const sheetRevenue = sharedLines
      .filter((line) => line.kind === "revenue")
      .reduce((total, line) => total + BigInt(line.amount), 0n);
    const sheetCosts = sharedLines
      .filter((line) => line.kind === "cost" && line.dealId == null)
      .reduce((total, line) => total + BigInt(line.amount), 0n);
    /**
     * CONFIRMED RENTALS ONLY, deliberately, where the performer fee above now
     * reads a draft too.
     *
     * A rental's figure is already offered to the operator as an ordinary
     * editable "Venue cost" (`venueCost` below), draft or not. Deducting an
     * unsigned rental HERE as well would take the room off the top twice the
     * moment they accept that suggestion — and `budget_lines` is what the
     * settlement reads, so the second deduction would be the real one.
     *
     * The same collision exists today for a CONFIRMED rental and is not this
     * change's to fix: `sheetCosts` counts every cost line without a `deal_id`,
     * and the seeded Venue cost is written without one. Filed rather than widened.
     */
    const rentals = deals
      .filter((deal) => deal.status === "confirmed" && isRental(deal))
      .reduce((total, deal) => total + BigInt(deal.guaranteeAmount ?? 0), 0n);
    const totalRevenue = sheetRevenue > 0n ? sheetRevenue : ticketRevenue;

    const door: DoorForecast = {
      ticketRevenue,
      totalRevenue,
      // Revenue less the costs nobody is charged for, less the room. Before the
      // sheet has any costs on it this is simply the revenue, which is the honest
      // forecast at that moment rather than an optimistic one.
      splitBase: totalRevenue - sheetCosts - rentals,
      ticketsSold: sources.ticketTiers.reduce((total, tier) => total + Math.trunc(tier.est), 0),
    };

    return {
      capacity: sources.capacity,
      ticketTiers: sources.ticketTiers,
      // Every deal still on the table that pays somebody on the bill and states a
      // figure, whether it states it as a fee or as a share (`performerFeeOf`) and
      // whether or not anybody has signed it yet. The shape test is what keeps the
      // venue's room hire out of the artist's row — a RENTAL deal carries a
      // `guaranteeAmount` too.
      performerFees: deals
        .map((deal) => performerFeeOf(deal, performers, door))
        .filter((fee): fee is BudgetSeedDealFigure => fee !== null),
      ticketSplit: ticketSplitOf(deals, performers, door),
      // The rental fee is the rental fee whoever collects it. There is no
      // "venue" participant role, so requiring a payee match here would seed
      // nothing on every event where the venue is not on the bill.
      venueCost: guaranteeOf(
        deals,
        (deal) => deal.type === "rental" || deal.structure === "rental",
      ),
      // Production cost is deliberately absent. The handoff asks for it, but
      // NOTHING in the schema or the API holds a production figure — there is no
      // `events.production_cost` and no venue equivalent. Seeding it would mean
      // inventing a number, which on a budget screen is worse than a blank.
    };
  }, [dealsQuery.data, budgetsQuery.data, sources]);
}
