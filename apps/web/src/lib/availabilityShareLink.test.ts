import { describe, expect, it } from "vitest";
import { type AvailabilitySnapshot, buildAvailabilityShareLink } from "./availabilityShareLink";

/**
 * WHAT A SHARED AVAILABILITY LINK IS ALLOWED TO CARRY (ClickUp `123qy9rnjap`,
 * check 5: *"the availability link leaks nothing but availability — no event
 * titles, no performer names, no amounts"*).
 *
 * This is the one share surface in the product with no test behind it. The other
 * door — the off-platform settlement share — has forty-eight, covering the
 * recipient's own slice, expiry on read, immediate revocation, the five-try OTP
 * burn and the forwarded-email case. This one had none, and it is the surface
 * where a leak would be hardest to notice: the link is built in the browser, is
 * handed to somebody with no account, and nothing on the server ever sees it, so
 * there is no log, no route and no serializer in which a stray field would show
 * up.
 *
 * The assertions are therefore written as a DENY-list over the whole URL rather
 * than as a field-by-field check of what is present. A test that reads "profile,
 * from, to, dates are correct" stays green when a fifth parameter appears beside
 * them; the question worth asking is what could be in the string that must not
 * be, which is the "ask what the check CAN fail on" rule applied to a leak.
 */
describe("buildAvailabilityShareLink", () => {
  const snapshot: AvailabilitySnapshot = {
    profileSlug: "the-lantern-hall",
    room: "Main Room",
    from: "2026-10-01",
    to: "2026-10-31",
    weekdays: [4, 5],
    availableDates: ["2026-10-02", "2026-10-09"],
    confirmedCountsAsBusy: true,
    heldCountsAsBusy: false,
    generatedOn: "2026-09-15",
  };

  it("names the profile, the window, the room and the free dates", () => {
    const link = buildAvailabilityShareLink(snapshot);
    const fragment = new URLSearchParams(link.split("#")[1]);
    expect(fragment.get("profile")).toBe("the-lantern-hall");
    expect(fragment.get("room")).toBe("Main Room");
    expect(fragment.get("from")).toBe("2026-10-01");
    expect(fragment.get("to")).toBe("2026-10-31");
    expect(fragment.get("dates")).toBe("2026-10-02,2026-10-09");
    expect(fragment.get("unavailable")).toBe("confirmed");
    expect(fragment.get("generated")).toBe("2026-09-15");
  });

  /**
   * THE LEAK TEST. A snapshot is built from a calendar that knows all of this,
   * and none of it may reach the string — not as a value, not as a stray key, not
   * smuggled inside a date list.
   */
  it("carries nothing but availability, whatever the calendar it was built from knew", () => {
    const link = buildAvailabilityShareLink(snapshot);
    const forbidden = [
      "Marlo Vance", // a counterparty on one of those nights
      "Album Release", // an event title
      "e2e00000-0000-4000-8000-0000000000e1", // an event id
      "45000", // a fee
      "SEK", // a currency
      "performer",
      "deal",
      "settlement",
      "budget",
    ];
    for (const secret of forbidden) {
      expect(link).not.toContain(secret);
    }
    // And positively: the parameter set is closed. A new key here is a new fact
    // about somebody published to whoever holds the link, so it should have to be
    // added here deliberately rather than arrive with a feature.
    const keys = [...new URLSearchParams(link.split("#")[1]).keys()].sort();
    expect(keys).toEqual([
      "dates",
      "from",
      "generated",
      "profile",
      "room",
      "to",
      "unavailable",
      "weekdays",
    ]);
  });

  /**
   * THE FRAGMENT IS THE PRIVACY MECHANISM, not a formatting choice. A fragment is
   * never sent to the server and never appears in a `Referer`, so the sharer's
   * free days stay out of Firebase Hosting's access logs and out of every site
   * the recipient clicks through to next. Moving these into the query string
   * would publish the same days into logs nobody would think to check.
   */
  it("puts the whole snapshot after the # and nothing before it", () => {
    const link = buildAvailabilityShareLink(snapshot);
    const [beforeHash, ...rest] = link.split("#");
    expect(rest).toHaveLength(1);
    expect(beforeHash).not.toContain("?");
    expect(beforeHash.endsWith("/availability")).toBe(true);
    // Every value lives on the private side of the hash.
    expect(beforeHash).not.toContain("2026-10-02");
    expect(beforeHash).not.toContain("the-lantern-hall");
  });

  /**
   * A venue-wide share has no room, and the key must be ABSENT rather than empty
   * — the public page reads a missing room as "the whole calendar", and an empty
   * string would render as a room with no name.
   */
  it("omits the room entirely for a whole-calendar share", () => {
    const link = buildAvailabilityShareLink({ ...snapshot, room: null });
    const fragment = new URLSearchParams(link.split("#")[1]);
    expect(fragment.has("room")).toBe(false);
  });

  it("says both states when both count as busy, and neither when neither does", () => {
    const both = new URLSearchParams(
      buildAvailabilityShareLink({
        ...snapshot,
        confirmedCountsAsBusy: true,
        heldCountsAsBusy: true,
      }).split("#")[1],
    );
    expect(both.get("unavailable")).toBe("confirmed,held");

    const neither = new URLSearchParams(
      buildAvailabilityShareLink({
        ...snapshot,
        confirmedCountsAsBusy: false,
        heldCountsAsBusy: false,
      }).split("#")[1],
    );
    expect(neither.get("unavailable")).toBe("");
  });

  /**
   * No slug, no link — not a link to a page that cannot resolve anybody. A share
   * button that produces a broken address is worse than one that produces none,
   * because the sharer has already sent it before they find out.
   */
  it("produces no link at all without a profile to point at", () => {
    expect(buildAvailabilityShareLink({ ...snapshot, profileSlug: "" })).toBe("");
  });
});
