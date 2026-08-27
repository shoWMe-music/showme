/**
 * Pure CSV builders and a reader (decisions #15). Export is generated
 * CLIENT-SIDE from already-fetched data, so these are dependency-free string
 * builders — no API endpoint. RFC 4180 quoting: a field is wrapped in double
 * quotes (its own quotes doubled) when it contains a comma, quote, CR, or LF.
 *
 * `parseCsv` is the inverse, added for the contacts import: a file a human
 * exported from a spreadsheet, not a file we wrote, so it has to survive a BOM,
 * LF-only line endings, blank lines and quoted commas.
 */

export interface CsvColumn<T> {
  /** The row property to read (ignored when `value` is given). */
  readonly key?: keyof T & string;
  readonly header: string;
  /** Optional projection for a computed/typed cell (e.g. bigint money → string). */
  readonly value?: (row: T) => unknown;
}

/** Escape one field per RFC 4180. `null`/`undefined` become the empty string. */
export function escapeCsvField(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Build an RFC-4180 CSV string from typed rows + a column spec. Rows are emitted
 * in order; the header comes from each column's `header`. CRLF line endings.
 */
export function toCsv<T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string {
  const cell = (column: CsvColumn<T>, row: T): unknown =>
    column.value ? column.value(row) : column.key != null ? row[column.key] : "";

  const header = columns.map((column) => escapeCsvField(column.header)).join(",");
  const body = rows.map((row) =>
    columns.map((column) => escapeCsvField(cell(column, row))).join(","),
  );
  return [header, ...body].join("\r\n");
}

/**
 * Read a CSV into rows of raw string cells — the inverse of `toCsv`.
 *
 * Deliberately lenient, because the input is a file someone saved out of Excel,
 * Numbers or Google Sheets rather than one we produced:
 *
 * - a leading **BOM** (Excel writes one) is stripped, so the first header does
 *   not silently become `﻿Name` and fail to match a column;
 * - **CRLF, LF and bare CR** all end a row (only Excel writes RFC 4180's CRLF);
 * - a double quote only *opens* a quoted field at the field's start, so a stray
 *   `5" riser` in an unquoted cell stays literal instead of swallowing the file;
 * - **blank rows are dropped** — a trailing newline and the empty lines people
 *   leave at the end of a sheet are not rows, and reporting them as rejected
 *   would bury the rows that genuinely are.
 *
 * Cells are returned untrimmed: trimming is the caller's decision, and a
 * leading space inside a quoted field may be intentional.
 */
export function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let insideQuotes = false;
  let index = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (index < source.length) {
    const character = source[index] as string;

    if (insideQuotes) {
      if (character === '"') {
        // A doubled quote is one literal quote; a single one closes the field.
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        insideQuotes = false;
        index += 1;
        continue;
      }
      field += character;
      index += 1;
      continue;
    }

    if (character === '"' && field === "") {
      insideQuotes = true;
      index += 1;
      continue;
    }
    if (character === ",") {
      endField();
      index += 1;
      continue;
    }
    if (character === "\r") {
      endRow();
      index += source[index + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (character === "\n") {
      endRow();
      index += 1;
      continue;
    }
    field += character;
    index += 1;
  }

  if (field !== "" || row.length > 0) endRow();
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}
