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
      tickets: [{ provider: "Ticketmaster", url: "https://tickets.example.com/test" }],
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

  it("includes Ticket Information stat block (Tickets Sold / Net Revenue) when revenue exists", () => {
    // Empty ticketTypes no longer suppresses the stat block — sold/gross/net
    // are useful even with zero ticket types configured.
    const data = makeEventData({
      revenue: { eventId: "EVT-001", ticketsSold: 0, grossRevenue: 0, ticketFees: 0, tax: 0, refunds: 0, doorSales: 0, productionExpenses: 0, additionalCosts: 0 } as EventExportData["revenue"],
    });
    const csv = buildCSVContent([], new Set(), "all", data);
    expect(csv).toContain("Test Event");
    expect(csv).toContain("--- Ticket Information ---");
    expect(csv).toContain("Tickets Sold");
    expect(csv).toContain("Net Revenue");
  });

  it("includes settlement info", () => {
    const csv = buildCSVContent(["settlement"], new Set(["settlement-overview"]), "sections", makeEventData());
    expect(csv).toContain("Settlement");
    expect(csv).toContain("open");
  });

  it("includes event.notes in its own --- Notes --- section when picked", () => {
    const data = makeEventData({
      event: { ...makeEventData().event, notes: "Backstage door is around the back\nCode: 1234" } as EventExportData["event"],
    });
    const csv = buildCSVContent(["details"], new Set(["notes"]), "sections", data);
    expect(csv).toContain("--- Notes ---");
    expect(csv).toContain("Backstage door is around the back");
    expect(csv).toContain("Code: 1234");
    // event-info heading must NOT appear when only `notes` is picked
    expect(csv).not.toContain("--- Event Information ---");
  });

  it("omits the Notes section when event.notes is unset", () => {
    const csv = buildCSVContent(["details"], new Set(["notes"]), "sections", makeEventData());
    expect(csv).not.toContain("--- Notes ---");
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

  it("renders split row without 'undefined' when venueSplit is unset", () => {
    // The split row only renders when artistSplit OR venueSplit is truthy,
    // so seed one and leave the other unset to exercise interpolation safety.
    const data = makeEventData({
      deal: {
        eventId: "EVT-001", dealType: "split",
        artistGuarantee: 0, artistSplit: 70, promoterSplit: 0, venueSplit: undefined,
        organizerSplit: 0, artistCostSplit: 0, promoterCostSplit: 0, venueCostSplit: 0,
        organizerCostSplit: 0, venueRental: 0, commissions: [],
      } as unknown as EventExportData["deal"],
    });
    const csv = buildCSVContent(["details"], new Set(["deal-structure"]), "sections", data);
    expect(csv).toContain("Performer 70% / Venue 0%");
    expect(csv).not.toContain("undefined");
  });

  it("renders cost-split row without 'undefined' when promoterCostSplit/venueCostSplit are unset", () => {
    const data = makeEventData({
      deal: {
        eventId: "EVT-001", dealType: "split",
        artistGuarantee: 0, artistSplit: 0, promoterSplit: 0, venueSplit: 0,
        organizerSplit: 0, artistCostSplit: 25, promoterCostSplit: undefined, venueCostSplit: undefined,
        organizerCostSplit: 0, venueRental: 0, commissions: [],
      } as unknown as EventExportData["deal"],
    });
    const csv = buildCSVContent(["details"], new Set(["deal-structure"]), "sections", data);
    expect(csv).toContain("Performer 25% / Promoter 0% / Venue 0%");
    expect(csv).not.toContain("undefined");
  });

  it("renders Deal Type as N/A when dealType is unset (deal-structure section)", () => {
    const data = makeEventData({
      deal: {
        eventId: "EVT-001", dealType: undefined,
        artistGuarantee: 0, artistSplit: 0, promoterSplit: 0, venueSplit: 0,
        organizerSplit: 0, artistCostSplit: 0, promoterCostSplit: 0, venueCostSplit: 0,
        organizerCostSplit: 0, venueRental: 0, commissions: [],
      } as unknown as EventExportData["deal"],
    });
    const csv = buildCSVContent(["details"], new Set(["deal-structure"]), "sections", data);
    expect(csv).toContain(`"Deal Type","N/A"`);
    expect(csv).not.toContain(`"Deal Type","undefined"`);
    expect(csv).not.toContain(`"Deal Type","null"`);
  });

  it("renders Deal Type as N/A in Event Summary when dealType is unset", () => {
    const data = makeEventData({
      deal: {
        eventId: "EVT-001", dealType: undefined,
        artistGuarantee: 0, artistSplit: 0, promoterSplit: 0, venueSplit: 0,
        organizerSplit: 0, artistCostSplit: 0, promoterCostSplit: 0, venueCostSplit: 0,
        organizerCostSplit: 0, venueRental: 0, commissions: [],
      } as unknown as EventExportData["deal"],
    });
    const csv = buildCSVContent(["agreement"], new Set(["event-summary"]), "sections", data);
    expect(csv).toContain(`"Deal Type","N/A"`);
    expect(csv).not.toContain(`"Deal Type","undefined"`);
  });

  it("never emits 'undefined' for missing event-info / ticketing / settlement fields", () => {
    const data = makeEventData({
      event: {
        id: "EVT-002", name: "Sparse", date: "", venue: "",
        artist: undefined, operator: undefined, operatorType: undefined,
        capacity: undefined, eventStatus: undefined, tickets: undefined,
      } as unknown as EventExportData["event"],
      revenue: {
        eventId: "EVT-002", ticketsSold: 0, grossRevenue: 0, ticketFees: 0,
        tax: 0, refunds: 0, doorSales: 0, productionExpenses: 0, additionalCosts: 0,
        ticketTypes: [{ id: "t1", name: "GA", price: undefined as unknown as number, sold: undefined as unknown as number }],
      } as EventExportData["revenue"],
      settlement: {
        eventId: "EVT-002", promoterPayout: 0, artistPayout: 0, venuePayout: 0,
        commissionPayouts: [], status: undefined as unknown as "open",
        approvals: [], comments: [], revisions: [],
      } as EventExportData["settlement"],
    });
    const csv = buildCSVContent([], new Set(), "all", data);
    expect(csv).not.toContain("undefined");
    expect(csv).not.toContain('"null"');
  });

  it("never emits 'undefined' for sparse schedule / crew / tasks / private-notes", () => {
    const data = makeEventData({
      eventMeta: {
        crewScheduleItems: [{ id: "1", time: "", label: "Soundcheck", assignee: "" }],
        todos: [{ id: "1", title: "Print posters", completed: false, assignee: undefined } as unknown as EventExportData["eventMeta"]["todos"][0]],
        privateNotes: [{ id: "1", text: "Backstage code: 1234", assignee: undefined as unknown as string }],
        schedule: [{ id: "1", time: undefined as unknown as string, label: "Doors open" }],
        crew: [{ id: "1", name: "Pat", role: undefined, email: undefined, phone: undefined, collaborator: undefined } as unknown as EventExportData["eventMeta"]["crew"][0]],
        riders: [{ id: "1", type: undefined, name: "Hospitality" } as unknown as EventExportData["eventMeta"]["riders"][0]],
        agreements: [{ id: "1", type: undefined, name: "Performer Contract", status: undefined } as unknown as EventExportData["eventMeta"]["agreements"][0]],
      } as unknown as EventExportData["eventMeta"],
    });
    const csv = buildCSVContent([], new Set(), "all", data);
    expect(csv).not.toContain("undefined");
  });

  it("renders the Performers section from data.performers", () => {
    const data = makeEventData({
      performers: [
        {
          id: "c1", name: "Test Event — Headline", date: "2026-05-01",
          venue: "The Venue", artist: "Headline Act", capacity: 500,
          roomStage: "Main Stage", performerRoleTag: "headliner",
          eventStatus: "confirmed",
        } as unknown as EventExportData["event"],
        {
          id: "c2", name: "Test Event — Support", date: "2026-05-01",
          venue: "The Venue", artist: "Support Act", capacity: 500,
          performerRoleTag: "support", eventStatus: "confirmed",
        } as unknown as EventExportData["event"],
      ],
    });
    const csv = buildCSVContent(["details"], new Set(["performers"]), "sections", data);
    expect(csv).toContain("--- Performers ---");
    expect(csv).toContain("Headline Act");
    expect(csv).toContain("Support Act");
    expect(csv).toContain("Headliner");
    expect(csv).toContain("Support");
  });

  it("renders the Amenities section with translated labels and custom strings", () => {
    const data = makeEventData({
      event: {
        ...makeEventData().event,
        amenities: ["backline", "WiFi"],
        cateringNotes: "Vegan menu pre-show",
      } as EventExportData["event"],
    });
    const csv = buildCSVContent(["details"], new Set(["amenities"]), "sections", data);
    expect(csv).toContain("--- Amenities ---");
    expect(csv).toContain("Full Backline");
    expect(csv).toContain("WiFi");
    expect(csv).toContain("Vegan menu pre-show");
  });

  it("renders the Guest List section", () => {
    const data = makeEventData({
      eventMeta: {
        guestList: {
          totalTicketLimit: 12,
          perGuestTicketLimit: 1,
          guests: [
            { id: "g1", name: "Ori's Mom", tickets: 1, invitingParty: "Venue" },
            { id: "g2", name: "Ori's Uncle", tickets: 1, invitingParty: "Venue" },
          ],
        },
      } as unknown as EventExportData["eventMeta"],
    });
    const csv = buildCSVContent(["details"], new Set(["guest-list"]), "sections", data);
    expect(csv).toContain("--- Guest List ---");
    expect(csv).toContain("Ori's Mom");
    expect(csv).toContain("Ori's Uncle");
  });

  it("renders the Expenses section with a Total row", () => {
    const data = makeEventData({
      eventMeta: {
        expenses: [
          { id: "e1", label: "Catering", amount: 500, currency: "EUR" },
          { id: "e2", label: "Transport", amount: 120, currency: "EUR" },
        ],
      } as unknown as EventExportData["eventMeta"],
    });
    const csv = buildCSVContent(["details"], new Set(["expenses"]), "sections", data);
    expect(csv).toContain("--- Expenses ---");
    expect(csv).toContain("Catering");
    expect(csv).toContain("Transport");
    expect(csv).toContain(`"Total",`);
  });

  it("uses 'Event Schedule' heading (renamed from Production Schedule)", () => {
    const data = makeEventData({
      eventMeta: {
        schedule: [{ id: "s1", time: "18:00", label: "Doors open" }],
      } as unknown as EventExportData["eventMeta"],
    });
    const csv = buildCSVContent(["details"], new Set(["production-schedule"]), "sections", data);
    expect(csv).toContain("--- Event Schedule ---");
    expect(csv).not.toContain("--- Production Schedule ---");
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
