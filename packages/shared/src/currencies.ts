/**
 * Static currency reference — code → minor-unit exponent + symbol. Required to
 * interpret integer minor units per currency (money.md): SEK/EUR = 2, JPY = 0,
 * KWD = 3. Never hardcode "×100".
 */
export interface CurrencyInfo {
  code: string;
  minorUnitExponent: number;
  symbol: string;
}

export const CURRENCIES = {
  EUR: { code: "EUR", minorUnitExponent: 2, symbol: "€" },
  SEK: { code: "SEK", minorUnitExponent: 2, symbol: "kr" },
  NOK: { code: "NOK", minorUnitExponent: 2, symbol: "kr" },
  DKK: { code: "DKK", minorUnitExponent: 2, symbol: "kr" },
  GBP: { code: "GBP", minorUnitExponent: 2, symbol: "£" },
  USD: { code: "USD", minorUnitExponent: 2, symbol: "$" },
  JPY: { code: "JPY", minorUnitExponent: 0, symbol: "¥" },
  KWD: { code: "KWD", minorUnitExponent: 3, symbol: "KD" },
} satisfies Record<string, CurrencyInfo>;

export type CurrencyCode = keyof typeof CURRENCIES;

/** The minor-unit exponent for a currency. Throws for an unknown code. */
export function currencyExponent(currency: string): number {
  const info = (CURRENCIES as Record<string, CurrencyInfo>)[currency];
  if (!info) {
    throw new Error(`Unknown currency: ${currency}`);
  }
  return info.minorUnitExponent;
}

/**
 * Country → currency. Currency is a per-COUNTRY fact (decisions.md #17: country
 * drives VAT, PRO codes, currency), so an object's currency is defaulted from the
 * location it belongs to — for an event, its venue; for a booking request, the
 * venue profile being pitched.
 *
 * This is the DEFAULT-at-creation source only. Currency is then stamped on the row
 * and that stamp stays authoritative (#17), so correcting a venue's country later
 * never silently reprices history.
 *
 * Deliberately only the countries the platform actually operates in — an unknown
 * country returns null so the caller renders a bare amount rather than guessing a
 * symbol, which is the one outcome worse than showing none. Superseded by
 * `markets.default_currency` when the market table lands (#17).
 */
const COUNTRY_CURRENCY: Record<string, CurrencyCode> = {
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
  GB: "GBP",
  US: "USD",
  // Euro area.
  AT: "EUR",
  BE: "EUR",
  DE: "EUR",
  ES: "EUR",
  FI: "EUR",
  FR: "EUR",
  IE: "EUR",
  IT: "EUR",
  NL: "EUR",
  PT: "EUR",
};

/**
 * The default currency for an ISO 3166-1 alpha-2 country code, or null when the
 * country is unknown/absent. Case-insensitive.
 */
export function currencyForCountry(country: string | null | undefined): CurrencyCode | null {
  if (!country) return null;
  return COUNTRY_CURRENCY[country.toUpperCase()] ?? null;
}
