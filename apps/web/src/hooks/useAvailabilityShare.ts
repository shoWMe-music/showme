import { useGetApiV1Profiles, useGetApiV1ProfilesIdAvailability } from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { useMemo, useState } from "react";
import type { CalendarEvent } from "../components";
import { dayKey } from "../components/calendarGrid";
import { getActiveProfileId } from "../lib/activeProfile";
import {
  type AvailabilitySnapshot,
  buildAvailabilityShareLink,
} from "../lib/availabilityShareLink";
import type { EventItem } from "./useEventList";

/**
 * Everything behind the "Check & Share Availability" modal: the form state, the
 * free days it derives from the real schedule, and the public link that carries
 * that snapshot. The Calendar screen stays a dumb renderer over this.
 */

/** How far a share window may reach, so a hand-typed year can't build a 100k-date link. */
const MAX_WINDOW_DAYS = 366;

/** Statuses that make a day busy, keyed by the modal's two "show as unavailable" toggles. */
type BusyToggles = { confirmed: boolean; held: boolean };

/** Monday = 0 … Sunday = 6, matching the modal's weekday pills. */
function mondayFirstWeekday(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** Every `yyyy-mm-dd` from `from` to `to` inclusive; empty when the range is inverted. */
function datesInRange(from: string, to: string): string[] {
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

/** A whole-day block from `GET /profiles/:id/availability`, inclusive at both ends. */
interface BlockedRange {
  startDate: string;
  endDate: string;
}

/**
 * The days the sharer is NOT free. THREE sources, and each one closes a hole the
 * other two leave open:
 *
 * 1. **The calendar feed** — the month on screen, for standalone entries.
 * 2. **The event list** — the whole schedule, because a share window routinely
 *    runs past the month edge and a month-only busy set advertises booked days.
 * 3. **The profile's computed availability** — the hand-made blocked dates AND
 *    the days taken by entries imported from a connected calendar. This one was
 *    simply missing: "Mark Unavailable" wrote rows that the share modal never
 *    read, so a user could block a week by hand and still hand out a link
 *    offering it. It is fetched for the SHARE window, not the month, which is
 *    why it is asked for separately from the grid's own feed.
 *
 * What is deliberately NOT here: the timed `busyTimes` half of that response. An
 * entry from 09:00 to 09:30 does not take the night — the whole point of
 * separating hours from days is that such a day stays offerable — and the shared
 * link's format is a list of DATES, with nowhere to put an hour.
 */
function busyDates(
  calendarEvents: CalendarEvent[],
  events: EventItem[],
  blockedRanges: BlockedRange[],
  toggles: BusyToggles,
): Set<string> {
  const busy = new Set<string>();

  for (const entry of calendarEvents) {
    const isBusy =
      (toggles.confirmed && entry.status === "confirmed") ||
      (toggles.held && entry.status === "hold");
    if (isBusy) busy.add(entry.date);
  }

  for (const event of events) {
    if (!event.eventDate) continue;
    const isBusy =
      (toggles.confirmed && event.status === "confirmed") ||
      (toggles.held && event.status === "on_hold");
    if (isBusy) busy.add(event.eventDate.slice(0, 10));
  }

  // Recorded and imported blocks are not a display preference — the two toggles
  // above are about how to treat SHOWS, and a blocked date is not a show.
  for (const range of blockedRanges) {
    for (const day of datesInRange(range.startDate, range.endDate)) busy.add(day);
  }

  return busy;
}

/** The design's "Fri · Jul 11" pill format (Ddd · Mmm DD). */
function formatDateChip(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
  const month = date.toLocaleDateString("en-US", { month: "short" });
  const day = String(date.getDate()).padStart(2, "0");
  return `${weekday} · ${month} ${day}`;
}

export interface AvailabilityShareView {
  calendar: string;
  setCalendar: (calendar: string) => void;
  from: string;
  setFrom: (value: string) => void;
  to: string;
  setTo: (value: string) => void;
  showConfirmed: boolean;
  setShowConfirmed: (next: boolean) => void;
  showHeld: boolean;
  setShowHeld: (next: boolean) => void;
  selectedWeekdays: number[];
  toggleWeekday: (index: number) => void;
  /** Pre-formatted labels for the modal's chips. */
  availableDates: string[];
  /** The public page URL carrying this snapshot; empty until the profile loads. */
  shareLink: string;
  copyDates: () => void;
  copyLink: () => void;
}

export function useAvailabilityShare(
  calendarEvents: CalendarEvent[],
  events: EventItem[],
  defaultCalendar: string,
): AvailabilityShareView {
  const toast = useToast();

  const [calendar, setCalendar] = useState(defaultCalendar);
  // Default the window to today → +30 days so the list shows a real range.
  const [from, setFrom] = useState(() => dayKey(new Date()));
  const [to, setTo] = useState(() => {
    const end = new Date();
    end.setDate(end.getDate() + 30);
    return dayKey(end);
  });
  const [showConfirmed, setShowConfirmed] = useState(true);
  // Held events default to NOT counting as unavailable (matches the design).
  const [showHeld, setShowHeld] = useState(false);
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);

  // The link names the profile by its PUBLIC slug — the public page resolves the
  // display name from the API, so a link can't be hand-edited to claim a name.
  const profiles = useGetApiV1Profiles();
  const shareProfile = useMemo(() => {
    const items = profiles.data ?? [];
    const activeProfileId = getActiveProfileId();
    return items.find((profile) => profile.id === activeProfileId) ?? items[0];
  }, [profiles.data]);

  // The computed availability for the WINDOW being shared, not for the month the
  // grid happens to be showing — the two ranges are unrelated.
  const availability = useGetApiV1ProfilesIdAvailability(
    shareProfile?.id ?? "",
    { from, to },
    { query: { enabled: Boolean(shareProfile?.id) } },
  );

  const availableDateKeys = useMemo(() => {
    const busy = busyDates(calendarEvents, events, availability.data?.unavailability ?? [], {
      confirmed: showConfirmed,
      held: showHeld,
    });
    const weekdays = new Set(selectedWeekdays);
    return datesInRange(from, to)
      .filter((isoDate) => weekdays.has(mondayFirstWeekday(new Date(`${isoDate}T00:00:00`))))
      .filter((isoDate) => !busy.has(isoDate));
  }, [
    calendarEvents,
    events,
    availability.data,
    from,
    to,
    selectedWeekdays,
    showConfirmed,
    showHeld,
  ]);

  const availableDates = useMemo(() => availableDateKeys.map(formatDateChip), [availableDateKeys]);

  const shareLink = useMemo(() => {
    if (!shareProfile?.slug || !shareProfile.isPublic) return "";
    const snapshot: AvailabilitySnapshot = {
      profileSlug: shareProfile.slug,
      from,
      to,
      weekdays: [...selectedWeekdays].sort((left, right) => left - right),
      availableDates: availableDateKeys,
      confirmedCountsAsBusy: showConfirmed,
      heldCountsAsBusy: showHeld,
      generatedOn: dayKey(new Date()),
    };
    return buildAvailabilityShareLink(snapshot);
  }, [shareProfile, from, to, selectedWeekdays, availableDateKeys, showConfirmed, showHeld]);

  const copyToClipboard = (value: string, success: string) => {
    navigator.clipboard
      ?.writeText(value)
      .then(() => toast.success(success))
      .catch(() => toast.error("Couldn't copy — your browser blocked clipboard access."));
  };

  return {
    calendar,
    setCalendar,
    from,
    setFrom,
    to,
    setTo,
    showConfirmed,
    setShowConfirmed,
    showHeld,
    setShowHeld,
    selectedWeekdays,
    toggleWeekday: (index) =>
      setSelectedWeekdays((current) =>
        current.includes(index) ? current.filter((day) => day !== index) : [...current, index],
      ),
    availableDates,
    shareLink,
    copyDates: () => {
      if (availableDates.length === 0) {
        toast.info("No available dates to copy in this range.");
        return;
      }
      copyToClipboard(availableDates.join(", "), "Available dates copied");
    },
    copyLink: () => {
      if (!shareLink) {
        // A link needs a public profile — a private one has nothing to point at.
        toast.info("Make this profile public in Settings to share an availability link.");
        return;
      }
      copyToClipboard(shareLink, "Availability link copied");
    },
  };
}
