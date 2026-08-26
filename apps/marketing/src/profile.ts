/**
 * The public profile page — a venue's (or performer's) own page, for anyone with
 * the link and no account.
 *
 * WHY IT LIVES IN `apps/marketing` and not in the app: `apps/web` mounts its
 * router only once a Firebase session exists (`apps/web/src/main.tsx`,
 * `AuthGate`), so a signed-out visitor never reaches a route there at all. This
 * bundle carries no Firebase SDK and no authenticated API client, so it *cannot*
 * read a session or call a protected route even by mistake. Same reasoning that
 * put `availability.html` here.
 *
 * WHAT IT MAY SHOW — the entire response of `GET /public/profiles/:slug`, which
 * is a hard allowlist in `apps/api/src/serialize/public.ts`, not a redaction:
 *
 *   name        the profile's own public display name
 *   type/kind   "venue", "operator" — what sort of party this is
 *   bio         prose the owner wrote for exactly this purpose
 *   avatarUrl   the owner's chosen picture
 *   bannerUrl   the owner's chosen cover image
 *   id          NOT rendered. It is read only because a future "request a date"
 *               form addresses its target by id, the way availability.ts does.
 *
 * Nothing financial, no membership, no contact details, no `details` jsonb and
 * no `billing` are in that projection — they are never SELECTed, so they cannot
 * leak. The route additionally requires `profiles.is_public = true`; a private
 * profile is a 404, not a 403, so this page cannot be used to probe for the
 * existence of an unpublished venue either.
 *
 * VENUE SPECS: capacity, sound system, curfew, amenities, deal types and
 * AUDIENCE logistics are safe to publish and this page renders them when the API
 * carries them. `GET /public/profiles/:slug` does not carry them yet — extending
 * it is a change to `routes/public.ts`, which another agent is working in
 * tonight. The reader below is written to tolerate their absence, so the page
 * works now and gains the specs the moment the endpoint does.
 *
 * WHAT MUST NEVER APPEAR HERE, and is deliberately not read even if a future
 * endpoint were to offer it: `artistLogisticsNotes` (load-in, back entrance,
 * artist parking — private to booked parties per `docs/decisions.md` #16.7),
 * `contactEmail` and `contactPhone` (an open page that prints a booker's mailbox
 * is a scraper's gift).
 */

import { element } from "./element";

/** API base including `/api/v1`. Empty renders the page's "unavailable" state
 * rather than silently showing an empty profile. */
const API_BASE_URL: string = import.meta.env.VITE_PUBLIC_API_URL ?? "";

/** The ten standard amenity keys, mirrored from `packages/shared/src/venue.ts`.
 * Duplicated on purpose: `apps/marketing` has no workspace dependency on
 * `@showme/shared` (see its package.json) and this page is not worth adding one
 * for. An unknown key falls through unchanged, which is also how a venue's own
 * custom amenity ("Green Room") renders. */
const AMENITY_LABELS: Record<string, string> = {
  backline: "Full Backline",
  partial_backline: "Partial Backline",
  no_backline: "No Backline",
  pa_system: "PA System",
  sound_engineer: "Sound Engineer",
  lighting: "Lighting",
  light_engineer: "Light Engineer",
  parking: "Parking",
  accommodation: "Accommodation",
  catering: "Catering",
};

const DEAL_TYPE_LABELS: Record<string, string> = {
  door_split: "Door Split",
  guarantee_plus_door_split: "Guarantee + Door Split",
  rental: "Rental",
  guarantee: "Guarantee",
};

interface PublicVenueDetails {
  capacity: number | null;
  soundSystem: string | null;
  curfew: string | null;
  amenities: string[];
  dealTypes: string[];
  cateringNotes: string | null;
  accommodationNotes: string | null;
  audienceLogisticsNotes: string | null;
}

/**
 * One show on the bill.
 *
 * Deliberately only what the API can honestly answer. The design shows a ticket
 * price, "Last 40 tickets", "Sold out" and a support act; `events` has no price
 * column, no ticket-link column that anything reads, and no support relation, so
 * none of those are modelled here. Inventing them would be the mocked data this
 * repo's rules forbid, and a fan who trusts a price we made up is worse served
 * than one who is told the date and the room.
 */
interface PublicShow {
  id: string;
  title: string;
  eventDate: string | null;
  venueName: string | null;
  doorTime: string | null;
  startTime: string | null;
}

interface PublicProfile {
  name: string;
  type: string | null;
  kind: string;
  bio: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  city: string | null;
  country: string | null;
  venueDetails: PublicVenueDetails | null;
  upcomingShows: PublicShow[];
}

