import { Button, Card, Icon, KeyValueRow, STATUS_COLOR, STATUS_LABEL } from "@showme/design-system";
import type { RefObject } from "react";
import { useEffect } from "react";
import type { CalendarEvent } from "./CalendarEventChip";
import { PickerPopoverPanel } from "./PickerPopoverPanel";

/** The little card that hangs off a calendar chip when you click it: what this
 * entry is, when it is, who it involves — and, for a real event, the way through
 * to its workspace.
 *
 * Everything on it comes from the chip's own data. Deliberately no fetch: the
 * month grid draws dozens of chips, and a request per click would turn a glance
 * at the schedule into a request storm for information the grid already has. */

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
  const color = STATUS_COLOR[entry.status];
  // "Confirmed" for an event, "Appointment" for a calendar item — the palette is
  // shared between the two, so the WORD is the only thing that tells them apart.
  const kindLabel = entry.statusLabel ?? STATUS_LABEL[entry.status];
  const facts = entryFacts(entry, time);

  // "Open event" is the panel's only control, so it takes focus as the panel
  // opens: the panel is portalled to the end of `<body>`, and a Tab from the chip
  // would otherwise walk into the NEXT chip and never reach this button. Found by
  // query rather than by ref because the button is a design-system component.
  useEffect(() => {
    if (!onOpenEvent) return;
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
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
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
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

        {onOpenEvent ? (
          <Button
            variant="secondary"
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
  const facts = [{ label: "Date", value: formatEntryDate(entry.date) }];
  // Only calendar items carry a clock time; an event is dated, not timed.
  if (time) facts.push({ label: "Time", value: time });
  if (entry.performer) {
    // The same field means different things on either side: on an event it is
    // the performer resolved from the participants, on a calendar item it is the
    // free-text entity the item was written against ("Nordic Synth Showcase").
    facts.push({ label: entry.eventId ? "Performer" : "Related to", value: entry.performer });
  }
  return facts;
}

/** `2026-09-12` → `Sat, 12 Sep 2026`. Parsed field by field rather than through
 * `new Date(dayKey)`, which the ES spec reads as UTC midnight and so renders as
 * the day before for every user west of Greenwich. Short form, because the row
 * it sits in is barely 180px wide. */
function formatEntryDate(dayKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) return dayKey;
  const [, year, month, day] = match;
  if (!year || !month || !day) return dayKey;
  return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
