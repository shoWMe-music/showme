import { Button, Card, Icon, KeyValueRow, STATUS_COLOR, STATUS_LABEL } from "@showme/design-system";
import type { RefObject } from "react";
import { useEffect } from "react";
import { formatDayWithWeekday } from "../lib/format";
import type { CalendarEvent } from "./CalendarEventChip";
import { PickerPopoverPanel } from "./PickerPopoverPanel";
import { usePublishToggle } from "./usePublishToggle";

/** The little card that hangs off a calendar chip when you click it: what this
 * entry is, when it is, who it involves — and, for a real event, the way through
 * to its workspace.
 *
 * NO FIELD EDITS, and one named act. `86cbcn189` says the calendar is *"view-only:
 * no event edits from the calendar; send users to the event manager"*, and
 * `123qy9rnk21` — three days later — asks this popover for quick actions including
 * Publish/Unpublish. Both are urgent and they disagree, so the later one is read as a
 * refinement of the earlier: the event's FACTS (date, venue, room, status) are the
 * event workspace's business and are not editable here, while a named one-press act
 * with its own capability is. Archiving stays off it entirely — that is the Events
 * list's, by Ran's own separate bullet.
 *
 * Everything on it comes from the chip's own data. Deliberately no fetch: the
 * month grid draws dozens of chips, and a request per click would turn a glance
 * at the schedule into a request storm for information the grid already has — which
 * is also why the facts `123qy9rnk21` asks for are carried on `CalendarEvent` rather
 * than looked up when the panel opens. */

const PANEL_WIDTH = 268;

/** Rough panel height, used only to decide whether the panel opens downwards or
 * flips above the chip, so a few pixels either way are harmless. */
const HEADER_HEIGHT = 96;
const FACT_ROW_HEIGHT = 36;
const OPEN_EVENT_HEIGHT = 52;
const CALENDAR_ITEM_NOTE_HEIGHT = 27;

export interface CalendarEntryPreviewProps {
  entry: CalendarEvent;
  /**
   * `HH:mm`, already normalised by the chip.
   *
   * Passed in rather than formatted here so this file never has to import back
   * from `CalendarEventChip` — the chip mounts the preview, and a runtime import
   * the other way would close the circle.
   */
  time: string | null;
  /** The chip's rectangle: the panel hangs off it. */
  anchor: DOMRect;
  panelRef: RefObject<HTMLDialogElement | null>;
  /** Continue to the event workspace. Absent for a standalone calendar item —
   * there is no page to go to, so no footer button is drawn. */
  onOpenEvent?: () => void;
}

