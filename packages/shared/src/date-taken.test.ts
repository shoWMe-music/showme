import { describe, expect, it } from "vitest";
import { TAKEN_EVENT_STATUSES, isDateHeld, isDateTaken } from "./room-availability";

/**
 * WHEN IS A NIGHT TAKEN — asserted over every status, once, for both surfaces.
 *
 * ClickUp 86cbceux0 · 123qy9rp9rx · 123qy9rnjck. Three tickets caused by two
 * screens answering this differently. The bug was never in either answer on its
 * own — each was defensible — it was that nobody asserted they were THE SAME.
 * So this table is the rule, and the two call sites are tested against it rather
 * than against themselves.
 *
 * Ran's rule, verbatim: *"When is the date taken? When it is moved from
 * suggested to pending. I.e. the performer accepts the date."*
 */

const ALL_STATUSES = [
  "draft",
  "suggested",
  "pending",
  "confirmed",
  "on_hold",
  "concluded",
  "cancelled",
] as const;

/** Written out by hand, so a change to the code cannot rewrite the expectation. */
const TAKEN: Record<string, boolean> = {
  draft: false, // nobody has been asked
  suggested: false, // asked, not answered — the offer is still open
  pending: true, // THE ACT SAID YES. This is the line.
  confirmed: true,
  concluded: true, // the show happened; the room was used
  on_hold: false, // a pencil, not a yes — and the sharer's own toggle
  cancelled: false,
};

describe("is this night taken", () => {
  for (const status of ALL_STATUSES) {
    it(`${status} → ${TAKEN[status] ? "taken" : "free"}`, () => {
      expect(isDateTaken(status)).toBe(TAKEN[status]);
    });
  }

  it("draws the line at acceptance, not at signature", () => {
    // The old share rule was `status === "confirmed"`, which published a night
    // an act had accepted as free. This is the assertion that fails if anybody
    // narrows it back to the signed ones.
    expect(isDateTaken("pending")).toBe(true);
    expect(isDateTaken("suggested")).toBe(false);
  });

  it("does not count a night nobody has been asked about", () => {
    // The old warning counted everything except cancelled, so a forgotten draft
    // read as a clash. This fails if anybody widens it back.
    expect(isDateTaken("draft")).toBe(false);
  });

  it("keeps a hold out of the rule, because it is a choice", () => {
    expect(isDateTaken("on_hold")).toBe(false);
    expect(isDateHeld("on_hold")).toBe(true);
    // And nothing else is a hold — the two questions never overlap.
    for (const status of ALL_STATUSES) {
      if (status === "on_hold") continue;
      expect(isDateHeld(status)).toBe(false);
    }
  });

  it("treats a status it has never heard of as free", () => {
    // The safe failure is offering a night that turns out to be busy — which a
    // person can answer — rather than silently hiding a night that is free.
    expect(isDateTaken("not_a_status")).toBe(false);
  });

  it("exposes the set, so nothing has to restate it", () => {
    expect([...TAKEN_EVENT_STATUSES].sort()).toEqual(
      ALL_STATUSES.filter((status) => TAKEN[status])
        .slice()
        .sort(),
    );
  });
});
