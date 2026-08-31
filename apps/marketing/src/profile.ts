/**
 * The public profile page — a performer's or a venue's own page, for anyone with
 * the link and no account.
 *
 * WHY IT LIVES IN `apps/marketing` and not in the app: `apps/web` mounts its
 * router only once a Firebase session exists (`apps/web/src/main.tsx`,
 * `AuthGate`), so a signed-out visitor never reaches a route there at all. This
 * bundle carries no Firebase SDK and no authenticated API client, so it *cannot*
 * read a session or call a protected route even by mistake. Same reasoning that
 * put `availability.html` here.
 *
 * THE LAYOUT IS THE PROTOTYPE'S, screen by screen — Claude Design "Public
 * Profiles", turn 3 ("Slicker, softer — the fan-facing cut"): 3a for a performer,
 * 3b for a venue, 3c for the phone. Rendered and read with eyes, per the
 * `claude-design` skill. The one rule that shapes every decision below is the
 * owner's: **match the layout, wire real data, never mock.** Where the prototype
 * shows a control this stack cannot honestly serve, the control is ABSENT and the
 * reason is written down beside where it would have gone (STYLE-GUIDE §7 — a
 * control that does nothing spends the reader's trust).
 *
 * WHAT IT MAY SHOW — the entire response of `GET /public/profiles/:slug`, which
 * is a hard allowlist in `apps/api/src/serialize/profile.ts`, not a redaction:
 *
 *   name        the profile's own public display name
 *   tagline     the one line under it, written in the owner's editor
 *   type/kind   "venue", "operator" — what sort of party this is
 *   bio         prose the owner wrote for exactly this purpose
 *   avatarUrl   the owner's chosen picture
 *   bannerUrl   the owner's chosen cover image
 *   photos      the gallery the owner uploaded, in their own order. These are
 *               SIGNED URLs minted for this response, not bucket paths — the
 *               objects live in a private bucket and are reachable only through
 *               a URL the API issued and that expires.
 *   videos      YouTube/Vimeo links the owner added. Re-parsed here before they
 *               are embedded (see `renderVideos`) — the stored string never
 *               becomes an iframe `src`.
 *   genres      the owner's own words for what they play
 *   venueDetails capacity, PA, curfew, and how the AUDIENCE gets in. Never the
 *               artist half, and never the trade half — see below.
 *   upcomingShows the bill: date, room, city, and who else is on it
 *   id          NOT rendered. It is read because "request a date" addresses its
 *               target by id, the way availability.ts does.
 *
 * Nothing financial, no membership, no contact details, no `details` jsonb and
 * no `billing` are in that projection — they are never SELECTed, so they cannot
 * leak. The route additionally requires `profiles.is_public = true`; a private
 * profile is a 404, not a 403, so this page cannot be used to probe for the
 * existence of an unpublished venue either.
 *
 * WHAT MUST NEVER APPEAR HERE, and is deliberately not read even if a future
 * endpoint were to offer it: `artistLogisticsNotes` (load-in, back entrance,
 * artist parking — private to booked parties per `docs/decisions.md` #16.7),
 * `contactEmail` and `contactPhone` (an open page that prints a booker's mailbox
 * is a scraper's gift), the venue trade half — `amenities`, `dealTypes`,
 * `cateringNotes`, `accommodationNotes` — and `setups`.
 *
 * `setups` used to be read and drawn here as the About band's chips. It is trade
 * information for the same reason the venue's four are (`docs/decisions.md` #19):
 * "Full band, 7 people" is how an operator sizes the stage, the rider and the
 * travel party before offering, which is a negotiating fact, not audience copy.
 * The API stopped sending it; this page stopped asking for it. Neither half is
 * enough on its own, and a reader that asks for a field it is not owed is how a
 * disclosure gets re-opened.
 */

import { type VideoLink, parseVideoLink } from "@showme/shared";
import {
  BOOKING_REQUEST_LABEL,
  type DateRequestPanel,
  createDateRequestPanel,
} from "./availability-request";
import { element } from "./element";

/** API base including `/api/v1`. Empty renders the page's "unavailable" state
 * rather than silently showing an empty profile. */
const API_BASE_URL: string = import.meta.env.VITE_PUBLIC_API_URL ?? "";

/**
 * Where the web app lives. The industry lane links to it, because the documents
 * that lane is about are behind a login. Empty (an unconfigured build) drops the
 * link rather than rendering one that goes nowhere.
 */
const APP_URL: string = import.meta.env.VITE_APP_URL ?? "";

/**
 * The room, as a stranger may read it. Amenities, deal types, catering and
 * accommodation notes used to arrive here and no longer do — they are trade
 * details, held back from the open web (`docs/decisions.md` #19). This page must
 * not grow a slot for them again: the API stopped sending them, and a reader
 * that asks for a field it is not owed is how a disclosure gets re-opened.
 */
interface PublicVenueDetails {
  capacity: number | null;
  soundSystem: string | null;
  curfew: string | null;
  audienceLogisticsNotes: string | null;
}

/** One act billed on a night beside the profile whose page this is. */
interface PublicLineupEntry {
  name: string;
  role: string;
  tag: string | null;
}

