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
 * The dates themselves are a SNAPSHOT carried in the URL fragment, because the
 * sharer's confirmed and held events are deliberately not public — the API can
 * never tell this page which days an event blocks, and it should not be able to.
 * The one thing the live call adds is the right to RETRACT: unavailability the
 * profile recorded after the link was made strikes dates out. It can only ever
 * remove a date, never add one, so a stale link errs toward "ask me" rather than
 * promising a day that is gone.
 */

/**
 * API base including `/api/v1`. Empty disables the live refresh — the page still
 * renders the snapshot, it just cannot retract anything (same contract as
 * VITE_LEAD_ENDPOINT on the contact form).
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

/* ------------------------------------------------------------------ rendering */

function element(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  // textContent, never innerHTML — every value here came out of a URL someone else wrote.
  if (text !== undefined) node.textContent = text;
  return node;
}

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

function renderSnapshot(
  container: HTMLElement,
  snapshot: AvailabilitySnapshot,
  profileName: string | null,
  unavailability: UnavailabilityRange[],
): void {
  const withdrawn = snapshot.availableDates.filter((date) => isWithdrawn(date, unavailability));

  const title = profileName ? `${profileName} is free on these dates` : "Free on these dates";

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

  const datesCard = element("section", "card");
  datesCard.append(element("h2", "card__heading", "Available dates"));

  if (snapshot.availableDates.length === 0) {
    datesCard.append(
      element("p", "dates__empty", "No dates were free in this window when the link was made."),
    );
  } else {
    const list = element("ul", "dates");
    for (const date of snapshot.availableDates) {
      const taken = isWithdrawn(date, unavailability);
      const item = element(
        "li",
        taken ? "dates__item dates__item--withdrawn" : "dates__item",
        formatDateChip(date),
      );
      if (taken) item.title = "No longer available";
      list.append(item);
    }
    datesCard.append(list);
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

  container.replaceChildren(heading, datesCard, filtersCard);
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
    fetchJson<{ name: string }>(`/public/profiles/${encodedSlug}`),
    fetchJson<{ unavailability: UnavailabilityRange[] }>(
      `/public/profiles/${encodedSlug}/availability`,
    ),
  ]);

  renderSnapshot(
    container,
    snapshot,
    // Only the name, and only from the API — a link cannot claim a name it was
    // not given, and a profile its owner kept private stays anonymous here.
    typeof profile?.name === "string" ? profile.name : null,
    availability?.unavailability ?? [],
  );
}

setUpThemeToggle();
void render();
window.addEventListener("hashchange", () => {
  void render();
});
