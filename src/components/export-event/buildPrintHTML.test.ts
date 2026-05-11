import { describe, it, expect } from "vitest";
import { buildPrintHTML } from "./buildPrintHTML";
import type { EventExportData } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEventData(overrides?: Partial<EventExportData>): EventExportData {
  return {
    event: {
      id: "EVT-001", name: "Test Gig", date: "2026-06-15",
      venue: "Blue Note", artist: "Jazz Trio", operator: "BookerX",
      operatorType: "promoter", capacity: 200, eventStatus: "confirmed",
      tickets: [{ provider: "Dice", url: "https://tickets.example.com/test" }],
    } as EventExportData["event"],
    deal: {
      eventId: "EVT-001", dealType: "split",
      artistGuarantee: 0, artistSplit: 70, promoterSplit: 20, venueSplit: 10,
      organizerSplit: 0, artistCostSplit: 0, promoterCostSplit: 50, venueCostSplit: 50,
      organizerCostSplit: 0, venueRental: 0, commissions: [],
    },
    revenue: {
      eventId: "EVT-001", ticketsSold: 150, grossRevenue: 7500,
      ticketFees: 200, tax: 500, refunds: 0, doorSales: 500,
      productionExpenses: 0, additionalCosts: 0,
      ticketTypes: [
        { id: "t1", name: "Early Bird", price: 40, sold: 50 },
        { id: "t2", name: "Regular", price: 55, sold: 100 },
      ],
    } as EventExportData["revenue"],
    settlement: {
      eventId: "EVT-001", promoterPayout: 1500, artistPayout: 5250,
      venuePayout: 750, commissionPayouts: [], status: "closed",
      approvals: [], comments: [], revisions: [],
    } as EventExportData["settlement"],
    eventMeta: {},
    currency: "SEK",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildPrintHTML", () => {
  it("produces valid HTML with doctype and body", () => {
    const html = buildPrintHTML(new Set(), new Set(), "all", makeEventData());
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain("<body>");
    expect(html).toContain("</body></html>");
  });

  it("includes event name and performer in header", () => {
    const html = buildPrintHTML(new Set(), new Set(), "all", makeEventData());
    expect(html).toContain("Test Gig");
    expect(html).toContain("Jazz Trio");
    expect(html).toContain("Blue Note");
  });

  it("includes event info table for level=all", () => {
    const html = buildPrintHTML(new Set(), new Set(), "all", makeEventData());
    expect(html).toContain("Event Information");
    expect(html).toContain("confirmed");
    expect(html).toContain("200"); // capacity
  });

  it("includes ticket types for level=all", () => {
    const html = buildPrintHTML(new Set(), new Set(), "all", makeEventData());
    expect(html).toContain("Early Bird");
    expect(html).toContain("Regular");
  });

  it("includes deal structure for level=all", () => {
    const html = buildPrintHTML(new Set(), new Set(), "all", makeEventData());
    expect(html).toContain("Financial Deal");
    expect(html).toContain("split");
  });

  it("shows settlement data for level=all", () => {
    const html = buildPrintHTML(new Set(), new Set(), "all", makeEventData());
    expect(html).toContain("Settlement");
    expect(html).toContain("closed");
  });

  it("respects section-level selection", () => {
    const html = buildPrintHTML(
      new Set(["details"]),
      new Set(["event-info"]),
      "sections",
      makeEventData(),
    );
    // event-info heading itself must render
    expect(html).toContain("<h2>Event Information</h2>");
    expect(html).not.toContain("Financial Deal");
    // Ticket Information heading must NOT render when only event-info is picked
    expect(html).not.toContain("<h2>Ticket Information</h2>");
  });

  it("respects tab-level selection", () => {
    const html = buildPrintHTML(
      new Set(["details"]),
      new Set(),
      "tabs",
      makeEventData(),
    );
    expect(html).toContain("Event Information");
    expect(html).toContain("Financial Deal");
    expect(html).not.toContain("Settlement");
  });

  it("includes schedule when subcollection data is provided (heading now reads 'Event Schedule')", () => {
    const data = makeEventData({
      eventMeta: {
        schedule: [
          { id: "s1", time: "18:00", label: "Doors open" },
          { id: "s2", time: "19:30", label: "Showtime" },
        ],
      } as unknown as EventExportData["eventMeta"],
    });
    const html = buildPrintHTML(new Set(), new Set(), "all", data);
    expect(html).toContain("Event Schedule");
    expect(html).toContain("Doors open");
    expect(html).toContain("Showtime");
    // Old heading must no longer appear (covers the rename regression).
    expect(html).not.toContain("Production Schedule");
  });

  it("includes crew when subcollection data is provided", () => {
    const data = makeEventData({
      eventMeta: {
        crew: [
          { id: "c1", name: "Sound Tech", role: "FOH", email: "tech@test.com", phone: "", collaborator: "Production" },
        ],
      } as unknown as EventExportData["eventMeta"],
    });
    const html = buildPrintHTML(new Set(), new Set(), "all", data);
    expect(html).toContain("Shared Team");
    expect(html).toContain("Sound Tech");
    expect(html).toContain("FOH");
  });

  it("includes agreements when subcollection data is provided", () => {
    const data = makeEventData({
      eventMeta: {
        agreements: [
          { id: "a1", name: "Performance Agreement", type: "contract", status: "signed" },
        ],
      } as unknown as EventExportData["eventMeta"],
    });
    const html = buildPrintHTML(new Set(), new Set(), "all", data);
    expect(html).toContain("Agreements");
    expect(html).toContain("Performance Agreement");
  });

  it("handles missing optional data gracefully", () => {
    const data = makeEventData({ eventMeta: {} });
    // Should not crash with empty eventMeta
    const html = buildPrintHTML(new Set(), new Set(), "all", data);
    expect(html).toContain("Test Gig");
    // No schedule/crew/riders sections
    expect(html).not.toContain("Production Schedule");
    expect(html).not.toContain("Shared Team");
  });

  it("uses the correct currency symbol", () => {
    const html = buildPrintHTML(new Set(), new Set(), "all", makeEventData());
    expect(html).toContain("SEK");
  });

  it("includes Event Summary block when agreement tab is selected", () => {
    const html = buildPrintHTML(
      new Set(["agreement"]),
      new Set(),
      "tabs",
      makeEventData(),
    );
    expect(html).toContain("Event Summary");
    // Performer guarantee should not appear because makeEventData has 0 guarantee
    expect(html).toContain("Test Gig");
    expect(html).toContain("Jazz Trio");
  });

  it("includes Event Summary with performer guarantee when present", () => {
    const data = makeEventData({
      deal: {
        ...makeEventData().deal,
        artistGuarantee: 7500,
      },
    });
    const html = buildPrintHTML(
      new Set(["agreement"]),
      new Set(),
      "tabs",
      data,
    );
    expect(html).toContain("Event Summary");
    expect(html).toContain("Performer Guarantee");
    // formatCurrency for SEK uses Swedish locale; check digits are present
    expect(html).toMatch(/7[\s.,]?500/);
  });

  it("renders the Budget Calculator section when budget data is provided", () => {
    const data = makeEventData({
      eventMeta: {
        budget: {
          revenueFields: [
            { id: "capacity", name: "Capacity", value: 200 },
            { id: "bar_revenue", name: "Bar revenue", value: 5000 },
          ],
          costFields: [
            { id: "artist_fee", name: "Performer fee", value: 3000 },
            { id: "venue_cost", name: "Venue cost", value: 1500 },
          ],
          resultFields: [
            { id: "total_revenue", name: "Total revenue", value: 12000 },
            { id: "profit_loss", name: "Profit / Loss", value: 4500 },
            { id: "breakeven_tickets", name: "Break-even ticket count", value: 87 },
            { id: "profit_margin", name: "Profit margin %", value: 37.5 },
          ],
        },
      } as unknown as EventExportData["eventMeta"],
    });
    const html = buildPrintHTML(new Set(["budget"]), new Set(), "tabs", data);
    expect(html).toContain("Budget Calculator");
    expect(html).toContain("Bar revenue");
    expect(html).toContain("Performer fee");
    expect(html).toContain("Venue cost");
    expect(html).toContain("Profit / Loss");
    // profit margin formatted with 1 decimal and percent sign
    expect(html).toContain("37.5%");
    // break-even rounded to integer
    expect(html).toContain(">87<");
    // Break-even Analysis section also uses the result fields
    expect(html).toContain("Break-even Analysis");
  });

  it("renders a placeholder when budget tab is selected without data", () => {
    const html = buildPrintHTML(
      new Set(["budget"]),
      new Set(),
      "tabs",
      makeEventData(),
    );
    expect(html).toContain("Budget Calculator");
    expect(html).toContain("No budget calculator data captured");
  });

  it("renders the PRO Fee Estimate when proEstimate is on eventMeta", () => {
    const data = makeEventData({
      eventMeta: {
        proEstimate: {
          pro: "stim",
          country: "SE",
          eventType: "live_concert",
          ticketPrice: 200,
          vatMode: "inclusive",
          expectedTickets: 150,
          compTickets: 0,
          venueCapacity: 200,
          estimatedFee: 600,
          manualOverride: false,
        },
      } as unknown as EventExportData["eventMeta"],
    });
    const html = buildPrintHTML(new Set(["budget"]), new Set(), "tabs", data);
    expect(html).toContain("PRO Fee Estimate");
    expect(html).toContain("Estimate only");
    expect(html).toContain("stim");
    expect(html).toContain("live_concert");
  });

  it("does not render budget sections when section-level selection excludes them", () => {
    const data = makeEventData({
      eventMeta: {
        budget: { revenueFields: [{ id: "capacity", name: "Capacity", value: 200 }] },
      } as unknown as EventExportData["eventMeta"],
    });
    const html = buildPrintHTML(
      new Set(["details"]),
      new Set(["event-info"]),
      "sections",
      data,
    );
    expect(html).not.toContain("Budget Calculator");
    expect(html).not.toContain("PRO Fee Estimate");
  });

  // Regression tests for Wave 4 Lane B: blank-PDF symptoms.
  // Subcollection data must reach buildPrintHTML via the merged eventMeta.
  it("renders ALL major sections in a typical full export", () => {
    const data = makeEventData({
      eventMeta: {
        schedule: [{ id: "s1", time: "18:00", label: "Doors" }],
        riders: [{ id: "r1", type: "technical", name: "Stage plot" }],
        agreements: [{ id: "a1", name: "Performance Agreement", type: "contract", status: "signed" }],
        crew: [{ id: "c1", name: "Sound Tech", role: "FOH", email: "tech@test.com", phone: "", collaborator: "Production" }],
        dealDescription: "All standard terms apply.",
      } as unknown as EventExportData["eventMeta"],
    });
    const html = buildPrintHTML(new Set(), new Set(), "all", data);
    // Every section that has data should be present.
    expect(html).toContain("Event Information");
    expect(html).toContain("Ticket Information");
    expect(html).toContain("Financial Deal");
    expect(html).toContain("Event Schedule");
    expect(html).toContain("Doors");
    expect(html).toContain("Riders");
    expect(html).toContain("Stage plot");
    expect(html).toContain("Event Summary");
    expect(html).toContain("Agreements & Documents");
    expect(html).toContain("Performance Agreement");
    expect(html).toContain("Terms & Conditions");
    expect(html).toContain("All standard terms apply.");
    expect(html).toContain("Shared Team");
    expect(html).toContain("Sound Tech");
    expect(html).toContain("Settlement");
  });

  it("renders Performers section from data.performers", () => {
    const data = makeEventData({
      performers: [
        {
          id: "c1", name: "Test Gig — Headline", date: "2026-06-15",
          venue: "Blue Note", artist: "Jazz Headliner", capacity: 200,
          roomStage: "Main Stage", performerRoleTag: "headliner",
          eventStatus: "confirmed",
        } as unknown as EventExportData["event"],
        {
          id: "c2", name: "Test Gig — Support", date: "2026-06-15",
          venue: "Blue Note", artist: "Opening Act", capacity: 200,
          performerRoleTag: "support", eventStatus: "confirmed",
        } as unknown as EventExportData["event"],
      ],
    });
    const html = buildPrintHTML(new Set(), new Set(), "all", data);
    expect(html).toContain("Performers");
    expect(html).toContain("Jazz Headliner");
    expect(html).toContain("Opening Act");
    expect(html).toContain("Headliner");
    expect(html).toContain("Support");
  });

  it("renders Notes as its own section (decoupled from event-info)", () => {
    const data = makeEventData({
      event: { ...makeEventData().event, notes: "Backstage door is around the back" } as EventExportData["event"],
    });
    const html = buildPrintHTML(
      new Set(["details"]),
      new Set(["notes"]),
      "sections",
      data,
    );
    expect(html).toContain("Notes");
    expect(html).toContain("Backstage door is around the back");
    expect(html).not.toContain("Event Information");
  });

  it("renders Amenities as its own section with translated labels and custom strings", () => {
    const data = makeEventData({
      event: {
        ...makeEventData().event,
        amenities: ["backline", "catering", "WiFi"],
        cateringNotes: "Vegan menu pre-show",
        accommodationNotes: "Hotel two blocks east",
      } as EventExportData["event"],
    });
    const html = buildPrintHTML(
      new Set(["details"]),
      new Set(["amenities"]),
      "sections",
      data,
    );
    expect(html).toContain("Amenities");
    expect(html).toContain("Full Backline"); // translated label
    expect(html).toContain("Catering"); // standard label
    expect(html).toContain("WiFi"); // custom verbatim
    expect(html).toContain("Vegan menu pre-show");
    expect(html).toContain("Hotel two blocks east");
    expect(html).not.toContain("Event Information");
  });

  it("renders Ticket Information stat block with Tickets Sold and Net Revenue", () => {
    const html = buildPrintHTML(
      new Set(["details"]),
      new Set(["ticketing"]),
      "sections",
      makeEventData(),
    );
    expect(html).toContain("Ticket Information");
    expect(html).toContain("Tickets Sold");
    expect(html).toContain("Gross Revenue");
    expect(html).toContain("Door Sales");
    expect(html).toContain("Net Revenue");
    expect(html).toContain("Ticket Types");
  });

  it("renders Guest List section", () => {
    const data = makeEventData({
      eventMeta: {
        guestList: {
          totalTicketLimit: 5,
          perGuestTicketLimit: 1,
          guests: [
            { id: "g1", name: "Alice", tickets: 1, invitingParty: "Venue" },
            { id: "g2", name: "Bob", tickets: 2, invitingParty: "Promoter" },
          ],
        },
      } as unknown as EventExportData["eventMeta"],
    });
    const html = buildPrintHTML(
      new Set(["details"]),
      new Set(["guest-list"]),
      "sections",
      data,
    );
    expect(html).toContain("Guest List");
    expect(html).toContain("Alice");
    expect(html).toContain("Bob");
    expect(html).toContain("Inviting Party");
  });

  it("renders Expenses section with a Total row", () => {
    const data = makeEventData({
      eventMeta: {
        expenses: [
          { id: "e1", label: "Catering", amount: 500, currency: "SEK" },
          { id: "e2", label: "Transport", amount: 250, currency: "SEK" },
        ],
      } as unknown as EventExportData["eventMeta"],
    });
    const html = buildPrintHTML(
      new Set(["details"]),
      new Set(["expenses"]),
      "sections",
      data,
    );
    expect(html).toContain("Expenses");
    expect(html).toContain("Catering");
    expect(html).toContain("Transport");
    expect(html).toContain("Total");
  });
});
