import { Button, Modal, TextField } from "@showme/design-system";

export interface EventCancelModalProps {
  open: boolean;
  eventTitle: string;
  /** How many other parties hear about it, so the dialog can say who is being told. */
  otherParties: number | null;
  reason: string;
  onReasonChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}

/**
 * CALLING A SHOW OFF.
 *
 * Its own dialog rather than a plain "are you sure?", and a required reason, for
 * the same argument `DealReopenModal` makes about reopening: the sentence typed
 * here is not a formality, it is the message that lands in every other party's
 * feed and in the event's history (`decisions.md` #25.3 — *"Cancel first (with a
 * reason, sent to the collaborators)"*). A cancellation with nothing to explain
 * itself leaves a performer holding a dead date and no idea why, so the confirm
 * button stays disabled while the field is empty.
 *
 * The API deliberately does NOT enforce that (`routes/events.ts`): a called-off
 * night is a fact about the world, and refusing the status change for want of
 * prose would leave the show standing as live on everybody's calendar. The
 * insistence belongs here, where there is somebody to insist to.
 *
 * It does not pretend to be reversible, and it does not pretend to be a delete.
 * Cancelling is a status the show keeps — it stays in the list under its own
 * filter, it keeps its budget and its history, and the public page goes dark
 * without losing the operator's publishing intent (`routes/public.ts`). Deleting
 * is the rung after this one, and the menu offers it only once this has happened.
 */
export function EventCancelModal({
  open,
  eventTitle,
  otherParties,
  reason,
  onReasonChange,
  onClose,
  onConfirm,
  pending,
}: EventCancelModalProps) {
  return (
    <Modal
      dismissOnScrim={false}
      open={open}
      onClose={onClose}
      title="Cancel this show?"
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="primary" disabled={pending || reason.trim() === ""} onClick={onConfirm}>
            {pending ? "Cancelling…" : "Cancel the show"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
          <strong style={{ color: "var(--text)" }}>{eventTitle}</strong> is marked cancelled and{" "}
          {/* Named where we know it, because "everyone on the bill" is an abstraction
              and "2 other parties" is a fact the operator can weigh. Null while the
              roster has not loaded — then the honest general sentence. */}
          {otherParties === null
            ? "everyone else on the bill is told why"
            : otherParties === 1
              ? "the other party on the bill is told why"
              : `the ${otherParties} other parties on the bill are told why`}
          . Nothing is deleted: the show keeps its budget, its deals and its history, and its public
          page goes dark.
        </div>
        <TextField
          label="Why"
          value={reason}
          placeholder="The venue lost its licence for the weekend"
          onChange={(event) => onReasonChange(event.target.value)}
        />
        <div style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.5 }}>
          This is what they read, so write it for them.
        </div>
      </div>
    </Modal>
  );
}
