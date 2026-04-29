/**
 * Unit tests for CalendarPage hold-acceptance logic (Bug 1).
 *
 * The Calendar's hold-confirm action must:
 *   - transition the accepted event to "pending" (NOT "confirmed")
 *   - cancel sibling holds on the same date + venue + room/stage
 */
import { describe, it, expect } from "vitest";
import { findCompetingHolds, ACCEPTED_HOLD_STATUS } from "./CalendarPage";
import type { Event } from "@/lib/models";

function makeEvent(overrides: Partial<Event> & { id: string }): Event {
  return {
    id: overrides.id,
    name: overrides.name ?? `Event ${overrides.id}`,
    date: overrides.date ?? "2026-05-01",
    venue: overrides.venue ?? "Sunset Hall",
    operator: overrides.operator ?? "Promoter Co",
    operatorType: overrides.operatorType ?? "promoter",
    ticketingProvider: overrides.ticketingProvider ?? "",
    capacity: overrides.capacity ?? 0,
    artist: overrides.artist ?? "Some Artist",
    eventStatus: overrides.eventStatus ?? "on_hold",
    status: overrides.status ?? "draft",
    ...overrides,
  };
}

describe("ACCEPTED_HOLD_STATUS (Bug 1)", () => {
  it("is 'pending' (not 'confirmed') so the host still has to confirm", () => {
    expect(ACCEPTED_HOLD_STATUS).toBe("pending");
  });
});

describe("findCompetingHolds (Bug 1 — sibling cancellation)", () => {
  it("returns sibling on-hold events on the same date/venue/room", () => {
    const accepted = makeEvent({ id: "A", venue: "Hall", roomStage: "Main" });
    const sibling1 = makeEvent({ id: "B", venue: "Hall", roomStage: "Main" });
    const sibling2 = makeEvent({ id: "C", venue: "Hall", roomStage: "Main" });
    const elsewhere = makeEvent({ id: "D", venue: "Other", roomStage: "Main" });
    const differentRoom = makeEvent({ id: "E", venue: "Hall", roomStage: "B-Stage" });
    const differentDate = makeEvent({ id: "F", venue: "Hall", roomStage: "Main", date: "2026-06-01" });

    const result = findCompetingHolds(
      [accepted, sibling1, sibling2, elsewhere, differentRoom, differentDate],
      accepted,
    );
    const ids = result.map((e) => e.id).sort();
    expect(ids).toEqual(["B", "C"]);
  });

  it("ignores non-hold events (confirmed/cancelled/etc.)", () => {
    const accepted = makeEvent({ id: "A" });
    const confirmed = makeEvent({ id: "B", eventStatus: "confirmed" });
    const cancelled = makeEvent({ id: "C", eventStatus: "cancelled" });
    const result = findCompetingHolds([accepted, confirmed, cancelled], accepted);
    expect(result).toEqual([]);
  });

  it("ignores archived events", () => {
    const accepted = makeEvent({ id: "A" });
    const archivedSibling = makeEvent({ id: "B", archived: true });
    const result = findCompetingHolds([accepted, archivedSibling], accepted);
    expect(result).toEqual([]);
  });

  it("treats missing roomStage as equal to empty string", () => {
    const accepted = makeEvent({ id: "A" });
    const sibling = makeEvent({ id: "B", roomStage: "" });
    const result = findCompetingHolds([accepted, sibling], accepted);
    expect(result.map((e) => e.id)).toEqual(["B"]);
  });
});
