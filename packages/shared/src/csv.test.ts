import { describe, expect, it } from "vitest";
import { type CsvColumn, escapeCsvField, toCsv } from "./csv";

interface Row {
  name: string;
  net: bigint;
  note: string | null;
}

const columns: CsvColumn<Row>[] = [
  { key: "name", header: "Name" },
  { header: "Net", value: (row) => row.net.toString() },
  { key: "note", header: "Note" },
];

describe("csv builders", () => {
  it("escapes commas, quotes, and newlines per RFC 4180", () => {
    expect(escapeCsvField("plain")).toBe("plain");
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvField(null)).toBe("");
  });

  it("builds a CSV with headers, typed cells, and CRLF rows", () => {
    const csv = toCsv(columns, [
      { name: "Acme, Inc", net: 300_000n, note: null },
      { name: "Band", net: -150_000n, note: 'said "yes"' },
    ]);
    expect(csv).toBe(
      ["Name,Net,Note", '"Acme, Inc",300000,', 'Band,-150000,"said ""yes"""'].join("\r\n"),
    );
  });

  it("emits just the header for no rows", () => {
    expect(toCsv(columns, [])).toBe("Name,Net,Note");
  });
});
