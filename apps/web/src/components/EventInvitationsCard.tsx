import { Button, Icon, Modal, TextField } from "@showme/design-system";
import { useState } from "react";
import type { EventInvitation } from "../hooks/useEventInvitations";
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

  if (invitations.length === 0) return null;

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
          {heading ??
            (invitations.length === 1
              ? "You have an invitation"
              : `You have ${invitations.length} invitations`)}
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
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
                  {/* No link: the calendar cannot show a night you have not
                      accepted, and a dead link is worse than plain text. */}
                  <DateText value={invitation.eventDate} weekday link={false} />
                  {invitation.venueName ? ` · ${invitation.venueName}` : ""}
                  {invitation.hostName ? ` · from ${invitation.hostName}` : ""}
                </div>
              </div>
              {actionable && (
                <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setDeclining(invitation)}
                  >
                    Decline
                  </Button>
                  <Button disabled={busy} onClick={() => onAccept(invitation)}>
                    {busy ? "Sending…" : "Accept"}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

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
