/**
 * Country -> collecting society (PRO).
 *
 * WHY this table exists: decisions.md #17 makes `country` the load-bearing stamp
 * for the things that are genuinely per-country — "VAT, PRO codes
 * (STIM/GEMA/PRS), currency" — and `countries.ts` beside it repeats that in its
 * own header. The country register is there; the PRO table it promises is this.
 *
 * WHY IT LIVES HERE NOW: it used to sit in `apps/web/src/lib/proSocieties.ts`,
 * whose own header said it BELONGED in `packages/shared` next to `countries.ts`
 * and was "parked here only because the screen needs it today". The screen is no
 * longer the only reader: the API names the society when it writes a
 * `performance_reports` row, and a filing whose society is decided in the browser
 * is a filing the server cannot vouch for.
 *
 * WHAT WENT AWAY IN THE MOVE: the IANA-zone -> country step. It existed because
 * "an event carries no country stamp" and the timezone was the only location
 * signal a client had. The territory is now resolved server-side from the venue
 * profile's recorded country (`routes/performing-rights.ts`), which is the
 * address itself rather than an inference from it, so the guess is deleted
 * exactly as its own comment asked.
 *
 * THIS IS NOT THE RATE. Which society covers a territory is a fact we can write
 * down; what that society charges is a published tariff a platform admin has to
 * read and enter (`performing_rights_rates`, migration 0018). Naming SACEM here
 * says nothing about French royalties, and nothing here should ever grow a
 * percentage.
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

/** The collecting society that administers a country, or `null` when unmapped. */
export function societyForCountry(country: string | null | undefined): ProSociety | null {
  if (!country) return null;
  return SOCIETY_BY_COUNTRY[country.trim().toUpperCase()] ?? null;
}
