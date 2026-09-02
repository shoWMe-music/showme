import {
  getGetApiV1EventsIdSettlementLinesQueryOptions,
  getGetApiV1EventsIdSettlementPlannedVsActualQueryOptions,
  getGetApiV1EventsIdSettlementsQueryOptions,
  useDeleteApiV1EventsIdSettlementLinesLid,
  useGetApiV1EventsIdParticipants,
  useGetApiV1EventsIdSettlementLines,
  usePatchApiV1EventsIdSettlementLinesLid,
  usePostApiV1EventsIdSettlementLines,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { majorToMinor, minorToDecimalString } from "@showme/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { errorMessage } from "../lib/errors";

/**
 * THE SETTLEMENT'S OWN LINES — what the night actually took and cost.
 *
 * The settlement holds a copy of the budget and the budget is never changed from
 * the settlement (the product owner, 2026-08-27). So this hook writes only to
 * `settlement_lines`: correcting a figure here restates what happened, and leaves
 * the forecast standing as the forecast. That separation is the whole point —
 * before it, typing an actual cost overwrote the estimate it was meant to be
 * compared against.
 *
 * Every mutation invalidates the settlement and the planned-vs-actual comparison
 * as well as the lines, because all three are readings of the same money and a
 * screen showing a new cost beside an old pool is a screen that has lied once.
 *
 * The FIGURES ARE NOT RECOMPUTED here. Editing a line changes what the next
 * `Recalculate` will settle; it does not silently restate a settlement parties
 * may already be reviewing. The screen says so, and the operator presses the
 * button.
 */
export interface SettlementLineRow {
  id: string;
  kind: "revenue" | "cost";
  label: string;
  /** Major units, for the input — e.g. "1800.00". */
  amount: string;
  paidBy: string | null;
  collectedBy: string | null;
  /** Null when this line was never budgeted — it was first entered here. */
  originBudgetLineId: string | null;
  /**
   * HOW THE FIGURE WAS REACHED — 168 tickets at 250, rather than just 42 000.
   *
   * Null on a line somebody typed a lump sum into, which is a real and common
   * answer: a broken window has no unit price. Present on anything the planner
   * multiplied out, and now editable here, which is the point — restating a
   * ticket line after the show means correcting the COUNT.
   *
   * `unitAmount` is major units to match `amount`, so the whole row is in the
   * one unit the operator is typing in and nothing converts twice.
   */
  details: { basis: string; unitAmount: string; quantity: number } | null;
  version: number;
}

export interface SettlementLinesEditor {
  lines: SettlementLineRow[];
  revenue: SettlementLineRow[];
  costs: SettlementLineRow[];
  /** Who can hold or front cash on this event, for the attribution selects. */
  participants: { id: string; name: string }[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  isBusy: boolean;
  addLine: (kind: "revenue" | "cost", label: string, amount: string, party: string) => void;
  updateLine: (row: SettlementLineRow, patch: Partial<SettlementLineRow>) => void;
  /**
   * Restate a counted line: a new quantity and/or unit price, with `amount`
   * recomputed from the two.
   *
   * Separate from `updateLine` because the arithmetic has to happen in ONE place.
   * A caller that could send a quantity and an amount independently could send a
   * row saying "168 @ 250 = 65 000", and the settlement would settle the 65 000
   * while every reader believed the multiplication.
   */
  updateBreakdown: (
    row: SettlementLineRow,
    next: { unitAmount?: string; quantity?: number },
  ) => void;
  /**
   * A ticket type the plan never had — a walk-up tier opened on the night, a
   * guest allocation sold late. Counted from the start, so it can be restated
   * the same way every other tier is.
   */
  addTicketTier: (name: string, unitAmount: string, quantity: number, party: string) => void;
  removeLine: (row: SettlementLineRow) => void;
}

export function useSettlementLines(eventId: string, currency: string): SettlementLinesEditor {
  const queryClient = useQueryClient();
  const toast = useToast();
  const lines = useGetApiV1EventsIdSettlementLines(eventId);
  const participants = useGetApiV1EventsIdParticipants(eventId);

  const createLine = usePostApiV1EventsIdSettlementLines();
  const patchLine = usePatchApiV1EventsIdSettlementLinesLid();
  const deleteLine = useDeleteApiV1EventsIdSettlementLinesLid();

  const refresh = useCallback(() => {
    for (const options of [
      getGetApiV1EventsIdSettlementLinesQueryOptions(eventId),
      getGetApiV1EventsIdSettlementPlannedVsActualQueryOptions(eventId),
      getGetApiV1EventsIdSettlementsQueryOptions(eventId),
    ]) {
      queryClient.invalidateQueries({ queryKey: options.queryKey });
    }
  }, [queryClient, eventId]);

  const rows: SettlementLineRow[] = (lines.data ?? []).map((line) => ({
    id: line.id,
    kind: line.kind === "revenue" ? "revenue" : "cost",
    label: line.label,
    amount: minorToDecimalString({ amount: BigInt(line.amount), currency }),
    paidBy: line.paidBy,
    collectedBy: line.collectedBy,
    originBudgetLineId: line.originBudgetLineId,
    details: line.details
      ? {
          // Optional on the wire because the server schema defaults it; a line
          // that arrives without one is a ticket tier, which is what the default
          // says on the other side too.
          basis: line.details.basis ?? "ticket_tier",
          unitAmount: minorToDecimalString({
            amount: BigInt(line.details.unitAmount),
            currency,
          }),
          quantity: line.details.quantity,
        }
      : null,
    version: line.version,
  }));

  const addLine = useCallback(
    (kind: "revenue" | "cost", label: string, amount: string, party: string) => {
      createLine.mutate(
        {
          id: eventId,
          data: {
            kind,
            label,
            amount: majorToMinor(amount, currency).toString(),
            // Revenue is held by whoever took it; a cost is owed by whoever
            // fronted it. The engine refuses a line that names nobody (audit
            // A-14), so the picker is required rather than optional.
            ...(kind === "revenue" ? { collectedBy: party } : { paidBy: party }),
          },
        },
        {
          onSuccess: () => {
            refresh();
            toast.success(`Added “${label}”. Recalculate to settle it.`);
          },
          onError: (error) => toast.error(errorMessage(error, "Couldn't add that line.")),
        },
      );
    },
    [createLine, eventId, currency, refresh, toast],
  );

  const updateLine = useCallback(
    (row: SettlementLineRow, patch: Partial<SettlementLineRow>) => {
      patchLine.mutate(
        {
          id: eventId,
          lid: row.id,
          data: {
            ...(patch.label !== undefined ? { label: patch.label } : {}),
            ...(patch.amount !== undefined
              ? { amount: majorToMinor(patch.amount, currency).toString() }
              : {}),
            ...(patch.paidBy !== undefined ? { paidBy: patch.paidBy } : {}),
            ...(patch.collectedBy !== undefined ? { collectedBy: patch.collectedBy } : {}),
            // Optimistic lock (decisions #8): two people restating the same night
            // must not silently overwrite one another.
            expectedVersion: row.version,
          },
        },
        {
          onSuccess: () => refresh(),
          onError: (error) => toast.error(errorMessage(error, "Couldn't save that change.")),
        },
      );
    },
    [patchLine, eventId, currency, refresh, toast],
  );

  /**
   * THE COUNT CHANGED, SO THE AMOUNT DOES — one write, one multiplication.
   *
   * `amount` stays the authoritative figure the engine settles (`money.md`), so
   * it is recomputed here from unit × quantity rather than left for the operator
   * to work out. Both go in the same PATCH under the same optimistic lock, which
   * is what stops a row ever existing that says "168 @ 250" beside a total that
   * is not 42 000.
   *
   * Minor units throughout the arithmetic: `majorToMinor` first, multiply as
   * BigInt, and no float ever touches money.
   */
  const updateBreakdown = useCallback(
    (row: SettlementLineRow, next: { unitAmount?: string; quantity?: number }) => {
      const unitAmount = next.unitAmount ?? row.details?.unitAmount ?? row.amount;
      const quantity = next.quantity ?? row.details?.quantity ?? 1;
      const unitMinor = majorToMinor(unitAmount, currency);
      patchLine.mutate(
        {
          id: eventId,
          lid: row.id,
          data: {
            amount: (unitMinor * BigInt(quantity)).toString(),
            details: {
              // Preserve what kind of multiplication this was; only the planner
              // decides that, and a restatement must not reclassify the line.
              basis: (row.details?.basis ?? "ticket_tier") as "ticket_tier",
              unitAmount: unitMinor.toString(),
              quantity,
            },
            expectedVersion: row.version,
          },
        },
        {
          onSuccess: () => refresh(),
          onError: (error) => toast.error(errorMessage(error, "Couldn't save that change.")),
        },
      );
    },
    [patchLine, eventId, currency, refresh, toast],
  );

  const addTicketTier = useCallback(
    (name: string, unitAmount: string, quantity: number, party: string) => {
      const unitMinor = majorToMinor(unitAmount, currency);
      createLine.mutate(
        {
          id: eventId,
          data: {
            kind: "revenue",
            label: name,
            amount: (unitMinor * BigInt(quantity)).toString(),
            collectedBy: party,
            details: { basis: "ticket_tier", unitAmount: unitMinor.toString(), quantity },
          },
        },
        {
          onSuccess: () => {
            refresh();
            toast.success(`Added “${name}”. Recalculate to settle it.`);
          },
          onError: (error) => toast.error(errorMessage(error, "Couldn't add that ticket type.")),
        },
      );
    },
    [createLine, eventId, currency, refresh, toast],
  );

  const removeLine = useCallback(
    (row: SettlementLineRow) => {
      deleteLine.mutate(
        { id: eventId, lid: row.id },
        {
          onSuccess: () => {
            refresh();
            toast.success(`Removed “${row.label}”. Recalculate to settle it.`);
          },
          onError: (error) => toast.error(errorMessage(error, "Couldn't remove that line.")),
        },
      );
    },
    [deleteLine, eventId, refresh, toast],
  );

  return {
    lines: rows,
    revenue: rows.filter((row) => row.kind === "revenue"),
    costs: rows.filter((row) => row.kind === "cost"),
    participants: (participants.data ?? []).map((party) => ({
      id: party.id,
      name: party.name ?? party.performerTag ?? party.role,
    })),
    isPending: lines.isPending,
    isError: lines.isError,
    error: lines.error,
    isBusy: createLine.isPending || patchLine.isPending || deleteLine.isPending,
    addLine,
    updateLine,
    updateBreakdown,
    addTicketTier,
    removeLine,
  };
}
