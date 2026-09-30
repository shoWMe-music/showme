import { Badge, Button, Icon, Modal, TextField } from "@showme/design-system";
import { eventParticipantRoleLabel } from "@showme/shared";
import { useState } from "react";
import type { AddressedInvitation, EventInvitation } from "../hooks/useEventInvitations";
import { DateText } from "./DateText";

/**
 * INVITATIONS ADDRESSED TO THIS USER — the handle on the door the invitation
 * gate created (ClickUp 86cbcehmp).
 *
 * Rendered in two places, which is why it takes a heading and an `actionable`
 * flag rather than hard-coding either: on the Events page it leads with the
 * unanswered ones, and in the Requests inbox it sits inside whichever tab the
 * reader has chosen (Pending, Accepted, Declined, Expired) where only the first
 * of those can still be answered.
 *
 * An `invited` participation grants no capabilities, so these shows are NOT in
 * the events list below and opening one answers 404. Without this card an
 * invitation is a notification pointing at nothing, which is the shape of the
 * bug reported as 123qy9rnf87 — *"the notification was received but clicking it
 * did not lead to the event or to the 'Accept' this invitation flow."*
 *
 * It sits ABOVE the events list rather than inside it, and deliberately does not
 * look like a row: these are not your events yet. The whole card disappears the
 * moment the last invitation is answered.
 *
 * Dumb by construction — every value arrives as a prop and every action is an
 * event. The fetching, the two mutations, the toast and the cache invalidation
 * all live in `useEventInvitations`.
 */
export interface EventInvitationsCardProps {
  invitations: EventInvitation[];
  /**
   * EMAIL INVITATIONS — the other kind, listed in the same card (QA sweep run 10, QA10-4).
   *
   * An Invite Collaborator invitation is an `invitations` row with a token and no participation, so
   * it never appeared here and the invitee's Dashboard said *"You're all caught up"* about an ask
   * with their name on it. It is answered on its own page, so these rows carry a LINK rather than
   * Accept and Decline — `/invitations/:token` is the only page that can move one.
   *
   * Same card on purpose: what the reader has is "an invitation addressed to me", and which of two
   * mechanisms carries it is not their problem. Defaults to empty, so the two screens that render
   * this card without them are unchanged.
   */
  addressed?: AddressedInvitation[];
  /** The event id currently being answered, so its buttons can go quiet. */
  answering: string | null;
  /**
   * The heading above the list. Defaults to the Events page's own wording; the
   * Requests inbox passes its own, because there the tab already says which
   * bucket these are and "You have an invitation" would be wrong on three of the
   * four tabs.
   */
  heading?: string;
  /**
   * Whether the rows offer Accept / Decline. False for an invitation that has
   * already been answered (or expired) — showing buttons that would 409 is worse
   * than showing none.
   */
  actionable?: boolean;
  onAccept: (invitation: EventInvitation) => void;
  /** The note is Ran's: a refusal is far more useful when it says why. */
  onDecline: (invitation: EventInvitation, note?: string) => void;
}

