import { describe, expect, it } from "vitest";
import { SOCIAL_PLATFORMS, isPlaceProfile, socialPlatformLabel, socialPlatformSlug } from "./venue";

/**
 * `isPlaceProfile` is the ONE rule behind "who gets the room".
 *
 * The web reads it to decide whether the venue-details editor is drawn at all
 * (`apps/web/src/routes/Profiles.tsx`), and the API reads the same function to
 * decide whether `PATCH /profiles/:id` will accept `venueDetails`
 * (`apps/api/src/routes/profiles.ts`). One predicate, two halves, so a form the
 * server would answer anyway cannot come back by accident.
 *
 * What it encodes: venue/production setup — capacity, rooms/stages, amenities —
 * is operator-only (PLAN.md:350), and a performer sees their own slice, never
 * the venue's asset inventory (story.md's performer boundary). A band has no
 * curfew and no loading dock.
 */
describe("isPlaceProfile — only a place has a room", () => {
  it("says yes to the operator profiles that ARE a place", () => {
    expect(isPlaceProfile("operator", "venue")).toBe(true);
    expect(isPlaceProfile("operator", "festival")).toBe(true);
  });

  it("says yes to an operator who has not chosen a type yet", () => {
    // Someone mid-setup should not be locked out of describing their own room;
    // offering the editor to a promoter who ignores it is the cheaper mistake.
    expect(isPlaceProfile("operator", null)).toBe(true);
    expect(isPlaceProfile("operator", undefined)).toBe(true);
    expect(isPlaceProfile("operator", "")).toBe(true);
  });

  it("says no to an operator who is an organisation, not a room", () => {
    expect(isPlaceProfile("operator", "promoter")).toBe(false);
    expect(isPlaceProfile("operator", "organizer")).toBe(false);
  });

  it("says no to a performer, whatever they are typed as", () => {
    // The rule this pins: the rooms surface is not the performer's. An untyped
    // performer is refused too — the untyped grace above is the OPERATOR's, and
    // leaking it across the kind would hand every fresh performer a curfew field.
    expect(isPlaceProfile("performer", "band")).toBe(false);
    expect(isPlaceProfile("performer", "dj")).toBe(false);
    expect(isPlaceProfile("performer", "solo_artist")).toBe(false);
    expect(isPlaceProfile("performer", null)).toBe(false);
  });

  it("says no to crew and to a booking agent", () => {
    expect(isPlaceProfile("team_and_crew", "sound")).toBe(false);
    expect(isPlaceProfile("agent", "agency")).toBe(false);
    expect(isPlaceProfile("agent", null)).toBe(false);
  });
});

/**
 * A LINK'S PLATFORM — stored as a slug, shown as a label (QA sweep run 6, QA6-18).
 *
 * Three vocabularies were already in the database: the seed's `spotify`, the editor's
 * `Spotify` (it used the label as the stored value), and `Apple Music` with a space
 * where the slug has an underscore. The editor matched none of them, so every seeded
 * link read "Choose…"; the public page printed them verbatim, so the same rows
 * rendered as lower-case chips.
 */
describe("social platforms", () => {
  it("canonicalises what the database actually holds", () => {
    expect(socialPlatformSlug("spotify")).toBe("spotify");
    expect(socialPlatformSlug("Spotify")).toBe("spotify");
    expect(socialPlatformSlug("  SPOTIFY  ")).toBe("spotify");
  });

  it("reads a space or a dash as the slug's underscore", () => {
    // "Apple Music" is what the old editor stored; `apple_music` is the slug.
    expect(socialPlatformSlug("Apple Music")).toBe("apple_music");
    expect(socialPlatformSlug("apple-music")).toBe("apple_music");
    expect(socialPlatformSlug("YouTube Music")).toBe("youtube_music");
  });

  it("answers null for a platform nobody listed", () => {
    // The picker is a shortcut, not a gate — an unknown platform is allowed and
    // simply selects nothing.
    expect(socialPlatformSlug("Mixcloud")).toBeNull();
    expect(socialPlatformSlug("")).toBeNull();
  });

  it("labels a known platform the way a reader writes it", () => {
    expect(socialPlatformLabel("spotify")).toBe("Spotify");
    expect(socialPlatformLabel("apple_music")).toBe("Apple Music");
    expect(socialPlatformLabel("soundcloud")).toBe("SoundCloud");
    expect(socialPlatformLabel("tiktok")).toBe("TikTok");
    // Casing is the label's, not the input's: `X` stays `X` and `x` becomes it.
    expect(socialPlatformLabel("x")).toBe("X");
  });

  it("hands an unknown platform back unchanged rather than title-casing it", () => {
    // Somebody typed it. Rewriting it would be inventing a spelling for their link.
    expect(socialPlatformLabel("Mixcloud")).toBe("Mixcloud");
    expect(socialPlatformLabel("  my own site ")).toBe("my own site");
  });

  it("has a label for every slug and no duplicates", () => {
    const slugs = SOCIAL_PLATFORMS.map((platform) => platform.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const platform of SOCIAL_PLATFORMS) {
      expect(platform.label.trim()).not.toBe("");
      // Every slug must round-trip, or the picker offers a value it cannot match.
      expect(socialPlatformSlug(platform.slug)).toBe(platform.slug);
      expect(socialPlatformSlug(platform.label)).toBe(platform.slug);
    }
  });
});
