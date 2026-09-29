import { useGetApiV1EventsIdBudgets, useGetApiV1EventsIdDeals } from "@showme/api-client";
import { dealBorneBy } from "@showme/settlement";
import { type EntitlementBasis, dealEntitlementDetailed } from "@showme/settlement";
import {
  allocate,
  basisPointsToPercent,
  isTicketRevenueBasis,
  termsAreSealed,
} from "@showme/shared";
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
   * THE RULE BEHIND THE FIGURE, for the one reader that needs the rule rather than
   * the number: break-even.
   *
   * `amount` is the fee at the PROJECTED attendance. Break-even solves for a
   * different attendance, and a share of the door is a different number there — so
   * the model has to be able to put the fee back at each candidate, which it cannot
   * do from a total. Set only on a figure this module actually derived from a
   * percentage deal; a stated fee has no rule and is genuinely fixed.
   */
  scalesWithDoor?: {
    /** Basis points of the door the deal takes. */
    splitBasisPoints?: number;
    /** The floor it guarantees whatever the door does, in minor units. */
    guaranteeMinor?: string;
  };
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
  /**
   * THE FIGURES ARE SEALED — somebody has signed, so this number cannot be edited on the deal
   * either (QA sweep run 11, and `657cb70` is what made it true).
   *
   * A different boundary from `pending`, which is `deal.status !== "confirmed"`. The terms seal
   * at the FIRST signature, so a deal that is still an offer can already be sealed — and the
   * note under the row told that reader to "change the terms and this moves with it" while the
   * API answered 409.
   */
  sealed: boolean;
}

export interface BudgetSeed {
  /** Head count from `events.capacity` — itself snapshotted from the venue. */
  capacity: number | null;
  /**
   * HOW MANY OF THIS NIGHT'S DEALS THIS READER MAY NOT SEE.
   *
   * Every figure on this sheet that involves a performer fee is DERIVED from the
   * deals list (`performerFees`, `ticketSplit`, `venueCost`), and that list is
   * scoped per reader: story.md gives an operator no god-mode, and decisions.md #4
   * makes sharing a deal with a co-host an explicit `deal_party` in a read-only
   * role. So a co-promoter who is not a party to the act's deal legitimately sees
   * none of it — and the planner used to total the costs it COULD see and print a
   * confident profit. Measured 2026-09-26: the host read a SEK 1,245 loss and the
   * co-host, same shared ledger, same minute, read a SEK 40,255 profit at a "48.5%
   * margin". Neither number was flagged.
   *
   * Nonzero means every cost-derived total on this screen is a floor, not a figure.
   */
  hiddenDealCount: number;
  /**
   * Live deals this sheet CAN read whose entitled parties are none of them on the bill — a fee to
   * crew, say. See `dealsPayingOffTheBill`: counted so the sheet can say it does not include them,
   * not seeded, because which row they become is §25.6's open payer question.
   */
  offTheBillDealCount: number;
  /**
   * Every deal STILL ON THE TABLE that pays somebody on the bill and states a
   * figure — draft or confirmed alike, cancelled never — a LIST, because a bill
   * with a support act has more than one and the Costs card shows one "Performer
   * fee". Displayed, never written; see the note above.
   */
  performerFees: BudgetSeedDealFigure[];
  /**
   * The venue's rental fee and THE DEAL THAT STATES IT — only when a rental deal
   * exists.
   *
   * The deal id is not decoration. It fills an editable "Venue cost" heading, and
   * a row written from that heading with no `deal_id` is read by the settlement
   * as an ordinary external cost — on top of the rental deal, which the engine
   * settles off the top in its own right. The room comes off the night twice, and
   * a percentage act is paid a share of what is left after paying for the room
   * twice.
   *
   * Carrying the id lets the row be written as what it is — this deal's figure —
   * which `routes/settlement.ts` drops at its boundary, leaving the rental deal
   * as the single place the room is charged.
   */
  venueCost: { amount: string; dealId: string } | null;
  /** The event's own ticket tiers, carried through untouched. */
  ticketTiers: EventTicketTier[];
  /** How the door divides, in minor units — see `TicketSplitRaw`. */
  ticketSplit: TicketSplitRaw;
}

