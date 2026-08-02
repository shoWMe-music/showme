import { describe, expect, it } from "vitest";
import { CAPABILITIES, isCapability } from "./capabilities";

describe("capability catalog", () => {
  it("contains no duplicates", () => {
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
  });

  it("recognizes a known capability", () => {
    expect(isCapability("settlement.finalize")).toBe(true);
  });

  it("rejects an unknown capability", () => {
    expect(isCapability("settlement.destroy")).toBe(false);
  });

  it("omits the *.view.all overrides dropped in decisions #4 (pure party-scoping)", () => {
    // Deal/settlement visibility is *only* party membership — there is no
    // see-everything capability. If these ever reappear, it's a regression.
    expect(isCapability("deal.view.all")).toBe(false);
    expect(isCapability("settlement.view.all")).toBe(false);
  });
});
