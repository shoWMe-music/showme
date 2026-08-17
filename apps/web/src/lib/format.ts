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
