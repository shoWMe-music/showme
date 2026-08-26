import { Button, Icon, Modal, TextField } from "@showme/design-system";
import { DateTimeField } from "./DateTimeField";
import type { EventInformationDraft } from "./useEventInformationEdit";

export interface EventInformationEditModalProps {
  open: boolean;
  draft: EventInformationDraft | null;
  onChange: (fields: Partial<EventInformationDraft>) => void;
  onClose: () => void;
  onSave: () => void;
  onReload: () => void;
  isSaving: boolean;
  canSave: boolean;
  hasConflict: boolean;
}

/**
 * The edit state behind the Event Information card's "Edit" button. The design
 * prototype stubs the button (`openEditInfo`) without drawing a panel, so this
 * follows the app's own modal-edit pattern (DS `Modal` + `TextField`, ghost /
 * primary footer) used by the profile and invoice screens.
 *
 * Presentational only: the draft, validity and the save itself live in
 * `useEventInformationEdit`.
 */
export function EventInformationEditModal({
  open,
  draft,
  onChange,
  onClose,
  onSave,
  onReload,
  isSaving,
  canSave,
  hasConflict,
}: EventInformationEditModalProps) {
  return (
    <Modal
      open={open && draft !== null}
      onClose={onClose}
      title="Edit event information"
      width={520}
      footer={
        hasConflict ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Discard changes
            </Button>
            <Button variant="primary" onClick={onReload}>
              Reload event
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={onSave} disabled={!canSave || isSaving}>
              {isSaving ? "Saving…" : "Save changes"}
            </Button>
          </>
        )
      }
    >
      {draft && (
        <form
          onSubmit={(formEvent) => {
            formEvent.preventDefault();
            if (canSave && !isSaving) onSave();
          }}
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
          {hasConflict && <ConflictNotice />}
          <TextField
            label="Event name"
            value={draft.title}
            onChange={(changeEvent) => onChange({ title: changeEvent.target.value })}
            placeholder="e.g. Open Mic Wednesdays"
            disabled={hasConflict}
            autoFocus
          />
          <DateTimeField
            type="date"
            label="Date"
            value={draft.eventDate}
            onChange={(changeEvent) => onChange({ eventDate: changeEvent.target.value })}
            disabled={hasConflict}
          />
          <TextField
            label="Venue"
            value={draft.venueName}
            onChange={(changeEvent) => onChange({ venueName: changeEvent.target.value })}
            placeholder="e.g. The Lantern Hall (Back Room)"
            disabled={hasConflict}
          />
          <TextField
            label="Capacity"
            type="number"
            min={0}
            step={1}
            value={draft.capacity}
            onChange={(changeEvent) => onChange({ capacity: changeEvent.target.value })}
            placeholder="Leave empty for no capacity"
            disabled={hasConflict}
          />
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: "var(--muted)" }}>
            Status follows the event's own progression, and the operator and performers are the
            event's participants — none of them are edited here.
          </p>
          <button type="submit" hidden aria-hidden />
        </form>
      )}
    </Modal>
  );
}

/** A save that lost the optimistic lock — shown instead of pretending it saved. */
function ConflictNotice() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 9,
        background: "color-mix(in srgb,#F4A046 12%,transparent)",
        border: "1px solid color-mix(in srgb,#F4A046 30%,transparent)",
        borderRadius: 11,
        padding: "11px 14px",
        color: "#c8842f",
        fontSize: 12.5,
        lineHeight: 1.5,
      }}
    >
      <Icon name="alert" size={16} />
      <span>
        Someone else changed this event while you were editing. Reload it to see their version —
        your changes here were not saved.
      </span>
    </div>
  );
}