/*
 * `SEEDED_TICKET_SHARE` (0.8) lived here and is DELETED. It was the only reader's
 * only use, and that reader stopped guessing a head count — a guessed quantity is as
 * made-up as a guessed price, and on a private ledger it stated a count eight tickets
 * away from the shared book for the same night (QA sweep run 6, QA6-11). The reasoning
 * lives at the seed row in `useBudgetEditor.ts`; the constant would only be a number
 * waiting to be used again.
 */

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
  /**
   * When this party signed, or null while they have not (QA sweep run 7, QA7-9).
   *
   * The API has always sent it; this type dropped it, so the card could only ask the
   * DEAL's status and said *"Nobody has confirmed these terms yet"* on a deal one of the
   * two parties had already signed.
   */
  confirmedAt?: string | null;
}

export interface Deal {
  id: string;
  name: string;
  type: string;
  structure?: string | null;
  /** `draft` | `confirmed` | `cancelled`. Only a confirmed deal is read in. */
  status?: string;
  /**
   * `draft` | `sent` | `confirmed` | `signed` — the AGREEMENT's state, which is not the deal's.
   * Needed for `termsAreSealed`, because a `sent` agreement with one signature already has
   * figures nobody can change.
   */
  agreementStatus?: string | null;
  guaranteeAmount?: string | null;
  /** The deal's share, basis points — 10000 = the whole of what it divides. */
  splitBasisPoints?: number | null;
  parties?: DealParty[];
}

/**
 * WHY THESE TERMS CAN STILL MOVE — counted, not assumed (QA sweep run 7, QA7-9).
 *
 * This said *"Nobody has confirmed these terms yet, so they can still move"* whenever the
 * DEAL was not `confirmed` — and a deal is not confirmed until EVERY party has signed, so
 * the sentence appeared over a deal the operator had already signed, contradicted by the
 * same screen's own Deals tab. Measured: `The Lantern Hall | payer | 2026-09-28 04:31` and
 * `Neon Tide | payee | (null)`.
 *
 * The second half was always right and is the useful half — terms move until everybody
 * signs. Only the count was wrong, and the parties carry their own `confirmedAt`.
 *
 * Exported for its tests: the wrong answer here reads perfectly well, which is how it
 * survived.
 */
export function stillMovingBecause(deal: Deal): string {
  const parties = deal.parties ?? [];
  const signed = parties.filter((party) => party.confirmedAt != null).length;
  if (parties.length === 0 || signed === 0) {
    return "Nobody has confirmed these terms yet, so they can still move.";
  }
  if (signed === parties.length) {
    // Every line signed while the deal is not `confirmed` is a moment mid-write, not a
    // state to describe — say the true and useful half and claim no count.
    return "These terms can still move until the agreement freezes.";
  }
  const of = `${signed} of ${parties.length} parties`;
  return `${of === "1 of 2 parties" ? "One of two parties has" : `${of} have`} signed, so they can still move.`;
}

/**
 * The room hire, and which deal says so — the first rental deal that states a
 * figure.
 *
 * The shape test is the whole point and is mandatory. A RENTAL deal carries a
 * `guaranteeAmount` like any other, so reading `deals[0]` would put the venue's
 * fee in the artist's row. That is the bug this function exists to make
 * impossible, and why it asks about the deal's SHAPE rather than its amount.
 *
 * A withdrawn rental states nothing, the same way a withdrawn performance deal
 * does.
 */
