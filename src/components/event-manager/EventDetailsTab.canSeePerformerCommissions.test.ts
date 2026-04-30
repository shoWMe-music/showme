import { describe, it, expect } from "vitest";
import { canSeePerformerCommissions } from "./EventDetailsTab";
import type { EventCollaborator } from "@/lib/models";

function makeCollaborator(overrides: Partial<EventCollaborator> & Pick<EventCollaborator, "eventRole">): EventCollaborator {
  return {
    id: "c-1",
    email: "",
    name: "Collaborator",
    status: "active",
    invitedAt: "",
    ...overrides,
  };
}

describe("canSeePerformerCommissions (Wave 7 C2)", () => {
  it("returns true when the user's profile IS the event's performer profile (case 1)", () => {
    expect(
      canSeePerformerCommissions({
        userProfileIds: ["perf-1"],
        performerProfileId: "perf-1",
        hostProfileId: "host-promoter-1",
      }),
    ).toBe(true);
  });

  it("returns true when the user's profile is a performer collaborator (case 2 — multi-performer)", () => {
    expect(
      canSeePerformerCommissions({
        userProfileIds: ["perf-2"],
        performerProfileId: undefined,
        hostProfileId: "host-1",
        isMultiPerformer: true,
        collaborators: [
          makeCollaborator({ eventRole: "performer", profileId: "perf-2" }),
          makeCollaborator({ eventRole: "venue", profileId: "venue-1" }),
        ],
      }),
    ).toBe(true);
  });

  it("returns true when the host IS the performer on a single-performer event (case 3 — self-booking)", () => {
    expect(
      canSeePerformerCommissions({
        userProfileIds: ["host-and-perf-1"],
        performerProfileId: "host-and-perf-1",
        hostProfileId: "host-and-perf-1",
        isMultiPerformer: false,
      }),
    ).toBe(true);
  });

  it("returns FALSE for a venue operator on someone else's event", () => {
    // Venue operator hosts an event; performer is a different profile.
    expect(
      canSeePerformerCommissions({
        userProfileIds: ["venue-host-1"],
        performerProfileId: "perf-other",
        hostProfileId: "venue-host-1",
        isMultiPerformer: false,
        collaborators: [makeCollaborator({ eventRole: "venue", profileId: "venue-host-1" })],
      }),
    ).toBe(false);
  });

  it("returns FALSE for a promoter operator with no performer involvement", () => {
    expect(
      canSeePerformerCommissions({
        userProfileIds: ["promoter-1"],
        performerProfileId: "perf-1",
        hostProfileId: "promoter-1",
        isMultiPerformer: false,
        collaborators: [makeCollaborator({ eventRole: "promoter", profileId: "promoter-1" })],
      }),
    ).toBe(false);
  });

  it("returns FALSE for an organizer operator", () => {
    expect(
      canSeePerformerCommissions({
        userProfileIds: ["org-1"],
        performerProfileId: "perf-1",
        hostProfileId: "org-1",
        isMultiPerformer: true,
        collaborators: [makeCollaborator({ eventRole: "organizer", profileId: "org-1" })],
      }),
    ).toBe(false);
  });

  it("returns FALSE when the user owns a performer profile UNRELATED to this event", () => {
    // Bug guard: the previous gate fired true because the user happened to
    // own a performer profile, even when that profile wasn't on this event.
    expect(
      canSeePerformerCommissions({
        userProfileIds: ["perf-mine", "venue-mine"],
        performerProfileId: "perf-someone-else",
        hostProfileId: "venue-mine",
        isMultiPerformer: false,
        collaborators: [makeCollaborator({ eventRole: "venue", profileId: "venue-mine" })],
      }),
    ).toBe(false);
  });

  it("returns FALSE when userProfileIds is empty (anonymous / no profiles loaded)", () => {
    expect(
      canSeePerformerCommissions({
        userProfileIds: [],
        performerProfileId: "perf-1",
        hostProfileId: "host-1",
      }),
    ).toBe(false);
  });

  it("does NOT match the host-is-performer fallback on a multi-performer event", () => {
    // Multi-performer events never fold host into performer; performer must
    // come from a child event or collaborator.
    expect(
      canSeePerformerCommissions({
        userProfileIds: ["host-1"],
        performerProfileId: "host-1",
        hostProfileId: "host-1",
        isMultiPerformer: true,
      }),
    ).toBe(true); // case 1 still applies (user IS the performer profile)
  });
});
