/**
 * WHICH INVITATIONS BELONG IN THE REQUESTS INBOX VIEW THE READER IS LOOKING AT.
 *
 * Two lists feed one card — `EventInvitationsCard` — and they are two different objects:
 * a PARTICIPATION the reader answers in place (`/me/event-invitations`) and an invitation
 * addressed to their EMAIL, redeemed on its own page (`/me/invitations`). They share the
 * view's own filters and differ in how the status chips apply to them.
 *
 * The rules live here rather than in `Requests.tsx` because they are rules. Both were
 * `useMemo` filters inside the route, where nothing could test them, and one of them was
 * missing the `direction` clause for as long as the card existed: an invitation somebody
 * sent TO the reader was listed under "Outgoing Requests — offers and requests you have
 * sent" (QA sweep run 12).
 */

/** The shared half: the tab, and the day rail. */
export type InboxView = {
  /** `incoming` = things aimed at this reader; `outgoing` = what they have sent. */
  direction: string;
  /** The status chip — a `requestStatus`, `"all"`, or the unread bucket. */
  filter: string;
  /**
   * A day picked on the rail, or absent for the whole month. `undefined` as well as `null`
   * because the inbox hook's own state is optional — a narrower type here would only have
   * forced the caller to normalise it, and "no day picked" is one state however it is spelled.
   */
  selectedDay?: string | null;
};

type Dated = { eventDate: string | null };

/**
 * AN INVITATION IS ALWAYS INCOMING, whichever of the two objects it is.
 *
 * `direction` means "requests targeting me" versus "offers I have sent", and an invitation
 * is unambiguously the first — the record of it is the `event_participants` row somebody
 * else created. Both lists ask this, because the card's heading counts them together and
 * the inbox's empty state counts them together, so a list that answered differently from
 * its sibling would leave one of those two disagreeing with the screen.
 */
function isAimedAtTheReader(view: InboxView): boolean {
  return view.direction === "incoming";
}

function matchesTheDayRail(row: Dated, view: InboxView): boolean {
  return view.selectedDay == null || row.eventDate === view.selectedDay;
}

/**
 * PARTICIPATION invitations for this view.
 *
 * `requestStatus` is the participation's own state crossed with the calendar, so the status
 * chips apply to it directly. The UNREAD chip is the exception and needs no clause of its own:
 * unread is a booking-request notion — somebody's team has or has not opened the row — and an
 * invitation addressed to a person has no such state, which is exactly why no `requestStatus`
 * is ever spelled `unread` and the status match below already excludes the whole bucket.
 *
 * There WAS a clause, `if (view.filter === unreadFilter) return false`, with the reasoning above
 * attached to it. A mutation deleting it survived, because it can never be the deciding test:
 * `requestStatus` is a closed set (pending · accepted · declined · expired · cancelled) and the
 * bucket's name is in none of it. The reasoning was worth keeping; the line was not, and the
 * `unreadFilter` parameter it needed went with it. Third time a surviving mutation has meant
 * "this line is redundant" rather than "this line is untested".
 */
export function participationInvitationsInView<T extends Dated & { requestStatus: string }>(
  all: readonly T[],
  view: InboxView,
): T[] {
  if (!isAimedAtTheReader(view)) return [];
  return all.filter((invitation) => {
    if (view.filter !== "all" && invitation.requestStatus !== view.filter) return false;
    return matchesTheDayRail(invitation, view);
  });
}

/**
 * EMAIL-ADDRESSED invitations for this view.
 *
 * These are only ever unanswered — the endpoint returns pending rows and an answered one stops
 * being one — so they belong under Pending and under All, and nowhere else. On Accepted,
 * Declined or Expired they would be the one row in the bucket that does not belong to it.
 */
export function addressedInvitationsInView<T extends Dated>(
  addressed: readonly T[],
  view: InboxView,
): T[] {
  if (!isAimedAtTheReader(view)) return [];
  if (view.filter !== "pending" && view.filter !== "all") return [];
  return addressed.filter((invitation) => matchesTheDayRail(invitation, view));
}
