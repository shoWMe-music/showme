import {
  customFetch,
  getGetApiV1EventsQueryKey,
  usePostApiV1BookingRequestsIdFlagSpam,
} from "@showme/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { RequestItem } from "../hooks/useRequestInbox";
import { errorMessage } from "../lib/errors";

/**
 * The five triage actions on an incoming request (§8's fixed action set), plus
 * the way back out of the two that hide a request. Each one is a real call:
 *
 * | Action        | Route                                        |
 * | ------------- | -------------------------------------------- |
 * | Create Draft  | `POST /booking-requests/:id/draft-event`     |
 * | Make Offer    | `POST /booking-requests/:id/counter-offer`   |
 * | Decline       | `PATCH /booking-requests/:id` → `declined`   |
 * | Block         | `POST /booking-requests/:id/flag-spam`       |
 * | Archive       | `PATCH /booking-requests/:id` → `archived`   |
 * | Restore       | `PATCH /booking-requests/:id` → `pending`    |
 *
 * The two new routes are called through `customFetch` — the same client every
 * generated hook runs on (auth header, acting profile, typed error envelope) —
 * because the generated bindings are regenerated from the OpenAPI document as a
 * separate step. Swap these two for the generated hooks the next time
 * `@showme/api-client` is regenerated; nothing else about the flow changes.
 */
export type RequestTriageAction = "draft" | "offer" | "decline" | "block" | "archive" | "restore";

/** The statuses a recipient may set (`UpdateStatusBody` in `routes/inbound.ts`). */
type RequestStatusUpdate = "pending" | "accepted" | "declined" | "archived" | "flagged";

/** The API's `POST /booking-requests/:id/draft-event` response. */
export interface DraftEventResult {
  requestId: string;
  eventId: string;
  title: string;
  eventDate: string | null;
  baseCurrency: string;
  status: string;
  eventCap: {
    allowed: boolean;
    used: number | null;
    limit: number | null;
    chargedAtConfirm: true;
  };
}

/** The API's `POST /booking-requests/:id/counter-offer` response. */
export interface CounterOfferResult {
  requestId: string;
  channel: "notification" | "email" | "none";
  deliveredTo: string | null;
  delivered: boolean;
}

/** Major units as typed by a human → the minor-unit string the API takes (money.md). */
function toMinorUnits(typed: string): string | undefined {
  const cleaned = typed.replace(/[\s,]/g, "");
  if (!cleaned) return undefined;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  return String(Math.round(amount * 100));
}

export interface RequestTriage {
  /** The action being confirmed, or null when no dialog is open. */
  action: RequestTriageAction | null;
  request: RequestItem | null;
  /** The counter-offer composer. */
  message: string;
  setMessage: (value: string) => void;
  feeMinimum: string;
  setFeeMinimum: (value: string) => void;
  feeMaximum: string;
  setFeeMaximum: (value: string) => void;
  offeredDate: string;
  setOfferedDate: (value: string) => void;
  /** The draft-event form. */
  draftTitle: string;
  setDraftTitle: (value: string) => void;
  draftDate: string;
  setDraftDate: (value: string) => void;
  draftCurrency: string;
  setDraftCurrency: (value: string) => void;
  /** A refusal from the API, kept on screen next to the values that caused it. */
  refusal: string | null;
  pending: boolean;
  /** What the draft flow produced, so the dialog can report the plan consequence. */
  draftResult: DraftEventResult | null;
  counterResult: CounterOfferResult | null;
  open: (action: RequestTriageAction, request: RequestItem) => void;
  close: () => void;
  confirm: () => void;
  handlers: {
    onCreateDraft: (id: string) => void;
    onMakeOffer: (id: string) => void;
    onDecline: (id: string) => void;
    onBlock: (id: string) => void;
    onArchive: (id: string) => void;
    onRestore: (id: string) => void;
  };
}

export interface UseRequestTriageOptions {
  /** The inbox this triage acts on — the id from a card is looked up here. */
  requests: RequestItem[];
  /** Re-read the inbox once the server has answered. */
  refetch: () => void;
  onSuccess: (message: string) => void;
}

