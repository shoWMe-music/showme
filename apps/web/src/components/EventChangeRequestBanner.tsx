import { Button, Icon, Modal, TextField } from "@showme/design-system";
import { useState } from "react";
import type { EventChangeProposal } from "../hooks/useEventChangeRequest";
import { DateText } from "./DateText";

/**
 * "Somebody has asked to move this night." — the Confirm / Decline Ran asked for
 * (ClickUp 86cbcftg3).
 *
 * It sits at the top of the event, above the tabs, because it is the one thing
 * on the page that is a QUESTION rather than information: everything below it
 * describes a booking that may be about to change.
 *
 * ── It draws for everyone, and asks only the people being asked ────────────
 * A crew member whose call time depends on the night has a real interest in
 * knowing it is being moved, so the banner is not hidden from them — but only a
 * counterpart gets buttons. `answerable` is decided by the server (standing on
 * the event, not the proposer, has not answered yet), so the operator who raised
 * it reads the same banner with a line saying who is being waited on.
 */
export interface EventChangeRequestBannerProps {
  proposal: EventChangeProposal;
  isAnswering: boolean;
  onConfirm: () => void;
  onDecline: (note?: string) => void;
}

/** `eventDate` → "the date". The ids are not worth showing; the field name is. */
const FIELD_LABELS: Record<string, string> = {
  eventDate: "Date",
  venueProfileId: "Venue",
  stageId: "Room",
};

export function EventChangeRequestBanner({
  proposal,
  isAnswering,
  onConfirm,
  onDecline,
}: EventChangeRequestBannerProps) {
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");

  const fields = Object.keys(proposal.changes);
  const waitingOn = proposal.required - proposal.confirmed - proposal.declined;

  const closeDecline = () => {
    setDeclining(false);
    setNote("");
  };

  const submitDecline = () => {
    const trimmed = note.trim();
    onDecline(trimmed.length > 0 ? trimmed : undefined);
    closeDecline();
  };

  return (
    <section
      aria-labelledby="change-request-heading"
      style={{
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "16px 18px",
        marginBottom: 18,
        background: "var(--surface-raised, var(--surface))",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <Icon name="calendar" />
        {/* NAMES WHO ASKED (QA sweep run 16). Read in four seats and naming the proposer in none of
            them, while `proposed_by_profile_id` sat on the row — and on a co-promoted night who asked
            to move the date is most of the decision. The PROFILE, which is what the other parties
            recognise; unnamed only when the proposer acted without an acting profile. */}
        <h2 id="change-request-heading" style={{ margin: 0, fontSize: 14.5, fontWeight: 600 }}>
          {proposal.proposedByName
            ? `${proposal.proposedByName} has asked to change this booking`
            : "A change to this booking is waiting on an answer"}
        </h2>
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
        {fields.map((field) => (
          <li key={field} style={{ fontSize: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: "var(--muted)", minWidth: 54 }}>
              {FIELD_LABELS[field] ?? field}
            </span>
            {/* Both halves, so the reader is answering a move rather than a value.
                Dates are rendered; a venue or room arrives as an id, which is not
                worth showing — the field name plus "is changing" is honest, and
                the detail is one tab away. */}
            {field === "eventDate" ? (
              <span>
                <DateText value={proposal.previous[field] ?? null} link={false} />
                {" → "}
                <strong>
                  <DateText value={proposal.changes[field] ?? null} link={false} />
                </strong>
              </span>
            ) : (
              <span>is changing</span>
            )}
          </li>
        ))}
      </ul>

      {proposal.reason && (
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--muted)" }}>“{proposal.reason}”</p>
      )}

      {proposal.answerable ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="secondary" disabled={isAnswering} onClick={() => setDeclining(true)}>
            Decline
          </Button>
          <Button disabled={isAnswering} onClick={onConfirm}>
            {isAnswering ? "Sending…" : "Confirm"}
          </Button>
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--muted)" }}>
          {waitingOn > 0
            ? `Waiting on ${waitingOn} ${waitingOn === 1 ? "person" : "people"} to answer. Nothing moves until everyone agrees.`
            : "Your answer is in."}
        </p>
      )}

      <Modal
        open={declining}
        onClose={closeDecline}
        title="Decline this change?"
        // Holds typed input — a click a millimetre outside must not discard it
        // (ClickUp 123qy9rnfyw).
        dismissOnScrim={false}
        footer={
          <>
            <Button variant="ghost" onClick={closeDecline}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submitDecline}>
              Decline change
            </Button>
          </>
        }
      >
        <p style={{ margin: "0 0 14px", fontSize: 14, color: "var(--muted)" }}>
          The booking stays exactly as it is, and whoever asked will be told. A reason helps them
          find something that works.
        </p>
        <TextField
          label="Reason (optional)"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="We fly out that morning"
          maxLength={2000}
        />
      </Modal>
    </section>
  );
}
