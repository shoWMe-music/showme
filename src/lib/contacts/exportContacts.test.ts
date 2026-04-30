import { describe, it, expect } from "vitest";
import {
  CONTACT_CSV_HEADERS,
  buildContactsCsv,
  buildContactsCsvFilename,
  contactToCsvRow,
} from "./exportContacts";
import type { Contact } from "@/lib/models";

function makeContact(overrides: Partial<Contact> = {}): Contact {
  return {
    id: "P-1",
    name: "Test Venue",
    type: "venue",
    contacts: [
      { name: "Alice", email: "alice@example.com", phone: "+15551234" },
    ],
    iban: "NL91ABNA0417164300",
    bankName: "ABN AMRO",
    vatId: "NL123456789B01",
    address: "1 Test St",
    notes: "Some notes",
    ...overrides,
  };
}

describe("contactToCsvRow", () => {
  it("emits one row per contact with multi-value fields joined by '; '", () => {
    const c = makeContact({
      contacts: [
        { name: "Alice", email: "a@x.com", phone: "111" },
        { name: "Bob", email: "b@x.com", phone: "222" },
      ],
    });
    const row = contactToCsvRow(c);
    expect(row).toEqual([
      "Test Venue",
      "venue",
      "a@x.com; b@x.com",
      "111; 222",
      "NL91ABNA0417164300",
      "ABN AMRO",
      "NL123456789B01",
      "1 Test St",
      "Some notes",
    ]);
  });

  it("handles multi-type contacts", () => {
    const c = makeContact({ type: ["venue", "promoter"] });
    expect(contactToCsvRow(c)[1]).toBe("venue; promoter");
  });

  it("filters out empty emails and phones", () => {
    const c = makeContact({
      contacts: [
        { name: "Alice", email: "a@x.com", phone: "" },
        { name: "Empty", email: "", phone: "" },
        { name: "Phone-only", email: "", phone: "999" },
      ],
    });
    const row = contactToCsvRow(c);
    expect(row[2]).toBe("a@x.com");
    expect(row[3]).toBe("999");
  });

  it("returns empty string for missing optional fields", () => {
    const c = makeContact({
      iban: "",
      bankName: "",
      vatId: "",
      address: "",
      notes: "",
      contacts: [],
    });
    const row = contactToCsvRow(c);
    expect(row).toEqual(["Test Venue", "venue", "", "", "", "", "", "", ""]);
  });
});

describe("buildContactsCsv", () => {
  it("starts with the header row", () => {
    const csv = buildContactsCsv([]);
    const headerLine = csv.split("\n")[0];
    expect(headerLine).toBe(CONTACT_CSV_HEADERS.map(h => `"${h}"`).join(","));
  });

  it("escapes double quotes inside notes", () => {
    const c = makeContact({ notes: 'He said "hi"' });
    const csv = buildContactsCsv([c]);
    // RFC 4180 doubles the quote inside a quoted cell.
    expect(csv).toContain('"He said ""hi"""');
  });

  it("preserves embedded commas and newlines inside quotes", () => {
    const c = makeContact({ address: "1 Test St, Apt #2", notes: "line1\nline2" });
    const csv = buildContactsCsv([c]);
    expect(csv).toContain('"1 Test St, Apt #2"');
    expect(csv).toContain('"line1\nline2"');
  });

  it("emits one data row per contact", () => {
    const csv = buildContactsCsv([
      makeContact({ id: "P-1", name: "A" }),
      makeContact({ id: "P-2", name: "B" }),
    ]);
    expect(csv.split("\n")).toHaveLength(3); // header + 2 contacts
  });
});

describe("buildContactsCsvFilename", () => {
  it("uses ISO date for the filename", () => {
    const now = new Date("2026-04-30T10:00:00Z");
    expect(buildContactsCsvFilename(now)).toBe("contacts-2026-04-30.csv");
  });
});
