import { Button, Modal, TextField } from "@showme/design-system";
import { DateTimeField } from "./DateTimeField";
import type { CalendarItemCreateView } from "./useCalendarItemCreate";

/**
 * "Add an appointment / note on this day" — the modal the calendar's day popover
 * opens. Presentational only; `useCalendarItemCreate` owns the write.
 */

export interface CalendarItemCreateModalProps {
  open: boolean;
  onClose: () => void;
  view: CalendarItemCreateView;
}

const KIND_COPY = {
  appointment: {
    title: "New appointment",
    titleLabel: "What is it?",
    placeholder: "Production call, site visit, interview…",
  },
  note: {
    title: "New note",
    titleLabel: "Note",
    placeholder: "Anything worth remembering on this day",
  },
} as const;

export function CalendarItemCreateModal({ open, onClose, view }: CalendarItemCreateModalProps) {
  const copy = KIND_COPY[view.kind];

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={480}
      title={copy.title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={view.submit} disabled={!view.canSubmit}>
            {view.isSaving ? "Saving…" : copy.title.replace("New ", "Add ")}
          </Button>
        </>
      }
    >
      <form
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
        onSubmit={(event) => {
          event.preventDefault();
          view.submit();
        }}
      >
        <TextField
          label={copy.titleLabel}
          value={view.title}
          placeholder={copy.placeholder}
          onChange={(event) => view.setTitle(event.target.value)}
          autoFocus
        />
        <DateTimeField
          type="date"
          label="Date"
          value={view.date}
          onChange={(event) => view.setDate(event.target.value)}
        />
        {/* A note is filed on a day; only an appointment has a clock. */}
        {view.kind === "appointment" && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 130px" }}>
              <DateTimeField
                type="time"
                label="Start (optional)"
                value={view.startTime}
                onChange={(event) => view.setStartTime(event.target.value)}
              />
            </div>
            <div style={{ flex: "1 1 130px" }}>
              <DateTimeField
                type="time"
                label="End (optional)"
                value={view.endTime}
                onChange={(event) => view.setEndTime(event.target.value)}
              />
            </div>
          </div>
        )}
        {view.error && (
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--brand-red)" }} role="alert">
            {view.error}
          </p>
        )}
        {/* Submit on Enter without a visible second button. */}
        <button type="submit" style={{ display: "none" }} aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
