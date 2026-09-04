/**
 * What the operator actually READS when a night is already taken.
 *
 * The availability maths lives in `@showme/shared` and the query in the hook;
 * what is left — and what these pin — is the wording, which carries two product
 * rules that are easy to lose in a refactor:
 *
 *   1. **It never forbids.** Every message ends by saying they can proceed. Ran
 *      was explicit that a promoter may run several shows on one night, so a
 *      warning that reads like a refusal would be the wrong feature.
 *   2. **A block the operator set themselves outranks a clash they may not have
 *      noticed** — it is their own decision being surfaced back to them.
 */
import { describe, expect, it } from "vitest";
import { conflictMessage } from "./useDateConflicts";

const show = (title: string, stageName: string | null = null) => ({ title, stageName });

describe("conflictMessage", () => {
  it("says nothing about a genuinely free night", () => {
    expect(conflictMessage({ roomIsBusy: false, events: [], blocks: [] })).toBeNull();
  });

  /**
   * Found by driving it live rather than by reading the code. Picking a night
   * whose Main Room is sold said NOTHING, because the basement was free so the
   * venue was not "full" — technically correct and useless. The operator wants
   * to know there is already a show in the building either way.
   */
  it("notes another show in the building even when this room is free", () => {
    const message = conflictMessage({
      roomIsBusy: false,
      events: [show("Marlo Vance", "Main Room")],
      blocks: [],
    });
    expect(message).toContain("Marlo Vance");
    expect(message).toContain("Main Room");
    expect(message).toContain("still free");
  });

  /** The two tiers must READ differently — one is a clash, one is a note. */
  it("says something different when the room is busy than when it is free", () => {
    const events = [show("Marlo Vance", "Main Room")];
    const busy = conflictMessage({ roomIsBusy: true, events, blocks: [] });
    const free = conflictMessage({ roomIsBusy: false, events, blocks: [] });
    expect(busy).not.toBe(free);
    expect(busy).toContain("book it anyway");
    expect(free).toContain("still free");
  });

  it("names the room and the show already in it", () => {
    const message = conflictMessage({
      roomIsBusy: true,
      events: [show("Neon Tide", "Main Hall")],
      blocks: [],
    });
    expect(message).toContain("Main Hall");
    expect(message).toContain("Neon Tide");
  });

  it("counts the rest rather than listing every one", () => {
    const message = conflictMessage({
      roomIsBusy: true,
      events: [show("Neon Tide", "Main Hall"), show("Marlo Vance"), show("The Midnight Echo")],
      blocks: [],
    });
    expect(message).toContain("Neon Tide");
    expect(message).toContain("2 more");
  });

  it("drops the room name when the show is not in a named room", () => {
    const message = conflictMessage({ roomIsBusy: true, events: [show("Neon Tide")], blocks: [] });
    expect(message).toContain("Neon Tide");
    expect(message).not.toContain("null");
    expect(message).not.toContain("undefined");
  });

  /** A room can be busy because of a show the caller cannot see the title of. */
  it("still says something when the room is busy but no show is listed", () => {
    const message = conflictMessage({ roomIsBusy: true, events: [], blocks: [] });
    expect(message).toBe("This date is already taken.");
  });

  it("surfaces a manual block with its reason", () => {
    const message = conflictMessage({
      roomIsBusy: false,
      events: [],
      blocks: [{ reason: "Refit" }],
    });
    expect(message).toContain("unavailable");
    expect(message).toContain("Refit");
  });

  it("reads cleanly when the block has no reason", () => {
    const message = conflictMessage({ roomIsBusy: false, events: [], blocks: [{ reason: null }] });
    expect(message).toContain("unavailable");
    expect(message).not.toContain("()");
    expect(message).not.toContain("null");
  });

  /** Rule 2: their own decision comes first. */
  it("states the operator's own block ahead of a clash when both apply", () => {
    const message = conflictMessage({
      roomIsBusy: true,
      events: [show("Neon Tide", "Main Hall")],
      blocks: [{ reason: "Refit" }],
    });
    expect(message).toContain("Refit");
    expect(message).not.toContain("Neon Tide");
  });

  /** Rule 1, asserted over every shape a message can take. */
  it("always tells the operator they can proceed", () => {
    const messages = [
      conflictMessage({ roomIsBusy: true, events: [show("A", "Main Hall")], blocks: [] }),
      conflictMessage({ roomIsBusy: true, events: [show("A")], blocks: [] }),
      conflictMessage({ roomIsBusy: false, events: [], blocks: [{ reason: "Refit" }] }),
      conflictMessage({ roomIsBusy: false, events: [], blocks: [{ reason: null }] }),
      conflictMessage({ roomIsBusy: false, events: [show("A", "Main Room")], blocks: [] }),
    ];
    for (const message of messages) {
      expect(message).toBeTruthy();
      expect(message?.toLowerCase()).toMatch(/you can (still )?(book|change)|still free/);
    }
  });

  /** No message should read as an error or a prohibition. */
  it("never uses the language of refusal", () => {
    const message = conflictMessage({
      roomIsBusy: true,
      events: [show("Neon Tide", "Main Hall")],
      blocks: [],
    });
    expect(message?.toLowerCase()).not.toMatch(/cannot|can't|not allowed|error|invalid/);
  });
});
