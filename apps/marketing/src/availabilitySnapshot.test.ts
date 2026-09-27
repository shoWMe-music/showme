import { describe, expect, it } from "vitest";
import { parseSnapshot, readShareToken, readSnapshotObject } from "./availabilitySnapshot";

/**
 * READING A SHARED AVAILABILITY LINK — both doors, one set of rules.
 *
 * Since ClickUp `123qy9rpqn0` a link is `/a/<token>` and the snapshot arrives as an
 * object from the API. Every link sent BEFORE that is a `#profile=…&dates=…` fragment
 * sitting in somebody's inbox, so the page reads both — and the two readers agreeing is
 * the thing worth asserting, because the day they disagree one of them renders a page the
 * other would have refused.
 *
 * This suite is also why `apps/marketing` has a unit runner at all: the page boots itself
 * at module scope, so these readers had to move out of it before anything could import
 * them (the same argument as `86cbazcf3` for `apps/web`).
 */

const url = (href: string) => new URL(href, "https://showme.music");

describe("readShareToken", () => {
  it("reads the token out of /a/<token>", () => {
    expect(readShareToken(url("/a/MAYGpMPsNvbf"))).toBe("MAYGpMPsNvbf");
  });

  it("accepts the query form too, the way /profile and /event do", () => {
    expect(readShareToken(url("/availability?a=MAYGpMPsNvbf"))).toBe("MAYGpMPsNvbf");
    // The query wins: it is the explicit form.
    expect(readShareToken(url("/a/from-path?a=from-query"))).toBe("from-query");
  });

  it("finds no token in a legacy fragment link — which is how the fallback fires", () => {
    expect(readShareToken(url("/availability#profile=lantern&dates=2026-12-04"))).toBeNull();
    expect(readShareToken(url("/availability"))).toBeNull();
    // A bare /<something> is not a share: only the segment after `a` counts, or the
    // page would treat its own name — and any future page — as a token.
    expect(readShareToken(url("/MAYGpMPsNvbf"))).toBeNull();
  });

  it("decodes what the address encoded", () => {
    expect(readShareToken(url("/a/ab%2Fcd"))).toBe("ab/cd");
  });
});

describe("readSnapshotObject", () => {
  const good = {
    profileSlug: "lantern",
    room: "Big Room",
    from: "2026-12-01",
    to: "2026-12-31",
    weekdays: [3, 4],
    availableDates: ["2026-12-04", "2026-12-05"],
    confirmedCountsAsBusy: true,
    heldCountsAsBusy: false,
    generatedOn: "2026-11-20",
  };

  it("reads a snapshot the API served", () => {
    expect(readSnapshotObject(good)).toEqual(good);
  });

  it("refuses one with no window to speak of", () => {
    expect(readSnapshotObject({ ...good, from: "" })).toBeNull();
    expect(readSnapshotObject({ ...good, to: "not-a-date" })).toBeNull();
    expect(readSnapshotObject({ ...good, profileSlug: "" })).toBeNull();
    expect(readSnapshotObject(null)).toBeNull();
    expect(readSnapshotObject("a string")).toBeNull();
  });

  it("drops what it cannot believe rather than rendering it", () => {
    const read = readSnapshotObject({
      ...good,
      weekdays: [3, 9, -1, "4"],
      availableDates: ["2026-12-04", "not-a-date", 20261205],
      generatedOn: "whenever",
    });
    // A bad weekday or date is dropped, not fatal: the link still names real nights.
    expect(read?.weekdays).toEqual([3]);
    expect(read?.availableDates).toEqual(["2026-12-04"]);
    // An unreadable "as of" becomes empty, which the page renders as "not stated"
    // rather than printing the word "whenever" as a date.
    expect(read?.generatedOn).toBe("");
  });

  it("strips a room name of anything that could dress itself up", () => {
    const read = readSnapshotObject({ ...good, room: "Big\nRoom  " });
    expect(read?.room).toBe("Big Room");
    expect(readSnapshotObject({ ...good, room: "   " })?.room).toBeNull();
    expect(readSnapshotObject({ ...good, room: "x".repeat(500) })?.room).toHaveLength(200);
  });

  it("takes a flag only when it is literally true", () => {
    // `"true"`, `1` and `"yes"` are all things a hand-edited payload might carry, and
    // none of them is a boolean. Counting them would silently change which nights the
    // page calls busy.
    const read = readSnapshotObject({
      ...good,
      confirmedCountsAsBusy: "true",
      heldCountsAsBusy: 1,
    });
    expect(read?.confirmedCountsAsBusy).toBe(false);
    expect(read?.heldCountsAsBusy).toBe(false);
  });
});

describe("the two doors agree", () => {
  it("reads the same snapshot from a fragment and from an object", () => {
    const fragment =
      "#profile=lantern&room=Big%20Room&from=2026-12-01&to=2026-12-31" +
      "&weekdays=3,4&dates=2026-12-04,2026-12-05&unavailable=confirmed&generated=2026-11-20";
    const fromFragment = parseSnapshot(fragment);
    const fromObject = readSnapshotObject({
      profileSlug: "lantern",
      room: "Big Room",
      from: "2026-12-01",
      to: "2026-12-31",
      weekdays: [3, 4],
      availableDates: ["2026-12-04", "2026-12-05"],
      confirmedCountsAsBusy: true,
      heldCountsAsBusy: false,
      generatedOn: "2026-11-20",
    });

    expect(fromFragment).not.toBeNull();
    expect(fromFragment).toEqual(fromObject);
  });

  it("refuses the same malformed window through either door", () => {
    expect(parseSnapshot("#profile=lantern&from=nope&to=2026-12-31")).toBeNull();
    expect(
      readSnapshotObject({ profileSlug: "lantern", from: "nope", to: "2026-12-31" }),
    ).toBeNull();
  });
});
