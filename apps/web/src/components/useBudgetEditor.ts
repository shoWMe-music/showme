import {
  type getApiV1EventsIdBudgets,
  getGetApiV1EventsIdBudgetsQueryKey,
  useDeleteApiV1EventsIdBudgetsBidLinesLid,
  useGetApiV1EventsIdBudgets,
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
import type { TemplateDrafts } from "./budgetTemplateDrafts";
import {
  type BudgetSeed,
  DEFAULT_PROCESSING_PERCENT,
  SEEDED_TICKET_NAME,
  SEEDED_TICKET_SHARE,
} from "./useBudgetSeed";

type Budget = Awaited<ReturnType<typeof getApiV1EventsIdBudgets>>[number];

/** A ticket tier as the planner edits it — major-unit strings, controlled. */
export interface TicketTierDraft {
  /** The line id, or a `new:` placeholder for a tier not yet written. */
  id: string;
  name: string;
  price: string;
  quantity: string;
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
  /** Set on custom rows only; the standing headings are always flat figures. */
  type?: CustomFieldType;
}

/**
 * A free-form revenue row ("+ Add Field" on the Revenue card) — a sponsorship, a
 * merch guarantee, a grant.
 *
 * Unlike a custom COST, which is simply a cost line under a heading of the
 * operator's own, a custom revenue line has to be told apart from a ticket tier:
 * both are `kind = 'revenue'` rows with a label and an amount. That is what
 * `details.basis = 'custom_revenue'` is for, and why the two are not symmetric.
 */
/**
 * What kind of amount a custom row holds — the `type` of the handoff's
 * `{ name, type, amount }`, and what the row's pill prints.
 *
 * `manual` is a flat figure. `per_guest` is an amount a head, multiplied by
 * capacity — the same arithmetic the bar estimate already does, which is why it
 * needs no new storage: a per-guest row is `unitAmount` × `quantity = capacity`,
 * exactly as `bar_spend` is, and a manual row is that amount taken once.
 *
 * Deliberately NOT the July prototype's `manual`/`auto`: nothing computed an
 * "auto" row there, so it summed to zero for ever. A pill that names a behaviour
 * the planner does not have is the placeholder-control problem in miniature.
 */
export type CustomFieldType = "manual" | "per_guest";

export interface CustomRevenueDraft {
  /** The line id, or a `new:` placeholder for a row not yet written. */
  id: string;
  label: string;
  /** For `per_guest`, the amount PER HEAD; for `manual`, the whole figure. */
  value: string;
  type: CustomFieldType;
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

/** The heading a stored cost line belongs under, old wording or new. */
function costHeadingOf(label: string): string {
  return LEGACY_COST_HEADINGS[label] ?? label;
}

/** The one revenue line that is neither a ticket tier nor the bar estimate. */
const OTHER_REVENUE_LABEL = "Other revenue";

export const NEW_ROW_PREFIX = "new:";
const SAVE_DEBOUNCE_MILLISECONDS = 700;

/**
 * Money crosses the wire as a whole number of MINOR units in a string (money.md)
 * because a JS number loses precision past 2^53. The planner's fields are major
 * units, so these two are the only places the factor of 100 lives.
 */
export function toMinorUnits(major: string): string {
  const parsed = Number(major);
  if (!Number.isFinite(parsed)) return "0";
  return Math.round(parsed * 100).toString();
}

export function toMajorUnits(minor: string): string {
  const parsed = Number(minor);
  // An unreadable amount is unknown, not zero — surfacing it as a literal "0"
  // puts a figure in front of the operator that nobody entered.
  if (!Number.isFinite(parsed)) return "";
  return (parsed / 100).toString();
}

/**
 * Percentages are integer BASIS POINTS on the wire (money.md) — 1.5% is 150, never
 * a float. The planner's field is a percentage, so these two are the only places
 * the factor of 100 lives for rates, exactly as `toMinorUnits` is for money.
 */
export function toBasisPoints(percent: string): number {
  const parsed = Number(percent);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
}

export function toPercentText(basisPoints: number): string {
  return (basisPoints / 100).toString();
}

function numeric(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * A stored custom line read back into a draft row.
 *
 * The row's TYPE is carried by its breakdown rather than by a field of its own: a
 * `quantity` above one means the amount was struck per head, which is the only
 * thing `per_guest` means. Storing the word as well would give the row two
 * sources of truth that a hand-edited `details` could put out of step.
 */
function customDraftFrom(
  id: string,
  label: string,
  amount: string,
  details: { unitAmount: string; quantity: number } | null | undefined,
): { id: string; label: string; value: string; type: CustomFieldType } {
  const perGuest = (details?.quantity ?? 1) > 1;
  return {
    id,
    label,
    value: toMajorUnits(perGuest && details ? details.unitAmount : amount),
    type: perGuest ? "per_guest" : "manual",
  };
}

/** Which budget the planner opens on: the joint book if this event is co-hosted. */
function preferredBudget(budgets: Budget[]): Budget | undefined {
  return budgets.find((budget) => budget.scope === "shared") ?? budgets[0];
}

export interface BudgetEditor {
  isPending: boolean;
  isError: boolean;
  error: unknown;
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
  changeTier: (id: string, field: "name" | "price" | "quantity", value: string) => void;
  addTier: () => void;
  removeTier: (id: string) => void;
  changeCost: (key: string, value: string) => void;
  /** Add a cost row of the operator's own, named and typed in the "+ Add Field" modal. */
  addCustomCost: (label: string, amount: string, type: CustomFieldType) => void;
  /** Remove a custom cost row. The six standing headings are never removable. */
  removeCost: (key: string) => void;
  /** The free-form revenue rows ("+ Add Field" on the Revenue card). */
  customRevenue: CustomRevenueDraft[];
  addCustomRevenue: (label: string, amount: string, type: CustomFieldType) => void;
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
 * Edits are committed on a short debounce rather than on every keystroke: the
 * fields are free text and a write per character would be both wasteful and
 * jumpy. `expectedVersion` is deliberately NOT sent — the optimistic lock exists
 * to protect a deliberate edit from a concurrent one, and re-sending a stale
 * version from a debounced autosave would raise 409s at the person typing
 * rather than at the conflict.
 */
/** Nothing known about the event — the planner then behaves exactly as before. */
const NO_SEED: BudgetSeed = { capacity: null, performerFee: null, venueCost: null };

/** Which standing heading each seeded figure belongs under. */
const SEEDED_COST_HEADINGS: Record<string, keyof BudgetSeed> = {
  "Performer fee": "performerFee",
  "Venue cost": "venueCost",
};

export function useBudgetEditor(eventId: string, seedSource: BudgetSeed = NO_SEED): BudgetEditor {
  const toast = useToast();
  const queryClient = useQueryClient();
  const budgetsQuery = useGetApiV1EventsIdBudgets(eventId);
  const participantsQuery = useGetApiV1EventsIdParticipants(eventId);

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

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetApiV1EventsIdBudgetsQueryKey(eventId) });
  }, [queryClient, eventId]);

  const onError = useCallback(
    (error: unknown) => toast.error(errorMessage(error, "Couldn't save the budget.")),
    [toast],
  );
  const mutationOptions = { mutation: { onSuccess: invalidate, onError } };
  const updateBudget = usePatchApiV1EventsIdBudgetsBid(mutationOptions);
  const createLine = usePostApiV1EventsIdBudgetsBidLines(mutationOptions);
  const updateLine = usePatchApiV1EventsIdBudgetsBidLinesLid(mutationOptions);
  const deleteLine = useDeleteApiV1EventsIdBudgetsBidLinesLid(mutationOptions);

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
        .map((line) => customDraftFrom(line.id, line.label, line.amount, line.details)),
    [lines],
  );

  const serverCosts = useMemo<CostDraft[]>(() => {
    const costLines = lines.filter((line) => line.kind === "cost");
    const byHeading = new Map(costLines.map((line) => [costHeadingOf(line.label), line]));
    const standard = STANDARD_COST_HEADINGS.map((heading) => {
      const line = byHeading.get(heading);
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
          type: draft.type,
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

  // Re-seed from the server only while the person is not mid-edit, so a
  // background refetch cannot yank a half-typed figure out from under them.
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
  }, [seed]);

  // ---- draft → server -----------------------------------------------------
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => void>(() => {});

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

  const scheduleFlush = useCallback(() => {
    if (readOnlyReason) return;
    pendingRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flushRef.current(), SAVE_DEBOUNCE_MILLISECONDS);
  }, [readOnlyReason]);

  // Kept in a ref so the debounce timer always calls the CURRENT draft's writer
  // without the timer itself having to be rebuilt on every keystroke.
  flushRef.current = () => {
    pendingRef.current = false;
    if (!budgetId || !myParticipantId) return;
    const target = { id: eventId, bid: budgetId };

    for (const tier of tiers) {
      const amount = toMinorUnits((numeric(tier.price) * numeric(tier.quantity)).toString());
      const details = {
        basis: "ticket_tier" as const,
        unitAmount: toMinorUnits(tier.price),
        quantity: Math.trunc(numeric(tier.quantity)),
      };
      if (tier.id.startsWith(NEW_ROW_PREFIX)) {
        if (tier.name.trim() === "") continue; // an unnamed tier is not a line yet
        createLine.mutate({
          ...target,
          data: {
            kind: "revenue",
            label: tier.name.trim(),
            amount,
            collectedBy: myParticipantId,
            details,
          },
        });
        continue;
      }
      const before = lines.find((line) => line.id === tier.id);
      if (!before) continue;
      const unchanged =
        before.label === tier.name.trim() &&
        before.amount === amount &&
        before.details?.unitAmount === details.unitAmount &&
        before.details?.quantity === details.quantity;
      if (unchanged) continue;
      updateLine.mutate({
        ...target,
        lid: tier.id,
        data: { label: tier.name.trim() || before.label, amount, details },
      });
    }

    for (const cost of costs) {
      const typed = cost.value.trim();
      // A custom cost row carries the same unit x quantity breakdown a custom
      // revenue row does, so a per-guest cost (a wristband, a drinks token)
      // round-trips as one. A standing heading is always a flat figure and keeps
      // storing no breakdown at all.
      const unitAmount = toMinorUnits(typed === "" ? "0" : typed);
      const quantity =
        cost.isCustom && cost.type === "per_guest" ? Math.trunc(numeric(capacity)) : 1;
      const amount = toMinorUnits((numeric(typed) * quantity).toString());
      const details = cost.isCustom
        ? { basis: "custom_cost" as const, unitAmount, quantity }
        : undefined;

      if (cost.key.startsWith(NEW_ROW_PREFIX)) {
        // A standing heading becomes a line when it is given a FIGURE; a custom
        // row becomes one when it is given a NAME. The row the operator just
        // added is theirs and worth keeping at zero — the heading above it is
        // not, or an untouched budget would carry six lines nobody entered.
        const ready = cost.isCustom ? cost.label.trim() !== "" : typed !== "";
        if (!ready) continue;
        createLine.mutate({
          ...target,
          data: {
            kind: "cost",
            label: cost.label.trim(),
            amount,
            paidBy: myParticipantId,
            ...(details ? { details } : {}),
          },
        });
        continue;
      }
      const before = lines.find((line) => line.id === cost.key);
      if (!before) continue;
      // A line stored under an old heading is relabelled the first time its figure
      // is edited — the operator is already changing this row, so the label
      // catching up with the row it is displayed in surprises nobody.
      const label = cost.label.trim() || before.label;
      const relabelled = before.label !== label ? { label } : {};
      const unchanged =
        before.amount === amount &&
        before.label === label &&
        (!details ||
          (before.details?.unitAmount === unitAmount && before.details?.quantity === quantity));
      if (unchanged) continue;
      updateLine.mutate({
        ...target,
        lid: cost.key,
        data: { amount, ...relabelled, ...(details ? { details } : {}) },
      });
    }

    // The bar estimate is one revenue line whose breakdown is spend-per-head
    // times heads, so it round-trips as the two fields the planner shows.
    const barTouched = capacity.trim() !== "" || averageBarSpend.trim() !== "";
    if (barTouched) {
      const heads = Math.trunc(numeric(capacity));
      const perHead = toMinorUnits(averageBarSpend);
      const amount = toMinorUnits((numeric(averageBarSpend) * heads).toString());
      const details = { basis: "bar_spend" as const, unitAmount: perHead, quantity: heads };
      if (!barLine) {
        createLine.mutate({
          ...target,
          data: {
            kind: "revenue",
            label: "Bar and merchandise",
            amount,
            collectedBy: myParticipantId,
            details,
          },
        });
      } else if (
        barLine.amount !== amount ||
        barLine.details?.unitAmount !== perHead ||
        barLine.details?.quantity !== heads
      ) {
        updateLine.mutate({ ...target, lid: barLine.id, data: { amount, details } });
      }
    }

    // Other revenue is a single amount, so its breakdown is that amount taken
    // once — `quantity: 1`. The `basis` is what makes it findable on the way back
    // in, which is the whole reason it carries details at all.
    if (otherRevenue.trim() !== "") {
      const amount = toMinorUnits(otherRevenue);
      const details = { basis: "other_revenue" as const, unitAmount: amount, quantity: 1 };
      if (!otherRevenueLine) {
        createLine.mutate({
          ...target,
          data: {
            kind: "revenue",
            label: OTHER_REVENUE_LABEL,
            amount,
            collectedBy: myParticipantId,
            details,
          },
        });
      } else if (otherRevenueLine.amount !== amount) {
        updateLine.mutate({ ...target, lid: otherRevenueLine.id, data: { amount, details } });
      }
    }

    // The free-form revenue rows. Each is one line carrying `basis:
    // 'custom_revenue'`, taken once (`quantity: 1`) at its own amount — the same
    // shape "Other revenue" uses, because a sponsorship is a figure the operator
    // states rather than a multiplication they performed.
    for (const row of customRevenue) {
      const typed = row.value.trim();
      const unitAmount = toMinorUnits(typed === "" ? "0" : typed);
      // A per-guest row is struck a head and multiplied by capacity, exactly as
      // the bar estimate is; a manual row is that amount taken once. The
      // breakdown is what carries the row's type back on the next read.
      const quantity = row.type === "per_guest" ? Math.trunc(numeric(capacity)) : 1;
      const amount = toMinorUnits((numeric(typed) * quantity).toString());
      const details = { basis: "custom_revenue" as const, unitAmount, quantity };
      if (row.id.startsWith(NEW_ROW_PREFIX)) {
        if (row.label.trim() === "") continue; // an unnamed row is not a line yet
        createLine.mutate({
          ...target,
          data: {
            kind: "revenue",
            label: row.label.trim(),
            amount,
            collectedBy: myParticipantId,
            details,
          },
        });
        continue;
      }
      const before = lines.find((line) => line.id === row.id);
      if (!before) continue;
      const unchanged =
        before.amount === amount &&
        before.label === row.label.trim() &&
        before.details?.unitAmount === unitAmount &&
        before.details?.quantity === quantity;
      if (unchanged) continue;
      updateLine.mutate({
        ...target,
        lid: row.id,
        data: { label: row.label.trim() || before.label, amount, details },
      });
    }

    // The provider's rates go on the BUDGET, not into a line: no cash has moved,
    // and a cost line would take this estimate into the settlement pool (see the
    // 0015 migration). Written only when they differ from what the server holds,
    // so a debounce that fires on an unrelated keystroke does not bump the
    // budget's version for nothing.
    const percentBasisPoints = toBasisPoints(processingPercent);
    const flatPerTicket = toMinorUnits(processingFlatPerTicket);
    const cleared = processingPercent.trim() === "" && processingFlatPerTicket.trim() === "";
    const changed = cleared
      ? processing !== null
      : processing?.percentBasisPoints !== percentBasisPoints ||
        processing?.flatPerTicket !== flatPerTicket;
    if (changed) {
      updateBudget.mutate({
        ...target,
        data: {
          planningAssumptions: cleared
            ? null
            : { paymentProcessing: { percentBasisPoints, flatPerTicket } },
        },
      });
    }
  };

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  // ---- handlers -----------------------------------------------------------
  const changeTier = useCallback(
    (id: string, field: "name" | "price" | "quantity", value: string) => {
      setTiers((rows) => rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
      scheduleFlush();
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
      deleteLine.mutate({ id: eventId, bid: budgetId, lid: id, data: {} });
    },
    [budgetId, eventId, deleteLine, holdDraft],
  );

  const changeCost = useCallback(
    (key: string, value: string) => {
      setCosts((rows) => rows.map((row) => (row.key === key ? { ...row, value } : row)));
      scheduleFlush();
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
    (label: string, amount: string, type: CustomFieldType) => {
      const trimmed = label.trim();
      if (trimmed === "") return;
      setCosts((rows) => [
        ...rows,
        // The key only has to be unique until the row is written — the create
        // reads the LABEL, not the key — so a row index cannot collide with one
        // of the standing headings' keys.
        {
          key: `${NEW_ROW_PREFIX}custom:${rows.length}`,
          label: trimmed,
          value: amount,
          isCustom: true,
          type,
        },
      ]);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const removeCost = useCallback(
    (key: string) => {
      setCosts((rows) => rows.filter((row) => row.key !== key));
      if (key.startsWith(NEW_ROW_PREFIX) || !budgetId) return; // never written
      deleteLine.mutate({ id: eventId, bid: budgetId, lid: key, data: {} });
    },
    [budgetId, eventId, deleteLine],
  );

  const addCustomRevenue = useCallback(
    (label: string, amount: string, type: CustomFieldType) => {
      const trimmed = label.trim();
      if (trimmed === "") return;
      setCustomRevenue((rows) => [
        ...rows,
        { id: `${NEW_ROW_PREFIX}${rows.length}`, label: trimmed, value: amount, type },
      ]);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const changeCustomRevenue = useCallback(
    (id: string, value: string) => {
      setCustomRevenue((rows) => rows.map((row) => (row.id === id ? { ...row, value } : row)));
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const removeCustomRevenue = useCallback(
    (id: string) => {
      setCustomRevenue((rows) => rows.filter((row) => row.id !== id));
      if (id.startsWith(NEW_ROW_PREFIX) || !budgetId) return; // never written
      deleteLine.mutate({ id: eventId, bid: budgetId, lid: id, data: {} });
    },
    [budgetId, eventId, deleteLine],
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
          deleteLine.mutate({ id: eventId, bid: budgetId, lid: lineId, data: {} });
        }
      }
      setTiers(drafts.ticketTiers);
      setCosts(drafts.costs);
      setCustomRevenue(drafts.customRevenue);
      setCapacity(drafts.capacity);
      setAverageBarSpend(drafts.averageBarSpend);
      setOtherRevenue(drafts.otherRevenue);
      setProcessingPercent(drafts.processingPercent);
      setProcessingFlatPerTicket(drafts.processingFlatPerTicket);
      scheduleFlush();
    },
    [budgetId, eventId, deleteLine, scheduleFlush],
  );

  const changeCapacity = useCallback(
    (value: string) => {
      setCapacity(value);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const changeAverageBarSpend = useCallback(
    (value: string) => {
      setAverageBarSpend(value);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const changeOtherRevenue = useCallback(
    (value: string) => {
      setOtherRevenue(value);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const changeProcessingPercent = useCallback(
    (value: string) => {
      setProcessingPercent(value);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const changeProcessingFlatPerTicket = useCallback(
    (value: string) => {
      setProcessingFlatPerTicket(value);
      scheduleFlush();
    },
    [scheduleFlush],
  );

  return {
    isPending: budgetsQuery.isPending || participantsQuery.isPending,
    isError: budgetsQuery.isError,
    error: budgetsQuery.error,
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
    isSaving:
      createLine.isPending ||
      updateLine.isPending ||
      deleteLine.isPending ||
      updateBudget.isPending,
    readOnlyReason,
    changeTier,
    addTier,
    removeTier,
    changeCost,
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
 * What a custom row is WORTH, in minor units — its typed figure, multiplied by
 * capacity when it is struck per head.
 *
 * One helper rather than the multiplication repeated at each call site: the
 * projection, the breakdown bars and the CSV all have to agree about what a
 * per-guest row contributes, and three copies of `value x capacity` is three
 * places for one of them to be forgotten.
 */
export function customRowAmount(
  row: { value: string; type?: CustomFieldType },
  capacity: string,
): bigint {
  const perHead = Number(row.value);
  if (!Number.isFinite(perHead)) return 0n;
  if (row.type !== "per_guest") return BigInt(toMinorUnits(row.value));
  const heads = Number(capacity);
  const guests = Number.isFinite(heads) ? Math.trunc(heads) : 0;
  return BigInt(toMinorUnits((perHead * guests).toString()));
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
    customRevenue: editor.customRevenue.map((row) => customRowAmount(row, editor.capacity)),
    costs: editor.costs.map((cost) => customRowAmount(cost, editor.capacity)),
    // Absent rather than a pair of zeroes when the operator has said nothing: the
    // projection then reports `paymentProcessingFees` of 0 because there is no
    // assumption, not because the assumption is that it is free.
    paymentProcessing:
      percentBasisPoints > 0 || flatPerTicket > 0n
        ? { percentBasisPoints, flatPerTicket }
        : undefined,
  };
}
