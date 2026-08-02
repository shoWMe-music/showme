import { currencyExponent } from "./currencies";

/**
 * The money value type — integer minor units + explicit currency, never float
 * (money.md). €10.00 → `{ amount: 1000n, currency: "EUR" }`. All money math
 * flows through here so `Σ net = 0` holds exactly, and currency mismatches throw.
 */
export interface Money {
  readonly amount: bigint;
  readonly currency: string;
}

export function money(amount: bigint, currency: string): Money {
  return { amount, currency };
}

export function zeroMoney(currency: string): Money {
  return { amount: 0n, currency };
}

export function isZeroMoney(value: Money): boolean {
  return value.amount === 0n;
}

export function negateMoney(value: Money): Money {
  return { amount: -value.amount, currency: value.currency };
}

function assertSameCurrency(left: Money, right: Money): void {
  if (left.currency !== right.currency) {
    throw new Error(`Currency mismatch: ${left.currency} vs ${right.currency}`);
  }
}

export function addMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return { amount: left.amount + right.amount, currency: left.currency };
}

export function subtractMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return { amount: left.amount - right.amount, currency: left.currency };
}

export function sumMoney(values: Money[], currency: string): Money {
  let total = 0n;
  for (const value of values) {
    if (value.currency !== currency) {
      throw new Error(`Currency mismatch: ${value.currency} vs ${currency}`);
    }
    total += value.amount;
  }
  return { amount: total, currency };
}

export function compareMoney(left: Money, right: Money): -1 | 0 | 1 {
  assertSameCurrency(left, right);
  if (left.amount < right.amount) return -1;
  if (left.amount > right.amount) return 1;
  return 0;
}

/**
 * Split `total` across integer `weights` by the largest-remainder method:
 * `Σ parts === total`, exactly. Every split (door_split, N-way share,
 * commissions, VAT, deductibles) goes through this so no minor unit is lost.
 */
export function allocate(total: bigint, weights: bigint[]): bigint[] {
  if (weights.length === 0) {
    return [];
  }
  if (total < 0n) {
    return allocate(-total, weights).map((part) => -part);
  }
  const weightTotal = weights.reduce((running, weight) => running + weight, 0n);
  if (weightTotal <= 0n) {
    throw new Error("allocate() requires a positive total weight");
  }

  const shares = weights.map((weight) => (total * weight) / weightTotal);
  const remainders = weights.map((weight, index) => ({
    index,
    remainder: (total * weight) % weightTotal,
  }));
  let leftover = total - shares.reduce((running, share) => running + share, 0n);

  // Hand the leftover minor units to the largest fractional remainders first.
  remainders.sort((left, right) =>
    left.remainder < right.remainder
      ? 1
      : left.remainder > right.remainder
        ? -1
        : left.index - right.index,
  );
  for (let position = 0; leftover > 0n; position = (position + 1) % remainders.length) {
    const target = remainders[position];
    if (!target) break;
    const share = shares[target.index];
    if (share === undefined) break;
    shares[target.index] = share + 1n;
    leftover -= 1n;
  }
  return shares;
}

export function allocateMoney(total: Money, weights: bigint[]): Money[] {
  return allocate(total.amount, weights).map((amount) => ({ amount, currency: total.currency }));
}

/** A percentage of an amount, in minor units, rounded half-up. */
export function applyBasisPoints(amount: bigint, basisPoints: number): bigint {
  const points = BigInt(Math.round(basisPoints));
  const scaled = amount * points;
  return scaled >= 0n ? (scaled + 5000n) / 10000n : -((-scaled + 5000n) / 10000n);
}

export function multiplyByBasisPoints(value: Money, basisPoints: number): Money {
  return { amount: applyBasisPoints(value.amount, basisPoints), currency: value.currency };
}

/** JSON boundary: money is serialized as a STRING (bigints past 2^53 are unsafe as a JS number). */
export interface MoneyJson {
  amount: string;
  currency: string;
}

export function moneyToJson(value: Money): MoneyJson {
  return { amount: value.amount.toString(), currency: value.currency };
}

export function moneyFromJson(value: MoneyJson): Money {
  return { amount: BigInt(value.amount), currency: value.currency };
}

/** Parse a decimal major amount ("10.00") into minor units for its currency. */
export function majorToMinor(amount: string | number, currency: string): bigint {
  const exponent = currencyExponent(currency);
  const text = typeof amount === "number" ? amount.toString() : amount.trim();
  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const paddedFraction = fraction.padEnd(exponent, "0").slice(0, exponent);
  const combined = BigInt(`${whole}${paddedFraction}` || "0");
  return negative ? -combined : combined;
}

/** Render minor units as a plain decimal string ("1000" EUR → "10.00"). */
export function minorToDecimalString(value: Money): string {
  const exponent = currencyExponent(value.currency);
  const negative = value.amount < 0n;
  const digits = (negative ? -value.amount : value.amount).toString().padStart(exponent + 1, "0");
  const cut = digits.length - exponent;
  const whole = digits.slice(0, cut);
  const fraction = digits.slice(cut);
  const body = exponent === 0 ? whole : `${whole}.${fraction}`;
  return negative ? `-${body}` : body;
}