export function useRequestTriage({
  requests,
  refetch,
  onSuccess,
}: UseRequestTriageOptions): RequestTriage {
  const [action, setAction] = useState<RequestTriageAction | null>(null);
  const [request, setRequest] = useState<RequestItem | null>(null);
  const [message, setMessage] = useState("");
  const [feeMinimum, setFeeMinimum] = useState("");
  const [feeMaximum, setFeeMaximum] = useState("");
  const [offeredDate, setOfferedDate] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDate, setDraftDate] = useState("");
  const [draftCurrency, setDraftCurrency] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [draftResult, setDraftResult] = useState<DraftEventResult | null>(null);
  const [counterResult, setCounterResult] = useState<CounterOfferResult | null>(null);

  const queryClient = useQueryClient();
  const flagSpam = usePostApiV1BookingRequestsIdFlagSpam();

  // Not the generated `usePatchApiV1BookingRequestsId`: its body type is built
  // from the OpenAPI document as it stood before `pending` (Restore) joined the
  // accepted statuses, so the generated union would reject the one value the undo
  // path needs. Same endpoint, same client — only the typing is ours until
  // `@showme/api-client` is regenerated.
  const updateStatus = useMutation({
    mutationFn: (variables: { id: string; status: RequestStatusUpdate }) =>
      customFetch<{ id: string; status: string }>({
        url: `/api/v1/booking-requests/${variables.id}`,
        method: "PATCH",
        data: { status: variables.status },
      }),
  });

  const createDraftEvent = useMutation({
    mutationFn: (variables: {
      id: string;
      data: { title?: string; eventDate?: string; baseCurrency?: string };
    }) =>
      customFetch<DraftEventResult>({
        url: `/api/v1/booking-requests/${variables.id}/draft-event`,
        method: "POST",
        data: variables.data,
      }),
  });

  const sendCounterOffer = useMutation({
    mutationFn: (variables: {
      id: string;
      data: {
        message: string;
        wantedDate?: string;
        offerFeeMin?: string;
        offerFeeMax?: string;
      };
    }) =>
      customFetch<CounterOfferResult>({
        url: `/api/v1/booking-requests/${variables.id}/counter-offer`,
        method: "POST",
        data: variables.data,
      }),
  });

  const pending =
    updateStatus.isPending ||
    flagSpam.isPending ||
    createDraftEvent.isPending ||
    sendCounterOffer.isPending;

  function open(nextAction: RequestTriageAction, nextRequest: RequestItem) {
    setAction(nextAction);
    setRequest(nextRequest);
    setRefusal(null);
    setDraftResult(null);
    setCounterResult(null);
    // Every open starts from what the request actually says, so the operator is
    // editing the ask rather than retyping it.
    setMessage("");
    setFeeMinimum("");
    setFeeMaximum("");
    setOfferedDate(nextRequest.wantedDate ?? "");
    setDraftTitle(nextRequest.artistName ?? nextRequest.contactName ?? "");
    setDraftDate(nextRequest.wantedDate ?? "");
    setDraftCurrency(nextRequest.currency ?? "");
  }

  function close() {
    setAction(null);
    setRequest(null);
    setRefusal(null);
  }

  /** Re-read what changed: always the inbox, plus the events list after a draft. */
  function invalidate(alsoEvents = false) {
    refetch();
    if (alsoEvents) {
      void queryClient.invalidateQueries({ queryKey: getGetApiV1EventsQueryKey() });
    }
  }

  async function confirm() {
    if (!request || !action) return;
    setRefusal(null);

    try {
      switch (action) {
        case "decline": {
          await updateStatus.mutateAsync({ id: request.id, status: "declined" });
          onSuccess("Request declined");
          invalidate();
          close();
          return;
        }
        case "archive": {
          await updateStatus.mutateAsync({ id: request.id, status: "archived" });
          onSuccess("Request archived");
          invalidate();
          close();
          return;
        }
        case "restore": {
          await updateStatus.mutateAsync({ id: request.id, status: "pending" });
          onSuccess("Request restored to pending");
          invalidate();
          close();
          return;
        }
        case "block": {
          await flagSpam.mutateAsync({ id: request.id, data: { kind: "spam" } });
          onSuccess("Sender reported and request blocked");
          invalidate();
          close();
          return;
        }
        case "draft": {
          const result = await createDraftEvent.mutateAsync({
            id: request.id,
            data: {
              ...(draftTitle.trim() ? { title: draftTitle.trim() } : {}),
              ...(draftDate ? { eventDate: draftDate } : {}),
              ...(draftCurrency.trim() ? { baseCurrency: draftCurrency.trim() } : {}),
            },
          });
          // The dialog stays open on success: it is where the plan consequence
          // (what confirming this draft will cost) is stated.
          setDraftResult(result);
          invalidate(true);
          return;
        }
        case "offer": {
          const result = await sendCounterOffer.mutateAsync({
            id: request.id,
            data: {
              message: message.trim(),
              ...(offeredDate ? { wantedDate: offeredDate } : {}),
              ...(toMinorUnits(feeMinimum) ? { offerFeeMin: toMinorUnits(feeMinimum) } : {}),
              ...(toMinorUnits(feeMaximum) ? { offerFeeMax: toMinorUnits(feeMaximum) } : {}),
            },
          });
          setCounterResult(result);
          invalidate();
          return;
        }
      }
    } catch (error) {
      // Kept in the dialog beside the values that caused it — a refusal is the
      // answer to the question just asked, not a toast to miss.
      setRefusal(errorMessage(error, "That didn't work."));
    }
  }

  /** Card → dialog. An id with no row behind it opens nothing, rather than acting blind. */
  const openById = (nextAction: RequestTriageAction) => (id: string) => {
    const match = requests.find((candidate) => candidate.id === id);
    if (match) open(nextAction, match);
  };

  return {
    action,
    request,
    message,
    setMessage,
    feeMinimum,
    setFeeMinimum,
    feeMaximum,
    setFeeMaximum,
    offeredDate,
    setOfferedDate,
    draftTitle,
    setDraftTitle,
    draftDate,
    setDraftDate,
    draftCurrency,
    setDraftCurrency,
    refusal,
    pending,
    draftResult,
    counterResult,
    open,
    close,
    confirm,
    handlers: {
      onCreateDraft: openById("draft"),
      onMakeOffer: openById("offer"),
      onDecline: openById("decline"),
      onBlock: openById("block"),
      onArchive: openById("archive"),
      onRestore: openById("restore"),
    },
  };
}
