/**
 * THE FREE NIGHTS IN A WINDOW — and the property a shared link now depends on.
 *
 * Since ClickUp `123qy9rpqp0` §2 a link carries both the list the modal shows and the
 * same question answered per room, so the one that has to hold is **the union**: a night
 * the venue offers is a night at least one of its rooms can actually take. If those two
 * ever disagree, a recipient clicks a date the page offered and is told no room is free
 * on it — the page contradicting itself in front of a stranger.
 *
 * The rest is the window framing: a building closed for renovation is closed in every
 * room, and an unticked weekday is not on offer in any of them either.
 */
import { WHOLE_VENUE } from "@showme/shared";
import { describe, expect, it } from "vitest";
import { type AvailabilityWindow, datesInRange, freeDatesFor } from "./availabilityWindow";

const VENUE = "venue-1";
const HALL = "room-hall";
const CELLAR = "room-cellar";

/** A Monday-to-Sunday week, every weekday on offer, two rooms, nothing booked. */
function week(overrides: Partial<AvailabilityWindow> = {}): AvailabilityWindow {
  return {
    from: "2026-12-07",
    to: "2026-12-13",
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    rooms: [HALL, CELLAR],
    bookings: [],
    blocked: [],
    ...overrides,
  };
}

const booked = (date: string, stageId: string | null) => ({
  date,
  venueProfileId: VENUE,
  stageId,
  occupies: true,
});

describe("the union of the rooms is what the venue offers", () => {
  it("offers a night while any one room can still take it", () => {
    const window = week({ bookings: [booked("2026-12-09", HALL)] });

    const venue = freeDatesFor({ venueProfileId: VENUE, room: WHOLE_VENUE }, window);
    const hall = freeDatesFor({ venueProfileId: VENUE, room: HALL }, window);
    const cellar = freeDatesFor({ venueProfileId: VENUE, room: CELLAR }, window);

    expect(hall).not.toContain("2026-12-09");
    expect(cellar).toContain("2026-12-09");
    // The property: what the page shows IS the union of what it can name a room for.
    expect(venue).toEqual([...new Set([...hall, ...cellar])].sort());
  });

  it("drops a night only when every room is gone", () => {
    const window = week({
      bookings: [booked("2026-12-09", HALL), booked("2026-12-09", CELLAR)],
    });
    const venue = freeDatesFor({ venueProfileId: VENUE, room: WHOLE_VENUE }, window);
    expect(venue).not.toContain("2026-12-09");
    expect(venue).toHaveLength(6);
  });

  it("lets a roomless booking take the night everywhere", () => {
    // Nobody said which room this show is in, so nobody can say which room is free.
    const window = week({ bookings: [booked("2026-12-09", null)] });
    for (const room of [HALL, CELLAR, WHOLE_VENUE]) {
      expect(freeDatesFor({ venueProfileId: VENUE, room }, window)).not.toContain("2026-12-09");
    }
  });
});

describe("the sharer's own framing", () => {
  it("closes every room for a day the profile blocked outright", () => {
    const window = week({ blocked: [{ startDate: "2026-12-08", endDate: "2026-12-10" }] });
    for (const room of [HALL, CELLAR, WHOLE_VENUE]) {
      const free = freeDatesFor({ venueProfileId: VENUE, room }, window);
      expect(free).toEqual(["2026-12-07", "2026-12-11", "2026-12-12", "2026-12-13"]);
    }
  });

  it("offers only the weekdays that are ticked", () => {
    // Friday = 4, Saturday = 5 in the modal's Monday-first indexing.
    const window = week({ weekdays: [4, 5] });
    expect(freeDatesFor({ venueProfileId: VENUE, room: WHOLE_VENUE }, window)).toEqual([
      "2026-12-11",
      "2026-12-12",
    ]);
  });

  it("counts a booking only where it actually is", () => {
    // Another venue's Wednesday is not this venue's Wednesday.
    const window = week({
      bookings: [{ date: "2026-12-09", venueProfileId: "venue-2", stageId: null, occupies: true }],
    });
    expect(freeDatesFor({ venueProfileId: VENUE, room: WHOLE_VENUE }, window)).toContain(
      "2026-12-09",
    );
  });
});

describe("datesInRange", () => {
  it("is inclusive at both ends", () => {
    expect(datesInRange("2026-12-07", "2026-12-09")).toEqual([
      "2026-12-07",
      "2026-12-08",
      "2026-12-09",
    ]);
  });

  it("answers an inverted or unreadable range with nothing", () => {
    expect(datesInRange("2026-12-09", "2026-12-07")).toEqual([]);
    expect(datesInRange("", "2026-12-07")).toEqual([]);
    expect(datesInRange("not-a-date", "2026-12-07")).toEqual([]);
  });

  it("stops at the window ceiling rather than building a database", () => {
    // A hand-typed year is a typo, not an offer of every night for a decade.
    expect(datesInRange("2026-01-01", "2036-01-01")).toHaveLength(366);
  });
});
