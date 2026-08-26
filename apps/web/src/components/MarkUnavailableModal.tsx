import { Button, Icon, Modal, TextField } from "@showme/design-system";
import { DateTimeField } from "./DateTimeField";
import { Eyebrow } from "./primitives";
import type { MarkUnavailableView } from "./useMarkUnavailable";

/**
 * The blocked-dates editor behind the Calendar's "Mark Unavailable" button.
 * Dumb by design: every decision — whose profile, who may write, what counts as
 * a valid range — lives in `useMarkUnavailable`.
 */

export interface MarkUnavailableModalProps {
  open: boolean;
  onClose: () => void;
  view: MarkUnavailableView;
}

/** "30 Aug 2026" / "30 Aug – 1 Sep 2026" — a range reads as one phrase. */
function formatBlockRange(startDate: string, endDate: string): string {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const format = (date: Date) =>
    date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  if (startDate === endDate) return format(start);
  return `${format(start)} – ${format(end)}`;
}

function Problem({ children }: { children: string }) {
  return (
    <p style={{ margin: 0, fontSize: 12.5, color: "var(--danger, #EE5746)" }} role="alert">
      {children}
    </p>
  );
}

export function MarkUnavailableModal({ open, onClose, view }: MarkUnavailableModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      width={560}
      title="Mark unavailable"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={view.save}
            disabled={!view.canEdit || !view.isDirty || view.isSaving || view.isLoading}
          >
            {view.isSaving ? "Saving…" : "Save blocked dates"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Say plainly whose diary this writes to — an operator and a performer
            mean genuinely different things by "unavailable", and the row is
            profile-scoped either way. */}
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
          These dates say <strong style={{ color: "var(--text)" }}>{view.profileName}</strong> can't
          be booked. They belong to this profile only — nobody else's calendar changes.
          {view.isProfilePublic
            ? " This profile is public, so anyone holding a shared availability link will see these days struck out."
            : " This profile isn't public, so the block stays internal."}
        </p>

        {!view.canEdit && (
          <Problem>
            Your role on this profile can read blocked dates but not change them. An owner, admin or
            editor can.
          </Problem>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Eyebrow>Blocked dates</Eyebrow>
          {view.isLoading ? (
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>Loading…</p>
          ) : view.blocks.length === 0 ? (
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>Nothing blocked yet.</p>
          ) : (
            view.blocks.map((block, index) => (
              <div
                key={`${block.startDate}-${block.endDate}-${block.reason ?? ""}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--elevated)",
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, color: "var(--text)" }}>
                    {formatBlockRange(block.startDate, block.endDate)}
                  </span>
                  {block.reason && (
                    <span style={{ display: "block", fontSize: 12, color: "var(--muted)" }}>
                      {block.reason}
                    </span>
                  )}
                </span>
                <Button
                  variant="ghost"
                  onClick={() => view.removeBlock(index)}
                  disabled={!view.canEdit || view.isSaving}
                  aria-label={`Remove ${formatBlockRange(block.startDate, block.endDate)}`}
                >
                  <Icon name="trash" size={15} />
                </Button>
              </div>
            ))
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Eyebrow>Add a block</Eyebrow>
          {/* The flex sizing goes on wrappers, not on the fields: a
              `DateTimeField`'s `style` is forwarded to the <input> itself. */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 150px" }}>
              <DateTimeField
                type="date"
                label="From"
                value={view.startDate}
                onChange={(event) => view.setStartDate(event.target.value)}
                disabled={!view.canEdit}
              />
            </div>
            <div style={{ flex: "1 1 150px" }}>
              <DateTimeField
                type="date"
                label="To (optional)"
                value={view.endDate}
                onChange={(event) => view.setEndDate(event.target.value)}
                disabled={!view.canEdit}
              />
            </div>
          </div>
          <TextField
            label="Reason (optional)"
            value={view.reason}
            placeholder="Touring, holiday, private hire…"
            onChange={(event) => view.setReason(event.target.value)}
            disabled={!view.canEdit}
          />
          {view.formError && <Problem>{view.formError}</Problem>}
          <div>
            <Button
              variant="secondary"
              leftIcon={<Icon name="plus" size={14} />}
              onClick={view.addBlock}
              disabled={!view.canEdit || view.isSaving}
            >
              Add block
            </Button>
          </div>
        </div>

        {view.saveError && <Problem>{view.saveError}</Problem>}
        {view.isDirty && !view.saveError && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>
            Unsaved — nothing is blocked until you save.
          </p>
        )}
      </div>
    </Modal>
  );
}
