import { useGetApiV1EventsIdDeals } from "@showme/api-client";
import { basisPointsToPercent } from "@showme/shared";
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
   * of the adjusted net").
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
}

export interface BudgetSeed {
  /** Head count from `events.capacity` — itself snapshotted from the venue. */
  capacity: number | null;
  /**
   * Every CONFIRMED deal that pays somebody on the bill and states a figure — a
   * LIST, because a bill with a support act has more than one and the Costs card
   * shows one "Performer fee". Displayed, never written; see the note above.
   */
  performerFees: BudgetSeedDealFigure[];
  /** The venue's rental fee, minor units — only when a rental deal exists. */
  venueCost: string | null;
  /** The event's own ticket tiers, carried through untouched. */
  ticketTiers: EventTicketTier[];
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

interface Deal {
  id: string;
  name: string;
  type: string;
  structure?: string | null;
  /** `draft` | `confirmed` | `cancelled`. Only a confirmed deal is read in. */
  status?: string;
  guaranteeAmount?: string | null;
  /** The deal's share of the pool, basis points — 10000 = the whole pool. */
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
 * What a confirmed deal already commits to the people on the bill, and the rule
 * it commits it under — or `null` when the deal says nothing the planner can use.
 *
 * **Confirmed only.** The heading this feeds is READ-ONLY (`useBudgetEditor`
 * renders it from the deal and stores nothing), so the operator cannot argue with
 * the figure on the budget screen — they have to go and change the agreement. A
 * number you cannot edit had better be one both parties have signed, which is
 * exactly what `status = 'confirmed'` means. A deal still being negotiated says
 * nothing here and leaves the heading blank and typeable, as it was before.
 * *(The rental below is deliberately NOT gated the same way: it fills an ordinary
 * editable blank, so a figure from an open negotiation is a suggestion the
 * operator can overwrite — the distinction is the affordance, not the deal.)*
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
function performerFeeOf(deal: Deal, performers: Set<string>): BudgetSeedDealFigure | null {
  if (deal.status !== "confirmed" || isRental(deal)) return null;

  const entitled = (deal.parties ?? []).filter((party) =>
    ENTITLED_DEAL_ROLES.has(party.roleInDeal),
  );
  const onTheBill = entitled.filter((party) => performers.has(party.participantId));
  if (onTheBill.length === 0) return null;

  const stated = onTheBill.filter((party) => party.share?.illustrativeAmount != null);
  if (stated.length > 0) {
    const amount = stated.reduce(
      (running, party) => running + BigInt(party.share?.illustrativeAmount as string),
      0n,
    );
    return { dealId: deal.id, dealName: sourceLabel(deal, stated), amount: amount.toString() };
  }

  if (deal.guaranteeAmount != null && onTheBill.length === entitled.length) {
    return { dealId: deal.id, dealName: deal.name, amount: deal.guaranteeAmount };
  }
  return null;
}

/**
 * The deal's name, and — on a door split — the share of the night these lines are.
 *
 * Only `door_split` earns the suffix. It is the one structure whose entitlement is
 * purely a percentage of the adjusted net, so the sentence is exactly true. A
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
  // The deal takes `dealShare` of the pool and these lines take `lineWeight` of
  // that, so together they are a share of the pool worth the product.
  const shareOfPool = Math.round((dealShare * lineWeight) / 10000);
  return `${deal.name} · ${basisPointsToPercent(shareOfPool)}% of the adjusted net`;
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

  return useMemo(() => {
    const deals = (dealsQuery.data ?? []) as Deal[];
    const performers = new Set(sources.performerParticipantIds);

    return {
      capacity: sources.capacity,
      ticketTiers: sources.ticketTiers,
      // Every confirmed deal that pays somebody on the bill and states a figure,
      // whether it states it as a fee or as a share (`performerFeeOf`). The shape
      // test is what keeps the venue's room hire out of the artist's row — a
      // RENTAL deal carries a `guaranteeAmount` too.
      performerFees: deals
        .map((deal) => performerFeeOf(deal, performers))
        .filter((fee): fee is BudgetSeedDealFigure => fee !== null),
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
  }, [dealsQuery.data, sources]);
}
