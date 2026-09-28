import { Button, Modal } from "@showme/design-system";

/** Which of the two ways of ending an agreement is being confirmed. */
export type DealEndMode = "delete" | "cancel";

export interface DealEndModalProps {
  open: boolean;
  mode: DealEndMode;
  dealName: string;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}

/**
 * ENDING AN AGREEMENT — the two ways, and what each one costs (decisions §25.7.2).
 *
 * One dialog for both, because the whole question a person has here is *which of these two am I
 * doing*, and answering it in two separate dialogs that look alike is how somebody presses the
 * irreversible one meaning the other.
 *
 * **Delete** destroys the record. It is offered only while the agreement is a draft and nothing on
 * the night has been settled — past either line `DELETE /deals/:did` refuses, and the card shows
 * the reason with Cancel beside it rather than a control that errors.
 *
 * **Cancel** stops it paying and keeps it. The settlement engine skips a cancelled deal
 * (`ne(status, 'cancelled')`), so the figures move exactly as if it were gone, and the record that
 * it was offered survives — which is the point.
 *
 * Neither is a `window.confirm`: both sentences below say what happens to the MONEY, and that is
 * not something a browser dialog can be made to say.
 */
export function DealEndModal({
  open,
  mode,
  dealName,
  onClose,
  onConfirm,
  pending,
}: DealEndModalProps) {
  const deleting = mode === "delete";
  return (
    <Modal
      dismissOnScrim={false}
      open={open}
      onClose={onClose}
      title={deleting ? "Delete this draft agreement" : "Cancel this agreement"}
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep it
          </Button>
          {/* `primary` for both: the design system has no destructive variant, and inventing one
              here would be a private button style — the divergence the review gate names first.
              The dialog's words carry the weight instead, and they say what happens to the money. */}
          <Button variant="primary" disabled={pending} onClick={onConfirm}>
            {pending
              ? deleting
                ? "Deleting…"
                : "Cancelling…"
              : deleting
                ? "Delete it"
                : "Cancel it"}
          </Button>
        </>
      }
    >
      <div style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.6 }}>
        {deleting ? (
          <>
            <strong style={{ color: "var(--text)" }}>{dealName}</strong> is removed completely,
            along with its party lines. This cannot be undone. It is offered because this agreement
            is still a draft and nothing on this night has been settled — so there is no figure
            anywhere that was computed from it.
          </>
        ) : (
          <>
            <strong style={{ color: "var(--text)" }}>{dealName}</strong> stops paying anybody. The
            settlement skips a cancelled agreement, so every figure moves as though it were gone —
            and the record that it was offered stays, which is why this is the right ending for an
            agreement somebody has already seen.
          </>
        )}
      </div>
    </Modal>
  );
}
