import { WHOLE_VENUE } from "@showme/shared";
import type { CalendarSource } from "../hooks/useCalendarSources";
import type { EventItem } from "../hooks/useEventList";

/**
 * WHICH OF MY CALENDARS A SHOW SITS ON, and how many sit on each.
 *
 * The Calendar screen asks this twice — once to let "Venue / Room…" search a
 * room by name, once to count what each calendar is holding this month — and
 * both answers have to agree, so the placement rule lives in one plain module
 * rather than twice inside a component.
 *
 * A show at somebody ELSE'S venue has no placement here, and that is right: it is
 * on their calendar, not on one of mine. It stays visible on the grid; it simply
 * is not something the rooms filter or the room counts can speak about.
 */

/** The key for "at this venue, but nobody said which room". */
export function unassignedRoomKey(venueProfileId: string): string {
  return `${venueProfileId}:${WHOLE_VENUE}`;
}

export interface EventPlacement {
  /** The `CalendarSource.value` this show sits on, or the unassigned-room key. */
  calendarKey: string;
  /** The room's name, when it is in one. */
  roomName: string | null;
  /** The venue's name as the event recorded it, else the profile's own name. */
  venueName: string | null;
}

/**
 * eventId → where it sits, for shows at one of the caller's own venues.
 *
 * Events with no venue profile (the wizard captures a free-text venue name for a
 * room the operator does not run) are absent, as are events at venues the caller
 * has no membership of.
 */
export function placeEvents(
  events: readonly EventItem[],
  sources: readonly CalendarSource[],
): Map<string, EventPlacement> {
  const venueSources = sources.filter((source) => source.isVenue);
  const profileNameById = new Map(
    venueSources.map((source) => [source.profileId, source.profileName]),
  );
  const roomNameById = new Map(
    venueSources
      .filter((source) => source.room !== WHOLE_VENUE)
      .map((source) => [source.room, source.label]),
  );

  const placements = new Map<string, EventPlacement>();
  for (const event of events) {
    const venueProfileId = event.venueProfileId;
    if (!venueProfileId || !profileNameById.has(venueProfileId)) continue;
    const roomName = event.stageId ? (roomNameById.get(event.stageId) ?? null) : null;
    placements.set(event.id, {
      // A show whose room was deleted (or never set) falls in the venue's
      // unassigned bucket rather than vanishing from the inventory.
      calendarKey:
        event.stageId && roomName
          ? `${venueProfileId}:${event.stageId}`
          : unassignedRoomKey(venueProfileId),
      roomName,
      venueName: event.venueName ?? profileNameById.get(venueProfileId) ?? null,
    });
  }
  return placements;
}

export interface CalendarInventoryRow {
  key: string;
  label: string;
  count: number;
}

export interface CalendarInventoryGroup {
  profileId: string;
  /** The venue's name, when its rooms are listed beneath it; null for a lone row. */
  heading: string | null;
  rows: CalendarInventoryRow[];
}

/**
 * The rail's read-out: every calendar the caller has, with the number of shows on
 * it inside `eventIdsInPeriod`.
 *
 * A venue with rooms lists its rooms, plus a "No room set" row WHEN there is
 * something in it — that row is the one worth noticing, because an unassigned
 * show occupies every room for availability purposes (`@showme/shared`
 * `occupiedDates`) and is therefore costing the venue nights it could sell.
 *
 * The venue's own "All rooms" entry is deliberately NOT a row here. It is a
 * question ("can you host me at all?"), which is what the share dropdown asks;
 * an inventory of what is booked has nowhere to put it.
 */
export function buildCalendarInventory(
  sources: readonly CalendarSource[],
  placements: Map<string, EventPlacement>,
  eventIdsInPeriod: readonly string[],
): CalendarInventoryGroup[] {
  const counts = new Map<string, number>();
  for (const eventId of eventIdsInPeriod) {
    const placement = placements.get(eventId);
    if (!placement) continue;
    counts.set(placement.calendarKey, (counts.get(placement.calendarKey) ?? 0) + 1);
  }

  const groups: CalendarInventoryGroup[] = [];
  const seenProfiles = new Set<string>();

  for (const source of sources) {
    if (seenProfiles.has(source.profileId)) continue;
    seenProfiles.add(source.profileId);

    const forProfile = sources.filter((entry) => entry.profileId === source.profileId);
    const rooms = forProfile.filter((entry) => entry.room !== WHOLE_VENUE);

    if (rooms.length === 0) {
      groups.push({
        profileId: source.profileId,
        heading: null,
        rows: [
          {
            key: source.value,
            label: source.profileName,
            count: counts.get(unassignedRoomKey(source.profileId)) ?? 0,
          },
        ],
      });
      continue;
    }

    const rows: CalendarInventoryRow[] = rooms.map((room) => ({
      key: room.value,
      label: room.label,
      count: counts.get(room.value) ?? 0,
    }));
    const unassigned = counts.get(unassignedRoomKey(source.profileId)) ?? 0;
    if (unassigned > 0) {
      // Keyed exactly as a placement is, so a caller can filter on this row
      // without translating the key back — one spelling, one meaning.
      rows.push({
        key: unassignedRoomKey(source.profileId),
        label: "No room set",
        count: unassigned,
      });
    }
    groups.push({ profileId: source.profileId, heading: source.profileName, rows });
  }

  return groups;
}
