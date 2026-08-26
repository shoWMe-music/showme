import {
  type getApiV1EventsIdBudgets,
  getGetApiV1EventsIdBudgetsQueryKey,
  useDeleteApiV1EventsIdBudgetsBidLinesLid,
  useGetApiV1EventsIdBudgets,
  useGetApiV1EventsIdParticipants,
  usePatchApiV1EventsIdBudgetsBidLinesLid,
  usePostApiV1EventsIdBudgetsBidLines,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getActiveProfileId } from "../lib/activeProfile";
import { errorMessage } from "../lib/errors";

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
}

/**
 * The standing cost headings a promoter budgets against. They exist as ROWS in
 * the planner before they exist as lines in the database: a heading only becomes
 * a `budget_lines` row once it is given a figure, so an untouched budget stays
 * genuinely empty rather than carrying six zero-value lines nobody entered.
 */
const STANDARD_COST_HEADINGS = [
  "Artist fees",
  "Production",
  "Marketing",
  "Staffing",
  "Venue",
  "Other",
] as const;

const NEW_ROW_PREFIX = "new:";
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

function numeric(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
  /** True while a debounced write is queued or in flight. */
  isSaving: boolean;
  /** Set when the budget cannot be written to — the reason is shown, not hidden. */
  readOnlyReason: string | null;
  changeTier: (id: string, field: "name" | "price" | "quantity", value: string) => void;
  addTier: () => void;
  removeTier: (id: string) => void;
  changeCost: (key: string, value: string) => void;
  changeCapacity: (value: string) => void;
  changeAverageBarSpend: (value: string) => void;
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
export function useBudgetEditor(eventId: string): BudgetEditor {
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
  const createLine = usePostApiV1EventsIdBudgetsBidLines(mutationOptions);
  const updateLine = usePatchApiV1EventsIdBudgetsBidLinesLid(mutationOptions);
  const deleteLine = useDeleteApiV1EventsIdBudgetsBidLinesLid(mutationOptions);

  // ---- server → draft -----------------------------------------------------
  const lines = useMemo(() => budget?.lines ?? [], [budget]);

  const serverTiers = useMemo<TicketTierDraft[]>(
    () =>
      lines
        .filter((line) => line.kind === "revenue" && line.details?.basis !== "bar_spend")
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

  const serverCosts = useMemo<CostDraft[]>(() => {
    const costLines = lines.filter((line) => line.kind === "cost");
    const byHeading = new Map(costLines.map((line) => [line.label, line]));
    const standard = STANDARD_COST_HEADINGS.map((heading) => {
      const line = byHeading.get(heading);
      return {
        key: line ? line.id : `${NEW_ROW_PREFIX}${heading}`,
        label: heading,
        value: line ? toMajorUnits(line.amount) : "",
      };
    });
    // Anything budgeted under a heading of the operator's own is kept too —
    // dropping it would make a real line invisible and un-editable.
    const custom = costLines
      .filter((line) => !STANDARD_COST_HEADINGS.includes(line.label as never))
      .map((line) => ({ key: line.id, label: line.label, value: toMajorUnits(line.amount) }));
    return [...standard, ...custom];
  }, [lines]);

  /**
   * Everything the draft is seeded from, in one value. Grouping it means the
   * re-seed effect below has exactly one dependency, and that dependency changes
   * only when the server's picture of this budget actually changes.
   */
  const seed = useMemo(
    () => ({
      budgetId,
      tiers: serverTiers,
      costs: serverCosts,
      capacity: barLine?.details ? barLine.details.quantity.toString() : "",
      averageBarSpend: barLine?.details ? toMajorUnits(barLine.details.unitAmount) : "",
    }),
    [budgetId, serverTiers, serverCosts, barLine],
  );

  const [tiers, setTiers] = useState<TicketTierDraft[]>(seed.tiers);
  const [costs, setCosts] = useState<CostDraft[]>(seed.costs);
  const [capacity, setCapacity] = useState(seed.capacity);
  const [averageBarSpend, setAverageBarSpend] = useState(seed.averageBarSpend);

  // Re-seed from the server only while the person is not mid-edit, so a
  // background refetch cannot yank a half-typed figure out from under them.
  const pendingRef = useRef(false);
  useEffect(() => {
    if (pendingRef.current) return;
    setTiers(seed.tiers);
    setCosts(seed.costs);
    setCapacity(seed.capacity);
    setAverageBarSpend(seed.averageBarSpend);
  }, [seed]);

  // ---- draft → server -----------------------------------------------------
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => void>(() => {});

  const readOnlyReason = !budgetId
    ? "This event has no budget yet."
    : !myParticipantId
      ? "Your profile is not a participant on this event, so budget lines cannot be attributed to it."
      : null;

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
      if (cost.key.startsWith(NEW_ROW_PREFIX)) {
        if (typed === "") continue; // a heading with no figure stays a heading
        createLine.mutate({
          ...target,
          data: {
            kind: "cost",
            label: cost.label,
            amount: toMinorUnits(typed),
            paidBy: myParticipantId,
          },
        });
        continue;
      }
      const before = lines.find((line) => line.id === cost.key);
      if (!before) continue;
      const amount = toMinorUnits(typed === "" ? "0" : typed);
      if (before.amount === amount) continue;
      updateLine.mutate({ ...target, lid: cost.key, data: { amount } });
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
    setTiers((rows) => [
      ...rows,
      // Empty, not "0": a tier nobody has priced yet has no price, and a
      // pre-filled zero is three characters the operator must delete before
      // they can type. `numeric()` reads "" as 0 for the running totals, so
      // the KPI band still adds up while the fields stay blank.
      { id: `${NEW_ROW_PREFIX}${rows.length}`, name: "", price: "", quantity: "" },
    ]);
  }, []);

  const removeTier = useCallback(
    (id: string) => {
      setTiers((rows) => rows.filter((row) => row.id !== id));
      if (id.startsWith(NEW_ROW_PREFIX) || !budgetId) return; // never written, nothing to delete
      deleteLine.mutate({ id: eventId, bid: budgetId, lid: id, data: {} });
    },
    [budgetId, eventId, deleteLine],
  );

  const changeCost = useCallback(
    (key: string, value: string) => {
      setCosts((rows) => rows.map((row) => (row.key === key ? { ...row, value } : row)));
      scheduleFlush();
    },
    [scheduleFlush],
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
    isSaving: createLine.isPending || updateLine.isPending || deleteLine.isPending,
    readOnlyReason,
    changeTier,
    addTier,
    removeTier,
    changeCost,
    changeCapacity,
    changeAverageBarSpend,
  };
}
