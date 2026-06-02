/**
 * EU member states (ISO 3166-1 alpha-2 codes). Used to gate "EU only at
 * launch" per the freemium spec: outside-EU venue stubs are blocked until
 * payment infra + GDPR rails are extended.
 *
 * Source: Council of the EU member-state list as of 2024 (27 members,
 * post-Brexit). Update when membership changes.
 */
export const EU_COUNTRIES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "AT", name: "Austria" },
  { code: "BE", name: "Belgium" },
  { code: "BG", name: "Bulgaria" },
  { code: "HR", name: "Croatia" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czech Republic" },
  { code: "DK", name: "Denmark" },
  { code: "EE", name: "Estonia" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "GR", name: "Greece" },
  { code: "HU", name: "Hungary" },
  { code: "IE", name: "Ireland" },
  { code: "IT", name: "Italy" },
  { code: "LV", name: "Latvia" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "MT", name: "Malta" },
  { code: "NL", name: "Netherlands" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "RO", name: "Romania" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "ES", name: "Spain" },
  { code: "SE", name: "Sweden" },
];

const EU_CODE_SET = new Set(EU_COUNTRIES.map((c) => c.code));

const COUNTRY_NAME_TO_CODE: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const c of EU_COUNTRIES) {
    map[c.name.toLowerCase()] = c.code;
    map[c.code.toLowerCase()] = c.code;
  }
  // Common alternates that show up in free-text location fields.
  map["the netherlands"] = "NL";
  map["czechia"] = "CZ";
  map["czech republic"] = "CZ";
  map["deutschland"] = "DE";
  map["españa"] = "ES";
  map["nederland"] = "NL";
  return map;
})();

export function isEuCountry(code: string | null | undefined): boolean {
  if (!code) return false;
  return EU_CODE_SET.has(code.toUpperCase());
}

/**
 * Best-effort parse of a free-text country (whatever the user typed into
 * their profile location) into an EU country code. Returns null when no
 * match — caller should treat that as "not EU" or "ask explicitly".
 */
export function parseEuCountryCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  return COUNTRY_NAME_TO_CODE[trimmed] ?? null;
}

export function countryNameFromCode(code: string): string {
  const match = EU_COUNTRIES.find((c) => c.code === code.toUpperCase());
  return match?.name ?? code;
}
