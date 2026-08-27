import type { SelectOption } from "@showme/design-system";
import { useCallback, useMemo, useState } from "react";
import type { CalendarFilterOption } from "../components/CalendarFilterChip";
import type { CalendarInventoryGroup, EventPlacement } from "../lib/calendarInventory";
import type { CalendarSource } from "./useCalendarSources";
import type { EventItem } from "./useEventList";

/**
 * NARROWING THE CALENDAR TO A VENUE, AND THEN TO A ROOM.
 *
 * This replaces a single free-text box labelled "Venue / Room…" that matched a
 * substring against venue name + room name + event title all at once. It could
 * not do the thing its label promised: you cannot pick a venue and then narrow
 * to a room inside it, and you cannot discover a room whose name you do not
 * already know. Two selects can.
 *
 * ONE SOURCE OF TRUTH FOR ROOMS. The right rail's "Rooms" chip already hides
 * rooms, by `CalendarSource.value`, in `hiddenRooms`. The room select does NOT
 * get its own state: it reads and writes that same array, and both controls are
 * built from the same option list (`roomFilterOptions`). So they cannot
 * disagree — picking "Back Room" is exactly "hide every other room of this
 * venue", which is what the chip then shows.
 *
 * Neither control silently clears the other. Changing venue leaves the rooms
 * you had hidden hidden, because the chip carries a visible `−N` badge and a
 * filter you cannot see is how a calendar ends up "missing" a show.
 *
 * A SHOW AT SOMEBODY ELSE'S VENUE has no placement (see `calendarInventory`),
 * so no room filter can hide it — it is on their calendar, not on one of the
 * reader's rooms. It is still selectable by VENUE, because the reader plainly
 * knows they have a show there.
 */

/** "Don't narrow" — the empty value both selects rest at. */
const NO_NARROWING = "";

/** Swatches for the Rooms checklist. Rooms carry no colour of their own — the
 * grid is tinted by STATUS — so these only have to tell one row from the next. */
const ROOM_SWATCHES = ["#6FC97A", "#3BB0C9", "#B58BE0", "#F4A046", "#D9B44A", "#D14FC4"];

export interface CalendarVenueFilterView {
  /** The venue narrowed to, or `""` for every venue. */
  venueProfileId: string;
  setVenueProfileId: (venueProfileId: string) => void;
  venueOptions: SelectOption[];

  /** The room narrowed to, derived from `hiddenRooms`; `""` when not narrowed. */
  roomKey: string;
  setRoomKey: (roomKey: string) => void;
  roomOptions: SelectOption[];
  /** True until a venue with more than one calendar inside it is chosen. */
  roomsDisabled: boolean;
  /** What the disabled room select says instead of offering a choice. */
  roomPlaceholder: string;

  /** The "Rooms" chip's checklist — the same rooms the room select offers. */
  roomFilterOptions: CalendarFilterOption[];
  /** The chip's shown keys (everything not in `hiddenRooms`). */
  roomFilterSelected: string[];
  toggleRoom: (key: string) => void;
  showAllRooms: () => void;
  hideAllRooms: () => void;

  /** Whether the venue + room narrowing keeps this entry on the grid. */
  keepsEntry: (eventId: string | undefined, placement: EventPlacement | undefined) => boolean;
}

/** A venue with only one calendar inside it has nothing to tell apart, and a
 * select with a single option is furniture — the same rule the chip already
 * applied, now shared so the two controls offer exactly the same rooms. */
function isNarrowable(group: CalendarInventoryGroup): boolean {
  return group.rows.length > 1;
}

