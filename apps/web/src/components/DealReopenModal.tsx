import { Button, Modal, TextField } from "@showme/design-system";

export interface DealReopenModalProps {
  open: boolean;
  dealName: string;
  reason: string;
  onReasonChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
}

/**
 * Reopening a confirmed agreement.
 *
 * Its own dialog rather than a plain "are you sure?", because reopening does two
 * things worth saying out loud: it **clears every confirmation** already given,
 * and it releases the frozen `confirmed_snapshot` — the record both sides signed
 * — into the reopen trail (decisions #1). A reason is required for the same
 * reason: what lands in the audit and the other parties' feed should say what
 * changed, not just that someone reopened it.
 */
export function DealReopenModal({
  open,
  dealName,
  reason,
  onReasonChange,
  onClose,
  onConfirm,
  pending,
}: DealReopenModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reopen for renegotiation"
      width={460}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={pending || reason.trim() === ""} onClick={onConfirm}>
            {pending ? "Reopening…" : "Reopen"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.5 }}>
          Every confirmation on <strong style={{ color: "var(--text)" }}>{dealName}</strong> is
          cleared and the frozen terms are released. Each party has to confirm again before it is an
          agreement.
        </div>
        <TextField
          label="Why"
          value={reason}
          placeholder="Fee revised after the support slot changed"
          onChange={(event) => onReasonChange(event.target.value)}
        />
      </div>
    </Modal>
  );
}
