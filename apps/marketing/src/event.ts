/**
 * The public event page — where a link to a published show lands.
 *
 * It lives on the marketing site rather than in the app for the same reason the
 * shared availability page does: it must work for someone with no account. The
 * app SPA mounts its router only for a signed-in user (`apps/web/src/main.tsx`),
 * and this bundle carries no Firebase Auth SDK and no authenticated API client
 * at all — it *cannot* read a session or call an authenticated route even by
 * mistake.
 *
 * WHAT IT MAY SHOW is exactly what `GET /public/events/:id` returns, which is a
 * hard allowlist built by `serializePublicEvent` (`apps/api/src/serialize/public.ts`):
 * the event's id, title, date, venue NAME, door time and start time. Not the
 * budget, not the deals or anyone's fee, not the participants, not the guest
 * list, not the ticket tiers, not the capacity, not the notes — those columns
 * are never selected, so they cannot leak. This page renders all six fields and
 * asks for nothing else.
 *
 * WHEN IT SHOWS ANYTHING AT ALL (audit A-22): the API serves an event only when
 * it is `published` AND its status is `confirmed` or `concluded`. A draft, a
 * hold, a pending or a cancelled show is a 404 — the same non-answer as an event
 * id that does not exist, so nobody can probe this page for an operator's
 * unannounced plans. That is why this page renders one message for every
 * failure: telling the visitor WHICH reason applied would undo the API's
 * no-existence-leak doctrine.
 *
 * `concluded` is deliberately still served — the link is out in the world and
 * the show did happen — so the page has a past-show state: it renders the poster
 * and, instead of the RSVP form, says the night has been and gone. The RSVP
 * route agrees (a concluded event answers 409 "This event has already taken
 * place"), which is the fallback if the date says otherwise.
 *
 * WHAT A VISITOR MAY DO: RSVP — see `event-rsvp.ts`, which posts the public,
 * unauthenticated `POST /public/events/:id/rsvp`.
 *
 * The event id travels in the QUERY STRING, not the fragment. The availability
 * page hides its payload in a fragment because that payload IS the private data;
 * here the id has to reach the server to fetch anything, so hiding it would buy
 * nothing — and a published event is a page its host asked to be linkable.
 */

import { element } from "./element";
import { createRsvpForm } from "./event-rsvp";

/**
 * API base including `/api/v1`. Empty leaves the page unable to load anything —
 * the same contract as VITE_LEAD_ENDPOINT on the contact form — and it says so
 * rather than spinning.
 */
const API_BASE_URL: string = import.meta.env.VITE_PUBLIC_API_URL ?? "";

/** The API's params schema is `z.string().uuid()`; anything else is not worth a round trip. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Every field `GET /public/events/:id` returns — the whole public projection. */
interface PublicEvent {
  id: string;
  title: string;
  eventDate: string | null;
  venueName: string | null;
  doorTime: string | null;
  startTime: string | null;
  /** The host's poster, when the show has one. */
  imageUrl: string | null;
}

/* --------------------------------------------------------------- formatting */

/** "Saturday, 12 September 2026" — a poster date, spelled out. */
function formatEventDate(isoDate: string): string {
  if (!ISO_DATE.test(isoDate)) return isoDate;
  const date = new Date(`${isoDate}T00:00:00`);
  const weekday = date.toLocaleDateString("en-GB", { weekday: "long" });
  const month = date.toLocaleDateString("en-GB", { month: "long" });
  return `${weekday}, ${date.getDate()} ${month} ${date.getFullYear()}`;
}

/**
 * "19:00" from the API's `HH:MM:SS`. These are LOCAL wall-clock times at the
 * venue (decisions #10) — printed as given, never converted, because converting
 * them into the visitor's zone would put the wrong time on the poster.
 */
function formatTime(time: string): string {
  return time.slice(0, 5);
}

/** True once the show's own day is over — the past-show state. */
function hasAlreadyHappened(isoDate: string | null): boolean {
  if (!isoDate || !ISO_DATE.test(isoDate)) return false;
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return isoDate < todayIso;
}

/* ------------------------------------------------------------------ loading */

function toPublicEvent(value: unknown): PublicEvent | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || candidate.id.length === 0) return null;
  if (typeof candidate.title !== "string" || candidate.title.length === 0) return null;
  const orNull = (field: unknown) => (typeof field === "string" && field.length > 0 ? field : null);
  return {
    id: candidate.id,
    title: candidate.title,
    eventDate: orNull(candidate.eventDate),
    venueName: orNull(candidate.venueName),
    doorTime: orNull(candidate.doorTime),
    startTime: orNull(candidate.startTime),
    imageUrl: readImageUrl(candidate.imageUrl),
  };
}

/**
 * A picture we are willing to put in the DOM: absolute http(s) only.
 *
 * The value is owner-supplied and arrives over the network, so `javascript:` and
 * `data:` are refused rather than sanitized — a poster has no business being
 * either, and a rejected one is a missing picture, not an executed script. Same
 * rule, same reasoning, as `profile.ts`.
 */
function readImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

type LoadResult =
  | { outcome: "found"; event: PublicEvent }
  /** 404, or a body that isn't an event. One outcome on purpose — see the header. */
  | { outcome: "not-public" }
  | { outcome: "unreachable" };

