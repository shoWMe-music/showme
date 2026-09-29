/**
 * "NEEDS ATTENTION" — what somebody ELSE is waiting on, ranked and counted.
 *
 * The rule this module exists to hold is the Dashboard card's own, and it decides
 * membership rather than presentation: *what somebody else is waiting on*. An
 * event awaiting a decision, a request nobody has answered, a signature that
 * blocks an agreement, an invitation whose sender has had no reply, a settlement
 * whose figures are sitting unsigned. Not a task — a task is the reader's own
 * work, which is a different kind of urgency and has its own section.
 *
 * It lives here and not in `Dashboard.tsx` because every sentence above is a
 * judgement, and judgements inside a render function cannot be tested. The
 * previous version assembled the list in ninety lines of component body and got
 * three of its five sources wrong without anything being able to say so.
 */

import { formatDay } from "../lib/format";
import { apiStatusToDisplay } from "../lib/status";

export type AttentionKind = "event" | "request" | "deal" | "invitation" | "settlement";

export type AttentionItem = {
  id: string;
  kind: AttentionKind;
  /** The soonest date this bites — the rank. Null sorts last, never dropped. */
  date: string | null;
  title: string;
  detail: string;
  action: string;
  /** Where the reader goes to answer it. Resolved by the caller, which owns routing. */
  target: AttentionTarget;
};

export type AttentionTarget =
  | { to: "event"; eventId: string }
  | { to: "eventDeals"; eventId: string }
  | { to: "eventSettlement"; eventId: string }
  /**
   * BOTH invitation kinds land here, and one destination is deliberate. The
   * Requests screen already shows the two inboxes under one heading and answers a
   * participation in place while LINKING an emailed one to `/invitations/:token`,
   * which lives outside the router because its reader is usually not signed in.
   * Pointing the card at the screen that already knows that costs one click and
   * cannot strand anybody.
   */
  | { to: "requests" };

/** Events still waiting on an operator decision — the prototype's "needs a decision" set. */
export const NEEDS_DECISION: ReadonlySet<string> = new Set(["pending", "suggested", "on_hold"]);

/**
 * A settlement is waiting on the reader while the figures are still under
 * discussion. `finalized`, `partly_paid` and `paid` are past the conversation;
 * `open` has not entered it — nobody has sent anything out yet.
 */
export const SETTLEMENT_REVIEW_STATUSES: ReadonlySet<string> = new Set([
  "pending_review",
  "revised",
  "comments_received",
]);

export type AttentionSources = {
  events: readonly { id: string; title: string; status: string; eventDate: string | null }[];
  requests: readonly {
    id: string;
    status: string;
    wantedDate: string | null;
    artistName?: string | null;
    contactName?: string | null;
  }[];
  dealsAwaitingSignature: readonly {
    dealId: string;
    dealName?: string | null;
    eventId: string;
    eventTitle: string;
    eventDate: string | null;
    signedCount: number;
    signatoryCount: number;
  }[];
  /** `GET /me/event-invitations` — a participation somebody is waiting on. */
  eventInvitations: readonly {
    participantId: string;
    eventId: string;
    title: string | null;
    eventDate: string | null;
    role: string;
    hostName: string | null;
    requestStatus: string;
    answerableByYou: boolean;
    /**
     * THE OTHER PARTY IN THE DELEGATION — the ACT on an agent's row, the AGENT on the act's
     * (decisions §25.7.3). Null on the great majority of invitations, which have no agent at all.
     */
    delegateName: string | null;
  }[];
  /**
   * `GET /me/invitations` — an invitation addressed to the reader's email, already
   * narrowed by `useEventInvitations` to the rows that have somewhere to go.
   */
  addressedInvitations: readonly {
    id: string;
    eventId: string;
    eventTitle: string;
    eventDate: string | null;
    role: string | null;
    hostName: string | null;
  }[];
  /** `GET /settlements` — the reader's own line on every night. */
  settlements: readonly {
    id: string;
    status: string;
    approvedByYou: boolean;
    signableByYou: boolean;
    event: { id: string; title: string; eventDate: string | null };
  }[];
};

export type AttentionList = {
  /** Every item that qualifies, ranked. */
  items: AttentionItem[];
  /** The first `limit` of them — what the card renders. */
  shown: AttentionItem[];
  /** How many qualified but did not fit. Zero when everything is on screen. */
  hidden: number;
};

