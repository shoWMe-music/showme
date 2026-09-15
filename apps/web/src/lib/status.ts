import { STATUS_LABEL, type Status } from "@showme/design-system";

/** The API event-status enum (draft | suggested | pending | confirmed |
 * on_hold | concluded | cancelled) does not line up 1:1 with the design
 * system's `Status` vocabulary — notably the API says `on_hold` where the
 * design system says `hold`. Map API → display, defaulting safely. */
const API_TO_DISPLAY: Record<string, Status> = {
  draft: "draft",
  suggested: "suggested",
  pending: "pending",
  confirmed: "confirmed",
  on_hold: "hold",
  concluded: "concluded",
  cancelled: "cancelled",
};

export function apiStatusToDisplay(apiStatus: string): { status: Status; label: string } {
  const status = API_TO_DISPLAY[apiStatus] ?? "draft";
  const label = STATUS_LABEL[status] ?? apiStatus;
  return { status, label };
}

/**
 * WHAT DAY IT IS WHERE THE SHOW IS (`YYYY-MM-DD`).
 *
 * `en-CA` is the locale whose short date IS the ISO ordering, which is why it is
 * here rather than a hand-rolled `getFullYear()/padStart` — that one would read
 * the BROWSER's zone and so would call a Tokyo show tomorrow's for the nine hours
 * a Stockholm office is still on yesterday.
 *
 * An unknown or malformed zone makes `Intl` throw. Falling back to the reader's
 * own zone is the honest answer there: it is the assumption the rest of the app
 * already makes for an event with no zone stamped on it.
 */
function localDayIn(ianaZone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: ianaZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  }
}

/**
 * The status to SHOW for an event, which is not always the status it stores
 * (ClickUp `123qy9rng4z`: *"show-day status missing"*).
 *
 * Ran's own framing is the specification: *"show day is not just a status but
 * also marks the 24h of the event date"*. That makes it a fact about the calendar
 * rather than about the booking — it becomes true at local midnight and stops
 * being true at the next one, with nobody pressing anything — so it is derived
 * here and stored nowhere. A column would need a job to keep it honest and would
 * be wrong in between.
 *
 * **It promotes `confirmed` and nothing else.** A cancelled show does not become
 * a show day because its date arrived; neither does a draft, a pencilled hold or
 * a request still waiting on an answer. Only a show that is actually happening is
 * happening tonight.
 *
 * The 24 hours are measured in the EVENT's zone (`events.timezone`, snapshotted
 * per decisions #10), not the reader's — a booking agent in Berlin watching a
 * Sydney date should see it light up when Sydney gets there, not nine hours late.
 */
export function eventDisplayStatus(
  event: { status: string; eventDate?: string | null; timezone?: string | null },
  now: Date = new Date(),
): { status: Status; label: string } {
  if (event.status === "confirmed" && event.eventDate) {
    const zone =
      event.timezone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    if (localDayIn(zone, now) === event.eventDate.slice(0, 10)) {
      return { status: "showday", label: STATUS_LABEL.showday };
    }
  }
  return apiStatusToDisplay(event.status);
}