async function loadEvent(eventId: string): Promise<LoadResult> {
  if (!API_BASE_URL) return { outcome: "unreachable" };
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/public/events/${encodeURIComponent(eventId)}`);
  } catch {
    return { outcome: "unreachable" };
  }
  if (response.status === 404) return { outcome: "not-public" };
  if (!response.ok) return { outcome: "unreachable" };

  try {
    const parsed = toPublicEvent(await response.json());
    return parsed ? { outcome: "found", event: parsed } : { outcome: "not-public" };
  } catch {
    return { outcome: "unreachable" };
  }
}

/* ---------------------------------------------------------------- rendering */

/** One labelled poster fact — date, times, venue. */
function factRow(label: string, value: string): HTMLElement {
  const row = element("div", "facts__row");
  row.append(element("p", "facts__label", label), element("p", "facts__value", value));
  return row;
}

function renderMessage(container: HTMLElement, title: string, body: string): void {
  container.replaceChildren(
    element("h1", "event__title event__title--plain", title),
    element("p", "event__problem", body),
  );
}

function renderEvent(container: HTMLElement, event: PublicEvent): void {
  document.title = `${event.title} · shoWMe`;

  // The poster band: the host's own artwork when they have uploaded one, and the
  // brand gradient with the show's name on it when they have not — the prototype's
  // public event screen (`shoWMe App.html`, "PUBLIC EVENT PAGE (audience)") put
  // the title alone on a coloured banner, which is exactly the right fallback.
  // The title stays on top of the artwork either way: a poster nobody can read
  // the name off is decoration, not a poster.
  const banner = element("div", "poster");
  if (event.imageUrl) {
    banner.classList.add("poster--art");
    banner.style.backgroundImage = `url("${encodeURI(event.imageUrl)}")`;
  }
  banner.append(
    element("p", "poster__eyebrow", "Live event"),
    element("h1", "poster__title", event.title),
  );

  const facts = element("div", "facts");
  if (event.eventDate) facts.append(factRow("Date", formatEventDate(event.eventDate)));
  if (event.doorTime || event.startTime) {
    // "Doors 19:00 · Show 20:00", and honestly partial when only one is set —
    // the API declares both nullable and "doors TBA" is a real poster state.
    const parts: string[] = [];
    if (event.doorTime) parts.push(`Doors ${formatTime(event.doorTime)}`);
    if (event.startTime) parts.push(`Show ${formatTime(event.startTime)}`);
    facts.append(factRow("Time", parts.join(" · ")));
  }
  if (event.venueName) facts.append(factRow("Venue", event.venueName));

  const posterCard = element("section", "card card--poster");
  posterCard.append(banner, facts);

  const past = hasAlreadyHappened(event.eventDate);
  const canRsvp = API_BASE_URL !== "" && !past;

  const blocks: HTMLElement[] = [posterCard];
  if (past) {
    const over = element("section", "card");
    over.append(
      element("h2", "rsvp__heading", "This show has been and gone"),
      element(
        "p",
        "rsvp__intro",
        "The page stays up as a record of the night. There is nothing left to RSVP to.",
      ),
    );
    blocks.push(over);
  } else if (canRsvp) {
    blocks.push(
      createRsvpForm({ apiBaseUrl: API_BASE_URL, eventId: event.id, eventTitle: event.title })
        .element,
    );
  }

  container.replaceChildren(...blocks);
}

/* ---------------------------------------------------------------- the theme */

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

/* ----------------------------------------------------------------- the page */

/** The one wording every "you can't see this" path shares. See the module header. */
const NOT_PUBLIC_TITLE = "This event isn't public";
const NOT_PUBLIC_BODY =
  "The link may be wrong, or the show may not be announced yet. Ask whoever sent it for a fresh link.";

/**
 * The show's id, from `/event/<id>` or from `?event=<id>`.
 *
 * The path form is what the app and the public profile page build now, and what
 * Hosting rewrites to this page. The query form is every link sent before that,
 * so it is read first and never dropped. Mirrors `readSlug` in `profile.ts`,
 * including the guard against the page's own bare address.
 */
const PAGE_SEGMENTS = new Set(["event", "event.html"]);

function readEventId(): string {
  const fromQuery = new URLSearchParams(window.location.search).get("event");
  if (fromQuery) return fromQuery.trim();

  const segments = window.location.pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last || PAGE_SEGMENTS.has(last)) return "";
  return decodeURIComponent(last);
}

async function render(): Promise<void> {
  const container = document.getElementById("event");
  if (!container) return;

  const eventId = readEventId();
  if (!UUID_SHAPE.test(eventId)) {
    renderMessage(
      container,
      "This link doesn't look right",
      "The event is missing from this address. Ask whoever sent it for the full link.",
    );
    return;
  }

  const result = await loadEvent(eventId);
  if (result.outcome === "found") {
    renderEvent(container, result.event);
    return;
  }
  if (result.outcome === "not-public") {
    renderMessage(container, NOT_PUBLIC_TITLE, NOT_PUBLIC_BODY);
    return;
  }
  renderMessage(
    container,
    "Couldn't reach shoWMe",
    "The event couldn't be loaded just now. Check your connection and reload the page.",
  );
}

setUpThemeToggle();
void render();
