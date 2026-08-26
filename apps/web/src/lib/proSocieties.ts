/**
 * Country → collecting society (PRO), and the IANA-zone → country step the event
 * rows currently force on us.
 *
 * WHY this table exists at all: decisions.md #17 makes `country` the load-bearing
 * stamp for the things that are genuinely per-country — "VAT, PRO codes
 * (STIM/GEMA/PRS), currency" — and `packages/shared/src/countries.ts` repeats that
 * in its own header. The country register is there; the PRO table it promises is
 * not. This is that table.
 *
 * WHY it lives in `apps/web` for now: it is a shared-vocabulary table (the API's
 * `pro_code` enum and the future submission integration will both want it), so it
 * BELONGS in `packages/shared`, next to `countries.ts`, keyed on the same alpha-2
 * codes. It is parked here only because the screen needs it today.
 *
 * WHY a timezone step: an event carries no country stamp yet — `GET /events`
 * returns `timezone` and `venueProfileId`, no country — so the only location
 * signal on this screen is the IANA zone snapshotted from the venue
 * (decisions.md #10). Deriving the country from the zone keeps the real table
 * country-keyed; when events carry a country, delete `countryForTimezone` and
 * every other line here still stands.
 */

export interface ProSociety {
  /** The society's short name, as it files — "STIM", "GEMA", "PRS for Music". */
  readonly name: string;
  /** The society's full legal/registered name, for the filing header. */
  readonly fullName: string;
  /** ISO 3166-1 alpha-2 of the territory the society administers. */
  readonly country: string;
  readonly countryName: string;
}

/**
 * One national society per country.
 *
 * Deliberately absent: **the United States and Canada**. The US has four
 * competing PROs (ASCAP, BMI, SESAC, GMR) and Canada's SOCAN coexists with
 * re:Sound for a different right — so "which society does this show report to"
 * is not answered by the country there; it is answered by each writer's
 * affiliation. Guessing one would send a filing to the wrong society, which is
 * worse than admitting we do not know. Unmapped countries fall through to `null`
 * and the screen says "PRO" rather than naming a society.
 */
const SOCIETY_BY_COUNTRY: Readonly<Record<string, ProSociety>> = {
  SE: {
    name: "STIM",
    fullName: "Svenska Tonsättares Internationella Musikbyrå",
    country: "SE",
    countryName: "Sweden",
  },
  DE: {
    name: "GEMA",
    fullName: "Gesellschaft für musikalische Aufführungs- und mechanische Vervielfältigungsrechte",
    country: "DE",
    countryName: "Germany",
  },
  GB: {
    name: "PRS for Music",
    fullName: "Performing Right Society for Music",
    country: "GB",
    countryName: "United Kingdom",
  },
  NO: { name: "TONO", fullName: "TONO SA", country: "NO", countryName: "Norway" },
  DK: { name: "Koda", fullName: "Koda", country: "DK", countryName: "Denmark" },
  FI: {
    name: "Teosto",
    fullName: "Säveltäjäin Tekijänoikeustoimisto Teosto ry",
    country: "FI",
    countryName: "Finland",
  },
  IS: {
    name: "STEF",
    fullName: "Samband tónskálda og eigenda flutningsréttar",
    country: "IS",
    countryName: "Iceland",
  },
  NL: {
    name: "Buma/Stemra",
    fullName: "Vereniging Buma / Stichting Stemra",
    country: "NL",
    countryName: "Netherlands",
  },
  BE: {
    name: "SABAM",
    fullName: "Société d'Auteurs Belge — Belgische Auteursmaatschappij",
    country: "BE",
    countryName: "Belgium",
  },
  FR: {
    name: "SACEM",
    fullName: "Société des auteurs, compositeurs et éditeurs de musique",
    country: "FR",
    countryName: "France",
  },
  ES: {
    name: "SGAE",
    fullName: "Sociedad General de Autores y Editores",
    country: "ES",
    countryName: "Spain",
  },
  PT: {
    name: "SPA",
    fullName: "Sociedade Portuguesa de Autores",
    country: "PT",
    countryName: "Portugal",
  },
  IT: {
    name: "SIAE",
    fullName: "Società Italiana degli Autori ed Editori",
    country: "IT",
    countryName: "Italy",
  },
  AT: {
    name: "AKM",
    fullName: "Staatlich genehmigte Gesellschaft der Autoren, Komponisten und Musikverleger",
    country: "AT",
    countryName: "Austria",
  },
  CH: {
    name: "SUISA",
    fullName: "SUISA Genossenschaft der Urheber und Verleger von Musik",
    country: "CH",
    countryName: "Switzerland",
  },
  PL: {
    name: "ZAiKS",
    fullName: "Stowarzyszenie Autorów ZAiKS",
    country: "PL",
    countryName: "Poland",
  },
  IE: {
    name: "IMRO",
    fullName: "Irish Music Rights Organisation",
    country: "IE",
    countryName: "Ireland",
  },
  EE: { name: "EAÜ", fullName: "Eesti Autorite Ühing", country: "EE", countryName: "Estonia" },
  LV: {
    name: "AKKA/LAA",
    fullName: "Autortiesību un komunicēšanās konsultāciju aģentūra",
    country: "LV",
    countryName: "Latvia",
  },
  LT: {
    name: "LATGA",
    fullName: "Lietuvos autorių teisių gynimo asociacijos agentūra",
    country: "LT",
    countryName: "Lithuania",
  },
};

/**
 * The IANA zones the platform actually books in, mapped to their country.
 *
 * Not exhaustive on purpose: a zone we cannot place returns `null`, which reads
 * as "we don't know your society" instead of naming the wrong one. This is the
 * throwaway half of the module — see the file header.
 */
const COUNTRY_BY_TIMEZONE: Readonly<Record<string, string>> = {
  "Europe/Stockholm": "SE",
  "Europe/Oslo": "NO",
  "Europe/Copenhagen": "DK",
  "Europe/Helsinki": "FI",
  "Atlantic/Reykjavik": "IS",
  "Europe/Berlin": "DE",
  "Europe/London": "GB",
  "Europe/Dublin": "IE",
  "Europe/Amsterdam": "NL",
  "Europe/Brussels": "BE",
  "Europe/Paris": "FR",
  "Europe/Madrid": "ES",
  "Europe/Lisbon": "PT",
  "Europe/Rome": "IT",
  "Europe/Vienna": "AT",
  "Europe/Zurich": "CH",
  "Europe/Warsaw": "PL",
  "Europe/Tallinn": "EE",
  "Europe/Riga": "LV",
  "Europe/Vilnius": "LT",
};

/** The country an IANA zone sits in, or `null` when the zone isn't one we book in. */
export function countryForTimezone(timezone: string | null | undefined): string | null {
  if (!timezone) return null;
  return COUNTRY_BY_TIMEZONE[timezone.trim()] ?? null;
}

/** The collecting society that administers a country, or `null` when unmapped. */
export function societyForCountry(country: string | null | undefined): ProSociety | null {
  if (!country) return null;
  return SOCIETY_BY_COUNTRY[country.trim().toUpperCase()] ?? null;
}

/**
 * The society a show reports to, derived from where the show happens.
 *
 * Territory first, account second (decisions.md #17): a Swedish operator playing
 * a Berlin room files with GEMA, not STIM, because the performance happened in
 * Germany. That is why this reads the EVENT's location and nothing else.
 */
export function societyForTimezone(timezone: string | null | undefined): ProSociety | null {
  return societyForCountry(countryForTimezone(timezone));
}
