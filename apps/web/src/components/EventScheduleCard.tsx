import { Button, Icon, Select, TextField } from "@showme/design-system";
import { useState } from "react";
import { DateTimeField } from "./DateTimeField";
import styles from "./eventDetailsFields.module.css";
import { CardHeader, GlyphButton, MonoPill, SectionCard, XIcon } from "./eventUi";
import {
  type ScheduleCategory,
  type ScheduleItem,
  useEventScheduleEditor,
} from "./useEventScheduleEditor";

const CATEGORY_OPTIONS = [
  { value: "production", label: "Production" },
  { value: "crew", label: "Crew call" },
];

export interface EventScheduleCardProps {
  eventId: string;
  /** The event's own date — the day an added item defaults to. */
  eventDate: string | null;
  /** `event.edit`, the same signal the rest of the tab uses. */
  canEdit: boolean;
}

/**
 * The event's run-of-show. Backed by the `schedule_items` table through
 * `/events/:id/schedule` (`schedule.view` to read, `schedule.edit` to write) —
 * NOT by `events.extras`, which is for the read-with-parent leaves only.
 *
 * Times are offset-free local wall clock (`yyyy-mm-ddThh:mm`, decisions #10),
 * anchored by the event's own timezone; the card never converts them, so a
 * 01:00 curfew stays 01:00 for everyone reading the page.
 */
export function EventScheduleCard({ eventId, eventDate, canEdit }: EventScheduleCardProps) {
  const schedule = useEventScheduleEditor(eventId);

  return (
    <SectionCard>
      <CardHeader
        icon={<Icon name="clock" size={17} />}
        iconColor="var(--brand-amber)"
        title="Event Schedule"
        action={<MonoPill>{schedule.items.length} items</MonoPill>}
      />

      {schedule.isError && (
        <div style={{ color: "var(--dim)", fontSize: 13 }}>Couldn't load the schedule.</div>
      )}
      {!schedule.isError && schedule.items.length === 0 && (
        <div style={{ color: "var(--dim)", fontSize: 13 }}>
          {schedule.isPending ? "Loading the run of show…" : "No schedule yet."}
        </div>
      )}

      {schedule.items.map((item) =>
        canEdit ? (
          // Re-keyed on the stored values so a change from the server (our own
          // save, or another editor's) reseeds the row's draft.
          <EditableScheduleRow
            key={`${item.id}-${item.localDateTime}-${item.label}`}
            item={item}
            eventDate={eventDate}
            onChange={(change) => schedule.update(item.id, change)}
            onRemove={() => schedule.remove(item.id)}
          />
        ) : (
          <ReadOnlyScheduleRow key={item.id} item={item} eventDate={eventDate} />
        ),
      )}

      {canEdit && <AddScheduleRow eventDate={eventDate} onAdd={schedule.add} />}
    </SectionCard>
  );
}

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "9px 0",
  borderBottom: "1px solid var(--border)",
} as const;

function ReadOnlyScheduleRow({
  item,
  eventDate,
}: {
  item: ScheduleItem;
  eventDate: string | null;
}) {
  return (
    <div style={rowStyle}>
      <span
        style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--muted)", width: 50 }}
      >
        {timeLabel(item.localDateTime)}
      </span>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--brand-red)" }} />
      <span style={{ flex: 1, color: "var(--text)", fontSize: 13.5 }}>{item.label}</span>
      {dayLabel(item.localDateTime, eventDate) && (
        <MonoPill>{dayLabel(item.localDateTime, eventDate)}</MonoPill>
      )}
      {item.category === "crew" && <MonoPill>Crew call</MonoPill>}
    </div>
  );
}

