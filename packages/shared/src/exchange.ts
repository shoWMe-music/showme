import { currencyExponent } from "./currencies";

/**
 * Cross-currency conversion in EXACT integer minor units (money.md). The engine's
 * `Σ net = 0` runs in the event base currency, so any deal/budget line in another
 * currency is converted to base BEFORE summing — at a rate that is live during
 * compute and LOCKED into the finalize snapshot for reproducibility.
 */

/** Rates are stored as NUMERIC(18,10) — ten fractional digits. */
const RATE_DECIMALS = 10;
const RATE_SCALE = 10n ** BigInt(RATE_DECIMALS);

/** Parse a decimal rate string (`"10.5000000000"`) to `rate × 10^10` as a bigint. */
function parseScaledRate(rate: string): bigint {
  const negative = rate.trim().startsWith("-");
  const [whole, fraction = ""] = rate.trim().replace(/^[-+]/, "").split(".");
  const paddedFraction = fraction.padEnd(RATE_DECIMALS, "0").slice(0, RATE_DECIMALS);
  const scaled = BigInt(whole || "0") * RATE_SCALE + BigInt(paddedFraction || "0");
  return negative ? -scaled : scaled;
}

/** Integer division rounding half away from zero (symmetric for costs vs revenue). */
function divideRoundHalfAway(numerator: bigint, denominator: bigint): bigint {
  const sign = numerator < 0n ? -1n : 1n;
  const abs = numerator < 0n ? -numerator : numerator;
  return sign * ((abs + denominator / 2n) / denominator);
}

/**
 * Convert `amount` (minor units of `from`) to minor units of `to`, at `rate` =
 * "`to` per 1 `from`" (the `exchange_rate_cache` convention). Same currency is a
 * no-op. Differing minor-unit exponents (e.g. SEK↔JPY) are handled exactly, so no
 * precision is lost across the scale change.
 */
export function convertMinorUnits(amount: bigint, from: string, to: string, rate: string): bigint {
  if (from === to) return amount;
  const rateScaled = parseScaledRate(rate);
  const exponentDelta = currencyExponent(to) - currencyExponent(from);

  let numerator = amount * rateScaled;
  let denominator = RATE_SCALE;
  if (exponentDelta > 0) numerator *= 10n ** BigInt(exponentDelta);
  else if (exponentDelta < 0) denominator *= 10n ** BigInt(-exponentDelta);

  return divideRoundHalfAway(numerator, denominator);
}
