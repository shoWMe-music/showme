import { describe, it, expect } from "vitest";
import { normalizeLegacyProfiles, type SharedProfile } from "./user-context";

function makeProfile(overrides: Partial<SharedProfile> & { role: SharedProfile["role"] | "artist" }): SharedProfile {
  // We intentionally allow role: "artist" here for legacy fixtures.
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

describe("normalizeLegacyProfiles", () => {
  it("rewrites role: \"artist\" to role: \"performer\"", () => {
    const input = {
      artist: makeProfile({ id: "p-1", name: "Phantom Artist", role: "artist" as SharedProfile["role"] }),
    };
    const out = normalizeLegacyProfiles(input);
    expect(out.artist?.role).toBe("performer");
  });

  it("preserves the original slot key (so the phantom can still be deleted)", () => {
    const input = {
      artist: makeProfile({ id: "p-1", role: "artist" as SharedProfile["role"] }),
      venue: makeProfile({ id: "v-1", role: "venue" }),
    };
    const out = normalizeLegacyProfiles(input);
    expect(Object.keys(out).sort()).toEqual(["artist", "venue"]);
    expect(out.artist?.id).toBe("p-1");
  });

  it("leaves modern profiles untouched", () => {
    const input = {
      performer: makeProfile({ id: "p-1", role: "performer", name: "Real Performer" }),
      venue: makeProfile({ id: "v-1", role: "venue", name: "Real Venue" }),
    };
    const out = normalizeLegacyProfiles(input);
    expect(out.performer?.role).toBe("performer");
    expect(out.venue?.role).toBe("venue");
    expect(out.performer?.name).toBe("Real Performer");
  });

  it("returns an empty object for empty input", () => {
    expect(normalizeLegacyProfiles({})).toEqual({});
  });

  it("does not mutate the input record", () => {
    const input = {
      artist: makeProfile({ id: "p-1", role: "artist" as SharedProfile["role"] }),
    };
    const inputBefore = JSON.parse(JSON.stringify(input));
    normalizeLegacyProfiles(input);
    expect(input).toEqual(inputBefore);
  });
});
