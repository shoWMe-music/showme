/**
 * Which nights a ROOM can still take a booking.
 *
 * The rule this module exists to state: **a date is unavailable for the room
 * that is actually booked, not for the venue.** A venue with a main hall and a
 * basement sells two shows on the same Friday. Availability computed over "every
 * event I can see" answers "the venue is busy" when the basement is standing
 * empty — which is the opposite of what a promoter is asking, and worse than no
 * answer, because it is a confident one.
 *
 * Plain TypeScript on purpose (CLAUDE.md): the screen that draws the calendar and
 * the modal that shares a link both ask the same question, and neither should own
 * the answer.
 */

/** A room, addressed the way callers hold it: a `stages.id`. */
export type RoomId = string;

/**
 * The whole venue rather than one room. Modelled as a distinct value rather than
 * `null` so a caller cannot pass "no room chosen" where "every room" was meant —
 * the two produce different answers on exactly the dates that matter.
 */
export const WHOLE_VENUE = "whole-venue" as const;

/** Which calendar the caller is asking about: one room, or the venue entire. */
export interface RoomSelection {
  /** The venue profile that owns the calendar (`stages.venue_profile_id`). */
  venueProfileId: string;
  /** A `stages.id`, or `WHOLE_VENUE` for "any room at this venue". */
  room: RoomId | typeof WHOLE_VENUE;
}

/**
 * One booking, reduced to the three facts the math needs.
 *
 * `occupies` is the CALLER's judgement, not this module's: the share modal lets a
 * user decide whether confirmed events and held events count as busy, and that is
 * a display choice about their own schedule. This module never inspects a status.
 */
export interface RoomBooking {
  /** `yyyy-mm-dd`. A dateless event occupies no night and is dropped. */
  date: string | null;
  /** The venue profile the event is placed at, when it is placed at one. */
  venueProfileId: string | null;
  /** The room it was put in, or null for "somewhere in this building". */
  stageId: RoomId | null;
  occupies: boolean;
}

/**
 * The marker for a booking at the venue with NO room recorded. It occupies every
 * room, and the reasoning is worth stating: nobody said which room this show is
 * in, so nobody can say which room is still free. Treating an unassigned booking
 * as harmless would let the venue offer a night it has already sold — the single
 * worst thing this feature can do. Erring the other way costs an operator one
 * click (assign the room) to get the night back.
 */
const UNASSIGNED = Symbol("unassigned room");

type OccupiedRoom = RoomId | typeof UNASSIGNED;

/** date → the rooms taken that night, for bookings at this venue only. */
function occupiedRoomsByDate(
  bookings: readonly RoomBooking[],
  venueProfileId: string,
): Map<string, Set<OccupiedRoom>> {
  const byDate = new Map<string, Set<OccupiedRoom>>();
  for (const booking of bookings) {
    if (!booking.occupies) continue;
    if (!booking.date) continue;
    if (booking.venueProfileId !== venueProfileId) continue;
    const date = booking.date.slice(0, 10);
    const taken = byDate.get(date) ?? new Set<OccupiedRoom>();
    taken.add(booking.stageId ?? UNASSIGNED);
    byDate.set(date, taken);
  }
  return byDate;
}

/**
 * The dates `selection` cannot take a booking on, from the bookings alone.
 *
 * ONE ROOM is busy when that room is booked, or when the venue has a booking with
 * no room recorded (see `UNASSIGNED`).
 *
 * THE WHOLE VENUE is busy only when it has nowhere left to put a show: every
 * room booked, or an unassigned booking that could be in any of them. It is
 * deliberately NOT the union of the rooms' busy dates. The venue-wide entry
 * answers "can you host me at all on the 12th?", and while one room is free the
 * honest answer is yes — a venue that reports itself full because its smallest
 * room is taken is turning away the bookings this list exists to attract.
 *
 * A venue with no rooms recorded is treated as one room, the house itself, so
 * the two entries agree: before anybody defines a room, "the venue" and "the
 * only space there is" are the same calendar.
 */
export function occupiedDates(
  selection: RoomSelection,
  rooms: readonly RoomId[],
  bookings: readonly RoomBooking[],
): Set<string> {
  const byDate = occupiedRoomsByDate(bookings, selection.venueProfileId);
  const busy = new Set<string>();

  for (const [date, taken] of byDate) {
    if (taken.has(UNASSIGNED)) {
      busy.add(date);
      continue;
    }
    if (selection.room === WHOLE_VENUE) {
      // No rooms on record: the venue is its own single space, so any booking
      // fills it. With rooms on record, it takes all of them to fill the venue.
      if (rooms.length === 0 || rooms.every((room) => taken.has(room))) busy.add(date);
      continue;
    }
    if (taken.has(selection.room)) busy.add(date);
  }

  return busy;
}

/**
 * Whether a room list can produce differing answers at all. A venue with fewer
 * than two rooms has exactly one calendar however it is sliced, which is worth
 * knowing before promising a user that per-room availability will tell them
 * something.
 */
export function hasSeparableRooms(rooms: readonly RoomId[]): boolean {
  return rooms.length > 1;
}

/**
 * IS THIS NIGHT TAKEN? — the one answer, for every surface that asks.
 *
 * ClickUp 86cbceux0 · 123qy9rp9rx · 123qy9rnjck. Three tickets, one cause: two
 * screens asked this question and answered it differently, so the same night
 * could be "already taken" on the booking form and "free" on the availability
 * you shared with a promoter an hour later.
 *
 *   - the booking warning counted EVERYTHING except a cancellation, drafts
 *     included, so it fired on a night nobody had been asked about;
 *   - the share counted ONLY confirmed shows, so a night an act had already
 *     accepted went out to a promoter as free.
 *
 * `occupiedDates` above owns which ROOM a booking fills. It never owned which
 * bookings count, and each caller quietly invented that for itself. This is
 * that missing half.
 *
 * ── RAN'S RULE, IN HIS WORDS ───────────────────────────────────────────────
 * *"When is the date taken? When it is moved from suggested to pending. I.e.
 * the performer accepts the date."*
 *
 * So the line is ACCEPTANCE, and it falls exactly where the booking ladder
 * already puts it (86cbcehmp):
 *
 *   draft      nobody has been asked          → free
 *   suggested  asked, not answered            → free
 *   pending    THE ACT SAID YES               → TAKEN
 *   confirmed  the deal is signed             → taken
 *   concluded  the show happened              → taken
 *   cancelled  called off                     → free
 *
 * `on_hold` is deliberately NOT here. A hold is a pencil, not a yes — it sits
 * before acceptance, not after it — and the share modal has carried a user
 * toggle for it since it was designed, because a held date is busy for one
 * venue and merely pencilled for another. That choice stays the sharer's, so
 * this rule must not make it for them.
 */
export const TAKEN_EVENT_STATUSES = ["pending", "confirmed", "concluded"] as const;

/** Has this night been accepted by somebody? See the note above for the rule. */
export function isDateTaken(eventStatus: string): boolean {
  return (TAKEN_EVENT_STATUSES as readonly string[]).includes(eventStatus);
}

/**
 * A hold, which is a pencil rather than a yes.
 *
 * Separate from `isDateTaken` on purpose: every caller has to decide for itself
 * whether a pencilled night counts, and the honest answer differs by surface.
 * The share modal asks the sharer; the booking warning mentions it without
 * calling it a clash.
 */
export function isDateHeld(eventStatus: string): boolean {
  return eventStatus === "on_hold";
}