/** The label a role reads as in a sentence about being invited to a night. */
function roleReads(role: string | null): string {
  switch (role) {
    case "performer":
      return "to perform";
    case "support":
      return "as support";
    case "crew_lead":
    case "crew":
      return "on crew";
    case "co_host":
      return "to co-promote";
    default:
      return "to join";
  }
}

/**
 * RANK: the soonest night first, undated last, and the item id as the final
 * tiebreak so the order is TOTAL.
 *
 * Arrival order was the bug. The list used to be built source by source as each
 * query resolved, so the same reader saw a different five on the first paint than
 * on every later one — `awaiting-signature` lands after the events do. A cut has
 * to fall somewhere; it must not fall somewhere different each time.
 *
 * Not category order: the night that is closest is the answer that is most
 * overdue, whatever kind of answer it is.
 */
function byUrgency(left: AttentionItem, right: AttentionItem): number {
  if (left.date !== right.date) {
    if (left.date == null) return 1;
    if (right.date == null) return -1;
    return left.date < right.date ? -1 : 1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function buildAttentionList(sources: AttentionSources, limit = 5): AttentionList {
  const items: AttentionItem[] = [];

  for (const event of sources.events) {
    if (!NEEDS_DECISION.has(event.status)) continue;
    items.push({
      id: `event-${event.id}`,
      kind: "event",
      date: event.eventDate,
      title: `Confirm ${event.title}`,
      /*
       * THE EVENT'S OWN STATUS, not a word for the whole bucket. `NEEDS_DECISION`
       * covers more than one status, so "Pending event" was printed over `on_hold`
       * shows while the EVENTS tile on the same screen counted Pending as 0 and On
       * hold as 2 — one dashboard disagreeing with itself about two named events.
       */
      detail: `${apiStatusToDisplay(event.status).label} · ${formatDay(event.eventDate)} · needs a decision`,
      action: "Review",
      target: { to: "event", eventId: event.id },
    });
  }

  for (const request of sources.requests) {
    if (request.status !== "pending") continue;
    items.push({
      id: `request-${request.id}`,
      kind: "request",
      date: request.wantedDate,
      title: `Reply to ${request.artistName ?? request.contactName ?? "New request"}`,
      detail: `Booking request · ${formatDay(request.wantedDate)}`,
      action: "Review",
      target: { to: "requests" },
    });
  }

  for (const deal of sources.dealsAwaitingSignature) {
    items.push({
      id: `deal-${deal.dealId}`,
      kind: "deal",
      date: deal.eventDate,
      title: `Sign your line on ${deal.eventTitle}`,
      detail: `${deal.dealName ?? "Agreement"} · ${
        deal.signatoryCount > 0
          ? `${deal.signedCount} of ${deal.signatoryCount} signed`
          : "unsigned"
      } · ${formatDay(deal.eventDate)}`,
      action: "Open",
      target: { to: "eventDeals", eventId: deal.eventId },
    });
  }

  /*
   * AN INVITATION NOBODY HAS ANSWERED — and `answerableByYou` is not decoration.
   *
   * decisions §25.7.3: *the act SEES; the actions stay with the agent.* A
   * delegated act receives the invitation row so its screens can show the night,
   * and cannot answer it. Telling them to answer it would be the card sending a
   * reader to a button they do not have — which is the thing QA6-1 made
   * non-negotiable.
   */
  for (const invitation of sources.eventInvitations) {
    if (invitation.requestStatus !== "pending") continue;
    if (!invitation.answerableByYou) continue;
    /*
     * WHO WAS INVITED, WHICH IS NOT ALWAYS THE READER (QA sweep run 12).
     *
     * An AGENCY read "Invited to perform by The Lantern Hall" on its own Dashboard. An agency does
     * not perform — its act does, and the delegation is the only reason the row is here at all.
     * `delegateName` has been on the wire since part 29 and this module was not reading it, which
     * is the inverse of the "name the API has and does not serve" class: a name the API DOES serve
     * that the screen ignored.
     *
     * NO SECOND GUARD, and a surviving mutation is why. This read
     * `invitation.answerableByYou ? invitation.delegateName : null`, which cannot be false: the
     * `continue` two lines above admits only answerable rows, so `delegateName` here is always the
     * ACT. Re-asking the question was a branch nothing could reach — a comment pretending to be
     * code — and the thing that actually keeps the sentence from inverting is that filter, which
     * has its own test (a non-answerable row WITH a delegate named on it stays off the card).
     */
    const invitee = invitation.delegateName;
    items.push({
      id: `invitation-${invitation.participantId}`,
      kind: "invitation",
      date: invitation.eventDate,
      title: `Answer ${invitation.title ?? "an invitation"}`,
      detail: `${invitee ? `${invitee} invited` : "Invited"} ${roleReads(invitation.role)}${
        invitation.hostName ? ` by ${invitation.hostName}` : ""
      } · ${formatDay(invitation.eventDate)}`,
      action: "Answer",
      target: { to: "requests" },
    });
  }

  /*
   * THE OTHER INVITATION INBOX, and it is a different table.
   *
   * `/me/event-invitations` reads `event_participants` and is scoped to
   * `INVITABLE_ROLES` — performer, support, crew_lead, crew. A CO-PROMOTER is
   * deliberately not in that set, so a co-operator invitation is invisible there
   * and lands here instead, addressed to the reader's verified email. A card that
   * read only the first inbox told a co-promoter with an unanswered invitation
   * that they were all caught up.
   *
   */
  for (const invitation of sources.addressedInvitations) {
    items.push({
      id: `addressed-${invitation.id}`,
      kind: "invitation",
      date: invitation.eventDate,
      title: `Answer ${invitation.eventTitle}`,
      detail: `Invited ${roleReads(invitation.role)}${
        invitation.hostName ? ` by ${invitation.hostName}` : ""
      } · ${formatDay(invitation.eventDate)}`,
      action: "Answer",
      target: { to: "requests" },
    });
  }

  /*
   * FIGURES SENT OUT AND NOT YET SIGNED.
   *
   * `approvedByYou` and not the status, because sending a settlement for review
   * moves EVERY party's row — the operator who pressed the button included. On the
   * status alone this card would have told that operator to go and review its own
   * figures, which is the card's rule exactly inverted.
   *
   * The sender's own unsigned line DOES belong here: a settlement cannot finalize
   * until its lines are signed, so the rest of the night is waiting on it too.
   * What must never happen is asking again for a signature already given.
   *
   * `signableByYou` is the other half, and it was found in the browser rather than
   * reasoned out: a CREW member's figures arrive at `pending_review` and their
   * settlement screen has no sign-off control at all, because `CREW_FLOOR` carries
   * `settlement.view.own` and deliberately not `settlement.confirm`. Without this
   * line the card told them to *"sign off when they match your books"* and sent them
   * to a screen where they cannot — the dead affordance QA6-1 forbids.
   */
  for (const settlement of sources.settlements) {
    if (!SETTLEMENT_REVIEW_STATUSES.has(settlement.status)) continue;
    if (!settlement.signableByYou) continue;
    if (settlement.approvedByYou) continue;
    items.push({
      id: `settlement-${settlement.id}`,
      kind: "settlement",
      date: settlement.event.eventDate,
      title: `Check your figures on ${settlement.event.title}`,
      detail: `${
        settlement.status === "revised" ? "Settlement re-issued" : "Settlement sent for review"
      } · sign off when they match your books · ${formatDay(settlement.event.eventDate)}`,
      action: "Open",
      target: { to: "eventSettlement", eventId: settlement.event.id },
    });
  }

  items.sort(byUrgency);
  const shown = items.slice(0, limit);
  return { items, shown, hidden: items.length - shown.length };
}

/**
 * The greeting's own sentence, which used to count the SHOWN rows and print the
 * number as though it were the total — six things needing attention read as five.
 */
export type AttentionSentence =
  | { caughtUp: true; text: string }
  | { caughtUp: false; before: string; count: string; after: string };

/**
 * Returned in PARTS rather than as one string so the count can stay bold, which is
 * what the card has always done and is the only word in it a reader scans for.
 */
export function attentionSentence(total: number, hidden: number): AttentionSentence {
  if (total === 0) {
    return { caughtUp: true, text: "You're all caught up — nothing needs your attention today." };
  }
  return {
    caughtUp: false,
    before: "You have ",
    count: `${total} ${total === 1 ? "thing" : "things"}`,
    // The verb agrees too: the noun was already conditional and this was not (QA10-16).
    after: `${total === 1 ? " that needs" : " that need"} attention today.${
      // Said only when it is true — a card showing everything it counted should not
      // explain a cut that did not happen.
      hidden > 0 ? ` The ${total - hidden} closest are below.` : ""
    }`,
  };
}