/**
 * One show on the bill.
 *
 * Deliberately only what the API can honestly answer. The prototype shows a
 * ticket price, "Last 40 tickets", "Sold out" and a "Get tickets" button; the
 * API publishes no price, no ticket link and no inventory, so none of those are
 * modelled here. Inventing them would be the mocked data this repo's rules
 * forbid, and a fan who trusts a price we made up is worse served than one who
 * is told the date and the room. The gap is written up in
 * `docs/public-profile-design-gaps.md`.
 */
interface PublicShow {
  id: string;
  title: string;
  eventDate: string | null;
  venueName: string | null;
  city: string | null;
  country: string | null;
  doorTime: string | null;
  startTime: string | null;
  /** The poster, when the host has put one on the show. */
  imageUrl: string | null;
  lineup: PublicLineupEntry[];
}

/** A platform the act publishes on — the prototype's row of chips. */
interface PublicSocialLink {
  platform: string;
  url: string;
}

interface PublicProfile {
  id: string;
  name: string;
  type: string | null;
  kind: string;
  bio: string | null;
  tagline: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  /** The doorstep. The API nulls both for anyone who is not a place. */
  street: string | null;
  postcode: string | null;
  city: string | null;
  country: string | null;
  genres: string[];
  /** Gallery images. Signed URLs when the owner uploaded them — see the API. */
  photos: string[];
  /** YouTube/Vimeo links. Re-parsed here; nothing else ever reaches an iframe. */
  videos: string[];
  venueDetails: PublicVenueDetails | null;
  upcomingShows: PublicShow[];
  socialLinks: PublicSocialLink[];
}

/* -------------------------------------------------------------------- input */

/**
 * The slug, from `/profile/<slug>` or from `?slug=<slug>`.
 *
 * The path form is the address the world gets (`firebase.json` rewrites it here);
 * the query form is every link built before that, so it is read first and never
 * dropped.
 *
 * `/profile` on its own is NOT a slug. Hosting's `cleanUrls` serves this page at
 * that bare address too, and without the guard the page would look up a profile
 * called "profile" and report that it does not exist — a lookup failure standing
 * in for "you did not name one".
 */
const PAGE_SEGMENTS = new Set(["profile", "profile.html"]);

function readSlug(): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get("slug");
  if (fromQuery) return fromQuery.trim() || null;

  const segments = window.location.pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last || PAGE_SEGMENTS.has(last)) return null;
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
    // NOTE: `artistLogisticsNotes`, `contactEmail`, `contactPhone` and the four
    // trade fields are not read. Their absence here is the point — see the
    // module docstring.
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
    id: readString(source.id) ?? "",
    name,
    type: readString(source.type),
    kind: readString(source.kind) ?? "",
    bio: readString(source.bio),
    tagline: readString(source.tagline),
    avatarUrl: readImageUrl(source.avatarUrl),
    bannerUrl: readImageUrl(source.bannerUrl),
    photos: readStringArray(source.photos)
      .map(readImageUrl)
      .filter((url): url is string => url !== null),
    videos: readStringArray(source.videos),
    genres: readStringArray(source.genres),
    street: readString(location.street),
    postcode: readString(location.postcode),
    city: readString(location.city),
    country: readString(location.country),
    venueDetails: readVenueDetails(source.venueDetails),
    upcomingShows: readShows(source.upcomingShows),
    socialLinks: readSocialLinks(source.socialLinks),
  };
}

/**
 * The platform links, each validated as http(s) before it can become an `href`.
 *
 * `readImageUrl` already does exactly this check for pictures; the same rule has
 * to apply here, because a `javascript:` URL in a link a stranger clicks is the
 * same hole as one in an `<img src>`. Resolved against the page origin so a
 * relative value cannot smuggle a scheme past the test.
 */
function readSocialLinks(value: unknown): PublicSocialLink[] {
  if (!Array.isArray(value)) return [];
  const links: PublicSocialLink[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const source = entry as Record<string, unknown>;
    const platform = readString(source.platform);
    const url = readImageUrl(source.url);
    if (!platform || !url) continue;
    links.push({ platform, url });
  }
  return links;
}

