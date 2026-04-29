import { describe, it, expect } from "vitest";
import {
  contactHasType,
  contactPrimaryType,
  isOwnProfileName,
  contactExists,
  normalizeContactType,
  contactTypeList,
  groupContactsByType,
} from "./contacts";

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

  it("treats legacy 'artist' type as 'performer'", () => {
    expect(contactHasType({ type: "artist" }, "performer")).toBe(true);
    expect(contactHasType({ type: ["artist"] }, "performer")).toBe(true);
    expect(contactHasType({ type: ["artist", "promoter"] }, "performer")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalizeContactType
// ---------------------------------------------------------------------------

describe("normalizeContactType", () => {
  it("maps legacy 'artist' to 'performer'", () => {
    expect(normalizeContactType("artist")).toBe("performer");
  });

  it("returns other types unchanged", () => {
    expect(normalizeContactType("performer")).toBe("performer");
    expect(normalizeContactType("venue")).toBe("venue");
    expect(normalizeContactType("promoter")).toBe("promoter");
    expect(normalizeContactType("ticketing")).toBe("ticketing");
    expect(normalizeContactType("custom-type")).toBe("custom-type");
  });
});

// ---------------------------------------------------------------------------
// contactTypeList
// ---------------------------------------------------------------------------

describe("contactTypeList", () => {
  it("wraps a single type in an array", () => {
    expect(contactTypeList({ type: "venue" })).toEqual(["venue"]);
  });

  it("returns array types as-is when modern", () => {
    expect(contactTypeList({ type: ["venue", "promoter"] })).toEqual(["venue", "promoter"]);
  });

  it("normalizes legacy 'artist' → 'performer' in arrays", () => {
    expect(contactTypeList({ type: ["artist", "promoter"] })).toEqual(["performer", "promoter"]);
  });

  it("normalizes legacy 'artist' → 'performer' for single value", () => {
    expect(contactTypeList({ type: "artist" })).toEqual(["performer"]);
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

  it("normalizes legacy 'artist' to 'performer'", () => {
    expect(contactPrimaryType({ type: "artist" })).toBe("performer");
    expect(contactPrimaryType({ type: ["artist", "manager"] })).toBe("performer");
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

  it("does not match against empty profile name slots", () => {
    // Regression: empty/missing names in the profile list must not cause false
    // negatives or exceptions when comparing (Bug #2).
    expect(isOwnProfileName("Lil Daniel", ["", "Lil Daniel"])).toBe(true);
    expect(isOwnProfileName("Lil Daniel", ["", "Other"])).toBe(false);
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

// ---------------------------------------------------------------------------
// groupContactsByType
// ---------------------------------------------------------------------------

describe("groupContactsByType", () => {
  it("groups single-type contacts by type", () => {
    const contacts = [
      { name: "Acme", type: "promoter" as const },
      { name: "Lil Daniel", type: "performer" as const },
      { name: "Stage Hall", type: "venue" as const },
    ];
    const grouped = groupContactsByType(contacts);
    expect(grouped.promoter).toHaveLength(1);
    expect(grouped.performer).toHaveLength(1);
    expect(grouped.venue).toHaveLength(1);
  });

  it("creates a Performer group when a single performer is added (regression: count-without-section)", () => {
    // Bug #1: A new Performer contact should always create a Performer section.
    const contacts = [
      { name: "Existing Promoter", type: "promoter" as const },
      { name: "New Performer", type: "performer" as const },
    ];
    const grouped = groupContactsByType(contacts);
    expect(grouped.performer).toBeDefined();
    expect(grouped.performer).toHaveLength(1);
    expect(grouped.performer[0].name).toBe("New Performer");
  });

  it("places a multi-type contact into every applicable group", () => {
    const contacts = [
      { name: "Both Roles", type: ["promoter", "performer"] as ("promoter" | "performer")[] },
    ];
    const grouped = groupContactsByType(contacts);
    expect(grouped.promoter).toHaveLength(1);
    expect(grouped.performer).toHaveLength(1);
  });

  it("normalizes legacy 'artist' type into the performer group (Bug #4)", () => {
    const contacts = [
      { name: "Legacy Artist", type: "artist" as const },
    ];
    const grouped = groupContactsByType(contacts);
    expect(grouped.performer).toHaveLength(1);
    expect(grouped.artist).toBeUndefined();
  });

  it("returns empty object for empty input", () => {
    expect(groupContactsByType([])).toEqual({});
  });
});
