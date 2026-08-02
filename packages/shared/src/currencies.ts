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
