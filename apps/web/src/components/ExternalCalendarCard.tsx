import { Card, Icon } from "@showme/design-system";
import { Eyebrow } from "./primitives";
import type {
  ExternalCalendarEntriesView,
  ExternalCalendarEntry,
} from "./useExternalCalendarEntries";

/**
 * "From your calendar" — the imported entries that touch the period on screen,
 * and the two decisions a user may make about each one.
 *
 * WHY A RAIL CARD AND NOT ONLY A CHIP. An imported entry does appear on the grid
 * (muted, labelled "External" in its preview), but the grid is a glance, and both
 * of these actions have consequences worth reading before taking: one changes what
 * strangers see on a public availability link, the other creates a show that will
 * eventually cost a plan slot. Putting them beside the calendar, next to the
 * blocked-dates card they belong with, gives each one room for the sentence that
 * explains it.
 *
 * The card is deliberately dumb: every decision lives in
 * `useExternalCalendarEntries`.
 */

export interface ExternalCalendarCardProps {
  view: ExternalCalendarEntriesView;
  /** What the calendar is showing, for the empty-state sentence. */
  periodTitle: string;
  /** Whether this account may create events at all (only operators host shows). */
  canCreateEvent: boolean;
  onOpenEvent: (eventId: string) => void;
}

/** "Fri 10 Oct", or "10–14 Oct" for an entry that runs across days. */
function whenLabel(entry: ExternalCalendarEntry): string {
  const day = formatDay(entry.date);
  if (entry.endDate !== entry.date) return `${day} → ${formatDay(entry.endDate)}`;
  if (entry.isAllDay) return `${day} · all day`;
  return `${day} · ${entry.startTime}–${entry.endTime}`;
}

/**
 * `2026-10-10` → `Sat 10 Oct`, built from the string's own parts.
 *
 * NOT `new Date("2026-10-10")`: a date-only ISO string is parsed as UTC midnight,
 * so reading it back with local getters returns the 9th anywhere west of
 * Greenwich. A bare date has no zone to convert from — it is already the day.
 */
function formatDay(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function ExternalCalendarCard({
  view,
  periodTitle,
  canCreateEvent,
  onOpenEvent,
}: ExternalCalendarCardProps) {
  return (
    <Card padding="md" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Eyebrow>From your calendar</Eyebrow>

      {view.entries.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--muted)" }}>
          {`Nothing imported in ${periodTitle}.`}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {view.entries.map((entry) => (
            <ExternalEntryRow
              key={entry.id}
              entry={entry}
              view={view}
              canCreateEvent={canCreateEvent}
              onOpenEvent={onOpenEvent}
            />
          ))}
        </div>
      )}

      {view.error && (
        <p style={{ margin: 0, fontSize: 12, color: "#EE5746" }} role="alert">
          {view.error}
        </p>
      )}
    </Card>
  );
}

function ExternalEntryRow({
  entry,
  view,
  canCreateEvent,
  onOpenEvent,
}: {
  entry: ExternalCalendarEntry;
  view: ExternalCalendarEntriesView;
  canCreateEvent: boolean;
  onOpenEvent: (eventId: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span
          aria-hidden
          style={{ width: 9, height: 9, borderRadius: 3, background: "#B8A99B", flexShrink: 0 }}
        />
        <span
          style={{
            fontSize: 12.5,
            color: "var(--text)",
            fontStyle: entry.titleWithheld ? "italic" : "normal",
          }}
        >
          {entry.title}
        </span>
      </span>

      <span style={{ fontSize: 11.5, color: "var(--muted)", paddingLeft: 16 }}>
        {whenLabel(entry)}
        {entry.source ? ` · ${entry.source}` : ""}
      </span>

      {entry.titleWithheld && (
        // Said out loud rather than left to look like the entry's real name.
        <span style={{ fontSize: 11, color: "var(--dim)", paddingLeft: 16 }}>
          Title hidden — this came from someone else's connected calendar.
        </span>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, paddingLeft: 16 }}>
        <button
          type="button"
          disabled={view.isSaving}
          onClick={() => view.setBlocksAvailability(entry.id, !entry.blocksAvailability)}
          style={linkButtonStyle(view.isSaving)}
        >
          <Icon name={entry.blocksAvailability ? "calendar-check" : "check"} size={12} />
          {entry.blocksAvailability ? "Mark available anyway" : "Block this time again"}
        </button>

        {entry.promotedEventId ? (
          <button
            type="button"
            onClick={() => onOpenEvent(entry.promotedEventId as string)}
            style={linkButtonStyle(false)}
          >
            <Icon name="calendar" size={12} />
            Open the show
          </button>
        ) : (
          canCreateEvent && (
            <button
              type="button"
              disabled={view.isSaving}
              onClick={() => view.promote(entry.id, onOpenEvent)}
              style={linkButtonStyle(view.isSaving)}
            >
              <Icon name="plus" size={12} />
              Turn into a show
            </button>
          )
        )}
      </div>

      <span style={{ fontSize: 11, color: "var(--dim)", paddingLeft: 16 }}>
        {entry.blocksAvailability
          ? entry.isAllDay
            ? "This day is not offered as available."
            : "These hours are not offered as available."
          : "Offered as available anyway."}
      </span>
    </div>
  );
}

function linkButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    all: "unset",
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    cursor: disabled ? "default" : "pointer",
    fontSize: 12,
    fontWeight: 500,
    color: disabled ? "var(--dim)" : "#EE5746",
  };
}
