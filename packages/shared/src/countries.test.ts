import { describe, expect, it } from "vitest";
import {
  COUNTRY_CODES,
  isCountryCode,
  normalizeCountryCode,
  normalizeCountryCodes,
} from "./countries";

describe("COUNTRY_CODES", () => {
  it("holds the full ISO 3166-1 alpha-2 register, not just the markets we sell in", () => {
    expect(COUNTRY_CODES.size).toBe(249);
    // A country the platform has no pricing for is still a country.
    expect(COUNTRY_CODES.has("GH")).toBe(true);
  });

  it("stores every code uppercase and two letters", () => {
    for (const code of COUNTRY_CODES) {
      expect(code).toMatch(/^[A-Z]{2}$/);
    }
  });
});

describe("isCountryCode", () => {
  it("accepts real codes in any case", () => {
    expect(isCountryCode("SE")).toBe(true);
    expect(isCountryCode("se")).toBe(true);
    expect(isCountryCode("dE")).toBe(true);
  });

  it("rejects invented codes, country NAMES, and the empty string", () => {
    expect(isCountryCode("ATLANTIS")).toBe(false);
    expect(isCountryCode("sweden")).toBe(false);
    expect(isCountryCode("")).toBe(false);
    expect(isCountryCode("S")).toBe(false);
    expect(isCountryCode("SWE")).toBe(false); // alpha-3 is not our vocabulary
  });

  it("rejects an untrimmed code — normalize before testing", () => {
    expect(isCountryCode(" SE ")).toBe(false);
    expect(isCountryCode(normalizeCountryCode(" se "))).toBe(true);
  });
});

describe("normalizeCountryCodes", () => {
  it("uppercases, trims and de-duplicates while keeping input order", () => {
    expect(normalizeCountryCodes([" no ", "se", "SE", "dk"])).toEqual(["NO", "SE", "DK"]);
  });

  it("leaves nonsense intact so the rejection can name it", () => {
    expect(normalizeCountryCodes(["sweden", ""])).toEqual(["SWEDEN", ""]);
  });

  it("maps an empty list to an empty list", () => {
    expect(normalizeCountryCodes([])).toEqual([]);
  });
});
