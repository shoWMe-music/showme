/**
 * Addresses on the PUBLIC site — the pages a signed-in user hands to someone who
 * is not.
 *
 * One module because there are now three of them (a profile, a show, a shared
 * availability window) and they have to agree on two things a caller keeps
 * getting wrong on its own: the ORIGIN (the marketing site, never the app — a
 * relative `/profile/x` from inside the app resolves against the app's own host,
 * where no such page exists, which is how `PerformerSearch` shipped a link that
 * could not work) and the SHAPE of the path, which is decided in `firebase.json`
 * and mirrored by the marketing site's dev server.
 *
 * The paths carry no `.html`: Hosting serves every page without it and 301s the
 * old address, so a link somebody pastes into a message does not advertise a file
 * extension. Each page also still reads its older query form (`?slug=`,
 * `?event=`), so links sent before this keep landing.
 */

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

/** The origin with no trailing slash, so a caller can append a path. */
function origin(): string {
  return publicSiteUrl().replace(/\/$/, "");
}

/** A profile's public page — `/profile/<slug>`. */
export function publicProfileUrl(slug: string): string {
  return `${origin()}/profile/${encodeURIComponent(slug)}`;
}

/** A published show's public page — `/event/<id>`. */
export function publicEventUrl(eventId: string): string {
  return `${origin()}/event/${encodeURIComponent(eventId)}`;
}

/**
 * The shared availability page. The whole snapshot rides in the FRAGMENT, which
 * is why this one takes a pre-serialized string rather than building it: the
 * dates are deliberately not public, so they travel in the link itself and never
 * through an endpoint (`availabilityShareLink.ts`).
 */
export function publicAvailabilityUrl(fragment: string): string {
  return `${origin()}/availability#${fragment}`;
}
