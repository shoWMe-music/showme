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

import { formatDay, possessiveOf } from "../lib/format";
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
 * THE CAPABILITY BEHIND THE WORD "CONFIRM" — `PATCH /events/:id` authorizes `event.edit`.
 *
 * The set above says of itself that it holds nights waiting on an *operator* decision, and for a
 * while that sentence was the only thing enforcing it: the loop below tested the STATUS and nothing
 * about the reader, so a performer on an `on_hold` night was told to "Confirm Nordic Synth
 * Showcase" and landed on a page with no status control, over a route that answers
 * `403 Missing capability: event.edit` (QA sweep run 13).
 *
 * Not the ACCOUNT KIND, which is the wrong question twice over: a co-promoting operator holds
 * `event.edit` on the night they co-promote and must keep the row, and an `agent` holds `deal.edit`
 * and `agreement.manage` (decisions #14) on a night they may not confirm. `capabilities` is the
 * caller's own effective set on that specific event, which is the only answer that is true per row.
 */
const MAY_DECIDE_EVENT = "event.edit";

export type AttentionSources = {
  /**
   * `GET /events` — and `capabilities` is the reader's own set ON THAT ROW, not a global one.
   *
   * The list route has computed it per event since QA4-9 (`routes/events-list.ts`, where the same
   * omission had a performer offered "Cancel show…" and "Delete permanently…" on a night they had
   * merely played). This card was the fifth place a name the API does serve went unread.
   */
  events: readonly {
    id: string;
    title: string;
    status: string;
    eventDate: string | null;
    capabilities: readonly string[];
  }[];
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
  /**
   * `GET /settlements/awaiting-signature` — the lines this reader owes a signature on, across every
   * night, and NOT the money list.
   *
   * It used to read `GET /settlements`, which is the reader's own MONEY: an agent's participation
   * figure is swapped for their commission there and representation rows are excluded, so the one
   * line an agency is the only account able to sign — their act's — was absent, and this card could
   * not offer it (QA sweep run 12). Two different questions, and only one of them is about money.
   */
  settlements: readonly {
    settlementId: string;
    eventId: string;
    eventTitle: string;
    eventDate: string | null;
    status: string;
    /** False when the reader signs on somebody else's behalf — an agent for their act (#14). */
    isYours: boolean;
    partyName: string | null;
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
    /*
     * AND THE READER MUST BE THE ONE WHO DECIDES IT — see `MAY_DECIDE_EVENT`.
     *
     * Dropped rather than reworded: this card is "what somebody ELSE is waiting on", and on an
     * unconfirmed night nobody is waiting on the performer — the operator is. Their own watching
     * is not their work, which is the same line the module already draws against tasks. The two
     * sibling gates were built for the same reason: `answerableByYou` below (the act sees, the
     * agent acts) and `signableByYou`, which the settlement route now answers server-side.
     */
    if (!event.capabilities.includes(MAY_DECIDE_EVENT)) continue;
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
   * FIGURES SENT OUT AND NOT YET SIGNED — asked of the route whose whole job that is.
   *
   * Every filter this loop used to apply now lives server-side, which is the point: the review
   * statuses, whether the reader has already signed, whether they may sign at all, and — the one
   * this card could not see — whether the line is theirs or their ACT's. All four were being asked
   * of the money list, which does not carry the last one.
   *
   * The history is worth keeping because each clause was its own defect. The status alone would
   * have told the SENDING operator to review its own figures, since sending moves every party's
   * row. `signableByYou` was found in the browser, not reasoned out: a crew member's figures arrive
   * at `pending_review` and their screen has no sign-off control, because `CREW_FLOOR` carries
   * `settlement.view.own` and deliberately not `settlement.confirm` — the card told them to "sign
   * off when they match your books" and sent them somewhere they could not.
   */
  for (const settlement of sources.settlements) {
    items.push({
      id: `settlement-${settlement.settlementId}`,
      kind: "settlement",
      date: settlement.eventDate,
      title: settlement.isYours
        ? `Check your figures on ${settlement.eventTitle}`
        : // An agency signs for its act, and needs to know WHICH act before it signs.
          `Sign off ${possessiveOf(settlement.partyName ?? "their act")} figures on ${settlement.eventTitle}`,
      detail: `${
        settlement.status === "revised" ? "Settlement re-issued" : "Settlement sent for review"
      } · sign off when they match your books · ${formatDay(settlement.eventDate)}`,
      action: "Open",
      target: { to: "eventSettlement", eventId: settlement.eventId },
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
    return { caughtUp: true, text: "You're all caught up. Nothing needs your attention today." };
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
