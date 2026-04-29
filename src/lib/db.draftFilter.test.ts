import { describe, it, expect } from "vitest";
import { isDraftVisibleToUser } from "./db";
import type { Event } from "./models";

function evt(overrides: Partial<Event> = {}): Pick<Event, "eventStatus" | "hostProfileId" | "accessUids" | "owner_uid"> {
  return {
    eventStatus: "draft",
    hostProfileId: undefined,
    accessUids: undefined,
    owner_uid: undefined,
    ...overrides,
  };
}

describe("isDraftVisibleToUser", () => {
  const UID = "uid-mine";

  it("always shows non-draft events regardless of host profile", () => {
    expect(isDraftVisibleToUser(evt({ eventStatus: "confirmed", hostProfileId: "PRF-other" }), UID, ["PRF-mine"]))
      .toBe(true);
    expect(isDraftVisibleToUser(evt({ eventStatus: "pending" }), UID, [])).toBe(true);
  });

  it("shows drafts when user owns the host profile", () => {
    expect(isDraftVisibleToUser(evt({ hostProfileId: "PRF-mine" }), UID, ["PRF-mine", "PRF-2"])).toBe(true);
  });

  it("hides drafts when host profile belongs to someone else and uid not in accessUids", () => {
    expect(isDraftVisibleToUser(evt({ hostProfileId: "PRF-other" }), UID, ["PRF-mine"])).toBe(false);
  });

  it("shows drafts when hostProfileId is missing (creator-only access via accessUids)", () => {
    expect(isDraftVisibleToUser(evt({ hostProfileId: undefined }), UID, ["PRF-mine"])).toBe(true);
    expect(isDraftVisibleToUser(evt({ hostProfileId: undefined }), UID, [])).toBe(true);
  });

  it("shows drafts when hostProfileId is empty string", () => {
    expect(isDraftVisibleToUser(evt({ hostProfileId: "" }), UID, ["PRF-mine"])).toBe(true);
  });

  it("shows drafts when uid is in accessUids even if profileIds hasn't loaded yet (race fix)", () => {
    // Reproduces the bug: page reload, profiles not yet hydrated, draft was created by this user
    expect(
      isDraftVisibleToUser(
        evt({ hostProfileId: "PRF-mine", accessUids: [UID] }),
        UID,
        [], // profileIds empty due to load-order race
      ),
    ).toBe(true);
  });

  it("shows drafts when legacy owner_uid matches uid", () => {
    expect(
      isDraftVisibleToUser(
        evt({ hostProfileId: "PRF-mine", owner_uid: UID }),
        UID,
        [],
      ),
    ).toBe(true);
  });

  it("hides drafts when uid is not in accessUids and host profile is foreign", () => {
    expect(
      isDraftVisibleToUser(
        evt({ hostProfileId: "PRF-other", accessUids: ["uid-someone-else"] }),
        UID,
        ["PRF-mine"],
      ),
    ).toBe(false);
  });
});
