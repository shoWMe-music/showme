/**
 * The public availability page — the destination of the "Check & Share
 * Availability" link the app builds (`apps/web/src/lib/availabilityShareLink.ts`).
 *
 * It lives on the marketing site rather than in the app because it must work for
 * someone with no account: the app SPA mounts its router only for a signed-in
 * user (`apps/web/src/main.tsx`), and this bundle carries no Firebase Auth SDK and
 * no authenticated API client at all — it *cannot* read a session or call an
 * authenticated route even by mistake.
 *
 * WHAT IT MAY SHOW: free dates, the window they were computed over, the weekday
 * filter, and which event states the sharer counted as busy. Nothing else. There
 * is no event title, venue, counterparty or amount anywhere in the link or in the
 * endpoints it calls — `GET /public/profiles/:slug` (the display name only, and
 * only for a profile its owner marked public) and
 * `GET /public/profiles/:slug/availability` (date ranges, no reason, no event).
 *
 * WHAT A VISITOR MAY DO: ask for one of the dates on screen — see
 * `availability-request.ts`, which posts the public, unauthenticated
 * `POST /booking-requests`. The ask is bound to a chip, so the page still never
 * says anything about a day the sharer did not publish.
 *
 * WHAT PROTECTS THAT PUBLIC POST, honestly: almost nothing today. The route has
 * no rate limit, no origin guard and no honeypot of its own (unlike
 * `POST /public/leads`, which has all three), and its body schema neither bounds
 * nor sanitizes the text it stores. The honeypot below is a client-side speed
 * bump and the API is what actually has to change; the audit lives in
 * `docs/handoff-2026-08-25-remaining-work.md`.
 *
 * The dates themselves are a SNAPSHOT carried in the URL fragment, because the
 * sharer's confirmed and held events are deliberately not public — the API can
 * never tell this page which days an event blocks, and it should not be able to.
 * The one thing the live call adds is the right to RETRACT: unavailability the
 * profile recorded after the link was made strikes dates out. It can only ever
 * remove a date, never add one, so a stale link errs toward "ask me" rather than
 * promising a day that is gone.
 */

import {
  type DateRequestPanel,
  type PublicProfileSummary,
  createDateRequestPanel,
} from "./availability-request";
import { element } from "./element";

/**
 * API base including `/api/v1`. Empty disables the live refresh — the page still
 * renders the snapshot, it just cannot retract anything (same contract as
 * VITE_LEAD_ENDPOINT on the contact form) — and, with it, the ability to request
 * a date, since there is nowhere to send the request.
 */
const API_BASE_URL: string = import.meta.env.VITE_PUBLIC_API_URL ?? "";

/** Monday-first, matching the weekday pills in the app's share modal. */
const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface AvailabilitySnapshot {
  profileSlug: string;
  from: string;
  to: string;
  weekdays: number[];
  availableDates: string[];
  confirmedCountsAsBusy: boolean;
  heldCountsAsBusy: boolean;
  generatedOn: string;
}

interface UnavailabilityRange {
  startDate: string;
  endDate: string;
}

/* ------------------------------------------------------------------ parsing */

function commaList(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
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
    from,
    to,
    weekdays,
    availableDates: commaList(parameters.get("dates")).filter((date) => ISO_DATE.test(date)),
    confirmedCountsAsBusy: unavailable.includes("confirmed"),
    heldCountsAsBusy: unavailable.includes("held"),
    generatedOn: ISO_DATE.test(generatedOn) ? generatedOn : "",
  };
}

/* --------------------------------------------------------------- formatting */

/** "Wed · Aug 26" — byte-identical to the chips the app's modal lists. */
function formatDateChip(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
  const month = date.toLocaleDateString("en-US", { month: "short" });
  const day = String(date.getDate()).padStart(2, "0");
  return `${weekday} · ${month} ${day}`;
}

/**
 * "26 Aug 2026" — the long form used for the window and the "as of" line. Built
 * from the parts rather than one en-GB call, which renders September as "Sept"
 * and would disagree with the "Sep" in the date chips on the same page.
 */
function formatLongDate(isoDate: string): string {
  if (!ISO_DATE.test(isoDate)) return isoDate;
  const date = new Date(`${isoDate}T00:00:00`);
  const month = date.toLocaleDateString("en-US", { month: "short" });
  return `${date.getDate()} ${month} ${date.getFullYear()}`;
}

function formatWeekdays(weekdays: number[]): string {
  if (weekdays.length === 0 || weekdays.length === WEEKDAY_NAMES.length) return "Every day";
  return [...weekdays]
    .sort((left, right) => left - right)
    .map((index) => WEEKDAY_NAMES[index])
    .join(", ");
}

