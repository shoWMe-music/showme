import { describe, expect, it } from "vitest";
import {
  CURRENCIES,
  FALLBACK_CURRENCY,
  currencyExponent,
  currencyForCountry,
  currencyOptionsForCountry,
  defaultCurrencyForCountry,
} from "./currencies";

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

describe("currency pickers derive from the country (decisions #17)", () => {
  it("defaults a Swedish object to SEK, not to a hardcoded EUR", () => {
    expect(defaultCurrencyForCountry("SE")).toBe("SEK");
    expect(currencyOptionsForCountry("SE")[0]).toBe("SEK");
  });

  it("puts the home currency first and keeps every other interpretable one", () => {
    const swedish = currencyOptionsForCountry("SE");
    expect(swedish[0]).toBe("SEK");
    expect(new Set(swedish)).toEqual(new Set(Object.keys(CURRENCIES)));
    expect(swedish).toHaveLength(Object.keys(CURRENCIES).length);
    // Cross-border inside a market is the point — SEK must still be on offer to
    // a German venue, and EUR to a Swedish one.
    expect(currencyOptionsForCountry("DE")[0]).toBe("EUR");
    expect(currencyOptionsForCountry("DE")).toContain("SEK");
    expect(swedish).toContain("EUR");
  });

  it("falls back to EUR only when the country is unknown or missing", () => {
    expect(defaultCurrencyForCountry("ZZ")).toBe(FALLBACK_CURRENCY);
    expect(defaultCurrencyForCountry(null)).toBe(FALLBACK_CURRENCY);
    expect(defaultCurrencyForCountry(undefined)).toBe(FALLBACK_CURRENCY);
    expect(currencyOptionsForCountry(null)[0]).toBe(FALLBACK_CURRENCY);
  });

  it("never offers a currency the money layer cannot interpret", () => {
    for (const currency of currencyOptionsForCountry("SE")) {
      expect(() => currencyExponent(currency)).not.toThrow();
    }
  });

  it("lists each currency exactly once", () => {
    const options = currencyOptionsForCountry("US");
    expect(new Set(options).size).toBe(options.length);
  });
});
