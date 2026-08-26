import { describe, expect, it } from "vitest";
import {
  type RoomBooking,
  WHOLE_VENUE,
  hasSeparableRooms,
  occupiedDates,
} from "./room-availability";

const VENUE = "venue-1";
const OTHER_VENUE = "venue-2";
const MAIN = "stage-main";
const BASEMENT = "stage-basement";

function booking(overrides: Partial<RoomBooking> = {}): RoomBooking {
  return {
    date: "2026-09-11",
    venueProfileId: VENUE,
    stageId: MAIN,
    occupies: true,
    ...overrides,
  };
}

describe("occupiedDates", () => {
  it("takes only the booked room off the market", () => {
    const bookings = [booking({ date: "2026-09-11", stageId: MAIN })];

    expect([
      ...occupiedDates({ venueProfileId: VENUE, room: MAIN }, [MAIN, BASEMENT], bookings),
    ]).toEqual(["2026-09-11"]);
    expect(
      occupiedDates({ venueProfileId: VENUE, room: BASEMENT }, [MAIN, BASEMENT], bookings).size,
    ).toBe(0);
  });

  it("keeps the venue open while any room is still free", () => {
    const bookings = [booking({ stageId: MAIN })];

    expect(
      occupiedDates({ venueProfileId: VENUE, room: WHOLE_VENUE }, [MAIN, BASEMENT], bookings).size,
    ).toBe(0);
  });

  it("closes the venue once every room is booked that night", () => {
    const bookings = [booking({ stageId: MAIN }), booking({ stageId: BASEMENT })];

    expect([
      ...occupiedDates({ venueProfileId: VENUE, room: WHOLE_VENUE }, [MAIN, BASEMENT], bookings),
    ]).toEqual(["2026-09-11"]);
  });

  it("treats a venue with no rooms recorded as one space", () => {
    const bookings = [booking({ stageId: null })];

    expect([...occupiedDates({ venueProfileId: VENUE, room: WHOLE_VENUE }, [], bookings)]).toEqual([
      "2026-09-11",
    ]);
  });

  it("lets a booking with no room recorded occupy every room", () => {
    // Nobody said which room this show is in, so nobody can say which is free.
    const bookings = [booking({ stageId: null })];

    for (const room of [MAIN, BASEMENT, WHOLE_VENUE]) {
      expect([
        ...occupiedDates({ venueProfileId: VENUE, room }, [MAIN, BASEMENT], bookings),
      ]).toEqual(["2026-09-11"]);
    }
  });

  it("ignores another venue's bookings", () => {
    const bookings = [booking({ venueProfileId: OTHER_VENUE, stageId: null })];

    expect(
      occupiedDates({ venueProfileId: VENUE, room: WHOLE_VENUE }, [MAIN, BASEMENT], bookings).size,
    ).toBe(0);
  });

  it("ignores bookings the caller decided do not occupy, and dateless ones", () => {
    const bookings = [
      booking({ occupies: false, stageId: null }),
      booking({ date: null, stageId: null }),
    ];

    expect(occupiedDates({ venueProfileId: VENUE, room: MAIN }, [MAIN], bookings).size).toBe(0);
  });

  it("reads a full timestamp as the day it falls on", () => {
    const bookings = [booking({ date: "2026-09-11T00:00:00.000Z" })];

    expect([...occupiedDates({ venueProfileId: VENUE, room: MAIN }, [MAIN], bookings)]).toEqual([
      "2026-09-11",
    ]);
  });
});

describe("hasSeparableRooms", () => {
  it("is true only when there is more than one room to tell apart", () => {
    expect(hasSeparableRooms([])).toBe(false);
    expect(hasSeparableRooms([MAIN])).toBe(false);
    expect(hasSeparableRooms([MAIN, BASEMENT])).toBe(true);
  });
});
