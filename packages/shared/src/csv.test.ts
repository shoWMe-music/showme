import { describe, expect, it } from "vitest";
import { type CsvColumn, escapeCsvField, parseCsv, toCsv } from "./csv";

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

describe("parseCsv", () => {
  it("reads quoted commas, doubled quotes and embedded newlines", () => {
    const rows = parseCsv('Name,Note\r\n"Acme, Inc","said ""yes"""\r\nBand,"two\nlines"');
    expect(rows).toEqual([
      ["Name", "Note"],
      ["Acme, Inc", 'said "yes"'],
      ["Band", "two\nlines"],
    ]);
  });

  it("round-trips what toCsv writes", () => {
    const csv = toCsv(columns, [
      { name: "Acme, Inc", net: 300_000n, note: null },
      { name: "Band", net: -150_000n, note: 'said "yes"' },
    ]);
    expect(parseCsv(csv)).toEqual([
      ["Name", "Net", "Note"],
      ["Acme, Inc", "300000", ""],
      ["Band", "-150000", 'said "yes"'],
    ]);
  });

  it("survives a BOM, LF-only endings, and drops blank rows", () => {
    expect(parseCsv("﻿Name,Email\nA,a@x.test\n\n,,\nB,b@x.test\n")).toEqual([
      ["Name", "Email"],
      ["A", "a@x.test"],
      ["B", "b@x.test"],
    ]);
  });

  it("keeps a stray quote inside an unquoted cell literal", () => {
    expect(parseCsv('Riser,5" high')).toEqual([["Riser", '5" high']]);
  });

  it("returns no rows for an empty file", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\r\n")).toEqual([]);
  });

  it("keeps short and ragged rows as they are, for the caller to reject", () => {
    expect(parseCsv("Name,Email,Phone\nOnly a name\nA,b,c,d")).toEqual([
      ["Name", "Email", "Phone"],
      ["Only a name"],
      ["A", "b", "c", "d"],
    ]);
  });
});
