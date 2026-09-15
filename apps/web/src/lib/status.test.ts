/**
 * API event status → the design system's display vocabulary.
 *
 * Twenty-odd lines, one lookup, and a genuine trap: the two vocabularies are ALMOST
 * identical. Six of seven values are spelled the same, so a reader skims the map and
 * assumes it is an identity function — and the seventh, `on_hold` → `hold`, is the
 * whole reason the module exists. A silent regression there would render every held
 * date as a grey "Draft" chip, which is a plausible-looking calendar and a wrong one.
 *
 * Holds are also the feature most recently rebuilt (ClickUp 86cbaxumc, 86cbcn1mh), so
 * this is the mapping most likely to be edited next.
 */
import { STATUSES, STATUS_LABEL } from "@showme/design-system";
import { describe, expect, it } from "vitest";
import { apiStatusToDisplay, eventDisplayStatus } from "./status";

/** Every value `events.status` can hold, straight from the API's enum. */
const API_EVENT_STATUSES = [
  "draft",
  "suggested",
  "pending",
  "confirmed",
  "on_hold",
  "concluded",
  "cancelled",
] as const;

describe("apiStatusToDisplay", () => {
  /** The one value where the two vocabularies genuinely disagree. */
  it("translates the API's on_hold into the design system's hold", () => {
    expect(apiStatusToDisplay("on_hold")).toEqual({ status: "hold", label: "On hold" });
  });

  it("passes through the six values that are spelled the same", () => {
    expect(apiStatusToDisplay("draft")).toEqual({ status: "draft", label: "Draft" });
    expect(apiStatusToDisplay("suggested")).toEqual({ status: "suggested", label: "Suggested" });
    expect(apiStatusToDisplay("pending")).toEqual({ status: "pending", label: "Pending" });
    expect(apiStatusToDisplay("confirmed")).toEqual({ status: "confirmed", label: "Confirmed" });
    expect(apiStatusToDisplay("concluded")).toEqual({ status: "concluded", label: "Concluded" });
    expect(apiStatusToDisplay("cancelled")).toEqual({ status: "cancelled", label: "Cancelled" });
  });

  /**
   * The mapping is only complete if it covers the API's whole enum. Adding a status
   * server-side without adding it here would fall through to the "draft" default and
   * mislabel it, so this fails the moment the two drift apart.
   */
  it("maps every status the API can send onto a real design-system status", () => {
    for (const apiStatus of API_EVENT_STATUSES) {
      const { status, label } = apiStatusToDisplay(apiStatus);
      expect(STATUSES).toContain(status);
      expect(label).toBe(STATUS_LABEL[status]);
      // The default is `draft`; only `draft` itself is allowed to land on it.
      if (apiStatus !== "draft") expect(status).not.toBe("draft");
    }
  });

  /**
   * An unknown value gets the safest chip rather than an exception or an empty one.
   * "Draft" understates a booking; every alternative default overstates one.
   */
  it("falls back to draft for a status it has never seen", () => {
    expect(apiStatusToDisplay("teleported")).toEqual({ status: "draft", label: "Draft" });
    expect(apiStatusToDisplay("")).toEqual({ status: "draft", label: "Draft" });
  });

  /**
   * `hold` is the design system's spelling, not the API's. Accepting it here would
   * hide a caller that had skipped the translation and was passing display values
   * into a function whose whole job is to produce them.
   */
  it("does not quietly accept the design system's own spelling as input", () => {
    expect(apiStatusToDisplay("hold").status).toBe("draft");
  });

  it("never returns an empty label", () => {
    for (const apiStatus of [...API_EVENT_STATUSES, "unknown"]) {
      expect(apiStatusToDisplay(apiStatus).label.length).toBeGreaterThan(0);
    }
  });
});

/**
 * SHOW DAY (ClickUp `123qy9rng4z`).
 *
 * Every assertion here pins a decision that is invisible from the rendered chip:
 * a wrong one does not throw or look broken, it just lights up the wrong night —
 * which reads exactly like the feature working.
 */
