import {
  ApiError,
  type PatchApiV1EventsIdBudgetsBidLinesLidBody,
  type PostApiV1EventsIdBudgetsBidLinesBody,
  type getApiV1EventsIdBudgets,
  getGetApiV1EventsIdBudgetsQueryKey,
  useDeleteApiV1EventsIdBudgetsBidLinesLid,
  useGetApiV1EventsIdBudgets,
  useGetApiV1EventsIdDeals,
  useGetApiV1EventsIdParticipants,
  usePatchApiV1EventsIdBudgetsBid,
  usePatchApiV1EventsIdBudgetsBidLinesLid,
  usePostApiV1EventsIdBudgetsBidLines,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import type { BudgetInputs } from "@showme/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getActiveProfileId } from "../lib/activeProfile";
import { errorMessage } from "../lib/errors";
import { toBasisPoints, toMajorUnits, toMinorUnits, toPercentText } from "../lib/moneyUnits";
import type { TemplateDrafts } from "./budgetTemplateDrafts";
import {
  type BudgetSeed,
  DEFAULT_PROCESSING_PERCENT,
  SEEDED_TICKET_NAME,
  SEEDED_TICKET_SHARE,
} from "./useBudgetSeed";

type Budget = Awaited<ReturnType<typeof getApiV1EventsIdBudgets>>[number];

/**
 * WHO CARRIES A COST — the "defined cost rule" the 2026-08 settlements meeting
 * made mandatory (01:06:31: *"the production system requires a defined rule:
 * either a cost split or a single payer"*).
 *
 * Three settings of one mechanism, and the settlement engine reads all three
 * through `costBearingOf` in `packages/settlement`:
 *
 * - **shared** — nobody is charged; the line lowers the pool, so the operator's
 *   residual absorbs it. The default, because it is what an unqualified cost means.
 * - **participant** — a *deduction*: one party's cut is reduced by the whole line
 *   (the venue books the band's hotel and takes it back at settlement). This is
 *   the meeting's "add deduction", distinct from "add cost" (01:08:30).
 * - **split** — the parties named carry the stated percentages between them;
 *   anything unallocated stays a shared cost.
 *
 * Deliberately NOT the same question as `paidBy`. Who *fronted* the cash and who
 * *ultimately bears* it are different facts, and conflating them is what makes a
 * settlement unarguable-looking and wrong: the operator pays the marketing
 * invoice (paidBy) under a contract that splits it 50/50 (bearing).
 */
export type CostBearing =
  | { kind: "shared" }
  | { kind: "participant"; participantId: string }
  | { kind: "split"; shares: Record<string, number> };

export const SHARED_COST_BEARING: CostBearing = { kind: "shared" };

/**
 * HOW A COST NAMES A DEAL — and the two things that can mean.
 *
 * The 2026-08 settlements meeting and the budget-planner design handoff both ask
 * for `budget_lines.deal_id`, and they mean opposite things by it:
 *
 * - the meeting means **accountability** — *"all project costs assigned to
 *   specific deals, creating accountability for each agreement"*. The 500 of
 *   catering booked to the headliner's night so the deal's true cost can be read
 *   off. Somebody was really invoiced 500.
 * - the handoff (§6) means **identity** — *"performer fee → a deal ENTITLEMENT,
 *   not a budget line — assign the line to the deal via `deal_id` so it is never
 *   double-counted"*. The 3 000 typed into "Performer fee" IS the guarantee the
 *   deal already promises. Nobody pays it twice.
 *
 * Both are real, the same operator wants both, and NOTHING IN A LINE distinguishes
 * them — a catering cost and a guarantee are both a label, an amount and a deal.
 * So the line says which, and this is the field that says it:
 *
 * - **`deal_figure`** → `budget_lines.deal_id`. A forecast of what the agreement
 *   will pay. The settlement takes the figure from the DEAL and drops the line
 *   (`routes/settlement.ts`), so the row never touches the pool.
 * - **`attributed`** → `budget_lines.attributed_deal_id`. Ordinary external cash
 *   that happens to be reported under a deal. It lowers the pool and obeys
 *   `paidBy` / `bearing` exactly as an untagged cost does; the settlement engine
 *   never reads the column at all.
 *
 * The difference is a real 500 in the operator's residual, which is why the
 * planner asks in words rather than inferring.
 */
export type CostDealLink =
  | { kind: "none" }
  | { kind: "deal_figure"; dealId: string }
  | { kind: "attributed"; dealId: string };

export const NO_DEAL_LINK: CostDealLink = { kind: "none" };

/** The deal a link names, whichever sense it is — or "" when it names none. */
export function linkedDealId(link: CostDealLink | undefined): string {
  return link && link.kind !== "none" ? link.dealId : "";
}

/** The two `budget_lines` columns a link writes, in the shape the API takes. */
function dealLinkFields(link: CostDealLink): {
  dealId: string | null;
  attributedDealId: string | null;
} {
  if (link.kind === "deal_figure") return { dealId: link.dealId, attributedDealId: null };
  if (link.kind === "attributed") return { dealId: null, attributedDealId: link.dealId };
  return { dealId: null, attributedDealId: null };
}

/** The link a stored line carries, read back for the planner's selector. */
function dealLinkFrom(line: {
  dealId?: string | null;
  attributedDealId?: string | null;
}): CostDealLink {
  if (line.dealId) return { kind: "deal_figure", dealId: line.dealId };
  if (line.attributedDealId) return { kind: "attributed", dealId: line.attributedDealId };
  return NO_DEAL_LINK;
}

/** A ticket tier as the planner edits it — major-unit strings, controlled. */
export interface TicketTierDraft {
  /** The line id, or a `new:` placeholder for a tier not yet written. */
  id: string;
  name: string;
  price: string;
  quantity: string;
  /**
   * The participant who RECEIVES this money (2026-08 meeting, 01:27:49). Absent
   * on a row that has not been attributed — the flush then falls back to the
   * operator doing the planning, which is what every line silently assumed before
   * the selector existed.
   */
  collectedBy?: string;
}

export interface CostDraft {
  key: string;
  label: string;
  value: string;
  /**
   * True for a row the operator added themselves ("+ Add Field"), false for one
   * of the standing headings. Only a custom row may be removed — deleting
   * "Performer fee" would take a heading out of a screen that is supposed to
   * always show the same six, and the operator would have no way to get it back.
   */
  isCustom: boolean;
  /** The participant who FRONTED the cash (2026-08 meeting, 01:29:46). */
  paidBy?: string;
  /** Who ultimately carries it. Absent reads as `shared`. */
  bearing?: CostBearing;
  /** Which deal this cost names, and in which of the two senses. Absent = none. */
  dealLink?: CostDealLink;
  /**
   * Set on a row whose figure is READ FROM A DEAL and never stored — the
   * performer fee (`useBudgetSeed`). It counts in every total, is not editable
   * here, and the flush skips it entirely: writing it would put the guarantee in
   * `budget_lines` as well as in the deal, which is the double-count the whole
   * arrangement exists to avoid.
   */
  readFromDeal?: { dealNames: string[] };
}

/**
 * A free-form revenue row ("+ Add Field" on the Revenue card) — a sponsorship, a
 * merch guarantee, a grant.
 *
 * Unlike a custom COST, which is simply a cost line under a heading of the
 * operator's own, a custom revenue line has to be told apart from a ticket tier:
 * both are `kind = 'revenue'` rows with a label and an amount. That is what
 * `details.basis = 'custom_revenue'` is for, and why the two are not symmetric.
 *
 * A CUSTOM ROW'S VALUE IS THE VALUE (product owner, 2026-08: *"Values in custom
 * budget is what the user inputs"*).
 *
 * There is no row `type`. A previous build invented one — `manual` / `per_guest`,
 * where a per-guest row was silently multiplied by capacity — so €5 typed into a
 * row came out of the sheet as €2 500 on a 500-cap room. Nothing asked for that
 * arithmetic and nothing on the row said it had happened; the operator typed a
 * figure and the planner budgeted a different one.
 *
 * An operator who wants a per-head cost multiplies it themselves, which is the
 * one calculation they cannot get wrong without seeing it.
 */
export interface CustomRevenueDraft {
  /** The line id, or a `new:` placeholder for a row not yet written. */
  id: string;
  label: string;
  /** The whole figure, exactly as typed. */
  value: string;
  /** The participant who RECEIVES this money (2026-08 meeting, 01:27:49). */
  collectedBy?: string;
}

/**
 * The standing cost headings a promoter budgets against, in the design
 * prototype's wording and the design prototype's ORDER ("shoWMe All View" →
 * Budget → Costs). They exist as ROWS in the planner before they exist as lines
 * in the database: a heading only becomes a `budget_lines` row once it is given a
 * figure, so an untouched budget stays genuinely empty rather than carrying six
 * zero-value lines nobody entered.
 */
export const STANDARD_COST_HEADINGS = [
  "Performer fee",
  "Production cost",
  "Staff cost",
  "Marketing cost",
  "Venue cost",
  "Other cost",
] as const;

/**
 * The headings this screen invented before it was checked against the prototype,
 * mapped to the ones it should always have used.
 *
 * Without this a promoter who had already budgeted 50 000 of "Artist fees" would
 * open the planner to find an empty "Performer fee" row above their real line
 * demoted to a custom heading — the same money in two places, which is exactly the
 * confusion a budget screen cannot afford. Read through the map, the old line IS
 * the new row; it is relabelled on the next edit that touches it (see the flush
 * below) rather than by a data migration, because renaming somebody's stored line
 * behind their back is worse than a row whose label catches up when they use it.
 */
const LEGACY_COST_HEADINGS: Record<string, string> = {
  "Artist fees": "Performer fee",
  Production: "Production cost",
  Staffing: "Staff cost",
  Marketing: "Marketing cost",
  Venue: "Venue cost",
  Other: "Other cost",
};

/** A participant's event role in the planner's words ("Co host" → "Co host"). */
function participantRoleLabel(role: string): string {
  return role.replace(/_/g, " ").replace(/^\w/, (character) => character.toUpperCase());
}

/** The heading a stored cost line belongs under, old wording or new. */
function costHeadingOf(label: string): string {
  return LEGACY_COST_HEADINGS[label] ?? label;
}

/** The one revenue line that is neither a ticket tier nor the bar estimate. */
const OTHER_REVENUE_LABEL = "Other revenue";

/** The bar estimate's stored label — the row is found by `basis`, never by this. */
const BAR_LABEL = "Bar and merchandise";

export const NEW_ROW_PREFIX = "new:";
const SAVE_DEBOUNCE_MILLISECONDS = 700;

/**
 * The three rows that are not a list entry and so have no id of their own, named
 * so they can be marked edited like any other row (see `wasEdited` in the flush).
 * The `:` keeps them out of the uuid space a real line id occupies.
 */
const BAR_ROW = "row:bar";
const OTHER_REVENUE_ROW = "row:other-revenue";
const ASSUMPTIONS_ROW = "row:assumptions";

function numeric(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * A stored custom line read back into a draft row.
 *
 * ALWAYS `amount`, never `details.unitAmount` — and that is how the rows written
 * under the old per-guest reading are carried across. Such a row stored the
 * per-head figure in `unitAmount` and the multiplied total in `amount`; `amount`
 * is what every total on the screen was already built from, so reading it back is
 * the one interpretation under which no money on the sheet changes. What changes
 * is the row's own field: it now shows the €2 500 the budget was always counting
 * instead of the €5 a head that produced it, which is exactly the figure the
 * literal reading says belongs there. The stale `unitAmount` is overwritten by the
 * next edit that touches the row.
 */
function customDraftFrom(
  id: string,
  label: string,
  amount: string,
  _details: { unitAmount: string; quantity: number } | null | undefined,
): { id: string; label: string; value: string } {
  return { id, label, value: toMajorUnits(amount) };
}

/**
 * The bearing rule a stored line carries, read back for the planner's selector.
 * `cost_split` wins over `payee_participant_id` in the unlikely event a row has
 * both — it is the more specific statement, and the API refuses to write both
 * together, so this only ever matters for rows edited outside the app.
 */
function bearingFrom(line: {
  costSplit?: Record<string, number> | null;
  payeeParticipantId?: string | null;
}): CostBearing {
  if (line.costSplit && Object.keys(line.costSplit).length > 0) {
    return { kind: "split", shares: line.costSplit };
  }
  if (line.payeeParticipantId) {
    return { kind: "participant", participantId: line.payeeParticipantId };
  }
  return SHARED_COST_BEARING;
}

/** The two `budget_lines` columns a bearing rule writes, in the shape the API takes. */
function bearingFields(bearing: CostBearing): {
  payeeParticipantId: string | null;
  costSplit: Record<string, number> | null;
} {
  if (bearing.kind === "participant") {
    return { payeeParticipantId: bearing.participantId, costSplit: null };
  }
  if (bearing.kind === "split") {
    return { payeeParticipantId: null, costSplit: bearing.shares };
  }
  return { payeeParticipantId: null, costSplit: null };
}

/** Which budget the planner opens on: the joint book if this event is co-hosted. */
function preferredBudget(budgets: Budget[]): Budget | undefined {
  return budgets.find((budget) => budget.scope === "shared") ?? budgets[0];
}

/** One party a line's money can be attributed to, named as the planner shows them. */
export interface BudgetAttributionOption {
  /** An `event_participants` id — what the budget-line columns store. */
  id: string;
  label: string;
  roleLabel: string;
}

/** One agreement a cost can be booked against. */
export interface BudgetDealOption {
  id: string;
  name: string;
  /**
   * What the deal itself says it pays, MINOR UNITS — the figure the settlement
   * will actually use, and therefore the one a row claiming to BE this deal's
   * figure has to match. `null` when the deal states no amount of its own (a pure
   * split computes its figure at settlement, so there is nothing to disagree
   * with).
   */
  guaranteeAmount: string | null;
}

export interface BudgetEditor {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  /** Everyone on the event, for the collected-by / paid-by / borne-by selectors. */
  participants: BudgetAttributionOption[];
  /** The event's agreements, for assigning a cost to one. */
  deals: BudgetDealOption[];
  /** The caller's own participant row — what an unattributed line falls back to. */
  defaultParticipantId: string | null;
  /** Every budget the viewer may open — their private book, plus any shared one. */
  budgets: Budget[];
  selectedBudgetId: string | null;
  selectBudget: (budgetId: string) => void;
  ticketTiers: TicketTierDraft[];
  costs: CostDraft[];
  capacity: string;
  averageBarSpend: string;
  otherRevenue: string;
  /** What the operator expects their provider to keep — a percentage, as typed. */
  processingPercent: string;
  /** …plus a flat charge on every ticket sold, in major units, as typed. */
  processingFlatPerTicket: string;
  /** True while a debounced write is queued or in flight. */
  isSaving: boolean;
  /** Set when the budget cannot be written to — the reason is shown, not hidden. */
  readOnlyReason: string | null;
  changeTier: (
    id: string,
    field: "name" | "price" | "quantity" | "collectedBy",
    value: string,
  ) => void;
  addTier: () => void;
  removeTier: (id: string) => void;
  /** Who receives the bar take and who receives "Other revenue". */
  barCollectedBy: string;
  otherRevenueCollectedBy: string;
  changeBarCollectedBy: (participantId: string) => void;
  changeOtherRevenueCollectedBy: (participantId: string) => void;
  changeCustomRevenueCollectedBy: (id: string, participantId: string) => void;
  changeCost: (key: string, value: string) => void;
  /** Who FRONTED a cost — cash attribution, not who carries it. */
  changeCostPaidBy: (key: string, participantId: string) => void;
  /** The cost rule: shared, a single bearer, or a split (2026-08 meeting, 01:06:31). */
  changeCostBearing: (key: string, bearing: CostBearing) => void;
  /** Say which deal a cost names and in which sense — see `CostDealLink`. */
  changeCostDealLink: (key: string, link: CostDealLink) => void;
  /**
   * Add a cost row of the operator's own, named and typed in the "+ Add Field"
   * modal. `bearing` is what makes "add deduction" a different act from "add
   * cost" (2026-08 meeting, 01:08:30) — a deduction arrives already naming the
   * party it comes out of.
   */
  addCustomCost: (label: string, amount: string, bearing?: CostBearing) => void;
  /** Remove a custom cost row. The six standing headings are never removable. */
  removeCost: (key: string) => void;
  /** The free-form revenue rows ("+ Add Field" on the Revenue card). */
  customRevenue: CustomRevenueDraft[];
  addCustomRevenue: (label: string, amount: string) => void;
  changeCustomRevenue: (id: string, value: string) => void;
  removeCustomRevenue: (id: string) => void;
  /** Fill every field from a saved template — see `budgetTemplateDrafts.ts`. */
  applyTemplate: (drafts: TemplateDrafts) => void;
  changeCapacity: (value: string) => void;
  changeAverageBarSpend: (value: string) => void;
  changeOtherRevenue: (value: string) => void;
  changeProcessingPercent: (value: string) => void;
  changeProcessingFlatPerTicket: (value: string) => void;
}

/**
 * The Budget Planner's data layer: reads the event's budget lines and WRITES
 * them back.
 *
 * It previously read real lines, edited them into `useState`, and never wrote —
 * so every figure a promoter typed was discarded on navigation. Worse, no route
 * in the app ever created a budget, so on a new event there was nothing to read
 * either and the tab was a dead-end empty state. Budgets are now provisioned by
 * the API on first read (`lib/budget-provisioning.ts`); this hook supplies the
 * other half.
 *
 * **WHEN AN EDIT COMMITS.** Inline, per row, on a short debounce — there is no
 * Save button and there never was one. The fields are free text and a write per
 * character would be both wasteful and jumpy, so the timer stands in for the
 * "act that finishes the field" that `useEventInlineFields` gets from Enter and
 * blur; a budget is one form of many numbers whose intermediate states mean
 * nothing, which is why that card commits on the keystroke that ends a word and
 * this one commits 700ms after the last one.
 *
 * **AND ON THE WAY OUT.** The debounce is cancelled when the tab unmounts — but
 * cancelled AFTER it has been made to fire, not instead. Clearing the timer on
 * its own is what discarded a figure typed in the last 700ms before the operator
 * changed tab: silently, with no error and nothing on the screen to say a number
 * had just been dropped. Measured on the live stack 2026-08-27: 777 typed into
 * "Venue cost" then an immediate click on "Event Details" wrote no row at all.
 *
 * **ONLY WHAT WAS TOUCHED IS WRITTEN.** The flush used to compare every row
 * against the server and write any that differed — and a row differs for
 * structural reasons (a line stored before the planner kept a breakdown carries
 * no `details`) as readily as because somebody typed. One keystroke in
 * "Marketing cost" therefore rewrote five untouched lines and INVENTED a
 * zero-amount "Bar and merchandise" revenue line out of the event's seeded
 * capacity. Every one of those is a row in the ledger the settlement reconciles
 * that nobody entered, and each bumped a version somebody else's edit needed.
 * `wasEdited` is what confines a write to the rows the operator actually moved,
 * and it is also what finally makes `useBudgetSeed`'s "a suggestion, never an
 * overwrite" true: a seeded figure is now written when it is accepted, not when
 * the screen happens to flush.
 *
 * **CONFLICTS.** Every write carries `expectedVersion` (decisions #8). The
 * version is tracked from each write's own RESPONSE, exactly as
 * `useEventInlineFields` tracks the event's, and writes are queued one at a time
 * — so two debounced saves on the same row never conflict with each other, only
 * a genuine outside write does. A real 409 stops the queue, drops the work
 * behind it, refetches, and says in a sticky toast which row and which figure
 * were NOT saved. Nothing is ever re-sent without a fresh version: on a budget,
 * quietly overwriting a co-host's figure is the failure the lock exists to
 * prevent, so the first writer wins and the second is told.
 */
/** Nothing known about the event — the planner then behaves exactly as before. */
const NO_SEED: BudgetSeed = { capacity: null, performerFees: [], venueCost: null };

/**
 * Which standing heading each seeded AMOUNT fills in as an editable draft.
 *
 * Only the rental. The performer fee is handled separately a few lines down,
 * because it is not seeded into a field at all — it is read from the deal and
 * rendered read-only, so it must never become a stored row.
 */
const SEEDED_COST_HEADINGS: Record<string, "venueCost"> = { "Venue cost": "venueCost" };

/** The heading the performer fee is read into. */
const PERFORMER_FEE_HEADING = "Performer fee";

export function useBudgetEditor(eventId: string, seedSource: BudgetSeed = NO_SEED): BudgetEditor {
  const toast = useToast();
  const queryClient = useQueryClient();
  const budgetsQuery = useGetApiV1EventsIdBudgets(eventId);
  const participantsQuery = useGetApiV1EventsIdParticipants(eventId);
  // The agreements a cost can be booked against. Serialized party-scoped, so an
  // operator sees them all and nobody else sees more than they should — this list
  // is the server's answer, never a filter applied here.
  const dealsQuery = useGetApiV1EventsIdDeals(eventId);

  const budgets = useMemo(() => budgetsQuery.data ?? [], [budgetsQuery.data]);
  const [selectedBudgetId, setSelectedBudgetId] = useState<string | null>(null);
  const budget = budgets.find((entry) => entry.id === selectedBudgetId) ?? preferredBudget(budgets);
  const budgetId = budget?.id ?? null;

  // Every line must name the participant who handled the cash (A-14), and for
  // the planner that is the operator doing the planning.
  const activeProfileId = getActiveProfileId();
  const myParticipantId =
    (participantsQuery.data ?? []).find((participant) => participant.profileId === activeProfileId)
      ?.id ?? null;

  // Everyone the money can be attributed to, and every agreement a cost can be
  // booked against. Both come straight off the event — the planner names parties
  // and deals, it never invents them.
  const attributionOptions = useMemo<BudgetAttributionOption[]>(
    () =>
      (participantsQuery.data ?? []).map((participant) => ({
        id: participant.id,
        label:
          participant.name ?? participant.performerTag ?? participantRoleLabel(participant.role),
        roleLabel: participantRoleLabel(participant.role),
      })),
    [participantsQuery.data],
  );
  const dealOptions = useMemo<BudgetDealOption[]>(
    () =>
      (dealsQuery.data ?? []).map((deal) => ({
        id: deal.id,
        name: deal.name,
        guaranteeAmount: deal.guaranteeAmount ?? null,
      })),
    [dealsQuery.data],
  );

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetApiV1EventsIdBudgetsQueryKey(eventId) });
  }, [queryClient, eventId]);

  // Errors and cache invalidation are the write queue's below, not each
  // mutation's: the queue is the only thing that knows which row a failure
  // belongs to, and invalidating once the queue drains is what stops a refetch
  // landing mid-write and re-seeding the draft from a half-written server.
  const updateBudget = usePatchApiV1EventsIdBudgetsBid();
  const createLine = usePostApiV1EventsIdBudgetsBidLines();
  const updateLine = usePatchApiV1EventsIdBudgetsBidLinesLid();
  const deleteLine = useDeleteApiV1EventsIdBudgetsBidLinesLid();

  // ---- server → draft -----------------------------------------------------
  const lines = useMemo(() => budget?.lines ?? [], [budget]);

  const serverTiers = useMemo<TicketTierDraft[]>(
    () =>
      lines
        .filter(
          (line) =>
            line.kind === "revenue" &&
            line.details?.basis !== "bar_spend" &&
            line.details?.basis !== "other_revenue" &&
            // Without this a sponsorship would come back as a ticket tier priced
            // at its full amount — one ticket at 5 000, sitting in the tier list.
            line.details?.basis !== "custom_revenue",
        )
        .map((line) => ({
          id: line.id,
          name: line.label,
          // A line written before the planner persisted its breakdown has no
          // `details`; read it as a single unit at its full amount.
          price: toMajorUnits(line.details?.unitAmount ?? line.amount),
          quantity: (line.details?.quantity ?? 1).toString(),
          collectedBy: line.collectedBy ?? undefined,
        })),
    [lines],
  );

  const barLine = useMemo(
    () => lines.find((line) => line.details?.basis === "bar_spend") ?? null,
    [lines],
  );

  // Sponsorship, a grant, a fee from the venue — real money the operator expects
  // to collect, so it IS a revenue line (like the bar estimate beside it) and not
  // a planner assumption. `basis` is what tells it apart from a ticket tier;
  // matching on the label would break the moment somebody renames it.
  const otherRevenueLine = useMemo(
    () => lines.find((line) => line.details?.basis === "other_revenue") ?? null,
    [lines],
  );

  // The free-form revenue rows, found by `basis` for the same reason the bar
  // estimate is: a label match would break the moment somebody renamed one.
  const serverCustomRevenue = useMemo<CustomRevenueDraft[]>(
    () =>
      lines
        .filter((line) => line.kind === "revenue" && line.details?.basis === "custom_revenue")
        .map((line) => ({
          ...customDraftFrom(line.id, line.label, line.amount, line.details),
          collectedBy: line.collectedBy ?? undefined,
        })),
    [lines],
  );

  const serverCosts = useMemo<CostDraft[]>(() => {
    const costLines = lines.filter((line) => line.kind === "cost");
    const byHeading = new Map(costLines.map((line) => [costHeadingOf(line.label), line]));
    // A deal whose figure is ALREADY written down in this sheet — some row the
    // operator marked "this IS the deal's figure". Reading that deal in again on
    // top of its own row would show the guarantee twice and forecast a cost that
    // exists once.
    const dealsAlreadyOnTheSheet = new Set(
      costLines.map((line) => line.dealId).filter((id): id is string => typeof id === "string"),
    );
    const feesToRead = seedSource.performerFees.filter(
      (fee) => !dealsAlreadyOnTheSheet.has(fee.dealId),
    );

    const standard = STANDARD_COST_HEADINGS.map((heading) => {
      const line = byHeading.get(heading);
      // The performer fee, read live from the deal — but only while the operator
      // has not written a figure of their own under the heading. A stored line is
      // their assertion about the world and outranks the deal's; showing both
      // would budget the same fee twice.
      if (heading === PERFORMER_FEE_HEADING && !line && feesToRead.length > 0) {
        const total = feesToRead.reduce((running, fee) => running + BigInt(fee.amount), 0n);
        return {
          key: `${NEW_ROW_PREFIX}${heading}`,
          label: heading,
          value: toMajorUnits(total.toString()),
          isCustom: false,
          readFromDeal: { dealNames: feesToRead.map((fee) => fee.dealName) },
        };
      }
      // A heading with a stored line shows the stored figure. A heading with none
      // shows what the event already knows — the deal's guarantee under
      // "Performer fee", the rental under "Venue cost" — and nothing at all when
      // the event knows nothing. A STORED LINE ALWAYS WINS: the seed fills a
      // blank, it never overwrites a figure somebody typed.
      const seeded = SEEDED_COST_HEADINGS[heading];
      const fallback = seeded ? seedSource[seeded] : null;
      return {
        key: line ? line.id : `${NEW_ROW_PREFIX}${heading}`,
        label: heading,
        value: line
          ? toMajorUnits(line.amount)
          : typeof fallback === "string"
            ? toMajorUnits(fallback)
            : "",
        isCustom: false,
        paidBy: line?.paidBy ?? undefined,
        bearing: line ? bearingFrom(line) : SHARED_COST_BEARING,
        dealLink: line ? dealLinkFrom(line) : NO_DEAL_LINK,
      };
    });
    // Anything budgeted under a heading of the operator's own is kept too —
    // dropping it would make a real line invisible and un-editable. These are the
    // rows "+ Add Field" creates, and the only ones that carry a remove control.
    const custom = costLines
      .filter((line) => !STANDARD_COST_HEADINGS.includes(costHeadingOf(line.label) as never))
      .map((line) => {
        const draft = customDraftFrom(line.id, line.label, line.amount, line.details);
        return {
          key: line.id,
          label: draft.label,
          value: draft.value,
          isCustom: true,
          paidBy: line.paidBy ?? undefined,
          bearing: bearingFrom(line),
          dealLink: dealLinkFrom(line),
        };
      });
    return [...standard, ...custom];
  }, [lines, seedSource]);

  /**
   * Everything the draft is seeded from, in one value. Grouping it means the
   * re-seed effect below has exactly one dependency, and that dependency changes
   * only when the server's picture of this budget actually changes.
   */
  const processing = budget?.planningAssumptions?.paymentProcessing ?? null;

  const seed = useMemo(() => {
    // The bar line is where the planner keeps its head count, so a budget that
    // has never been touched has no capacity of its own — the event's does.
    const capacity = barLine?.details
      ? barLine.details.quantity.toString()
      : (seedSource.capacity?.toString() ?? "");

    // A budget with no tiers yet opens on one General Admission row expecting to
    // sell 80% of the room. Priced BLANK on purpose: the count is something the
    // event knows, the ticket price is not, and a made-up price would put a
    // revenue figure on the screen that nobody chose.
    const guests = Number(capacity);
    const expected =
      Number.isFinite(guests) && guests > 0 ? Math.round(guests * SEEDED_TICKET_SHARE) : 0;
    const tiers =
      serverTiers.length > 0
        ? serverTiers
        : [
            {
              id: `${NEW_ROW_PREFIX}seed`,
              name: SEEDED_TICKET_NAME,
              price: "",
              quantity: expected > 0 ? expected.toString() : "",
            },
          ];

    return {
      budgetId,
      tiers,
      costs: serverCosts,
      customRevenue: serverCustomRevenue,
      capacity,
      averageBarSpend: barLine?.details ? toMajorUnits(barLine.details.unitAmount) : "",
      otherRevenue: otherRevenueLine ? toMajorUnits(otherRevenueLine.amount) : "",
      // Every budget assumes a provider takes something until the operator says
      // otherwise. An explicit 0 is stored and read back as 0, so this fills a
      // blank without preventing anyone from saying the rails are free.
      processingPercent: processing
        ? toPercentText(processing.percentBasisPoints)
        : DEFAULT_PROCESSING_PERCENT,
      processingFlatPerTicket: processing ? toMajorUnits(processing.flatPerTicket) : "",
      barCollectedBy: barLine?.collectedBy ?? "",
      otherRevenueCollectedBy: otherRevenueLine?.collectedBy ?? "",
    };
  }, [
    budgetId,
    serverTiers,
    serverCosts,
    serverCustomRevenue,
    barLine,
    otherRevenueLine,
    processing,
    seedSource,
  ]);

  const [tiers, setTiers] = useState<TicketTierDraft[]>(seed.tiers);
  const [costs, setCosts] = useState<CostDraft[]>(seed.costs);
  const [customRevenue, setCustomRevenue] = useState<CustomRevenueDraft[]>(seed.customRevenue);
  const [capacity, setCapacity] = useState(seed.capacity);
  const [averageBarSpend, setAverageBarSpend] = useState(seed.averageBarSpend);
  const [otherRevenue, setOtherRevenue] = useState(seed.otherRevenue);
  const [processingPercent, setProcessingPercent] = useState(seed.processingPercent);
  const [processingFlatPerTicket, setProcessingFlatPerTicket] = useState(
    seed.processingFlatPerTicket,
  );
  const [barCollectedBy, setBarCollectedBy] = useState(seed.barCollectedBy);
  const [otherRevenueCollectedBy, setOtherRevenueCollectedBy] = useState(
    seed.otherRevenueCollectedBy,
  );

  // Re-seed from the server only while the person is not mid-edit, so a
  // background refetch cannot yank a half-typed figure out from under them.
  /** True while a draft edit is unwritten; the re-seed effect then stands off. */
  const pendingRef = useRef(false);
  useEffect(() => {
    if (pendingRef.current) return;
    setTiers(seed.tiers);
    setCosts(seed.costs);
    setCustomRevenue(seed.customRevenue);
    setCapacity(seed.capacity);
    setAverageBarSpend(seed.averageBarSpend);
    setOtherRevenue(seed.otherRevenue);
    setProcessingPercent(seed.processingPercent);
    setProcessingFlatPerTicket(seed.processingFlatPerTicket);
    setBarCollectedBy(seed.barCollectedBy);
    setOtherRevenueCollectedBy(seed.otherRevenueCollectedBy);
  }, [seed]);

  // ---- draft → server -----------------------------------------------------
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => void>(() => {});

  /**
   * The version each row must claim on its NEXT write.
   *
   * Seeded from the server and then advanced by our own write responses, never
   * lowered — the budgets query lags behind a write we have already settled, and
   * re-sending the version it still holds would 409 the person typing against
   * themselves. That self-conflict is the whole reason this hook used to send no
   * `expectedVersion` at all; tracking the version from the response is how
   * `useEventInlineFields` answers it, and it works here for the same reason.
   */
  const lineVersionsRef = useRef(new Map<string, number>());
  const budgetVersionRef = useRef(budget?.version ?? 1);
  /** Which budget `budgetVersionRef` is counting — the scope switch changes it. */
  const trackedBudgetRef = useRef<string | null>(null);
  const knownBudgetVersion = budget?.version;
  useEffect(() => {
    const versions = lineVersionsRef.current;
    for (const line of lines) {
      const known = versions.get(line.id);
      if (known === undefined || line.version > known) versions.set(line.id, line.version);
    }
    // Line ids are unique across budgets, so the map above needs no reset — but a
    // budget's version counts from 1 in each book. Switching between the shared
    // ledger and a private one has to TAKE the other book's version rather than
    // keep the higher one, or the first write after the switch would 409 against
    // a version that belongs to a different budget entirely.
    if (budgetId !== trackedBudgetRef.current) {
      trackedBudgetRef.current = budgetId;
      budgetVersionRef.current = knownBudgetVersion ?? 1;
    } else if (knownBudgetVersion !== undefined && knownBudgetVersion > budgetVersionRef.current) {
      budgetVersionRef.current = knownBudgetVersion;
    }
  }, [lines, knownBudgetVersion, budgetId]);

  /** Rows whose edits are queued or in flight — see `releaseWhenIdle` below. */
  const outstandingRef = useRef(0);
  const [writesInFlight, setWritesInFlight] = useState(0);
  /** One write at a time, in the order the operator finished the rows. */
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  /** Bumped by a 409, so work queued against the losing picture is dropped. */
  const epochRef = useRef(0);
  /**
   * The rows the operator has moved since the last flush — the ONLY rows the
   * next flush may write. See the hook's note: a row differs from the server for
   * structural reasons as readily as because somebody typed, so "differs" was
   * never a safe test for "was edited".
   */
  const touchedRef = useRef(new Set<string>());
  /** Loading a template replaces the whole sheet, so every row counts as moved. */
  const touchedEverythingRef = useRef(false);

  /**
   * The draft is the server's again once nothing is outstanding: only then may a
   * refetch re-seed it, and only then is there a settled picture worth refetching.
   */
  const releaseWhenIdle = useCallback(() => {
    outstandingRef.current -= 1;
    setWritesInFlight(outstandingRef.current);
    if (outstandingRef.current > 0) return;
    // A keystroke landed while the queue drained — the draft stays held until
    // THAT edit's flush finishes, or the refetch below would re-seed over it.
    if (timerRef.current === null) pendingRef.current = false;
    invalidate();
  }, [invalidate]);

  /**
   * Put one write on the queue. `label` and `attempted` are what a lost lock has
   * to be able to say, so they travel with the write rather than being rebuilt
   * from state that has moved on by the time the 409 comes back.
   */
  const enqueue = useCallback(
    (label: string, attempted: string, write: () => Promise<void>) => {
      const epoch = epochRef.current;
      outstandingRef.current += 1;
      setWritesInFlight(outstandingRef.current);
      queueRef.current = queueRef.current
        .then(async () => {
          if (epoch !== epochRef.current) return; // a 409 overtook this write
          await write();
        })
        .catch((error) => {
          if (epoch !== epochRef.current) return;
          epochRef.current += 1;
          if (error instanceof ApiError && error.status === 409) {
            // Sticky: a figure that did not save is not something to notice four
            // seconds later, and the row is about to change under them.
            toast.error(
              `“${label}” was changed by someone else, so ${attempted} was not saved. The budget now shows their figure — retype yours if it is still right.`,
              { duration: 0 },
            );
            return;
          }
          toast.error(errorMessage(error, `Couldn't save ${label}.`));
        })
        .finally(releaseWhenIdle);
    },
    [releaseWhenIdle, toast],
  );

  /**
   * The three line writes, each one queued and each one carrying the row's
   * current version. They exist as three named functions rather than inline
   * `mutate` calls because the version bookkeeping — claim the known version,
   * store the one the response returns — has to be identical on every path, and
   * a create that forgot to record its new line's version would 409 the operator
   * on the very next keystroke in the row they had just made.
   */
  const createRow = useCallback(
    (bid: string, label: string, attempted: string, data: PostApiV1EventsIdBudgetsBidLinesBody) => {
      enqueue(label, attempted, async () => {
        const created = await createLine.mutateAsync({ id: eventId, bid, data });
        lineVersionsRef.current.set(created.id, created.version);
      });
    },
    [enqueue, createLine, eventId],
  );

  const updateRow = useCallback(
    (
      bid: string,
      lid: string,
      label: string,
      attempted: string,
      data: PatchApiV1EventsIdBudgetsBidLinesLidBody,
    ) => {
      enqueue(label, attempted, async () => {
        const updated = await updateLine.mutateAsync({
          id: eventId,
          bid,
          lid,
          data: { ...data, expectedVersion: lineVersionsRef.current.get(lid) },
        });
        lineVersionsRef.current.set(lid, updated.version);
      });
    },
    [enqueue, updateLine, eventId],
  );

  const deleteRow = useCallback(
    (bid: string, lid: string, label: string) => {
      // A queued edit to a row that is being removed would PATCH a line that no
      // longer exists, and the operator would be told a row they deleted could
      // not be saved. The removal is the last word on the row.
      touchedRef.current.delete(lid);
      enqueue(label, "the removal", async () => {
        await deleteLine.mutateAsync({
          id: eventId,
          bid,
          lid,
          data: { expectedVersion: lineVersionsRef.current.get(lid) },
        });
        lineVersionsRef.current.delete(lid);
      });
    },
    [enqueue, deleteLine, eventId],
  );

  const readOnlyReason = !budgetId
    ? "This event has no budget yet."
    : !myParticipantId
      ? "Your profile is not a participant on this event, so budget lines cannot be attributed to it."
      : null;

  /**
   * Mark the draft as being edited without queueing a write.
   *
   * Adding an empty row IS the start of an edit even though there is nothing to
   * save yet: without this, the next background refetch re-seeds from the server,
   * which has never heard of the row, and the blank field the operator was about
   * to type into vanishes under their cursor.
   */
  const holdDraft = useCallback(() => {
    pendingRef.current = true;
  }, []);

  const scheduleFlush = useCallback(
    (rowKey: string) => {
      if (readOnlyReason) return;
      pendingRef.current = true;
      touchedRef.current.add(rowKey);
      if (timerRef.current) clearTimeout(timerRef.current);
      // Cleared as it fires, because an armed timer is how `releaseWhenIdle`
      // recognises "they are still typing" and keeps the draft held.
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        flushRef.current();
      }, SAVE_DEBOUNCE_MILLISECONDS);
    },
    [readOnlyReason],
  );

  // Kept in a ref so the debounce timer always calls the CURRENT draft's writer
  // without the timer itself having to be rebuilt on every keystroke.
  flushRef.current = () => {
    if (!budgetId || !myParticipantId) {
      pendingRef.current = false;
      return;
    }
    // The rows this flush owns, taken once and cleared: anything the operator
    // types WHILE it runs belongs to the next flush, not this one.
    const touched = touchedRef.current;
    const touchedEverything = touchedEverythingRef.current;
    touchedRef.current = new Set();
    touchedEverythingRef.current = false;
    const wasEdited = (rowKey: string) => touchedEverything || touched.has(rowKey);
    // Held until the queue drains (`releaseWhenIdle`), so a refetch triggered by
    // one write cannot re-seed the draft over an edit still waiting behind it.
    pendingRef.current = true;
    let queued = false;
    const write = (run: () => void) => {
      queued = true;
      run();
    };
    // A row the operator has not attributed is attributed to them — the same
    // assumption every line made before the selectors existed, now stated once
    // here instead of being hard-coded at five call sites.
    const collector = (chosen: string | undefined) => chosen || myParticipantId;

    for (const tier of tiers) {
      if (!wasEdited(tier.id)) continue;
      const unitAmount = toMinorUnits(tier.price);
      const quantity = Math.trunc(numeric(tier.quantity));
      // The total is the UNIT PRICE IN MINOR UNITS times the count — never the
      // major-unit product converted afterwards. Multiplying first would round
      // once at the end and leave `amount ≠ unitAmount × quantity` on the stored
      // row (0.145 × 2 stores 29 against a unit of 14), which is a breakdown that
      // does not add up to its own total.
      const amount = (BigInt(unitAmount) * BigInt(quantity)).toString();
      const details = { basis: "ticket_tier" as const, unitAmount, quantity };
      const attempted = `${tier.name.trim() || "the ticket tier"} at ${tier.price || "0"}`;
      if (tier.id.startsWith(NEW_ROW_PREFIX)) {
        if (tier.name.trim() === "") continue; // an unnamed tier is not a line yet
        write(() =>
          createRow(budgetId, tier.name.trim(), attempted, {
            kind: "revenue",
            label: tier.name.trim(),
            amount,
            collectedBy: collector(tier.collectedBy),
            details,
          }),
        );
        continue;
      }
      const before = lines.find((line) => line.id === tier.id);
      if (!before) continue;
      const label = tier.name.trim() || before.label;
      write(() =>
        updateRow(budgetId, tier.id, label, attempted, {
          label,
          amount,
          collectedBy: collector(tier.collectedBy),
          details,
        }),
      );
    }

    for (const cost of costs) {
      // A figure read from a deal is not this budget's to write. Skipped BEFORE
      // anything else, because the row does carry an amount and would otherwise
      // sail through the "a heading with a figure becomes a line" rule below —
      // storing the guarantee as external cash, which is precisely the wrong
      // transfer `useBudgetSeed`'s note describes.
      if (cost.readFromDeal) continue;
      if (!wasEdited(cost.key)) continue;
      const typed = cost.value.trim();
      // The figure as typed, taken ONCE — a custom row's value is the value. The
      // breakdown is stored anyway, and stored as `quantity: 1`, because `basis`
      // is what makes the row findable as a custom cost on the way back in.
      const amount = toMinorUnits(typed === "" ? "0" : typed);
      const details = cost.isCustom
        ? { basis: "custom_cost" as const, unitAmount: amount, quantity: 1 }
        : undefined;
      // The cost rule, as the two columns the API stores it in. Derived once —
      // the create and the update paths must never disagree about what "shared"
      // writes, or a rule would clear on one path and persist on the other.
      const bearing = bearingFields(cost.bearing ?? SHARED_COST_BEARING);
      // Which of the two columns the deal id goes in — the whole point of
      // `CostDealLink`. Derived once, for the same reason the bearing is.
      const dealLink = dealLinkFields(cost.dealLink ?? NO_DEAL_LINK);
      const attempted = typed === "" ? "the change" : typed;

      if (cost.key.startsWith(NEW_ROW_PREFIX)) {
        // A standing heading becomes a line when it is given a FIGURE; a custom
        // row becomes one when it is given a NAME. The row the operator just
        // added is theirs and worth keeping at zero — the heading above it is
        // not, or an untouched budget would carry six lines nobody entered.
        const ready = cost.isCustom ? cost.label.trim() !== "" : typed !== "";
        if (!ready) continue;
        write(() =>
          createRow(budgetId, cost.label.trim(), attempted, {
            kind: "cost",
            label: cost.label.trim(),
            amount,
            paidBy: collector(cost.paidBy),
            ...(bearing.payeeParticipantId
              ? { payeeParticipantId: bearing.payeeParticipantId }
              : {}),
            ...(bearing.costSplit ? { costSplit: bearing.costSplit } : {}),
            ...(dealLink.dealId ? { dealId: dealLink.dealId } : {}),
            ...(dealLink.attributedDealId ? { attributedDealId: dealLink.attributedDealId } : {}),
            ...(details ? { details } : {}),
          }),
        );
        continue;
      }
      const before = lines.find((line) => line.id === cost.key);
      if (!before) continue;
      // A line stored under an old heading is relabelled the first time its figure
      // is edited — the operator is already changing this row, so the label
      // catching up with the row it is displayed in surprises nobody.
      const label = cost.label.trim() || before.label;
      write(() =>
        updateRow(budgetId, cost.key, label, attempted, {
          amount,
          ...(before.label !== label ? { label } : {}),
          paidBy: collector(cost.paidBy),
          // Explicitly nulled rather than omitted: clearing a rule back to
          // "shared" has to erase the stored columns, and an omitted field
          // would leave the old bearer silently in place.
          payeeParticipantId: bearing.payeeParticipantId,
          costSplit: bearing.costSplit,
          // Both columns written explicitly, never omitted: moving a row from one
          // sense to the other has to CLEAR the column it left, or the line would
          // claim both and the settlement would read the stale one.
          dealId: dealLink.dealId,
          attributedDealId: dealLink.attributedDealId,
          ...(details ? { details } : {}),
        }),
      );
    }

    // The bar estimate is one revenue line whose breakdown is spend-per-head
    // times heads, so it round-trips as the two fields the planner shows.
    //
    // Written only when the operator moved one of those two fields. It used to be
    // written whenever either was non-empty — and the capacity arrives PRE-FILLED
    // from the event, so opening the planner and typing anywhere created a
    // "Bar and merchandise" revenue line worth 0 that nobody had entered.
    if (wasEdited(BAR_ROW)) {
      const heads = Math.trunc(numeric(capacity));
      const perHead = toMinorUnits(averageBarSpend);
      const amount = (BigInt(perHead) * BigInt(heads)).toString();
      const details = { basis: "bar_spend" as const, unitAmount: perHead, quantity: heads };
      const attempted = `${averageBarSpend || "0"} a head across ${heads}`;
      if (!barLine) {
        write(() =>
          createRow(budgetId, BAR_LABEL, attempted, {
            kind: "revenue",
            label: BAR_LABEL,
            amount,
            collectedBy: collector(barCollectedBy),
            details,
          }),
        );
      } else {
        write(() =>
          updateRow(budgetId, barLine.id, BAR_LABEL, attempted, {
            amount,
            collectedBy: collector(barCollectedBy),
            details,
          }),
        );
      }
    }

    // Other revenue is a single amount, so its breakdown is that amount taken
    // once — `quantity: 1`. The `basis` is what makes it findable on the way back
    // in, which is the whole reason it carries details at all.
    if (wasEdited(OTHER_REVENUE_ROW)) {
      const typed = otherRevenue.trim();
      // Blank reads as ZERO, exactly as a cleared cost row does. Skipping the
      // write instead — which is what used to happen — left the old figure in the
      // database, so clearing the field and reloading brought the money back.
      const amount = toMinorUnits(typed === "" ? "0" : typed);
      const details = { basis: "other_revenue" as const, unitAmount: amount, quantity: 1 };
      if (!otherRevenueLine) {
        write(() =>
          createRow(budgetId, OTHER_REVENUE_LABEL, typed || "0", {
            kind: "revenue",
            label: OTHER_REVENUE_LABEL,
            amount,
            collectedBy: collector(otherRevenueCollectedBy),
            details,
          }),
        );
      } else {
        write(() =>
          updateRow(budgetId, otherRevenueLine.id, OTHER_REVENUE_LABEL, typed || "0", {
            amount,
            collectedBy: collector(otherRevenueCollectedBy),
            details,
          }),
        );
      }
    }

    // The free-form revenue rows. Each is one line carrying `basis:
    // 'custom_revenue'`, taken once (`quantity: 1`) at its own amount — the same
    // shape "Other revenue" uses, because a sponsorship is a figure the operator
    // states rather than a multiplication they performed.
    for (const row of customRevenue) {
      if (!wasEdited(row.id)) continue;
      const typed = row.value.trim();
      // Taken once, at the figure the operator typed. `quantity` is always 1 now;
      // the breakdown survives only because `basis` is how the row is recognised.
      const amount = toMinorUnits(typed === "" ? "0" : typed);
      const details = { basis: "custom_revenue" as const, unitAmount: amount, quantity: 1 };
      if (row.id.startsWith(NEW_ROW_PREFIX)) {
        if (row.label.trim() === "") continue; // an unnamed row is not a line yet
        write(() =>
          createRow(budgetId, row.label.trim(), typed || "0", {
            kind: "revenue",
            label: row.label.trim(),
            amount,
            collectedBy: collector(row.collectedBy),
            details,
          }),
        );
        continue;
      }
      const before = lines.find((line) => line.id === row.id);
      if (!before) continue;
      const label = row.label.trim() || before.label;
      write(() =>
        updateRow(budgetId, row.id, label, typed || "0", {
          label,
          amount,
          collectedBy: collector(row.collectedBy),
          details,
        }),
      );
    }

    // The provider's rates go on the BUDGET, not into a line: no cash has moved,
    // and a cost line would take this estimate into the settlement pool (see the
    // 0015 migration).
    if (wasEdited(ASSUMPTIONS_ROW)) {
      const percentBasisPoints = toBasisPoints(processingPercent);
      const flatPerTicket = toMinorUnits(processingFlatPerTicket);
      const cleared = processingPercent.trim() === "" && processingFlatPerTicket.trim() === "";
      write(() =>
        enqueue(
          "Payment processing fees",
          cleared ? "clearing them" : `${processingPercent || "0"}%`,
          async () => {
            const updated = await updateBudget.mutateAsync({
              id: eventId,
              bid: budgetId,
              data: {
                planningAssumptions: cleared
                  ? null
                  : { paymentProcessing: { percentBasisPoints, flatPerTicket } },
                expectedVersion: budgetVersionRef.current,
              },
            });
            budgetVersionRef.current = updated.version;
          },
        ),
      );
    }

    // Nothing was actually queued — an edit that produced no write (an unnamed
    // new row, a heading still blank) must not leave the draft held, or the
    // re-seed effect would never run again.
    if (!queued) pendingRef.current = false;
  };

  useEffect(
    () => () => {
      if (!timerRef.current) return;
      clearTimeout(timerRef.current);
      timerRef.current = null;
      // FIRE it, do not merely cancel it. The debounce has not elapsed and this
      // screen is going away — cancelling alone is what silently threw away a
      // figure typed in the last 700ms before the operator changed tab.
      flushRef.current();
    },
    [],
  );

  // ---- handlers -----------------------------------------------------------
  const changeTier = useCallback(
    (id: string, field: "name" | "price" | "quantity" | "collectedBy", value: string) => {
      setTiers((rows) => rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
      scheduleFlush(id);
    },
    [scheduleFlush],
  );

  const addTier = useCallback(() => {
    holdDraft(); // same reason as the custom rows: an empty tier must survive a refetch
    setTiers((rows) => [
      ...rows,
      // Empty, not "0": a tier nobody has priced yet has no price, and a
      // pre-filled zero is three characters the operator must delete before
      // they can type. `numeric()` reads "" as 0 for the running totals, so
      // the KPI band still adds up while the fields stay blank.
      { id: `${NEW_ROW_PREFIX}${rows.length}`, name: "", price: "", quantity: "" },
    ]);
  }, [holdDraft]);

  const removeTier = useCallback(
    (id: string) => {
      holdDraft();
      setTiers((rows) => {
        const left = rows.filter((row) => row.id !== id);
        // The tier list is NEVER empty (handoff §1): taking the last row out
        // leaves a blank one behind, because a Revenue card with no ticket row
        // at all offers the operator nothing to type into and no way back.
        return left.length > 0
          ? left
          : [{ id: `${NEW_ROW_PREFIX}0`, name: "", price: "", quantity: "" }];
      });
      if (id.startsWith(NEW_ROW_PREFIX) || !budgetId) return; // never written, nothing to delete
      deleteRow(budgetId, id, tiers.find((row) => row.id === id)?.name || "The ticket tier");
    },
    [budgetId, deleteRow, holdDraft, tiers],
  );

  const changeCost = useCallback(
    (key: string, value: string) => {
      setCosts((rows) => rows.map((row) => (row.key === key ? { ...row, value } : row)));
      scheduleFlush(key);
    },
    [scheduleFlush],
  );

  /** One writer for the three attribution fields a cost row carries. */
  const patchCost = useCallback(
    (key: string, patch: Partial<CostDraft>) => {
      setCosts((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
      scheduleFlush(key);
    },
    [scheduleFlush],
  );

  const changeCostPaidBy = useCallback(
    (key: string, participantId: string) => patchCost(key, { paidBy: participantId }),
    [patchCost],
  );

  const changeCostBearing = useCallback(
    (key: string, bearing: CostBearing) => patchCost(key, { bearing }),
    [patchCost],
  );

  const changeCostDealLink = useCallback(
    (key: string, link: CostDealLink) => patchCost(key, { dealLink: link }),
    [patchCost],
  );

  const changeBarCollectedBy = useCallback(
    (participantId: string) => {
      setBarCollectedBy(participantId);
      scheduleFlush(BAR_ROW);
    },
    [scheduleFlush],
  );

  const changeOtherRevenueCollectedBy = useCallback(
    (participantId: string) => {
      setOtherRevenueCollectedBy(participantId);
      scheduleFlush(OTHER_REVENUE_ROW);
    },
    [scheduleFlush],
  );

  const changeCustomRevenueCollectedBy = useCallback(
    (id: string, participantId: string) => {
      setCustomRevenue((rows) =>
        rows.map((row) => (row.id === id ? { ...row, collectedBy: participantId } : row)),
      );
      scheduleFlush(id);
    },
    [scheduleFlush],
  );

  /**
   * Add a cost row under a heading of the operator's own. It becomes a
   * `budget_lines` cost row on the next flush — the SAME path a standing heading
   * takes, which is why a custom cost needed nothing new in the arithmetic
   * either: `budgetInputsFrom` already sums every row of `costs`.
   *
   * The key only has to be unique until the row is written (the create reads the
   * LABEL, not the key), so the row index cannot collide with a heading's key.
   */
  const addCustomCost = useCallback(
    (label: string, amount: string, bearing?: CostBearing) => {
      const trimmed = label.trim();
      if (trimmed === "") return;
      // The key only has to be unique until the row is written — the create reads
      // the LABEL, not the key — so a row index cannot collide with one of the
      // standing headings' keys. Built here rather than inside the updater
      // because the flush has to be told which row was added.
      const key = `${NEW_ROW_PREFIX}custom:${costs.length}`;
      setCosts((rows) => [
        ...rows,
        {
          key,
          label: trimmed,
          value: amount,
          isCustom: true,
          bearing: bearing ?? SHARED_COST_BEARING,
        },
      ]);
      scheduleFlush(key);
    },
    [costs.length, scheduleFlush],
  );

  const removeCost = useCallback(
    (key: string) => {
      setCosts((rows) => rows.filter((row) => row.key !== key));
      if (key.startsWith(NEW_ROW_PREFIX) || !budgetId) return; // never written
      deleteRow(budgetId, key, costs.find((row) => row.key === key)?.label || "The cost");
    },
    [budgetId, costs, deleteRow],
  );

  const addCustomRevenue = useCallback(
    (label: string, amount: string) => {
      const trimmed = label.trim();
      if (trimmed === "") return;
      const id = `${NEW_ROW_PREFIX}${customRevenue.length}`;
      setCustomRevenue((rows) => [...rows, { id, label: trimmed, value: amount }]);
      scheduleFlush(id);
    },
    [customRevenue.length, scheduleFlush],
  );

  const changeCustomRevenue = useCallback(
    (id: string, value: string) => {
      setCustomRevenue((rows) => rows.map((row) => (row.id === id ? { ...row, value } : row)));
      scheduleFlush(id);
    },
    [scheduleFlush],
  );

  const removeCustomRevenue = useCallback(
    (id: string) => {
      setCustomRevenue((rows) => rows.filter((row) => row.id !== id));
      if (id.startsWith(NEW_ROW_PREFIX) || !budgetId) return; // never written
      deleteRow(budgetId, id, customRevenue.find((row) => row.id === id)?.label || "The row");
    },
    [budgetId, customRevenue, deleteRow],
  );

  /**
   * Replace every planner field from a saved template (`budgetTemplateDrafts.ts`
   * works out what that means) and write it through.
   *
   * The obsolete lines are deleted FIRST and by id, not left to the flush: the
   * flush only ever creates and updates, so a tier the template does not fill
   * would survive in the database and be read straight back on the next refetch —
   * the template would appear to load and then quietly un-load itself.
   */
  const applyTemplate = useCallback(
    (drafts: TemplateDrafts) => {
      if (budgetId) {
        for (const lineId of drafts.removedLineIds) {
          deleteRow(budgetId, lineId, lines.find((line) => line.id === lineId)?.label || "The row");
        }
      }
      // A template replaces the whole sheet, so every row counts as edited — the
      // flush writes only what was touched, and here that is everything.
      touchedEverythingRef.current = true;
      setTiers(drafts.ticketTiers);
      setCosts(drafts.costs);
      setCustomRevenue(drafts.customRevenue);
      setCapacity(drafts.capacity);
      setAverageBarSpend(drafts.averageBarSpend);
      setOtherRevenue(drafts.otherRevenue);
      setProcessingPercent(drafts.processingPercent);
      setProcessingFlatPerTicket(drafts.processingFlatPerTicket);
      scheduleFlush(ASSUMPTIONS_ROW);
    },
    [budgetId, deleteRow, lines, scheduleFlush],
  );

  const changeCapacity = useCallback(
    (value: string) => {
      setCapacity(value);
      scheduleFlush(BAR_ROW);
    },
    [scheduleFlush],
  );

  const changeAverageBarSpend = useCallback(
    (value: string) => {
      setAverageBarSpend(value);
      scheduleFlush(BAR_ROW);
    },
    [scheduleFlush],
  );

  const changeOtherRevenue = useCallback(
    (value: string) => {
      setOtherRevenue(value);
      scheduleFlush(OTHER_REVENUE_ROW);
    },
    [scheduleFlush],
  );

  const changeProcessingPercent = useCallback(
    (value: string) => {
      setProcessingPercent(value);
      scheduleFlush(ASSUMPTIONS_ROW);
    },
    [scheduleFlush],
  );

  const changeProcessingFlatPerTicket = useCallback(
    (value: string) => {
      setProcessingFlatPerTicket(value);
      scheduleFlush(ASSUMPTIONS_ROW);
    },
    [scheduleFlush],
  );

  return {
    isPending: budgetsQuery.isPending || participantsQuery.isPending,
    isError: budgetsQuery.isError,
    error: budgetsQuery.error,
    participants: attributionOptions,
    deals: dealOptions,
    defaultParticipantId: myParticipantId,
    budgets,
    selectedBudgetId: budgetId,
    selectBudget: setSelectedBudgetId,
    ticketTiers: tiers,
    costs,
    capacity,
    averageBarSpend,
    otherRevenue,
    processingPercent,
    processingFlatPerTicket,
    // Queued as well as in flight: the writes are serialized, so a mutation's
    // own `isPending` would read false for work that is waiting its turn.
    isSaving: writesInFlight > 0,
    readOnlyReason,
    changeTier,
    addTier,
    removeTier,
    barCollectedBy,
    otherRevenueCollectedBy,
    changeBarCollectedBy,
    changeOtherRevenueCollectedBy,
    changeCustomRevenueCollectedBy,
    changeCost,
    changeCostPaidBy,
    changeCostBearing,
    changeCostDealLink,
    addCustomCost,
    removeCost,
    customRevenue,
    addCustomRevenue,
    changeCustomRevenue,
    removeCustomRevenue,
    applyTemplate,
    changeCapacity,
    changeAverageBarSpend,
    changeOtherRevenue,
    changeProcessingPercent,
    changeProcessingFlatPerTicket,
  };
}

/**
 * The planner's draft (major-unit strings, because that is what a person types)
 * expressed as the arithmetic module's inputs (minor units as bigint, basis points
 * as integers — money.md).
 *
 * A plain function beside the hook rather than a step inside the screen: the unit
 * boundary is the one place a Budget Planner can quietly lose a factor of a
 * hundred, and it belongs next to `toMinorUnits` — the other half of the same
 * conversion — instead of being re-derived in whichever component renders next.
 */
/**
 * A typed field as the arithmetic wants it: minor units, as a bigint.
 *
 * This is all a row's amount ever needs now. It used to be `customRowAmount`,
 * which took the capacity too and multiplied per-guest rows by it — the invented
 * behaviour the product owner struck out. Keeping the conversion named and in one
 * place is still worth a function: it is where a factor of a hundred would hide.
 */
export function minorUnitsOf(value: string): bigint {
  return BigInt(toMinorUnits(value));
}

export function budgetInputsFrom(editor: BudgetEditor): BudgetInputs {
  const wholeNumber = (value: string) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
  };
  const percentBasisPoints = toBasisPoints(editor.processingPercent);
  const flatPerTicket = BigInt(toMinorUnits(editor.processingFlatPerTicket));
  return {
    ticketTiers: editor.ticketTiers.map((tier) => ({
      unitAmount: BigInt(toMinorUnits(tier.price)),
      quantity: wholeNumber(tier.quantity),
    })),
    averageBarSpend: BigInt(toMinorUnits(editor.averageBarSpend)),
    capacity: wholeNumber(editor.capacity),
    otherRevenue: BigInt(toMinorUnits(editor.otherRevenue)),
    customRevenue: editor.customRevenue.map((row) => minorUnitsOf(row.value)),
    costs: editor.costs.map((cost) => minorUnitsOf(cost.value)),
    // Absent rather than a pair of zeroes when the operator has said nothing: the
    // projection then reports `paymentProcessingFees` of 0 because there is no
    // assumption, not because the assumption is that it is free.
    paymentProcessing:
      percentBasisPoints > 0 || flatPerTicket > 0n
        ? { percentBasisPoints, flatPerTicket }
        : undefined,
  };
}
