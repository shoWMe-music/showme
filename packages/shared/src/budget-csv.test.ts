import { describe, expect, it } from "vitest";
import { budgetToCsv } from "./budget-csv";
import { computeBudgetProjection } from "./budget-planning";

const major = (value: number) => BigInt(Math.round(value * 100));

const inputs = {
  ticketTiers: [{ unitAmount: major(60), quantity: 1280 }],
  averageBarSpend: major(5),
  capacity: 1600,
  otherRevenue: major(1000),
  customRevenue: [major(5000)],
  costs: [major(50000), major(6500)],
};

function csvFor(overrides: Partial<Parameters<typeof budgetToCsv>[0]> = {}) {
  return budgetToCsv({
    eventTitle: "Nils Frahm",
    currency: "EUR",
    ticketTiers: [{ name: "General Admission", unitAmount: major(60), quantity: 1280 }],
    averageBarSpend: major(5),
    capacity: 1600,
    otherRevenue: major(1000),
    customRevenue: [{ label: "Sponsorship", amount: major(5000) }],
    costs: [
      { label: "Performer fee", amount: major(50000) },
      { label: "Production cost", amount: major(6500) },
    ],
    projection: computeBudgetProjection(inputs),
    ...overrides,
  });
}

describe("budget CSV", () => {
  it("emits amounts as plain major-unit decimals a spreadsheet can sum", () => {
    const csv = csvFor();

    // Not "€50,000.00" — a thousands separator makes the cell text, not a number.
    expect(csv).toContain("Performer fee,,,50000.00,EUR");
    expect(csv).not.toContain("€");
    expect(csv).not.toContain("50,000");
  });

  it("keeps a ticket tier's price and count in their own columns", () => {
    const csv = csvFor();

    // unit 60.00 x 1280 = 76 800.00, all three present on one row.
    expect(csv).toContain("General Admission,60.00,1280,76800.00,EUR");
  });

  it("carries the custom revenue row under its own name", () => {
    expect(csvFor()).toContain("Sponsorship,,,5000.00,EUR");
  });

  it("agrees with the projection the screen shows", () => {
    const projection = computeBudgetProjection(inputs);
    const csv = csvFor();

    expect(csv).toContain(`Total revenue,,,${(Number(projection.totalRevenue) / 100).toFixed(2)}`);
    expect(csv).toContain(`Total costs,,,${(Number(projection.totalCosts) / 100).toFixed(2)}`);
  });

  it("leaves the currency column blank on a row that is not money", () => {
    const csv = csvFor();
    const marginRow = csv.split("\r\n").find((line) => line.includes("Profit margin %"));

    // …so nothing reads "37.8%" as an amount in EUR.
    expect(marginRow?.endsWith(",")).toBe(true);
    expect(marginRow).toContain("37.8%");
  });

  it("quotes a label containing a comma rather than splitting the row", () => {
    const csv = csvFor({ costs: [{ label: "Sound, lights and staging", amount: major(100) }] });
    const row = csv.split("\r\n").find((line) => line.includes("Sound"));

    expect(row).toContain('"Sound, lights and staging"');
    // 7 columns → 6 separators, plus the one comma inside the quoted label.
    expect(row?.split(",").length).toBe(8);
  });

  it("exports an unnamed tier rather than dropping revenue the screen counted", () => {
    const csv = csvFor({
      ticketTiers: [{ name: "  ", unitAmount: major(10), quantity: 5 }],
    });

    expect(csv).toContain("(unnamed ticket type),10.00,5,50.00,EUR");
  });

  it("names the processing fee an estimate, because nobody has paid it", () => {
    expect(csvFor()).toContain("Payment processing fees (estimate)");
  });

  it("respects a zero-exponent currency", () => {
    const csv = csvFor({ currency: "JPY", otherRevenue: 1000n });

    // JPY has no minor unit, so 1000 minor units is 1000 — not 10.00.
    expect(csv).toContain("Other revenue,,,1000,JPY");
  });
});
