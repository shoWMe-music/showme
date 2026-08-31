import { describe, expect, it } from "vitest";
import {
  type GuestListDocument,
  type GuestListEntry,
  guestListProblem,
  guestListTickets,
} from "./guest-list";

const guest = (name: string, count: number, note?: string): GuestListEntry => ({
  id: `guest-${name}`,
  name,
  tickets: count,
  invitedBy: "Promoter",
  ...(note !== undefined ? { note } : {}),
});

describe("guest list — the limits, which used to be decoration", () => {
  it("allows a list with no limits at all", () => {
    const list: GuestListDocument = { guests: [guest("Ada", 4), guest("Grace", 2)] };
    expect(guestListProblem(list)).toBeNull();
    expect(guestListTickets(list.guests)).toBe(6);
  });

  it("allows a list exactly on both limits — the boundary is inclusive", () => {
    const list: GuestListDocument = {
      limitTotal: 6,
      limitPerGuest: 4,
      guests: [guest("Ada", 4), guest("Grace", 2)],
    };
    expect(guestListProblem(list)).toBeNull();
  });

  it("refuses a list over the total, naming the overage", () => {
    const list: GuestListDocument = {
      limitTotal: 40,
      guests: [guest("Ada", 40), guest("Grace", 3)],
    };
    expect(guestListProblem(list)).toBe(
      "The guest list is 43 tickets — 3 over the 40 you allow in total. Take 3 tickets off the list, or raise the total limit.",
    );
  });

  it("refuses a guest over the per-guest limit, naming the guest and the overage", () => {
    const list: GuestListDocument = {
      limitPerGuest: 2,
      guests: [guest("Ada", 5), guest("Grace", 2)],
    };
    expect(guestListProblem(list)).toBe(
      "Ada is down for 5 tickets — 3 over the 2 you allow per guest. Lower that guest, or raise the per-guest limit.",
    );
  });

  it("names the worst offender and counts the rest", () => {
    const list: GuestListDocument = {
      limitPerGuest: 1,
      guests: [guest("Ada", 3), guest("Grace", 5), guest("Alan", 2)],
    };
    expect(guestListProblem(list)).toContain("Grace is down for 5 tickets (and 2 others)");
  });

  it("reports the per-guest fault first when a list breaks both", () => {
    const list: GuestListDocument = {
      limitTotal: 2,
      limitPerGuest: 1,
      guests: [guest("Ada", 9)],
    };
    expect(guestListProblem(list)).toContain("per guest");
  });

  it("treats a limit of zero as a real limit, not as 'no limit'", () => {
    expect(guestListProblem({ limitTotal: 0, guests: [guest("Ada", 1)] })).toContain(
      "1 over the 0 you allow in total",
    );
    expect(guestListProblem({ limitTotal: 0, guests: [] })).toBeNull();
  });

  it("says 'ticket' in the singular", () => {
    expect(guestListProblem({ limitPerGuest: 0, guests: [guest("Ada", 1)] })).toContain(
      "Ada is down for 1 ticket —",
    );
  });

  it("carries the operator's note on a guest", () => {
    const withNote = guest("Ada", 2, "collects at the box office");
    expect(withNote.note).toBe("collects at the box office");
    expect(guestListProblem({ guests: [withNote] })).toBeNull();
  });
});
