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
import { apiStatusToDisplay } from "./status";

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