export function rentalOf(
  deals: Deal[],
  /**
   * The participant rows of whoever's book this is — the acting profile's.
   *
   * A RENTAL YOU ARE OWED IS NOT A COST OF YOUR BOOK (QA sweep run 10, QA10-11). This used to offer
   * any rental as the reader's "Venue cost", under the reasoning *"the rental fee is the rental fee
   * whoever collects it"* — which is true of the NIGHT and false of a book. On a room hire the host
   * is paid for, the host's own private book opened at `TOTAL COSTS SEK 5,000 · PROFIT / LOSS
   * −SEK 5,000` for money coming in.
   *
   * §25.7.1 is what makes this worth fixing rather than rare: a rental now names who owes it, and a
   * rental between two co-operators is the ordinary way to record a room one of them lets to the
   * other. Empty (the default) keeps the old behaviour for any caller that does not know whose book
   * it is looking at.
   */
  ownParticipantIds: readonly string[] = [],
): { amount: string; dealId: string } | null {
  const mine = new Set(ownParticipantIds);
  const deal = deals.find((candidate) => {
    if (!isRental(candidate) || candidate.status === "cancelled") return false;
    if (candidate.guaranteeAmount == null) return false;
    /*
     * Owed to me and not BY me: income, not a cost.
     *
     * `some` on the payees rather than `every` — being one of two payees still means being owed a
     * share and charged nothing, which a surviving mutation is what made me work out. And the payer
     * half is not decoration: a party can appear on both ends, and somebody who owes the rental owes
     * it whatever else they are on the deal. A rental naming no payee I share stays a cost, which is
     * the ordinary case — there is no "venue" participant role, so a room hired from a venue that is
     * not on the bill names nobody I am.
     */
    const parties = candidate.parties ?? [];
    const owedToMe =
      parties.some((party) => party.roleInDeal === "payee" && mine.has(party.participantId)) &&
      !parties.some((party) => party.roleInDeal === "payer" && mine.has(party.participantId));
    return !owedToMe;
  });
  return deal ? { amount: deal.guaranteeAmount as string, dealId: deal.id } : null;
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
/**
 * DEALS THIS SHEET CAN SEE AND STILL HAS NOWHERE TO PUT — QA sweep run 15.
 *
 * `performerFeeOf` returns null when no entitled party is on the bill, which is right: a "Performer
 * fee" row naming a crew member would be a lie, and the row has no other home. But the money is real
 * and the OPERATOR is usually the one paying it — measured on the Album Release, a signed SEK 1,000
 * guarantee from the host to Priya Sound never reached TOTAL COSTS at any deal state, while the
 * settlement paid it.
 *
 * Counted rather than seeded, because WHICH row it should become is the open §25.6 payer question: the
 * two candidate rulings put a different amount of it on the operators (the whole fee as a transfer, or
 * a share of it through the pool), and a planner row has to print one figure. So the sheet says what
 * it does not include — the same thing it already does for a deal it cannot read, and the same thing
 * Projections says about the planner.
 *
 * `isRental` and `cancelled` are excluded exactly as `performerFeeOf` excludes them: a room hire is
 * the venue's row and a withdrawn deal pays nobody.
 */
export function dealsPayingOffTheBill(deals: Deal[], performers: Set<string>): number {
  return deals.filter((deal) => {
    if (deal.status === "cancelled" || isRental(deal)) return false;
    const entitled = (deal.parties ?? []).filter((party) =>
      ENTITLED_DEAL_ROLES.has(party.roleInDeal),
    );
    return entitled.length > 0 && !entitled.some((party) => performers.has(party.participantId));
  }).length;
}

export function performerFeeOf(
  deal: Deal,
  performers: Set<string>,
  door: DoorForecast,
): BudgetSeedDealFigure | null {
  if (deal.status === "cancelled" || isRental(deal)) return null;
  const pending = deal.status !== "confirmed";
  /*
   * A DIFFERENT QUESTION FROM `pending`, and the note under the row needs this one: the terms
   * seal at the FIRST signature (`657cb70`), not when the deal reaches `confirmed`. The parties
   * are already to hand — `signedCountOf` counts the same `confirmedAt`s two screens along.
   */
  const sealed = termsAreSealed(
    { agreementStatus: deal.agreementStatus ?? "" },
    deal.parties ?? [],
  );

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
          sealed,
          // Derived from the door, so break-even must be able to re-derive it.
          scalesWithDoor: {
            ...(deal.splitBasisPoints != null ? { splitBasisPoints: deal.splitBasisPoints } : {}),
            ...(deal.guaranteeAmount != null
              ? { guaranteeMinor: BigInt(deal.guaranteeAmount).toString() }
              : {}),
          },
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
      sealed,
    };
  }

  if (deal.guaranteeAmount != null && onTheBill.length === entitled.length) {
    return { dealId: deal.id, dealName: deal.name, amount: deal.guaranteeAmount, pending, sealed };
  }
  return null;
}

