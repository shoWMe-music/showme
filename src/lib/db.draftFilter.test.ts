import { describe, it, expect } from "vitest";
import { isDraftVisibleToUser } from "./db";
import type { Event } from "./models";

function evt(overrides: Partial<Event> = {}): Pick<Event, "eventStatus" | "hostProfileId"> {
  return {
    eventStatus: "draft",
    hostProfileId: undefined,
    ...overrides,
  };
}

describe("isDraftVisibleToUser", () => {
  it("always shows non-draft events regardless of host profile", () => {
    expect(isDraftVisibleToUser(evt({ eventStatus: "confirmed", hostProfileId: "PRF-other" }), ["PRF-mine"]))
      .toBe(true);
    expect(isDraftVisibleToUser(evt({ eventStatus: "pending" }), [])).toBe(true);
  });

  it("shows drafts when user owns the host profile", () => {
    expect(isDraftVisibleToUser(evt({ hostProfileId: "PRF-mine" }), ["PRF-mine", "PRF-2"])).toBe(true);
  });

  it("hides drafts when host profile belongs to someone else", () => {
    expect(isDraftVisibleToUser(evt({ hostProfileId: "PRF-other" }), ["PRF-mine"])).toBe(false);
  });

  it("shows drafts when hostProfileId is missing (creator-only access via accessUids)", () => {
    expect(isDraftVisibleToUser(evt({ hostProfileId: undefined }), ["PRF-mine"])).toBe(true);
    expect(isDraftVisibleToUser(evt({ hostProfileId: undefined }), [])).toBe(true);
  });

  it("shows drafts when hostProfileId is empty string", () => {
    expect(isDraftVisibleToUser(evt({ hostProfileId: "" }), ["PRF-mine"])).toBe(true);
  });
});
