/**
 * THE TWO-STEP CALENDAR CHOOSER — venue, then room (ClickUp `123qy9rpqp0`).
 *
 * The properties worth pinning are the ones that make two controls behave as one: the
 * venue select must hold a value for every selection *including* a room (or picking a room
 * would blank the venue above it), and every option value must be a real
 * `CalendarSource.value`, because that string is the whole state and the hook compares it
 * rather than parsing it.
 *
 * The other half is the refusals: no "All venues" row (a share names one profile), and no
 * room select at all where there is nothing to tell apart.
 */
import { WHOLE_VENUE } from "@showme/shared";
import { describe, expect, it } from "vitest";
import type { CalendarSource } from "../hooks/useCalendarSources";
import { calendarChoice } from "./calendarChoice";

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

/** A venue with two rooms, plus a performer profile — the shape an operator has. */
function twoVenuesAndAPerformer() {
  return [
    source({ profileId: "hall", profileName: "The Lantern Hall", rooms: ["main", "cellar"] }),
    source({
      profileId: "hall",
      profileName: "The Lantern Hall",
      room: "main",
      label: "Main Room",
      rooms: ["main", "cellar"],
    }),
    source({
      profileId: "hall",
      profileName: "The Lantern Hall",
      room: "cellar",
      label: "The Cellar",
      rooms: ["main", "cellar"],
    }),
    source({ profileId: "nest", profileName: "The Nest", rooms: [] }),
    source({ profileId: "band", profileName: "Marlo Vance", isVenue: false }),
  ];
}

describe("the venue select", () => {
  it("offers one row per calendar, named by the profile", () => {
    const sources = twoVenuesAndAPerformer();
    const choice = calendarChoice(sources, sources[0]);

    expect(choice.calendarOptions).toEqual([
      { value: "hall:whole-venue", label: "The Lantern Hall" },
      { value: "nest:whole-venue", label: "The Nest" },
      { value: "band:whole-venue", label: "Marlo Vance" },
    ]);
  });

  it("offers no 'All venues' row — a share names one profile", () => {
    const sources = twoVenuesAndAPerformer();
    const labels = calendarChoice(sources, sources[0]).calendarOptions.map(
      (option) => option.label,
    );
    expect(labels).not.toContain("All venues");
    // And no empty value, which is how "don't narrow" is spelled in the grid's filter.
    expect(calendarChoice(sources, sources[0]).calendarOptions.map((o) => o.value)).not.toContain(
      "",
    );
  });

  it("stays on the venue while a ROOM of it is selected", () => {
    const sources = twoVenuesAndAPerformer();
    // The reader picked "The Cellar"; the select above it must still read "The Lantern
    // Hall" rather than going blank because no option matches the room's value.
    const choice = calendarChoice(sources, sources[2]);
    expect(choice.calendarValue).toBe("hall:whole-venue");
  });

  it("answers an empty list without a selection", () => {
    const choice = calendarChoice([], undefined);
    expect(choice.calendarOptions).toEqual([]);
    expect(choice.calendarValue).toBe("");
    expect(choice.roomsDisabled).toBe(true);
    expect(choice.roomPlaceholder).toBe("Pick a calendar first");
  });
});

describe("the room select", () => {
  it("offers all rooms plus each room, in the venue's own order", () => {
    const sources = twoVenuesAndAPerformer();
    const choice = calendarChoice(sources, sources[0]);

    expect(choice.roomsDisabled).toBe(false);
    expect(choice.roomOptions).toEqual([
      { value: "hall:whole-venue", label: "All rooms" },
      { value: "hall:main", label: "Main Room" },
      { value: "hall:cellar", label: "The Cellar" },
    ]);
  });

  it("offers only the rooms of the venue that is selected", () => {
    const sources = twoVenuesAndAPerformer();
    const values = calendarChoice(sources, sources[0]).roomOptions.map((option) => option.value);
    expect(values.every((value) => value.startsWith("hall:"))).toBe(true);
  });

  it("says why it is empty, one reason per case", () => {
    const sources = twoVenuesAndAPerformer();

    // A performer has one schedule and no building.
    const performer = calendarChoice(sources, sources[4]);
    expect(performer.roomsDisabled).toBe(true);
    expect(performer.roomPlaceholder).toBe("One schedule");

    // A venue that has not recorded any rooms yet.
    const roomless = calendarChoice(sources, sources[3]);
    expect(roomless.roomsDisabled).toBe(true);
    expect(roomless.roomPlaceholder).toBe("No rooms recorded");
  });

  it("names the one room rather than offering a choice between two identical answers", () => {
    // "All rooms" and "Main Room" are the same set of nights when there is one room, so a
    // select holding both asks the reader to pick between two spellings of one answer.
    const oneRoom = [
      source({ profileId: "hall", profileName: "The Lantern Hall", rooms: ["main"] }),
      source({
        profileId: "hall",
        profileName: "The Lantern Hall",
        room: "main",
        label: "Main Room",
        rooms: ["main"],
      }),
    ];
    const choice = calendarChoice(oneRoom, oneRoom[0]);
    expect(choice.roomOptions).toEqual([]);
    expect(choice.roomsDisabled).toBe(true);
    expect(choice.roomPlaceholder).toBe("Main Room");
  });
});
