import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the db helpers BEFORE importing the module under test ────────────

vi.mock("@/lib/db", () => ({
  fetchProfiles: vi.fn(),
  fetchRiders: vi.fn(),
  upsertRider: vi.fn(),
  // The other named exports the module imports — provide harmless stubs so
  // the module's import block resolves without dragging in Firebase.
  upsertEvent: vi.fn(),
  upsertDeal: vi.fn(),
  upsertRevenue: vi.fn(),
  upsertSettlement: vi.fn(),
  upsertShareToken: vi.fn(),
  appendEventActivity: vi.fn(),
  upsertEventMeta: vi.fn(),
  clearPendingDateChange: vi.fn(),
  fetchProfileOwnerUid: vi.fn(),
  moveMessages: vi.fn(),
  addEventCollaborator: vi.fn(),
  fetchEventMeta: vi.fn(),
}));

vi.mock("@/integrations/firebase/app", () => ({
  getFirestoreDb: vi.fn(),
  getFirebaseFunctions: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  doc: vi.fn(),
  deleteDoc: vi.fn(),
}));

import {
  buildRidersFromProfileForEvent,
  migrateCollaboratorRidersOnAccept,
} from "./useEventMutations";
import { fetchProfiles, fetchRiders, upsertRider } from "@/lib/db";

const mockFetchProfiles = fetchProfiles as ReturnType<typeof vi.fn>;
const mockFetchRiders = fetchRiders as ReturnType<typeof vi.fn>;
const mockUpsertRider = upsertRider as ReturnType<typeof vi.fn>;

describe("buildRidersFromProfileForEvent (Wave 7 C3)", () => {
  it("maps ProfileDocuments to Riders by type", () => {
    const riders = buildRidersFromProfileForEvent({
      id: "perf-1",
      name: "DJ Test",
      documents: [
        { id: "doc1", name: "Tech Rider.pdf", url: "https://x/1", type: "tech_rider" },
        { id: "doc2", name: "Hospitality.pdf", url: "https://x/2", type: "hospitality_rider" },
        { id: "doc3", name: "Backline.pdf", url: "https://x/3", type: "other" },
      ],
    });

    expect(riders).toHaveLength(3);
    expect(riders[0]).toMatchObject({
      id: "R-collab-perf-1-doc1",
      name: "Tech Rider.pdf",
      type: "technical",
      fileUrl: "https://x/1",
      ownerProfileId: "perf-1",
    });
    expect(riders[1].type).toBe("hospitality");
    expect(riders[2].type).toBe("custom");
  });

  it("inlines cateringNotes and accommodationNotes as description-only Riders", () => {
    const riders = buildRidersFromProfileForEvent({
      id: "venue-1",
      name: "Test Venue",
      cateringNotes: "Vegetarian only, no nuts.",
      accommodationNotes: "Hotel within 10 minutes.",
    });

    expect(riders).toHaveLength(2);
    expect(riders[0]).toMatchObject({
      id: "R-collab-venue-1-catering",
      type: "catering",
      description: "Vegetarian only, no nuts.",
      ownerProfileId: "venue-1",
    });
    expect(riders[0].fileUrl).toBeUndefined();
    expect(riders[1]).toMatchObject({
      id: "R-collab-venue-1-accommodation",
      type: "hospitality",
      description: "Hotel within 10 minutes.",
    });
  });

  it("returns an empty array for a profile with no documents or notes", () => {
    expect(buildRidersFromProfileForEvent({ id: "p", name: "Empty" })).toEqual([]);
  });

  it("skips empty/whitespace-only catering/accommodation notes", () => {
    const riders = buildRidersFromProfileForEvent({
      id: "p",
      name: "Whitespace",
      cateringNotes: "   ",
      accommodationNotes: "",
    });
    expect(riders).toHaveLength(0);
  });
});

