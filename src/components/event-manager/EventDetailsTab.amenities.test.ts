import { describe, it, expect } from "vitest";
import {
  addCustomAmenity,
  isStandardAmenityKey,
  partitionAmenities,
} from "./EventDetailsTab";

describe("addCustomAmenity (Wave 7 C5)", () => {
  it("appends a trimmed custom amenity to the existing list", () => {
    expect(addCustomAmenity(["catering"], "Green Room")).toEqual(["catering", "Green Room"]);
  });

  it("trims surrounding whitespace before appending", () => {
    expect(addCustomAmenity([], "  WiFi  ")).toEqual(["WiFi"]);
  });

  it("ignores empty strings", () => {
    expect(addCustomAmenity(["catering"], "")).toEqual(["catering"]);
  });

  it("ignores whitespace-only strings", () => {
    expect(addCustomAmenity(["catering"], "   ")).toEqual(["catering"]);
  });

  it("does not duplicate an existing custom amenity", () => {
    expect(addCustomAmenity(["catering", "Green Room"], "Green Room")).toEqual([
      "catering",
      "Green Room",
    ]);
  });

  it("does not duplicate a standard amenity if user types its key verbatim", () => {
    expect(addCustomAmenity(["catering"], "catering")).toEqual(["catering"]);
  });

  it("returns the SAME array reference when no change is made (caller can rely on identity)", () => {
    const before = ["catering"];
    const after = addCustomAmenity(before, "");
    expect(after).toBe(before);
  });

  it("returns a NEW array reference when the value is appended", () => {
    const before = ["catering"];
    const after = addCustomAmenity(before, "WiFi");
    expect(after).not.toBe(before);
  });
});

describe("isStandardAmenityKey (Wave 7 C5)", () => {
  it("returns true for known AmenityKey values", () => {
    expect(isStandardAmenityKey("catering")).toBe(true);
    expect(isStandardAmenityKey("backline")).toBe(true);
    expect(isStandardAmenityKey("accommodation")).toBe(true);
  });

  it("returns false for arbitrary custom strings", () => {
    expect(isStandardAmenityKey("Green Room")).toBe(false);
    expect(isStandardAmenityKey("WiFi")).toBe(false);
    expect(isStandardAmenityKey("")).toBe(false);
  });

  it("returns false for prototype-pollution attempts", () => {
    expect(isStandardAmenityKey("toString")).toBe(false);
    expect(isStandardAmenityKey("__proto__")).toBe(false);
  });
});

describe("partitionAmenities (Wave 7 C5)", () => {
  it("splits a mixed list into typed-key and free-text buckets", () => {
    const { standard, custom } = partitionAmenities([
      "catering",
      "Green Room",
      "backline",
      "Late-night Snacks",
    ]);
    expect(standard).toEqual(["catering", "backline"]);
    expect(custom).toEqual(["Green Room", "Late-night Snacks"]);
  });

  it("returns empty buckets for an empty list", () => {
    expect(partitionAmenities([])).toEqual({ standard: [], custom: [] });
  });

  it("returns only standard when the list has no customs", () => {
    expect(partitionAmenities(["catering", "parking"])).toEqual({
      standard: ["catering", "parking"],
      custom: [],
    });
  });

  it("returns only customs when no standard keys are present", () => {
    expect(partitionAmenities(["WiFi", "Production runner"])).toEqual({
      standard: [],
      custom: ["WiFi", "Production runner"],
    });
  });

  it("preserves original ordering within each bucket", () => {
    const { standard, custom } = partitionAmenities([
      "Z-custom",
      "parking",
      "A-custom",
      "backline",
    ]);
    expect(standard).toEqual(["parking", "backline"]);
    expect(custom).toEqual(["Z-custom", "A-custom"]);
  });
});