/**
 * A ticket tier is a revenue row with no non-ticket basis stamped on it. The list
 * itself lives in `@showme/shared` so the planner, the settlement and the
 * performance report cannot disagree about which revenue is the door.
 */
const isTicketLine = isTicketRevenueBasis;

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
      summary = unconfirmed && sentence ? `${sentence} ${stillMovingBecause(deal)}` : sentence;
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
      ? `The door beats the guarantee. ${basisPointsToPercent(basis.basisPoints)}% of the door is more than the guarantee, so the split governs.`
      : `The guarantee beats the door. ${basisPointsToPercent(basis.basisPoints)}% of the door falls short of it, so the guarantee is paid.`;
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
  /**
   * WHOSE BOOK THIS IS — the acting profile's own participant rows on this event (QA10-11).
   *
   * Used to keep a rental the reader is OWED out of their costs. Comma-joined upstream like the two
   * below, so the seed settles.
   */
  ownParticipantIds: string[];
}

/** One budget row, only as much of one as the forecast below reads. */
export interface BudgetLineForDoor {
  kind: string;
  amount: string;
  details?: unknown;
  dealId?: string | null;
  /**
   * The row's own name, for the one half of the tier-merge rule that matches on it
   * (QA sweep run 7, QA7-2). Optional so every existing caller keeps working; a row
   * with no label simply matches no tier by name.
   */
  label?: string | null;
}

/**
 * WHAT THE NIGHT IS WORTH, and what a percentage deal is measured against.
 *
 * Lifted out of the hook because it is the money core of the screen and the one
 * part of it a test can hold. Everything here is arithmetic over three inputs and
 * none of it knows what React is — the rule this repo applies to settlement maths
 * (`CLAUDE.md`: business logic is plain TS, framework-agnostic) applies to the
 * forecast of that maths just as well. It came out the day a mutation proved the
 * rental deduction could be reverted with every test still green.
 *
 * @param sharedLines the SHARED ledger's rows, never a private book — the act's
 *   fee is a fact about the event, not about whichever slice of it a co-operator
 *   happens to be looking at (#23.2).
 */
