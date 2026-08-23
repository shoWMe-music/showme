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

/** Format an ISO date string. Returns a placeholder for null/invalid dates. */
export function formatDate(
  iso: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" },
): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", options);
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
