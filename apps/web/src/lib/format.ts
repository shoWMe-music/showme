import { CURRENCIES } from "@showme/shared";

/** Formatting helpers shared across screens. Money is stored as bigint MINOR
 * units and serialized as a string over the API (see packages/db money.md), so
 * every amount is scaled by its currency's own minor-unit exponent for display. */

/**
 * HOW MANY MINOR UNITS MAKE ONE OF THIS CURRENCY — 100 for most, 1 for yen,
 * 1,000 for Kuwaiti dinar.
 *
 * These helpers divided by 100 unconditionally, which is right for the two-decimal
 * currencies and wrong for every other kind. Measured 2026-09-26 on a JPY event:
 * line items printed JP¥240,000 and the waterfall under them printed JP¥6,800 —
 * the same money at 1% of itself, because the engine is exponent-aware and the
 * screen was not. KWD fails the other way, printing ten times the real figure.
 *
 * `currencyExponent` THROWS on an unknown code, which is not acceptable in a render
 * path — a stale or empty code would blank the screen rather than mis-scale one
 * number. So the table is read directly and an unknown code falls back to 2, which
 * is what every caller already assumed.
 */
export function minorUnitsPer(currencyCode: string): number {
  const exponent =
    (CURRENCIES as Record<string, { minorUnitExponent: number } | undefined>)[currencyCode]
      ?.minorUnitExponent ?? 2;
  return 10 ** exponent;
}

/** Format a minor-unit amount (string or number) as major-unit currency. */
export function formatMoney(
  amountMinor: string | number | null | undefined,
  currencyCode: string,
): string {
  const minor = typeof amountMinor === "string" ? Number(amountMinor) : (amountMinor ?? 0);
  const currency = currencyCode || "EUR";
  const major = Number.isFinite(minor) ? minor / minorUnitsPer(currency) : 0;
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(major);
}

/**
 * The same money, to the MINOR UNIT.
 *
 * `formatMoney` rounds to whole units, which is what the design asks for and is
 * right almost everywhere — but it means two different amounts can print the same
 * text. That is harmless in a total and actively misleading in a sentence whose
 * whole job is to contrast two figures ("this row says X, the deal says Y"). Use
 * this where a rounded collision would make the copy contradict itself.
 */
export function formatMoneyExact(
  amountMinor: string | number | null | undefined,
  currencyCode: string,
): string {
  const minor = typeof amountMinor === "string" ? Number(amountMinor) : (amountMinor ?? 0);
  const currency = currencyCode || "EUR";
  const units = minorUnitsPer(currency);
  const major = Number.isFinite(minor) ? minor / units : 0;
  // The exponent decides the decimals as well as the scale: "to the minor unit"
  // means no decimals at all in yen, and three in Kuwaiti dinar.
  const digits = Math.log10(units);
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(major);
}

/**
 * The same minor-unit amount with its SIGN STRIPPED.
 *
 * For a figure whose direction is already named in words — "You owe SEK 45,000"
 * rather than "You owe −SEK 45,000", which is a double negative and reads as a
 * credit (QA7-28).
 *
 * It works on the raw minor units through `BigInt`, never by cutting a character
 * off a formatted string: a locale is free to put the minus sign after the amount,
 * inside the symbol, or use parentheses instead, so slicing a formatted amount is
 * only correct until someone changes the locale. A value that is not an integer
 * string is returned untouched, for the formatters to handle as they already do.
 */
export function absoluteMinor(amountMinor: string): string {
  if (!/^-?\d+$/.test(amountMinor)) return amountMinor;
  const value = BigInt(amountMinor);
  return (value < 0n ? -value : value).toString();
}

/**
 * Format a minor-unit amount with NO currency symbol — for the case where the
 * denomination genuinely isn't known. Showing a number under the wrong symbol is
 * worse than showing it under none, so callers must use this instead of letting
 * `formatMoney` fall back to a default currency.
 */
export function formatAmount(
  amountMinor: string | number | null | undefined,
  /**
   * The denomination where the caller does know it — only the SYMBOL was in
   * question. Without it the scale can only be assumed, and 2 is the assumption
   * every caller here has always made.
   */
  currencyCode?: string,
): string {
  const minor = typeof amountMinor === "string" ? Number(amountMinor) : (amountMinor ?? 0);
  const units = currencyCode ? minorUnitsPer(currencyCode) : 100;
  const major = Number.isFinite(minor) ? minor / units : 0;
  return new Intl.NumberFormat("en-IE", { maximumFractionDigits: 0 }).format(major);
}

/**
 * Parse a date the app might hand us, in LOCAL time.
 *
 * Three shapes arrive here and only one of them is safe to give to `new Date()`
 * directly:
 *   - `yyyy-mm-dd` — a `date` column (`events.event_date`, `tasks.due_date`).
 *     `new Date("2026-09-13")` parses this as UTC midnight, so west of Greenwich
 *     `toLocaleDateString` prints the twelfth. Split it and build a local date.
 *   - `yyyy-mm-ddThh:mm` — offset-free local wall clock (decisions #10). Same
 *     trap, same fix; the clock half is dropped, since callers here want the day.
 *   - a full ISO timestamp with a zone — `new Date()` is correct for these.
 *
 * Returns `null` for anything unparseable, so every formatter below can render a
 * placeholder rather than "Invalid Date".
 */
