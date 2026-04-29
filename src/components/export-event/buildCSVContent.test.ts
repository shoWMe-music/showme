import { describe, it, expect } from "vitest";
import { buildCSVContent } from "./buildCSVContent";
import type { EventExportData } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEventData(overrides?: Partial<EventExportData>): EventExportData {
  return {
    event: {
      id: "EVT-001", name: "Test Event", date: "2026-05-01",
      venue: "The Venue", artist: "The Artist", operator: "Operator",
      operatorType: "venue", capacity: 500, eventStatus: "confirmed",
      ticketingProvider: "Ticketmaster",
    } as EventExportData["event"],
    deal: {
      eventId: "EVT-001", dealType: "guarantee",
      artistGuarantee: 5000, artistSplit: 80, promoterSplit: 10, venueSplit: 10,
      organizerSplit: 0, artistCostSplit: 0, promoterCostSplit: 50, venueCostSplit: 50,
      organizerCostSplit: 0, venueRental: 1000, commissions: [],
    },
    revenue: {
      eventId: "EVT-001", ticketsSold: 300, grossRevenue: 15000,
      ticketFees: 500, tax: 1000, refunds: 200, doorSales: 0,
      productionExpenses: 0, additionalCosts: 0,
      ticketTypes: [
        { id: "t1", name: "General", price: 50, sold: 300 },
      ],
    } as EventExportData["revenue"],
    settlement: {
      eventId: "EVT-001", promoterPayout: 0, artistPayout: 5000,
      venuePayout: 1000, commissionPayouts: [], status: "open",
      approvals: [], comments: [], revisions: [],
    } as EventExportData["settlement"],
    eventMeta: {},
    currency: "EUR",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildCSVContent", () => {
  it("includes event header info for level=all", () => {
    const csv = buildCSVContent([], new Set(), "all", makeEventData());
    expect(csv).toContain("Test Event");
    expect(csv).toContain("The Venue");
    expect(csv).toContain("The Artist");
  });

  it("includes deal structure when details tab selected", () => {
    const csv = buildCSVContent(["details"], new Set(["deal-structure"]), "sections", makeEventData());
    expect(csv).toContain("guarantee");
  });

  it("includes ticket info for level=all", () => {
    const csv = buildCSVContent([], new Set(), "all", makeEventData());
    expect(csv).toContain("General");
    expect(csv).toContain("50");
    expect(csv).toContain("300");
  });

  it("excludes sections not selected at section level", () => {
    const csv = buildCSVContent(["details"], new Set(["event-info"]), "sections", makeEventData());
    // event-info included
    expect(csv).toContain("Event Information");
    // ticketing not included
    expect(csv).not.toContain("Ticket Information");
  });

  it("includes all sections for a tab when level=tabs", () => {
    const csv = buildCSVContent(["details"], new Set(), "tabs", makeEventData());
    expect(csv).toContain("Event Information");
    expect(csv).toContain("Financial Deal");
  });

  it("handles empty revenue ticket types gracefully", () => {
    const data = makeEventData({
      revenue: { eventId: "EVT-001", ticketsSold: 0, grossRevenue: 0, ticketFees: 0, tax: 0, refunds: 0, doorSales: 0, productionExpenses: 0, additionalCosts: 0 } as EventExportData["revenue"],
    });
    const csv = buildCSVContent([], new Set(), "all", data);
    // Should not crash, should still contain event info
    expect(csv).toContain("Test Event");
    expect(csv).not.toContain("Ticket Information");
  });

  it("includes settlement info", () => {
    const csv = buildCSVContent(["settlement"], new Set(["settlement-overview"]), "sections", makeEventData());
    expect(csv).toContain("Settlement");
    expect(csv).toContain("open");
  });

  it("renders the Event Summary section under the agreement tab", () => {
    const csv = buildCSVContent(["agreement"], new Set(), "tabs", makeEventData());
    expect(csv).toContain("--- Event Summary ---");
    expect(csv).toContain("Test Event");
    expect(csv).toContain("guarantee"); // deal type
  });

  it("renders the Budget Calculator section when budget data is on eventMeta", () => {
    const data = makeEventData({
      eventMeta: {
        budget: {
          revenueFields: [{ id: "bar_revenue", name: "Bar revenue", value: 5000 }],
          costFields: [{ id: "artist_fee", name: "Performer fee", value: 3000 }],
          resultFields: [
            { id: "profit_loss", name: "Profit / Loss", value: 2000 },
            { id: "breakeven_tickets", name: "Break-even ticket count", value: 87 },
          ],
        },
      } as unknown as EventExportData["eventMeta"],
    });
    const csv = buildCSVContent(["budget"], new Set(), "tabs", data);
    expect(csv).toContain("--- Budget Calculator ---");
    expect(csv).toContain("Bar revenue");
    expect(csv).toContain("Performer fee");
    expect(csv).toContain("--- Break-even Analysis ---");
    expect(csv).toContain("Break-even Ticket Count");
  });

  it("renders the PRO estimate when proEstimate is on eventMeta", () => {
    const data = makeEventData({
      eventMeta: {
        proEstimate: {
          pro: "gema",
          country: "DE",
          eventType: "live_concert",
          ticketPrice: 50,
          vatMode: "inclusive",
          expectedTickets: 200,
          compTickets: 5,
          venueCapacity: 250,
          estimatedFee: 800,
          manualOverride: false,
        },
      } as unknown as EventExportData["eventMeta"],
    });
    const csv = buildCSVContent(["budget"], new Set(), "tabs", data);
    expect(csv).toContain("--- PRO Fee Estimate ---");
    expect(csv).toContain("gema");
    expect(csv).toContain("live_concert");
  });
});
