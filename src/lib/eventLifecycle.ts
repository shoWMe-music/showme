import type { Event, EventStatus } from "@/lib/models";

/**
 * YYYY-MM-DD for today in the user's local timezone.
 * Event dates are stored as plain YYYY-MM-DD with no timezone, so we compare
 * against local "today" rather than UTC.
 */
export function todayLocalIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Statuses that should auto-cancel when their date passes without being confirmed. */
export const UNCONFIRMED_STATUSES: EventStatus[] = [
  "draft",
  "suggested",
  "pending",
  "on_hold",
];

/**
 * True when the event is confirmed and today is the event date — settlement
 * should open and the status badge should glow as "Show day".
 */
export function isShowDay(event: Pick<Event, "eventStatus" | "date">): boolean {
  return event.eventStatus === "confirmed" && event.date === todayLocalIso();
}

/** True when settlement should be openable (show day or after). */
export function settlementUnlocked(
  event: Pick<Event, "eventStatus" | "date">,
): boolean {
  return event.eventStatus === "concluded" || isShowDay(event);
}
