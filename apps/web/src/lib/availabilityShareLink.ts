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
 * venues, no counterparties, no money. The reader learns which days are free
 * and the filter that produced them.
 */

/** Monday = 0 … Sunday = 6 — the same indexing the modal's weekday pills use. */
export type WeekdayIndex = number;

export interface AvailabilitySnapshot {
  /** Public profile slug — the public page resolves the display name from it. */
  profileSlug: string;
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

/**
 * Where the public site is served from. Production is the live marketing host
 * (`docs/deployment-status.md`); in dev it is the marketing Vite server, which
 * owns 5173 while the app runs on 5180.
 */
export function publicSiteUrl(): string {
  const configured = import.meta.env.VITE_PUBLIC_SITE_URL;
  if (typeof configured === "string" && configured.length > 0) return configured;
  return import.meta.env.DEV ? "http://localhost:5173" : "https://www.showme.music";
}

/** Serialize a snapshot into the public page's URL. Empty when there is no slug. */
export function buildAvailabilityShareLink(snapshot: AvailabilitySnapshot): string {
  if (!snapshot.profileSlug) return "";

  const unavailable: string[] = [];
  if (snapshot.confirmedCountsAsBusy) unavailable.push("confirmed");
  if (snapshot.heldCountsAsBusy) unavailable.push("held");

  const parameters = new URLSearchParams({
    profile: snapshot.profileSlug,
    from: snapshot.from,
    to: snapshot.to,
    weekdays: snapshot.weekdays.join(","),
    dates: snapshot.availableDates.join(","),
    unavailable: unavailable.join(","),
    generated: snapshot.generatedOn,
  });

  return `${publicSiteUrl().replace(/\/$/, "")}/availability.html#${parameters.toString()}`;
}
