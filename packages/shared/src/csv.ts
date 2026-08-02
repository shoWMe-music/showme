/**
 * Pure CSV builders (decisions #15). Export is generated CLIENT-SIDE from
 * already-fetched data, so these are dependency-free string builders — no API
 * endpoint. RFC 4180 quoting: a field is wrapped in double quotes (its own quotes
 * doubled) when it contains a comma, quote, CR, or LF.
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
