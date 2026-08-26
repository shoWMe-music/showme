import {
  type getApiV1EventsIdDeals,
  type getApiV1EventsIdParticipants,
  getGetApiV1EventsIdDealsQueryKey,
  getGetApiV1EventsIdSettlementsQueryKey,
  useGetApiV1EventsIdDeals,
  useGetApiV1EventsIdParticipants,
  usePostApiV1DealsDidConfirm,
  usePostApiV1DealsDidReopen,
  usePostApiV1DealsDidSend,
  usePostApiV1EventsIdDeals,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { type CreateDealPayload, type DealDraft, createDealPayload } from "@showme/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { errorMessage } from "../lib/errors";

type Deal = Awaited<ReturnType<typeof getApiV1EventsIdDeals>>[number];
type Participant = Awaited<ReturnType<typeof getApiV1EventsIdParticipants>>[number];

/**
 * The AGREEMENT lifecycle, from the event workspace.
 *
 * The whole of it — create, send, confirm, reopen — has existed server-side since
 * `apps/api/src/routes/deals.ts` was written, and nothing in the browser had ever
 * called any of it. The Agreement tab read `GET /events/:id/deals`, found an empty
 * list because no code path could ever have filled it, and rendered "No agreement
 * yet" as a permanent state. That is what the operator meant by "no data is
 * migrating anywhere": there was nothing to migrate, because there was no door in.
 *
 * Three rules this hook keeps rather than re-implements:
 *
 * 1. **Visibility is the server's.** `GET /events/:id/deals` returns only the
 *    deals the caller is a party to, and on each only the lines they stand behind
 *    (`serializeDeal`, decisions #4). Nothing here filters anything — a screen
 *    that hid rows would be the client-side hiding the serializer exists to
 *    replace, and a screen that trusted the list to be complete would be right.
 * 2. **Confirmation is per-party.** `POST /deals/:did/confirm` stamps the
 *    CALLER'S own lines and no others; there is no parameter for whose line to
 *    sign, and so there is no control here for signing on another party's behalf.
 *    The button reads "Confirm your line" because that is exactly what it does.
 * 3. **Authority is read, not guessed.** Every action is offered only when the
 *    event's own `capabilities` carry the capability its route requires, so an
 *    agent (who holds `deal.edit` and `agreement.manage` but not `event.edit`)
 *    gets the same controls a host does, and a performer gets only Confirm.
 */

/** What the caller may do with agreements on this event, straight off `capabilities`. */
export interface AgreementAuthority {
  /** `deal.edit` — compose a new agreement (operators; agents, for their acts). */
  canCompose: boolean;
  /** `agreement.manage` — send a draft out, and reopen a confirmed one. */
  canManage: boolean;
  /** `agreement.confirm` — sign your own line. */
  canConfirm: boolean;
}

export function agreementAuthorityOf(capabilities: readonly string[]): AgreementAuthority {
  return {
    canCompose: capabilities.includes("deal.edit"),
    canManage: capabilities.includes("agreement.manage"),
    canConfirm: capabilities.includes("agreement.confirm"),
  };
}

/** Which lifecycle moves are available on ONE deal, for THIS caller. */
export interface DealActions {
  /** A draft has never been put to the other side; only a draft can be sent. */
  canSend: boolean;
  /** There is a line here the caller stands behind and has not yet signed. */
  canConfirm: boolean;
  /** A confirmed agreement can be torn back open for renegotiation. */
  canReopen: boolean;
}

export function dealActionsFor(deal: Deal, authority: AgreementAuthority): DealActions {
  const unsignedOwnLine = deal.parties.some(
    (party) => party.isYours && party.roleInDeal !== "observer" && party.confirmedAt == null,
  );
  const frozen = deal.agreementStatus === "confirmed" || deal.agreementStatus === "signed";
  return {
    canSend: authority.canManage && deal.agreementStatus === "draft",
    // A draft is not signable: the terms have not been put to anybody yet, and
    // `agreement_status` moves draft → sent → confirmed in that order (#1).
    canConfirm: authority.canConfirm && deal.agreementStatus === "sent" && unsignedOwnLine,
    canReopen: authority.canManage && frozen,
  };
}

export interface EventAgreements {
  deals: Deal[];
  roster: Participant[];
  /** Participants whose event role is `agent` — never an entitled party (#14). */
  agentParticipantIds: string[];
  isPending: boolean;
  isError: boolean;
  error: unknown;
  authority: AgreementAuthority;
  /** True while any lifecycle call is in flight — the whole strip disables together. */
  isBusy: boolean;
  /** The deal id a lifecycle call is currently running against, or null. */
  busyDealId: string | null;
  compose: (draft: DealDraft) => Promise<boolean>;
  send: (dealId: string) => void;
  confirm: (dealId: string) => void;
  reopen: (dealId: string, reason: string) => void;
}

export function useEventAgreements(
  eventId: string,
  capabilities: readonly string[],
): EventAgreements {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [busyDealId, setBusyDealId] = useState<string | null>(null);

  const deals = useGetApiV1EventsIdDeals(eventId);
  const participants = useGetApiV1EventsIdParticipants(eventId);

  // A confirmed line changes what the settlement is entitled to reconcile, so both
  // reads are refreshed together — the Settlement tab must never show figures
  // derived from terms the Agreement tab has already moved past.
  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getGetApiV1EventsIdDealsQueryKey(eventId) });
    queryClient.invalidateQueries({ queryKey: getGetApiV1EventsIdSettlementsQueryKey(eventId) });
  }, [queryClient, eventId]);

  const createDeal = usePostApiV1EventsIdDeals();
  const sendDeal = usePostApiV1DealsDidSend();
  const confirmDeal = usePostApiV1DealsDidConfirm();
  const reopenDeal = usePostApiV1DealsDidReopen();

  const compose = useCallback(
    async (draft: DealDraft): Promise<boolean> => {
      const payload: CreateDealPayload = createDealPayload(draft);
      try {
        await createDeal.mutateAsync({ id: eventId, data: payload });
        refresh();
        toast.success(`"${payload.name}" saved as a draft agreement.`);
        return true;
      } catch (error) {
        toast.error(errorMessage(error, "Couldn't create the agreement."));
        return false;
      }
    },
    [createDeal, eventId, refresh, toast],
  );

  const send = useCallback(
    (dealId: string) => {
      setBusyDealId(dealId);
      sendDeal.mutate(
        { did: dealId },
        {
          onSuccess: (deal) => {
            refresh();
            toast.success(`"${deal.name}" is with its parties for confirmation.`);
          },
          onError: (error) => toast.error(errorMessage(error, "Couldn't send the agreement.")),
          onSettled: () => setBusyDealId(null),
        },
      );
    },
    [sendDeal, refresh, toast],
  );

  const confirm = useCallback(
    (dealId: string) => {
      setBusyDealId(dealId);
      confirmDeal.mutate(
        { did: dealId },
        {
          onSuccess: (deal) => {
            refresh();
            // The rollup is the server's: the terms freeze only once EVERY
            // non-observer party has signed (#1). Saying so is the difference
            // between "you signed" and "it is done".
            toast.success(
              deal.agreementStatus === "confirmed"
                ? `Every party has confirmed. "${deal.name}" is frozen.`
                : "Your line is confirmed. Waiting on the other parties.",
            );
          },
          onError: (error) => toast.error(errorMessage(error, "Couldn't confirm your line.")),
          onSettled: () => setBusyDealId(null),
        },
      );
    },
    [confirmDeal, refresh, toast],
  );

  const reopen = useCallback(
    (dealId: string, reason: string) => {
      setBusyDealId(dealId);
      const deal = (deals.data ?? []).find((row) => row.id === dealId);
      reopenDeal.mutate(
        {
          did: dealId,
          // Version-locked (decisions #8): reopening tears up signatures, so it
          // must not land on terms that moved while the dialog was open.
          data: { reason, ...(deal ? { expectedVersion: deal.version } : {}) },
        },
        {
          onSuccess: () => {
            refresh();
            toast.success("Reopened. Every confirmation on it has been cleared.");
          },
          onError: (error) => toast.error(errorMessage(error, "Couldn't reopen the agreement.")),
          onSettled: () => setBusyDealId(null),
        },
      );
    },
    [reopenDeal, deals.data, refresh, toast],
  );

  const roster = participants.data ?? [];

  return {
    deals: deals.data ?? [],
    roster,
    agentParticipantIds: roster.filter((party) => party.role === "agent").map((party) => party.id),
    isPending: deals.isPending || participants.isPending,
    isError: deals.isError,
    error: deals.error,
    authority: agreementAuthorityOf(capabilities),
    isBusy:
      createDeal.isPending || sendDeal.isPending || confirmDeal.isPending || reopenDeal.isPending,
    busyDealId,
    compose,
    send,
    confirm,
    reopen,
  };
}
