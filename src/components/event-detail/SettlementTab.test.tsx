import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// ── Mocks ─────────────────────────────────────────────────────────────────
// SettlementBreakdownCards has its own heavy deps; render a stub.
vi.mock("@/components/SettlementBreakdownCards", () => ({
  default: () => null,
}));

// Avoid pulling firebase storage into the jsdom test environment.
vi.mock("@/lib/firebaseStorageUpload", () => ({
  uploadUserBinary: vi.fn(),
  resolveStorageDownloadUrl: vi.fn(async (u: string) => u),
}));

// Stub out global fetch for DocumentPreviewDialog blob loader.
beforeEach(() => {
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" }),
  })) as unknown as typeof globalThis.fetch;
  // jsdom does not implement URL.createObjectURL.
  if (!("createObjectURL" in URL)) {
    Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:mock"), configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
  }
});

import { SettlementTab } from "./SettlementTab";
import type { Event as AppEvent, Settlement, PartyBreakdown } from "@/lib/models";

function makeProps() {
  const event = { id: "evt-1", name: "Test Event" } as unknown as AppEvent;
  const settlement: Settlement = {
    status: "open",
    approvals: [],
    revisions: [],
    comments: [
      {
        party: "Performer Agent",
        date: "2026-01-01",
        message: "Please see attached invoice.",
        attachments: [
          {
            name: "invoice.pdf",
            size: 2048,
            type: "application/pdf",
            fileUrl: "https://example.com/invoice.pdf",
          },
        ],
      },
    ],
    artistPayout: 0,
    promoterPayout: 0,
    venuePayout: 0,
    commissionPayouts: [],
  } as unknown as Settlement;
  const partyBreakdowns: PartyBreakdown[] = [];
  return {
    event,
    settlement,
    buildPayoutRows: () => [],
    settlementTotal: 0,
    updateSettlementStatus: vi.fn(),
    addComment: vi.fn(),
    generateShareLink: vi.fn(() => "https://share/foo"),
    currentUser: { name: "Operator", roles: ["promoter"] },
    partyBreakdowns,
    totalRevenue: 0,
    totalDeductions: 0,
    netRevenue: 0,
  };
}

describe("event-detail/SettlementTab — comment attachment preview", () => {
  it("opens the document preview dialog when a comment attachment is clicked", () => {
    const props = makeProps();
    render(<SettlementTab {...props} />);

    // Sanity: the attachment chip is rendered as a clickable button — not a
    // download anchor — so clicks open the inline preview.
    const attachment = screen.getByRole("button", { name: /invoice\.pdf/i });
    expect(attachment.tagName).toBe("BUTTON");

    fireEvent.click(attachment);

    // DocumentPreviewDialog opens; the filename appears inside the dialog.
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("invoice.pdf")).toBeInTheDocument();
  });

  it("renders attachments as buttons rather than download anchors", () => {
    const props = makeProps();
    render(<SettlementTab {...props} />);

    // Regression guard for the bug fix: attachments must NOT be raw
    // download anchors (which would force a browser download instead of
    // showing the inline preview).
    const possibleAnchor = screen.queryByRole("link", { name: /invoice\.pdf/i });
    expect(possibleAnchor).toBeNull();
  });
});
