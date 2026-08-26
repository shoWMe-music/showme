import { Button, Icon, Modal, Select, type SelectOption, TextField } from "@showme/design-system";
import { DateTimeField } from "./DateTimeField";
import { EventPublishPanel } from "./EventPublishPanel";
import type { EventInformationDraft, EventInformationFields } from "./useEventInformationEdit";

export interface EventInformationEditModalProps {
  open: boolean;
  draft: EventInformationDraft | null;
  /**
   * The rooms of the venue this event is placed at, empty when the event has no
   * venue PROFILE (the wizard captures a free-text venue name for a room the
   * operator does not run) or when that venue has recorded none. Empty means the
   * field is not drawn: a picker with nothing to pick is a dead end, and the
   * place to add a room is the venue's own profile.
   */
  roomOptions: SelectOption[];
  onChange: (fields: Partial<EventInformationFields>) => void;
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
 *
 * It is also where an event is PUBLISHED. The toggle that used to live in the
 * event header was removed, and this modal is the honest home for it: it is the
 * one place the operator is already deciding what the event says about itself.
 * The control keeps its own panel (`EventPublishPanel`) rather than becoming a
 * fifth field, because publishing is not a value that is saved with the others —
 * see that file for the reasoning.
 */
export function EventInformationEditModal({
  open,
  draft,
  roomOptions,
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
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
            {roomOptions.length > 0 && (
              <>
                <Select
                  label="Room"
                  value={draft.stageId}
                  onChange={(value) => onChange({ stageId: value })}
                  // "No room set" is a real choice, not an empty state: a show
                  // whose room nobody has decided yet is a different statement
                  // from one in the main hall — and it costs the venue every
                  // room's availability that night until it is placed.
                  options={[{ value: "", label: "No room set" }, ...roomOptions]}
                  disabled={hasConflict}
                  searchable={false}
                />
                <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: "var(--muted)" }}>
                  Each room is its own calendar — two rooms can hold two shows the same night. A
                  show with no room set counts against every room's availability.
                </p>
              </>
            )}
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
          {/* Outside the form on purpose: publishing is not one of the values the
            footer's "Save changes" writes — it is its own act, on its own route,
            and it happens the moment its button is pressed. */}
          <EventPublishPanel
            eventId={draft.publishing.eventId}
            hasUnsavedChanges={draft.publishing.hasUnsavedChanges}
            disabled={hasConflict}
          />
        </div>
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
