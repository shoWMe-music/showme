import { type RoomBooking, type RoomId, type RoomSelection, occupiedDates } from "@showme/shared";
// `calendarGrid` is a plain module that happens to live under components, and `dayKey` is
// the app's one definition of a local day key. A second copy here would be a second
// opinion about which night a Date falls on.
import { dayKey } from "../components/calendarGrid";

/**
 * THE FREE NIGHTS IN A WINDOW — for one room, or for a whole calendar.
 *
 * `@showme/shared`'s `occupiedDates` answers which nights are already sold. This adds the
 * two things the share modal asks on top of it, and nothing else: the window the sharer
 * chose (from / to, and which weekdays they are willing to offer), and the profile's own
 * recorded unavailability.
 *
 * It is a separate module because the answer is now needed **once per room** as well as
 * once for the selection — a shared link carries which rooms are free on each night
 * (ClickUp `123qy9rpqp0` §2), and the union of those rooms has to be exactly the list the
 * modal is already showing. One function, asked N+1 times, is what makes that true by
 * construction rather than by two pieces of code agreeing.
 */

/** A whole-day block from `GET /profiles/:id/availability`, inclusive at both ends. */
export interface BlockedRange {
  startDate: string;
  endDate: string;
}

/** Everything the window rule needs that is not the room being asked about. */
export interface AvailabilityWindow {
  from: string;
  to: string;
  /** Monday = 0 … Sunday = 6, as the modal's weekday pills index them. */
  weekdays: number[];
  /** Every room of the venue — what "the venue is full" is measured against. */
  rooms: RoomId[];
  bookings: RoomBooking[];
  /**
   * The profile's own recorded unavailability — "Mark Unavailable", plus days taken by
   * entries imported from a connected calendar. Venue-WIDE by construction:
   * `profile_unavailability` has no room column, and rightly so — a building closed for
   * renovation is closed in every room of it.
   */
  blocked: BlockedRange[];
}

/** How far a share window may reach, so a hand-typed year can't build a 100k-date link. */
export const MAX_WINDOW_DAYS = 366;

/** Monday = 0 … Sunday = 6. */
function mondayFirstWeekday(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** Every `yyyy-mm-dd` from `from` to `to` inclusive; empty when the range is inverted. */
export function datesInRange(from: string, to: string): string[] {
  if (!from || !to || from > to) return [];
  const cursor = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return [];

  const days: string[] = [];
  while (cursor <= end && days.length < MAX_WINDOW_DAYS) {
    days.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/**
 * The nights this room (or this whole calendar) is free, inside the window.
 *
 * Three subtractions, in this order: the nights already sold in the room being asked
 * about, the days the profile has blocked outright, and the weekdays the sharer did not
 * tick. The first is the shared rule; the other two are the sharer's own framing of the
 * question.
 */
export function freeDatesFor(selection: RoomSelection, window: AvailabilityWindow): string[] {
  const busy = occupiedDates(selection, window.rooms, window.bookings);
  for (const range of window.blocked) {
    for (const day of datesInRange(range.startDate, range.endDate)) busy.add(day);
  }

  const weekdays = new Set(window.weekdays);
  return datesInRange(window.from, window.to)
    .filter((isoDate) => weekdays.has(mondayFirstWeekday(new Date(`${isoDate}T00:00:00`))))
    .filter((isoDate) => !busy.has(isoDate));
}
