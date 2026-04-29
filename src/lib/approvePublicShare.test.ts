/**
 * Unit tests for approvePublicShare (Bug 2 — settlement share approval).
 *
 * Verifies that approving a settlement-review share writes BOTH:
 *   1. the share doc (approved=true, approvedAt)
 *   2. the source settlement doc (approvals[party] = { approved: true, date })
 *
 * Mocks the Firestore SDK following the pattern used in db.integration.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSetDoc = vi.fn().mockResolvedValue(undefined);
const mockUpdateDoc = vi.fn().mockResolvedValue(undefined);
const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();
const mockDoc = vi.fn().mockImplementation((...args: unknown[]) => ({ __path: args.slice(1).join("/") }));
const mockCollection = vi.fn().mockReturnValue({});
const mockQuery = vi.fn().mockReturnValue({});
const mockWhere = vi.fn().mockReturnValue({});
const mockOrderBy = vi.fn().mockReturnValue({});
const mockServerTimestamp = vi.fn().mockReturnValue("TIMESTAMP");

// In-memory store for transaction reads/writes so we can assert what was written.
const txWrites: Array<{ kind: "set" | "update"; ref: any; data: Record<string, unknown> }> = [];
const txReads: any[] = [];

const mockRunTransaction = vi.fn(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
  const tx = {
    get: async (ref: any) => {
      txReads.push(ref);
      // Default behavior: return existing settlement with no approvals.
      return {
        exists: () => true,
        data: () => ({ approvals: [] }),
      };
    },
    set: (ref: any, data: Record<string, unknown>) => {
      txWrites.push({ kind: "set", ref, data });
    },
    update: (ref: any, data: Record<string, unknown>) => {
      txWrites.push({ kind: "update", ref, data });
    },
  };
  await fn(tx);
});

vi.mock("firebase/firestore", () => ({
  getFirestore: vi.fn(),
  doc: (...args: unknown[]) => mockDoc(...args),
  collection: (...args: unknown[]) => mockCollection(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  serverTimestamp: () => mockServerTimestamp(),
  deleteDoc: vi.fn().mockResolvedValue(undefined),
  runTransaction: (...args: any[]) => mockRunTransaction(args[0], args[1]),
  Timestamp: { now: () => ({ toDate: () => new Date() }) },
}));

vi.mock("@/integrations/firebase/app", () => ({
  getFirestoreDb: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/firebaseAuth", () => ({
  getAuthClient: vi.fn().mockReturnValue({
    currentUser: { uid: "test-user-123", email: "test@example.com" },
  }),
}));

// Import after mocks
import { approvePublicShare } from "./db";

beforeEach(() => {
  vi.clearAllMocks();
  txWrites.length = 0;
  txReads.length = 0;
});

describe("approvePublicShare (Bug 2)", () => {
  it("writes to BOTH share doc and settlement doc when share has eventId", async () => {
    // First getDoc reads the share doc to find eventId.
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ kind: "settlement_review", eventId: "EVT-1", parties: [] }),
    });
    // refreshShareTokenIfExists reads share doc again, then event doc, then subdocs.
    mockGetDoc.mockResolvedValue({ exists: () => false }); // make refresh bail out

    await approvePublicShare("review-EVT-1", "Performer");

    // Should have run a transaction
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);

    // Inside the transaction we must have written to BOTH the settlement doc and the share doc
    const settlementWrite = txWrites.find(
      (w) => w.kind === "set" && Array.isArray((w.data as any).approvals),
    );
    const shareUpdate = txWrites.find(
      (w) => w.kind === "update" && (w.data as any).approved === true,
    );

    expect(settlementWrite).toBeDefined();
    expect(shareUpdate).toBeDefined();

    const approvals = (settlementWrite!.data as any).approvals as { party: string; approved: boolean; date?: string }[];
    expect(approvals).toHaveLength(1);
    expect(approvals[0].party).toBe("Performer");
    expect(approvals[0].approved).toBe(true);
    expect(approvals[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("merges approval into existing approvals array", async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ kind: "settlement_review", eventId: "EVT-2" }),
    });
    mockGetDoc.mockResolvedValue({ exists: () => false });

    // Override transaction.get to return existing approvals
    mockRunTransaction.mockImplementationOnce(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        get: async () => ({
          exists: () => true,
          data: () => ({
            approvals: [
              { party: "Venue", approved: true, date: "2026-04-01" },
            ],
          }),
        }),
        set: (ref: any, data: Record<string, unknown>) => {
          txWrites.push({ kind: "set", ref, data });
        },
        update: (ref: any, data: Record<string, unknown>) => {
          txWrites.push({ kind: "update", ref, data });
        },
      };
      await fn(tx);
    });

    await approvePublicShare("review-EVT-2", "Performer");

    const settlementWrite = txWrites.find(
      (w) => w.kind === "set" && Array.isArray((w.data as any).approvals),
    );
    const approvals = (settlementWrite!.data as any).approvals as { party: string; approved: boolean }[];
    expect(approvals).toHaveLength(2);
    expect(approvals.map((a) => a.party).sort()).toEqual(["Performer", "Venue"]);
  });

  it("falls back to share-only update when share has no eventId", async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ kind: "settlement_review" }), // no eventId
    });

    await approvePublicShare("orphan-token", "Performer");

    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(mockUpdateDoc).toHaveBeenCalled();
    const [, updateData] = mockUpdateDoc.mock.calls[0];
    expect(updateData.approved).toBe(true);
    expect(typeof updateData.approvedAt).toBe("string");
  });
});
