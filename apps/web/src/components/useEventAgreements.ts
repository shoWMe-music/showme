import {
  type getApiV1EventsIdDeals,
  type getApiV1EventsIdParticipants,
  getGetApiV1EventsIdDealsQueryKey,
  getGetApiV1EventsIdSettlementsQueryKey,
  useGetApiV1EventsIdDeals,
  useGetApiV1EventsIdParticipants,
  usePatchApiV1DealsDid,
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

type Deal = Awaited<ReturnType<typeof getApiV1EventsIdDeals>>["deals"][number];
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
  /**
   * `agreement.confirm` at EVENT scope — sign your own line anywhere on this event.
   * Crew deliberately do not have it; see `dealActionsFor`, which adds the
   * deal-scoped half.
   */
  canConfirm: boolean;
}

export function agreementAuthorityOf(capabilities: readonly string[]): AgreementAuthority {
  return {
    canCompose: capabilities.includes("deal.edit"),
    canManage: capabilities.includes("agreement.manage"),
    canConfirm: capabilities.includes("agreement.confirm"),
  };
}

/** What one deal offers this caller right now. */
export interface DealActions {
  /** A draft has never been put to the other side; only a draft can be sent. */
  canSend: boolean;
  /** There is a line here the caller stands behind and has not yet signed. */
  canConfirm: boolean;
  /** A confirmed agreement can be torn back open for renegotiation. */
  canReopen: boolean;
  /**
   * The FIGURES can still be changed — the deal is not signed yet (QA sweep run 8, QA8-1).
   *
   * Mirrors the server exactly rather than guessing: `PATCH /deals/:id` refuses a signed
   * agreement's terms (`movedSignedTerms` → 409), so offering the control past that point would
   * be offering what the API will refuse. Until then Ran's spec expects it — *"editing offered
   * terms while pending should re-seed the budget"* — and both the deal card and the Budget
   * Planner say the terms can still move.
   */
  canReviseTerms: boolean;
}

/** The event roles whose authority to sign is DEAL-scoped, mirroring `@showme/auth`. */
const DEAL_SCOPED_CONFIRM_ROLES = new Set(["crew", "crew_lead"]);

/**
 * Which lifecycle moves are available on ONE deal, for THIS caller.
 *
 * `canConfirm` is the one that is not answerable from the event's `capabilities`
 * alone. Crew hold no `agreement.confirm` on the event — that capability decides the
 * show's DATE server-side and is nobody's but the act's — yet a crew member NAMED as
 * a signatory party on an agreement may sign that agreement, and must, or a
 * venue↔crew deal could never freeze (`packages/auth/src/presets.ts`,
 * `dealPartyBaselineCapabilities`). The route enforces it; this mirrors it so the
 * button is offered to exactly the callers `POST /deals/:did/confirm` will accept —
 * no dead affordance, and no hidden one either.
 */
export function dealActionsFor(
  deal: Deal,
  authority: AgreementAuthority,
  roster: readonly Participant[] = [],
): DealActions {
  const unsignedOwnLines = deal.parties.filter(
    (party) => party.isYours && party.roleInDeal !== "observer" && party.confirmedAt == null,
  );
  const signsAsDealParty = unsignedOwnLines.some((party) => {
    const participant = roster.find((member) => member.id === party.participantId);
    return participant != null && DEAL_SCOPED_CONFIRM_ROLES.has(participant.role);
  });
  const frozen = deal.agreementStatus === "confirmed" || deal.agreementStatus === "signed";
  return {
    canSend: authority.canManage && deal.agreementStatus === "draft",
    // A draft is not signable: the terms have not been put to anybody yet, and
    // `agreement_status` moves draft → sent → confirmed in that order (#1).
    canConfirm:
      (authority.canConfirm || signsAsDealParty) &&
      deal.agreementStatus === "sent" &&
      unsignedOwnLines.length > 0,
    canReopen: authority.canManage && frozen,
    // `draft` and `sent` both — a draft's figures are obviously editable, and a SENT one is the
    // case the spec is actually about, where parties are looking at terms nobody has signed.
    canReviseTerms: authority.canManage && !frozen && deal.status !== "cancelled",
  };
}

export interface EventAgreements {
  deals: Deal[];
  /**
   * How many of this event's deals this reader may not see — non-zero with an empty
   * `deals` means "not yours to read", not "none exists".
   */
  hiddenDealCount: number;
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
  /** `deal.edit` — revise an existing agreement's FIGURES while it is unsigned (QA8-1). */
  revise: (dealId: string, draft: DealDraft, expectedVersion: number) => Promise<boolean>;
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
  const patchDeal = usePatchApiV1DealsDid();
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

  /**
   * REVISING AN EXISTING DEAL'S MONEY (QA sweep run 8, QA8-1).
   *
   * `PATCH /deals/:id` and the planner's re-seed were already built and correct — Ran's
   * 2026-09-21 spec asks that *"editing offered terms while pending should re-seed the budget,
   * not hold a stale figure"*, and it does. What was missing was any way to call it with the
   * figures: the only caller sent `agreementBodyText` and nothing else, so a deal typed with the
   * wrong guarantee could be neither corrected nor removed.
   *
   * THE MONEY, NOT THE MEMBERSHIP. `UpdateDealBody` has no `parties` field and the only insert
   * into `deal_parties` is the create path, so the party list is write-once at composition — the
   * dialog shows it read-only and says so. Changing it needs a route AND an answer to what
   * happens to an already-signed line, which is §25.6's ninth row.
   *
   * `expectedVersion` rides along (decisions #8): a concurrent edit is a 409 rather than a silent
   * overwrite, and the server already refuses a SIGNED agreement's terms outright
   * (`movedSignedTerms`), which is why the control that opens this is hidden once confirmed.
   */
  const revise = useCallback(
    async (dealId: string, draft: DealDraft, expectedVersion: number): Promise<boolean> => {
      const payload = createDealPayload(draft);
      try {
        await patchDeal.mutateAsync({
          did: dealId,
          data: {
            name: payload.name,
            ...(payload.structure ? { structure: payload.structure } : {}),
            currency: payload.currency,
            ...(payload.guaranteeAmount != null
              ? { guaranteeAmount: payload.guaranteeAmount }
              : {}),
            // `null` CLEARS an advance, where omitting it would leave the old one standing —
            // and "I removed the advance" has to be expressible.
            advanceAmount: payload.advanceAmount ?? null,
            ...(payload.splitBasisPoints != null
              ? { splitBasisPoints: payload.splitBasisPoints }
              : {}),
            paymentTiming: payload.paymentTiming,
            // Same rule: an emptied ladder or bonus must come out, so the key is always sent.
            terms: payload.terms ?? null,
            expectedVersion,
          },
        });
        refresh();
        toast.success(`"${payload.name}" updated. The planner reads the new figures.`);
        return true;
      } catch (error) {
        toast.error(errorMessage(error, "Couldn't update the agreement."));
        return false;
      }
    },
    [patchDeal, refresh, toast],
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
      const deal = (deals.data?.deals ?? []).find((row) => row.id === dealId);
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
    deals: deals.data?.deals ?? [],
    /**
     * How many of this event's deals this reader may not see. Non-zero with an
     * empty list means "not yours to read", which is a different sentence from
     * "none exists" — a co-promoter was told "No deal yet" on a night with a signed
     * one (measured 2026-09-26).
     */
    hiddenDealCount: deals.data?.hiddenCount ?? 0,
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
    revise,
    send,
    confirm,
    reopen,
  };
}