function readLineup(value: unknown): PublicLineupEntry[] {
  if (!Array.isArray(value)) return [];
  const lineup: PublicLineupEntry[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const source = entry as Record<string, unknown>;
    const name = readString(source.name);
    if (!name) continue;
    lineup.push({ name, role: readString(source.role) ?? "", tag: readString(source.tag) });
  }
  return lineup;
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
      city: readString(source.city),
      country: readString(source.country),
      doorTime: readString(source.doorTime),
      startTime: readString(source.startTime),
      imageUrl: readImageUrl(source.imageUrl),
      lineup: readLineup(source.lineup),
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

/* ------------------------------------------------------------------ wording */

/**
 * A place has a programme; everybody else has dates.
 *
 * `isPlaceProfile` in `@showme/shared` draws this line server-side (it decides
 * whether the street address is even published). The same question is asked here
 * for wording only, and it is asked of `type` first because that is the finer
 * fact: an `operator` may be a venue OR a promoter, and only one of them is a
 * room you can stand in.
 */
function isPlace(profile: PublicProfile): boolean {
  return profile.type === "venue" || profile.type === "festival" || profile.venueDetails !== null;
}

/** Title-case a stored key ("team_and_crew" → "Team And Crew"). */
function humanize(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The prototype's two vocabularies, chosen once and read everywhere below.
 *
 * The ask is deliberately NOT one of the two. A room said "Pitch a date" and an
 * act said "Request a show", which asked the reader to work out that the two
 * buttons post the same body to the same endpoint and land in the same inbox.
 * One thing has one name — `BOOKING_REQUEST_LABEL`, shared with the panel it
 * opens. The rest of the pair still differs, because a programme and a tour
 * genuinely are different words.
 */
interface Vocabulary {
  showsLabel: string;
  showsAnchor: string;
  heroCta: string;
  aboutLabel: string;
  laneEyebrow: string;
  laneProse: string;
  emptyShows: string;
}

function vocabularyFor(profile: PublicProfile): Vocabulary {
  return isPlace(profile)
    ? {
        showsLabel: "What's on",
        showsAnchor: "shows",
        heroCta: "What's on",
        aboutLabel: "The room",
        laneEyebrow: "Artists & promoters",
        laneProse:
          "House tech spec, patch list and load-in notes are shared with signed-in artists and crew — never on the open web.",
        emptyShows: "Nothing announced right now. Check back soon.",
      }
    : {
        showsLabel: "All dates",
        showsAnchor: "dates",
        heroCta: "Shows",
        aboutLabel: "About",
        laneEyebrow: "Booking & industry",
        laneProse:
          "Riders, stage plots and hospitality notes are shared with signed-in venues, promoters and crew — never on the open web.",
        emptyShows: "No dates announced right now. Check back soon.",
      };
}

/* ------------------------------------------------------------------- pieces */

/** A `<a>` that leaves the platform. Every one of these carries `noopener`. */
function externalLink(className: string, href: string, label: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = className;
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  return link;
}

function internalLink(className: string, href: string, label: string): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = className;
  link.href = href;
  link.textContent = label;
  return link;
}

function pillRow(className: string, labels: string[], itemClassName = "pill"): HTMLElement {
  const row = element("div", className);
  for (const label of labels) row.append(element("span", itemClassName, label));
  return row;
}

/** A titled band of the page. `id` is what the top nav points at. */
function band(
  id: string,
  title: string,
  action: HTMLElement | null,
  body: HTMLElement,
): HTMLElement {
  const section = element("section", "band");
  section.id = id;
  const head = element("div", "band__head");
  head.append(element("h2", "band__title", title));
  if (action) head.append(action);
  section.append(head, body);
  return section;
}

/* ------------------------------------------------------------------- dates */

/**
 * "FRI / 12 / SEP" — the date block the prototype leads every show with.
 *
 * `en-GB` rather than the visitor's locale on purpose: this is a poster, and the
 * three-letter month beside a two-digit day is a fixed piece of typography with a
 * fixed width. A locale that writes "sept." or "9月" breaks the block it sits in.
 */
function dateBlock(iso: string, className = "showdate"): HTMLElement {
  const block = element("div", className);
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    block.append(element("span", `${className}__day`, iso));
    return block;
  }
  block.append(
    element(
      "span",
      `${className}__weekday`,
      date.toLocaleDateString("en-GB", { weekday: "short" }),
    ),
    element("span", `${className}__day`, String(date.getDate())),
    element("span", `${className}__month`, date.toLocaleDateString("en-GB", { month: "short" })),
  );
  return block;
}

/** "Fri 12 Sep · 20:00" — the venue card's one-line stamp. */
function stampLine(show: PublicShow): string {
  const date = show.eventDate ? new Date(`${show.eventDate}T00:00:00`) : null;
  const parts: string[] = [];
  if (date && !Number.isNaN(date.getTime())) {
    parts.push(
      date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }),
    );
  }
  if (show.startTime) parts.push(clockTime(show.startTime));
  return parts.join(" · ");
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

function timePills(show: PublicShow): string[] {
  const pills: string[] = [];
  if (show.doorTime) pills.push(`Doors ${clockTime(show.doorTime)}`);
  if (show.startTime) pills.push(`On at ${clockTime(show.startTime)}`);
  return pills;
}

