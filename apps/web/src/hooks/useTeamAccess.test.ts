import { describe, expect, it } from "vitest";
import { TEAM_INVITE_DEFAULT_ROLE, TEAM_ROLES, seatRefusalHint } from "./useTeamAccess";

/**
 * THE ROLE CATALOGUE AND THE SENTENCE ABOUT IT CANNOT DISAGREE (QA sweep run 7, QA7-15).
 *
 * The invite dialog kept a second copy of this list and drifted into three falsehoods
 * at once: it defaulted to `editor` — the first role a free plan refuses — described
 * Admin as the only role that costs a seat, and told the reader in the refusal message
 * itself that Editor was included on every plan. The API settles it:
 * `SEAT_CONSUMING_ROLES = ["owner", "admin", "editor"]`, one seat on Free, held by the
 * owner (Daniel, 2026-09-01).
 */
describe("TEAM_ROLES", () => {
  it("charges a seat for exactly the roles the API charges for", () => {
    // `owner` is not in this list at all: ownership is transferred, never granted here.
    const consuming = TEAM_ROLES.filter((role) => role.consumesSeat).map((role) => role.value);
    expect([...consuming].sort()).toEqual(["admin", "editor"]);
  });

  it("offers the least authority first, so the first option is one every plan permits", () => {
    expect(TEAM_ROLES[0]?.value).toBe(TEAM_INVITE_DEFAULT_ROLE);
    expect(TEAM_ROLES[0]?.consumesSeat).toBe(false);
  });

  it("defaults to a role that costs no seat", () => {
    const fallback = TEAM_ROLES.find((role) => role.value === TEAM_INVITE_DEFAULT_ROLE);
    expect(fallback?.consumesSeat).toBe(false);
  });
});

describe("seatRefusalHint", () => {
  it("names EVERY seat-consuming role, Editor included", () => {
    const hint = seatRefusalHint();
    expect(hint).toContain("Editor");
    expect(hint).toContain("Admin");
  });

  it("does not claim Editor is included on every plan", () => {
    // The exact sentence the dialog used to print under a refusal OF an Editor invite.
    expect(seatRefusalHint()).not.toContain("Viewer, Editor and Crew are included");
  });

  it("names the roles that really are on every plan", () => {
    const hint = seatRefusalHint();
    expect(hint).toContain("Viewer and Crew are included on every plan");
  });

  it("reads as one sentence per half, with the roles listed properly", () => {
    expect(seatRefusalHint()).toBe(
      "Editor and Admin each consume one of the account's seats. Viewer and Crew are included on every plan. Pick one of those, or upgrade this account's plan.",
    );
  });
});
