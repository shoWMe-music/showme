/**
 * READING A SHARED AVAILABILITY LINK — the pure half of `availability.ts`.
 *
 * It lives in its own module for one concrete reason: `availability.ts` boots itself at
 * module scope (`setUpThemeToggle(); void render();`), so importing it in a test executes
 * the page. These readers are the part with rules in them and nothing that touches a
 * document, so they are the part worth asserting — the same argument `apps/web`'s vitest
 * project was added on (ClickUp `86cbazcf3`: *"nowhere to assert a pure function"*).
 *
 * TWO DOORS, ONE VALIDATOR. A link is either `/a/<token>`, where the snapshot arrives as
 * an object from `GET /public/availability/:token` (ClickUp `123qy9rpqn0`), or the older
 * `#profile=…&dates=…` fragment, which every link sent before today still is. Both are
 * attacker-controlled — one is literally an address somebody typed — so both go through
 * the same field rules, and a malformed link becomes an honest "this doesn't look right"
 * rather than a half-rendered page.
 */

/** A bare calendar date, the only date shape this page accepts. */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface AvailabilitySnapshot {
  profileSlug: string;
  /** The room these dates are for, or null for the whole calendar. */
  room: string | null;
  from: string;
  to: string;
  weekdays: number[];
  availableDates: string[];
  confirmedCountsAsBusy: boolean;
  heldCountsAsBusy: boolean;
  generatedOn: string;
}

function commaList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** How long a room name may be before this page stops believing it. */
const MAX_ROOM_NAME_LENGTH = 200;

/**
 * The room name, cleaned up, or null.
 *
 * Unlike the profile name — which this page refuses to take from the link and
 * resolves from the API instead — the room is part of what the SHARER is
 * asserting, exactly like the dates. So it is accepted, but bounded and stripped
 * of control characters and line breaks, and rendered only among "how this list
 * was made" (never as the identity line at the top), so it can never dress
 * itself up as something the API confirmed.
 */
function readRoomName(value: string | null): string | null {
  if (!value) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (cleaned === "") return null;
  return cleaned.slice(0, MAX_ROOM_NAME_LENGTH);
}

/**
 * WHICH SHARE THIS PAGE IS SHOWING — a token, or the old fragment.
 *
 * ClickUp `123qy9rpqn0` moved the snapshot off the URL and into `shares.payload`, so the
 * address is now `/a/<token>`. The same shape `profile.html` and `event.html` already
 * use: a rewrite puts the thing the page is ABOUT in the path and the page reads the last
 * segment, with a query form accepted too.
 *
 * **The fragment path stays**, and that is the point of reading both: every availability
 * link sent before today is a fragment sitting in somebody's inbox, and those must keep
 * working. A token wins when both are present, because a token is the newer, authoritative
 * form.
 */
export function readShareToken(url: URL): string | null {
  const fromQuery = url.searchParams.get("a");
  if (fromQuery) return fromQuery.trim() || null;

  const segments = url.pathname.split("/").filter(Boolean);
  // `/a/<token>` only — not `/availability`, which is the page's own name and is how
  // a legacy fragment link addresses it.
  if (segments.length < 2 || segments[segments.length - 2] !== "a") return null;
  const last = segments[segments.length - 1];
  return last ? decodeURIComponent(last) : null;
}

/**
 * Validate a snapshot that arrived as an OBJECT (the token path) rather than as query
 * parameters (the fragment path).
 *
 * The same field rules either way — deliberately, and not for tidiness: the token payload
 * is written by our own authenticated route and validated there, but this page also has
 * to survive a payload from an older version of that route, and "the server said so" is
 * the reasoning that lets a half-rendered page through. One validator, two doors.
 */
export function readSnapshotObject(value: unknown): AvailabilitySnapshot | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;

  const profileSlug = typeof record.profileSlug === "string" ? record.profileSlug : "";
  const from = typeof record.from === "string" ? record.from : "";
  const to = typeof record.to === "string" ? record.to : "";
  if (!profileSlug || !ISO_DATE.test(from) || !ISO_DATE.test(to)) return null;

  const weekdays = Array.isArray(record.weekdays)
    ? record.weekdays.filter(
        (entry): entry is number =>
          Number.isInteger(entry) && (entry as number) >= 0 && (entry as number) <= 6,
      )
    : [];
  const availableDates = Array.isArray(record.availableDates)
    ? record.availableDates.filter(
        (date): date is string => typeof date === "string" && ISO_DATE.test(date),
      )
    : [];
  const generatedOn = typeof record.generatedOn === "string" ? record.generatedOn : "";

  return {
    profileSlug,
    room: readRoomName(typeof record.room === "string" ? record.room : null),
    from,
    to,
    weekdays,
    availableDates,
    confirmedCountsAsBusy: record.confirmedCountsAsBusy === true,
    heldCountsAsBusy: record.heldCountsAsBusy === true,
    generatedOn: ISO_DATE.test(generatedOn) ? generatedOn : "",
  };
}

/**
 * Read the snapshot out of the fragment. Everything is validated here — the whole
 * input is attacker-controlled, so a malformed link becomes an honest "this link
 * doesn't look right" rather than a half-rendered page.
 */
export function parseSnapshot(fragment: string): AvailabilitySnapshot | null {
  const parameters = new URLSearchParams(fragment.replace(/^#/, ""));

  const profileSlug = parameters.get("profile") ?? "";
  const from = parameters.get("from") ?? "";
  const to = parameters.get("to") ?? "";
  if (!profileSlug || !ISO_DATE.test(from) || !ISO_DATE.test(to)) return null;

  const weekdays = commaList(parameters.get("weekdays"))
    .map((entry) => Number.parseInt(entry, 10))
    .filter((index) => Number.isInteger(index) && index >= 0 && index <= 6);

  const unavailable = commaList(parameters.get("unavailable"));
  const generatedOn = parameters.get("generated") ?? "";

  return {
    profileSlug,
    room: readRoomName(parameters.get("room")),
    from,
    to,
    weekdays,
    availableDates: commaList(parameters.get("dates")).filter((date) => ISO_DATE.test(date)),
    confirmedCountsAsBusy: unavailable.includes("confirmed"),
    heldCountsAsBusy: unavailable.includes("held"),
    generatedOn: ISO_DATE.test(generatedOn) ? generatedOn : "",
  };
}
