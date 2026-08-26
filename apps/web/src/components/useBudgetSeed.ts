import { useGetApiV1EventsIdDeals } from "@showme/api-client";
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
 */

/** A figure a deal already holds, offered to the planner to DISPLAY, never to store. */
export interface BudgetSeedDealFigure {
  dealId: string;
  /** The deal's name, so the row can say where its figure came from. */
  dealName: string;
  /** Minor units, the spelling `deal.guaranteeAmount` already uses. */
  amount: string;
}

export interface BudgetSeed {
  /** Head count from `events.capacity` — itself snapshotted from the venue. */
  capacity: number | null;
  /**
   * Every performance deal that names a guarantee — a LIST, because a bill with a
   * support act has more than one and the Costs card shows one "Performer fee".
   * Displayed, never written; see the note above.
   */
  performerFees: BudgetSeedDealFigure[];
  /** The venue's rental fee, minor units — only when a rental deal exists. */
  venueCost: string | null;
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
}

interface Deal {
  id: string;
  name: string;
  type: string;
  structure?: string | null;
  guaranteeAmount?: string | null;
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

export interface BudgetSeedSources {
  /** `events.capacity`. */
  capacity: number | null;
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
    const paysAPerformer = (deal: Deal) =>
      (deal.parties ?? []).some(
        (party) => party.roleInDeal === "payee" && performers.has(party.participantId),
      );

    return {
      capacity: sources.capacity,
      // Every deal that pays somebody on the bill and states a figure. The shape
      // test is what keeps the venue's room hire out of the artist's row — a
      // RENTAL deal carries a `guaranteeAmount` too.
      performerFees: deals
        .filter((deal) => paysAPerformer(deal) && deal.guaranteeAmount != null)
        .map((deal) => ({
          dealId: deal.id,
          dealName: deal.name,
          amount: deal.guaranteeAmount as string,
        })),
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
