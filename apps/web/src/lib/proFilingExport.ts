import {
  type CsvColumn,
  type ProSociety,
  type SetlistWork,
  formatDurationClock,
  toCsv,
  totalDurationSeconds,
} from "@showme/shared";

/**
 * The performed-works filing, rendered into the formats an operator can send to a
 * collecting society TODAY — by hand, over the society's own portal or reporting
 * desk. Direct submission is a later integration; this is the honest interim.
 *
 * Pure string builders over data the Reports screen already holds. No API call,
 * no fetching — the same shape as `packages/shared/src/csv.ts`, whose `toCsv` does
 * the RFC-4180 quoting here (this is its first consumer in the repo).
 */

export interface FilingDocument {
  /** Null when the event's territory maps to no society we know (see `pro-societies` in `@showme/shared`). */
  readonly society: ProSociety | null;
  readonly eventTitle: string;
  /** ISO date (`2026-09-12`) or null. */
  readonly eventDate: string | null;
  readonly venueName: string | null;
  readonly timezone: string | null;
  /**
   * Every act with a setlist on the show, in the order the works run. The report
   * is about the PERFORMANCE, so a three-band night names three acts here and
   * each work below says which of them played it.
   */
  readonly performers: readonly string[];
  readonly works: readonly SetlistWork[];
}

export type FilingFormat = "csv" | "text" | "json";

export interface FilingFile {
  readonly fileName: string;
  readonly mediaType: string;
  readonly content: string;
}

/**
 * The cell written wherever the platform does not hold a value the society needs.
 *
 * WHY a loud literal instead of an empty cell: an empty column in a royalty
 * filing reads as "this work has no writers", which is a claim; `NOT CAPTURED`
 * reads as "shoWMe does not know", which is the truth. A silently short filing
 * costs the writers their money.
 */
const MISSING = "NOT CAPTURED";

/**
 * The fields every collecting society needs on a performed-works report and the
 * platform does NOT hold yet.
 *
 * The Reports screen's banner says "Writer shares and ISWC codes come from the
 * performer's repertoire" — there is no repertoire. `setlists.items` is an
 * untyped jsonb array and the seeded, only, shape is `{ title, duration }`;
 * `ISWC`, writer/composer names and share splits appear nowhere in the schema,
 * the API or the client. So the export names the gap in the file itself rather
 * than shipping a filing that merely looks complete.
 */
export const MISSING_FILING_FIELDS: readonly { field: string; why: string }[] = [
  {
    field: "Composer / author",
    why: "Setlist entries carry a title and a duration only — no writer credits.",
  },
  {
    field: "Writer shares (%)",
    why: "No repertoire or work-registration record exists to split a work between its writers.",
  },
  {
    field: "ISWC",
    why: "No work identifier is stored anywhere in shoWMe; the society matches on it.",
  },
];

/** The society's short name, or a neutral placeholder when the territory is unmapped. */
export function societyLabel(society: ProSociety | null): string {
  return society?.name ?? "PRO";
}

/** `stim-marlo-vance-album-release-2026-09-12` — society, event, date. */
function fileStem(filing: FilingDocument): string {
  const slug = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const parts = [
    slug(societyLabel(filing.society)),
    slug(filing.eventTitle || "performance"),
    filing.eventDate ?? "undated",
  ];
  return parts.filter(Boolean).join("-") || "performance-report";
}

/**
 * One row per performed work, each row self-describing (the event context repeats
 * on every line) because society importers ingest a flat works table, not a
 * header plus a body.
 */
function csvColumns(filing: FilingDocument): CsvColumn<SetlistWork>[] {
  const society = societyLabel(filing.society);
  return [
    { header: "Society", value: () => society },
    { header: "Territory", value: () => filing.society?.country ?? MISSING },
    { header: "Event", value: () => filing.eventTitle },
    { header: "Performance date", value: () => filing.eventDate ?? MISSING },
    { header: "Venue", value: () => filing.venueName ?? MISSING },
    // Per WORK, not per file: a support slot's songs must not be filed under the
    // headliner, and a society matches royalties to the act that performed.
    { header: "Performer", value: (work) => work.performer ?? MISSING },
    { header: "No.", key: "position" },
    { header: "Work title", key: "title" },
    { header: "Duration (mm:ss)", value: (work) => formatDurationClock(work.durationSeconds) },
    { header: "Duration (seconds)", value: (work) => work.durationSeconds ?? "" },
    // The three columns the society requires and shoWMe cannot fill. They are
    // present, named and loudly empty so the operator completes them here.
    { header: "Composer / author (NOT CAPTURED — add before filing)", value: () => MISSING },
    { header: "Writer share % (NOT CAPTURED — add before filing)", value: () => MISSING },
    { header: "ISWC (NOT CAPTURED — add before filing)", value: () => MISSING },
  ];
}

function buildCsv(filing: FilingDocument): string {
  return toCsv(csvColumns(filing), filing.works);
}

