import { useToast } from "@showme/design-system";
import { useCallback } from "react";
import {
  type IcsEntry,
  type IcsEventStatus,
  buildIcsCalendar,
  downloadIcsFile,
  icsFileName,
} from "../lib/calendarIcsExport";
import { type CalendarEvent, type CalendarLabelMode, chipLabel } from "./CalendarEventChip";

/**
 * "Export ICS" on the Calendar toolbar.
 *
 * WHAT THE FILE CONTAINS — decided here, and stated in the toast so the user is
 * never guessing:
 *
 * - **The period on screen, and only that.** Month view exports the calendar
 *   month, week view the seven days, day view the one day. The button sits in
 *   the toolbar under the period's own heading, so "what I am looking at" is the
 *   only scope a reader can predict without being told. Widening the view or
 *   clearing a filter and pressing again is how you get more.
 * - **Everything the grid is drawing** — dated events AND standalone calendar
 *   items (tasks, appointments, notes) — after the Performer / Venue text
 *   filters and the status filter. What you see is what you get; a file that
 *   quietly contained rows the screen was hiding would be worse than useless.
 * - **Cancelled shows included, marked `STATUS:CANCELLED`.** Dropping them would
 *   leave a stale entry sitting in whatever calendar imported the show last
 *   week, because a UID that stops being mentioned is not a cancellation. RFC
 *   5545 has a word for this and clients honour it.
 * - **Summaries follow the Performer / Event Name / Both toggle**, so the file
 *   reads the way the screen reads. Nothing is lost by that choice: DESCRIPTION
 *   always carries the event name, the performer and what kind of entry it is.
 */

/** Which of the design-system statuses mean a settled commitment (§3.8.1.11). */
const CONFIRMED_STATUSES = new Set(["confirmed", "concluded"]);

/**
 * A standalone calendar item is the user's own diary entry — there is no
 * counterparty and nothing to agree, so it exports as CONFIRMED. Only real
 * events carry a negotiation status worth reporting.
 */
function icsStatusFor(event: CalendarEvent): IcsEventStatus {
  if (!event.eventId) return "CONFIRMED";
  if (event.status === "cancelled") return "CANCELLED";
  return CONFIRMED_STATUSES.has(event.status) ? "CONFIRMED" : "TENTATIVE";
}

/**
 * The full picture, regardless of which label mode shortened the SUMMARY.
 *
 * The second line is named for what it actually holds: on a real event it is the
 * act on stage, resolved from participants; on a standalone calendar item the
 * same field is `entity` — whatever the note or appointment is ABOUT — and
 * calling that a performer would be a small lie repeated in every export.
 */
function descriptionFor(event: CalendarEvent): string {
  const lines = [`${event.eventId ? "Event" : "Title"}: ${event.eventName}`];
  if (event.performer) {
    lines.push(`${event.eventId ? "Performer" : "Related to"}: ${event.performer}`);
  }
  if (event.statusLabel) lines.push(`Status: ${event.statusLabel}`);
  return lines.join("\n");
}

export function calendarEventToIcsEntry(
  event: CalendarEvent,
  labelMode: CalendarLabelMode,
  endTime?: string,
): IcsEntry {
  return {
    id: event.id,
    date: event.date,
    // Only calendar items carry a clock time; an event is dated, not timed, so
    // it exports as a whole-day entry. See `calendarIcsExport` for why that
    // distinction is load-bearing.
    startTime: event.startTime,
    endTime,
    summary: chipLabel(event, labelMode),
    description: descriptionFor(event),
    status: icsStatusFor(event),
  };
}

export interface CalendarIcsExportOptions {
  /** Exactly the entries the grid is drawing — already filtered. */
  events: CalendarEvent[];
  labelMode: CalendarLabelMode;
  /** The inclusive `yyyy-mm-dd` span currently on screen. */
  range: { from: string; to: string };
  /** The heading over the calendar ("August 2026"), reused as the file's name. */
  periodTitle: string;
  /**
   * Entry id → wall-clock end time. It arrives separately because `CalendarEvent`
   * — the shape the three grids consume — carries a start time but no end (a
   * chip has no room to draw one). Without it every timed entry would export as
   * a zero-length blip instead of the 15:00–16:00 it actually is.
   */
  endTimeById?: Map<string, string>;
}

export function useCalendarIcsExport(options: CalendarIcsExportOptions): () => void {
  const toast = useToast();
  const { events, labelMode, range, periodTitle, endTimeById } = options;

  return useCallback(() => {
    const inRange = events.filter((event) => event.date >= range.from && event.date <= range.to);
    if (inRange.length === 0) {
      toast.info(`Nothing to export — ${periodTitle} is empty.`);
      return;
    }

    const contents = buildIcsCalendar(
      inRange.map((event) => calendarEventToIcsEntry(event, labelMode, endTimeById?.get(event.id))),
      { calendarName: `shoWMe — ${periodTitle}` },
    );

    try {
      downloadIcsFile(icsFileName(range.from, range.to), contents);
    } catch {
      // A blocked object URL or a denied download is the only way this fails,
      // and it fails silently in the browser — say so rather than looking dead.
      toast.error("Couldn't start the download — your browser blocked it.");
      return;
    }

    const noun = inRange.length === 1 ? "entry" : "entries";
    toast.success(`Exported ${inRange.length} ${noun} for ${periodTitle}.`);
  }, [events, labelMode, range.from, range.to, periodTitle, endTimeById, toast]);
}
