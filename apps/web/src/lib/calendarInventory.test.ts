/**
 * The Calendar rail's inventory — which calendars a reader has, and how many
 * shows sit on each.
 *
 * The case worth pinning hardest is `isVenue`, because getting it wrong is a
 * reported bug rather than a hypothetical: `MyCalendarsCard` reads it to decide
 * whether to explain what rooms are and offer to manage them, and it used to
 * show that to everybody. A performer was told "a venue's rooms are separate
 * calendars" and handed a "Manage rooms" link for a building they do not have
 * (ClickUp 86cbcgw46).
 *
 * The trap in that flag: a performer and a room-less venue both produce a group
 * with `heading: null` and one row. They are indistinguishable in the group's
 * shape, so the flag has to be carried from the source and cannot be inferred
 * here.
 */
import { WHOLE_VENUE } from "@showme/shared";
import { describe, expect, it } from "vitest";
import type { CalendarSource } from "../hooks/useCalendarSources";
import { buildCalendarInventory, placeEvents, unassignedRoomKey } from "./calendarInventory";

/** A source, with the venue-shaped defaults most cases want. */
function source(overrides: Partial<CalendarSource> & Pick<CalendarSource, "profileId">) {
  const room = overrides.room ?? WHOLE_VENUE;
  return {
    value: `${overrides.profileId}:${room}`,
    label: overrides.label ?? "All rooms",
    fullLabel: overrides.fullLabel ?? "A profile",
    profileName: overrides.profileName ?? "A profile",
    profileSlug: null,
    profileIsPublic: false,
    rooms: overrides.rooms ?? [],
    isVenue: overrides.isVenue ?? true,
    ...overrides,
    room,
  } as CalendarSource;
}

describe("buildCalendarInventory — isVenue", () => {
  it("marks a performer's single calendar as not a venue", () => {
    const groups = buildCalendarInventory(
      [source({ profileId: "perf", profileName: "Marlo Vance", isVenue: false })],
      new Map(),
      [],
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.isVenue).toBe(false);
  });

  /**
   * The trap. This group is shaped exactly like the performer's above — no
   * heading, one row — so anything inferring "venue" from the shape gets it
   * wrong in one direction or the other.
   */
  it("marks a venue with no rooms recorded as a venue anyway", () => {
    const groups = buildCalendarInventory(
      [source({ profileId: "venue", profileName: "The Lantern Hall", isVenue: true })],
      new Map(),
      [],
    );
    expect(groups[0]?.heading).toBeNull();
    expect(groups[0]?.isVenue).toBe(true);
  });

  it("marks a venue that lists its rooms as a venue", () => {
    const groups = buildCalendarInventory(
      [
        source({ profileId: "venue", profileName: "The Lantern Hall" }),
        source({
          profileId: "venue",
          profileName: "The Lantern Hall",
          room: "main",
          label: "Main Hall",
        }),
        source({
          profileId: "venue",
          profileName: "The Lantern Hall",
          room: "cellar",
          label: "Cellar",
        }),
      ],
      new Map(),
      [],
    );
    expect(groups[0]?.isVenue).toBe(true);
    expect(groups[0]?.heading).toBe("The Lantern Hall");
    expect(groups[0]?.rows.map((row) => row.label)).toEqual(["Main Hall", "Cellar"]);
  });

  /**
   * An operator who also performs holds both. The card shows the rooms half when
   * ANY group is a venue, so the flag must survive per group rather than being
   * flattened across them.
   */
  it("keeps the flag per group when a reader has both kinds", () => {
    const groups = buildCalendarInventory(
      [
        source({ profileId: "venue", profileName: "The Lantern Hall", isVenue: true }),
        source({ profileId: "perf", profileName: "Marlo Vance", isVenue: false }),
      ],
      new Map(),
      [],
    );
    expect(groups.map((group) => [group.profileId, group.isVenue])).toEqual([
      ["venue", true],
      ["perf", false],
    ]);
  });
});

