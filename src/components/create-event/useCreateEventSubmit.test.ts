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
  it("returns the profile id stored under the matching slot when its role matches", () => {
    const profiles = {
      venue: makeProfile({ id: "venue-1", role: "venue", name: "My Venue" }),
      performer: makeProfile({ id: "perf-1", role: "performer", name: "My Artist" }),
    };
    expect(resolveHostProfileId(profiles, "venue")).toBe("venue-1");
    expect(resolveHostProfileId(profiles, "performer")).toBe("perf-1");
  });

  it("returns undefined when selectedRole is null", () => {
    const profiles = {
      venue: makeProfile({ id: "venue-1", role: "venue" }),
    };
    expect(resolveHostProfileId(profiles, null)).toBeUndefined();
  });

  it("falls back to a profile in another slot whose stored role matches selectedRole", () => {
    // Slot key may not match the role (e.g. legacy data, custom slot names)
    const profiles = {
      venue_2: makeProfile({ id: "venue-x", role: "venue", name: "Renamed Venue" }),
    };
    expect(resolveHostProfileId(profiles, "venue")).toBe("venue-x");
  });

  it("does NOT pick up another role's profile when the slot key collides", () => {
    // Imagine the slot named "venue" actually holds a performer record.
    // This was the bug: looking up profiles[selectedRole] without checking
    // the stored role would return the wrong profile id.
    const profiles = {
      venue: makeProfile({ id: "perf-collision", role: "performer", name: "Performer in venue slot" }),
      performer: makeProfile({ id: "perf-1", role: "performer", name: "Performer" }),
    };
    // Should NOT return perf-collision because that profile's role is performer
    // and we asked for venue. With no venue-typed profile available, returns undefined.
    expect(resolveHostProfileId(profiles, "venue")).toBeUndefined();
  });

  it("ignores non-created (uninitialised) profiles in the fallback search", () => {
    const profiles = {
      venue: { ...makeProfile({ id: "venue-empty", role: "venue" }), created: false } as SharedProfile,
      venue_2: makeProfile({ id: "venue-real", role: "venue", name: "Real Venue" }),
    };
    // Slot "venue" exists but is not created → should fall back to venue_2.
    expect(resolveHostProfileId(profiles, "venue")).toBe("venue-real");
  });

  it("returns the venue id (not the performer id) for an account that owns both types", () => {
    // Bug 3 regression guard: account owner has venue + performer profiles.
    // Selecting "venue" must yield the venue's profile id.
    const profiles = {
      venue: makeProfile({ id: "venue-id", role: "venue", name: "My Venue" }),
      performer: makeProfile({ id: "perf-id", role: "performer", name: "My Artist" }),
    };
    const result = resolveHostProfileId(profiles, "venue");
    expect(result).toBe("venue-id");
    expect(result).not.toBe("perf-id");
  });
});