export function CalendarEntryPreview({
  entry,
  time,
  anchor,
  panelRef,
  onOpenEvent,
}: CalendarEntryPreviewProps) {
  const publishing = usePublishToggle();
  /**
   * WHO GETS THE PUBLISH BUTTON — the three conditions the API itself applies, asked
   * here so the popover never offers a press it knows will be refused (the lesson of
   * QA4-9 on the events row menu).
   *
   * `event.publish` is the capability; a standalone calendar item has no event to
   * publish; and only a CONFIRMED show has a public page at all (A-22), which is why an
   * already-published concluded night can still be taken down but a pending one is
   * offered nothing.
   */
  const mayPublish =
    entry.eventId != null &&
    (entry.capabilities?.includes("event.publish") ?? false) &&
    (entry.published === true || entry.status === "confirmed");
  const color = STATUS_COLOR[entry.status];
  // "Confirmed" for an event, "Appointment" for a calendar item — the palette is
  // shared between the two, so the WORD is the only thing that tells them apart.
  const kindLabel = entry.statusLabel ?? STATUS_LABEL[entry.status];
  const facts = entryFacts(entry, time);

  // "Open event" is the panel's primary control, so it takes focus as the panel
  // opens: the panel is portalled to the end of `<body>`, and a Tab from the chip
  // would otherwise walk into the NEXT chip and never reach this button. Found by
  // query rather than by ref because the button is a design-system component.
  useEffect(() => {
    if (!onOpenEvent) return;
    panelRef.current?.querySelector<HTMLElement>("[data-open-event]")?.focus();
  }, [onOpenEvent, panelRef]);

  return (
    <PickerPopoverPanel
      anchor={anchor}
      panelRef={panelRef}
      width={PANEL_WIDTH}
      estimatedHeight={
        HEADER_HEIGHT +
        facts.length * FACT_ROW_HEIGHT +
        (onOpenEvent ? OPEN_EVENT_HEIGHT : CALENDAR_ITEM_NOTE_HEIGHT)
      }
      label={`Preview: ${entry.eventName}`}
      // One control at most, but Tab must not walk out of a panel portalled to
      // the end of <body> and land at the bottom of the document.
      containTab
    >
      <Card
        padding="md"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          boxShadow: "var(--shadow-lg)",
          background: "var(--surface)",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 6,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              padding: "3px 9px",
              borderRadius: 999,
              background: color.tint,
              color: color.fg,
            }}
          >
            {kindLabel}
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", lineHeight: 1.35 }}>
            {entry.eventName}
          </span>
        </div>

        <div style={{ borderTop: "1px solid var(--border)" }}>
          {facts.map((fact) => (
            <KeyValueRow key={fact.label} label={fact.label} value={fact.value} />
          ))}
        </div>

        {/* HOLD SETTINGS — Ran: *"If there are hold it should also have a 'Hold
            settings' section"* (`123qy9rnk21`). Read-only here: the rank and the
            auto-promote switch are the hold panel's to change, and changing a queue
            position from a calendar chip is exactly the in-place editing `86cbcn189`
            rules out. Shown only for a night that IS a hold. */}
        {entry.holdRank != null && (
          <div
            style={{
              borderTop: "1px solid var(--border)",
              paddingTop: 8,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--muted)",
              }}
            >
              Hold settings
            </span>
            <KeyValueRow label="Queue position" value={`#${entry.holdRank}`} />
            <KeyValueRow
              label="Auto-promote"
              value={entry.holdAutoPromote ? "On, so it moves up if a hold above it falls" : "Off"}
            />
          </div>
        )}

        {mayPublish && entry.eventId && (
          <Button
            variant="ghost"
            onClick={() => publishing.toggle(entry.eventId as string, entry.published === true)}
            disabled={publishing.isPending}
            style={{ alignSelf: "stretch", justifyContent: "center" }}
          >
            {publishing.isPending
              ? entry.published
                ? "Unpublishing…"
                : "Publishing…"
              : entry.published
                ? "Unpublish"
                : "Publish"}
          </Button>
        )}

        {onOpenEvent ? (
          <Button
            variant="secondary"
            data-open-event=""
            onClick={onOpenEvent}
            rightIcon={<Icon name="chevron-right" size={14} />}
            style={{ alignSelf: "stretch", justifyContent: "center" }}
          >
            Open event
          </Button>
        ) : (
          <span style={{ fontSize: 11.5, color: "var(--dim)", lineHeight: 1.4 }}>
            Calendar item — not linked to an event.
          </span>
        )}
      </Card>
    </PickerPopoverPanel>
  );
}

/** The facts worth showing, in reading order, with the empty ones left out — a
 * preview that prints "Performer —" is worse than one that prints nothing. */
function entryFacts(entry: CalendarEvent, time: string | null): { label: string; value: string }[] {
  const facts = [{ label: "Date", value: formatDayWithWeekday(entry.date) }];
  // Only calendar items carry a clock time; an event is dated, not timed.
  if (time) facts.push({ label: "Time", value: time });
  if (entry.performer) {
    // The same field means different things on either side: on an event it is
    // the performer resolved from the participants, on a calendar item it is the
    // free-text entity the item was written against ("Nordic Synth Showcase").
    facts.push({ label: entry.eventId ? "Performer" : "Related to", value: entry.performer });
  }
  /*
   * VENUE AND CITY (ClickUp `123qy9rnk21`: *"Performer/s name/s + Venue name + City"*).
   *
   * One row, not two. A venue and the city it stands in read as one answer to "where" —
   * "The Lantern Hall · Stockholm" — and splitting them would put two labels in a
   * 268px panel to say one thing. The city is dropped rather than shown empty for a
   * venue that is free text with no profile behind it.
   */
  if (entry.venueName) {
    facts.push({
      label: "Venue",
      value: entry.city ? `${entry.venueName} · ${entry.city}` : entry.venueName,
    });
  }
  /*
   * STATUS as a ROW as well as the pill at the top. Ran lists it among the details, and
   * the pill is doing double duty: for a calendar item it says the KIND
   * ("Appointment"), so on those the word is not a status at all. Spelling it out
   * again only for a real event keeps both readings honest without repeating itself on
   * the entries where the pill already is the answer.
   */
  if (entry.eventId && entry.statusLabel) {
    facts.push({ label: "Status", value: entry.statusLabel });
  }
  return facts;
}
