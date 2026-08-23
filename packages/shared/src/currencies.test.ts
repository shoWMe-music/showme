import { describe, expect, it } from "vitest";
import { CURRENCIES, currencyExponent, currencyForCountry } from "./currencies";

describe("currencyForCountry", () => {
  it("maps a country to the currency used there", () => {
    expect(currencyForCountry("SE")).toBe("SEK");
    expect(currencyForCountry("NO")).toBe("NOK");
    expect(currencyForCountry("GB")).toBe("GBP");
  });

  it("maps every euro-area country to EUR", () => {
    for (const country of ["DE", "FR", "NL", "IE", "FI", "ES", "IT", "PT", "AT", "BE"]) {
      expect(currencyForCountry(country), country).toBe("EUR");
    }
  });

  it("accepts a lowercase country code", () => {
    expect(currencyForCountry("se")).toBe("SEK");
  });

  // The one outcome worse than showing no symbol is showing the wrong one, so an
  // unknown or absent country must never fall back to a default currency.
  it("returns null rather than guessing for an unknown or missing country", () => {
    expect(currencyForCountry("ZZ")).toBeNull();
    expect(currencyForCountry("")).toBeNull();
    expect(currencyForCountry(null)).toBeNull();
    expect(currencyForCountry(undefined)).toBeNull();
  });

  it("only ever returns a currency the money layer can interpret", () => {
    for (const country of ["SE", "NO", "DK", "GB", "US", "DE"]) {
      const currency = currencyForCountry(country);
      expect(currency).not.toBeNull();
      expect(CURRENCIES[currency as keyof typeof CURRENCIES]).toBeDefined();
      // Minor-unit exponent must resolve, since amounts are stored as minor units.
      expect(() => currencyExponent(currency as string)).not.toThrow();
    }
  });
});
