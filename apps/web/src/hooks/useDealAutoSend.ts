import {
  getApiV1EventsIdDeals,
  getGetApiV1EventsIdDealsQueryKey,
  postApiV1DealsDidSend,
} from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { errorMessage } from "../lib/errors";

/**
 * THE WIZARD'S DEAL SENDS ITSELF — after a window in which it can be called back.
 *
 * The Create-Event wizard writes a real `deals` row with the event (ClickUp
 * 86cbaxu52). It landed as `agreement_status = 'draft'`, so the operator still
 * had to open the Deals tab and press "Send to parties" before anybody could
 * confirm — the extra step the product owner objected to: *"they inserted the
 * deal in the flow creation and they were done. The agreement was automatically
 * created and the sides just needed to confirm."* (86cbaxv2a).
 *
 * ## Where the undo lives, and why it lives HERE
 *
 * The window is **in front of the send**, not behind it: the deal stays a draft
 * for {@link DEAL_SEND_UNDO_WINDOW_MS}, and `POST /deals/:did/send` fires only
 * once the window closes unchallenged. The alternative — send at once and offer
 * a retract — was rejected on what the OTHER PARTY sees:
 *
 *  - Sending writes a notification and pushes it down the realtime stream:
 *    *"Agreement sent for X — Terms are ready for your review."* A retract cannot
 *    take that back. The performer keeps a bell entry about terms that were
 *    withdrawn seconds later, and the first thing the operator's new agreement
 *    ever said to them was wrong.
 *  - A party who is quick can sign inside the window, and a retract would then be
 *    voiding a signature — a far bigger act than "un-press the button". (This
 *    used to be the WORSE half of the argument: `POST /deals/:did/confirm` did
 *    not check `agreement_status` at all, so a draft could be signed before it
 *    was ever sent. That gap was closed on 2026-08-31 — confirm now answers 409
 *    on a draft — which removes the bug but not this reason: once SENT, a deal is
 *    signable at once, so a retract window is still a window to sign inside.)
 *
 * Holding the send costs the other party nothing, because nothing has reached
 * them yet. Five seconds of silence is not a lie; a recalled notification is.
 *
 * ## What it costs, and why that is the cheaper failure
 *
 * The timer is a browser timer, so a tab closed inside the window leaves the deal
 * a **draft** — exactly where it stood before today, on a Deals tab whose "Send
 * to parties" button is the ordinary way forward. The toast therefore says
 * *sending*, in the present tense, and never claims a send that has not happened.
 * Nothing here can produce a state the Deals tab cannot get out of: undone or
 * dropped, the deal is a draft that sends normally; sent, it reopens normally.
 *
 * The timer deliberately outlives the wizard, which unmounts the moment the event
 * is created — it is a plain `window.setTimeout`, cleaned up by nothing, because
 * cancelling it on unmount would cancel every send.
 */

/**
 * How long the agreement is held back. Long enough to catch the typo'd guarantee
 * you noticed as you clicked, short enough that the other party is not kept
 * waiting on a UI timer. The toast is given the same lifetime, so the Undo is on
 * screen for exactly as long as it can still do anything.
 */
export const DEAL_SEND_UNDO_WINDOW_MS = 6000;

export interface DealAutoSend {
  /**
   * Hold the agreement just created with `eventId`, then send it. `partyName` only
   * names the counterparty in the toast.
   */
  sendAfterUndoWindow: (eventId: string, partyName: string) => void;
}

export function useDealAutoSend(): DealAutoSend {
  const toast = useToast();
  const queryClient = useQueryClient();

  const sendAfterUndoWindow = useCallback(
    (eventId: string, partyName: string) => {
      // Fired now, awaited later: the event was created a moment ago and carries
      // exactly one deal, but the window must start when the operator can see the
      // Undo — not when a round trip happens to come back.
      const draftDeal = getApiV1EventsIdDeals(eventId).then((deals) =>
        deals.find((deal) => deal.agreementStatus === "draft"),
      );
      let cancelled = false;

      const toastId = toast(`Sending the agreement to ${partyName} to confirm…`, {
        duration: DEAL_SEND_UNDO_WINDOW_MS,
        action: {
          label: "Undo",
          onClick: () => {
            cancelled = true;
            toast.dismiss(toastId);
            toast("Kept as a draft — send it from the event's Deals tab when you're ready.");
          },
        },
      });

      window.setTimeout(async () => {
        if (cancelled) return;
        // Take the Undo off the screen at the instant it stops working. The toast
        // pauses its own countdown while the pointer is over it, so left alone a
        // hovered toast would keep offering an Undo that the window has already
        // closed on — a button that lies about what it will do.
        toast.dismiss(toastId);
        try {
          const deal = await draftDeal;
          // No draft to send is not a failure: the operator may have sent it by
          // hand from the Deals tab while the window was open.
          if (!deal || cancelled) return;
          await postApiV1DealsDidSend(deal.id);
          void queryClient.invalidateQueries({
            queryKey: getGetApiV1EventsIdDealsQueryKey(eventId),
          });
          toast.success(`Agreement sent to ${partyName} — they can confirm it now.`);
        } catch (error) {
          toast.error(
            errorMessage(
              error,
              "Couldn't send the agreement. It's saved as a draft — open the event's Deals tab and press Send to parties.",
            ),
            { duration: 12000 },
          );
        }
      }, DEAL_SEND_UNDO_WINDOW_MS);
    },
    [toast, queryClient],
  );

  return { sendAfterUndoWindow };
}