function formatBusyStates(snapshot: AvailabilitySnapshot): string {
  const states: string[] = [];
  if (snapshot.confirmedCountsAsBusy) states.push("confirmed events");
  if (snapshot.heldCountsAsBusy) states.push("held events");
  if (states.length === 0) return "Nothing — every date in the filter is listed";
  return states.join(" and ");
}

/* ------------------------------------------------------------ live retraction */

/** True when `isoDate` falls inside any recorded unavailability range (inclusive). */
function isWithdrawn(isoDate: string, ranges: UnavailabilityRange[]): boolean {
  return ranges.some((range) => isoDate >= range.startDate && isoDate <= range.endDate);
}

async function fetchJson<T>(path: string): Promise<T | null> {
  if (!API_BASE_URL) return null;
  try {
    const response = await fetch(`${API_BASE_URL}${path}`);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    // A public page must survive an unreachable API: the snapshot still stands.
    return null;
  }
}

/**
 * Narrow `GET /public/profiles/:slug` down to the three fields this page uses,
 * or null. Only the API may name the profile — a link cannot claim a name it was
 * not given, and a profile its owner kept private is a 404 and stays anonymous.
 *
 * `id` is taken because `POST /booking-requests` addresses its target by id and
 * this is the only place a stranger can honestly learn it; the same public route
 * already hands it to anyone holding the slug that is in the URL. It is never
 * rendered, never put in the fragment, and never written anywhere.
 */
function toProfileSummary(value: unknown): PublicProfileSummary | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || candidate.id.length === 0) return null;
  if (typeof candidate.name !== "string" || candidate.name.length === 0) return null;
  return {
    id: candidate.id,
    name: candidate.name,
    kind: typeof candidate.kind === "string" ? candidate.kind : "",
  };
}

/* ------------------------------------------------------------------ rendering */

function filterRow(label: string, value: string): HTMLElement {
  const row = element("div", "filters__row");
  row.append(element("p", "filters__label", label), element("p", "filters__value", value));
  return row;
}

function renderProblem(container: HTMLElement, message: string): void {
  container.replaceChildren(
    element("h1", "availability__title", "This link doesn't look right"),
    element("p", "availability__problem", message),
  );
}

/**
 * One free date, as a chip. It is a BUTTON only when the visitor could actually
 * send a request for it — the profile resolved, so we have somewhere to send it,
 * and the date has not been struck out since the link was made. Everything else
 * stays an inert `<li>`, so the page never offers an action it cannot honour.
 */
function dateChip(
  isoDate: string,
  taken: boolean,
  panel: DateRequestPanel | null,
  selectChip: (chip: HTMLButtonElement, isoDate: string, label: string) => void,
): HTMLElement {
  const label = formatDateChip(isoDate);

  if (taken || !panel) {
    const item = element("li", taken ? "dates__item dates__item--withdrawn" : "dates__item", label);
    if (taken) item.title = "No longer available";
    return item;
  }

  const item = element("li", "dates__cell");
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "dates__item dates__item--action";
  chip.textContent = label;
  chip.dataset.date = isoDate;
  chip.setAttribute("aria-pressed", "false");
  chip.addEventListener("click", () => selectChip(chip, isoDate, label));
  item.append(chip);
  return item;
}

