import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────────────
vi.mock("@/components/SettlementBreakdownCards", () => ({
  default: () => null,
}));

// settlementExport pulls in jspdf — heavy and not relevant here.
vi.mock("./settlementExport", () => ({
  exportSettlementCSV: vi.fn(),
  exportSettlementPDF: vi.fn(),
}));

vi.mock("@/lib/firebaseStorageUpload", () => ({
  uploadUserBinary: vi.fn(),
  resolveStorageDownloadUrl: vi.fn(async (u: string) => u),
}));

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" }),
  })) as unknown as typeof globalThis.fetch;
  if (!("createObjectURL" in URL)) {
    Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:mock"), configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
  }
});

import { SettlementTab } from "./SettlementTab";
import type {
  Event as AppEvent, Settlement, PartyBreakdown, DealStructure, TicketRevenue,
} from "@/lib/models";

function makeProps() {
  const event = { id: "evt-1", name: "Test Event", operatorType: "promoter" } as unknown as AppEvent;
  const settlement: Settlement = {
    status: "open",
    approvals: [],
    revisions: [],
    comments: [
      {
        party: "Performer Agent",
        date: "2026-01-01",
        message: "Receipt attached.",
        attachments: [
          {
            name: "receipt.pdf",
            size: 1024,
            type: "application/pdf",
            fileUrl: "https://example.com/receipt.pdf",
          },
        ],
      },
    ],
    artistPayout: 0,
    promoterPayout: 0,
    venuePayout: 0,
    commissionPayouts: [],
  } as unknown as Settlement;

  return {
    event,
    deal: { dealType: "guarantee" } as unknown as DealStructure,
    revenue: { grossRevenue: 0, doorSales: 0 } as unknown as TicketRevenue,
    settlement,
    buildPayoutRows: () => [],
    settlementTotal: 0,
    updateSettlementStatus: vi.fn(),
    addComment: vi.fn(),
    generateShareLink: vi.fn(() => "https://share/foo"),
    currentUser: { name: "Operator", roles: ["promoter"] },
    updateRevenue: vi.fn(),
    partyBreakdowns: [] as PartyBreakdown[],
    totalRevenue: 0,
    totalDeductions: 0,
    netRevenue: 0,
  };
}

describe("settlements/SettlementTab — comment attachment preview", () => {
  it("opens the document preview dialog when an attachment is clicked", () => {
    render(<SettlementTab {...makeProps()} />);

    const attachment = screen.getByRole("button", { name: /receipt\.pdf/i });
    expect(attachment.tagName).toBe("BUTTON");

    fireEvent.click(attachment);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("receipt.pdf")).toBeInTheDocument();
  });

  it("does not render attachments as download anchors", () => {
    render(<SettlementTab {...makeProps()} />);
    expect(screen.queryByRole("link", { name: /receipt\.pdf/i })).toBeNull();
  });
});
