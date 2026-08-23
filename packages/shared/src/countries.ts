/**
 * ISO 3166-1 alpha-2 — the platform's one country vocabulary.
 *
 * Country is load-bearing, not decoration (decisions.md #17): it stamps tax, PRO
 * and currency, and it draws a representation's **territory** (`representations.region`,
 * decisions.md #14). A territory that contains a code no country answers to is
 * worse than an empty one — it *looks* set while matching nothing, so an agent
 * appears to hold a region they can never be assigned an event in (audit A-18,
 * where `["ATLANTIS", "sweden", ""]` was accepted and silently inert).
 *
 * So this is the FULL official alpha-2 register, not the subset the platform
 * currently sells in: which countries shoWMe operates in is a market question
 * (`currencyForCountry`, and later `markets`), whereas "is this string a country
 * at all" is a spelling question, and the two must not be conflated — rejecting
 * `GH` as "not a country" because we have no Ghanaian pricing yet would be a lie.
 */

/**
 * The register itself, as whitespace-separated text — one grouped line per letter
 * block. A `Set` literal of 249 quoted strings formats to 249 lines and hides
 * exactly the thing a human checks this file for: whether a code is present.
 */
const ALPHA_2_REGISTER = `
  AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
  BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
  CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
  DE DJ DK DM DO DZ
  EC EE EG EH ER ES ET
  FI FJ FK FM FO FR
  GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY
  HK HM HN HR HT HU
  ID IE IL IM IN IO IQ IR IS IT
  JE JM JO JP
  KE KG KH KI KM KN KP KR KW KY KZ
  LA LB LC LI LK LR LS LT LU LV LY
  MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
  NA NC NE NF NG NI NL NO NP NR NU NZ
  OM
  PA PE PF PG PH PK PL PM PN PR PS PT PW PY
  QA
  RE RO RS RU RW
  SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
  TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ
  UA UG UM US UY UZ
  VA VC VE VG VI VN VU
  WF WS
  YE YT
  ZA ZM ZW
`;

/** Every assigned ISO 3166-1 alpha-2 code, uppercase. */
export const COUNTRY_CODES: ReadonlySet<string> = new Set(ALPHA_2_REGISTER.trim().split(/\s+/));

/**
 * Is `value` a real ISO 3166-1 alpha-2 country code? Case-insensitive on the way
 * in (the caller decides whether to store the normalized form), but a code with
 * surrounding whitespace or any other length is NOT a country code — normalize
 * first with `normalizeCountryCode`.
 */
export function isCountryCode(value: string): boolean {
  return COUNTRY_CODES.has(value.toUpperCase());
}

/** The canonical stored form of one code: trimmed and uppercased. Does not validate. */
export function normalizeCountryCode(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * The canonical stored form of a country LIST: each entry normalized, duplicates
 * dropped, input order kept. Does not validate — pair it with `isCountryCode` so
 * the rejection message can name the offending entry as the caller wrote it.
 */
export function normalizeCountryCodes(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const code = normalizeCountryCode(value);
    if (seen.has(code)) continue;
    seen.add(code);
    normalized.push(code);
  }
  return normalized;
}