/* -------------------------------------------------------------------- input */

/**
 * The slug is a path segment (`/p/the-lantern-hall`) when a rewrite is in place,
 * and a `?slug=` query otherwise. Both are read so the page works before the
 * hosting rewrite exists.
 */
function readSlug(): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get("slug");
  if (fromQuery) return fromQuery.trim() || null;

  const segments = window.location.pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last || last.endsWith(".html")) return null;
  return decodeURIComponent(last);
}

/* ------------------------------------------------------------------ reading */

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * An image URL we are willing to put in the DOM. Only absolute http(s) survives.
 *
 * These strings are owner-supplied and arrive over the network, so `javascript:`
 * and `data:` are refused rather than sanitized — an avatar has no business being
 * either, and a rejected image is a missing picture, not an executed script.
 */
function readImageUrl(value: unknown): string | null {
  const raw = readString(value);
  if (!raw) return null;
  try {
    const parsed = new URL(raw, window.location.origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry !== "");
}

/**
 * Read only the fields this page is allowed to show, one at a time. A whitelist
 * on the client as well as the server: if the endpoint ever grows a field, this
 * page does not start rendering it by accident.
 */
function readVenueDetails(value: unknown): PublicVenueDetails | null {
  if (typeof value !== "object" || value === null) return null;
  const source = value as Record<string, unknown>;
  return {
    capacity: typeof source.capacity === "number" ? source.capacity : null,
    soundSystem: readString(source.soundSystem),
    curfew: readString(source.curfew),
    amenities: readStringArray(source.amenities),
    dealTypes: readStringArray(source.dealTypes),
    cateringNotes: readString(source.cateringNotes),
    accommodationNotes: readString(source.accommodationNotes),
    // NOTE: `artistLogisticsNotes`, `contactEmail` and `contactPhone` are not
    // read. Their absence here is the point — see the module docstring.
    audienceLogisticsNotes: readString(source.audienceLogisticsNotes),
  };
}

function readProfile(value: unknown): PublicProfile | null {
  if (typeof value !== "object" || value === null) return null;
  const source = value as Record<string, unknown>;
  const name = readString(source.name);
  if (!name) return null;

  const location =
    typeof source.location === "object" && source.location !== null
      ? (source.location as Record<string, unknown>)
      : {};

  return {
    name,
    type: readString(source.type),
    kind: readString(source.kind) ?? "",
    bio: readString(source.bio),
    avatarUrl: readImageUrl(source.avatarUrl),
    bannerUrl: readImageUrl(source.bannerUrl),
    city: readString(location.city),
    country: readString(location.country),
    venueDetails: readVenueDetails(source.venueDetails),
    upcomingShows: readShows(source.upcomingShows),
  };
}

/**
 * The bill, tolerant of an API that does not carry it yet.
 *
 * A show with no date cannot take a place on a dated rail, so it is dropped
 * rather than rendered as a blank — the rail is the page's spine and a row that
 * cannot say when is not a show a fan can act on.
 */
function readShows(value: unknown): PublicShow[] {
  if (!Array.isArray(value)) return [];
  const shows: PublicShow[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const source = entry as Record<string, unknown>;
    const id = readString(source.id);
    const title = readString(source.title);
    const eventDate = readString(source.eventDate);
    if (!id || !title || !eventDate) continue;
    shows.push({
      id,
      title,
      eventDate,
      venueName: readString(source.venueName),
      doorTime: readString(source.doorTime),
      startTime: readString(source.startTime),
    });
  }
  return shows;
}

/* ----------------------------------------------------------------- fetching */

async function fetchProfile(slug: string): Promise<"missing" | "unavailable" | PublicProfile> {
  if (!API_BASE_URL) return "unavailable";
  try {
    const response = await fetch(`${API_BASE_URL}/public/profiles/${encodeURIComponent(slug)}`, {
      headers: { accept: "application/json" },
    });
    // A private or non-existent profile is the same 404 by design — the API does
    // not distinguish them and neither does this page.
    if (response.status === 404) return "missing";
    if (!response.ok) return "unavailable";
    return readProfile(await response.json()) ?? "unavailable";
  } catch {
    return "unavailable";
  }
}

/* ---------------------------------------------------------------- rendering */

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/** Title-case a stored key ("team_and_crew" → "Team And Crew"). */
function humanize(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function pillRow(className: string, labels: string[]): HTMLElement {
  const row = element("div", className);
  for (const label of labels) row.append(element("span", "pill", label));
  return row;
}

function specRow(label: string, value: string): HTMLElement {
  const row = element("div", "specs__row");
  row.append(element("span", "specs__label", label), element("span", "specs__value", value));
  return row;
}

function section(title: string, body: HTMLElement): HTMLElement {
  const block = element("section", "block");
  block.append(element("h2", "block__title", title), body);
  return block;
}

function renderVenueDetails(venue: PublicVenueDetails): HTMLElement | null {
  const card = element("section", "card");
  let filled = false;

  const specs = element("div", "specs");
  if (venue.capacity !== null) {
    specs.append(specRow("Capacity", String(venue.capacity)));
    filled = true;
  }
  if (venue.soundSystem) {
    specs.append(specRow("Sound system", venue.soundSystem));
    filled = true;
  }
  if (venue.curfew) {
    specs.append(specRow("Curfew", venue.curfew));
    filled = true;
  }
  if (filled) card.append(element("h2", "card__title", "Venue specs"), specs);

  if (venue.amenities.length > 0) {
    card.append(
      element("h3", "card__subtitle", "Amenities"),
      pillRow(
        "pills",
        venue.amenities.map((amenity) => AMENITY_LABELS[amenity] ?? amenity),
      ),
    );
    filled = true;
  }

  if (venue.dealTypes.length > 0) {
    card.append(
      element("h3", "card__subtitle", "Deals we sign"),
      pillRow(
        "pills",
        venue.dealTypes.map((dealType) => DEAL_TYPE_LABELS[dealType] ?? dealType),
      ),
    );
    filled = true;
  }

  for (const [title, text] of [
    ["Catering", venue.cateringNotes],
    ["Accommodation", venue.accommodationNotes],
    ["Getting here", venue.audienceLogisticsNotes],
  ] as const) {
    if (!text) continue;
    card.append(element("h3", "card__subtitle", title), element("p", "card__prose", text));
    filled = true;
  }

  return filled ? card : null;
}

/** "FRI / 12 / SEP" — the date rail the design leads every show with. */
function dateRail(iso: string): HTMLElement {
  const rail = element("div", "showdate");
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    rail.append(element("span", "showdate__day", iso));
    return rail;
  }
  rail.append(
    element("span", "showdate__weekday", date.toLocaleDateString("en-GB", { weekday: "short" })),
    element("span", "showdate__day", String(date.getDate())),
    element("span", "showdate__month", date.toLocaleDateString("en-GB", { month: "short" })),
  );
  return rail;
}

/**
 * "Doors 19:00 · On at 20:30" — whichever halves the event actually carries.
 *
 * Postgres `time` arrives as `19:00:00`, and a door time is not accurate to the
 * second in any real venue. Trimmed to hours and minutes, which is how a door
 * time is written on every poster ever printed.
 */
function clockTime(value: string): string {
  const match = /^(\d{2}:\d{2})/.exec(value);
  return match?.[1] ?? value;
}

function timesLine(show: PublicShow): string | null {
  const parts: string[] = [];
  if (show.doorTime) parts.push(`Doors ${clockTime(show.doorTime)}`);
  if (show.startTime) parts.push(`On at ${clockTime(show.startTime)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The next show, given its own card — the design puts it above everything
 * because it is the one thing most visitors came for.
 *
 * There is no ticket button. `events` carries no price and no ticket link that
 * anything reads, so the card links to the show's own public page, which is a
 * real destination that really exists.
 */
function renderNextShow(show: PublicShow): HTMLElement {
  const card = element("section", "nextshow");
  card.append(dateRail(show.eventDate ?? ""));

  const body = element("div", "nextshow__body");
  body.append(element("span", "nextshow__eyebrow", "Next show"));
  body.append(element("h2", "nextshow__title", show.title));
  if (show.venueName) body.append(element("p", "nextshow__venue", show.venueName));
  const times = timesLine(show);
  if (times) body.append(element("p", "nextshow__times", times));
  card.append(body);

  const link = document.createElement("a");
  link.className = "nextshow__cta";
  link.href = `/event.html?id=${encodeURIComponent(show.id)}`;
  link.textContent = "Show details";
  card.append(link);
  return card;
}

/** The rest of the bill as one soft rail, the design's "All dates". */
function renderShowRail(shows: PublicShow[]): HTMLElement {
  const list = element("ul", "showrail");
  for (const show of shows) {
    const row = element("li", "showrail__row");
    row.append(dateRail(show.eventDate ?? ""));

    const body = element("div", "showrail__body");
    body.append(element("span", "showrail__title", show.title));
    const where = [show.venueName, timesLine(show)].filter(Boolean).join(" · ");
    if (where) body.append(element("span", "showrail__meta", where));
    row.append(body);

    const link = document.createElement("a");
    link.className = "showrail__link";
    link.href = `/event.html?id=${encodeURIComponent(show.id)}`;
    link.textContent = "Details";
    row.append(link);
    list.append(row);
  }
  return list;
}

function renderProfile(container: HTMLElement, profile: PublicProfile): void {
  container.replaceChildren();

  const hero = element("section", "hero");
  const banner = element("div", "hero__banner");
  // Already validated as http(s) by readImageUrl; the quotes plus encodeURI stop
  // a `)` in the path from closing the url() early.
  if (profile.bannerUrl) {
    banner.style.backgroundImage = `url("${encodeURI(profile.bannerUrl)}")`;
  }
  hero.append(banner);

  const identity = element("div", "hero__identity");
  if (profile.avatarUrl) {
    const avatar = document.createElement("img");
    avatar.className = "hero__avatar";
    avatar.src = profile.avatarUrl;
    // The name is already on screen beside it, so the image adds nothing a
    // screen reader needs to hear twice.
    avatar.alt = "";
    identity.append(avatar);
  } else {
    identity.append(
      element("div", "hero__avatar hero__avatar--initials", initialsOf(profile.name)),
    );
  }

  const heading = element("div", "hero__text");
  heading.append(element("h1", "hero__name", profile.name));
  const subtitle = [profile.type ? humanize(profile.type) : humanize(profile.kind)]
    .concat(profile.city ? [profile.city] : [])
    .filter(Boolean)
    .join(" · ");
  if (subtitle) heading.append(element("p", "hero__meta", subtitle));
  identity.append(heading);
  hero.append(identity);
  container.append(hero);

  // SHOWS FIRST. The design's whole argument is that a fan who followed a shared
  // link came for the next date, not for the biography — so the bill sits above
  // the prose, and the next show is lifted out of it into its own card.
  const [nextShow, ...laterShows] = profile.upcomingShows;
  if (nextShow) {
    container.append(renderNextShow(nextShow));
    if (laterShows.length > 0) {
      container.append(section("All dates", renderShowRail(laterShows)));
    }
  } else {
    // An honest empty state, not a hidden section. A profile with nothing
    // announced is the normal state between tours, and saying so is what stops a
    // visitor wondering whether the page is broken.
    container.append(
      section(
        "Shows",
        element("p", "block__prose", "No dates announced right now. Check back soon."),
      ),
    );
  }

  if (profile.bio) {
    container.append(section("About", element("p", "block__prose", profile.bio)));
  }

  if (profile.venueDetails) {
    const venueCard = renderVenueDetails(profile.venueDetails);
    if (venueCard) container.append(venueCard);
  }

  document.title = `${profile.name} · shoWMe`;
  const description = document.querySelector('meta[name="description"]');
  if (description && profile.bio) description.setAttribute("content", profile.bio.slice(0, 300));
}

function renderProblem(container: HTMLElement, title: string, detail: string): void {
  container.replaceChildren();
  const block = element("section", "problem");
  block.append(element("h1", "problem__title", title), element("p", "problem__detail", detail));
  container.append(block);
}

/* ------------------------------------------------------------------ the page */

function setUpThemeToggle(): void {
  const toggle = document.getElementById("theme-toggle");
  if (!(toggle instanceof HTMLButtonElement)) return;

  // Start from the visitor's own OS preference; a public page has no account to
  // read a saved theme from, and it stores nothing (no cookies, no localStorage).
  let light = window.matchMedia("(prefers-color-scheme: light)").matches;

  const apply = () => {
    if (light) document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.removeAttribute("data-theme");
    toggle.setAttribute("aria-pressed", String(light));
    toggle.textContent = light ? "Dark mode" : "Light mode";
  };

  toggle.addEventListener("click", () => {
    light = !light;
    apply();
  });
  apply();
}

async function render(): Promise<void> {
  const container = document.getElementById("profile");
  if (!container) return;

  const slug = readSlug();
  if (!slug) {
    renderProblem(
      container,
      "No profile in this link",
      "The link is missing the profile it points at. Ask whoever shared it for the full address.",
    );
    return;
  }

  const result = await fetchProfile(slug);
  if (result === "missing") {
    renderProblem(
      container,
      "Profile not found",
      "This profile does not exist, or its owner has not published it.",
    );
    return;
  }
  if (result === "unavailable") {
    renderProblem(
      container,
      "Profile unavailable",
      "We could not load this profile just now. Please try again in a moment.",
    );
    return;
  }
  renderProfile(container, result);
}

setUpThemeToggle();
void render();
