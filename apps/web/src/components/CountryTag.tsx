import { countryFlag } from "@showme/shared";

/**
 * A country, as its code and flag — `SE 🇸🇪` (ClickUp `123qy9rnfab`).
 *
 * Ran asked for this next to each event on the calendar and in the event manager,
 * and said why: *"this is for the Performers and agents to know."* An act reading
 * a list of their own nights needs the country of each one — it decides a flight,
 * a carnet and a tax form — and the operator who titled the show had no reason to
 * put it in the title.
 *
 * THE CODE IS SHOWN AS WELL AS THE FLAG, not replaced by it, and that is the
 * whole design. Flag glyphs are a platform feature: Windows draws no flag emoji
 * at all, so a flag-only tag renders there as two blank letter-boxes, and a
 * reader on a machine that DOES draw them still has to distinguish a dozen
 * similar tricolours at 11px. The code is the information; the flag is what makes
 * it scannable.
 *
 * Renders nothing at all when there is no country, rather than a placeholder. An
 * event whose venue is free text genuinely has no country, and a "—" in a row of
 * flags reads as a country that failed to load rather than one that was never
 * recorded.
 */
export function CountryTag({
  country,
  size = 11.5,
}: {
  country: string | null | undefined;
  size?: number;
}) {
  const code = country?.trim().toUpperCase();
  if (!code) return null;
  const flag = countryFlag(code);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: size,
        fontFamily: "var(--font-mono)",
        letterSpacing: ".02em",
        color: "var(--muted)",
        whiteSpace: "nowrap",
      }}
      // The code alone is the accessible name: a screen reader announcing a flag
      // emoji reads the country's name in the user's own locale, which is useful
      // to nobody reading a list of two-letter codes.
      title={flag ? `${code} ${flag}` : code}
    >
      {code}
      {flag && (
        <span aria-hidden="true" style={{ fontSize: size + 1.5 }}>
          {flag}
        </span>
      )}
    </span>
  );
}
