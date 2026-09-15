import { describe, expect, it } from "vitest";
import {
  COUNTRY_CODES,
  countryFlag,
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

/**
 * The flag beside the code (ClickUp `123qy9rnfab`).
 *
 * The failure mode worth pinning is not a missing flag — that is visible — but a
 * WRONG one: two letters that are not a country still form a well-shaped pair of
 * regional indicators, and most systems draw those as two blank boxes that read
 * as "some flag failed to load" rather than "there is no such country".
 */
describe("countryFlag", () => {
  it("draws Ran's own examples", () => {
    expect(countryFlag("SE")).toBe("🇸🇪");
    expect(countryFlag("DE")).toBe("🇩🇪");
  });

  it("accepts the code however it was typed", () => {
    expect(countryFlag("se")).toBe("🇸🇪");
    expect(countryFlag(" Se ")).toBe("🇸🇪");
  });

  it("gives back null rather than a flag for a place that is not one", () => {
    // Checked against the register, not merely by shape: `XX` and `ZZ` are
    // two letters and would otherwise produce a perfectly well-formed
    // never-a-country flag.
    for (const value of ["XX", "ZZ", "SWE", "S", "", "  ", null, undefined]) {
      expect(countryFlag(value)).toBeNull();
    }
  });

  /**
   * The arithmetic, stated once: a flag IS its code, two regional indicators at
   * U+1F1E6 plus the letter offset. This is what makes a 249-row lookup table
   * unnecessary, so it is worth asserting that the derivation is real rather than
   * coincidental for the two examples above.
   */
  it("is the code itself, as regional indicators", () => {
    const flag = countryFlag("GB") as string;
    expect([...flag].map((character) => character.codePointAt(0))).toEqual([0x1f1ec, 0x1f1e7]);
  });

  it("has a flag for every code in the register", () => {
    for (const code of COUNTRY_CODES) {
      expect(countryFlag(code)).not.toBeNull();
    }
  });
});