export function parseDayLocal(value: string | null | undefined): Date | null {
  if (!value) return null;

  // Offset-FREE only, and anchored at both ends. The anchor is the whole point:
  // an unanchored pattern also matches the head of `2026-09-13T14:30:00.000Z`,
  // which sends a zoned instant down the local-midnight branch — throwing its
  // clock away and naming the UTC day rather than the reader's. Every call site
  // that formats a real timestamp inherits that, so the `Z`/`±hh:mm` forms must
  // fall through to `new Date()`, which resolves them correctly.
  const offsetFree = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/.exec(
    value,
  );
  if (offsetFree) {
    const [, year, month, day, hour, minute] = offsetFree;
    const local = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour ?? 0),
      Number(minute ?? 0),
    );
    return Number.isNaN(local.getTime()) ? null : local;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * THE date format for this app: day first, month abbreviated, **year always**.
 *
 * Both halves of that are deliberate. Day-first because the product is European
 * (`docs/decisions.md` #17 — territory-scoped, SE/DE/UK first), and a bare
 * "09/13" is ambiguous to the reader it was written for. The year because a
 * booking calendar routinely holds next year's shows beside this year's, and a
 * date without one is a date you have to go and check.
 *
 * Every date a person reads goes through here or one of its siblings. Ad-hoc
 * `toLocaleDateString` calls are how the app ended up printing four formats
 * across three locales.
 */
export function formatDay(value: string | null | undefined): string {
  const date = parseDayLocal(value);
  if (!date) return "—";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** `formatDay` with the weekday in front — "Mon, 2 Nov 2026". For a single date
 * a reader is being asked to act on, where which-day-of-the-week is the point. */
export function formatDayWithWeekday(value: string | null | undefined): string {
  const date = parseDayLocal(value);
  if (!date) return "—";
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "September 2026" — a calendar heading. */
export function formatMonthYear(value: Date | string | null | undefined): string {
  const date = value instanceof Date ? value : parseDayLocal(value);
  if (!date || Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/** The `yyyy-mm-dd` key for a date, in LOCAL time — the form day lookups and the
 * calendar's `?date=` link both travel in. */
export function dayKey(value: Date | string | null | undefined): string | null {
  const date = value instanceof Date ? value : parseDayLocal(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Format a date with explicit options. Prefer `formatDay` — this exists for the
 * handful of places that genuinely need a different shape, and it parses through
 * `parseDayLocal` so they inherit the off-by-one fix too.
 */
export function formatDate(
  iso: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" },
): string {
  const date = parseDayLocal(iso);
  if (!date) return "—";
  return date.toLocaleDateString("en-GB", options);
}

/**
 * The clock, in 24-hour form — "19:00".
 *
 * Five screens hand-rolled this with identical options before it existed
 * (`en-GB`, `{hour: "2-digit", minute: "2-digit"}`), which is what a shared
 * helper is actually for. Parses through `parseDayLocal`, so an offset-free
 * `yyyy-mm-ddThh:mm` keeps the wall clock it was written with (decisions #10)
 * rather than being shifted into the reader's zone.
 */
export function formatTime(value: string | null | undefined): string {
  const date = parseDayLocal(value);
  if (!date) return "—";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/**
 * A file size a person can read ("240 KB", "1.8 MB"). Decimal units, because
 * that is what the operating system that produced the file shows. Returns "" for
 * an unknown size, so a missing byte count renders as nothing rather than "0 B".
 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1000;
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unitIndex]}`;
}

/**
 * Human-friendly age of an ISO timestamp ("just now", "5m ago", "3d ago").
 * Returns "" for an unparseable value so a bad timestamp renders as nothing
 * rather than "NaN ago".
 */
export function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * A PARTY'S NAME AS A POSSESSIVE — an apostrophe alone when the name already ends in s.
 *
 * "Northlight Presents's share of what the event carries" is not a sentence anybody wrote on
 * purpose, and a profile name is a trading name, so plenty of them end in s. Fixed once for the
 * settlement document (`45d39ac`) and left PRIVATE to that module, which is why the sweep found
 * it again the same day on the Budget Planner's split control — an `aria-label`, read aloud —
 * and in the cost-attribution menu (QA sweep run 11).
 *
 * It lives here so the rule has one home for every screen that writes a party's name, rather
 * than being right on the one screen somebody happened to be looking at.
 */
export function possessiveOf(name: string): string {
  // Case-INSENSITIVE, because a trading name is often set in caps and "NORTHLIGHT PRESENTS's"
  // is the same mistake shouting. Caught while writing the test for this, which had been about
  // to pin the lowercase-only behaviour as though it were deliberate.
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

/**
 * THE ONE CURRENCY A SUM MAY BE LABELLED WITH, or `null` when there is not one.
 *
 * decisions §25.8.1, Daniel's ruling: *whenever the rows a tile sums are not all one currency, print
 * `—` and a note saying why.* A total is a single number, and a single number can only honestly
 * carry a symbol when every figure inside it already does.
 *
 * Three surfaces guessed instead, each differently, and each guess was wrong in the same direction:
 * `settlementTotals` took `settlements[0].currency` (the FIRST row), `/invoices` kept the LAST row's
 * in a loop, and `/projections` fell back through the first event's base currency to a hardcoded
 * `"EUR"`. So a Swedish operator with one Oslo show read a SEK+NOK total labelled SEK, with the minor
 * units added together as though they were the same unit.
 *
 * `formatAmount` above was written for precisely this and says so — *"showing a number under the
 * wrong symbol is worse than showing it under none"* — and all three callers did the thing it tells
 * them not to. This is the question they needed to ask first.
 *
 * `null` covers three different absences on purpose, because every one of them means the same thing
 * to a caller: there is no symbol this sum may wear. Nothing to sum, nothing carrying a currency,
 * and more than one currency. The caller distinguishes them by what it already knows (an empty list
 * is an empty list), not by asking this.
 */
export function oneCurrencyOrNull(codes: readonly (string | null | undefined)[]): string | null {
  let seen: string | null = null;
  for (const code of codes) {
    if (!code) continue;
    if (seen === null) {
      seen = code;
      continue;
    }
    if (seen !== code) return null;
  }
  return seen;
}
