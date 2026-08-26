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
 * WHY THE PERFORMER FEE IS NOT SEEDED, THOUGH THE HANDOFF LISTS IT.
 *
 * `docs/design-handoff-budget-planner.md` §1 says `performerFee` seeds from the
 * deal guarantee, and §6 says that same fee "becomes a deal ENTITLEMENT, not a
 * budget line — assign the line to the deal via `deal_id` so it is never
 * double-counted". Those two sentences pull in opposite directions the moment a
 * seeded FIELD becomes a stored ROW, which is what this editor does: a standing
 * heading carrying a figure is written as a `budget_lines` row on the next
 * flush.
 *
 * And a written row is not inert. `packages/settlement/src/reconcile.ts` reads
 * budget lines as EXTERNAL CASH:
 *
 *   step 3 — a cost line with `payee_participant_id` LOWERS that party's
 *            entitlement;
 *   step 4 — a cost line with `paid_by` counts as cash that participant
 *            ALREADY FRONTED.
 *
 * So auto-seeding the guarantee would tell the engine the operator has already
 * paid the artist, while the deal separately entitles the artist to the same
 * money — a wrong transfer in a real settlement, not a cosmetic duplicate. The
 * planner is a forecast and "never feeds Settlement" (handoff, Scope); a row
 * reconcile can see is a row that feeds settlement whatever we label it.
 *
 * An operator who genuinely paid a fee in cash may still enter it by hand — that
 * is their assertion about the world. What must not happen is the app asserting
 * it on their behalf.
 *
 * The right end state is to RENDER the fee from the deal without persisting it,
 * so the forecast is complete and no row exists. That needs a read-only cost row
 * in `BudgetPlanner`, which is more than this fix should carry.
 */

export interface BudgetSeed {
  /** Head count from `events.capacity` — itself snapshotted from the venue. */
  capacity: number | null;
  /**
   * NOT SEEDED, deliberately — see `performerFeeIsNotSeeded` below. The field is
   * kept so the shape reads honestly at the call site; it is always `null`.
   */
  performerFee: null;
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

    // Referenced so the narrowing helper above stays live for the day the
    // performer fee is rendered from the deal rather than seeded into a field.
    void paysAPerformer;

    return {
      capacity: sources.capacity,
      // THE PERFORMER FEE IS NEVER SEEDED. See the note above the module.
      performerFee: null,
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
