import { useGetApiV1ProfilesIdAvailability } from "@showme/api-client";
import { useToast } from "@showme/design-system";
import { type RoomBooking, WHOLE_VENUE, occupiedDates } from "@showme/shared";
import { useMemo, useState } from "react";
import { dayKey } from "../components/calendarGrid";
import { getActiveProfileId } from "../lib/activeProfile";
import {
  type AvailabilitySnapshot,
  buildAvailabilityShareLink,
} from "../lib/availabilityShareLink";
import type { CalendarSource } from "./useCalendarSources";
import type { EventItem } from "./useEventList";

/**
 * Everything behind the "Check & Share Availability" modal: which calendar is
 * being asked about, the free nights that calendar has, and the public link that
 * carries them. The Calendar screen stays a dumb renderer over this.
 *
 * THE CALENDAR IS A ROOM. That is the whole point, and it used to be missing: a
 * venue with a main hall and a basement sells two shows on the same Friday, so
 * "are you free on the 12th?" has one answer per room and none for the building.
 * Availability derived from "every event I can see" told a promoter the venue was
 * busy while the basement stood empty. The per-room math itself is in
 * `@showme/shared` (`occupiedDates`) — it is a rule, not a rendering concern, and
 * both the copied dates and the shared link are built from the same call so the
 * link can never say something the screen did not.
 */

/** How far a share window may reach, so a hand-typed year can't build a 100k-date link. */
const MAX_WINDOW_DAYS = 366;

/** Statuses that make a night busy, keyed by the modal's two "show as unavailable" toggles. */
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
 * Every event, reduced to what the room math needs.
 *
 * `occupies` is decided HERE rather than in the shared module, because it is a
 * display choice the sharer makes with the two checkboxes — a held date is busy
 * for one venue and merely pencilled-in for another.
 *
 * A source that is NOT a venue (a performer, a crew member, a promoter, an agent)
 * has exactly one calendar: themselves. `GET /events` already returns only the
 * events they can reach, so every one of those events occupies their single
 * schedule — which is expressed by re-stamping each booking onto that profile
 * with no room, so the identical `occupiedDates` rule serves both cases.
 */
function bookingsFor(
  source: CalendarSource,
  events: EventItem[],
  toggles: BusyToggles,
): RoomBooking[] {
  return events.map((event) => {
    const occupies =
      (toggles.confirmed && event.status === "confirmed") ||
      (toggles.held && event.status === "on_hold");
    if (!source.isVenue) {
      return {
        date: event.eventDate,
        venueProfileId: source.profileId,
        stageId: null,
        occupies,
      };
    }
    return {
      date: event.eventDate,
      venueProfileId: event.venueProfileId,
      stageId: event.stageId,
      occupies,
    };
  });
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
  /** The selected calendar's `CalendarSource.value`. */
  calendar: string;
  setCalendar: (calendar: string) => void;
  /** "The Nest — Basement" — what this list is actually about. */
  calendarLabel: string;
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
  events: EventItem[],
  sources: CalendarSource[],
): AvailabilityShareView {
  const toast = useToast();

  const [calendar, setCalendar] = useState("");
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

  /**
   * The calendars arrive a moment after the screen does, so the selection is
   * RESOLVED on every render rather than seeded once from an empty list — an
   * effect that fires before the profiles land would pin an empty default.
   *
   * Nothing chosen yet means the profile the user is currently acting as: an
   * operator who switched to their second venue is asking about that venue.
   */
  const selected = useMemo(() => {
    const chosen = sources.find((source) => source.value === calendar);
    if (chosen) return chosen;
    const activeProfileId = getActiveProfileId();
    return sources.find((source) => source.profileId === activeProfileId) ?? sources[0];
  }, [sources, calendar]);

  // The recorded blocks belong to the profile being SHARED, which is not always
  // the acting one — an operator with two venues shares whichever they picked.
  // Asked for the share WINDOW, not for the month the grid happens to show.
  const availability = useGetApiV1ProfilesIdAvailability(
    selected?.profileId ?? "",
    { from, to },
    { query: { enabled: Boolean(selected?.profileId) } },
  );

  const availableDateKeys = useMemo(() => {
    if (!selected) return [];

    // Rooms first: the nights this room (or this venue) has already sold.
    const busy = occupiedDates(
      { venueProfileId: selected.profileId, room: selected.room },
      selected.rooms,
      bookingsFor(selected, events, { confirmed: showConfirmed, held: showHeld }),
    );

    // Then the profile's own recorded unavailability — "Mark Unavailable", plus
    // the days taken by entries imported from a connected calendar. These are
    // NOT a display preference (the two toggles above are about how to treat
    // SHOWS), and they are venue-wide by construction: `profile_unavailability`
    // has no room column, and rightly so — a building closed for renovation is
    // closed in every room of it.
    const blocked: BlockedRange[] = availability.data?.unavailability ?? [];
    for (const range of blocked) {
      for (const day of datesInRange(range.startDate, range.endDate)) busy.add(day);
    }

    const weekdays = new Set(selectedWeekdays);
    return datesInRange(from, to)
      .filter((isoDate) => weekdays.has(mondayFirstWeekday(new Date(`${isoDate}T00:00:00`))))
      .filter((isoDate) => !busy.has(isoDate));
  }, [selected, events, availability.data, from, to, selectedWeekdays, showConfirmed, showHeld]);

  const availableDates = useMemo(() => availableDateKeys.map(formatDateChip), [availableDateKeys]);

  const shareLink = useMemo(() => {
    if (!selected?.profileSlug || !selected.profileIsPublic) return "";
    const snapshot: AvailabilitySnapshot = {
      // The link names the profile by its PUBLIC slug — the public page resolves
      // the display name from the API, so a link can't claim a name.
      profileSlug: selected.profileSlug,
      // The room, by contrast, travels as text: it is the sharer's own statement
      // about their own building, exactly like the dates beside it.
      room: selected.room === WHOLE_VENUE ? null : selected.label,
      from,
      to,
      weekdays: [...selectedWeekdays].sort((left, right) => left - right),
      availableDates: availableDateKeys,
      confirmedCountsAsBusy: showConfirmed,
      heldCountsAsBusy: showHeld,
      generatedOn: dayKey(new Date()),
    };
    return buildAvailabilityShareLink(snapshot);
  }, [selected, from, to, selectedWeekdays, availableDateKeys, showConfirmed, showHeld]);

  const copyToClipboard = (value: string, success: string) => {
    navigator.clipboard
      ?.writeText(value)
      .then(() => toast.success(success))
      .catch(() => toast.error("Couldn't copy — your browser blocked clipboard access."));
  };

  return {
    calendar: selected?.value ?? "",
    setCalendar,
    calendarLabel: selected?.fullLabel ?? "",
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
      // The label rides along so a pasted list says WHICH room it is about — the
      // recipient is usually being told about one of several.
      const prefix = selected?.fullLabel ? `${selected.fullLabel}: ` : "";
      copyToClipboard(`${prefix}${availableDates.join(", ")}`, "Available dates copied");
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
