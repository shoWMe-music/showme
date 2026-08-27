/** Formatting helpers shared across screens. Money is stored as bigint MINOR
 * units and serialized as a string over the API (see packages/db money.md), so
 * every amount is divided by 100 for display. */

/** Format a minor-unit amount (string or number) as major-unit currency. */
export function formatMoney(
  amountMinor: string | number | null | undefined,
  currencyCode: string,
): string {
  const minor = typeof amountMinor === "string" ? Number(amountMinor) : (amountMinor ?? 0);
  const major = Number.isFinite(minor) ? minor / 100 : 0;
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: currencyCode || "EUR",
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
  const major = Number.isFinite(minor) ? minor / 100 : 0;
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: currencyCode || "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(major);
}

/**
 * Format a minor-unit amount with NO currency symbol — for the case where the
 * denomination genuinely isn't known. Showing a number under the wrong symbol is
 * worse than showing it under none, so callers must use this instead of letting
 * `formatMoney` fall back to a default currency.
 */
export function formatAmount(amountMinor: string | number | null | undefined): string {
  const minor = typeof amountMinor === "string" ? Number(amountMinor) : (amountMinor ?? 0);
  const major = Number.isFinite(minor) ? minor / 100 : 0;
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