export function useCalendarVenueFilter(
  events: readonly EventItem[],
  sources: readonly CalendarSource[],
  inventory: readonly CalendarInventoryGroup[],
): CalendarVenueFilterView {
  const [venueProfileId, setVenueProfileId] = useState(NO_NARROWING);
  /** Rooms the reader has switched off, by `CalendarSource.value`. Hidden rather
   * than shown, so a room added later starts visible instead of silently missing. */
  const [hiddenRooms, setHiddenRooms] = useState<string[]>([]);

  /** The venues the reader runs, by profile id — the ones whose rooms they can see. */
  const ownVenueNameById = useMemo(() => {
    const names = new Map<string, string>();
    for (const source of sources) {
      if (source.isVenue) names.set(source.profileId, source.profileName);
    }
    return names;
  }, [sources]);

  /** Venues the reader has a show at but does not run. Their room roster is not
   * the reader's to see (see `useCalendarSources`), so they filter by venue only. */
  const guestVenueNameById = useMemo(() => {
    const names = new Map<string, string>();
    for (const event of events) {
      const profileId = event.venueProfileId;
      if (!profileId || ownVenueNameById.has(profileId)) continue;
      names.set(profileId, event.venueName ?? "Unnamed venue");
    }
    return names;
  }, [events, ownVenueNameById]);

  const venueOptions = useMemo<SelectOption[]>(() => {
    const byName = (left: [string, string], right: [string, string]) =>
      left[1].localeCompare(right[1]);
    const own = [...ownVenueNameById.entries()].sort(byName);
    const guest = [...guestVenueNameById.entries()].sort(byName);
    const heading = (value: string, label: string): SelectOption => ({
      value,
      label,
      disabled: true,
      // Never selected, so it never needs to be found by typing.
      searchText: "",
    });

    const built: SelectOption[] = [{ value: NO_NARROWING, label: "All venues" }];
    // Headings only when both kinds are present: they exist to explain why one
    // group offers rooms and the other cannot, and with one group there is
    // nothing to explain.
    const grouped = own.length > 0 && guest.length > 0;
    if (grouped) built.push(heading("heading:own", "My venues"));
    for (const [profileId, name] of own) built.push({ value: profileId, label: name });
    if (grouped) built.push(heading("heading:guest", "Venues I have shows at"));
    for (const [profileId, name] of guest) built.push({ value: profileId, label: name });
    return built;
  }, [ownVenueNameById, guestVenueNameById]);

  /** Every room-like row of every venue the reader runs, venue by venue. Both the
   * chip and the room select are built from this, which is what keeps them
   * saying the same thing about the same rooms. */
  const narrowableGroups = useMemo(
    () => inventory.filter((group) => isNarrowable(group)),
    [inventory],
  );

  const roomFilterOptions = useMemo<CalendarFilterOption[]>(
    () =>
      narrowableGroups.flatMap((group, groupIndex) =>
        group.rows.map((row, rowIndex) => ({
          // The inventory already keys every row the way a placement is keyed,
          // so a chip key can be compared straight against `placement.calendarKey`.
          key: row.key,
          label: group.heading ? `${group.heading} — ${row.label}` : row.label,
          color: ROOM_SWATCHES[(groupIndex + rowIndex) % ROOM_SWATCHES.length],
        })),
      ),
    [narrowableGroups],
  );

  const hiddenRoomSet = useMemo(() => new Set(hiddenRooms), [hiddenRooms]);

  /** The chosen venue's own rows, when it has more than one to tell apart. */
  const selectedVenueRows = useMemo(
    () => narrowableGroups.find((group) => group.profileId === venueProfileId)?.rows ?? [],
    [narrowableGroups, venueProfileId],
  );

  const visibleRoomKeys = selectedVenueRows
    .map((row) => row.key)
    .filter((key) => !hiddenRoomSet.has(key));
  const roomKey =
    visibleRoomKeys.length === 1 ? (visibleRoomKeys[0] ?? NO_NARROWING) : NO_NARROWING;

  const roomOptions = useMemo<SelectOption[]>(() => {
    if (selectedVenueRows.length === 0) return [];
    const hiddenHere = selectedVenueRows.filter((row) => hiddenRoomSet.has(row.key)).length;
    return [
      {
        value: NO_NARROWING,
        // Reports the state rather than claiming one: the chip can hide two of
        // four rooms, which is neither "all rooms" nor a single room, and a
        // select that said "All rooms" then would be lying about the grid.
        label:
          hiddenHere === 0
            ? "All rooms"
            : `${selectedVenueRows.length - hiddenHere} of ${selectedVenueRows.length} rooms`,
      },
      ...selectedVenueRows.map((row) => ({ value: row.key, label: row.label })),
    ];
  }, [selectedVenueRows, hiddenRoomSet]);

  /** What a disabled room select says — every reason it is disabled is a
   * different fact about the venue, and "Room / stage" would explain none. */
  const roomPlaceholder = useMemo(() => {
    if (!venueProfileId) return "Room / stage";
    if (!ownVenueNameById.has(venueProfileId)) return "Rooms not shared";
    const group = inventory.find((entry) => entry.profileId === venueProfileId);
    // One space, so there is no hierarchy to walk: name it and move on.
    return group?.rows[0]?.label ?? "No rooms recorded";
  }, [venueProfileId, ownVenueNameById, inventory]);

  const setRoomKey = useCallback(
    (chosen: string) => {
      const keysHere = selectedVenueRows.map((row) => row.key);
      const keySet = new Set(keysHere);
      setHiddenRooms((current) => {
        // Other venues' rooms are none of this select's business — it narrows
        // WITHIN a venue, and untouching them is what lets the chip keep a
        // choice the reader made about a different building.
        const elsewhere = current.filter((key) => !keySet.has(key));
        if (!chosen) return elsewhere;
        return [...elsewhere, ...keysHere.filter((key) => key !== chosen)];
      });
    },
    [selectedVenueRows],
  );

  const toggleRoom = useCallback((key: string) => {
    setHiddenRooms((current) =>
      current.includes(key) ? current.filter((hidden) => hidden !== key) : [...current, key],
    );
  }, []);

  const showAllRooms = useCallback(() => setHiddenRooms([]), []);
  const hideAllRooms = useCallback(
    () => setHiddenRooms(roomFilterOptions.map((option) => option.key)),
    [roomFilterOptions],
  );

  const venueProfileIdByEventId = useMemo(() => {
    const venues = new Map<string, string>();
    for (const event of events) {
      if (event.venueProfileId) venues.set(event.id, event.venueProfileId);
    }
    return venues;
  }, [events]);

  const keepsEntry = useCallback(
    (eventId: string | undefined, placement: EventPlacement | undefined) => {
      // A venue narrowing is a question about WHERE, so anything with no venue
      // — a task, a note, an imported entry — is not an answer to it.
      if (venueProfileId) {
        const eventVenue = eventId ? venueProfileIdByEventId.get(eventId) : undefined;
        if (eventVenue !== venueProfileId) return false;
      }
      // A show at somebody else's venue has no placement and is never hidden by
      // a room filter — that filter speaks about rooms, and it is not their room.
      if (placement && hiddenRoomSet.has(placement.calendarKey)) return false;
      return true;
    },
    [venueProfileId, venueProfileIdByEventId, hiddenRoomSet],
  );

  return {
    venueProfileId,
    setVenueProfileId,
    venueOptions,
    roomKey,
    setRoomKey,
    roomOptions,
    roomsDisabled: selectedVenueRows.length === 0,
    roomPlaceholder,
    roomFilterOptions,
    roomFilterSelected: roomFilterOptions
      .map((option) => option.key)
      .filter((key) => !hiddenRoomSet.has(key)),
    toggleRoom,
    showAllRooms,
    hideAllRooms,
    keepsEntry,
  };
}
