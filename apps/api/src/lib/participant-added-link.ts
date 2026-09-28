import { NON_STANDING_PARTICIPANT_STATUSES } from "@showme/auth";

/**
 * WHERE "you were added to an event" SHOULD LAND (QA sweep run 9, QA9-3).
 *
 * All three emitters of `event.participant_added` linked to `/events/:id`, and for the recipient of
 * an invitation that page is a **404** — `authorize` resolves a principal through
 * `event_participants` while excluding `invited`, `declined` and `removed`, which is correct:
 * nothing is granted until the invitation is answered. So the bell told an act *"You were added to
 * 'Nordic Synth Showcase'"* and the link read, whole: *"Couldn't load this event — Event not
 * found."* The refusal was right; the link was the bug.
 *
 * A pending invitation is answered on the **`EventInvitationsCard`**, which `/requests` and
 * `/events` both render off `GET /me/event-invitations`, with Accept and Decline on it. So that is
 * where a not-yet-standing participant goes, and `/events/:id` is kept for a row that can actually
 * be opened.
 *
 * One function for all three emitters because they had three copies of the same wrong link, which
 * is how they were wrong in the same way for as long as they were.
 *
 * **What this does NOT fix, said plainly:** a represented act's invitation is answered by their
 * AGENT (decisions #14), so for that act `/me/event-invitations` is empty and `/requests` has
 * nothing to show them either. The link stops 404-ing; the body text still says "you were added" to
 * somebody who cannot act on it. Whether the act should be told at all, and in what words, is a
 * product question — recorded in the sweep report rather than guessed at here.
 */
export function participantAddedLink(status: string, eventId: string): string {
  return (NON_STANDING_PARTICIPANT_STATUSES as readonly string[]).includes(status)
    ? "/requests"
    : `/events/${eventId}`;
}