export function doorForecastFrom(
  deals: Deal[],
  sharedLines: BudgetLineForDoor[],
  ticketTiers: EventTicketTier[],
): DoorForecast {
  const ticketLines = sharedLines.filter(
    (line) => line.kind === "revenue" && isTicketLine(line.details),
  );
  const fromSheet = ticketLines.reduce((total, line) => total + BigInt(line.amount), 0n);

  /**
   * THE SHEET'S TIERS AND THE EVENT'S ARE ONE DOOR, NOT TWO ALTERNATIVES
   * (QA sweep run 7, QA7-2).
   *
   * This read `fromSheet > 0n ? fromSheet : fromEventTiers` — the sheet wins whenever
   * it has any ticket row at all — on the grounds that it is *"the later statement of
   * the same fact"*. They are not the same fact, and two other places in this app
   * already say so: the planner's own ticket TABLE renders both additively
   * (`mergeTicketTierSeeds`), and the settlement merges them the same way
   * (`statesItsOwnDoor` in `lib/settlement-lines.ts`).
   *
   * So a tier typed on Event Details raised the planner's revenue to SEK 93,000 and
   * left the fee derived from SEK 83,000: the split card divided 83,000 and said *"the
   * deal pays SEK 50,000"*, and `settlement/compute` then paid **SEK 60,000**. The
   * window is exactly the negotiation window — the operator agrees terms against a fee
   * SEK 10,000 too low and finds out at settlement.
   *
   * THE RULE, and it is `mergeTicketTierSeeds`' rule because it has to be the same one:
   *
   *  - a sheet ticket row with **no breakdown** is the whole door under a name of the
   *    operator's choosing, and suppresses the event's tiers entirely;
   *  - otherwise the door is the sheet's rows **plus** the event tiers the sheet does
   *    not already carry — matched on `details.tierId` first (a rename must not make one
   *    tier look like two, which is what `1dcc396` fixed for the table) and on the name
   *    as the fallback for rows written before that id was carried.
   */
  const statesItsOwnDoor = ticketLines.some((line) => line.details == null);
  const writtenTierIds = new Set(
    ticketLines
      .map((line) => (line.details as { tierId?: string } | null)?.tierId)
      .filter((tierId): tierId is string => typeof tierId === "string"),
  );
  const writtenNames = new Set(
    ticketLines
      .map((line) => (line.label ?? "").trim().toLowerCase())
      .filter((name) => name !== ""),
  );
  const tiersNotOnTheSheet = statesItsOwnDoor
    ? []
    : ticketTiers.filter(
        (tier) => !writtenTierIds.has(tier.id) && !writtenNames.has(tier.name.trim().toLowerCase()),
      );
  // Major units × 100, because the Ticketing card takes a price in major units
  // and every figure past this boundary is minor (money.md).
  const doorOf = (tiers: EventTicketTier[]) =>
    tiers.reduce(
      (total, tier) => total + BigInt(Math.round(tier.price * 100)) * BigInt(Math.trunc(tier.est)),
      0n,
    );
  const fromUnwrittenTiers = doorOf(tiersNotOnTheSheet);
  const ticketRevenue = fromSheet + fromUnwrittenTiers;

  /**
   * The sheet's own revenue and costs, which is what turns a ticket forecast into
   * the ADJUSTED NET the settlement will divide.
   *
   * A cost line carrying a `dealId` is A DEAL'S OWN FIGURE — the performer fee the
   * planner derived, or the room hire the operator accepted under "Venue cost" —
   * and the engine drops it at its boundary (`routes/settlement.ts`). Counting it
   * here would charge the night for a fee the deal separately pays, which is the
   * circularity the two-column rule on `budget_lines` exists to prevent.
   */
  const sheetRevenue = sharedLines
    .filter((line) => line.kind === "revenue")
    .reduce((total, line) => total + BigInt(line.amount), 0n);
  const sheetCosts = sharedLines
    .filter((line) => line.kind === "cost" && line.dealId == null)
    .reduce((total, line) => total + BigInt(line.amount), 0n);
  /**
   * THE ROOM, OFF THE TOP — every rental still on the table, which is the set
   * `reconcile()` itself settles (`ne(status, 'cancelled')`).
   *
   * This read `status === "confirmed"` until 2026-09-22 and was wrong in both
   * directions. It disagreed with the engine, which has always settled an unsigned
   * rental off the top; and it papered over a double count rather than preventing
   * one — `sheetCosts` above takes every cost line WITHOUT a `deal_id`, and the
   * "Venue cost" the seed offers the operator used to be written without one, so
   * accepting the app's own suggestion charged the night for the room here AND in
   * the rental deal.
   *
   * Both halves are fixed together, and they have to be: `venueCost` now carries
   * its deal, the accepted row is written as that deal's figure, and a cost line
   * with a `deal_id` is excluded above and dropped at the settlement boundary. The
   * room is charged once, in the deal that states it.
   */
  /*
   * …AND ONLY THE ONES THE POOL ACTUALLY PAYS (QA sweep run 10, QA10-1 — decisions §25.7.1).
   *
   * This summed EVERY non-cancelled rental, which is what the engine used to do and stopped doing
   * on 2026-09-28: a rental whose deal names who owes it settles between its two parties and the
   * adjusted net never sees it. For one hour the engine branched and this did not, so on a night
   * with a co-operator's room hire the planner quoted the act SEK 70,000 while the settlement paid
   * SEK 73,500 — the exact SEK 3,500 §25.7.1's hand-check names as the act's movement, surfacing
   * only after terms had been agreed against the forecast.
   *
   * `dealBorneBy` is the engine's own predicate, imported rather than restated. The comment above
   * this one already promised that *"the Budget Planner moves with the engine, in the same commit"*;
   * a shared function is the version of that promise that cannot be forgotten.
   *
   * §25.9.12 SIMPLIFIED IT AND WIDENED WHAT IT EXCLUDES. The rule used to ask whether the payer
   * shared the residual and the payee did not; it now asks only whether anybody was named. So a
   * venue rental the promoter signed — #24.1's own case — stops being a pool cost here too, which
   * is the whole point of the two sides sharing one line.
   */
  const rentals = deals
    .filter((deal) => deal.status !== "cancelled" && isRental(deal))
    .filter(
      (deal) =>
        dealBorneBy({
          payerParticipantId: (deal.parties ?? []).find((party) => party.roleInDeal === "payer")
            ?.participantId,
        }) === null,
    )
    .reduce((total, deal) => total + BigInt(deal.guaranteeAmount ?? 0), 0n);
  /*
   * The same correction one level up (QA7-2). `sheetRevenue > 0n ? sheetRevenue :
   * ticketRevenue` dropped an unwritten tier from the threshold base too, on any event
   * whose sheet already had a single revenue row of any kind. The sheet's revenue plus
   * the part of the door that is not yet on it is the whole of what the night takes —
   * and with an empty sheet it is exactly `ticketRevenue`, which is what it was before.
   */
  const totalRevenue = sheetRevenue + fromUnwrittenTiers;

  return {
    ticketRevenue,
    totalRevenue,
    // Revenue less the costs nobody is charged for, less the room. Before the
    // sheet has any costs on it this is simply the revenue, which is the honest
    // forecast at that moment rather than an optimistic one.
    splitBase: totalRevenue - sheetCosts - rentals,
    /*
     * COUNTED THE SAME WAY THE MONEY IS (QA7-2). This counted the EVENT's tiers alone,
     * so on the seeded events — whose tiers live in the budget and not in `extras` — it
     * was zero, and an escalator measured against ticket count (#23.3) never fired. The
     * sheet's own tier rows carry their counts in `details.quantity`.
     */
    ticketsSold:
      ticketLines.reduce(
        (total, line) => total + ((line.details as { quantity?: number } | null)?.quantity ?? 0),
        0,
      ) + tiersNotOnTheSheet.reduce((total, tier) => total + Math.trunc(tier.est), 0),
  };
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
    const deals = (dealsQuery.data?.deals ?? []) as Deal[];
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
    const sharedLines =
      (budgetsQuery.data ?? []).find((budget) => budget.scope === "shared")?.lines ?? [];
    const door = doorForecastFrom(deals, sharedLines, sources.ticketTiers);

    return {
      capacity: sources.capacity,
      hiddenDealCount: dealsQuery.data?.hiddenCount ?? 0,
      offTheBillDealCount: dealsPayingOffTheBill(deals, performers),
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
      /*
       * The rental fee is the rental fee whoever collects it — EXCEPT when the collector is the
       * reader (QA10-11). There is still no "venue" participant role, so a rental whose payee is not
       * on the bill seeds exactly as it did; what changed is that a room hire the reader is OWED
       * stops arriving as their cost.
       */
      venueCost: rentalOf(deals, sources.ownParticipantIds),
      // Production cost is deliberately absent. The handoff asks for it, but
      // NOTHING in the schema or the API holds a production figure — there is no
      // `events.production_cost` and no venue equivalent. Seeding it would mean
      // inventing a number, which on a budget screen is worse than a blank.
    };
  }, [dealsQuery.data, budgetsQuery.data, sources]);
}
