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

vi.mock("@/lib/db", () => ({
  fetchPublicShareByToken: (...args: unknown[]) => mockFetchPublicShareByToken(...args),
  callConfirmShareParty: vi.fn(),
  getShareIdentity: vi.fn().mockReturnValue({ email: null, source: "none" }),
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
    },
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

  it("renders the Ticket Types section", async () => {
    await renderSection("ticketing");
    expect(screen.getByText("Ticket Types")).toBeInTheDocument();
    expect(screen.getByText("GA")).toBeInTheDocument();
  });

  it("renders the Production Schedule section", async () => {
    await renderSection("production-schedule");
    expect(screen.getByText("Production Schedule")).toBeInTheDocument();
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
});

describe("SharedEventPage — Agreement tab sections", () => {
  it("renders the Event Summary section", async () => {
    await renderSection("event-summary");
    expect(screen.getByText("Event Summary")).toBeInTheDocument();
  });

  it("renders the Agreements & Documents section", async () => {
    await renderSection("agreements-docs");
    expect(screen.getByText("Agreement Confirmation")).toBeInTheDocument();
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
});
