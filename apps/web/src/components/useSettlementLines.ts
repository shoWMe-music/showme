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
    removeLine,
  };
}
