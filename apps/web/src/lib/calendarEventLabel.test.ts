import { describe, expect, it } from "vitest";
import { calendarEventLabel } from "./calendarEventLabel";

/**
 * ClickUp `123qy9rnfa4`. The bug is invisible to whoever named the event — an
 * operator's calendar reads perfectly — so the assertion that matters is the one
 * taken from the other side of the same row.
 */
describe("calendarEventLabel", () => {
  const show = { title: "Marlo Vance — Album Release", venueName: "The Lantern Hall" };

  it("shows the VENUE to somebody who is only on the bill", () => {
    // Ran's complaint, in one line: without this, a performer's calendar is a
    // column of their own name.
    expect(calendarEventLabel({ ...show, hostProfileId: "venue-profile" }, ["marlo-profile"])).toBe(
      "The Lantern Hall",
    );
  });

  it("shows the TITLE to the operator who named it", () => {
    expect(calendarEventLabel({ ...show, hostProfileId: "venue-profile" }, ["venue-profile"])).toBe(
      "Marlo Vance — Album Release",
    );
  });

  it("asks whether you HOST the row, not what kind of account you hold", () => {
    // A performer promoting their own show wears an operator role for that event
    // (story.md). On that row the title is theirs and is the useful label.
    expect(calendarEventLabel({ ...show, hostProfileId: "marlo-profile" }, ["marlo-profile"])).toBe(
      "Marlo Vance — Album Release",
    );
  });

  it("falls back to the title when there is no venue", () => {
    // A blank chip is worse than a repetitive one, and an event with no venue yet
    // is a real state rather than an error.
    expect(calendarEventLabel({ title: "Untitled night", hostProfileId: "x" }, ["me"])).toBe(
      "Untitled night",
    );
    expect(
      calendarEventLabel({ title: "Untitled night", venueName: "   ", hostProfileId: "x" }, ["me"]),
    ).toBe("Untitled night");
  });

  it("treats an event with no host as not hosted by the reader", () => {
    expect(calendarEventLabel({ ...show, hostProfileId: null }, ["marlo-profile"])).toBe(
      "The Lantern Hall",
    );
  });
});
