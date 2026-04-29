import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MultiPerformerAvatars, resolveOperatorName } from "./EventsPage";
import { isDraftVisibleToUser } from "@/lib/db";
import type { Event } from "@/lib/models";

// ────────────────────────────────────────────────────────────────────────────
// Bug 2: Multi-performer events — avatars showing in event list
// ────────────────────────────────────────────────────────────────────────────

describe("MultiPerformerAvatars", () => {
  it("renders an avatar for each child performer (3 performers → 3 avatars)", () => {
    render(
      <MultiPerformerAvatars
        childEvents={[
          { id: "EVT-1-P1", artist: "Alice Anderson" },
          { id: "EVT-1-P2", artist: "Bob Brown" },
          { id: "EVT-1-P3", artist: "Charlie Chen" },
        ]}
      />,
    );
    const avatars = screen.getAllByTestId("performer-avatar");
    expect(avatars).toHaveLength(3);
  });

  it("shows initials for each performer with no avatar URL", () => {
    render(
      <MultiPerformerAvatars
        childEvents={[
          { id: "EVT-1-P1", artist: "Alice Anderson" },
          { id: "EVT-1-P2", artist: "Bob Brown" },
        ]}
      />,
    );
    expect(screen.getByText("AA")).toBeInTheDocument();
    expect(screen.getByText("BB")).toBeInTheDocument();
  });

  it("caps visible avatars at 3 and shows +N overflow indicator", () => {
    render(
      <MultiPerformerAvatars
        childEvents={[
          { id: "EVT-1-P1", artist: "Alice Anderson" },
          { id: "EVT-1-P2", artist: "Bob Brown" },
          { id: "EVT-1-P3", artist: "Charlie Chen" },
          { id: "EVT-1-P4", artist: "Dani Doe" },
          { id: "EVT-1-P5", artist: "Eve Engel" },
        ]}
      />,
    );
    const avatars = screen.getAllByTestId("performer-avatar");
    expect(avatars).toHaveLength(3);
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("renders performer names in a comma-separated summary", () => {
    render(
      <MultiPerformerAvatars
        childEvents={[
          { id: "EVT-1-P1", artist: "Alice" },
          { id: "EVT-1-P2", artist: "Bob" },
        ]}
      />,
    );
    expect(screen.getByText(/Alice, Bob/)).toBeInTheDocument();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Bug 1: Drafts must show in "All" filter
// ────────────────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "EVT-1",
    name: "Test Event",
    date: "2026-05-01",
    venue: "Test Venue",
    operator: "Operator",
    operatorType: "promoter",
    artist: "Test Artist",
    capacity: 100,
    eventStatus: "draft",
    status: "draft",
    archived: false,
    ...overrides,
  } as Event;
}

/**
 * Mirrors the EventsPage filter logic for the "All" status case so we can
 * verify that drafts are not excluded when the filter is "all".
 */
function applyEventsPageFilter(
  events: Event[],
  statusFilter: "all" | "archived" | "draft",
  allProfileIds: string[],
): Event[] {
  return events.filter((e) => {
    if (statusFilter === "archived") return !!e.archived;
    if (e.archived) return false;
    if (e.parentEventId) {
      const isMyChildEvent = allProfileIds.some(
        pid => pid === e.performerProfileId || e.accessProfileIds?.includes(pid),
      ) && !allProfileIds.includes(e.hostProfileId || "");
      if (!isMyChildEvent) return false;
    }
    if (e.isMultiPerformer && !allProfileIds.includes(e.hostProfileId || "")) return false;
    return true;
  });
}

describe("EventsPage filter — drafts visibility", () => {
  it("the 'All' filter does NOT exclude drafts", () => {
    const events = [
      makeEvent({ id: "E1", eventStatus: "draft", hostProfileId: "PRF-mine" }),
      makeEvent({ id: "E2", eventStatus: "confirmed", hostProfileId: "PRF-mine" }),
      makeEvent({ id: "E3", eventStatus: "pending", hostProfileId: "PRF-mine" }),
    ];
    const filtered = applyEventsPageFilter(events, "all", ["PRF-mine"]);
    const ids = filtered.map(e => e.id);
    expect(ids).toContain("E1"); // draft is included
    expect(ids).toContain("E2");
    expect(ids).toContain("E3");
  });

  it("only the 'Archived' filter hides non-archived events", () => {
    const events = [
      makeEvent({ id: "E1", eventStatus: "draft", archived: false, hostProfileId: "PRF-mine" }),
      makeEvent({ id: "E2", eventStatus: "confirmed", archived: true, hostProfileId: "PRF-mine" }),
    ];
    expect(applyEventsPageFilter(events, "all", ["PRF-mine"]).map(e => e.id)).toEqual(["E1"]);
    expect(applyEventsPageFilter(events, "archived", ["PRF-mine"]).map(e => e.id)).toEqual(["E2"]);
  });

  it("db.ts isDraftVisibleToUser allows drafts the creator should see", () => {
    const UID = "uid-mine";
    // user creates draft, host profile is theirs
    expect(isDraftVisibleToUser({ eventStatus: "draft", hostProfileId: "PRF-mine" }, UID, ["PRF-mine"])).toBe(true);
    // draft without hostProfileId still visible (Firestore where-clause already gates by accessUids)
    expect(isDraftVisibleToUser({ eventStatus: "draft", hostProfileId: undefined }, UID, ["PRF-mine"])).toBe(true);
    // non-draft events always visible
    expect(isDraftVisibleToUser({ eventStatus: "confirmed", hostProfileId: "PRF-other" }, UID, ["PRF-mine"])).toBe(true);
    // race-protection: draft visible when uid in accessUids even if profileIds is empty
    expect(isDraftVisibleToUser({ eventStatus: "draft", hostProfileId: "PRF-mine", accessUids: [UID] }, UID, [])).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// A1: Operator column — name resolved via profiles map, falling back to event.operator
// ────────────────────────────────────────────────────────────────────────────

describe("resolveOperatorName (A1)", () => {
  const profiles = {
    venueA: { id: "PRF-venueA", name: "The Garage" },
    promoterA: { id: "PRF-promo", name: "Live Nation" },
  };

  it("returns the host profile's name when hostProfileId matches an entry in the profiles map", () => {
    expect(
      resolveOperatorName({ hostProfileId: "PRF-venueA", operator: "fallback" }, profiles),
    ).toBe("The Garage");
  });

  it("falls back to event.operator when hostProfileId is unknown to the user", () => {
    expect(
      resolveOperatorName({ hostProfileId: "PRF-other", operator: "Acme Promotions" }, profiles),
    ).toBe("Acme Promotions");
  });

  it("falls back to event.operator when hostProfileId is not set", () => {
    expect(
      resolveOperatorName({ operator: "Just A Name" }, profiles),
    ).toBe("Just A Name");
  });

  it("returns empty string when neither profile nor operator is available", () => {
    expect(resolveOperatorName({}, profiles)).toBe("");
  });
});
