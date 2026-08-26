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

/**
 * Where a currency PICKER lands when the country is unknown or unmapped. Distinct
 * from `currencyForCountry` returning null on purpose: refusing to guess is right
 * when the answer is a symbol next to an amount (the wrong symbol is worse than
 * none), and wrong when the answer is the pre-selection in a dropdown the user is
 * about to confirm — there the control has to start somewhere.
 */
export const FALLBACK_CURRENCY: CurrencyCode = "EUR";

/** The country's own currency, or `FALLBACK_CURRENCY` when it has none mapped. */
export function defaultCurrencyForCountry(country: string | null | undefined): CurrencyCode {
  return currencyForCountry(country) ?? FALLBACK_CURRENCY;
}

/**
 * What a currency picker offers, and in what order — the country's own currency
 * FIRST, then every other currency the money layer can interpret.
 *
 * Two different rules, deliberately:
 *   - the DEFAULT is the home country's currency (decisions #17: `country` stamps
 *     tax, PRO codes and currency), so a Stockholm venue is not asked to correct
 *     EUR into SEK on every event it creates — the bug this replaces;
 *   - the OPTIONS stay the full interpretable set, because cross-border booking
 *     inside a market is the point (#17: a German venue books a Swedish band) and
 *     a picker that offers only home is not a picker.
 *
 * `CURRENCIES` is the interpretable set because minor-unit exponents live there,
 * and an amount in a currency whose exponent is unknown cannot be stored at all
 * (money.md). This chooses the currency an object is DENOMINATED in, which is
 * authoritative once stamped — never the cosmetic per-user display currency.
 */
export function currencyOptionsForCountry(country: string | null | undefined): CurrencyCode[] {
  const home = defaultCurrencyForCountry(country);
  const rest = (Object.keys(CURRENCIES) as CurrencyCode[]).filter((code) => code !== home);
  return [home, ...rest];
}