export function EventInvitationsCard({
  invitations,
  addressed = [],
  answering,
  onAccept,
  onDecline,
  heading,
  actionable = true,
}: EventInvitationsCardProps) {
  /**
   * Which invitation is being declined, and the reason typed so far.
   *
   * ClickUp 86cbcehmp: *"Declining requests should come with a 'Note' input model
   * popup - so that the decliner can say if it is a date issue or if they simply
   * don't want to be booked by this operator."*
   *
   * Local VIEW state, which is why it lives here and not in the hook: nothing is
   * fetched, nothing is mutated until the dialog is submitted, and the hook stays
   * the one place that talks to the server.
   *
   * Accepting has no dialog on purpose. A yes needs no explanation, and a
   * confirmation step on the wanted answer is friction for its own sake.
   */
  const [declining, setDeclining] = useState<EventInvitation | null>(null);
  const [note, setNote] = useState("");

  const closeDecline = () => {
    setDeclining(null);
    setNote("");
  };

  const submitDecline = () => {
    if (!declining) return;
    const trimmed = note.trim();
    onDecline(declining, trimmed.length > 0 ? trimmed : undefined);
    closeDecline();
  };

  // Either list is reason enough to draw the card; both empty and it disappears, as before.
  if (invitations.length === 0 && addressed.length === 0) return null;
  const total = invitations.length + addressed.length;

  return (
    <section
      aria-labelledby="pending-invitations-heading"
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "16px 18px",
        marginBottom: 20,
        background: "var(--surface-raised, var(--surface))",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <Icon name="mail" />
        <h2 id="pending-invitations-heading" style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>
          {heading ?? (total === 1 ? "You have an invitation" : `You have ${total} invitations`)}
        </h2>
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
        {invitations.map((invitation) => {
          const busy = answering === invitation.eventId;
          const show = invitation.title ?? "Untitled event";
          return (
            <li
              key={invitation.participantId}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 14,
                // Wraps rather than overflows: this row carries a title, a date,
                // a venue and two buttons, and on a phone that is wider than the
                // screen. `min-width: 0` on the text half removes the floor so
                // the title ellipsises instead of pushing the buttons off-page.
                flexWrap: "wrap",
                padding: "11px 13px",
                borderRadius: 9,
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {show}
                </div>
                {/*
                  THE ONE STATUS THIS ROW HAS TO SAY OUT LOUD (QA sweep run 5, QA5-2).

                  Every other bucket is named by the tab the reader chose, so a badge
                  would repeat it. `cancelled` is not: it belongs to no chip, so it
                  surfaces only under "All", beside pending invitations it is otherwise
                  indistinguishable from — same title, same date, and now no buttons,
                  with nothing on the row to say why. The night being off is also the
                  only one of these states the reader did not cause.
                */}
                {invitation.requestStatus === "cancelled" && (
                  <div style={{ marginTop: 4 }}>
                    <Badge status="cancelled" dot>
                      Cancelled
                    </Badge>
                  </div>
                )}
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                  {/* No link: the calendar cannot show a night you have not
                      accepted, and a dead link is worse than plain text. */}
                  <DateText value={invitation.eventDate} weekday link={false} />
                  {invitation.venueName ? ` · ${invitation.venueName}` : ""}
                  {invitation.hostName ? ` · from ${invitation.hostName}` : ""}
                </div>
                {/*
                  WHOSE INVITATION THIS IS, when somebody else is involved (QA sweep run 11).

                  An AGENT's card read "QA11 Money Night · from The Lantern Hall" and never said
                  it was Marlo Vance's — an agency with two acts on one night could not tell its
                  cards apart, and accepting moves the ACT's participation row, not the agency's.
                  The notification for the same event already gets this right ("You were added to
                  the show as Marlo Vance's agent"), so the card was the one place it was missing.

                  And on the ACT's own row the sentence runs the other way: they can see the night
                  now (decisions §25.7.3 — "the act SEES; the actions stay with the agent") and
                  what they need to know is that the answer is not theirs to give.
                */}
                {invitation.delegateName && (
                  <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                    {invitation.answerableByYou
                      ? `Answering for ${invitation.delegateName}`
                      : `${invitation.delegateName} answers this for you`}
                  </div>
                )}
              </div>
              {actionable && invitation.answerableByYou && (
                <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setDeclining(invitation)}
                  >
                    Decline
                  </Button>
                  {/*
                    NO ACCEPT ON A CANCELLED EVENT (decisions §25.9.9). The badge beside this row
                    already says the event is off — run 15's fix — and the API now refuses the
                    acceptance, so offering the button would be offering a 409. Decline stays: the
                    ruling names the acceptance and only the acceptance, and closing the invitation
                    is the answer a performer most wants on record.

                    `requestStatus` and not an event field: the API already crosses the EVENT's
                    status into it (QA5-2), so the fact is on the row and asking for it twice would
                    be a second opinion about the same thing.
                  */}
                  {invitation.requestStatus !== "cancelled" && (
                    <Button disabled={busy} onClick={() => onAccept(invitation)}>
                      {busy ? "Sending…" : "Accept"}
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {addressed.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
          {addressed.map((invitation) => (
            <li
              key={invitation.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 14,
                flexWrap: "wrap",
                padding: "11px 13px",
                borderRadius: 9,
                border: "1px solid var(--border)",
              }}
            >
              <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {invitation.eventTitle}
                  {/*
                    A CANCELLED NIGHT SAYS SO, HERE TOO (QA sweep run 15).
                    This list put an invitation to a called-off show under "Pending" with nothing to
                    tell it from a live one — the same reason the Events list badges `cancelled`, and
                    the same crossing of two facts `inboxStatusFor` already does for a participation.
                  */}
                  {invitation.eventStatus === "cancelled" && (
                    <Badge status="cancelled" dot>
                      Cancelled
                    </Badge>
                  )}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                  {/* Same reasoning as the rows above: nothing to link to until it is accepted. */}
                  <DateText value={invitation.eventDate} weekday link={false} />
                  {invitation.role ? ` · as ${eventParticipantRoleLabel(invitation.role)}` : ""}
                  {invitation.hostName ? ` · from ${invitation.hostName}` : ""}
                  {invitation.eventStatus === "cancelled"
                    ? " · the show is off, so accepting books nothing"
                    : ""}
                </div>
              </div>
              {/*
                A LINK, not a pair of buttons. The accept for this kind is token-keyed and there is no
                participation for `participation/accept` to move, so answering happens on the
                invitation's own page — which is also where the role and the access it grants are
                spelled out before anybody says yes.
              */}
              <Button
                variant="secondary"
                style={{ flex: "0 0 auto" }}
                leftIcon={<Icon name="mail" size={14} />}
                onClick={() => {
                  window.location.href = `/invitations/${invitation.token}`;
                }}
              >
                Open the invitation
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={declining !== null}
        onClose={closeDecline}
        title={`Decline ${declining?.title ?? "this invitation"}?`}
        // Holds typed input, so a click a millimetre outside must not discard it
        // (ClickUp 123qy9rnfyw). Escape, the X and Cancel all still close it.
        dismissOnScrim={false}
        footer={
          <>
            <Button variant="ghost" onClick={closeDecline}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submitDecline}>
              Decline invitation
            </Button>
          </>
        }
      >
        <p style={{ margin: "0 0 14px", fontSize: 14, color: "var(--muted)" }}>
          {declining?.hostName ?? "The operator"} will be told you can't make it. Adding a reason
          helps them decide whether to offer you another date.
        </p>
        <TextField
          label="Reason (optional)"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Already booked that night"
          maxLength={2000}
        />
      </Modal>
    </section>
  );
}
