import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mocks ────────────────────────────────────────────────────────────────

const mockSearch: { sections?: string; tabs?: string; token?: string } = {};

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ eventId: "evt-1" }),
  useSearch: () => mockSearch,
  useNavigate: () => vi.fn(),
}));

const mockFetchPublicShareByToken = vi.fn();
const mockGetShareIdentity = vi.fn().mockReturnValue({ email: null, source: "none" });

vi.mock("@/lib/db", () => ({
  fetchPublicShareByToken: (...args: unknown[]) => mockFetchPublicShareByToken(...args),
  callConfirmShareParty: vi.fn(),
  getShareIdentity: (...args: unknown[]) => mockGetShareIdentity(...args),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

import SharedEventPage from "./SharedEventPage";

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function makeFullSnapshot() {
  return {
    event: {
      id: "evt-1",
      name: "Big Show",
      date: "2099-06-01",
      venue: "The Arena",
      artist: "The Headliners",
      operator: "Acme Promotions",
      operatorType: "promoter",
      capacity: 1000,
      tickets: [{ provider: "TicketMaster", url: "https://tickets.example.com/shared" }],
      eventStatus: "confirmed",
      notes: "Bring your own bottle.",
      amenities: ["backline", "catering", "WiFi"],
      cateringNotes: "Vegan menu pre-show.",
      accommodationNotes: "Hotel two blocks east.",
      isMultiPerformer: true,
    },
    deal: {
      eventId: "evt-1",
      dealType: "guarantee",
      artistGuarantee: 5000,
      venueRental: 1500,
      artistSplit: 80,
      venueSplit: 20,
      promoterSplit: 0,
      organizerSplit: 0,
      artistCostSplit: 0,
      promoterCostSplit: 50,
      venueCostSplit: 50,
      organizerCostSplit: 0,
      commissions: [],
    },
    revenue: {
      ticketTypes: [{ name: "GA", price: 25, sold: 500 }],
      ticketsSold: 500,
      grossRevenue: 12500,
      doorSales: 200,
      ticketFees: 100,
      tax: 50,
      refunds: 0,
    },
    performers: [
      {
        id: "evt-1-c1",
        name: "Big Show — Headline",
        date: "2099-06-01",
        venue: "The Arena",
        artist: "The Headliners",
        capacity: 1000,
        roomStage: "Main Hall",
        performerRoleTag: "headliner",
        eventStatus: "confirmed",
      },
      {
        id: "evt-1-c2",
        name: "Big Show — Support",
        date: "2099-06-01",
        venue: "The Arena",
        artist: "Opening Act",
        capacity: 1000,
        roomStage: "Main Hall",
        performerRoleTag: "support",
        eventStatus: "confirmed",
      },
    ],
    settlement: {
      eventId: "evt-1",
      status: "open",
      artistPayout: 5000,
      venuePayout: 1500,
      promoterPayout: 800,
      commissionPayouts: [],
      approvals: [],
      comments: [],
      revisions: [],
    },
    eventMeta: {
      dealDescription: "Standard terms apply.",
      schedule: [{ id: "s1", time: "18:00", label: "Doors open" }],
      crew: [{ id: "c1", name: "Sound Tech", role: "Engineer", collaborator: "Venue" }],
      agreements: [{ id: "a1", type: "terms", name: "Main Agreement", status: "signed" }],
      collaborators: [],
      riders: [{ id: "r1", type: "technical", name: "Stage Plot" }],
      crewScheduleItems: [{ id: "cs1", time: "16:00", label: "Crew call", assignee: "Sound Tech" }],
      todos: [{ id: "t1", title: "Confirm catering", completed: false, reminders: [], createdAt: "", assignee: "Manager" }],
      privateNotes: [{ id: "n1", text: "VIP guest list pending.", assignee: "Promoter" }],
      guestList: {
        totalTicketLimit: 12,
        perGuestTicketLimit: 1,
        guests: [
          { id: "g1", name: "Ori's Mom", tickets: 1, invitingParty: "Venue" },
          { id: "g2", name: "Ori's Uncle", tickets: 1, invitingParty: "Venue" },
        ],
      },
      expenses: [
        { id: "e1", label: "Catering", amount: 500, currency: "EUR" },
        { id: "e2", label: "Local transport", amount: 120, currency: "EUR" },
      ],
      proEstimate: {
        pro: "stim",
        country: "Sweden",
        eventType: "concert",
        ticketPrice: 25,
        vatMode: "inclusive",
        expectedTickets: 500,
        compTickets: 0,
        venueCapacity: 1000,
        estimatedFee: 600,
        manualOverride: false,
        manualValue: 0,
        confidence: "high",
        tariffVersion: "v1",
      },
      budget: {
        revenueFields: [{ name: "Tickets", value: 12500 }],
        costFields: [{ name: "Production", value: 4000 }],
        resultFields: [
          { id: "profit_loss", name: "Profit / Loss", value: 8500 },
          { id: "breakeven_tickets", name: "Break-even Tickets", value: 160 },
          { id: "profit_margin", name: "Margin", value: 68 },
        ],
      },
    },
    currency: "EUR",
  };
}

function mockSharePayload(overrides: Record<string, unknown> = {}) {
  mockFetchPublicShareByToken.mockResolvedValue({
    kind: "event_snapshot",
    eventId: "evt-1",
    recipients: [],
    snapshotData: makeFullSnapshot(),
    createdBy: "Tester",
    createdAt: "2099-01-01T00:00:00.000Z",
    creatorName: "Tester",
    ...overrides,
  });
}

async function renderSection(sectionId: string) {
  mockSearch.token = "tok-1";
  mockSearch.sections = sectionId;
  mockSearch.tabs = undefined;
  mockSharePayload();
  renderWithClient(<SharedEventPage />);
  // Wait until the loaded state shows the event header (h1).
  await waitFor(() =>
    expect(screen.getByRole("heading", { level: 1, name: /Big Show/ })).toBeInTheDocument(),
  );
}

async function renderTab(tabId: string) {
  mockSearch.token = "tok-1";
  mockSearch.tabs = tabId;
  mockSearch.sections = undefined;
  mockSharePayload();
  renderWithClient(<SharedEventPage />);
  await waitFor(() =>
    expect(screen.getByRole("heading", { level: 1, name: /Big Show/ })).toBeInTheDocument(),
  );
}

beforeEach(() => {
  mockFetchPublicShareByToken.mockReset();
  mockGetShareIdentity.mockReset();
  mockGetShareIdentity.mockReturnValue({ email: null, source: "none" });
  delete mockSearch.sections;
  delete mockSearch.tabs;
  delete mockSearch.token;
});

// ────────────────────────────────────────────────────────────────────────
// Per-section render tests — one per section ID in TAB_SECTIONS (16 total)
// ────────────────────────────────────────────────────────────────────────

describe("SharedEventPage — Details tab sections", () => {
  it("renders the Event Information section", async () => {
    await renderSection("event-info");
    expect(screen.getByText("Event Information")).toBeInTheDocument();
  });

  it("renders the Ticket Information section with stat cards and ticket-types table", async () => {
    await renderSection("ticketing");
    expect(screen.getByText("Ticket Information")).toBeInTheDocument();
    // Stat-card labels
    expect(screen.getByText("Tickets Sold")).toBeInTheDocument();
    expect(screen.getByText("Gross Revenue")).toBeInTheDocument();
    expect(screen.getByText("Door Sales")).toBeInTheDocument();
    expect(screen.getByText("Net Revenue")).toBeInTheDocument();
    // Ticket-types table below the stat cards
    expect(screen.getByText("Ticket Types")).toBeInTheDocument();
    expect(screen.getByText("GA")).toBeInTheDocument();
  });

  it("renders the Event Schedule section (id kept as production-schedule)", async () => {
    await renderSection("production-schedule");
    expect(screen.getByText("Event Schedule")).toBeInTheDocument();
    expect(screen.getByText("Doors open")).toBeInTheDocument();
  });

  it("renders the Riders & Documents section", async () => {
    await renderSection("riders");
    expect(screen.getByText("Riders & Documents")).toBeInTheDocument();
    expect(screen.getByText("Stage Plot")).toBeInTheDocument();
  });

  it("renders the Deal Structure section", async () => {
    await renderSection("deal-structure");
    expect(screen.getByText("Deal Structure")).toBeInTheDocument();
  });

  it("renders the Performers section from snapshot.performers", async () => {
    await renderSection("performers");
    expect(screen.getByText("Performers")).toBeInTheDocument();
    // "The Headliners" also appears in the header (event.artist), so use getAllByText.
    expect(screen.getAllByText("The Headliners").length).toBeGreaterThan(0);
    expect(screen.getByText("Opening Act")).toBeInTheDocument();
    expect(screen.getByText("Headliner")).toBeInTheDocument();
    expect(screen.getByText("Support")).toBeInTheDocument();
  });

  it("renders the Notes section independently of event-info", async () => {
    await renderSection("notes");
    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByText("Bring your own bottle.")).toBeInTheDocument();
    // Event-info heading must NOT appear when only `notes` is picked
    expect(screen.queryByText("Event Information")).not.toBeInTheDocument();
  });

  it("renders the Amenities section independently of event-info", async () => {
    await renderSection("amenities");
    expect(screen.getByText("Amenities")).toBeInTheDocument();
    // Standard key → label
    expect(screen.getByText("Full Backline")).toBeInTheDocument();
    expect(screen.getByText("Catering")).toBeInTheDocument();
    // Custom string renders verbatim
    expect(screen.getByText("WiFi")).toBeInTheDocument();
    expect(screen.getByText("Vegan menu pre-show.")).toBeInTheDocument();
    expect(screen.getByText("Hotel two blocks east.")).toBeInTheDocument();
    // Event-info heading must NOT appear when only `amenities` is picked
    expect(screen.queryByText("Event Information")).not.toBeInTheDocument();
  });

  it("renders the Guest List section", async () => {
    await renderSection("guest-list");
    expect(screen.getByText("Guest List")).toBeInTheDocument();
    expect(screen.getByText("Ori's Mom")).toBeInTheDocument();
    expect(screen.getByText("Ori's Uncle")).toBeInTheDocument();
    expect(screen.getByText(/2 guests/)).toBeInTheDocument();
  });

  it("renders the Expenses section with a total row", async () => {
    await renderSection("expenses");
    expect(screen.getByText("Expenses")).toBeInTheDocument();
    expect(screen.getByText("Catering")).toBeInTheDocument();
    expect(screen.getByText("Local transport")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
  });
});

describe("SharedEventPage — Agreement tab sections", () => {
  it("renders the Event Summary section", async () => {
    await renderSection("event-summary");
    expect(screen.getByText("Event Summary")).toBeInTheDocument();
  });

  it("renders the Agreements & Documents section", async () => {
    await renderSection("agreements-docs");
    // The section's own heading + the agreement entry it lists.
    expect(screen.getByText("Agreements & Documents")).toBeInTheDocument();
    expect(screen.getByText("Main Agreement")).toBeInTheDocument();
  });

  it("renders the Terms & Conditions section", async () => {
    await renderSection("terms");
    expect(screen.getByText("Terms & Conditions")).toBeInTheDocument();
    expect(screen.getByText("Standard terms apply.")).toBeInTheDocument();
  });
});

describe("SharedEventPage — Crew tab sections", () => {
  it("renders the Shared Team section", async () => {
    await renderSection("shared-team");
    expect(screen.getByText("Team")).toBeInTheDocument();
    expect(screen.getByText("Sound Tech")).toBeInTheDocument();
  });

  it("renders the Team Schedule section", async () => {
    await renderSection("schedule");
    expect(screen.getByText("Team Schedule")).toBeInTheDocument();
    expect(screen.getByText("Crew call")).toBeInTheDocument();
  });

  it("renders the Tasks section", async () => {
    await renderSection("tasks");
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Confirm catering")).toBeInTheDocument();
  });

  it("renders the Private Notes section", async () => {
    await renderSection("private-notes");
    expect(screen.getByText("Private Notes")).toBeInTheDocument();
    expect(screen.getByText("VIP guest list pending.")).toBeInTheDocument();
  });
});

describe("SharedEventPage — Settlement tab sections", () => {
  it("renders the Settlement Overview section", async () => {
    await renderSection("settlement-overview");
    expect(screen.getByText("Settlement")).toBeInTheDocument();
  });
});

describe("SharedEventPage — Budget tab sections", () => {
  it("renders the Budget Calculator section", async () => {
    await renderSection("budget-calculator");
    expect(screen.getByText("Budget Calculator")).toBeInTheDocument();
    expect(screen.getByText("Tickets")).toBeInTheDocument();
  });

  it("renders the Break-even Analysis section", async () => {
    await renderSection("budget-charts");
    expect(screen.getByText("Break-even Analysis")).toBeInTheDocument();
  });

  it("renders the PRO Fee Estimate section", async () => {
    await renderSection("pro-estimator");
    expect(screen.getByText("PRO Fee Estimate")).toBeInTheDocument();
  });
});

// ────────────────────────────────────────────────────────────────────────
// Tab-level mapping must include "budget" so selecting that tab renders
// its three child sections.
// ────────────────────────────────────────────────────────────────────────

describe("SharedEventPage — tab-to-sections mapping", () => {
  it("renders all three budget sections when tabs=budget is selected", async () => {
    await renderTab("budget");
    expect(screen.getByText("Budget Calculator")).toBeInTheDocument();
    expect(screen.getByText("Break-even Analysis")).toBeInTheDocument();
    expect(screen.getByText("PRO Fee Estimate")).toBeInTheDocument();
  });

  it("renders the new Details-tab sections when tabs=details is selected", async () => {
    await renderTab("details");
    // The newly-added section ids all live under the `details` tab and must
    // render together so the picker's "share whole tab" path stays useful.
    expect(screen.getByText("Event Information")).toBeInTheDocument();
    expect(screen.getByText("Performers")).toBeInTheDocument();
    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByText("Amenities")).toBeInTheDocument();
    expect(screen.getByText("Ticket Information")).toBeInTheDocument();
    expect(screen.getByText("Event Schedule")).toBeInTheDocument();
    expect(screen.getByText("Guest List")).toBeInTheDocument();
    expect(screen.getByText("Expenses")).toBeInTheDocument();
    expect(screen.getByText("Deal Structure")).toBeInTheDocument();
  });
});

// ────────────────────────────────────────────────────────────────────────
// Agreement Confirmation widget identity gate — the widget renders only
// when the share's verified email matches a collaborator on the event.
// ────────────────────────────────────────────────────────────────────────

function mockShareWithCollaborators() {
  const snap = makeFullSnapshot();
  // Two collaborators with known emails so we can test match / no-match / no-email.
  snap.eventMeta.collaborators = [
    {
      id: "col-perf",
      email: "performer@example.com",
      eventRole: "performer",
      role: "Performer",
      name: "The Headliners",
      status: "active",
      invitedAt: "",
    },
    {
      id: "col-venue",
      email: "venue@example.com",
      eventRole: "venue",
      role: "Venue",
      name: "The Arena",
      status: "active",
      invitedAt: "",
    },
  ] as unknown as typeof snap.eventMeta.collaborators;
  mockSharePayload({ snapshotData: snap });
}

describe("SharedEventPage — Agreement Confirmation identity gate", () => {
  it("hides the widget when the viewer has no verified email (public share)", async () => {
    mockSearch.token = "tok-1";
    mockSearch.sections = "agreements-docs";
    mockGetShareIdentity.mockReturnValue({ email: null, source: "none" });
    mockShareWithCollaborators();
    renderWithClient(<SharedEventPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: /Big Show/ })).toBeInTheDocument(),
    );
    expect(screen.queryByText("Agreement Confirmation")).not.toBeInTheDocument();
  });

  it("hides the widget when the verified email does not match any collaborator", async () => {
    mockSearch.token = "tok-1";
    mockSearch.sections = "agreements-docs";
    mockGetShareIdentity.mockReturnValue({ email: "stranger@example.com", source: "otp" });
    mockShareWithCollaborators();
    renderWithClient(<SharedEventPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: /Big Show/ })).toBeInTheDocument(),
    );
    expect(screen.queryByText("Agreement Confirmation")).not.toBeInTheDocument();
  });

  it("renders the widget when the verified email matches a collaborator's email", async () => {
    mockSearch.token = "tok-1";
    mockSearch.sections = "agreements-docs";
    mockGetShareIdentity.mockReturnValue({ email: "performer@example.com", source: "otp" });
    mockShareWithCollaborators();
    renderWithClient(<SharedEventPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: /Big Show/ })).toBeInTheDocument(),
    );
    expect(screen.getByText("Agreement Confirmation")).toBeInTheDocument();
    // The viewer is the Performer collaborator — only their own Confirm button
    // should render, not the Venue's.
    expect(screen.getByRole("button", { name: /Confirm Agreement/i })).toBeInTheDocument();
  });

  it("hides the widget when the event has no collaborators at all", async () => {
    // Even with a verified email, without collaborators there's no email→party
    // mapping to verify against, so the widget must stay hidden.
    mockSearch.token = "tok-1";
    mockSearch.sections = "agreements-docs";
    mockGetShareIdentity.mockReturnValue({ email: "anyone@example.com", source: "otp" });
    const snap = makeFullSnapshot();
    snap.eventMeta.collaborators = [];
    mockSharePayload({ snapshotData: snap });
    renderWithClient(<SharedEventPage />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1, name: /Big Show/ })).toBeInTheDocument(),
    );
    expect(screen.queryByText("Agreement Confirmation")).not.toBeInTheDocument();
  });
});

// ────────────────────────────────────────────────────────────────────────
// Snapshot freshness caption — recipients need to understand the share is
// frozen at creation time. The caption sits under the share-metadata strip.
// ────────────────────────────────────────────────────────────────────────

describe("SharedEventPage — freshness caption", () => {
  it("shows the snapshot-frozen caption under the share metadata", async () => {
    await renderSection("event-info");
    expect(
      screen.getByText(/Snapshot — does not update automatically/i),
    ).toBeInTheDocument();
  });
});
