import {
  type getApiV1EventsIdSettlements,
  getGetApiV1EventsIdSettlementsQueryKey,
  useGetApiV1EventsIdSettlements,
  usePatchApiV1EventsIdTransfersTid,
  usePostApiV1EventsIdSettlementCompute,
  usePostApiV1EventsIdSettlementFinalize,
  usePostApiV1EventsIdSettlementsSidConfirm,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { errorMessage } from "../lib/errors";

type Settlements = Awaited<ReturnType<typeof getApiV1EventsIdSettlements>>;
type SettlementRow = Settlements["settlements"][number];
type TransferRow = Settlements["transfers"][number];

/** The settlement statuses at which the figures are frozen (`LOCKED_SETTLEMENT_STATUSES`). */
const FROZEN_STATUSES = new Set(["finalized", "revised", "partly_paid", "paid", "concluded"]);

/** What the caller may do with this event's settlement, straight off `capabilities`. */
export interface SettlementAuthority {
  /** `settlement.edit` — run the reconciliation. */
  canCompute: boolean;
  /** `settlement.finalize` — freeze the figures and LOCK the exchange rates. */
  canFinalize: boolean;
  /** `settlement.confirm` — sign off your own line. */
  canConfirm: boolean;
}

export function settlementAuthorityOf(capabilities: readonly string[]): SettlementAuthority {
  return {
    canCompute: capabilities.includes("settlement.edit"),
    canFinalize: capabilities.includes("settlement.finalize"),
    canConfirm: capabilities.includes("settlement.confirm"),
  };
}

export interface EventSettlement {
  settlements: SettlementRow[];
  transfers: TransferRow[];
  /** Private agent↔performer commissions — only ever the two parties' own (#14). */
  commissions: Settlements["commissions"];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  authority: SettlementAuthority;
  /** True once the reconciliation has been run at least once on this event. */
  isComputed: boolean;
  /** True once the figures are frozen — no recompute, no second finalize. */
  isFinalized: boolean;
  isBusy: boolean;
  compute: () => void;
  finalize: () => void;
  confirmOwn: (settlementId: string) => void;
  markTransfer: (transferId: string, state: "owed" | "paid" | "handled") => void;
}

/**
 * The settlement, from the event workspace.
 *
 * `POST /events/:id/settlement/compute` had no caller anywhere in the browser, so
 * `GET …/settlements` returned nothing on every event and the tab showed "Nothing
 * settled yet" as a permanent state — the same defect as the Agreement tab, one
 * step later in the same story.
 *
 * Finalize is the one action here that cannot be taken back. It freezes an
 * immutable snapshot and **locks the exchange rates** that produced it
 * (money.md), and there is no un-finalize — not in this screen and not in the
 * API. It is therefore offered only to a caller holding `settlement.finalize`,
 * only once figures exist to freeze, and only behind a dialog that says so. The
 * server refuses it a second time (409) and refuses it at all if a budget line,
 * a deal or a rate has moved since the last compute, so the rates locked and the
 * figures frozen always agree.
 */
export function useEventSettlement(
  eventId: string,
  capabilities: readonly string[],
): EventSettlement {
  const queryClient = useQueryClient();
  const toast = useToast();
  const settlements = useGetApiV1EventsIdSettlements(eventId);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetApiV1EventsIdSettlementsQueryKey(eventId) });
  }, [queryClient, eventId]);

  const computeSettlement = usePostApiV1EventsIdSettlementCompute();
  const finalizeSettlement = usePostApiV1EventsIdSettlementFinalize();
  const confirmSettlement = usePostApiV1EventsIdSettlementsSidConfirm();
  const patchTransfer = usePatchApiV1EventsIdTransfersTid();

  const compute = useCallback(() => {
    computeSettlement.mutate(
      { id: eventId },
      {
        onSuccess: (summary) => {
          refresh();
          toast.success(
            `Reconciled ${summary.breakdowns.length} parties into ${summary.transfers.length} transfers.`,
          );
        },
        // The API's refusals here are diagnostic on purpose (audit A-14 names the
        // offending budget line), so the message is shown rather than replaced.
        onError: (error) => toast.error(errorMessage(error, "Couldn't run the settlement.")),
      },
    );
  }, [computeSettlement, eventId, refresh, toast]);

  const finalize = useCallback(() => {
    finalizeSettlement.mutate(
      { id: eventId },
      {
        onSuccess: () => {
          refresh();
          toast.success("Settlement finalized. The figures and exchange rates are locked.");
        },
        onError: (error) => toast.error(errorMessage(error, "Couldn't finalize the settlement.")),
      },
    );
  }, [finalizeSettlement, eventId, refresh, toast]);

  const confirmOwn = useCallback(
    (settlementId: string) => {
      confirmSettlement.mutate(
        { id: eventId, sid: settlementId },
        {
          onSuccess: () => {
            refresh();
            toast.success("You have signed off on your settlement.");
          },
          onError: (error) => toast.error(errorMessage(error, "Couldn't record your sign-off.")),
        },
      );
    },
    [confirmSettlement, eventId, refresh, toast],
  );

  const markTransfer = useCallback(
    (transferId: string, state: "owed" | "paid" | "handled") => {
      const transfer = (settlements.data?.transfers ?? []).find((row) => row.id === transferId);
      patchTransfer.mutate(
        {
          id: eventId,
          tid: transferId,
          // Version-locked (decisions #8): two people settling the same night must
          // not overwrite each other's record of what was paid.
          data: {
            state,
            ...(transfer?.version != null ? { expectedVersion: transfer.version } : {}),
          },
        },
        {
          onSuccess: () => refresh(),
          onError: (error) => toast.error(errorMessage(error, "Couldn't update the transfer.")),
        },
      );
    },
    [patchTransfer, settlements.data, eventId, refresh, toast],
  );

  const rows = settlements.data?.settlements ?? [];

  return {
    settlements: rows,
    transfers: settlements.data?.transfers ?? [],
    commissions: settlements.data?.commissions ?? [],
    isPending: settlements.isPending,
    isError: settlements.isError,
    error: settlements.error,
    authority: settlementAuthorityOf(capabilities),
    isComputed: rows.some((row) => row.computed != null),
    isFinalized: rows.some((row) => FROZEN_STATUSES.has(row.status)),
    isBusy:
      computeSettlement.isPending ||
      finalizeSettlement.isPending ||
      confirmSettlement.isPending ||
      patchTransfer.isPending,
    compute,
    finalize,
    confirmOwn,
    markTransfer,
  };
}
