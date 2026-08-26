import { describe, expect, it } from "vitest";
import { isPlaceProfile } from "./venue";

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
