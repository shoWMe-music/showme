import { describe, it, expect } from "vitest";
import { dedupeInvitationEvents } from "./IncomingRequestsPage";
import type { Event } from "@/lib/models";

function makeEvent(overrides: Partial<Event> & { id: string }): Event {
  return {
    id: overrides.id,
    name: overrides.name ?? `Event ${overrides.id}`,
    date: overrides.date ?? "2026-05-01",
    venue: overrides.venue ?? "Sunset Hall",
    operator: overrides.operator ?? "Sunset Promotions",
    operatorType: overrides.operatorType ?? "promoter",
    ticketingProvider: overrides.ticketingProvider ?? "",
    capacity: overrides.capacity ?? 0,
    artist: overrides.artist ?? "Ori",
    eventStatus: overrides.eventStatus ?? "on_hold",
    status: overrides.status ?? "draft",
    ...overrides,
  };
}

describe("dedupeInvitationEvents (Bug 3 — On Hold duplicates)", () => {
  it("collapses 1 parent + 3 child holds into a single booking entry", () => {
    const parent = makeEvent({ id: "P1", isMultiPerformer: true, performerProfileId: "ori" });
    const child1 = makeEvent({ id: "C1", parentEventId: "P1", performerProfileId: "ori" });
    const child2 = makeEvent({ id: "C2", parentEventId: "P1", performerProfileId: "ori" });
    const child3 = makeEvent({ id: "C3", parentEventId: "P1", performerProfileId: "ori" });

    const result = dedupeInvitationEvents([parent, child1, child2, child3]);

    expect(result).toHaveLength(1);
    // The parent itself is dropped because there are children present;
    // exactly one child remains as the booking entry.
    expect(result[0].parentEventId).toBe("P1");
  });

  it("returns the parent when no children are present", () => {
    const parent = makeEvent({ id: "P1", performerProfileId: "ori" });
    const result = dedupeInvitationEvents([parent]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("P1");
  });

  it("returns each child when only children appear without their parent", () => {
    const child1 = makeEvent({ id: "C1", parentEventId: "P1" });
    const child2 = makeEvent({ id: "C2", parentEventId: "P1" });
    const result = dedupeInvitationEvents([child1, child2]);
    // Different children of the same parent collapse to one entry
    expect(result).toHaveLength(1);
  });

  it("dedupes accidentally repeated entries with the same id", () => {
    const e = makeEvent({ id: "P1" });
    const result = dedupeInvitationEvents([e, e, e]);
    expect(result).toHaveLength(1);
  });

  it("keeps unrelated bookings as separate entries", () => {
    const a = makeEvent({ id: "A" });
    const b = makeEvent({ id: "B" });
    const childOfB1 = makeEvent({ id: "B1", parentEventId: "B" });
    const result = dedupeInvitationEvents([a, b, childOfB1]);
    expect(result).toHaveLength(2);
    const ids = result.map((e) => e.id).sort();
    // A stays; B is dropped in favour of B1 (one entry per booking)
    expect(ids).toContain("A");
    expect(ids).toContain("B1");
  });
});