/** "Berlin, DE" — the town, which is the fact a fan filters on. */
function placeLine(show: PublicShow): string | null {
  const parts = [show.city, show.country].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * "with Marta Wolff" — who else is billed.
 *
 * Two names are named; past that it is "+2 more", because the prototype gives
 * this one line and a bill of nine acts would eat the row it sits in. The count
 * is honest about what it is hiding.
 *
 * The lead word is the caller's, because the prototype uses two: a performer's
 * own date reads "Halle 7 **with** Marta Wolff", while a venue's poster card puts
 * the headliner in the title and the rest under it as "**+** Marta Wolff".
 */
function lineupLine(show: PublicShow, lead = "with"): string | null {
  // An act the title already names is not "also on the bill". A venue's event is
  // usually titled after its headliner ("Marlo Vance — Album Release"), and
  // without this the card under it reads "+ Marlo Vance and Neon Tide" — the
  // headliner introduced as their own support act.
  const headline = show.title.toLowerCase();
  const others = show.lineup.filter((act) => !headline.includes(act.name.toLowerCase()));
  const [first, second, ...rest] = others;
  if (!first) return null;
  const names = second ? `${first.name} and ${second.name}` : first.name;
  const joined = rest.length > 0 ? `${names} +${rest.length} more` : names;
  return lead === "+" ? `+ ${joined}` : `${lead} ${joined}`;
}

/**
 * What a show is CALLED on this page, which depends on whose page it is.
 *
 * On a venue's own programme the event title is the billing ("Marlo Vance —
 * Album Release"). On a performer's page the title is usually their own name
 * again, and the fact the reader wants is the room — so the room leads and the
 * title is dropped rather than repeated back at them.
 */
function showHeadline(show: PublicShow, place: boolean): string {
  if (place) return show.title;
  return show.venueName ?? show.title;
}

/**
 * Where a show's own public page lives — `/event/<id>`, the address Hosting
 * rewrites to `event.html` and the app builds when it publishes a show.
 *
 * It used to be `/event.html?id=…`, which was a dead link in two ways at once:
 * the page reads `?event=`, never `?id=`, and the extension is the thing the
 * readable path exists to drop.
 */
function showHref(show: PublicShow): string {
  return `/event/${encodeURIComponent(show.id)}`;
}

/* -------------------------------------------------------------------- hero */

/**
 * The hero — the prototype's full-bleed opening: a picture running up behind the
 * top bar, a warm glow, the name at display size, and one line under it.
 *
 * THE PICTURE is the banner. When there is no banner but there IS an avatar, the
 * avatar takes the job: a logo blown up behind a scrim is what a venue with one
 * square picture actually has, and an empty hero is not better for being pure.
 * There is no avatar CHIP because the prototype has none — the name is the
 * identity at this size, and a 96px logo beside a 96px name is two identities.
 */
function renderHero(profile: PublicProfile, vocabulary: Vocabulary): HTMLElement {
  const hero = element("section", "hero");

  const media = element("div", "hero__media");
  const picture = profile.bannerUrl ?? profile.avatarUrl;
  // Already validated as http(s) by readImageUrl; the quotes plus encodeURI stop
  // a `)` in the path from closing the url() early.
  if (picture) media.style.backgroundImage = `url("${encodeURI(picture)}")`;
  // A stand-in avatar is square and small, so it is blurred up rather than
  // stretched: a 400px logo scaled to a 2400px banner is a smear either way, and
  // the blurred one is the one that looks deliberate.
  if (picture && !profile.bannerUrl) media.classList.add("hero__media--stand-in");
  hero.append(media, element("div", "hero__scrim"));

  const body = element("div", "hero__body");

  const pills = heroPills(profile);
  if (pills.length > 0) {
    const row = element("div", "hero__pills");
    for (const [index, label] of pills.entries()) {
      // The first pill is the live one — the prototype gives it a dot and the
      // brand tint; the rest are quiet facts beside it.
      row.append(
        element("span", index === 0 ? "statuspill" : "statuspill statuspill--quiet", label),
      );
    }
    body.append(row);
  }

  body.append(element("h1", "hero__name", profile.name));
  if (profile.tagline) body.append(element("p", "hero__tagline", profile.tagline));

  // EVERY genre, under the tagline, as pills — the same shape the owner sees in
  // the app's Preview (`apps/web/src/components/ProfilePublicPreview.tsx`), so
  // the page and the preview of it stop disagreeing.
  //
  // They used to be the last two entries of the status row above the name, which
  // dropped the third genre onto the floor and never ran at all for a venue (that
  // branch returns before it). A row a fan reads as "what do they play" cannot
  // answer with a two-item sample, and the crowded strip over the name is not
  // where it belongs anyway. Hero chrome rather than the `.pill` of the bands
  // below, because these sit on the cover image.
  if (profile.genres.length > 0) {
    body.append(pillRow("hero__genres", profile.genres, "statuspill statuspill--quiet"));
  }

  // ONE button, where the prototype has two. "Follow" is the other, and nothing
  // in this stack can take a follow: `audience_rsvps` is keyed to an EVENT, and
  // there is no profile-level subscription table, endpoint or screen. A Follow
  // that quietly does nothing is the dead affordance STYLE-GUIDE §7 forbids, so
  // it is absent until the audience feature exists. Same reason the prototype's
  // "Alert me for my city" and its two mail-signup fields are not below.
  if (profile.upcomingShows.length > 0) {
    const actions = element("div", "hero__actions");
    actions.append(
      internalLink("btn btn--primary", `#${vocabulary.showsAnchor}`, vocabulary.heroCta),
    );
    body.append(actions);
  }

  hero.append(body);
  return hero;
}

/**
 * The pills over the name — what is TRUE about this profile right now.
 *
 * The prototype's are "On tour · autumn 2026" and "Kreuzberg, Berlin / 220
 * capacity". The second pair is data we hold; the first is a status nothing in
 * the schema records, so the count of announced dates stands in its place — the
 * same claim ("this act is playing"), made only as far as the data goes.
 */
function heroPills(profile: PublicProfile): string[] {
  const pills: string[] = [];
  const shows = profile.upcomingShows.length;
  const home = [profile.city, profile.country].filter(Boolean).join(", ");

  if (isPlace(profile)) {
    if (home) pills.push(home);
    const capacity = profile.venueDetails?.capacity;
    if (typeof capacity === "number") pills.push(`${capacity} capacity`);
    if (pills.length === 0 && profile.type) pills.push(humanize(profile.type));
    return pills;
  }

  if (shows > 0) pills.push(shows === 1 ? "1 date announced" : `${shows} dates announced`);
  if (home) pills.push(home);
  // No genres here. They are drawn under the tagline instead — see `renderHero`.
  if (pills.length === 0) pills.push(humanize(profile.type ?? profile.kind));
  return pills;
}

/* -------------------------------------------------------------------- shows */

/**
 * The next show, given its own card — the prototype puts it above everything
 * because it is the one thing most visitors came for.
 *
 * There is no ticket button and no price. `events` carries no public ticket link
 * and no published price (`extras.ticketTiers` is the operator's own planning
 * figure and is not in the public projection), so the card links to the show's
 * own public page, which is a real destination that really exists.
 */
function renderNextShow(show: PublicShow, place: boolean): HTMLElement {
  const card = element("section", "nextshow");
  // The poster stands in for the date block when there is one: it is the same
  // job — say at a glance which show this is — done better by the artwork the
  // host made for exactly that.
  if (show.imageUrl) {
    const art = element("div", "nextshow__art");
    art.style.backgroundImage = `url("${encodeURI(show.imageUrl)}")`;
    card.append(art);
  } else {
    card.append(dateBlock(show.eventDate ?? ""));
  }

  const body = element("div", "nextshow__body");
  const where = placeLine(show);
  body.append(element("span", "nextshow__eyebrow", where ? `Next show · ${where}` : "Next show"));

  const title = element("h2", "nextshow__title", showHeadline(show, place));
  const withWhom = lineupLine(show);
  if (withWhom) title.append(element("span", "nextshow__with", ` ${withWhom}`));
  body.append(title);

  const pills = timePills(show);
  if (pills.length > 0) body.append(pillRow("nextshow__pills", pills));
  card.append(body);

  card.append(internalLink("btn btn--primary nextshow__cta", showHref(show), "Show details"));
  return card;
}

/** One row of the dates rail — the prototype's "All dates" list. */
function showRow(show: PublicShow, place: boolean): HTMLElement {
  const row = element("li", "showrow");
  row.append(dateBlock(show.eventDate ?? "", "showrow__date"));

  const body = element("div", "showrow__body");
  body.append(element("span", "showrow__title", showHeadline(show, place)));
  // The room is only repeated when it is NOT already the row's headline — on a
  // performer's page it is the headline, and "The Lantern Hall · The Lantern
  // Hall" is what happens if you forget that.
  const room = place ? show.venueName : null;
  const meta = [placeLine(show), room, lineupLine(show)]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  if (meta) body.append(element("span", "showrow__meta", meta));
  row.append(body);

  row.append(internalLink("btn btn--ghost showrow__cta", showHref(show), "Details"));
  return row;
}

/**
 * A venue's programme leads with three poster cards, the way the prototype's
 * "This week" does.
 *
 * The poster is the host's own artwork when they have uploaded one (a signed URL,
 * minted for this response). A show with none keeps the warm wash the prototype
 * draws under its OWN placeholder art, so the wall reads as a wall either way —
 * an empty grey box would be the only version that looks broken.
 */
function showCard(show: PublicShow): HTMLElement {
  const card = element("li", "showcard");
  const art = element("div", "showcard__art");
  if (show.imageUrl) {
    art.style.backgroundImage = `url("${encodeURI(show.imageUrl)}")`;
    art.classList.add("showcard__art--poster");
  }
  card.append(art);

  const body = element("div", "showcard__body");
  const stamp = stampLine(show);
  if (stamp) body.append(element("span", "showcard__stamp", stamp));
  body.append(element("h3", "showcard__title", show.title));
  const meta = [lineupLine(show, "+"), placeLine(show)]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  if (meta) body.append(element("span", "showcard__meta", meta));

  const foot = element("div", "showcard__foot");
  const times = timePills(show);
  foot.append(element("span", "showcard__times", times.join(" · ")));
  foot.append(internalLink("btn btn--primary", showHref(show), "Details"));
  body.append(foot);

  card.append(body);
  return card;
}

/** The bill: cards for a venue's next three, a rail for everything after. */
function renderShows(profile: PublicProfile, vocabulary: Vocabulary): HTMLElement {
  const place = isPlace(profile);
  const shows = profile.upcomingShows;
  const body = element("div", "shows");

  if (shows.length === 0) {
    // An honest empty state, not a hidden section. A profile with nothing
    // announced is the normal state between tours, and saying so is what stops a
    // visitor wondering whether the page is broken.
    body.append(element("p", "shows__empty", vocabulary.emptyShows));
    return band(vocabulary.showsAnchor, vocabulary.showsLabel, null, body);
  }

  const featured = place ? shows.slice(0, 3) : [];
  const listed = shows.slice(featured.length);

  if (featured.length > 0) {
    const grid = element("ul", "showcards");
    for (const show of featured) grid.append(showCard(show));
    body.append(grid);
  }
  if (listed.length > 0) {
    if (featured.length > 0) body.append(element("p", "shows__subhead", "Later"));
    const list = element("ul", "showrail");
    for (const show of listed) list.append(showRow(show, place));
    body.append(list);
  }

  const count = element(
    "span",
    "band__count",
    shows.length === 1 ? "1 upcoming" : `${shows.length} upcoming`,
  );
  return band(vocabulary.showsAnchor, vocabulary.showsLabel, count, body);
}

/* -------------------------------------------------------------------- media */

/**
 * The videos: three to a row, and the first one is larger only when there ARE
 * three — the prototype's arrangement, which needs two tiles beside the big one
 * to be an arrangement at all.
 *
 * It used to give `--featured` to the first video unconditionally, and the row is
 * a grid whose cells fill their track, so a profile with ONE video published a
 * single player two-thirds of the page wide. One upload is the commonest case
 * there is, and it was the worst-looking one. The links are parsed up front for
 * exactly this reason: whether the first tile is featured is a fact about how
 * many videos there are, and that is not known until the last one is read.
 *
 * NOTHING LOADS UNTIL IT IS CLICKED. The tile is a button on the card's own
 * ground; the `<iframe>` replaces it on the first click. That is the prototype's
 * own shape (a play badge on artwork, not a live player) and it is also the only
 * version of this section that does not hand every visitor's IP to YouTube before
 * they have asked for anything — the same reason the fonts on this site are
 * self-hosted. There is no thumbnail for the same reason: a poster image would be
 * a third-party request too.
 *
 * The `src` is `link.embedUrl`, which `parseVideoLink` BUILT from a provider and
 * an id — the stored string never becomes an iframe source. The server already
 * refuses to store anything else; this parse is the second half of the same rule,
 * because a public page must not depend on the database only ever having been
 * written by the current version of the API.
 */
function renderVideos(videos: string[]): HTMLElement | null {
  const links = videos.map(parseVideoLink).filter((link): link is VideoLink => link !== null);
  if (links.length === 0) return null;

  const grid = element("div", "videos");
  for (const [index, link] of links.entries()) {
    // The prototype's one-large-two-small only exists from three up. Below that
    // every tile is a third of the row, which is what stops a lone video filling
    // the band.
    const featured = index === 0 && links.length >= 3;
    grid.append(videoTile(link, featured));
  }
  return grid;
}

/** One cell of the video wall: the click-to-load player, and the way out of it. */
function videoTile(link: VideoLink, featured: boolean): HTMLElement {
  const provider = link.provider === "youtube" ? "YouTube" : "Vimeo";
  const cell = element("div", featured ? "video video--featured" : "video");

  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "video__tile";
  tile.setAttribute("aria-label", `Play this ${provider} video`);
  tile.append(element("span", "video__play"), element("span", "video__hint", provider));
  tile.addEventListener(
    "click",
    () => {
      const frame = document.createElement("iframe");
      frame.className = "video__frame";
      frame.src = `${link.embedUrl}${link.embedUrl.includes("?") ? "&" : "?"}autoplay=1`;
      frame.title = `${provider} video`;
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      frame.allow =
        "autoplay; accelerometer; clipboard-write; encrypted-media; picture-in-picture; fullscreen";
      frame.allowFullscreen = true;
      tile.replaceWith(frame);
    },
    { once: true },
  );
  cell.append(tile);

  // The way OUT. Fullscreen already worked; there was no way to open the video
  // where it LIVES, which is what a visitor wants the moment they mean to
  // subscribe, comment or share. `canonicalUrl` is the page `parseVideoLink`
  // built from the same provider and id as the embed — never the pasted string —
  // and it is what the API stored, so this link cannot point anywhere the player
  // does not.
  cell.append(externalLink("video__out", link.canonicalUrl, `Watch on ${provider}`));
  return cell;
}

/**
 * "Listen" — the platform links as a row of chips.
 *
 * Every chip is a real link the owner published. `rel="noopener noreferrer"`
 * because these lead off-platform to addresses we do not control.
 */
function renderSocialChips(links: PublicSocialLink[]): HTMLElement {
  const row = element("div", "chiprow");
  for (const link of links) {
    row.append(externalLink("chip", link.url, humanize(link.platform)));
  }
  return row;
}

/* -------------------------------------------------------------------- about */

/**
 * The about band — the prototype's serif lead, the prose under it, and the
 * gallery beside it.
 *
 * The lead is the bio's FIRST SENTENCE, set large; the rest follows in body
 * type. The prototype has two fields there (a display headline and a paragraph)
 * and the profile editor has one, so rather than leave the headline blank or
 * invent a second field, the owner's own opening line does the job it was
 * already doing. A bio that is one sentence long is all lead and no prose, which
 * still reads correctly.
 */
function splitBio(bio: string): { lead: string; rest: string | null } {
  const match = /^(.+?[.!?])(\s+)(.+)$/s.exec(bio.trim());
  if (!match?.[1] || !match[3]) return { lead: bio.trim(), rest: null };
  // A one-word "sentence" is an abbreviation, not a lead. Fall back to the whole
  // thing rather than setting "Est." at 30px.
  if (match[1].length < 12) return { lead: bio.trim(), rest: null };
  return { lead: match[1], rest: match[3] };
}

function renderAbout(profile: PublicProfile, vocabulary: Vocabulary): HTMLElement | null {
  const body = element("div", "about");
  const prose = element("div", "about__prose");
  let filled = false;

  if (profile.bio) {
    const { lead, rest } = splitBio(profile.bio);
    prose.append(element("p", "about__lead", lead));
    if (rest) prose.append(element("p", "about__body", rest));
    filled = true;
  }

  // The chips under the prose: the room, in facts a stranger may read. A
  // performer's half of this row used to be their line-ups, and those left the
  // public page with the venue's trade details (`docs/decisions.md` #19) — their
  // genres are the identity claim that belongs on an open page, and they are
  // drawn in the hero under the tagline where a visitor reads them first.
  const chips = isPlace(profile) ? roomChips(profile.venueDetails) : [];
  if (chips.length > 0) {
    prose.append(pillRow("about__chips", chips));
    filled = true;
  }
  body.append(prose);

  if (profile.photos.length > 0) {
    body.append(renderPhotos(profile.photos));
    filled = true;
  }

  return filled ? band("about", vocabulary.aboutLabel, null, body) : null;
}

/**
 * "220 capacity · Curfew 02:00 · Funktion-One" — the room, in chips.
 *
 * Amenity and deal-type chips used to trail these three. They are gone with the
 * fields that fed them: what a room throws in and which deals it signs is trade
 * information, not a listing (`docs/decisions.md` #19).
 */
function roomChips(venue: PublicVenueDetails | null): string[] {
  if (!venue) return [];
  const chips: string[] = [];
  if (venue.capacity !== null) chips.push(`${venue.capacity} capacity`);
  if (venue.curfew) chips.push(`Curfew ${clockTime(venue.curfew)}`);
  if (venue.soundSystem) chips.push(venue.soundSystem);
  return chips;
}

/**
 * The gallery. `<img>` rather than a CSS background so the browser can lazy-load
 * it and a screen reader can skip it: these are pictures of the room, not
 * decoration with meaning, so the alt text is empty by design.
 *
 * EVERY PHOTO KEEPS THE SHAPE IT WAS UPLOADED IN. This used to take a `place`
 * flag and crop the wall to `4 / 5` for an act and `5 / 4` for a room, on the
 * theory that a subject has a correct orientation. An uploader who framed a
 * landscape shot of a full room got it centre-cropped to a portrait; the flag
 * decided the shape of a picture it had never seen. The wall is a masonry now
 * (see `.gallery`), so the pictures decide.
 */
function renderPhotos(photos: string[]): HTMLElement {
  const grid = element("div", "gallery");
  for (const url of photos) {
    const image = document.createElement("img");
    image.className = "gallery__item";
    image.loading = "lazy";
    image.src = url;
    image.alt = "";
    grid.append(image);
  }
  return grid;
}

/* ------------------------------------------------------------------ find us */

/**
 * "Find us" — a place's doorstep, and how the audience gets to it.
 *
 * Only ever rendered for a place, and only from what the API published: the
 * server nulls `street`/`postcode` for anyone who is not a room
 * (`serializePublicLocation`), so a performer cannot reach this band even by
 * accident. There is no map: every tile provider is a third-party request on a
 * page that makes none, and an address a visitor can paste into their own maps
 * app is the part they actually use.
 */
function renderFindUs(profile: PublicProfile): HTMLElement | null {
  const town = [profile.postcode, profile.city].filter(Boolean).join(" ");
  const lines = [profile.street, town, profile.country].filter((line): line is string =>
    Boolean(line),
  );
  const notes = profile.venueDetails?.audienceLogisticsNotes;
  if (lines.length === 0 && !notes) return null;

  const body = element("div", "findus");
  if (lines.length > 0) {
    const card = element("div", "findus__card");
    for (const [index, line] of lines.entries()) {
      card.append(element("p", index === 0 ? "findus__street" : "findus__line", line));
    }
    body.append(card);
  }
  if (notes) body.append(element("p", "findus__notes", notes));
  return band("find", "Find us", null, body);
}

/* --------------------------------------------------------------------- lane */

/**
 * The industry lane — the prototype's quiet strip at the bottom, for the venues,
 * promoters, artists and crew rather than the fans above it.
 *
 * TWO CONTROLS, both real:
 *
 *   Send booking request opens the same form the public availability page uses
 *   (`availability-request.ts`) and POSTs the same public, unauthenticated
 *   `POST /booking-requests`. It lands in the target's Requests inbox like any
 *   other. The availability page binds it to a date the sharer published; a
 *   profile has no such list, so it opens with no date — `wanted_date` is
 *   nullable and the API's public body makes it optional.
 *
 *   Sign in for documents goes to the app. The documents themselves are not here
 *   and never will be; the lane's job is to say they exist and that there is a
 *   login behind them. Dropped entirely when the build has no `VITE_APP_URL`.
 *
 * The prototype also puts a "Verified · 24 settled" badge here. Nothing publishes
 * a settled-show count, and a trust badge is the last thing to fake, so it is
 * absent.
 */
function renderLane(vocabulary: Vocabulary, onRequest: (() => void) | null): HTMLElement {
  const lane = element("section", "lane");

  const words = element("div", "lane__words");
  words.append(element("span", "lane__eyebrow", vocabulary.laneEyebrow));
  words.append(element("p", "lane__prose", vocabulary.laneProse));
  lane.append(words);

  const actions = element("div", "lane__actions");
  if (APP_URL) actions.append(externalLink("btn btn--ghost", APP_URL, "Sign in for documents"));
  if (onRequest) {
    const request = document.createElement("button");
    request.type = "button";
    request.className = "btn btn--light";
    request.textContent = BOOKING_REQUEST_LABEL;
    request.addEventListener("click", onRequest);
    actions.append(request);
  }
  if (actions.childElementCount > 0) lane.append(actions);
  return lane;
}

/* -------------------------------------------------------------- sticky bar */

/**
 * The phone's sticky bar (prototype 3c) — the next date and a way into it,
 * pinned so it survives the scroll.
 *
 * CSS decides whether it is on screen; this only decides whether it exists, and
 * it does not exist when there is no next show to put in it.
 */
function renderStickyBar(show: PublicShow, place: boolean): HTMLElement {
  const bar = element("aside", "stickybar");
  const words = element("div", "stickybar__words");
  const stamp = stampLine(show);
  const where = [showHeadline(show, place), placeLine(show)]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  if (stamp) words.append(element("span", "stickybar__stamp", stamp));
  words.append(element("span", "stickybar__title", where));
  bar.append(words, internalLink("btn btn--primary", showHref(show), "Details"));
  return bar;
}

/* ---------------------------------------------------------------- rendering */

function renderProfile(container: HTMLElement, profile: PublicProfile): void {
  container.replaceChildren();
  const vocabulary = vocabularyFor(profile);
  const place = isPlace(profile);

  container.append(renderHero(profile, vocabulary));

  // SHOWS FIRST. The prototype's whole argument is that a fan who followed a
  // shared link came for the next date, not for the biography — so the bill sits
  // above the prose, and (on a performer's page) the next show is lifted out of
  // it into its own card.
  const [nextShow] = profile.upcomingShows;
  if (nextShow && !place) container.append(renderNextShow(nextShow, place));
  container.append(renderShows(profile, vocabulary));

  // ABOUT FOLLOWS THE DATES, with nothing between them. "Watch & listen" used to
  // sit in the gap, which broke the page's one argument in half: the dates say
  // when, About says who — and a reader who has just finished the bill is asking
  // the second question, not asking for a video. The media band keeps its place
  // in the run, one section later.
  const about = renderAbout(profile, vocabulary);
  if (about) container.append(about);

  const videos = renderVideos(profile.videos);
  const chips = profile.socialLinks.length > 0 ? renderSocialChips(profile.socialLinks) : null;
  if (videos || chips) {
    const body = element("div", "listen");
    if (videos) body.append(videos);
    if (chips) body.append(chips);
    container.append(band("listen", videos ? "Watch & listen" : "Listen", null, body));
  }

  // A place publishes its doorstep; the server has already decided that, so an
  // empty street here means "not published" and the band simply does not appear.
  const findUs = place ? renderFindUs(profile) : null;
  if (findUs) container.append(findUs);

  const panel = profile.id && API_BASE_URL ? createRequestPanel(profile) : null;
  container.append(renderLane(vocabulary, panel ? () => panel.open() : null));
  if (panel) container.append(panel.element);

  if (nextShow) container.append(renderStickyBar(nextShow, place));

  fillSectionNav(container);
  document.title = `${profile.name} · shoWMe`;
  const description = document.querySelector('meta[name="description"]');
  const summary = profile.tagline ?? profile.bio;
  if (description && summary) description.setAttribute("content", summary.slice(0, 300));
}

/** The booking form, wired to this profile. Hidden until the lane asks for it. */
function createRequestPanel(profile: PublicProfile): DateRequestPanel {
  return createDateRequestPanel({
    apiBaseUrl: API_BASE_URL,
    target: { id: profile.id, name: profile.name, kind: profile.kind },
    // A dialog, not an inline card. The ask comes off a button at the very
    // bottom of a long page, so a panel that unhid in place would open below
    // wherever the reader is standing.
    presentation: "modal",
    // No `heading`: the panel's default IS the button's words now, read from the
    // same constant, so passing it would be a second place to keep them equal.
    // The availability page uses these to mark the chip that was asked about;
    // this page has no chips, so there is nothing to mark.
    onRequested: () => {},
    onClosed: () => {},
  });
}

/**
 * The top nav, built from the bands that actually rendered.
 *
 * A link per `<section class="band">` on the page, in page order, using its own
 * heading as the label — so the nav cannot name a section that is not there, and
 * cannot fall out of step with one that was renamed.
 */
function fillSectionNav(container: HTMLElement): void {
  const nav = document.getElementById("section-nav");
  if (!nav) return;
  for (const stale of nav.querySelectorAll(".topnav__section")) stale.remove();

  const links: HTMLElement[] = [];
  for (const section of container.querySelectorAll<HTMLElement>(".band[id]")) {
    const title = section.querySelector(".band__title")?.textContent?.trim();
    if (!title) continue;
    links.push(internalLink("topnav__link topnav__section", `#${section.id}`, title));
  }
  if (APP_URL) {
    links.push(externalLink("topnav__link topnav__section", APP_URL, "Sign in"));
  }
  // Before the theme toggle, which is markup and stays last.
  nav.prepend(...links);
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
    toggle.textContent = light ? "Dark" : "Light";
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