describe("buildCalendarInventory — the counts", () => {
  const sources = [
    source({ profileId: "venue", profileName: "The Lantern Hall" }),
    source({
      profileId: "venue",
      profileName: "The Lantern Hall",
      room: "main",
      label: "Main Hall",
    }),
    source({
      profileId: "venue",
      profileName: "The Lantern Hall",
      room: "cellar",
      label: "Cellar",
    }),
  ];

  it("counts each room's shows against that room", () => {
    const placements = new Map([
      ["e1", { calendarKey: "venue:main", roomName: "Main Hall", venueName: "The Lantern Hall" }],
      ["e2", { calendarKey: "venue:main", roomName: "Main Hall", venueName: "The Lantern Hall" }],
      ["e3", { calendarKey: "venue:cellar", roomName: "Cellar", venueName: "The Lantern Hall" }],
    ]);
    const rows = buildCalendarInventory(sources, placements, ["e1", "e2", "e3"])[0]?.rows ?? [];
    expect(rows.map((row) => [row.label, row.count])).toEqual([
      ["Main Hall", 2],
      ["Cellar", 1],
    ]);
  });

  /**
   * A show with no room set occupies EVERY room for availability purposes, so it
   * is the row worth noticing — and it only appears when there is something in
   * it, rather than sitting at zero on every venue forever.
   */
  it("surfaces a 'No room set' row only when a show is actually in it", () => {
    const withoutRoom = buildCalendarInventory(sources, new Map(), []);
    expect(withoutRoom[0]?.rows.map((row) => row.label)).toEqual(["Main Hall", "Cellar"]);

    const placements = new Map([
      [
        "e1",
        {
          calendarKey: unassignedRoomKey("venue"),
          roomName: null,
          venueName: "The Lantern Hall",
        },
      ],
    ]);
    const withRoomless = buildCalendarInventory(sources, placements, ["e1"]);
    expect(withRoomless[0]?.rows.map((row) => [row.label, row.count])).toEqual([
      ["Main Hall", 0],
      ["Cellar", 0],
      ["No room set", 1],
    ]);
  });

  it("ignores an event that has no placement — it is on somebody else's calendar", () => {
    const rows = buildCalendarInventory(sources, new Map(), ["not-mine"])[0]?.rows ?? [];
    expect(rows.every((row) => row.count === 0)).toBe(true);
  });

  it("lists each profile once, however many rooms it has", () => {
    const groups = buildCalendarInventory(sources, new Map(), []);
    expect(groups).toHaveLength(1);
  });
});

describe("placeEvents", () => {
  const sources = [
    source({ profileId: "venue", profileName: "The Lantern Hall", rooms: ["main"] }),
    source({
      profileId: "venue",
      profileName: "The Lantern Hall",
      room: "main",
      label: "Main Hall",
      rooms: ["main"],
    }),
  ];
  const event = (overrides: Record<string, unknown>) =>
    ({ id: "e1", venueProfileId: "venue", stageId: null, venueName: null, ...overrides }) as never;

  it("places a show in the room it names", () => {
    const placed = placeEvents([event({ stageId: "main" })], sources);
    expect(placed.get("e1")?.calendarKey).toBe("venue:main");
    expect(placed.get("e1")?.roomName).toBe("Main Hall");
  });

  it("places a roomless show in the venue's unassigned bucket", () => {
    const placed = placeEvents([event({})], sources);
    expect(placed.get("e1")?.calendarKey).toBe(unassignedRoomKey("venue"));
    expect(placed.get("e1")?.roomName).toBeNull();
  });

  /** A room can be deleted out from under a show — `events.stage_id` is ON DELETE
   *  SET NULL, but a stale id must also not strand the show off every calendar. */
  it("falls back to unassigned when the room no longer exists", () => {
    const placed = placeEvents([event({ stageId: "demolished" })], sources);
    expect(placed.get("e1")?.calendarKey).toBe(unassignedRoomKey("venue"));
  });

  it("places nothing for a show at somebody else's venue", () => {
    expect(placeEvents([event({ venueProfileId: "theirs" })], sources).size).toBe(0);
  });

  it("places nothing for a show with no venue profile at all", () => {
    expect(placeEvents([event({ venueProfileId: null })], sources).size).toBe(0);
  });

  /** A performer's own calendar is not a place shows are placed AT. */
  it("ignores non-venue sources when placing", () => {
    const performerOnly = [source({ profileId: "perf", profileName: "Marlo", isVenue: false })];
    expect(placeEvents([event({ venueProfileId: "perf" })], performerOnly).size).toBe(0);
  });
});
