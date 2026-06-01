import { describe, it, expect } from "vitest";

import {
  getMissingPerformerFields,
  isPerformerProfileComplete,
} from "./profileCompleteness";
import type { SharedProfile } from "./user-context";

function performerProfile(overrides: Partial<SharedProfile> = {}): SharedProfile {
  return {
    role: "performer",
    name: "Test Artist",
    locations: [],
    bio: "",
    genres: [],
    socialLinks: [],
    created: true,
    ...overrides,
  };
}

const completeProfile = (): SharedProfile =>
  performerProfile({
    bio: "Three-piece indie rock band from Berlin.",
    avatarUrl: "https://example.com/avatar.jpg",
    genres: ["indie", "rock"],
    socialLinks: [{ platform: "spotify", url: "https://open.spotify.com/x" }],
    setupType: "Full Band",
    documents: [{ id: "d1", name: "Tech rider", url: "https://x.io/r.pdf", type: "tech_rider" }],
  });

describe("getMissingPerformerFields", () => {
  it("returns [] for a fully-complete performer profile", () => {
    expect(getMissingPerformerFields(completeProfile())).toEqual([]);
    expect(isPerformerProfileComplete(completeProfile())).toBe(true);
  });

  it("flags each missing field individually", () => {
    expect(getMissingPerformerFields(performerProfile())).toEqual([
      "bio",
      "photo",
      "music",
      "tech_rider",
      "setup_or_video",
      "genres",
    ]);
  });

  it("accepts a photo via avatarUrl or via photos[]", () => {
    const p = completeProfile();
    p.avatarUrl = undefined;
    expect(getMissingPerformerFields(p)).toEqual(["photo"]);
    p.photos = ["https://example.com/1.jpg"];
    expect(getMissingPerformerFields(p)).toEqual([]);
  });

  it("accepts music via spotifyUrl, a music-platform socialLink, or YouTube Music", () => {
    const p = completeProfile();
    p.socialLinks = [];
    expect(getMissingPerformerFields(p)).toEqual(["music"]);
    p.spotifyUrl = "https://open.spotify.com/artist/x";
    expect(getMissingPerformerFields(p)).toEqual([]);
    p.spotifyUrl = undefined;
    p.socialLinks = [{ platform: "Bandcamp", url: "https://x.bandcamp.com" }];
    expect(getMissingPerformerFields(p)).toEqual([]);
  });

  it("does NOT accept non-music social platforms as a music link", () => {
    const p = completeProfile();
    p.spotifyUrl = undefined;
    p.socialLinks = [{ platform: "Instagram", url: "https://instagram.com/x" }];
    expect(getMissingPerformerFields(p)).toEqual(["music"]);
  });

  it("accepts setup OR live video — either one satisfies the requirement", () => {
    const p = completeProfile();
    p.setupType = undefined;
    expect(getMissingPerformerFields(p)).toEqual(["setup_or_video"]);
    p.videos = ["https://youtube.com/watch?v=x"];
    expect(getMissingPerformerFields(p)).toEqual([]);
  });

  it("requires a tech_rider document with a real URL", () => {
    const p = completeProfile();
    p.documents = [{ id: "d1", name: "Rider", url: "", type: "tech_rider" }];
    expect(getMissingPerformerFields(p)).toEqual(["tech_rider"]);
    p.documents = [{ id: "d1", name: "Hospitality", url: "https://x.io/h.pdf", type: "hospitality_rider" }];
    expect(getMissingPerformerFields(p)).toEqual(["tech_rider"]);
  });

  it("returns [] for non-performer profiles regardless of fields", () => {
    const venue: SharedProfile = {
      role: "venue",
      name: "Venue",
      locations: [],
      bio: "",
      genres: [],
      socialLinks: [],
      created: true,
    };
    expect(getMissingPerformerFields(venue)).toEqual([]);
  });

  it("returns all required keys when profile is null/undefined", () => {
    expect(getMissingPerformerFields(null)).toHaveLength(6);
    expect(getMissingPerformerFields(undefined)).toHaveLength(6);
  });
});