function renderSnapshot(
  container: HTMLElement,
  snapshot: AvailabilitySnapshot,
  profile: PublicProfileSummary | null,
  unavailability: UnavailabilityRange[],
): void {
  const withdrawn = snapshot.availableDates.filter((date) => isWithdrawn(date, unavailability));

  const title = profile ? `${profile.name} is free on these dates` : "Free on these dates";

  const heading = element("header");
  heading.append(
    element("p", "availability__eyebrow", "Shared availability"),
    element("h1", "availability__title", title),
    element(
      "p",
      "availability__range",
      `${formatLongDate(snapshot.from)} – ${formatLongDate(snapshot.to)}`,
    ),
  );

  // The request panel is built before the chips because a chip needs to be able
  // to open it. It is null when nothing could be sent anyway — no API base, or a
  // profile that did not resolve (private, renamed, or the API is unreachable) —
  // and then the page is exactly the read-only page it was before.
  const openDates = snapshot.availableDates.filter((date) => !isWithdrawn(date, unavailability));
  const requestable = profile !== null && API_BASE_URL !== "" && openDates.length > 0;

  let selectedChip: HTMLButtonElement | null = null;

  const deselectChip = () => {
    const previous = selectedChip;
    previous?.setAttribute("aria-pressed", "false");
    selectedChip = null;
    return previous;
  };

  /**
   * The panel closed (cancelled, or the visitor asked for another date). Hand
   * focus back to the chips: the control the visitor was on has just been removed
   * from view, and focus stranded on a hidden element drops a keyboard user back
   * at the top of the document.
   */
  const handlePanelClosed = () => {
    const previous = deselectChip();
    if (previous && !previous.disabled) {
      previous.focus();
      return;
    }
    container.querySelector<HTMLButtonElement>(".dates__item--action:not(:disabled)")?.focus();
  };

  const markRequested = (isoDate: string) => {
    const chip = container.querySelector<HTMLButtonElement>(
      `.dates__item--action[data-date="${isoDate}"]`,
    );
    if (!chip) return;
    chip.classList.add("dates__item--requested");
    chip.disabled = true;
    chip.setAttribute("aria-pressed", "false");
    chip.setAttribute("aria-label", `${chip.textContent} — already requested`);
    if (selectedChip === chip) selectedChip = null;
  };

  const panel: DateRequestPanel | null =
    requestable && profile
      ? createDateRequestPanel({
          apiBaseUrl: API_BASE_URL,
          target: profile,
          onRequested: markRequested,
          onClosed: handlePanelClosed,
        })
      : null;

  const selectChip = (chip: HTMLButtonElement, isoDate: string, label: string) => {
    deselectChip();
    chip.setAttribute("aria-pressed", "true");
    selectedChip = chip;
    panel?.openForDate(isoDate, label);
  };

  const datesCard = element("section", "card");
  datesCard.append(element("h2", "card__heading", "Available dates"));

  if (snapshot.availableDates.length === 0) {
    datesCard.append(
      element("p", "dates__empty", "No dates were free in this window when the link was made."),
    );
  } else {
    const list = element("ul", "dates");
    for (const date of snapshot.availableDates) {
      list.append(dateChip(date, isWithdrawn(date, unavailability), panel, selectChip));
    }
    datesCard.append(list);
    if (panel) {
      datesCard.append(
        element("p", "dates__hint", "Pick a date to ask about it — one click, then a short note."),
      );
    }
  }

  if (withdrawn.length > 0) {
    datesCard.append(
      element(
        "p",
        "note note--withdrawn",
        withdrawn.length === 1
          ? "One of these dates has been blocked since the link was made — it is struck through."
          : `${withdrawn.length} of these dates have been blocked since the link was made — they are struck through.`,
      ),
    );
  }

  const filtersCard = element("section", "card");
  filtersCard.append(
    element("h2", "card__heading", "How this list was made"),
    (() => {
      const filters = element("div", "filters");
      filters.append(
        filterRow("Window", `${formatLongDate(snapshot.from)} – ${formatLongDate(snapshot.to)}`),
        filterRow("Days of the week", formatWeekdays(snapshot.weekdays)),
        filterRow("Counted as unavailable", formatBusyStates(snapshot)),
      );
      return filters;
    })(),
    element(
      "p",
      "note",
      snapshot.generatedOn
        ? `Snapshot taken ${formatLongDate(snapshot.generatedOn)}. Availability changes — confirm before you plan around it.`
        : "Availability changes — confirm before you plan around it.",
    ),
  );

  // The request panel sits between the dates and the "how this list was made"
  // footnote — directly under the chip that opened it.
  if (panel) container.replaceChildren(heading, datesCard, panel.element, filtersCard);
  else container.replaceChildren(heading, datesCard, filtersCard);
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

async function render(): Promise<void> {
  const container = document.getElementById("availability");
  if (!container) return;

  const snapshot = parseSnapshot(window.location.hash);
  if (!snapshot) {
    renderProblem(
      container,
      "The shared dates are missing from this address. Ask whoever sent it for the full link — everything after the # matters.",
    );
    return;
  }

  // Paint the snapshot immediately; the live check only ever strikes dates out.
  renderSnapshot(container, snapshot, null, []);

  const encodedSlug = encodeURIComponent(snapshot.profileSlug);
  const [profile, availability] = await Promise.all([
    fetchJson<unknown>(`/public/profiles/${encodedSlug}`),
    fetchJson<{ unavailability: UnavailabilityRange[] }>(
      `/public/profiles/${encodedSlug}/availability`,
    ),
  ]);

  renderSnapshot(
    container,
    snapshot,
    toProfileSummary(profile),
    availability?.unavailability ?? [],
  );
}

setUpThemeToggle();
void render();
window.addEventListener("hashchange", () => {
  void render();
});
