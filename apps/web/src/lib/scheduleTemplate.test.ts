/**
 * The run-of-show template (ClickUp `123qy9rpvfq`).
 *
 * Every case below is a clock, which is why they are here and not in a browser: a
 * curfew after midnight, an event that states its own times, an event that states
 * none, a template saved on one night and applied to another.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUN_OF_SHOW,
  draftsFromScheduleTemplate,
  readScheduleTemplatePayload,
  scheduleTemplateFromItems,
  startingPointDrafts,
} from "./scheduleTemplate";

const SHOW_DAY = "2026-10-14";

describe("startingPointDrafts — Ran's ten rows", () => {
  it("is the list he wrote, in his order", () => {
    expect(DEFAULT_RUN_OF_SHOW.map((row) => row.label)).toEqual([
      "Get in",
      "Load in",
      "Line Check",
      "Sound Check",
      "Dinner",
      "Doors Open",
      "Show Time",
      "End Time",
      "Curfew",
      "Closing time",
    ]);
  });

  it("takes the event's OWN times where it has them", () => {
    const drafts = startingPointDrafts({
      eventDate: SHOW_DAY,
      doorTime: "18:30",
      startTime: "20:15",
      endTime: "23:00",
      curfew: "01:00",
    });
    const at = (label: string) => drafts.find((draft) => draft.label === label)?.localDateTime;
    expect(at("Doors Open")).toBe(`${SHOW_DAY}T18:30`);
    expect(at("Show Time")).toBe(`${SHOW_DAY}T20:15`);
    expect(at("End Time")).toBe(`${SHOW_DAY}T23:00`);
    // THE CASE THAT MATTERS: a 01:00 curfew is the next morning, not thirteen hours
    // before the doors it is stated after.
    expect(at("Curfew")).toBe("2026-10-15T01:00");
  });

  it("derives the load-in from doors when the event says nothing about it", () => {
    const drafts = startingPointDrafts({
      eventDate: SHOW_DAY,
      doorTime: "19:00",
      startTime: null,
      endTime: null,
      curfew: null,
    });
    const at = (label: string) => drafts.find((draft) => draft.label === label)?.localDateTime;
    expect(at("Get in")).toBe(`${SHOW_DAY}T14:00`); // five hours before doors
    expect(at("Sound Check")).toBe(`${SHOW_DAY}T16:00`);
    expect(at("Dinner")).toBe(`${SHOW_DAY}T17:30`);
    // And the rows with no event time fall back to the offsets, which carry past
    // midnight on their own.
    expect(at("Curfew")).toBe("2026-10-15T00:00");
    expect(at("Closing time")).toBe("2026-10-15T01:00");
  });

  it("falls back to a 19:00 door when the event has no times at all", () => {
    const drafts = startingPointDrafts({
      eventDate: SHOW_DAY,
      doorTime: null,
      startTime: null,
      endTime: null,
      curfew: null,
    });
    expect(drafts).toHaveLength(10);
    expect(drafts.find((draft) => draft.label === "Doors Open")?.localDateTime).toBe(
      `${SHOW_DAY}T19:00`,
    );
  });

  it("offers nothing at all for an event with no date", () => {
    // Ten dateless rows would be a list of labels pretending to be a schedule.
    expect(
      startingPointDrafts({
        eventDate: null,
        doorTime: "19:00",
        startTime: null,
        endTime: null,
        curfew: null,
      }),
    ).toEqual([]);
  });

  it("keeps the crew rows as crew calls", () => {
    const drafts = startingPointDrafts({
      eventDate: SHOW_DAY,
      doorTime: "19:00",
      startTime: null,
      endTime: null,
      curfew: null,
    });
    const crew = drafts.filter((draft) => draft.category === "crew").map((draft) => draft.label);
    expect(crew).toEqual(["Get in", "Load in", "Dinner", "Closing time"]);
  });
});

describe("saving and loading a run of show", () => {
  it("survives a round trip onto a DIFFERENT night, curfew included", () => {
    const onScreen = [
      { localDateTime: `${SHOW_DAY}T18:30`, label: "Doors Open", category: "production" },
      { localDateTime: `${SHOW_DAY}T20:00`, label: "Show Time", category: "production" },
      { localDateTime: "2026-10-15T01:00", label: "Curfew", category: "production" },
      { localDateTime: `${SHOW_DAY}T14:00`, label: "Get in", category: "crew" },
    ];
    const payload = scheduleTemplateFromItems(onScreen, SHOW_DAY);
    expect(payload.items.find((item) => item.label === "Curfew")).toEqual({
      label: "Curfew",
      category: "production",
      time: "01:00",
      dayOffset: 1,
    });

    // Applied to a night five weeks later: the clock times hold and the curfew is
    // still the following morning.
    const drafts = draftsFromScheduleTemplate(payload, "2026-11-20");
    expect(drafts.map((draft) => draft.localDateTime)).toEqual([
      "2026-11-20T18:30",
      "2026-11-20T20:00",
      "2026-11-21T01:00",
      "2026-11-20T14:00",
    ]);
  });

  it("drops a row with no time rather than storing an unschedulable label", () => {
    const payload = scheduleTemplateFromItems(
      [
        { localDateTime: null, label: "Somebody's note", category: "production" },
        { localDateTime: `${SHOW_DAY}T19:00`, label: "Doors Open", category: "production" },
      ],
      SHOW_DAY,
    );
    expect(payload.items.map((item) => item.label)).toEqual(["Doors Open"]);
  });

  it("applies nothing to an event with no date", () => {
    const payload = {
      items: [
        { label: "Doors", category: "production" as const, time: "19:00", dayOffset: 0 as const },
      ],
    };
    expect(draftsFromScheduleTemplate(payload, null)).toEqual([]);
  });

  it("reads a stored payload defensively", () => {
    // The API validates on the way in, but a row stored before that schema existed —
    // every non-budget category was waved through — must not break the loader.
    expect(readScheduleTemplatePayload(null)).toEqual({ items: [] });
    expect(readScheduleTemplatePayload({ items: "nope" })).toEqual({ items: [] });
    expect(
      readScheduleTemplatePayload({
        items: [
          { label: "", time: "19:00", dayOffset: 0 },
          { label: "No time", dayOffset: 0 },
          { label: "Bad clock", time: "99:99", dayOffset: 0 },
          { label: "Doors", time: "19:00", category: "nonsense", dayOffset: 7 },
        ],
      }),
    ).toEqual({
      // Only the last survives, with its unknown category and out-of-range offset
      // pulled back to the safe reading.
      items: [{ label: "Doors", category: "production", time: "19:00", dayOffset: 0 }],
    });
  });
});