function EditableScheduleRow({
  item,
  eventDate,
  onChange,
  onRemove,
}: {
  item: ScheduleItem;
  eventDate: string | null;
  onChange: (change: { localDateTime?: string | null; label?: string }) => void;
  onRemove: () => void;
}) {
  const [localDateTime, setLocalDateTime] = useState(toInputValue(item.localDateTime));
  const [label, setLabel] = useState(item.label);

  // Commit on blur, not on keystroke: one row edit is one request.
  const commitTime = () => {
    const next = localDateTime === "" ? null : localDateTime;
    if (next !== item.localDateTime) onChange({ localDateTime: next });
  };
  const commitLabel = () => {
    const trimmed = label.trim();
    // The API requires a non-empty label; refuse rather than send a 400.
    if (trimmed === "") {
      setLabel(item.label);
      return;
    }
    if (trimmed !== item.label) onChange({ label: trimmed });
  };

  return (
    <div style={{ ...rowStyle, gap: 10 }}>
      <div style={{ width: 190 }}>
        <DateTimeField
          type="datetime-local"
          className={styles.mono}
          aria-label={`Time for ${item.label}`}
          value={localDateTime}
          onChange={(changeEvent) => setLocalDateTime(changeEvent.target.value)}
          onBlur={commitTime}
        />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <TextField
          aria-label={`Label for ${item.label}`}
          value={label}
          onChange={(changeEvent) => setLabel(changeEvent.target.value)}
          onBlur={commitLabel}
        />
      </div>
      {dayLabel(item.localDateTime, eventDate) && (
        <MonoPill>{dayLabel(item.localDateTime, eventDate)}</MonoPill>
      )}
      {item.category === "crew" && <MonoPill>Crew call</MonoPill>}
      <GlyphButton ariaLabel={`Remove ${item.label}`} onClick={onRemove}>
        <XIcon />
      </GlyphButton>
    </div>
  );
}

function AddScheduleRow({
  eventDate,
  onAdd,
}: {
  eventDate: string | null;
  onAdd: (item: {
    localDateTime: string | null;
    label: string;
    category: ScheduleCategory;
  }) => void;
}) {
  const [localDateTime, setLocalDateTime] = useState(defaultTime(eventDate));
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<ScheduleCategory>("production");

  const add = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    onAdd({ localDateTime: localDateTime === "" ? null : localDateTime, label: trimmed, category });
    setLabel("");
    setLocalDateTime(defaultTime(eventDate));
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-end",
        flexWrap: "wrap",
        marginTop: 14,
      }}
    >
      <div style={{ width: 190 }}>
        <DateTimeField
          label="Time"
          type="datetime-local"
          className={styles.mono}
          value={localDateTime}
          onChange={(changeEvent) => setLocalDateTime(changeEvent.target.value)}
        />
      </div>
      <div style={{ flex: 1, minWidth: 160 }}>
        <TextField
          label="What happens"
          value={label}
          placeholder="e.g. Doors open"
          onChange={(changeEvent) => setLabel(changeEvent.target.value)}
          onKeyDown={(keyEvent) => keyEvent.key === "Enter" && add()}
        />
      </div>
      <div style={{ width: 150 }}>
        <Select
          label="Kind"
          value={category}
          onChange={(value) => setCategory(value as ScheduleCategory)}
          options={CATEGORY_OPTIONS}
        />
      </div>
      <Button
        variant="secondary"
        aria-label="Add schedule item"
        onClick={add}
        disabled={label.trim() === ""}
      >
        + Add
      </Button>
    </div>
  );
}

/** "19:00" from an offset-free local stamp; never parsed as a Date — that would
 * re-interpret a wall clock in the reader's own zone. */
function timeLabel(localDateTime: string | null): string {
  return localDateTime ? localDateTime.slice(11, 16) : "—";
}

/** `datetime-local` wants exactly `yyyy-mm-ddThh:mm`. */
function toInputValue(localDateTime: string | null): string {
  return localDateTime ? localDateTime.slice(0, 16) : "";
}

/** An item on another day than the event itself (an after-midnight curfew, a
 * previous-day load-in) says so, or the bare time would read as a mistake. */
function dayLabel(localDateTime: string | null, eventDate: string | null): string | null {
  if (!localDateTime || !eventDate) return null;
  const itemDate = localDateTime.slice(0, 10);
  const day = eventDate.slice(0, 10);
  if (itemDate === day) return null;
  const difference = Math.round(
    (Date.parse(`${itemDate}T00:00Z`) - Date.parse(`${day}T00:00Z`)) / 86_400_000,
  );
  if (Number.isNaN(difference)) return itemDate;
  return difference > 0 ? `+${difference} day` : `${difference} day`;
}

/** A new item lands on the event's own evening by default. */
function defaultTime(eventDate: string | null): string {
  return eventDate ? `${eventDate.slice(0, 10)}T19:00` : "";
}
