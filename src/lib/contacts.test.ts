import { describe, it, expect } from "vitest";
import { contactHasType, contactPrimaryType, isOwnProfileName, contactExists } from "./contacts";

// ---------------------------------------------------------------------------
// contactHasType
// ---------------------------------------------------------------------------

describe("contactHasType", () => {
  it("matches single string type", () => {
    expect(contactHasType({ type: "venue" }, "venue")).toBe(true);
    expect(contactHasType({ type: "venue" }, "promoter")).toBe(false);
  });

  it("matches when type is an array", () => {
    expect(contactHasType({ type: ["venue", "promoter"] }, "venue")).toBe(true);
    expect(contactHasType({ type: ["venue", "promoter"] }, "promoter")).toBe(true);
    expect(contactHasType({ type: ["venue", "promoter"] }, "performer")).toBe(false);
  });

  it("handles single-element array", () => {
    expect(contactHasType({ type: ["performer"] }, "performer")).toBe(true);
    expect(contactHasType({ type: ["performer"] }, "venue")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// contactPrimaryType
// ---------------------------------------------------------------------------

describe("contactPrimaryType", () => {
  it("returns the type when it's a string", () => {
    expect(contactPrimaryType({ type: "agent" })).toBe("agent");
  });

  it("returns the first element when type is an array", () => {
    expect(contactPrimaryType({ type: ["promoter", "venue"] })).toBe("promoter");
  });

  it("returns the only element for single-element array", () => {
    expect(contactPrimaryType({ type: ["ticketing"] })).toBe("ticketing");
  });
});

// ---------------------------------------------------------------------------
// isOwnProfileName
// ---------------------------------------------------------------------------

describe("isOwnProfileName", () => {
  const profiles = ["My Venue", "My Promo Company"];

  it("returns true for exact match (case-insensitive)", () => {
    expect(isOwnProfileName("My Venue", profiles)).toBe(true);
    expect(isOwnProfileName("my venue", profiles)).toBe(true);
    expect(isOwnProfileName("MY VENUE", profiles)).toBe(true);
  });

  it("returns false for non-matching names", () => {
    expect(isOwnProfileName("Other Venue", profiles)).toBe(false);
    expect(isOwnProfileName("My Ven", profiles)).toBe(false);
  });

  it("trims whitespace before comparing", () => {
    expect(isOwnProfileName("  My Venue  ", profiles)).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(isOwnProfileName("", profiles)).toBe(false);
    expect(isOwnProfileName("   ", profiles)).toBe(false);
  });

  it("returns false when profile list is empty", () => {
    expect(isOwnProfileName("Anything", [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// contactExists
// ---------------------------------------------------------------------------

describe("contactExists", () => {
  const contacts = [
    { name: "Acme Promotions", type: "promoter" as const },
    { name: "Stage Techs", type: ["production", "venue"] as ("production" | "venue")[] },
    { name: "John Agent", type: "agent" as const },
  ];

  it("finds contact by name and single type", () => {
    expect(contactExists(contacts, "Acme Promotions", "promoter")).toBe(true);
  });

  it("is case-insensitive on name", () => {
    expect(contactExists(contacts, "acme promotions", "promoter")).toBe(true);
    expect(contactExists(contacts, "JOHN AGENT", "agent")).toBe(true);
  });

  it("returns false for wrong type", () => {
    expect(contactExists(contacts, "Acme Promotions", "venue")).toBe(false);
  });

  it("checks array types correctly", () => {
    expect(contactExists(contacts, "Stage Techs", "production")).toBe(true);
    expect(contactExists(contacts, "Stage Techs", "venue")).toBe(true);
    expect(contactExists(contacts, "Stage Techs", "promoter")).toBe(false);
  });

  it("returns false when contact doesn't exist", () => {
    expect(contactExists(contacts, "Unknown Person", "agent")).toBe(false);
  });

  it("returns false for empty list", () => {
    expect(contactExists([], "Any Name", "venue")).toBe(false);
  });
});
