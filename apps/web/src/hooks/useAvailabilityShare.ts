import { useGetApiV1Profiles } from "@showme/api-client";
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

/**
 * The days the sharer is NOT free. Read from BOTH sources on the screen: the
 * calendar feed only covers the month being viewed, while the event list covers
 * the whole schedule — and a share window routinely runs past the month edge, so
 * a month-only busy set would advertise days that are already booked.
 */
function busyDates(
  calendarEvents: CalendarEvent[],
  events: EventItem[],
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

  const availableDateKeys = useMemo(() => {
    const busy = busyDates(calendarEvents, events, {
      confirmed: showConfirmed,
      held: showHeld,
    });
    const weekdays = new Set(selectedWeekdays);
    return datesInRange(from, to)
      .filter((isoDate) => weekdays.has(mondayFirstWeekday(new Date(`${isoDate}T00:00:00`))))
      .filter((isoDate) => !busy.has(isoDate));
  }, [calendarEvents, events, from, to, selectedWeekdays, showConfirmed, showHeld]);

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