describe("eventDisplayStatus", () => {
  /** 2026-10-02, 21:00 in Stockholm — the evening of a Stockholm show. */
  const duringTheShow = new Date("2026-10-02T19:00:00Z");
  const stockholmShow = {
    status: "confirmed",
    eventDate: "2026-10-02",
    timezone: "Europe/Stockholm",
  };

  it("promotes a confirmed show to Show day on its own date", () => {
    expect(eventDisplayStatus(stockholmShow, duringTheShow)).toEqual({
      status: "showday",
      label: "Show day",
    });
  });

  it("is plain Confirmed the day before and the day after", () => {
    expect(eventDisplayStatus(stockholmShow, new Date("2026-10-01T19:00:00Z")).status).toBe(
      "confirmed",
    );
    expect(eventDisplayStatus(stockholmShow, new Date("2026-10-03T19:00:00Z")).status).toBe(
      "confirmed",
    );
  });

  /**
   * The boundary is LOCAL midnight in the venue's zone. At 22:30 UTC on the 1st
   * it is already 00:30 on the 2nd in Stockholm, so the show day has started —
   * and at 22:30 UTC on the 2nd it has ended. A comparison done in UTC, or in the
   * reader's zone, gets both of these wrong by two hours.
   */
  it("starts and ends at local midnight where the show is", () => {
    expect(eventDisplayStatus(stockholmShow, new Date("2026-10-01T22:30:00Z")).status).toBe(
      "showday",
    );
    expect(eventDisplayStatus(stockholmShow, new Date("2026-10-02T22:30:00Z")).status).toBe(
      "confirmed",
    );
  });

  /**
   * The case the event-zone rule exists for, written as a PAIR because a single
   * assertion cannot express it: whichever zone the reader happens to sit in, it
   * is one zone, so it cannot give two same-dated shows different answers.
   *
   * At this instant Sydney is ten hours into the 2nd while Honolulu is still on
   * the 1st. The Sydney date is therefore lit and the Honolulu date is not, and
   * any implementation that asks the READER what day it is must fail one of these
   * two lines no matter where the reader is. Written first as a single Sydney
   * assertion, which passed happily against a deliberately broken implementation.
   */
  it("uses the event's zone, not the reader's", () => {
    const sameInstant = new Date("2026-10-01T23:00:00Z");
    const show = (timezone: string) => ({
      status: "confirmed",
      eventDate: "2026-10-02",
      timezone,
    });
    // 2026-10-02 10:00 in Sydney — the show day is under way.
    expect(eventDisplayStatus(show("Australia/Sydney"), sameInstant).status).toBe("showday");
    // 2026-10-01 13:00 in Honolulu — still the day before.
    expect(eventDisplayStatus(show("Pacific/Honolulu"), sameInstant).status).toBe("confirmed");
  });

  /**
   * The whole point of deriving rather than storing: nobody sets this, so no other
   * status may be dragged along by the date arriving. A cancelled show on its own
   * date is cancelled — lighting it up would be actively misleading.
   */
  it("promotes confirmed and nothing else", () => {
    for (const status of ["draft", "suggested", "pending", "on_hold", "concluded", "cancelled"]) {
      const display = eventDisplayStatus({ ...stockholmShow, status }, duringTheShow);
      expect(display.status).not.toBe("showday");
      expect(display).toEqual(apiStatusToDisplay(status));
    }
  });

  it("leaves a dateless event alone", () => {
    expect(eventDisplayStatus({ status: "confirmed", eventDate: null }, duringTheShow).status).toBe(
      "confirmed",
    );
  });

  /** A full timestamp in `eventDate` must compare as the date it starts with. */
  it("accepts a datetime as well as a date", () => {
    expect(
      eventDisplayStatus({ ...stockholmShow, eventDate: "2026-10-02T20:00:00Z" }, duringTheShow)
        .status,
    ).toBe("showday");
  });

  /** A junk zone must not throw in the middle of rendering a calendar. */
  it("survives a zone Intl has never heard of", () => {
    expect(() =>
      eventDisplayStatus({ ...stockholmShow, timezone: "Middle/Earth" }, duringTheShow),
    ).not.toThrow();
  });
});