describe("migrateCollaboratorRidersOnAccept (Wave 7 C3)", () => {
  beforeEach(() => {
    mockFetchProfiles.mockReset();
    mockFetchRiders.mockReset();
    mockUpsertRider.mockReset();
  });

  it("returns { copied: 0 } when eventId or profileId is empty", async () => {
    expect(await migrateCollaboratorRidersOnAccept({ eventId: "", profileId: "p" })).toEqual({ copied: 0 });
    expect(await migrateCollaboratorRidersOnAccept({ eventId: "e", profileId: "" })).toEqual({ copied: 0 });
    expect(mockFetchProfiles).not.toHaveBeenCalled();
  });

  it("returns { copied: 0 } when the profile is not found in the user's loaded profiles", async () => {
    mockFetchProfiles.mockResolvedValueOnce({
      slotted: { performer: { id: "other-id", name: "Other", role: "performer" } },
      all: [{ id: "other-id", name: "Other", role: "performer" }],
    });
    expect(await migrateCollaboratorRidersOnAccept({ eventId: "EVT-1", profileId: "needed-id" })).toEqual({ copied: 0 });
    expect(mockUpsertRider).not.toHaveBeenCalled();
  });

  it("copies all profile riders onto the event when none exist there yet", async () => {
    const profile = {
      id: "perf-1",
      name: "DJ Test",
      role: "performer",
      documents: [
        { id: "d1", name: "Tech.pdf", url: "https://x/1", type: "tech_rider" },
      ],
      cateringNotes: "Vegetarian.",
    };
    mockFetchProfiles.mockResolvedValueOnce({
      slotted: { performer: profile },
      all: [profile],
    });
    mockFetchRiders.mockResolvedValueOnce([]);
    mockUpsertRider.mockResolvedValue(undefined);

    const result = await migrateCollaboratorRidersOnAccept({ eventId: "EVT-1", profileId: "perf-1" });

    expect(result.copied).toBe(2);
    expect(mockUpsertRider).toHaveBeenCalledTimes(2);
    expect(mockUpsertRider).toHaveBeenCalledWith("EVT-1", expect.objectContaining({ name: "Tech.pdf", ownerProfileId: "perf-1" }));
    expect(mockUpsertRider).toHaveBeenCalledWith("EVT-1", expect.objectContaining({ type: "catering", description: "Vegetarian." }));
  });

  it("is idempotent — skips riders whose id already exists on the event", async () => {
    const profile = {
      id: "venue-1",
      name: "Test Venue",
      role: "venue",
      cateringNotes: "Vegetarian.",
      accommodationNotes: "Hotel nearby.",
    };
    mockFetchProfiles.mockResolvedValueOnce({
      slotted: { venue: profile },
      all: [profile],
    });
    // Catering rider already migrated on a previous accept cycle.
    mockFetchRiders.mockResolvedValueOnce([
      { id: "R-collab-venue-1-catering", name: "Catering Requirements", type: "catering" },
    ]);
    mockUpsertRider.mockResolvedValue(undefined);

    const result = await migrateCollaboratorRidersOnAccept({ eventId: "EVT-2", profileId: "venue-1" });

    expect(result.copied).toBe(1);
    expect(mockUpsertRider).toHaveBeenCalledTimes(1);
    expect(mockUpsertRider).toHaveBeenCalledWith("EVT-2", expect.objectContaining({ id: "R-collab-venue-1-accommodation" }));
  });

  it("silently no-ops when fetchProfiles throws (permission denied)", async () => {
    mockFetchProfiles.mockRejectedValueOnce(new Error("PERMISSION_DENIED"));
    const result = await migrateCollaboratorRidersOnAccept({ eventId: "EVT-3", profileId: "perf-x" });
    expect(result).toEqual({ copied: 0 });
    expect(mockUpsertRider).not.toHaveBeenCalled();
  });

  it("falls through and lets upsert merge if the existing-riders read fails", async () => {
    const profile = {
      id: "perf-2",
      name: "DJ",
      role: "performer",
      documents: [{ id: "d1", name: "T.pdf", url: "https://x", type: "tech_rider" }],
    };
    mockFetchProfiles.mockResolvedValueOnce({
      slotted: { performer: profile },
      all: [profile],
    });
    mockFetchRiders.mockRejectedValueOnce(new Error("read denied"));
    mockUpsertRider.mockResolvedValue(undefined);

    const result = await migrateCollaboratorRidersOnAccept({ eventId: "EVT-4", profileId: "perf-2" });

    // We still attempt to write — the merge upsert is naturally idempotent.
    expect(result.copied).toBe(1);
    expect(mockUpsertRider).toHaveBeenCalledTimes(1);
  });
});
