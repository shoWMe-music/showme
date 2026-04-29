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
// A1: Host column — name resolved via profiles map, falling back to event.operator
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

// ────────────────────────────────────────────────────────────────────────────
// A2: Cancel → archive flow state machine — pure-logic reducer derived from
// the page's behaviour. Mirrors the per-event button and dialog transitions.
// ────────────────────────────────────────────────────────────────────────────

type DeleteFlowState =
  | { kind: "idle" }
  | { kind: "cancel-confirm"; eventId: string }
  | { kind: "archive-confirm"; eventId: string }
  | { kind: "archive-only"; eventId: string }
  | { kind: "delete-draft"; eventId: string };

interface FlowEvent {
  id: string;
  eventStatus: "draft" | "cancelled" | "confirmed" | "pending" | "on_hold" | "concluded" | "suggested";
  archived: boolean;
}

interface FlowSnapshot {
  state: DeleteFlowState;
  readyToArchiveIds: Set<string>;
  cancelled: Set<string>;
  archived: Set<string>;
}

function emptySnapshot(): FlowSnapshot {
  return {
    state: { kind: "idle" },
    readyToArchiveIds: new Set(),
    cancelled: new Set(),
    archived: new Set(),
  };
}

/** Apply a click on the trash/archive icon for a given event row. */
function onIconClick(snap: FlowSnapshot, evt: FlowEvent): FlowSnapshot {
  const isReadyToArchive = snap.readyToArchiveIds.has(evt.id);
  if (evt.eventStatus === "draft") {
    return { ...snap, state: { kind: "delete-draft", eventId: evt.id } };
  }
  if (evt.eventStatus === "cancelled" || isReadyToArchive) {
    return { ...snap, state: { kind: "archive-only", eventId: evt.id } };
  }
  return { ...snap, state: { kind: "cancel-confirm", eventId: evt.id } };
}

/** Click "Yes" on the cancel-confirm dialog: cancel the event, then proceed to archive-confirm. */
function onCancelYes(snap: FlowSnapshot): FlowSnapshot {
  if (snap.state.kind !== "cancel-confirm") return snap;
  const id = snap.state.eventId;
  return {
    ...snap,
    cancelled: new Set([...snap.cancelled, id]),
    state: { kind: "archive-confirm", eventId: id },
  };
}

/** Click "No" on the archive-confirm dialog: mark the row ready-to-archive. */
function onArchiveNo(snap: FlowSnapshot): FlowSnapshot {
  if (snap.state.kind !== "archive-confirm") return snap;
  const id = snap.state.eventId;
  return {
    ...snap,
    readyToArchiveIds: new Set([...snap.readyToArchiveIds, id]),
    state: { kind: "idle" },
  };
}

/** Click "Yes" on the archive-confirm or "Archive" on archive-only: archive the event. */
function onArchiveYes(snap: FlowSnapshot): FlowSnapshot {
  if (snap.state.kind !== "archive-confirm" && snap.state.kind !== "archive-only") return snap;
  const id = snap.state.eventId;
  const next = new Set(snap.readyToArchiveIds);
  next.delete(id);
  return {
    ...snap,
    archived: new Set([...snap.archived, id]),
    readyToArchiveIds: next,
    state: { kind: "idle" },
  };
}

/** Determine which icon should appear for a given event row. */
function iconFor(snap: FlowSnapshot, evt: FlowEvent): "trash" | "archive" {
  if (evt.eventStatus === "cancelled" || snap.readyToArchiveIds.has(evt.id)) return "archive";
  return "trash";
}

describe("EventsPage delete flow (A2)", () => {
  it("Yes → Yes flow: cancels the event then archives it", () => {
    const evt: FlowEvent = { id: "E1", eventStatus: "confirmed", archived: false };
    let snap = emptySnapshot();
    snap = onIconClick(snap, evt);
    expect(snap.state).toEqual({ kind: "cancel-confirm", eventId: "E1" });
    snap = onCancelYes(snap);
    expect(snap.cancelled.has("E1")).toBe(true);
    expect(snap.state).toEqual({ kind: "archive-confirm", eventId: "E1" });
    snap = onArchiveYes(snap);
    expect(snap.archived.has("E1")).toBe(true);
    expect(snap.state).toEqual({ kind: "idle" });
  });

  it("Yes → No flow: cancels the event, swaps icon to Archive, next click archives directly", () => {
    let evt: FlowEvent = { id: "E2", eventStatus: "confirmed", archived: false };
    let snap = emptySnapshot();
    expect(iconFor(snap, evt)).toBe("trash");
    snap = onIconClick(snap, evt);
    snap = onCancelYes(snap);
    snap = onArchiveNo(snap);
    expect(snap.cancelled.has("E2")).toBe(true);
    expect(snap.archived.has("E2")).toBe(false);
    expect(snap.readyToArchiveIds.has("E2")).toBe(true);
    expect(snap.state).toEqual({ kind: "idle" });

    // After cancel, the row would also be cancelled in the live cache; here we
    // hold the original status to confirm readyToArchiveIds alone flips the icon.
    evt = { ...evt, eventStatus: "confirmed" };
    expect(iconFor(snap, evt)).toBe("archive");

    // Next click on the now-Archive icon goes straight to archive-only.
    snap = onIconClick(snap, evt);
    expect(snap.state).toEqual({ kind: "archive-only", eventId: "E2" });
    snap = onArchiveYes(snap);
    expect(snap.archived.has("E2")).toBe(true);
    expect(snap.readyToArchiveIds.has("E2")).toBe(false);
  });

  it("Drafts skip step 1 and go straight to permanent-delete dialog", () => {
    const draft: FlowEvent = { id: "E3", eventStatus: "draft", archived: false };
    let snap = emptySnapshot();
    snap = onIconClick(snap, draft);
    expect(snap.state).toEqual({ kind: "delete-draft", eventId: "E3" });
  });

  it("Cancelled events skip step 1 and go straight to archive-only", () => {
    const cancelled: FlowEvent = { id: "E4", eventStatus: "cancelled", archived: false };
    let snap = emptySnapshot();
    expect(iconFor(snap, cancelled)).toBe("archive");
    snap = onIconClick(snap, cancelled);
    expect(snap.state).toEqual({ kind: "archive-only", eventId: "E4" });
  });
});
