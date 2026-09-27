import type { SelectOption } from "@showme/design-system";
import { WHOLE_VENUE } from "@showme/shared";
import type { CalendarSource } from "../hooks/useCalendarSources";

/**
 * CHOOSING A CALENDAR IN TWO STEPS — the venue, and then the room inside it.
 *
 * The Check & Share modal used to offer one flat list with venue names as disabled
 * headings and rooms indented under them by two non-breaking spaces. Everything was
 * reachable and nothing was operable: an indent is not a hierarchy you can use, and a
 * reader looking for the basement of one of three venues had to find the right heading
 * first and then trust the indentation.
 *
 * Two selects instead, over **one piece of state**. `CalendarSource.value` stays the
 * single answer to "which calendar" (`profileId:room`, parsed nowhere and compared
 * everywhere), and the venue select's option values are each profile's *whole-calendar*
 * entry — so picking a venue is literally "this venue, all rooms" and both selects write
 * through the same setter. Nothing can disagree, because there is only one thing to be
 * right. The calendar grid's own room filter follows the same rule for the same reason
 * (`useCalendarVenueFilter`: the room select reads and writes `hiddenRooms` rather than
 * keeping a second copy of the answer).
 *
 * **There is no "All venues" row, deliberately.** The grid's venue filter has one and
 * should — a filter narrows a view, and "don't narrow" is a real answer. This select names
 * the *subject* of a share: a snapshot carries one `profileSlug` and is minted by
 * `POST /profiles/:id/availability-share` against one profile. An "All venues" row would
 * have to either share nothing or silently pick a venue for the sharer, and a link that
 * quietly means one building while the screen said "all" is the worst of the three.
 */

/** The venue's own entry, and what the room select rests at. */
const ALL_ROOMS_LABEL = "All rooms";

export interface CalendarChoice {
  /** One row per calendar this user has — a venue, or their own schedule. */
  calendarOptions: SelectOption[];
  /** The chosen profile's whole-calendar value, whichever room is selected under it. */
  calendarValue: string;
  /** "All rooms" plus each room of the chosen venue; empty when there is nothing to choose. */
  roomOptions: SelectOption[];
  /** True when the chosen calendar has no rooms to tell apart. */
  roomsDisabled: boolean;
  /** What the room select says when it is not offering a choice — one reason per case. */
  roomPlaceholder: string;
}

/** The "any room here" / "my whole schedule" entry of a profile. */
function wholeCalendarOf(
  sources: readonly CalendarSource[],
  profileId: string,
): CalendarSource | undefined {
  return sources.find((source) => source.profileId === profileId && source.room === WHOLE_VENUE);
}

/** The rooms of a profile — the entries that are a room rather than the building. */
function roomsOf(sources: readonly CalendarSource[], profileId: string): CalendarSource[] {
  return sources.filter((source) => source.profileId === profileId && source.room !== WHOLE_VENUE);
}

/**
 * Why the room select is not offering a choice. Each case is a different fact about the
 * calendar that was picked, and a generic "Room / stage" would explain none of them.
 *
 * A venue with exactly ONE room reports that room's name rather than offering it: "All
 * rooms" and "Main Room" describe the same set of nights, so a select holding both is
 * furniture that asks the reader to pick between two identical answers.
 */
function roomPlaceholderFor(selected: CalendarSource | undefined, rooms: CalendarSource[]): string {
  if (!selected) return "Pick a calendar first";
  if (!selected.isVenue) return "One schedule";
  if (rooms.length === 0) return "No rooms recorded";
  return rooms[0]?.label ?? "No rooms recorded";
}

export function calendarChoice(
  sources: readonly CalendarSource[],
  selected: CalendarSource | undefined,
): CalendarChoice {
  const calendarOptions: SelectOption[] = [];
  for (const source of sources) {
    // One row per PROFILE, named by the profile: the rooms live in the select beside it.
    if (source.room !== WHOLE_VENUE) continue;
    calendarOptions.push({ value: source.value, label: source.profileName });
  }

  const rooms = selected ? roomsOf(sources, selected.profileId) : [];
  const whole = selected ? wholeCalendarOf(sources, selected.profileId) : undefined;

  const roomOptions: SelectOption[] =
    rooms.length > 1 && whole
      ? [
          { value: whole.value, label: ALL_ROOMS_LABEL },
          ...rooms.map((room) => ({ value: room.value, label: room.label })),
        ]
      : [];

  return {
    calendarOptions,
    // Falling back to the selection itself keeps the venue select populated even if a
    // profile somehow has rooms and no whole-calendar entry — an impossible state today,
    // and an empty venue select would be a worse way to find out.
    calendarValue: whole?.value ?? selected?.value ?? "",
    roomOptions,
    roomsDisabled: roomOptions.length === 0,
    roomPlaceholder: roomPlaceholderFor(selected, rooms),
  };
}
