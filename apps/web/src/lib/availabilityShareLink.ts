import { publicAvailabilityUrl } from "./publicSite";

/**
 * The "Check & Share Availability" link — a self-contained snapshot of what the
 * sharer chose to publish, pointed at the public availability page on the
 * marketing site (`apps/marketing/availability.html`).
 *
 * WHY the whole snapshot travels in the URL rather than in a `shares` row: the
 * only share-creation route the API has is `POST /events/:id/shares`, which is
 * event-scoped and needs `event.edit`. There is no route that writes a
 * profile-availability share (the `shares.payload` column exists for exactly
 * that and nothing populates it yet), so a link that the browser can build on
 * its own is the only honest option today. It also matches what the modal
 * promises — "this link reflects availability as of when it was generated".
 *
 * WHY the fragment (`#…`) and not the query string: a fragment is never sent to
 * the server and never appears in a `Referer` header, so the sharer's free/busy
 * days stay out of Firebase Hosting's access logs and out of any site the
 * recipient clicks through to. The parameters are plain and readable on purpose
 * — anyone can see exactly what a link they were sent contains.
 *
 * NOTHING but availability goes in here: no event identifiers, no titles, no
 * counterparties, no money. The reader learns which days are free, the filter
 * that produced them, and — when the sharer picked one — WHICH ROOM they are for.
 * The room is the one addition that carries a name, and it is there because a
 * list of free Fridays from a two-room venue is ambiguous without it: the answer
 * to "are you free on the 12th?" is a different answer for each room.
 */

/** Monday = 0 … Sunday = 6 — the same indexing the modal's weekday pills use. */
export type WeekdayIndex = number;

export interface AvailabilitySnapshot {
  /** Public profile slug — the public page resolves the display name from it. */
  profileSlug: string;
  /**
   * WHICH ROOM these dates are for, or null for the venue as a whole (and for
   * anyone who is not a venue and has only one calendar).
   *
   * It travels as a NAME, not an id, and that is deliberate on both counts. As a
   * name, because the public page has no authenticated way to resolve a room id
   * and should not get one — a venue's room list is its own. And as part of the
   * SHARER'S CLAIM rather than something the API vouches for: the display name
   * above it is resolved live, precisely so a link cannot claim an identity, but
   * the room is a statement the sharer is making about their own building,
   * exactly like the dates beside it. The public page renders it where that is
   * clear — among "how this list was made", never as the identity line.
   */
  room: string | null;
  /** Inclusive `yyyy-mm-dd` window the sharer picked. */
  from: string;
  to: string;
  weekdays: WeekdayIndex[];
  /** Free days inside the window, `yyyy-mm-dd`, as of `generatedOn`. */
  availableDates: string[];
  /** Which event states the sharer counted as unavailable. */
  confirmedCountsAsBusy: boolean;
  heldCountsAsBusy: boolean;
  /** `yyyy-mm-dd` the link was built — the "as of" the modal talks about. */
  generatedOn: string;
}

/** Serialize a snapshot into the public page's URL. Empty when there is no slug. */
export function buildAvailabilityShareLink(snapshot: AvailabilitySnapshot): string {
  if (!snapshot.profileSlug) return "";

  const unavailable: string[] = [];
  if (snapshot.confirmedCountsAsBusy) unavailable.push("confirmed");
  if (snapshot.heldCountsAsBusy) unavailable.push("held");

  const parameters = new URLSearchParams({
    profile: snapshot.profileSlug,
    // Only when there is one. An absent `room` reads as "the whole calendar",
    // which is what a venue-wide or single-schedule share means.
    ...(snapshot.room ? { room: snapshot.room } : {}),
    from: snapshot.from,
    to: snapshot.to,
    weekdays: snapshot.weekdays.join(","),
    dates: snapshot.availableDates.join(","),
    unavailable: unavailable.join(","),
    generated: snapshot.generatedOn,
  });

  return publicAvailabilityUrl(parameters.toString());
}
