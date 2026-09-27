/**
 * WHAT A "Check & Share Availability" LINK PUBLISHES — the shape, not the link.
 *
 * Until ClickUp `123qy9rpqn0` this module also BUILT the link, serializing the whole
 * snapshot into a URL fragment. It no longer does: the snapshot is posted to
 * `POST /profiles/:id/availability-share` and the link is a token
 * (`publicAvailabilityTokenUrl`), so the builder and the fragment URL were deleted rather
 * than deprecated — a builder nobody calls is an invitation to mint a 700-character link
 * again. The fragment READER stays, on the marketing side
 * (`apps/marketing/src/availabilitySnapshot.ts`), because every link sent before today is
 * a fragment in somebody's inbox; its format is asserted there, where it has to keep
 * working.
 *
 * What remains here is the snapshot itself: what the sharer chose to publish, and the
 * reasoning about which parts of it the platform vouches for.
 *
 * WHY IT IS A SNAPSHOT AND NOT A LIVE READ. The recipient's page could ask the server
 * what is free right now. It deliberately does not: the modal's own promise is *"this
 * link reflects availability as of when it was generated"*, and a live feed is a
 * different product with a different privacy shape — a stranger holding a token could
 * sweep it date by date until it had enumerated the building. What the sharer published
 * is what the link says, and a night sold afterwards is caught where it must be caught
 * anyway, on the receiving end.
 *
 * NOTHING but availability goes in here: no event identifiers, no titles, no
 * counterparties, no money. The reader learns which days are free, the filter that
 * produced them, and — since `123qy9rpqp0` §2 — WHICH ROOM each free night belongs to. A
 * list of free Fridays from a two-room venue is ambiguous without that: the answer to
 * "are you free on the 12th?" is a different answer for each room.
 */

/** Monday = 0 … Sunday = 6 — the same indexing the modal's weekday pills use. */
export type WeekdayIndex = number;

/**
 * ONE ROOM'S OWN FREE NIGHTS (ClickUp `123qy9rpqp0` §2).
 *
 * The recipient is asking for a date, and a venue's honest answer is per room: the hall
 * is gone on the 12th and the basement is not. So the link carries the rooms it speaks
 * for — all of them when the sharer chose "All rooms", and the single one when they
 * chose a room — each with the nights IT is free and the capacity that decides whether
 * the show fits at all.
 *
 * THE ID IS HERE ON PURPOSE, and it is a change from what this file used to say. The room
 * used to travel as a name only, on the reasoning that "the public page has no
 * authenticated way to resolve a room id and should not get one". The first half is still
 * true and the second no longer follows: the public page's booking form now names the
 * room it is asking for, and `POST /booking-requests` refuses a room that does not belong
 * to the venue being asked (`placeOfRequest`). An id the API validates on arrival grants
 * its holder nothing — and without one, a request could only name a room in prose, which
 * is precisely the ambiguity this ticket exists to remove.
 *
 * What is NOT published: rooms with no free night in the window appear with an empty
 * list rather than being described, and a room that is never free tells the reader only
 * that it is never free. The roster is not a catalogue the page can enumerate.
 */
export interface SnapshotRoom {
  /** `stages.id` — validated against the venue by the API when a request names it. */
  id: string;
  name: string;
  /** The headline capacity, or null when the venue has not recorded one. */
  capacity: number | null;
  /** This room's own free nights inside the window, `yyyy-mm-dd`. */
  availableDates: string[];
}

export interface AvailabilitySnapshot {
  /** Public profile slug — the public page resolves the display name from it. */
  profileSlug: string;
  /**
   * WHICH ROOM these dates are for, or null for the venue as a whole (and for
   * anyone who is not a venue and has only one calendar).
   *
   * It travels as a NAME, and as part of the SHARER'S CLAIM rather than something the API
   * vouches for: the display name above it is resolved live, precisely so a link cannot
   * claim an identity, but the room is a statement the sharer is making about their own
   * building, exactly like the dates beside it. The public page renders it where that is
   * clear — among "how this list was made", never as the identity line.
   *
   * It stays even though `rooms` below now carries the same thing structurally: every
   * link sent before `123qy9rpqp0` has this field and nothing else to say where its dates
   * are.
   */
  room: string | null;
  /** Inclusive `yyyy-mm-dd` window the sharer picked. */
  from: string;
  to: string;
  weekdays: WeekdayIndex[];
  /**
   * Free days inside the window, `yyyy-mm-dd`, as of `generatedOn`.
   *
   * For a venue asked about as a whole this is the UNION of `rooms` below — a night is
   * offerable while any one room can take it. The two are computed in one pass from one
   * function so they cannot drift.
   */
  availableDates: string[];
  /** Which event states the sharer counted as unavailable. */
  confirmedCountsAsBusy: boolean;
  heldCountsAsBusy: boolean;
  /** `yyyy-mm-dd` the link was built — the "as of" the modal talks about. */
  generatedOn: string;
  /** The rooms these dates are about; empty for anyone who is not a venue. */
  rooms: SnapshotRoom[];
}