/** The emailable/printable version — what you paste to a reporting desk. */
function buildText(filing: FilingDocument): string {
  const society = societyLabel(filing.society);
  const total = totalDurationSeconds(filing.works);
  const lines: string[] = [
    `PERFORMED WORKS REPORT — ${society}`,
    "=".repeat(56),
    "",
    `Event         ${filing.eventTitle || "—"}`,
    `Date          ${filing.eventDate ?? "—"}`,
    `Venue         ${filing.venueName ?? "—"}`,
    `Territory     ${filing.society ? `${filing.society.countryName} (${filing.society.country})` : "—"}`,
    `Performers    ${filing.performers.length > 0 ? filing.performers.join(", ") : "—"}`,
    `Works         ${filing.works.length}`,
    `Total runtime ${total == null ? "—" : `${formatDurationClock(total)} (${Math.round(total / 60)} min)`}`,
    "",
    "SET",
    "-".repeat(56),
  ];

  // The act is printed on every line only when there is more than one to tell
  // apart — on a single-act night it would repeat the header for no reader.
  const namesActs = filing.performers.length > 1;
  for (const work of filing.works) {
    const clock = formatDurationClock(work.durationSeconds);
    const act = namesActs && work.performer ? `  [${work.performer}]` : "";
    lines.push(
      `${String(work.position).padStart(2, " ")}. ${work.title}${clock ? `  (${clock})` : ""}${act}`,
    );
  }

  lines.push(
    "",
    "INCOMPLETE — DO NOT FILE AS-IS",
    "-".repeat(56),
    `${society} needs the following for every work above. shoWMe does not hold`,
    "them yet, so they are NOT in this report and you must add them yourself:",
    "",
  );
  for (const gap of MISSING_FILING_FIELDS) {
    lines.push(`  * ${gap.field} — ${gap.why}`);
  }
  lines.push(
    "",
    "Nothing has been submitted. This file is an export; shoWMe has filed no",
    `report with ${society} and holds no submission on your behalf.`,
    "",
  );
  return lines.join("\n");
}

/** The machine-readable one — and the shape the later submission API will send. */
function buildJson(filing: FilingDocument): string {
  return `${JSON.stringify(
    {
      filing: {
        submitted: false,
        note: "Export only. shoWMe has not filed this report with any collecting society.",
        society: filing.society
          ? {
              name: filing.society.name,
              fullName: filing.society.fullName,
              country: filing.society.country,
            }
          : null,
      },
      performance: {
        event: filing.eventTitle,
        date: filing.eventDate,
        venue: filing.venueName,
        timezone: filing.timezone,
        performers: filing.performers,
      },
      works: filing.works.map((work) => ({
        position: work.position,
        title: work.title,
        durationSeconds: work.durationSeconds,
        performer: work.performer,
        // Explicit nulls, not omitted keys: a consumer must be able to see that
        // the field was asked for and is unknown, not assume it was irrelevant.
        composers: null,
        writerShares: null,
        iswc: null,
      })),
      incomplete: MISSING_FILING_FIELDS.map((gap) => ({ field: gap.field, reason: gap.why })),
    },
    null,
    2,
  )}\n`;
}

export const FILING_FORMATS: readonly {
  value: FilingFormat;
  label: string;
  /** One line on what this format is FOR — shown next to the picker. */
  purpose: string;
}[] = [
  {
    value: "csv",
    label: "CSV — works table (.csv)",
    purpose: "One row per work, openable in Excel or Numbers. The society's usual import shape.",
  },
  {
    value: "text",
    label: "Printable summary (.txt)",
    purpose: "Plain text you can print or paste into an email to the reporting desk.",
  },
  {
    value: "json",
    label: "JSON — structured (.json)",
    purpose: "Machine-readable, for a society portal or your own tooling.",
  },
];

const MEDIA_TYPES: Record<FilingFormat, string> = {
  // Charset is explicit: the set list carries non-ASCII titles and society names.
  csv: "text/csv;charset=utf-8",
  text: "text/plain;charset=utf-8",
  json: "application/json;charset=utf-8",
};

const EXTENSIONS: Record<FilingFormat, string> = { csv: "csv", text: "txt", json: "json" };

/** Render the filing into one downloadable file. Pure — no DOM, no fetching. */
export function buildFilingFile(filing: FilingDocument, format: FilingFormat): FilingFile {
  const content =
    format === "csv" ? buildCsv(filing) : format === "json" ? buildJson(filing) : buildText(filing);
  return {
    fileName: `${fileStem(filing)}.${EXTENSIONS[format]}`,
    mediaType: MEDIA_TYPES[format],
    content,
  };
}

/**
 * Push a built file to disk.
 *
 * A Blob + object URL rather than a `data:` href: a set list can run past the
 * URL-length ceiling some browsers still impose, and the object URL is revoked
 * immediately after the click so the string is not held for the session.
 */
export function downloadFilingFile(file: FilingFile): void {
  const blob = new Blob([file.content], { type: file.mediaType });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = file.fileName;
  window.document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
