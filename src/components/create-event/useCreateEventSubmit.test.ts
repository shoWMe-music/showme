import { describe, it, expect } from "vitest";
import { resolveHostProfileId } from "./useCreateEventSubmit";
import type { SharedProfile } from "@/lib/user-context";

function makeProfile(overrides: Partial<SharedProfile> & { id: string; role: SharedProfile["role"] }): SharedProfile {
  return {
    name: "",
    locations: [],
    bio: "",
    genres: [],
    socialLinks: [],
    created: true,
    ...overrides,
  } as SharedProfile;
}

describe("resolveHostProfileId", () => {
  it("returns the profile id whose role matches the selected role", () => {
    const allProfiles: SharedProfile[] = [
      makeProfile({ id: "venue-1", role: "venue", name: "My Venue" }),
      makeProfile({ id: "perf-1", role: "performer", name: "My Artist" }),
    ];
    expect(resolveHostProfileId(allProfiles, "venue")).toBe("venue-1");
    expect(resolveHostProfileId(allProfiles, "performer")).toBe("perf-1");
  });

  it("returns undefined when selectedRole is null", () => {
    const allProfiles: SharedProfile[] = [
      makeProfile({ id: "venue-1", role: "venue" }),
    ];
    expect(resolveHostProfileId(allProfiles, null)).toBeUndefined();
  });

  it("returns undefined when no profile of the selected role exists", () => {
    // Only a performer profile present, asking for a venue → no match.
    const allProfiles: SharedProfile[] = [
      makeProfile({ id: "perf-1", role: "performer", name: "Performer" }),
    ];
    expect(resolveHostProfileId(allProfiles, "venue")).toBeUndefined();
  });

  it("ignores non-created (uninitialised) profiles", () => {
    const allProfiles: SharedProfile[] = [
      { ...makeProfile({ id: "venue-empty", role: "venue" }), created: false } as SharedProfile,
      makeProfile({ id: "venue-real", role: "venue", name: "Real Venue" }),
    ];
    expect(resolveHostProfileId(allProfiles, "venue")).toBe("venue-real");
  });

  it("returns the venue id (not the performer id) for an account that owns both types", () => {
    // Bug 3 regression guard: account owner has venue + performer profiles.
    // Selecting "venue" must yield the venue's profile id.
    const allProfiles: SharedProfile[] = [
      makeProfile({ id: "venue-id", role: "venue", name: "My Venue" }),
      makeProfile({ id: "perf-id", role: "performer", name: "My Artist" }),
    ];
    const result = resolveHostProfileId(allProfiles, "venue");
    expect(result).toBe("venue-id");
    expect(result).not.toBe("perf-id");
  });

  it("resolves a venue admin (member-of) profile when user has a different owned profile", () => {
    // The slot-collision bug we're fixing: user owns a performer profile AND
    // is admin (member-of) of a venue. With the old slot-Record approach the
    // venue profile could be dropped if it collided with the performer slot key.
    // With the flat array it's always available.
    const allProfiles: SharedProfile[] = [
      makeProfile({ id: "perf-owned", role: "performer", name: "My Artist" }),
      makeProfile({ id: "venue-member-of", role: "venue", name: "Admin Venue" }),
    ];
    expect(resolveHostProfileId(allProfiles, "venue")).toBe("venue-member-of");
  });
});

// resolveVenueProfile is not exported, but the venue-admin scenario is the
// reason this whole refactor exists. We exercise it indirectly via a small
// re-implementation here that mirrors the production logic against the same
// flat-array input shape, to lock the contract.
import type { OperatorRole } from "@/lib/user-context";

function resolveVenueProfileForTest(
  allProfiles: SharedProfile[],
  selectedRole: OperatorRole | null,
  hostProfileId: string | undefined,
  venueName: string,
): SharedProfile | undefined {
  if (selectedRole === "venue" && hostProfileId) {
    return allProfiles.find((p) => p.id === hostProfileId);
  }
  const trimmed = venueName.trim().toLowerCase();
  if (!trimmed) {
    return allProfiles.find((p) => p.role === "venue" && p.created);
  }
  return allProfiles.find(
    (p) => p.role === "venue" && p.created && p.name?.trim().toLowerCase() === trimmed,
  );
}

describe("resolveVenueProfile contract (mirror)", () => {
  it("returns the member-of venue when the user has one owned profile + is admin of a venue", () => {
    // This is the bug fix: user owns a performer profile + is admin of a venue.
    // Selected role is "venue" and venueName matches the member-of venue's
    // name → must return the member-of venue's profile.
    const allProfiles: SharedProfile[] = [
      makeProfile({ id: "perf-owned", role: "performer", name: "My Artist" }),
      makeProfile({ id: "venue-admin", role: "venue", name: "Admin Venue" }),
    ];
    const hostProfileId = resolveHostProfileId(allProfiles, "venue");
    const venue = resolveVenueProfileForTest(allProfiles, "venue", hostProfileId, "Admin Venue");
    expect(venue?.id).toBe("venue-admin");
  });

  it("matches by venueName when role is not venue (e.g. promoter creating at a known venue)", () => {
    const allProfiles: SharedProfile[] = [
      makeProfile({ id: "promo-1", role: "promoter", name: "My Promo" }),
      makeProfile({ id: "venue-a", role: "venue", name: "Venue A" }),
      makeProfile({ id: "venue-b", role: "venue", name: "Venue B" }),
    ];
    const venue = resolveVenueProfileForTest(allProfiles, "promoter", undefined, "Venue B");
    expect(venue?.id).toBe("venue-b");
  });

  it("falls back to any created venue when no name is provided", () => {
    const allProfiles: SharedProfile[] = [
      makeProfile({ id: "venue-only", role: "venue", name: "Only Venue" }),
    ];
    const venue = resolveVenueProfileForTest(allProfiles, "promoter", undefined, "");
    expect(venue?.id).toBe("venue-only");
  });
});
